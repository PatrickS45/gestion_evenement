// Implémentation locale de EventStore : données dans le stockage du navigateur,
// synchronisation en direct entre onglets (deux onglets = deux postes de scan).
// Sert à la démonstration et préfigure le mode hors ligne (lot 2).
// Les droits y sont vérifiés comme ils le seront par le serveur (NF-20).
import { can, type Action, type Role } from '../domain/access';
import { compareNames, type EventInfo, type Organization, type Participant, type Passage, type Refusal, type ScanMethod, type User } from '../domain/model';
import { parseOfflinePassage, parseOfflineRefusal, reconcile, SYNC_MAX, type SyncBatch, type SyncResult, type SyncStatus } from '../domain/offline';
import { applyScan, decideScan } from '../domain/scan';
import {
  defaultPrivacy, EXPORT_KINDS, EXPORT_LABELS, normalizePrivacy, privacyComplete, purgeDay, retentionState,
  type AuditAction, type AuditEntry, type ExportKind, type PrivacyPolicy,
} from '../domain/privacy';
import { anonymousReport, type EventReport, type ReportReason } from '../domain/report';
import { parisDay } from '../domain/time';
import { DEFAULT_TYPES } from '../domain/colors';
import { DEFAULT_THRESHOLDS } from '../domain/gauge';
import { newAccessCode, newId, newToken } from '../domain/ids';
import { hashPassword, PASSWORD_MIN_LENGTH, verifyPassword } from './password';
import {
  StoreError,
  type AccessPage, type EventPatch, type EventSnapshot, type EventStore, type Member, type NewEvent,
  type NewParticipant, type ParticipantPatch, type ParticipantRecord, type PublicPrivacy, type RegistrationForm, type RegistrationInfo, type ScanResult,
  type Session, type SignUpInput,
} from './store';

interface StoredUser extends User { passwordHash: string }
interface StoredMembership { orgId: string; userId: string; role: Role }

interface Db {
  version: 2;
  users: Record<string, StoredUser>;
  organizations: Record<string, Organization>;
  memberships: StoredMembership[];
  events: Record<string, EventInfo>;
  participants: Record<string, Participant>;
  passages: Passage[];
  refusals: Refusal[];
  /** Politique par défaut de chaque organisation (NF-32). */
  orgPrivacy: Record<string, PrivacyPolicy>;
  /** Bilans anonymes conservés (F-77). */
  reports: (EventReport & { orgId: string })[];
  /** Traces des actions sur les données personnelles (RG-09). */
  audit: AuditEntry[];
  /** Agents ayant rejoint un événement avec son code (F-04). */
  eventAgents: { eventId: string; userId: string }[];
}

const EMPTY: Db = {
  version: 2, users: {}, organizations: {}, memberships: [], events: {}, participants: {}, passages: [], refusals: [],
  orgPrivacy: {}, reports: [], audit: [], eventAgents: [],
};
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normEmail = (email: string) => email.trim().toLowerCase();

function publicPrivacy(e: EventInfo): PublicPrivacy {
  return { ...e.privacy, purgeDay: purgeDay(e) };
}

/** Limitation des tentatives de connexion (NF-22) : au plus 5 échecs par minute et par poste. */
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 60_000;

/** Stockage clé-valeur (localStorage dans le navigateur, Map dans les tests). */
export interface KeyValue {
  get(key: string): string | null;
  /** Une valeur vide efface la clé. */
  set(key: string, value: string): void;
}

/** Stockage en mémoire, pour les tests et à défaut de stockage du navigateur. */
export function memoryKeyValue(): KeyValue {
  const data = new Map<string, string>();
  return { get: (k) => data.get(k) || null, set: (k, v) => { data.set(k, v); } };
}

/** Canal de notification entre instances (BroadcastChannel dans le navigateur). */
export interface Bus {
  post(message: string): void;
  listen(handler: (message: string) => void): void;
}

/** Exclusion mutuelle entre instances (Web Locks dans le navigateur). */
export type Lock = <T>(fn: () => Promise<T>) => Promise<T>;

/** Verrou au sein d'une seule instance : exécute les opérations l'une après l'autre. */
export function queueLock(): Lock {
  let tail: Promise<unknown> = Promise.resolve();
  return (fn) => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  };
}

const KEY = 'event-control:db';
const SESSION_KEY = 'event-control:session';

export class LocalStore implements EventStore {
  private listeners = new Map<string, Set<(s: EventSnapshot | null) => void>>();
  private failures: number[] = [];

  /**
   * @param storage données partagées par tous les postes
   * @param session utilisateur connecté sur ce poste
   */
  constructor(
    private storage: KeyValue,
    private bus: Bus | null,
    private lock: Lock = queueLock(),
    private session: KeyValue = memoryKeyValue(),
    private now: () => Date = () => new Date(),
  ) {
    bus?.listen((eventId) => this.emit(eventId));
  }

  // ── Accès au stockage ──────────────────────────────────────────────

  private read(): Db {
    const raw = this.storage.get(KEY);
    if (!raw) return structuredClone(EMPTY);
    try {
      const db = { ...structuredClone(EMPTY), ...JSON.parse(raw) as Db, version: 2 as const };
      for (const e of Object.values(db.events)) {
        e.privacy = normalizePrivacy(e.privacy, defaultPrivacy(db.organizations[e.orgId]?.name ?? ''));
        e.purgedAt ??= null;
        e.accessCode ??= null;
        e.requireApproval ??= false;
      }
      for (const p of Object.values(db.participants)) {
        p.status ??= 'accepted';
      }
      return db;
    }
    catch { return structuredClone(EMPTY); }
  }

  /** Lecture-modification-écriture sous verrou : aucune opération concurrente ne peut s'intercaler. */
  private async transaction<T>(eventIds: string[], fn: (db: Db) => T): Promise<T> {
    const result = await this.lock(async () => {
      const db = this.read();
      const r = fn(db);
      this.storage.set(KEY, JSON.stringify(db));
      return r;
    });
    for (const id of eventIds) { this.emit(id); this.bus?.post(id); }
    return result;
  }

  private snapshot(db: Db, eventId: string): EventSnapshot | null {
    const event = db.events[eventId];
    const user = this.sessionUser(db);
    const role = event && user ? this.eventRole(db, user.id, event) : null;
    if (!event || !role) return null;
    return {
      event,
      role,
      participants: Object.values(db.participants).filter((p) => p.eventId === eventId).sort(compareNames),
      passages: db.passages.filter((p) => p.eventId === eventId),
      refusals: db.refusals.filter((r) => r.eventId === eventId),
    };
  }

  private emit(eventId: string) {
    const set = this.listeners.get(eventId);
    if (!set?.size) return;
    const snap = this.snapshot(this.read(), eventId);
    set.forEach((l) => l(snap));
  }

  private nowIso() { return this.now().toISOString(); }

  // ── Droits (NF-20) ─────────────────────────────────────────────────

  private sessionUser(db: Db): StoredUser | null {
    const id = this.session.get(SESSION_KEY);
    return (id && db.users[id]) || null;
  }

  private roleIn(db: Db, userId: string, orgId: string): Role | null {
    return db.memberships.find((m) => m.userId === userId && m.orgId === orgId)?.role ?? null;
  }

  /** Rôle dans l'organisation de l'événement, ou agent s'il l'a rejoint avec son code (F-04). */
  private eventRole(db: Db, userId: string, event: EventInfo): Role | null {
    return this.roleIn(db, userId, event.orgId)
      ?? (db.eventAgents.some((a) => a.eventId === event.id && a.userId === userId) ? 'agent' : null);
  }

  private requireUser(db: Db): StoredUser {
    const user = this.sessionUser(db);
    if (!user) throw new StoreError('unauthenticated', 'Connectez-vous pour continuer');
    return user;
  }

  /** Utilisateur connecté, s'il a le droit `action` dans l'organisation. */
  private requireRole(db: Db, orgId: string, action: Action): StoredUser {
    const user = this.requireUser(db);
    const role = this.roleIn(db, user.id, orgId);
    if (!role) throw new StoreError('not-found', 'Organisation introuvable');
    if (!can(role, action)) throw new StoreError('forbidden', 'Votre rôle ne permet pas cette action');
    return user;
  }

  /** Pour qui n'est pas membre de son organisation, un événement n'existe pas (NF-24). */
  private requireEvent(db: Db, id: string, action: Action): EventInfo {
    const user = this.requireUser(db);
    const e = db.events[id];
    const role = e && this.eventRole(db, user.id, e);
    if (!e || !role) throw new StoreError('not-found', 'Événement introuvable');
    if (!can(role, action)) throw new StoreError('forbidden', 'Votre rôle ne permet pas cette action');
    return e;
  }

  private requireParticipant(db: Db, id: string, action: Action): Participant {
    const p = db.participants[id];
    if (!p) throw new StoreError('not-found', 'Participant introuvable');
    this.requireEvent(db, p.eventId, action);
    return p;
  }

  private emailTaken(db: Db, eventId: string, email: string, exceptId?: string) {
    const e = normEmail(email);
    return !!e && Object.values(db.participants).some((p) => p.eventId === eventId && p.id !== exceptId && p.email === e);
  }

  private buildParticipant(eventId: string, input: NewParticipant, status: Participant['status'] = 'accepted'): Participant {
    return {
      id: newId(), eventId,
      firstName: input.firstName.trim().slice(0, 100),
      lastName: input.lastName.trim().slice(0, 100),
      email: normEmail(input.email).slice(0, 320),
      phone: (input.phone ?? '').trim().slice(0, 40),
      company: (input.company ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
      typeId: input.typeId,
      token: newToken(), tokenRevoked: false,
      source: input.source, status, consentAt: input.consentAt ?? null, createdAt: this.nowIso(),
      inside: false, entryCount: 0, firstEntryAt: null, lastMoveAt: null,
    };
  }

  // ── Comptes et organisations ───────────────────────────────────────

  private sessionOf(db: Db, user: StoredUser): Session {
    return {
      user: { id: user.id, email: user.email, name: user.name },
      memberships: db.memberships
        .filter((m) => m.userId === user.id && db.organizations[m.orgId])
        .map((m) => ({ orgId: m.orgId, orgName: db.organizations[m.orgId]!.name, role: m.role }))
        .sort((a, b) => a.orgName.localeCompare(b.orgName, 'fr')),
      eventAccess: db.eventAgents
        .filter((a) => a.userId === user.id && db.events[a.eventId])
        .map((a) => db.events[a.eventId]!)
        .filter((e) => !this.roleIn(db, user.id, e.orgId))
        .map((e) => ({ eventId: e.id, eventName: e.name, startDate: e.startDate, endDate: e.endDate }))
        .sort((a, b) => b.startDate.localeCompare(a.startDate)),
    };
  }

  private member(db: Db, m: StoredMembership): Member {
    const u = db.users[m.userId]!;
    return { userId: u.id, email: u.email, name: u.name, role: m.role };
  }

  private newOrganization(db: Db, name: string, ownerId: string): Organization {
    const org: Organization = { id: newId(), name: name.trim().slice(0, 200), createdAt: this.nowIso() };
    if (!org.name) throw new StoreError('invalid', 'Le nom de l\'organisation est obligatoire');
    db.organizations[org.id] = org;
    db.memberships.push({ orgId: org.id, userId: ownerId, role: 'owner' });
    return org;
  }

  /** Vrai s'il reste un autre propriétaire que `userId`. */
  private hasOtherOwner(db: Db, orgId: string, userId: string) {
    return db.memberships.some((m) => m.orgId === orgId && m.userId !== userId && m.role === 'owner');
  }

  async getSession() {
    const db = this.read();
    const user = this.sessionUser(db);
    return user ? this.sessionOf(db, user) : null;
  }

  async signUp(input: SignUpInput) {
    const email = normEmail(input.email);
    if (!input.name.trim()) throw new StoreError('invalid', 'Le nom est obligatoire');
    if (!EMAIL.test(email)) throw new StoreError('invalid', 'Adresse email invalide');
    if (input.password.length < PASSWORD_MIN_LENGTH) {
      throw new StoreError('invalid', `Le mot de passe doit compter au moins ${PASSWORD_MIN_LENGTH} caractères`);
    }
    const passwordHash = await hashPassword(input.password);
    const user = await this.transaction([], (db) => {
      if (Object.values(db.users).some((u) => u.email === email)) {
        throw new StoreError('duplicate', 'Un compte existe déjà avec cette adresse email');
      }
      const u: StoredUser = { id: newId(), email, name: input.name.trim().slice(0, 100), passwordHash };
      db.users[u.id] = u;
      // Sans nom d'organisation : agent qui rejoindra un événement avec son code (F-04)
      if (input.organization.trim()) {
        const org = this.newOrganization(db, input.organization, u.id);
        // Événements créés avant l'arrivée des comptes : rattachés à la première organisation créée
        for (const e of Object.values(db.events)) if (!e.orgId) e.orgId = org.id;
      }
      return u;
    });
    this.session.set(SESSION_KEY, user.id);
    return (await this.getSession())!;
  }

  async signIn(email: string, password: string) {
    const t = this.now().getTime();
    this.failures = this.failures.filter((f) => t - f < FAILURE_WINDOW_MS);
    if (this.failures.length >= MAX_FAILURES) {
      throw new StoreError('forbidden', 'Trop de tentatives de connexion, réessayez dans une minute');
    }
    const user = Object.values(this.read().users).find((u) => u.email === normEmail(email));
    if (!user || !await verifyPassword(password, user.passwordHash)) {
      this.failures.push(t);
      throw new StoreError('unauthenticated', 'Email ou mot de passe incorrect');
    }
    this.failures = [];
    this.session.set(SESSION_KEY, user.id);
    return (await this.getSession())!;
  }

  async signOut() {
    this.session.set(SESSION_KEY, '');
  }

  async createOrganization(name: string) {
    await this.transaction([], (db) => { this.newOrganization(db, name, this.requireUser(db).id); });
    return (await this.getSession())!;
  }

  async listMembers(orgId: string) {
    const db = this.read();
    this.requireRole(db, orgId, 'members.manage');
    return db.memberships
      .filter((m) => m.orgId === orgId && db.users[m.userId])
      .map((m) => this.member(db, m))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  async addMember(orgId: string, email: string, role: Role) {
    return this.transaction([], (db) => {
      this.requireRole(db, orgId, 'members.manage');
      const user = Object.values(db.users).find((u) => u.email === normEmail(email));
      if (!user) throw new StoreError('not-found', 'Aucun compte avec cette adresse : la personne doit d\'abord créer le sien');
      if (this.roleIn(db, user.id, orgId)) throw new StoreError('duplicate', `${user.name} est déjà membre`);
      const m: StoredMembership = { orgId, userId: user.id, role };
      db.memberships.push(m);
      return this.member(db, m);
    });
  }

  async setMemberRole(orgId: string, userId: string, role: Role) {
    return this.transaction([], (db) => {
      this.requireRole(db, orgId, 'members.manage');
      const m = db.memberships.find((x) => x.orgId === orgId && x.userId === userId);
      if (!m) throw new StoreError('not-found', 'Membre introuvable');
      if (m.role === 'owner' && role !== 'owner' && !this.hasOtherOwner(db, orgId, userId)) {
        throw new StoreError('invalid', 'L\'organisation doit garder au moins un propriétaire');
      }
      m.role = role;
      return this.member(db, m);
    });
  }

  async removeMember(orgId: string, userId: string) {
    await this.transaction([], (db) => {
      this.requireRole(db, orgId, 'members.manage');
      if (!this.hasOtherOwner(db, orgId, userId) && this.roleIn(db, userId, orgId) === 'owner') {
        throw new StoreError('invalid', 'L\'organisation doit garder au moins un propriétaire');
      }
      db.memberships = db.memberships.filter((m) => !(m.orgId === orgId && m.userId === userId));
    });
  }

  // ── Événements ─────────────────────────────────────────────────────

  async listEvents(orgId: string) {
    const db = this.read();
    this.requireRole(db, orgId, 'scan');
    return Object.values(db.events)
      .filter((e) => e.orgId === orgId)
      .sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  async createEvent(orgId: string, input: NewEvent) {
    const name = input.name.trim().slice(0, 200);
    if (!name) throw new StoreError('invalid', 'Le nom de l\'événement est obligatoire');
    if (input.endDate < input.startDate) throw new StoreError('invalid', 'La date de fin précède la date de début');
    return this.transaction([], (db) => {
      this.requireRole(db, orgId, 'event.create');
      const event: EventInfo = {
        id: newId(), orgId, name, startDate: input.startDate, endDate: input.endDate,
        venue: (input.venue ?? '').trim(), capacity: input.capacity ?? 1000, thresholds: DEFAULT_THRESHOLDS,
        types: DEFAULT_TYPES, registrationOpen: false, createdAt: this.nowIso(),
        privacy: this.orgPrivacyOf(db, orgId), purgedAt: null, accessCode: null, requireApproval: false,
      };
      db.events[event.id] = event;
      return event;
    });
  }

  async updateEvent(id: string, patch: EventPatch) {
    return this.transaction([id], (db) => {
      const current = this.requireEvent(db, id, 'event.edit');
      const event: EventInfo = { ...current, ...patch, privacy: patch.privacy ? normalizePrivacy(patch.privacy, current.privacy) : current.privacy };
      if (!Number.isInteger(event.capacity) || event.capacity < 0) throw new StoreError('invalid', 'Jauge invalide');
      if (event.registrationOpen && current.purgedAt) throw new StoreError('closed', 'Les données de cet événement ont été purgées');
      if (event.registrationOpen && !privacyComplete(event.privacy)) {
        throw new StoreError('invalid', 'Renseignez le responsable du traitement et le contact pour les données personnelles avant d\'ouvrir les inscriptions');
      }
      db.events[id] = event;
      return event;
    });
  }

  async duplicateEvent(id: string, name: string) {
    const source = this.requireEvent(this.read(), id, 'event.create');
    const created = await this.createEvent(source.orgId, {
      name, startDate: source.startDate, endDate: source.endDate, venue: source.venue, capacity: source.capacity,
    });
    return this.updateEvent(created.id, { types: source.types, thresholds: source.thresholds, privacy: source.privacy });
  }

  async deleteEvent(id: string) {
    await this.transaction([id], (db) => {
      const event = this.requireEvent(db, id, 'event.delete');
      db.eventAgents = db.eventAgents.filter((a) => a.eventId !== id);
      // Bilan anonyme enregistré avant toute suppression de données (F-77)
      const count = event.purgedAt ? 0 : this.keepReport(db, event, 'deletion').registered;
      this.audit(db, event, 'event.delete', count);
      delete db.events[id];
      for (const p of Object.values(db.participants)) if (p.eventId === id) delete db.participants[p.id];
      db.passages = db.passages.filter((p) => p.eventId !== id);
      db.refusals = db.refusals.filter((r) => r.eventId !== id);
    });
  }

  // ── Participants ───────────────────────────────────────────────────

  async addParticipants(eventId: string, list: NewParticipant[]) {
    return this.transaction([eventId], (db) => {
      const event = this.requireEvent(db, eventId, 'participants.manage');
      this.requireNotPurged(event);
      const typeIds = new Set(event.types.map((t) => t.id));
      const added = list.map((input) => {
        if (!input.firstName.trim() && !input.lastName.trim()) throw new StoreError('invalid', 'Nom manquant');
        if (input.email && !EMAIL.test(input.email.trim())) throw new StoreError('invalid', `Email invalide : ${input.email}`);
        if (this.emailTaken(db, eventId, input.email)) throw new StoreError('duplicate', `${input.email} est déjà inscrit`);
        const p = this.buildParticipant(eventId, { ...input, typeId: typeIds.has(input.typeId) ? input.typeId : event.types[0]!.id });
        db.participants[p.id] = p;
        return p;
      });
      const imported = added.filter((p) => p.source === 'import').length;
      if (imported) this.audit(db, event, 'import', imported); // RG-09
      return added;
    });
  }

  async updateParticipant(id: string, patch: ParticipantPatch) {
    const eventId = this.requireParticipant(this.read(), id, 'participants.manage').eventId;
    return this.transaction([eventId], (db) => {
      const current = this.requireParticipant(db, id, 'participants.manage');
      const next = { ...current, ...patch };
      if (patch.email !== undefined) {
        next.email = normEmail(patch.email);
        if (next.email && !EMAIL.test(next.email)) throw new StoreError('invalid', 'Email invalide');
        if (this.emailTaken(db, eventId, next.email, id)) throw new StoreError('duplicate', `${next.email} est déjà inscrit`);
      }
      db.participants[id] = next;
      return next;
    });
  }

  async deleteParticipant(id: string) {
    const eventId = this.requireParticipant(this.read(), id, 'participants.manage').eventId;
    await this.transaction([eventId], (db) => {
      const p = this.requireParticipant(db, id, 'participants.manage');
      this.audit(db, db.events[p.eventId]!, 'participant.delete', 1); // NF-34
      delete db.participants[id];
      db.passages = db.passages.filter((x) => x.participantId !== id); // RG-08
    });
  }

  async revokeToken(id: string) {
    const eventId = this.requireParticipant(this.read(), id, 'participants.manage').eventId;
    return this.transaction([eventId], (db) => {
      const p = { ...this.requireParticipant(db, id, 'participants.manage'), token: newToken(), tokenRevoked: false };
      db.participants[id] = p;
      return p;
    });
  }

  async acceptParticipant(id: string) {
    const eventId = this.requireParticipant(this.read(), id, 'participants.manage').eventId;
    return this.transaction([eventId], (db) => {
      const p = { ...this.requireParticipant(db, id, 'participants.manage'), status: 'accepted' as const };
      db.participants[id] = p;
      return p;
    });
  }

  // ── Scan ───────────────────────────────────────────────────────────

  async scan(eventId: string, token: string, direction: 'in' | 'out', method: ScanMethod, stationId: string): Promise<ScanResult> {
    return this.transaction([eventId], (db) => {
      this.requireNotPurged(this.requireEvent(db, eventId, 'scan'));
      const agent = this.requireUser(db);
      const at = this.nowIso();
      const participant = Object.values(db.participants).find((p) => p.eventId === eventId && p.token === token.trim());
      const decision = decideScan(participant, direction);
      const base = { eventId, at, agentId: agent.id, agentName: agent.name, stationId, method };

      if (decision.result === 'refused') {
        db.refusals.push({
          ...base, id: newId(), reason: decision.reason,
          participantId: participant?.id ?? null,
          sample: decision.reason === 'unknown' ? token.trim().slice(0, 12) : '',
        });
      }
      const applied = participant ? applyScan(participant, decision, { ...base, origin: 'online', passageId: newId() }) : null;
      if (applied) {
        db.participants[applied.participant.id] = applied.participant;
        db.passages.push(applied.passage);
      }
      return { decision, participant: applied?.participant ?? participant ?? null, passage: applied?.passage ?? null };
    });
  }

  async closeDay(eventId: string, stationId: string) {
    return this.transaction([eventId], (db) => {
      this.requireNotPurged(this.requireEvent(db, eventId, 'day.close'));
      const agent = this.requireUser(db);
      const at = this.nowIso();
      let count = 0;
      for (const p of Object.values(db.participants)) {
        if (p.eventId !== eventId || !p.inside) continue;
        db.participants[p.id] = { ...p, inside: false, lastMoveAt: at };
        db.passages.push({
          id: newId(), eventId, participantId: p.id, typeId: p.typeId, direction: 'out', at,
          agentId: agent.id, agentName: agent.name, stationId,
          method: 'manual', origin: 'closing', offlineDuplicate: false,
        });
        count++;
      }
      return count;
    });
  }

  async syncOffline(eventId: string, batch: SyncBatch): Promise<SyncResult> {
    if (batch.passages.length + batch.refusals.length > SYNC_MAX) throw new StoreError('invalid', 'Lot trop volumineux');
    return this.transaction([eventId], (db) => {
      this.requireNotPurged(this.requireEvent(db, eventId, 'scan'));
      const agent = this.requireUser(db);
      const nowMs = this.now().getTime();
      const base = { eventId, agentId: agent.id, agentName: agent.name, stationId: String(batch.stationId ?? '').slice(0, 60) };
      const status = new Map<string, SyncStatus>();
      let newDuplicates = 0;

      // Passages regroupés par participant, puis journal de chacun rejoué (F-63)
      const byParticipant = new Map<string, Passage[]>();
      for (const raw of batch.passages) {
        const p = parseOfflinePassage(raw, nowMs);
        const participant = p && db.participants[p.participantId];
        const elsewhere = p && db.passages.some((x) => x.id === p.id && x.participantId !== p.participantId);
        if (!p || !participant || participant.eventId !== eventId || elsewhere) {
          status.set(String((raw as { id?: unknown })?.id ?? ''), 'rejected');
          continue;
        }
        const list = byParticipant.get(p.participantId) ?? [];
        list.push({ ...base, ...p, typeId: participant.typeId, origin: 'offline', offlineDuplicate: false });
        byParticipant.set(p.participantId, list);
      }
      for (const [participantId, received] of byParticipant) {
        const known = db.passages.filter((x) => x.participantId === participantId);
        const r = reconcile(db.participants[participantId]!, known, received);
        const changed = new Map(r.changed.map((x) => [x.id, x]));
        db.passages = db.passages.map((x) => changed.get(x.id) ?? x).concat(r.added);
        db.participants[participantId] = r.participant;
        newDuplicates += r.newDuplicates;
        const flags = new Map([...known.map((x) => changed.get(x.id) ?? x), ...r.added].map((x) => [x.id, x.offlineDuplicate]));
        for (const p of received) status.set(p.id, flags.get(p.id) ? 'duplicate' : 'counted');
      }

      for (const raw of batch.refusals) {
        const r = parseOfflineRefusal(raw, nowMs);
        if (r && !db.refusals.some((x) => x.id === r.id)) db.refusals.push({ ...base, ...r });
      }
      return {
        passages: batch.passages.map((raw) => {
          const id = String((raw as { id?: unknown })?.id ?? '');
          return { id, status: status.get(id) ?? 'rejected' };
        }),
        newDuplicates,
      };
    });
  }

  // ── Public ─────────────────────────────────────────────────────────

  async getRegistrationInfo(eventId: string): Promise<RegistrationInfo | null> {
    const e = this.read().events[eventId];
    return e ? { eventName: e.name, types: e.types, open: e.registrationOpen && !e.purgedAt, privacy: publicPrivacy(e) } : null;
  }

  async register(eventId: string, form: RegistrationForm) {
    if (form.website?.trim()) throw new StoreError('invalid', 'Inscription refusée'); // champ piège rempli : robot (F-36)
    if (!form.consent) throw new StoreError('invalid', 'Le consentement est obligatoire');
    if (!form.lastName.trim()) throw new StoreError('invalid', 'Le nom est obligatoire');
    if (!EMAIL.test(form.email.trim())) throw new StoreError('invalid', 'Adresse email invalide');
    return this.transaction([eventId], (db) => {
      const event = db.events[eventId];
      if (!event || !event.registrationOpen || event.purgedAt) throw new StoreError('closed', 'Les inscriptions sont fermées');
      if (!event.types.some((t) => t.id === form.typeId)) throw new StoreError('invalid', 'Profil invalide');
      if (this.emailTaken(db, eventId, form.email)) throw new StoreError('duplicate', 'Cette adresse email est déjà inscrite');
      const { website: _trap, ...fields } = form;
      const p = this.buildParticipant(eventId, { ...fields, source: 'form', consentAt: this.nowIso() }, event.requireApproval ? 'pending' : 'accepted');
      db.participants[p.id] = p;
      return { token: p.token };
    });
  }

  async getAccessPage(token: string): Promise<AccessPage | null> {
    const db = this.read();
    const p = Object.values(db.participants).find((x) => x.token === token && !x.tokenRevoked);
    const e = p && db.events[p.eventId];
    if (!p || !e) return null;
    return {
      eventName: e.name, startDate: e.startDate, endDate: e.endDate, venue: e.venue,
      firstName: p.firstName, lastName: p.lastName, company: p.company,
      type: e.types.find((t) => t.id === p.typeId) ?? null, entryCount: p.entryCount,
      // Pas de QR code tant que l'inscription attend sa validation (F-37)
      token: p.status === 'pending' ? '' : p.token, status: p.status,
      privacy: publicPrivacy(e),
    };
  }

  // ── Agents par code d'accès (F-04) ─────────────────────────────────

  async joinEvent(code: string) {
    const t = this.now().getTime();
    this.failures = this.failures.filter((x) => t - x < FAILURE_WINDOW_MS);
    if (this.failures.length >= MAX_FAILURES) throw new StoreError('forbidden', 'Trop de tentatives, réessayez dans une minute');
    const normalized = code.trim().toUpperCase().replace(/[\s-]/g, '');
    const eventId = await this.transaction([], (db) => {
      const user = this.requireUser(db);
      const event = normalized && Object.values(db.events).find((e) => e.accessCode === normalized && !e.purgedAt);
      if (!event) { this.failures.push(t); throw new StoreError('not-found', 'Code d\'accès inconnu ou désactivé'); }
      if (!this.eventRole(db, user.id, event)) db.eventAgents.push({ eventId: event.id, userId: user.id });
      return event.id;
    });
    this.emit(eventId);
    return (await this.getSession())!;
  }

  async setAccessCode(eventId: string, enabled: boolean) {
    return this.transaction([eventId], (db) => {
      const event = this.requireEvent(db, eventId, 'event.edit');
      if (enabled && event.purgedAt) throw new StoreError('closed', 'Les données de cet événement ont été purgées');
      let code: string | null = null;
      while (enabled && (!code || Object.values(db.events).some((e) => e.accessCode === code))) code = newAccessCode();
      // Désactiver le code retire l'accès de tous ceux qui l'ont utilisé (code divulgué)
      if (!enabled) db.eventAgents = db.eventAgents.filter((a) => a.eventId !== eventId);
      return (db.events[eventId] = { ...event, accessCode: code });
    });
  }

  async listEventAgents(eventId: string): Promise<Member[]> {
    const db = this.read();
    this.requireEvent(db, eventId, 'event.edit');
    return db.eventAgents
      .filter((a) => a.eventId === eventId && db.users[a.userId])
      .map((a) => { const u = db.users[a.userId]!; return { userId: u.id, email: u.email, name: u.name, role: 'agent' as const }; })
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }

  // ── Protection des données (NF-32 à NF-34, F-77, RG-09) ────────────

  private orgPrivacyOf(db: Db, orgId: string): PrivacyPolicy {
    return db.orgPrivacy[orgId] ?? defaultPrivacy(db.organizations[orgId]?.name ?? '');
  }

  private requireNotPurged(event: EventInfo) {
    if (event.purgedAt) throw new StoreError('closed', 'Les données de cet événement ont été purgées');
  }

  /** Trace d'une action sur des données personnelles ; sans utilisateur connecté : purge automatique. */
  private audit(db: Db, event: EventInfo, action: AuditAction, count: number, detail = '') {
    const user = this.sessionUser(db);
    db.audit.push({
      id: newId(), orgId: event.orgId, eventId: event.id, eventName: event.name,
      actorId: user?.id ?? '', actorName: user?.name ?? 'Purge automatique', action, count, detail, at: this.nowIso(),
    });
  }

  private keepReport(db: Db, event: EventInfo, reason: ReportReason): EventReport {
    const report = anonymousReport(
      event,
      Object.values(db.participants).filter((p) => p.eventId === event.id),
      db.passages.filter((p) => p.eventId === event.id),
      db.refusals.filter((r) => r.eventId === event.id),
      this.nowIso(), reason,
    );
    db.reports.push({ ...report, orgId: event.orgId });
    return report;
  }

  private purge(db: Db, event: EventInfo, automatic: boolean): EventReport {
    const report = this.keepReport(db, event, 'purge');
    for (const p of Object.values(db.participants)) if (p.eventId === event.id) delete db.participants[p.id];
    db.passages = db.passages.filter((p) => p.eventId !== event.id);
    db.refusals = db.refusals.filter((r) => r.eventId !== event.id);
    db.events[event.id] = { ...event, purgedAt: report.generatedAt, registrationOpen: false };
    if (automatic) {
      db.audit.push({
        id: newId(), orgId: event.orgId, eventId: event.id, eventName: event.name, actorId: '', actorName: 'Purge automatique',
        action: 'purge', count: report.registered, detail: 'Échéance de conservation', at: this.nowIso(),
      });
    } else {
      this.audit(db, event, 'purge', report.registered, 'Purge demandée');
    }
    return report;
  }

  async purgeEvent(eventId: string) {
    return this.transaction([eventId], (db) => {
      const event = this.requireEvent(db, eventId, 'event.delete');
      this.requireNotPurged(event);
      return this.purge(db, event, false);
    });
  }

  /** Purge automatique des événements arrivés à échéance (NF-33) ; lancée au démarrage de l'application. */
  async purgeDue(today = parisDay(this.now())): Promise<number> {
    const due = Object.values(this.read().events).filter((e) => retentionState(e, today) === 'due').map((e) => e.id);
    if (!due.length) return 0;
    await this.transaction(due, (db) => {
      for (const id of due) if (db.events[id] && !db.events[id]!.purgedAt) this.purge(db, db.events[id]!, true);
    });
    return due.length;
  }

  async getOrgPrivacy(orgId: string) {
    const db = this.read();
    this.requireRole(db, orgId, 'scan');
    return this.orgPrivacyOf(db, orgId);
  }

  async setOrgPrivacy(orgId: string, privacy: Partial<PrivacyPolicy>) {
    return this.transaction([], (db) => {
      this.requireRole(db, orgId, 'event.edit');
      return (db.orgPrivacy[orgId] = normalizePrivacy(privacy, this.orgPrivacyOf(db, orgId)));
    });
  }

  async listReports(orgId: string): Promise<EventReport[]> {
    const db = this.read();
    this.requireRole(db, orgId, 'stats.export');
    return db.reports.filter((r) => r.orgId === orgId).map(({ orgId: _o, ...r }) => r).reverse();
  }

  async listAudit(orgId: string): Promise<AuditEntry[]> {
    const db = this.read();
    this.requireRole(db, orgId, 'stats.export');
    return db.audit.filter((a) => a.orgId === orgId).reverse();
  }

  async logExport(eventId: string, kind: ExportKind, count: number) {
    if (!EXPORT_KINDS.includes(kind)) throw new StoreError('invalid', 'Export inconnu');
    await this.transaction([], (db) => {
      this.audit(db, this.requireEvent(db, eventId, 'stats.export'), 'export', Math.max(0, Math.floor(count)), EXPORT_LABELS[kind]);
    });
  }

  async exportParticipant(id: string): Promise<ParticipantRecord> {
    const eventId = this.requireParticipant(this.read(), id, 'participants.manage').eventId;
    return this.transaction([], (db) => {
      const participant = this.requireParticipant(db, id, 'participants.manage');
      const event = db.events[eventId]!;
      this.audit(db, event, 'participant.export', 1); // NF-34
      return {
        eventName: event.name,
        participant,
        passages: db.passages.filter((p) => p.participantId === id).sort((a, b) => a.at.localeCompare(b.at))
          .map(({ direction, at, stationId, method, origin, offlineDuplicate }) => ({ direction, at, stationId, method, origin, offlineDuplicate })),
        refusals: db.refusals.filter((r) => r.participantId === id).sort((a, b) => a.at.localeCompare(b.at))
          .map(({ reason, at, stationId }) => ({ reason, at, stationId })),
        exportedAt: this.nowIso(),
      };
    });
  }

  // ── Temps réel ─────────────────────────────────────────────────────

  subscribe(eventId: string, listener: (s: EventSnapshot | null) => void) {
    const set = this.listeners.get(eventId) ?? new Set();
    set.add(listener);
    this.listeners.set(eventId, set);
    listener(this.snapshot(this.read(), eventId));
    return () => { set.delete(listener); };
  }
}

/**
 * Session propre à l'onglet (deux onglets peuvent être deux agents différents),
 * recopiée dans localStorage pour qu'un nouvel onglet reprenne la dernière connexion.
 */
export function browserSession(): KeyValue {
  return {
    get: (k) => { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => {
      try {
        if (v) { sessionStorage.setItem(k, v); localStorage.setItem(k, v); }
        else { sessionStorage.removeItem(k); localStorage.removeItem(k); }
      } catch { /* stockage indisponible : la session ne survit pas au rechargement */ }
    },
  };
}

/** Instance pour le navigateur : localStorage, BroadcastChannel et Web Locks. */
export function createBrowserStore(): LocalStore {
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('event-control') : null;
  const lock: Lock = typeof navigator !== 'undefined' && navigator.locks
    ? (fn) => navigator.locks.request('event-control-db', fn) as ReturnType<typeof fn>
    : queueLock();
  return new LocalStore(
    { get: (k) => localStorage.getItem(k), set: (k, v) => localStorage.setItem(k, v) },
    channel && {
      post: (m) => channel.postMessage(m),
      listen: (h) => channel.addEventListener('message', (e) => h(String(e.data))),
    },
    lock,
    browserSession(),
  );
}
