// Implémentation serveur de EventStore : PocketBase (server/). Les lectures passent par l'API
// des collections, protégée par les règles d'accès ; toutes les écritures passent par les
// routes /api/ec, qui appliquent les droits et l'atomicité du scan côté serveur (NF-20, F-53).
import PocketBase, { AsyncAuthStore, ClientResponseError, type RecordModel } from 'pocketbase';
import type { Role } from '../domain/access';
import { DEFAULT_TYPES } from '../domain/colors';
import { DEFAULT_THRESHOLDS } from '../domain/gauge';
import { defaultPrivacy, normalizePrivacy, type AuditEntry, type ExportKind, type PrivacyPolicy } from '../domain/privacy';
import type { EventReport } from '../domain/report';
import { normalizeFields } from '../domain/fields';
import { normalizeBranding } from '../domain/branding';
import {
  compareNames, type Direction, type EventInfo, type Participant, type Passage, type Refusal, type ScanMethod,
} from '../domain/model';
import { memoryKeyValue, type KeyValue } from './localStore';
import {
  StoreError,
  type AccessPage, type EventPatch, type EventSnapshot, type EventStore, type Member, type NewEvent,
  type NewParticipant, type ParticipantPatch, type ParticipantRecord, type RegistrationForm, type RegistrationInfo, type ScanResult,
  type Session, type SignUpInput, type SyncBatch, type SyncResult,
} from './store';

const AUTH_KEY = 'event-control:pb-auth';

// ─── Conversion des enregistrements ──────────────────────────────────

const toEvent = (r: RecordModel): EventInfo => ({
  id: r.id, orgId: r.org, name: r.name, startDate: r.startDate, endDate: r.endDate, venue: r.venue,
  capacity: r.capacity, thresholds: r.thresholds ?? DEFAULT_THRESHOLDS, types: r.types ?? DEFAULT_TYPES,
  registrationOpen: r.registrationOpen, createdAt: r.createdAt,
  privacy: normalizePrivacy(r.privacy, defaultPrivacy()), purgedAt: r.purgedAt || null, accessCode: r.accessCode || null, requireApproval: !!r.requireApproval, fields: normalizeFields(r.fields), branding: normalizeBranding(r.branding),
});

const toParticipant = (r: RecordModel): Participant => ({
  id: r.id, eventId: r.event, firstName: r.firstName, lastName: r.lastName, email: r.email, phone: r.phone,
  company: r.company, typeId: r.typeId, token: r.token, tokenRevoked: r.tokenRevoked, source: r.source,
  status: r.status === 'pending' ? 'pending' : 'accepted', answers: r.answers ?? {},
  consentAt: r.consentAt || null, createdAt: r.createdAt, inside: r.inside, entryCount: r.entryCount,
  firstEntryAt: r.firstEntryAt || null, lastMoveAt: r.lastMoveAt || null,
});

const toPassage = (r: RecordModel): Passage => ({
  id: r.id, eventId: r.event, participantId: r.participant, typeId: r.typeId, direction: r.direction, at: r.at,
  agentId: r.agentId, agentName: r.agentName, stationId: r.stationId, method: r.method, origin: r.origin,
  offlineDuplicate: r.offlineDuplicate,
});

const toRefusal = (r: RecordModel): Refusal => ({
  id: r.id, eventId: r.event, reason: r.reason, at: r.at, agentId: r.agentId, agentName: r.agentName,
  stationId: r.stationId, method: r.method, participantId: r.participantId || null, sample: r.sample,
});

// ─── Erreurs ─────────────────────────────────────────────────────────

const CODES: readonly StoreError['code'][] = ['not-found', 'closed', 'duplicate', 'invalid', 'unauthenticated', 'forbidden'];
const BY_STATUS: Record<number, StoreError['code']> = { 400: 'invalid', 401: 'unauthenticated', 403: 'forbidden', 404: 'not-found', 409: 'duplicate', 429: 'forbidden' };

/** Erreur du serveur convertie en StoreError ; le code métier est la clé de `data` (voir server/src). */
function toStoreError(err: unknown): unknown {
  if (!(err instanceof ClientResponseError)) return err;
  // Réseau coupé, délai dépassé, ou serveur indisponible derrière son relais
  if (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504) {
    return new StoreError('unreachable', 'Serveur injoignable : vérifiez la connexion');
  }
  if (err.status === 429) return new StoreError('forbidden', 'Trop de tentatives, réessayez dans une minute');
  const data = (err.response?.data ?? {}) as Record<string, unknown>;
  const code = CODES.find((c) => c in data) ?? BY_STATUS[err.status] ?? 'invalid';
  const message = String(err.response?.message ?? 'Une erreur est survenue').replace(/\.$/, '');
  return new StoreError(code, message);
}

// ─── Stockage ────────────────────────────────────────────────────────

export class PocketStore implements EventStore {
  readonly pb: PocketBase;
  private session: Session | null = null;

  /** @param session conservation du jeton de connexion de ce poste */
  constructor(url: string, session: KeyValue = memoryKeyValue()) {
    this.pb = new PocketBase(url, new AsyncAuthStore({
      save: async (serialized) => session.set(AUTH_KEY, serialized),
      clear: async () => session.set(AUTH_KEY, ''),
      initial: session.get(AUTH_KEY) ?? undefined,
    }));
    this.pb.autoCancellation(false);
  }

  private async call<T>(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<T> {
    try { return await this.pb.send<T>(path, { method, body, ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) }); }
    catch (err) { throw toStoreError(err); }
  }

  /** Le serveur répond-il ? Sert au poste hors ligne pour détecter le retour du réseau. */
  async reachable(timeoutMs = 3000): Promise<boolean> {
    try { await this.pb.health.check({ signal: AbortSignal.timeout(timeoutMs) }); return true; }
    catch { return false; }
  }

  private async read<T>(fn: () => Promise<T>): Promise<T> {
    try { return await fn(); }
    catch (err) { throw toStoreError(err); }
  }

  private async currentSession(): Promise<Session> {
    const s = this.session ?? await this.getSession();
    if (!s) throw new StoreError('unauthenticated', 'Connectez-vous pour continuer');
    return s;
  }

  private async requireMember(orgId: string): Promise<Role> {
    const m = (await this.currentSession()).memberships.find((x) => x.orgId === orgId);
    if (!m) throw new StoreError('not-found', 'Organisation introuvable');
    return m.role;
  }

  // ── Comptes et organisations ───────────────────────────────────────

  async getSession() {
    if (!this.pb.authStore.isValid) { this.session = null; return null; }
    try {
      this.session = await this.call<Session>('GET', '/api/ec/session');
    } catch (err) {
      if (err instanceof StoreError && err.code === 'unauthenticated') { this.pb.authStore.clear(); this.session = null; }
      else throw err;
    }
    return this.session;
  }

  async signUp(input: SignUpInput) {
    await this.call('POST', '/api/ec/signup', input);
    return this.signIn(input.email, input.password);
  }

  async signIn(email: string, password: string) {
    try {
      await this.pb.collection('users').authWithPassword(email.trim().toLowerCase(), password);
    } catch (err) {
      const e = toStoreError(err);
      if (e instanceof StoreError && e.code === 'invalid') throw new StoreError('unauthenticated', 'Email ou mot de passe incorrect');
      throw e;
    }
    return (await this.getSession())!;
  }

  async signOut() {
    this.pb.authStore.clear();
    this.session = null;
    await this.pb.realtime.unsubscribe().catch(() => undefined);
  }

  async createOrganization(name: string) {
    this.session = await this.call<Session>('POST', '/api/ec/orgs', { name });
    return this.session;
  }

  listMembers(orgId: string) {
    return this.call<Member[]>('GET', `/api/ec/orgs/${encodeURIComponent(orgId)}/members`);
  }

  addMember(orgId: string, email: string, role: Role) {
    return this.call<Member>('POST', `/api/ec/orgs/${encodeURIComponent(orgId)}/members`, { email, role });
  }

  setMemberRole(orgId: string, userId: string, role: Role) {
    return this.call<Member>('PATCH', `/api/ec/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`, { role });
  }

  async removeMember(orgId: string, userId: string) {
    await this.call('DELETE', `/api/ec/orgs/${encodeURIComponent(orgId)}/members/${encodeURIComponent(userId)}`);
  }

  // ── Événements ─────────────────────────────────────────────────────

  async listEvents(orgId: string) {
    await this.requireMember(orgId);
    const records = await this.read(() => this.pb.collection('events').getFullList({
      filter: this.pb.filter('org = {:org}', { org: orgId }), sort: '-startDate',
    }));
    return records.map(toEvent);
  }

  createEvent(orgId: string, input: NewEvent) {
    return this.call<EventInfo>('POST', `/api/ec/orgs/${encodeURIComponent(orgId)}/events`, input);
  }

  updateEvent(id: string, patch: EventPatch) {
    return this.call<EventInfo>('PATCH', `/api/ec/events/${encodeURIComponent(id)}`, patch);
  }

  duplicateEvent(id: string, name: string) {
    return this.call<EventInfo>('POST', `/api/ec/events/${encodeURIComponent(id)}/duplicate`, { name });
  }

  async deleteEvent(id: string) {
    await this.call('DELETE', `/api/ec/events/${encodeURIComponent(id)}`);
  }

  // ── Participants ───────────────────────────────────────────────────

  addParticipants(eventId: string, list: NewParticipant[]) {
    return this.call<Participant[]>('POST', `/api/ec/events/${encodeURIComponent(eventId)}/participants`, { list });
  }

  updateParticipant(id: string, patch: ParticipantPatch) {
    return this.call<Participant>('PATCH', `/api/ec/participants/${encodeURIComponent(id)}`, patch);
  }

  async deleteParticipant(id: string) {
    await this.call('DELETE', `/api/ec/participants/${encodeURIComponent(id)}`);
  }

  acceptParticipant(id: string) {
    return this.call<Participant>('POST', `/api/ec/participants/${encodeURIComponent(id)}/accept`);
  }

  revokeToken(id: string) {
    return this.call<Participant>('POST', `/api/ec/participants/${encodeURIComponent(id)}/token`);
  }

  // ── Scan ───────────────────────────────────────────────────────────

  /** Sans réponse en 2 secondes, le scan échoue en `unreachable` : le poste le valide alors hors ligne. */
  scan(eventId: string, token: string, direction: Direction, method: ScanMethod, stationId: string) {
    return this.call<ScanResult>('POST', `/api/ec/events/${encodeURIComponent(eventId)}/scan`, { token, direction, method, stationId }, 2000);
  }

  async closeDay(eventId: string, stationId: string) {
    return (await this.call<{ count: number }>('POST', `/api/ec/events/${encodeURIComponent(eventId)}/close-day`, { stationId })).count;
  }

  syncOffline(eventId: string, batch: SyncBatch) {
    return this.call<SyncResult>('POST', `/api/ec/events/${encodeURIComponent(eventId)}/sync`, batch, 15_000);
  }

  // ── Public ─────────────────────────────────────────────────────────

  private async orNull<T>(fn: () => Promise<T>): Promise<T | null> {
    try { return await fn(); }
    catch (err) { if (err instanceof StoreError && err.code === 'not-found') return null; throw err; }
  }

  getRegistrationInfo(eventId: string) {
    return this.orNull(() => this.call<RegistrationInfo>('GET', `/api/ec/public/events/${encodeURIComponent(eventId)}`));
  }

  register(eventId: string, form: RegistrationForm) {
    return this.call<{ token: string }>('POST', `/api/ec/public/events/${encodeURIComponent(eventId)}/register`, form);
  }

  getAccessPage(token: string) {
    return this.orNull(() => this.call<AccessPage>('GET', `/api/ec/public/access/${encodeURIComponent(token)}`));
  }

  // ── Agents par code d'accès ────────────────────────────────────────

  async joinEvent(code: string) {
    this.session = await this.call<Session>('POST', '/api/ec/join', { code });
    return this.session;
  }

  setAccessCode(eventId: string, enabled: boolean) {
    return this.call<EventInfo>('PUT', `/api/ec/events/${encodeURIComponent(eventId)}/access-code`, { enabled });
  }

  listEventAgents(eventId: string) {
    return this.call<Member[]>('GET', `/api/ec/events/${encodeURIComponent(eventId)}/agents`);
  }

  // ── Protection des données ─────────────────────────────────────────

  getOrgPrivacy(orgId: string) {
    return this.call<PrivacyPolicy>('GET', `/api/ec/orgs/${encodeURIComponent(orgId)}/privacy`);
  }

  setOrgPrivacy(orgId: string, privacy: Partial<PrivacyPolicy>) {
    return this.call<PrivacyPolicy>('PUT', `/api/ec/orgs/${encodeURIComponent(orgId)}/privacy`, privacy);
  }

  purgeEvent(eventId: string) {
    return this.call<EventReport>('POST', `/api/ec/events/${encodeURIComponent(eventId)}/purge`);
  }

  listReports(orgId: string) {
    return this.call<EventReport[]>('GET', `/api/ec/orgs/${encodeURIComponent(orgId)}/reports`);
  }

  listAudit(orgId: string) {
    return this.call<AuditEntry[]>('GET', `/api/ec/orgs/${encodeURIComponent(orgId)}/audit`);
  }

  async logExport(eventId: string, kind: ExportKind, count: number) {
    await this.call('POST', `/api/ec/events/${encodeURIComponent(eventId)}/export-log`, { kind, count });
  }

  exportParticipant(id: string) {
    return this.call<ParticipantRecord>('GET', `/api/ec/participants/${encodeURIComponent(id)}/export`);
  }

  // ── Temps réel ─────────────────────────────────────────────────────

  subscribe(eventId: string, listener: (s: EventSnapshot | null) => void) {
    let closed = false;
    let ready = false;
    let event: EventInfo | null = null;
    let role: Role | null = null;
    const participants = new Map<string, Participant>();
    const passages = new Map<string, Passage>();
    const refusals = new Map<string, Refusal>();

    // Plusieurs messages arrivent pour un même scan (participant, passage) : un seul envoi
    let pending: ReturnType<typeof setTimeout> | undefined;
    const emit = () => {
      if (closed || !ready || pending) return;
      pending = setTimeout(() => {
        pending = undefined;
        if (closed) return;
        listener(event && role ? {
          event, role,
          participants: [...participants.values()].sort(compareNames),
          passages: [...passages.values()].sort((a, b) => a.at.localeCompare(b.at)),
          refusals: [...refusals.values()].sort((a, b) => a.at.localeCompare(b.at)),
        } : null);
      }, 30);
    };

    const filter = this.pb.filter('event = {:event}', { event: eventId });
    // Enregistrements reçus en direct pendant un chargement : plus récents que ceux chargés
    const touched = new Set<string>();
    const follow = <T extends { id: string }>(collection: string, map: Map<string, T>, convert: (r: RecordModel) => T) =>
      this.pb.collection(collection).subscribe('*', (e) => {
        touched.add(e.record.id);
        if (e.action === 'delete') map.delete(e.record.id); else map.set(e.record.id, convert(e.record));
        emit();
      }, { filter });

    // Abonnements d'abord, chargement ensuite : aucun changement ne peut passer entre les deux
    const subscriptions = [
      this.pb.collection('events').subscribe(eventId, (e) => { touched.add(eventId); event = e.action === 'delete' ? null : toEvent(e.record); emit(); }),
      follow('participants', participants, toParticipant),
      follow('passages', passages, toPassage),
      follow('refusals', refusals, toRefusal),
    ];
    for (const s of subscriptions) s.catch(() => undefined); // l'échec est traité par load()

    // Les changements survenus sans connexion au temps réel sont perdus : tout est rechargé à chaque
    // connexion qui suit le chargement. C'est le cas après une coupure, mais aussi quand l'abonnement est
    // pris pendant une reconnexion : le client PocketBase ne l'attend pas, et le chargement la précède.
    let failed = false;
    const reconnected = this.pb.realtime.subscribe('PB_CONNECT', () => {
      if (ready && !closed) load(true).then(() => { failed = false; emit(); }, () => undefined);
    });
    reconnected.catch(() => undefined);

    const load = async (reload = false) => {
      touched.clear();
      await Promise.all(subscriptions);
      const list = { filter, batch: 1000 };
      const [ev, parts, pass, refs, session] = await Promise.all([
        this.pb.collection('events').getOne(eventId),
        this.pb.collection('participants').getFullList(list),
        this.pb.collection('passages').getFullList(list),
        this.pb.collection('refusals').getFullList(list),
        this.getSession(), // appartenances à jour : un rôle a pu changer depuis la connexion
      ]);
      if (!touched.has(eventId)) event = toEvent(ev);
      const merge = <T>(map: Map<string, T>, records: RecordModel[], convert: (r: RecordModel) => T) => {
        const loaded = new Set(records.map((r) => r.id));
        if (reload) for (const id of [...map.keys()]) if (!loaded.has(id) && !touched.has(id)) map.delete(id);
        for (const r of records) if (!touched.has(r.id)) map.set(r.id, convert(r));
      };
      merge(participants, parts, toParticipant);
      merge(passages, pass, toPassage);
      merge(refusals, refs, toRefusal);
      role = session?.memberships.find((m) => m.orgId === event!.orgId)?.role
        ?? (session?.eventAccess.some((a) => a.eventId === eventId) ? 'agent' : null); // rejoint avec son code (F-04)
    };

    // Événement introuvable ou inaccessible : null. Toute autre erreur (réseau, serveur surchargé,
    // limitation des requêtes) est passagère : nouvel essai, de plus en plus espacé, sans rien transmettre
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = (delayMs: number) => {
      load(failed).then(
        () => { failed = false; ready = true; emit(); },
        (err) => {
          failed = true;
          if (err instanceof ClientResponseError && (err.status === 404 || err.status === 403)) { event = null; ready = true; emit(); return; }
          if (!closed) retry = setTimeout(() => attempt(Math.min(delayMs * 2, 30_000)), delayMs);
        },
      );
    };
    attempt(1000);

    return () => {
      closed = true;
      clearTimeout(pending);
      clearTimeout(retry);
      for (const s of [...subscriptions, reconnected]) s.then((unsubscribe) => unsubscribe()).catch(() => undefined);
    };
  }
}
