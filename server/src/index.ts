// Logique serveur d'Event Control, exécutée par les hooks PocketBase (pb_hooks/routes.pb.js).
// Réutilise les règles du domaine (src/domain) : mêmes décisions de scan et mêmes droits
// que l'implémentation locale. Chaque fonction reçoit l'événement de requête PocketBase.
import { can, ROLES, type Action, type Role } from '../../src/domain/access';
import { DEFAULT_TYPES } from '../../src/domain/colors';
import { DEFAULT_THRESHOLDS } from '../../src/domain/gauge';
import type { Direction, EventInfo, Participant, ParticipantType, Passage, Refusal, ScanMethod } from '../../src/domain/model';
import {
  defaultPrivacy, EXPORT_KINDS, EXPORT_LABELS, normalizePrivacy, privacyComplete, purgeDay, retentionState,
  type AuditAction, type AuditEntry, type ExportKind, type PrivacyPolicy,
} from '../../src/domain/privacy';
import { anonymousReport, type EventReport, type ReportReason } from '../../src/domain/report';
import { parisDay } from '../../src/domain/time';
import { parseOfflinePassage, parseOfflineRefusal, reconcile, SYNC_MAX, type SyncResult, type SyncStatus } from '../../src/domain/offline';
import { applyScan, decideScan } from '../../src/domain/scan';
import type {
  AccessPage, EventPatch, Member, NewEvent, NewParticipant, ParticipantPatch, ParticipantRecord, PublicPrivacy,
  RegistrationForm, RegistrationInfo, ScanResult, Session, SignUpInput, StoreError,
} from '../../src/data/store';

// ─── Erreurs ─────────────────────────────────────────────────────────
// Le client convertit le code métier en StoreError.

const STATUS: Record<StoreError['code'], number> = {
  invalid: 400, unauthenticated: 401, forbidden: 403, closed: 403, 'not-found': 404, duplicate: 409, unreachable: 503,
};

function fail(code: StoreError['code'], message: string): never {
  // PocketBase ne conserve que les clés de `data` : la clé porte le code
  throw new ApiError(STATUS[code], message, { [code]: message });
}

// ─── Constantes et utilitaires ───────────────────────────────────────

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN_LENGTH = 10;
const ROLE_FIELD: Record<Role, string> = { owner: 'owners', admin: 'admins', agent: 'agents' };
const DIRECTIONS: readonly Direction[] = ['in', 'out'];
const METHODS: readonly ScanMethod[] = ['camera', 'scanner', 'search', 'manual'];

const nowIso = () => new Date().toISOString();
const normEmail = (email: unknown) => str(email).trim().toLowerCase();
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const clip = (v: unknown, max: number) => str(v).trim().slice(0, max);
/** Jeton de QR code : 160 bits tirés d'un générateur cryptographique (F-25). */
const newToken = () => $security.randomStringWithAlphabet(40, '0123456789abcdef');
/** Code d'accès des agents (F-04) : 8 caractères faciles à dicter, sans 0/O ni 1/I/L. */
const newAccessCode = () => $security.randomStringWithAlphabet(8, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789');
const normCode = (v: unknown) => str(v).trim().toUpperCase().replace(/[\s-]/g, '');

function ids(r: PbRecord, field: string): string[] {
  const list = r.getStringSlice(field);
  const out: string[] = [];
  for (let i = 0; i < list.length; i++) out.push(list[i]!);
  return out;
}

function parseJson<T>(r: PbRecord, field: string, fallback: T): T {
  try { return (JSON.parse(r.getString(field) || 'null') as T) ?? fallback; } catch { return fallback; }
}

function body(e: PbRequestEvent): Record<string, unknown> {
  return e.requestInfo().body ?? {};
}

function find(app: PbApp, collection: string, id: string): PbRecord | null {
  try { return app.findRecordById(collection, id); } catch { return null; }
}

function findBy(app: PbApp, collection: string, filter: string, params: Record<string, unknown>, sort = ''): PbRecord[] {
  return app.findRecordsByFilter(collection, filter, sort, 0, 0, params);
}

// ─── Conversion des enregistrements ──────────────────────────────────

function toEvent(r: PbRecord): EventInfo {
  return {
    id: r.id, orgId: r.getString('org'), name: r.getString('name'),
    startDate: r.getString('startDate'), endDate: r.getString('endDate'), venue: r.getString('venue'),
    capacity: r.getInt('capacity'),
    thresholds: parseJson(r, 'thresholds', DEFAULT_THRESHOLDS),
    types: parseJson<ParticipantType[]>(r, 'types', DEFAULT_TYPES),
    registrationOpen: r.getBool('registrationOpen'), createdAt: r.getString('createdAt'),
    privacy: normalizePrivacy(parseJson(r, 'privacy', {}), defaultPrivacy()),
    purgedAt: r.getString('purgedAt') || null,
    accessCode: r.getString('accessCode') || null,
  };
}

function toRefusal(r: PbRecord): Refusal {
  return {
    id: r.id, eventId: r.getString('event'), reason: r.getString('reason') as Refusal['reason'], at: r.getString('at'),
    agentId: r.getString('agentId'), agentName: r.getString('agentName'), stationId: r.getString('stationId'),
    method: r.getString('method') as ScanMethod, participantId: r.getString('participantId') || null, sample: r.getString('sample'),
  };
}

function toParticipant(r: PbRecord): Participant {
  return {
    id: r.id, eventId: r.getString('event'),
    firstName: r.getString('firstName'), lastName: r.getString('lastName'), email: r.getString('email'),
    phone: r.getString('phone'), company: r.getString('company'), typeId: r.getString('typeId'),
    token: r.getString('token'), tokenRevoked: r.getBool('tokenRevoked'),
    source: r.getString('source') as Participant['source'],
    consentAt: r.getString('consentAt') || null, createdAt: r.getString('createdAt'),
    inside: r.getBool('inside'), entryCount: r.getInt('entryCount'),
    firstEntryAt: r.getString('firstEntryAt') || null, lastMoveAt: r.getString('lastMoveAt') || null,
  };
}

/** Recopie dans l'enregistrement les champs modifiables d'un participant. */
function writeParticipant(r: PbRecord, p: Participant) {
  r.set('event', p.eventId);
  for (const k of ['firstName', 'lastName', 'email', 'phone', 'company', 'typeId', 'token', 'source', 'createdAt'] as const) r.set(k, p[k]);
  r.set('tokenRevoked', p.tokenRevoked);
  r.set('consentAt', p.consentAt ?? '');
  r.set('inside', p.inside);
  r.set('entryCount', p.entryCount);
  r.set('firstEntryAt', p.firstEntryAt ?? '');
  r.set('lastMoveAt', p.lastMoveAt ?? '');
}

function toPassage(r: PbRecord): Passage {
  return {
    id: r.id, eventId: r.getString('event'), participantId: r.getString('participant'), typeId: r.getString('typeId'),
    direction: r.getString('direction') as Direction, at: r.getString('at'),
    agentId: r.getString('agentId'), agentName: r.getString('agentName'), stationId: r.getString('stationId'),
    method: r.getString('method') as ScanMethod, origin: r.getString('origin') as Passage['origin'],
    offlineDuplicate: r.getBool('offlineDuplicate'),
  };
}

/** Nouveau passage ; identifiant fourni par le poste pour un passage hors ligne. */
function writePassage(app: PbApp, p: Omit<Passage, 'id'> & { id?: string }): Passage {
  const r = new Record(app.findCollectionByNameOrId('passages'));
  if (p.id) r.set('id', p.id);
  r.set('event', p.eventId);
  r.set('participant', p.participantId);
  for (const k of ['typeId', 'direction', 'at', 'agentId', 'agentName', 'stationId', 'method', 'origin'] as const) r.set(k, p[k]);
  r.set('offlineDuplicate', p.offlineDuplicate);
  app.save(r);
  return { ...p, id: r.id };
}

// ─── Droits (NF-20) ──────────────────────────────────────────────────

function requireUser(e: PbRequestEvent): PbRecord {
  if (!e.auth || e.auth.collection().name !== 'users') fail('unauthenticated', 'Connectez-vous pour continuer');
  return e.auth;
}

function roleIn(org: PbRecord, userId: string): Role | null {
  for (const role of ROLES) if (ids(org, ROLE_FIELD[role]).indexOf(userId) >= 0) return role;
  return null;
}

/** Organisation, si l'utilisateur connecté y a le droit `action`. */
function requireOrg(app: PbApp, e: PbRequestEvent, orgId: string, action: Action): { org: PbRecord; user: PbRecord; role: Role } {
  const user = requireUser(e);
  const org = find(app, 'organizations', orgId);
  const role = org && roleIn(org, user.id);
  if (!org || !role) return fail('not-found', 'Organisation introuvable');
  if (!can(role, action)) fail('forbidden', 'Votre rôle ne permet pas cette action');
  return { org, user, role };
}

/** Pour qui n'est pas membre de son organisation, un événement n'existe pas (NF-24). */
/** Rôle dans l'organisation de l'événement, ou agent s'il l'a rejoint avec son code (F-04). */
function eventRole(org: PbRecord, event: PbRecord, userId: string): Role | null {
  return roleIn(org, userId) ?? (ids(event, 'agents').indexOf(userId) >= 0 ? 'agent' : null);
}

function requireEvent(app: PbApp, e: PbRequestEvent, eventId: string, action: Action) {
  const user = requireUser(e);
  const event = find(app, 'events', eventId);
  const org = event && find(app, 'organizations', event.getString('org'));
  const role = event && org ? eventRole(org, event, user.id) : null;
  if (!event || !org || !role) return fail('not-found', 'Événement introuvable');
  if (!can(role, action)) fail('forbidden', 'Votre rôle ne permet pas cette action');
  return { event, org, user, role };
}

function requireParticipant(app: PbApp, e: PbRequestEvent, id: string, action: Action) {
  const participant = find(app, 'participants', id);
  if (!participant) return fail('not-found', 'Participant introuvable');
  return { participant, ...requireEvent(app, e, participant.getString('event'), action) };
}

function hasOtherOwner(org: PbRecord, userId: string) {
  return ids(org, 'owners').some((id) => id !== userId);
}

function emailTaken(app: PbApp, eventId: string, email: string, exceptId = '') {
  return !!email && findBy(app, 'participants', 'event = {:event} && email = {:email} && id != {:except}',
    { event: eventId, email, except: exceptId }).length > 0;
}

// ─── Comptes et organisations (F-01, F-02) ───────────────────────────

function sessionOf(app: PbApp, user: PbRecord): Session {
  const orgs = findBy(app, 'organizations', 'owners.id ?= {:u} || admins.id ?= {:u} || agents.id ?= {:u}', { u: user.id });
  return {
    user: { id: user.id, email: user.email(), name: user.getString('name') },
    memberships: orgs
      .map((o) => ({ orgId: o.id, orgName: o.getString('name'), role: roleIn(o, user.id)! }))
      .sort((a, b) => a.orgName.localeCompare(b.orgName, 'fr')),
    eventAccess: findBy(app, 'events', 'agents.id ?= {:u}', { u: user.id }, '-startDate')
      .filter((ev) => orgs.every((o) => o.id !== ev.getString('org')))
      .map((ev) => ({ eventId: ev.id, eventName: ev.getString('name'), startDate: ev.getString('startDate'), endDate: ev.getString('endDate') })),
  };
}

function createOrg(app: PbApp, name: unknown, ownerId: string): PbRecord {
  const org = new Record(app.findCollectionByNameOrId('organizations'));
  const n = clip(name, 200);
  if (!n) fail('invalid', 'Le nom de l\'organisation est obligatoire');
  org.set('name', n);
  org.set('owners', [ownerId]);
  org.set('createdAt', nowIso());
  app.save(org);
  return org;
}

function member(app: PbApp, org: PbRecord, userId: string): Member {
  const u = find(app, 'users', userId);
  if (!u) return fail('not-found', 'Membre introuvable');
  return { userId, email: u.email(), name: u.getString('name'), role: roleIn(org, userId)! };
}

function setRole(org: PbRecord, userId: string, role: Role | null) {
  for (const r of ROLES) {
    const list = ids(org, ROLE_FIELD[r]).filter((id) => id !== userId);
    if (r === role) list.push(userId);
    org.set(ROLE_FIELD[r], list);
  }
}

function parseRole(v: unknown): Role {
  const role = str(v) as Role;
  if (ROLES.indexOf(role) < 0) fail('invalid', 'Rôle invalide');
  return role;
}

export function session(e: PbRequestEvent) {
  e.json(200, sessionOf($app, requireUser(e)));
}

/** Crée le compte et sa première organisation ; le client se connecte ensuite. */
export function signUp(e: PbRequestEvent) {
  const input = body(e) as unknown as SignUpInput;
  const email = normEmail(input.email);
  const name = clip(input.name, 100);
  if (!name) fail('invalid', 'Le nom est obligatoire');
  if (!EMAIL.test(email)) fail('invalid', 'Adresse email invalide');
  if (str(input.password).length < PASSWORD_MIN_LENGTH) {
    fail('invalid', `Le mot de passe doit compter au moins ${PASSWORD_MIN_LENGTH} caractères`);
  }
  $app.runInTransaction((app) => {
    let exists = true;
    try { app.findAuthRecordByEmail('users', email); } catch { exists = false; }
    if (exists) fail('duplicate', 'Un compte existe déjà avec cette adresse email');
    const user = new Record(app.findCollectionByNameOrId('users'));
    user.set('email', email);
    user.set('name', name);
    user.setPassword(str(input.password));
    app.save(user);
    // Sans nom d'organisation : agent qui rejoindra un événement avec son code (F-04)
    if (clip(input.organization, 200)) createOrg(app, input.organization, user.id);
  });
  e.json(201, { ok: true });
}

export function createOrganization(e: PbRequestEvent) {
  const user = requireUser(e);
  createOrg($app, body(e).name, user.id);
  e.json(201, sessionOf($app, user));
}

export function listMembers(e: PbRequestEvent) {
  const { org } = requireOrg($app, e, e.request.pathValue('org'), 'members.manage');
  const all = ([] as string[]).concat(...ROLES.map((r) => ids(org, ROLE_FIELD[r])));
  e.json(200, all.map((id) => member($app, org, id)).sort((a, b) => a.name.localeCompare(b.name, 'fr')));
}

export function addMember(e: PbRequestEvent) {
  const { email, role } = body(e);
  const r = parseRole(role);
  let result: Member | null = null;
  $app.runInTransaction((app) => {
    const { org } = requireOrg(app, e, e.request.pathValue('org'), 'members.manage');
    let user: PbRecord;
    try { user = app.findAuthRecordByEmail('users', normEmail(email)); }
    catch { return fail('not-found', 'Aucun compte avec cette adresse : la personne doit d\'abord créer le sien'); }
    if (roleIn(org, user.id)) fail('duplicate', `${user.getString('name')} est déjà membre`);
    setRole(org, user.id, r);
    app.save(org);
    result = member(app, org, user.id);
  });
  e.json(201, result);
}

export function setMemberRole(e: PbRequestEvent) {
  const role = parseRole(body(e).role);
  const userId = e.request.pathValue('user');
  let result: Member | null = null;
  $app.runInTransaction((app) => {
    const { org } = requireOrg(app, e, e.request.pathValue('org'), 'members.manage');
    const current = roleIn(org, userId);
    if (!current) fail('not-found', 'Membre introuvable');
    if (current === 'owner' && role !== 'owner' && !hasOtherOwner(org, userId)) {
      fail('invalid', 'L\'organisation doit garder au moins un propriétaire');
    }
    setRole(org, userId, role);
    app.save(org);
    result = member(app, org, userId);
  });
  e.json(200, result);
}

export function removeMember(e: PbRequestEvent) {
  const userId = e.request.pathValue('user');
  $app.runInTransaction((app) => {
    const { org } = requireOrg(app, e, e.request.pathValue('org'), 'members.manage');
    if (roleIn(org, userId) === 'owner' && !hasOtherOwner(org, userId)) {
      fail('invalid', 'L\'organisation doit garder au moins un propriétaire');
    }
    setRole(org, userId, null);
    app.save(org);
  });
  e.noContent(204);
}

// ─── Événements (F-10 à F-16) ────────────────────────────────────────

function saveEvent(app: PbApp, r: PbRecord, ev: EventInfo) {
  if (!ev.name.trim()) fail('invalid', 'Le nom de l\'événement est obligatoire');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ev.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(ev.endDate)) fail('invalid', 'Dates invalides');
  if (ev.endDate < ev.startDate) fail('invalid', 'La date de fin précède la date de début');
  if (!Number.isInteger(ev.capacity) || ev.capacity < 0) fail('invalid', 'Jauge invalide');
  r.set('org', ev.orgId);
  r.set('name', ev.name.trim().slice(0, 200));
  r.set('startDate', ev.startDate);
  r.set('endDate', ev.endDate);
  r.set('venue', ev.venue.trim().slice(0, 200));
  r.set('capacity', ev.capacity);
  r.set('thresholds', ev.thresholds);
  r.set('types', ev.types);
  if (ev.registrationOpen && !privacyComplete(ev.privacy)) {
    fail('invalid', "Renseignez le responsable du traitement et le contact pour les données personnelles avant d'ouvrir les inscriptions");
  }
  r.set('registrationOpen', ev.registrationOpen);
  r.set('createdAt', ev.createdAt);
  r.set('privacy', ev.privacy);
  r.set('purgedAt', ev.purgedAt ?? '');
  app.save(r);
  return toEvent(r);
}

function newEvent(app: PbApp, orgId: string, input: NewEvent): EventInfo {
  const r = new Record(app.findCollectionByNameOrId('events'));
  return saveEvent(app, r, {
    id: '', orgId, name: str(input.name), startDate: str(input.startDate), endDate: str(input.endDate),
    venue: str(input.venue), capacity: input.capacity ?? 1000, thresholds: DEFAULT_THRESHOLDS,
    types: DEFAULT_TYPES, registrationOpen: false, createdAt: nowIso(),
    privacy: orgPrivacy(app.findRecordById('organizations', orgId)), purgedAt: null, accessCode: null,
  });
}

/** Politique de l'organisation pour ses nouveaux événements ; à défaut, elle-même comme responsable. */
function orgPrivacy(org: PbRecord): PrivacyPolicy {
  return normalizePrivacy(parseJson(org, 'privacy', {}), defaultPrivacy(org.getString('name')));
}

/** Après la purge, l'événement ne garde que son bilan : plus aucune donnée personnelle n'y entre. */
function requireNotPurged(event: PbRecord) {
  if (event.getString('purgedAt')) fail('closed', 'Les données de cet événement ont été purgées');
}

export function createEvent(e: PbRequestEvent) {
  const orgId = e.request.pathValue('org');
  requireOrg($app, e, orgId, 'event.create');
  e.json(201, newEvent($app, orgId, body(e) as unknown as NewEvent));
}

export function updateEvent(e: PbRequestEvent) {
  const { event } = requireEvent($app, e, e.request.pathValue('id'), 'event.edit');
  const patch = body(e) as EventPatch;
  const current = toEvent(event);
  const next: EventInfo = { ...current };
  if (patch.name !== undefined) next.name = str(patch.name);
  if (patch.startDate !== undefined) next.startDate = str(patch.startDate);
  if (patch.endDate !== undefined) next.endDate = str(patch.endDate);
  if (patch.venue !== undefined) next.venue = str(patch.venue);
  if (patch.capacity !== undefined) next.capacity = Number(patch.capacity);
  if (patch.thresholds !== undefined) next.thresholds = { warn: Number(patch.thresholds.warn), critical: Number(patch.thresholds.critical) };
  if (patch.types !== undefined) next.types = (patch.types ?? []).map((t) => ({ id: clip(t.id, 60), label: clip(t.label, 60), color: clip(t.color, 7) }));
  if (patch.registrationOpen !== undefined) next.registrationOpen = !!patch.registrationOpen;
  if (patch.privacy !== undefined) next.privacy = normalizePrivacy(patch.privacy, current.privacy);
  if (next.registrationOpen && current.purgedAt) fail('closed', 'Les données de cet événement ont été purgées');
  if (!next.types.length) fail('invalid', 'Il faut au moins un type de participant');
  e.json(200, saveEvent($app, event, next));
}

export function duplicateEvent(e: PbRequestEvent) {
  const { event } = requireEvent($app, e, e.request.pathValue('id'), 'event.create');
  const source = toEvent(event);
  let copy: EventInfo | null = null;
  $app.runInTransaction((app) => {
    const created = newEvent(app, source.orgId, {
      name: str(body(e).name), startDate: source.startDate, endDate: source.endDate, venue: source.venue, capacity: source.capacity,
    });
    copy = saveEvent(app, app.findRecordById('events', created.id), { ...created, types: source.types, thresholds: source.thresholds, privacy: source.privacy });
  });
  e.json(201, copy);
}

export function deleteEvent(e: PbRequestEvent) {
  $app.runInTransaction((app) => {
    const { event, user } = requireEvent(app, e, e.request.pathValue('id'), 'event.delete');
    const ev = toEvent(event);
    // Bilan anonyme enregistré avant toute suppression de données (F-77)
    const count = ev.purgedAt ? 0 : keepReport(app, event, 'deletion').registered;
    audit(app, ev, user, 'event.delete', count);
    app.delete(event); // participants, passages et refus suivent (suppression en cascade)
  });
  e.noContent(204);
}

// ─── Participants (F-20 à F-26) ──────────────────────────────────────

function buildParticipant(eventId: string, input: NewParticipant): Participant {
  return {
    id: '', eventId,
    firstName: clip(input.firstName, 100), lastName: clip(input.lastName, 100),
    email: normEmail(input.email).slice(0, 320), phone: clip(input.phone, 40),
    company: str(input.company).replace(/\s+/g, ' ').trim().slice(0, 120),
    typeId: str(input.typeId), token: newToken(), tokenRevoked: false,
    source: input.source, consentAt: input.consentAt ?? null, createdAt: nowIso(),
    inside: false, entryCount: 0, firstEntryAt: null, lastMoveAt: null,
  };
}

function insertParticipant(app: PbApp, p: Participant): Participant {
  const r = new Record(app.findCollectionByNameOrId('participants'));
  writeParticipant(r, p);
  app.save(r);
  return { ...p, id: r.id };
}

export function addParticipants(e: PbRequestEvent) {
  const list = (body(e).list ?? []) as NewParticipant[];
  const eventId = e.request.pathValue('id');
  const added: Participant[] = [];
  $app.runInTransaction((app) => {
    const { event, user } = requireEvent(app, e, eventId, 'participants.manage');
    requireNotPurged(event);
    const types = toEvent(event).types;
    for (const input of list) {
      if (!str(input.firstName).trim() && !str(input.lastName).trim()) fail('invalid', 'Nom manquant');
      const email = normEmail(input.email);
      if (email && !EMAIL.test(email)) fail('invalid', `Email invalide : ${str(input.email)}`);
      if (emailTaken(app, eventId, email)) fail('duplicate', `${str(input.email)} est déjà inscrit`);
      const typeId = types.some((t) => t.id === input.typeId) ? input.typeId : types[0]!.id;
      const source = (['manual', 'import', 'form'] as const).indexOf(input.source) >= 0 ? input.source : 'manual';
      added.push(insertParticipant(app, buildParticipant(eventId, { ...input, typeId, source })));
    }
    const imported = added.filter((p) => p.source === 'import').length;
    if (imported) audit(app, toEvent(event), user, 'import', imported); // RG-09
  });
  e.json(201, added);
}

export function updateParticipant(e: PbRequestEvent) {
  const patch = body(e) as ParticipantPatch;
  let result: Participant | null = null;
  $app.runInTransaction((app) => {
    const { participant } = requireParticipant(app, e, e.request.pathValue('id'), 'participants.manage');
    const next = toParticipant(participant);
    for (const k of ['firstName', 'lastName', 'phone', 'company', 'typeId'] as const) {
      if (patch[k] !== undefined) next[k] = clip(patch[k], k === 'company' ? 120 : 100);
    }
    if (patch.email !== undefined) {
      next.email = normEmail(patch.email);
      if (next.email && !EMAIL.test(next.email)) fail('invalid', 'Email invalide');
      if (emailTaken(app, next.eventId, next.email, participant.id)) fail('duplicate', `${next.email} est déjà inscrit`);
    }
    writeParticipant(participant, next);
    app.save(participant);
    result = next;
  });
  e.json(200, result);
}

export function deleteParticipant(e: PbRequestEvent) {
  $app.runInTransaction((app) => {
    const { participant, event, user } = requireParticipant(app, e, e.request.pathValue('id'), 'participants.manage');
    audit(app, toEvent(event), user, 'participant.delete', 1); // NF-34
    app.delete(participant); // ses passages suivent (RG-08)
  });
  e.noContent(204);
}

export function revokeToken(e: PbRequestEvent) {
  const { participant } = requireParticipant($app, e, e.request.pathValue('id'), 'participants.manage');
  participant.set('token', newToken());
  participant.set('tokenRevoked', false);
  $app.save(participant);
  e.json(200, toParticipant(participant));
}

// ─── Scan (F-50 à F-59) ──────────────────────────────────────────────

/** Lecture, décision et écriture dans une seule transaction : deux postes ne peuvent pas entrer la même personne (F-53). */
export function scan(e: PbRequestEvent) {
  const eventId = e.request.pathValue('id');
  const input = body(e);
  const token = str(input.token).trim();
  const direction = str(input.direction) as Direction;
  const method = str(input.method) as ScanMethod;
  if (DIRECTIONS.indexOf(direction) < 0 || METHODS.indexOf(method) < 0) fail('invalid', 'Requête de scan invalide');
  let result: ScanResult | null = null;
  $app.runInTransaction((app) => {
    const { user, event } = requireEvent(app, e, eventId, 'scan');
    requireNotPurged(event);
    const record = token ? findBy(app, 'participants', 'event = {:event} && token = {:token}', { event: eventId, token })[0] : undefined;
    const participant = record ? toParticipant(record) : undefined;
    const decision = decideScan(participant, direction);
    const base = { eventId, at: nowIso(), agentId: user.id, agentName: user.getString('name'), stationId: clip(input.stationId, 60), method };

    if (decision.result === 'refused') {
      const r = new Record(app.findCollectionByNameOrId('refusals'));
      r.set('event', eventId);
      for (const [k, v] of Object.entries(base)) if (k !== 'eventId') r.set(k, v);
      r.set('reason', decision.reason);
      r.set('participantId', participant?.id ?? '');
      r.set('sample', decision.reason === 'unknown' ? token.slice(0, 12) : '');
      app.save(r);
    }
    const applied = participant && record ? applyScan(participant, decision, { ...base, origin: 'online', passageId: '' }) : null;
    let passage: Passage | null = null;
    if (applied && record) {
      writeParticipant(record, applied.participant);
      app.save(record);
      const { id: _ignored, ...rest } = applied.passage;
      passage = writePassage(app, rest);
    }
    result = { decision, participant: applied?.participant ?? participant ?? null, passage };
  });
  e.json(200, result);
}

/** Clôture de journée (F-59) : sortie de tous les présents, marquée « clôture ». */
export function closeDay(e: PbRequestEvent) {
  const eventId = e.request.pathValue('id');
  const stationId = clip(body(e).stationId, 60);
  let count = 0;
  $app.runInTransaction((app) => {
    const { user, event } = requireEvent(app, e, eventId, 'day.close');
    requireNotPurged(event);
    const at = nowIso();
    for (const record of findBy(app, 'participants', 'event = {:event} && inside = true', { event: eventId })) {
      const p = toParticipant(record);
      writeParticipant(record, { ...p, inside: false, lastMoveAt: at });
      app.save(record);
      writePassage(app, {
        eventId, participantId: p.id, typeId: p.typeId, direction: 'out', at,
        agentId: user.id, agentName: user.getString('name'), stationId,
        method: 'manual', origin: 'closing', offlineDuplicate: false,
      });
      count++;
    }
  });
  e.json(200, { count });
}

/**
 * Passages et refus enregistrés hors ligne (F-61, F-63), dans une seule transaction :
 * le journal de chaque participant concerné est rejoué à l'heure réelle, ses doublons marqués
 * et sa présence recalculée. Un lot renvoyé après une coupure n'est pas compté deux fois.
 */
export function syncOffline(e: PbRequestEvent) {
  const eventId = e.request.pathValue('id');
  const input = body(e);
  const passagesIn = Array.isArray(input.passages) ? (input.passages as unknown[]) : [];
  const refusalsIn = Array.isArray(input.refusals) ? (input.refusals as unknown[]) : [];
  if (passagesIn.length + refusalsIn.length > SYNC_MAX) fail('invalid', 'Lot trop volumineux');
  const rawId = (raw: unknown) => str((raw as { id?: unknown } | null)?.id);
  const status = new Map<string, SyncStatus>();
  let newDuplicates = 0;

  $app.runInTransaction((app) => {
    const { user, event } = requireEvent(app, e, eventId, 'scan');
    requireNotPurged(event);
    const nowMs = Date.now();
    const base = { eventId, agentId: user.id, agentName: user.getString('name'), stationId: clip(input.stationId, 60) };

    const byParticipant = new Map<string, { record: PbRecord; received: Passage[] }>();
    for (const raw of passagesIn) {
      const p = parseOfflinePassage(raw, nowMs);
      const record = p && (byParticipant.get(p.participantId)?.record ?? find(app, 'participants', p.participantId));
      const existing = p && find(app, 'passages', p.id);
      if (!p || !record || record.getString('event') !== eventId || (existing && existing.getString('participant') !== p.participantId)) {
        status.set(rawId(raw), 'rejected');
        continue;
      }
      const group = byParticipant.get(p.participantId) ?? { record, received: [] };
      group.received.push({ ...base, ...p, typeId: record.getString('typeId'), origin: 'offline', offlineDuplicate: false });
      byParticipant.set(p.participantId, group);
    }

    for (const [participantId, { record, received }] of byParticipant) {
      const knownRecords = findBy(app, 'passages', 'participant = {:p}', { p: participantId });
      const known = knownRecords.map(toPassage);
      const r = reconcile(toParticipant(record), known, received);
      for (const c of r.changed) {
        const kr = knownRecords[known.findIndex((k) => k.id === c.id)]!;
        kr.set('offlineDuplicate', c.offlineDuplicate);
        app.save(kr);
      }
      for (const p of r.added) writePassage(app, p);
      writeParticipant(record, r.participant);
      app.save(record);
      newDuplicates += r.newDuplicates;
      const flags = new Map<string, boolean>();
      for (const k of known) flags.set(k.id, k.offlineDuplicate);
      for (const p of [...r.changed, ...r.added]) flags.set(p.id, p.offlineDuplicate);
      for (const p of received) status.set(p.id, flags.get(p.id) ? 'duplicate' : 'counted');
    }

    for (const raw of refusalsIn) {
      const r = parseOfflineRefusal(raw, nowMs);
      if (!r || find(app, 'refusals', r.id)) continue;
      const rec = new Record(app.findCollectionByNameOrId('refusals'));
      rec.set('id', r.id);
      rec.set('event', eventId);
      for (const [k, v] of Object.entries({ ...base, ...r })) if (k !== 'eventId' && k !== 'id') rec.set(k, v ?? '');
      app.save(rec);
    }
  });

  const result: SyncResult = {
    passages: passagesIn.map((raw) => ({ id: rawId(raw), status: status.get(rawId(raw)) ?? 'rejected' })),
    newDuplicates,
  };
  e.json(200, result);
}

// ─── Agents par code d'accès (F-04) ──────────────────────────────────

export function joinEvent(e: PbRequestEvent) {
  const user = requireUser(e);
  const code = normCode(body(e).code);
  $app.runInTransaction((app) => {
    const event = code ? findBy(app, 'events', "accessCode = {:c} && purgedAt = ''", { c: code })[0] : undefined;
    if (!event) return fail('not-found', 'Code d\'accès inconnu ou désactivé');
    const org = app.findRecordById('organizations', event.getString('org'));
    if (!eventRole(org, event, user.id)) {
      event.set('agents', [...ids(event, 'agents'), user.id]);
      app.save(event);
    }
  });
  e.json(200, sessionOf($app, user));
}

export function setAccessCode(e: PbRequestEvent) {
  const enabled = body(e).enabled === true;
  let result: EventInfo | null = null;
  $app.runInTransaction((app) => {
    const { event } = requireEvent(app, e, e.request.pathValue('id'), 'event.edit');
    if (enabled) requireNotPurged(event);
    let code = '';
    while (enabled && (!code || findBy(app, 'events', 'accessCode = {:c}', { c: code }).length)) code = newAccessCode();
    event.set('accessCode', code);
    // Désactiver le code retire l'accès de tous ceux qui l'ont utilisé (code divulgué)
    if (!enabled) event.set('agents', []);
    app.save(event);
    result = toEvent(event);
  });
  e.json(200, result);
}

export function listEventAgents(e: PbRequestEvent) {
  const { event } = requireEvent($app, e, e.request.pathValue('id'), 'event.edit');
  const agents: Member[] = [];
  for (const id of ids(event, 'agents')) {
    const u = find($app, 'users', id);
    if (u) agents.push({ userId: id, email: u.email(), name: u.getString('name'), role: 'agent' });
  }
  e.json(200, agents.sort((a, b) => a.name.localeCompare(b.name, 'fr')));
}

// ─── Protection des données (NF-32 à NF-34, F-77, RG-09) ─────────────

function publicPrivacy(ev: EventInfo): PublicPrivacy {
  return { ...ev.privacy, purgeDay: purgeDay(ev) };
}

/** Trace d'une action sur des données personnelles ; `user` absent pour la purge automatique. */
function audit(app: PbApp, ev: EventInfo, user: PbRecord | null, action: AuditAction, count: number, detail = '') {
  const r = new Record(app.findCollectionByNameOrId('audit'));
  r.set('org', ev.orgId);
  r.set('eventId', ev.id);
  r.set('eventName', ev.name);
  r.set('actorId', user?.id ?? '');
  r.set('actorName', user ? user.getString('name') : 'Purge automatique');
  r.set('action', action);
  r.set('count', count);
  r.set('detail', clip(detail, 200));
  r.set('at', nowIso());
  app.save(r);
}

function toAudit(r: PbRecord): AuditEntry {
  return {
    id: r.id, orgId: r.getString('org'), eventId: r.getString('eventId'), eventName: r.getString('eventName'),
    actorId: r.getString('actorId'), actorName: r.getString('actorName'), action: r.getString('action') as AuditAction,
    count: r.getInt('count'), detail: r.getString('detail'), at: r.getString('at'),
  };
}

/** Bilan anonyme de l'événement, enregistré pour être conservé sans limite (F-77). */
function keepReport(app: PbApp, event: PbRecord, reason: ReportReason): EventReport {
  const ev = toEvent(event);
  const filter = 'event = {:e}';
  const report = anonymousReport(
    ev,
    findBy(app, 'participants', filter, { e: ev.id }).map(toParticipant),
    findBy(app, 'passages', filter, { e: ev.id }).map(toPassage),
    findBy(app, 'refusals', filter, { e: ev.id }).map(toRefusal),
    nowIso(), reason,
  );
  const r = new Record(app.findCollectionByNameOrId('reports'));
  r.set('org', ev.orgId);
  r.set('eventId', ev.id);
  r.set('report', report);
  r.set('createdAt', report.generatedAt);
  app.save(r);
  return report;
}

/** Purge des données personnelles d'un événement : participants, passages, refus. L'événement et son bilan restent. */
function purge(app: PbApp, event: PbRecord, user: PbRecord | null): EventReport {
  const report = keepReport(app, event, 'purge');
  const filter = 'event = {:e}';
  for (const r of findBy(app, 'refusals', filter, { e: event.id })) app.delete(r);
  for (const r of findBy(app, 'participants', filter, { e: event.id })) app.delete(r); // passages en cascade
  event.set('purgedAt', report.generatedAt);
  event.set('registrationOpen', false);
  app.save(event);
  audit(app, toEvent(event), user, 'purge', report.registered, user ? 'Purge demandée' : 'Échéance de conservation');
  return report;
}

export function purgeEvent(e: PbRequestEvent) {
  let report: EventReport | null = null;
  $app.runInTransaction((app) => {
    const { event, user } = requireEvent(app, e, e.request.pathValue('id'), 'event.delete');
    requireNotPurged(event);
    report = purge(app, event, user);
  });
  e.json(200, report);
}

/** Purge automatique des événements arrivés à échéance de conservation (NF-33). Renvoie leur nombre. */
export function purgeDue(today = parisDay(Date.now())): number {
  let count = 0;
  for (const event of findBy($app, 'events', "purgedAt = ''", {})) {
    if (retentionState(toEvent(event), today) !== 'due') continue;
    $app.runInTransaction((app) => { purge(app, app.findRecordById('events', event.id), null); });
    count++;
  }
  return count;
}

/** Déclenchement manuel de la purge automatique, réservé à l'administration du serveur (tests, exploitation). */
export function purgeDueRoute(e: PbRequestEvent) {
  if (!e.auth || e.auth.collection().name !== '_superusers') fail('forbidden', 'Réservé à l\'administration du serveur');
  const today = str(body(e).today);
  e.json(200, { purged: purgeDue(/^\d{4}-\d{2}-\d{2}$/.test(today) ? today : undefined) });
}

export function getOrgPrivacy(e: PbRequestEvent) {
  const { org } = requireOrg($app, e, e.request.pathValue('org'), 'scan');
  e.json(200, orgPrivacy(org));
}

export function setOrgPrivacy(e: PbRequestEvent) {
  const { org } = requireOrg($app, e, e.request.pathValue('org'), 'event.edit');
  const next = normalizePrivacy(body(e), orgPrivacy(org));
  org.set('privacy', next);
  $app.save(org);
  e.json(200, next);
}

export function listReports(e: PbRequestEvent) {
  const { org } = requireOrg($app, e, e.request.pathValue('org'), 'stats.export');
  e.json(200, findBy($app, 'reports', 'org = {:o}', { o: org.id }, '-createdAt').map((r) => parseJson<EventReport | null>(r, 'report', null)).filter(Boolean));
}

export function listAudit(e: PbRequestEvent) {
  const { org } = requireOrg($app, e, e.request.pathValue('org'), 'stats.export');
  e.json(200, findBy($app, 'audit', 'org = {:o}', { o: org.id }, '-at').map(toAudit));
}

export function logExport(e: PbRequestEvent) {
  const input = body(e);
  const kind = str(input.kind) as ExportKind;
  if (EXPORT_KINDS.indexOf(kind) < 0) fail('invalid', 'Export inconnu');
  const { event, user } = requireEvent($app, e, e.request.pathValue('id'), 'stats.export');
  audit($app, toEvent(event), user, 'export', Math.max(0, Math.floor(Number(input.count) || 0)), EXPORT_LABELS[kind]);
  e.noContent(204);
}

export function exportParticipant(e: PbRequestEvent) {
  let record: ParticipantRecord | null = null;
  $app.runInTransaction((app) => {
    const { participant, event, user } = requireParticipant(app, e, e.request.pathValue('id'), 'participants.manage');
    const ev = toEvent(event);
    const p = toParticipant(participant);
    record = {
      eventName: ev.name,
      participant: p,
      passages: findBy(app, 'passages', 'participant = {:p}', { p: p.id }, 'at').map(toPassage)
        .map(({ direction, at, stationId, method, origin, offlineDuplicate }) => ({ direction, at, stationId, method, origin, offlineDuplicate })),
      refusals: findBy(app, 'refusals', 'participantId = {:p}', { p: p.id }, 'at').map(toRefusal)
        .map(({ reason, at, stationId }) => ({ reason, at, stationId })),
      exportedAt: nowIso(),
    };
    audit(app, ev, user, 'participant.export', 1); // NF-34
  });
  e.json(200, record);
}

// ─── Public (F-30 à F-42) : sans connexion ───────────────────────────

export function registrationInfo(e: PbRequestEvent) {
  const r = find($app, 'events', e.request.pathValue('id'));
  if (!r) return fail('not-found', 'Événement introuvable');
  const ev = toEvent(r);
  const info: RegistrationInfo = { eventName: ev.name, types: ev.types, open: ev.registrationOpen && !ev.purgedAt, privacy: publicPrivacy(ev) };
  e.json(200, info);
}

export function register(e: PbRequestEvent) {
  const eventId = e.request.pathValue('id');
  const form = body(e) as unknown as RegistrationForm;
  if (str(form.website).trim()) fail('invalid', 'Inscription refusée'); // champ piège rempli : robot (F-36)
  if (form.consent !== true) fail('invalid', 'Le consentement est obligatoire');
  if (!str(form.lastName).trim()) fail('invalid', 'Le nom est obligatoire');
  const email = normEmail(form.email);
  if (!EMAIL.test(email)) fail('invalid', 'Adresse email invalide');
  let token = '';
  $app.runInTransaction((app) => {
    const r = find(app, 'events', eventId);
    const event = r && toEvent(r);
    if (!event || !event.registrationOpen || event.purgedAt) fail('closed', 'Les inscriptions sont fermées');
    if (!event.types.some((t) => t.id === form.typeId)) fail('invalid', 'Profil invalide');
    if (emailTaken(app, eventId, email)) fail('duplicate', 'Cette adresse email est déjà inscrite');
    token = insertParticipant(app, buildParticipant(eventId, {
      firstName: str(form.firstName), lastName: str(form.lastName), email, phone: str(form.phone),
      company: str(form.company), typeId: str(form.typeId), source: 'form', consentAt: nowIso(),
    })).token;
  });
  e.json(201, { token });
}

/** Page d'accès (F-40, F-42) : les seules données de son titulaire, jamais l'email. */
export function accessPage(e: PbRequestEvent) {
  const token = e.request.pathValue('token');
  const r = token ? findBy($app, 'participants', 'token = {:token} && tokenRevoked = false', { token })[0] : undefined;
  const ev = r && find($app, 'events', r.getString('event'));
  if (!r || !ev) return fail('not-found', 'Lien d\'accès invalide');
  const p = toParticipant(r);
  const event = toEvent(ev);
  const page: AccessPage = {
    eventName: event.name, startDate: event.startDate, endDate: event.endDate, venue: event.venue,
    firstName: p.firstName, lastName: p.lastName, company: p.company,
    type: event.types.find((t) => t.id === p.typeId) ?? null, token: p.token, entryCount: p.entryCount,
    privacy: publicPrivacy(event),
  };
  e.json(200, page);
}
