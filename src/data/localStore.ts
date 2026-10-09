// Implémentation locale de EventStore : données dans le stockage du navigateur,
// synchronisation en direct entre onglets (deux onglets = deux postes de scan).
// Sert à la démonstration et préfigure le mode hors ligne (lot 2).
import type { EventInfo, Participant, Passage, Refusal, ScanMethod } from '../domain/model';
import { applyScan, decideScan } from '../domain/scan';
import { DEFAULT_TYPES } from '../domain/colors';
import { DEFAULT_THRESHOLDS } from '../domain/gauge';
import { newId, newToken } from '../domain/ids';
import {
  StoreError,
  type AccessPage, type Agent, type EventPatch, type EventSnapshot, type EventStore, type NewEvent,
  type NewParticipant, type ParticipantPatch, type RegistrationForm, type RegistrationInfo, type ScanResult,
} from './store';

interface Db {
  version: 1;
  events: Record<string, EventInfo>;
  participants: Record<string, Participant>;
  passages: Passage[];
  refusals: Refusal[];
}

const EMPTY: Db = { version: 1, events: {}, participants: {}, passages: [], refusals: [] };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Stockage clé-valeur (localStorage dans le navigateur, Map dans les tests). */
export interface KeyValue {
  get(key: string): string | null;
  set(key: string, value: string): void;
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

export class LocalStore implements EventStore {
  private listeners = new Map<string, Set<(s: EventSnapshot) => void>>();

  constructor(
    private storage: KeyValue,
    private bus: Bus | null,
    private lock: Lock = queueLock(),
    private now: () => Date = () => new Date(),
  ) {
    bus?.listen((eventId) => this.emit(eventId));
  }

  // ── Accès au stockage ──────────────────────────────────────────────

  private read(): Db {
    const raw = this.storage.get(KEY);
    if (!raw) return structuredClone(EMPTY);
    try { return { ...structuredClone(EMPTY), ...JSON.parse(raw) as Db }; }
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
    if (!event) return null;
    return {
      event,
      participants: Object.values(db.participants)
        .filter((p) => p.eventId === eventId)
        .sort((a, b) => a.lastName.localeCompare(b.lastName, 'fr') || a.firstName.localeCompare(b.firstName, 'fr')),
      passages: db.passages.filter((p) => p.eventId === eventId),
      refusals: db.refusals.filter((r) => r.eventId === eventId),
    };
  }

  private emit(eventId: string) {
    const set = this.listeners.get(eventId);
    if (!set?.size) return;
    const snap = this.snapshot(this.read(), eventId);
    if (snap) set.forEach((l) => l(snap));
  }

  private nowIso() { return this.now().toISOString(); }

  private requireEvent(db: Db, id: string): EventInfo {
    const e = db.events[id];
    if (!e) throw new StoreError('not-found', 'Événement introuvable');
    return e;
  }

  private requireParticipant(db: Db, id: string): Participant {
    const p = db.participants[id];
    if (!p) throw new StoreError('not-found', 'Participant introuvable');
    return p;
  }

  private emailTaken(db: Db, eventId: string, email: string, exceptId?: string) {
    const e = email.trim().toLowerCase();
    return !!e && Object.values(db.participants).some((p) => p.eventId === eventId && p.id !== exceptId && p.email === e);
  }

  private buildParticipant(eventId: string, input: NewParticipant): Participant {
    return {
      id: newId(), eventId,
      firstName: input.firstName.trim().slice(0, 100),
      lastName: input.lastName.trim().slice(0, 100),
      email: input.email.trim().toLowerCase().slice(0, 320),
      phone: (input.phone ?? '').trim().slice(0, 40),
      company: (input.company ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
      typeId: input.typeId,
      token: newToken(), tokenRevoked: false,
      source: input.source, consentAt: input.consentAt ?? null, createdAt: this.nowIso(),
      inside: false, entryCount: 0, firstEntryAt: null, lastMoveAt: null,
    };
  }

  // ── Événements ─────────────────────────────────────────────────────

  async listEvents() {
    return Object.values(this.read().events).sort((a, b) => b.startDate.localeCompare(a.startDate));
  }

  async createEvent(input: NewEvent) {
    const event: EventInfo = {
      id: newId(), name: input.name.trim().slice(0, 200), startDate: input.startDate, endDate: input.endDate,
      venue: (input.venue ?? '').trim(), capacity: input.capacity ?? 1000, thresholds: DEFAULT_THRESHOLDS,
      types: DEFAULT_TYPES, registrationOpen: false, createdAt: this.nowIso(),
    };
    if (!event.name) throw new StoreError('invalid', 'Le nom de l\'événement est obligatoire');
    if (event.endDate < event.startDate) throw new StoreError('invalid', 'La date de fin précède la date de début');
    await this.transaction([], (db) => { db.events[event.id] = event; });
    return event;
  }

  async updateEvent(id: string, patch: EventPatch) {
    return this.transaction([id], (db) => {
      const event = { ...this.requireEvent(db, id), ...patch };
      if (!Number.isInteger(event.capacity) || event.capacity < 0) throw new StoreError('invalid', 'Jauge invalide');
      db.events[id] = event;
      return event;
    });
  }

  async duplicateEvent(id: string, name: string) {
    const source = this.requireEvent(this.read(), id);
    const created = await this.createEvent({ name, startDate: source.startDate, endDate: source.endDate, venue: source.venue, capacity: source.capacity });
    return this.updateEvent(created.id, { types: source.types, thresholds: source.thresholds });
  }

  async deleteEvent(id: string) {
    await this.transaction([id], (db) => {
      delete db.events[id];
      for (const p of Object.values(db.participants)) if (p.eventId === id) delete db.participants[p.id];
      db.passages = db.passages.filter((p) => p.eventId !== id);
      db.refusals = db.refusals.filter((r) => r.eventId !== id);
    });
  }

  // ── Participants ───────────────────────────────────────────────────

  async addParticipants(eventId: string, list: NewParticipant[]) {
    return this.transaction([eventId], (db) => {
      const event = this.requireEvent(db, eventId);
      const typeIds = new Set(event.types.map((t) => t.id));
      return list.map((input) => {
        if (!input.firstName.trim() && !input.lastName.trim()) throw new StoreError('invalid', 'Nom manquant');
        if (input.email && !EMAIL.test(input.email.trim())) throw new StoreError('invalid', `Email invalide : ${input.email}`);
        if (this.emailTaken(db, eventId, input.email)) throw new StoreError('duplicate', `${input.email} est déjà inscrit`);
        const p = this.buildParticipant(eventId, { ...input, typeId: typeIds.has(input.typeId) ? input.typeId : event.types[0]!.id });
        db.participants[p.id] = p;
        return p;
      });
    });
  }

  async updateParticipant(id: string, patch: ParticipantPatch) {
    const eventId = this.requireParticipant(this.read(), id).eventId;
    return this.transaction([eventId], (db) => {
      const current = this.requireParticipant(db, id);
      const next = { ...current, ...patch };
      if (patch.email !== undefined) {
        next.email = patch.email.trim().toLowerCase();
        if (next.email && !EMAIL.test(next.email)) throw new StoreError('invalid', 'Email invalide');
        if (this.emailTaken(db, eventId, next.email, id)) throw new StoreError('duplicate', `${next.email} est déjà inscrit`);
      }
      db.participants[id] = next;
      return next;
    });
  }

  async deleteParticipant(id: string) {
    const eventId = this.requireParticipant(this.read(), id).eventId;
    await this.transaction([eventId], (db) => {
      delete db.participants[id];
      db.passages = db.passages.filter((p) => p.participantId !== id); // RG-08
    });
  }

  async revokeToken(id: string) {
    const eventId = this.requireParticipant(this.read(), id).eventId;
    return this.transaction([eventId], (db) => {
      const p = { ...this.requireParticipant(db, id), token: newToken(), tokenRevoked: false };
      db.participants[id] = p;
      return p;
    });
  }

  // ── Scan ───────────────────────────────────────────────────────────

  async scan(eventId: string, token: string, direction: 'in' | 'out', method: ScanMethod, agent: Agent): Promise<ScanResult> {
    return this.transaction([eventId], (db) => {
      this.requireEvent(db, eventId);
      const at = this.nowIso();
      const participant = Object.values(db.participants).find((p) => p.eventId === eventId && p.token === token.trim());
      const decision = decideScan(participant, direction);
      const base = { eventId, at, agentId: agent.id, agentName: agent.name, stationId: agent.stationId, method };

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

  async closeDay(eventId: string, agent: Agent) {
    return this.transaction([eventId], (db) => {
      this.requireEvent(db, eventId);
      const at = this.nowIso();
      let count = 0;
      for (const p of Object.values(db.participants)) {
        if (p.eventId !== eventId || !p.inside) continue;
        db.participants[p.id] = { ...p, inside: false, lastMoveAt: at };
        db.passages.push({
          id: newId(), eventId, participantId: p.id, typeId: p.typeId, direction: 'out', at,
          agentId: agent.id, agentName: agent.name, stationId: agent.stationId,
          method: 'manual', origin: 'closing', offlineDuplicate: false,
        });
        count++;
      }
      return count;
    });
  }

  // ── Public ─────────────────────────────────────────────────────────

  async getRegistrationInfo(eventId: string): Promise<RegistrationInfo | null> {
    const e = this.read().events[eventId];
    return e ? { eventName: e.name, types: e.types, open: e.registrationOpen } : null;
  }

  async register(eventId: string, form: RegistrationForm) {
    if (!form.consent) throw new StoreError('invalid', 'Le consentement est obligatoire');
    if (!form.lastName.trim()) throw new StoreError('invalid', 'Le nom est obligatoire');
    if (!EMAIL.test(form.email.trim())) throw new StoreError('invalid', 'Adresse email invalide');
    return this.transaction([eventId], (db) => {
      const event = db.events[eventId];
      if (!event || !event.registrationOpen) throw new StoreError('closed', 'Les inscriptions sont fermées');
      if (!event.types.some((t) => t.id === form.typeId)) throw new StoreError('invalid', 'Profil invalide');
      if (this.emailTaken(db, eventId, form.email)) throw new StoreError('duplicate', 'Cette adresse email est déjà inscrite');
      const p = this.buildParticipant(eventId, { ...form, source: 'form', consentAt: this.nowIso() });
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
      type: e.types.find((t) => t.id === p.typeId) ?? null, token: p.token, entryCount: p.entryCount,
    };
  }

  // ── Temps réel ─────────────────────────────────────────────────────

  subscribe(eventId: string, listener: (s: EventSnapshot) => void) {
    const set = this.listeners.get(eventId) ?? new Set();
    set.add(listener);
    this.listeners.set(eventId, set);
    const snap = this.snapshot(this.read(), eventId);
    if (snap) listener(snap);
    return () => { set.delete(listener); };
  }
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
  );
}
