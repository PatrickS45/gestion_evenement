// Poste de scan résistant aux coupures de réseau (F-60 à F-64). Enveloppe le stockage serveur :
// - en ligne, tout passe par le serveur ; chaque événement suivi est copié, chiffré, sur l'appareil ;
// - si le serveur ne répond plus, le scan est décidé sur l'appareil à partir de cette copie,
//   mis en file d'attente (chiffrée elle aussi), puis envoyé dans l'ordre au retour du réseau ;
// - l'heure des passages hors ligne est corrigée du décalage mesuré entre l'appareil et le serveur ;
// - à la déconnexion, et à la fin de l'événement, la copie est effacée.
import { applyScan, decideScan } from '../domain/scan';
import { newRecordId } from '../domain/ids';
import { SYNC_MAX, type OfflinePassage, type OfflineRefusal } from '../domain/offline';
import type { Direction, Participant, Passage, ScanMethod, User } from '../domain/model';
import { queueLock } from './localStore';
import {
  StoreError,
  type EventPatch, type EventSnapshot, type EventStore, type NewEvent, type NewParticipant, type ParticipantPatch,
  type RegistrationForm, type ScanResult, type Session, type SignUpInput, type SyncBatch,
} from './store';
import type { Vault } from './vault';

/** Stockage serveur enveloppé : capable de dire s'il est joignable. */
export interface ReachableStore extends EventStore {
  reachable(): Promise<boolean>;
}

export interface StationStatus {
  online: boolean;
  /** Passages et refus enregistrés hors ligne, pas encore envoyés (F-62). */
  pending: number;
  syncing: boolean;
  /** Bilan des envois depuis la connexion : doublons hors ligne détectés (F-63), y compris parmi les passages
   *  d'autres postes, et passages rejetés par le serveur. */
  duplicates: number;
  rejected: number;
  lastSyncAt: string | null;
  /** Copies locales disponibles (F-60). */
  copies: Record<string, CopyInfo>;
}

export interface CopyInfo {
  eventName: string;
  endDate: string;
  savedAt: string;
  participants: number;
}

type QueueItem =
  | { eventId: string; stationId: string; passage: OfflinePassage; refusal?: undefined }
  | { eventId: string; stationId: string; refusal: OfflineRefusal; passage?: undefined };

interface Clock { offsetMs: number; rttMs: number }

const KEYS = { queue: 'queue', session: 'session', clock: 'clock', copies: 'copies', copy: (id: string) => `copy:${id}` };

/** Intervalle des essais de reconnexion hors ligne. */
const PROBE_MS = 5000;
/** Intervalle minimal entre deux enregistrements de la copie locale d'un événement. */
const SAVE_COPY_MS = 15_000;

export interface StationOptions {
  now?: () => number;
  /** Date du jour (AAAA-MM-JJ) : les copies des événements terminés sont effacées. */
  today?: () => string;
  probeMs?: number;
}

export class StationStore implements EventStore {
  private status: StationStatus = { online: true, pending: 0, syncing: false, duplicates: 0, rejected: 0, lastSyncAt: null, copies: {} };
  private statusListeners = new Set<(s: StationStatus) => void>();
  private queue: QueueItem[] = [];
  private clock: Clock = { offsetMs: 0, rttMs: Infinity };
  private session: Session | null = null;
  /** Copie de base de chaque événement : dernier état reçu du serveur. */
  private bases = new Map<string, EventSnapshot>();
  private lastSaved = new Map<string, number>();
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeners = new Map<string, Set<Watch>>();
  private lock = queueLock();
  private probeTimer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;
  private readonly today: () => string;
  private readonly probeMs: number;
  readonly ready: Promise<void>;

  constructor(private inner: ReachableStore, private vault: Vault, options: StationOptions = {}) {
    this.now = options.now ?? Date.now;
    this.today = options.today ?? (() => new Date(this.now()).toISOString().slice(0, 10));
    this.probeMs = options.probeMs ?? PROBE_MS;
    this.ready = this.restore();
    if (typeof window !== 'undefined') window.addEventListener('online', () => void this.probe());
  }

  private async restore() {
    this.queue = (await this.vault.get<QueueItem[]>(KEYS.queue)) ?? [];
    this.clock = (await this.vault.get<Clock>(KEYS.clock)) ?? this.clock;
    this.session = await this.vault.get<Session>(KEYS.session);
    const copies = (await this.vault.get<Record<string, CopyInfo>>(KEYS.copies)) ?? {};
    // Fin de l'événement : la copie est effacée, sauf s'il reste des passages à envoyer
    for (const [id, info] of Object.entries(copies)) {
      if (info.endDate < this.today() && !this.queue.some((q) => q.eventId === id)) {
        delete copies[id];
        await this.vault.delete(KEYS.copy(id));
      }
    }
    this.setStatus({ pending: this.queue.length, copies });
    await this.vault.set(KEYS.copies, copies);
    if (this.queue.length) this.goOffline(); // file non vide : l'envoyer avant tout scan en ligne
  }

  // ── État du poste (F-62) ───────────────────────────────────────────

  getStatus(): StationStatus { return this.status; }

  onStatus(listener: (s: StationStatus) => void): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(patch: Partial<StationStatus>) {
    this.status = { ...this.status, ...patch };
    this.statusListeners.forEach((l) => l(this.status));
  }

  private goOffline() {
    const wasOnline = this.status.online;
    if (wasOnline) this.setStatus({ online: false });
    this.probeTimer ??= setInterval(() => void this.probe(), this.probeMs);
    if (wasOnline) for (const id of this.listeners.keys()) this.emitLocal(id);
  }

  private goOnline() {
    clearInterval(this.probeTimer);
    this.probeTimer = undefined;
    if (this.status.online) return;
    this.setStatus({ online: true });
    // Nouvel abonnement au serveur : l'état reçu remplace l'estimation locale
    for (const watches of this.listeners.values()) for (const w of watches) w.resubscribe();
  }

  /** Essai de reconnexion : envoie la file, puis repasse en ligne. */
  async probe(): Promise<boolean> {
    await this.ready;
    if (!(await this.inner.reachable())) return false;
    const sent = await this.lock(() => this.flush());
    if (sent) this.goOnline();
    return sent;
  }

  // ── File d'envoi (F-61) ────────────────────────────────────────────

  private async saveQueue() {
    await this.vault.set(KEYS.queue, this.queue);
    this.setStatus({ pending: this.queue.length });
  }

  /** Envoie la file dans l'ordre, par lots ; renvoie vrai si elle est vide. À appeler sous verrou. */
  private async flush(): Promise<boolean> {
    if (!this.queue.length) return true;
    this.setStatus({ syncing: true });
    try {
      while (this.queue.length) {
        const { eventId, stationId } = this.queue[0]!;
        let n = 0;
        while (n < this.queue.length && n < SYNC_MAX && this.queue[n]!.eventId === eventId && this.queue[n]!.stationId === stationId) n++;
        const items = this.queue.slice(0, n);
        const batch: SyncBatch = {
          stationId,
          passages: items.flatMap((q) => (q.passage ? [q.passage] : [])),
          refusals: items.flatMap((q) => (q.refusal ? [q.refusal] : [])),
        };
        let result;
        try {
          result = await this.inner.syncOffline(eventId, batch);
        } catch (err) {
          if (err instanceof StoreError && err.code === 'unreachable') return false;
          // Événement supprimé ou droits retirés : ces passages ne pourront jamais être reçus
          if (err instanceof StoreError && (err.code === 'not-found' || err.code === 'forbidden')) {
            result = { passages: batch.passages.map((p) => ({ id: p.id, status: 'rejected' as const })), newDuplicates: 0 };
          } else throw err;
        }
        this.queue = this.queue.slice(n);
        await this.saveQueue();
        this.setStatus({
          duplicates: Math.max(0, this.status.duplicates + result.newDuplicates),
          rejected: this.status.rejected + result.passages.filter((p) => p.status === 'rejected').length,
          lastSyncAt: new Date(this.now()).toISOString(),
        });
      }
      return true;
    } finally {
      this.setStatus({ syncing: false });
    }
  }

  // ── Copie locale (F-60, F-64) ──────────────────────────────────────

  /** État affiché hors ligne : dernière copie reçue du serveur, plus les passages de ce poste en attente. */
  private local(eventId: string): EventSnapshot | null {
    const base = this.bases.get(eventId);
    if (!base) return null;
    const participants = new Map(base.participants.map((p) => [p.id, p]));
    const passages = [...base.passages];
    const refusals = [...base.refusals];
    const user = this.session?.user;
    for (const q of this.queue) {
      if (q.eventId !== eventId) continue;
      const common = { eventId, agentId: user?.id ?? '', agentName: user?.name ?? '', stationId: q.stationId };
      if (q.refusal) {
        refusals.push({ ...common, ...q.refusal });
        continue;
      }
      const p = participants.get(q.passage.participantId);
      if (!p) continue;
      const passage: Passage = { ...common, ...q.passage, typeId: p.typeId, origin: 'offline', offlineDuplicate: false };
      passages.push(passage);
      participants.set(p.id, q.passage.direction === 'in'
        ? { ...p, inside: true, entryCount: p.entryCount + 1, firstEntryAt: p.firstEntryAt ?? passage.at, lastMoveAt: passage.at }
        : { ...p, inside: false, lastMoveAt: passage.at });
    }
    return { ...base, participants: [...participants.values()], passages, refusals };
  }

  private async loadBase(eventId: string): Promise<EventSnapshot | null> {
    if (!this.bases.has(eventId)) {
      const saved = await this.vault.get<EventSnapshot>(KEYS.copy(eventId));
      if (saved && !this.bases.has(eventId)) this.bases.set(eventId, saved);
    }
    return this.bases.get(eventId) ?? null;
  }

  /** Nouvel état reçu du serveur : devient la copie de base, enregistrée au plus toutes les 15 secondes. */
  private keepBase(snapshot: EventSnapshot) {
    const id = snapshot.event.id;
    this.bases.set(id, snapshot);
    if (this.saveTimers.has(id)) return;
    const wait = Math.max(0, (this.lastSaved.get(id) ?? -Infinity) + SAVE_COPY_MS - this.now());
    this.saveTimers.set(id, setTimeout(() => {
      this.saveTimers.delete(id);
      void this.saveBase(id);
    }, wait));
  }

  private async saveBase(eventId: string) {
    const base = this.bases.get(eventId);
    if (!base || !this.session) return; // déconnecté entre-temps
    this.lastSaved.set(eventId, this.now());
    await this.vault.set(KEYS.copy(eventId), base);
    const copies = {
      ...this.status.copies,
      [eventId]: { eventName: base.event.name, endDate: base.event.endDate, savedAt: new Date(this.now()).toISOString(), participants: base.participants.length },
    };
    this.setStatus({ copies });
    await this.vault.set(KEYS.copies, copies);
  }

  /** Télécharge et enregistre aussitôt la copie d'un événement, avant l'ouverture (F-60). */
  async prepare(eventId: string): Promise<CopyInfo> {
    await this.ready;
    // Sans réponse du serveur, l'abonnement ne transmet rien : délai maximal de 20 secondes
    let stop = () => {};
    const snapshot = await new Promise<EventSnapshot | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 20_000);
      stop = this.inner.subscribe(eventId, (s) => { clearTimeout(timer); resolve(s); });
    }).finally(() => setTimeout(() => stop(), 0));
    if (!snapshot) throw new StoreError('unreachable', 'Copie impossible : serveur injoignable ou événement introuvable');
    this.bases.set(eventId, snapshot);
    await this.saveBase(eventId);
    return this.status.copies[eventId]!;
  }

  private async forgetCopy(eventId: string) {
    this.bases.delete(eventId);
    clearTimeout(this.saveTimers.get(eventId));
    this.saveTimers.delete(eventId);
    if (!this.status.copies[eventId]) return;
    const { [eventId]: _removed, ...copies } = this.status.copies;
    this.setStatus({ copies });
    await this.vault.delete(KEYS.copy(eventId));
    await this.vault.set(KEYS.copies, copies);
  }

  // ── Temps réel ─────────────────────────────────────────────────────

  private emitLocal(eventId: string) {
    const snap = this.local(eventId);
    if (snap) this.listeners.get(eventId)?.forEach((w) => w.listener(snap));
  }

  subscribe(eventId: string, listener: (s: EventSnapshot | null) => void): () => void {
    const watch = new Watch(listener, () => this.inner.subscribe(eventId, (s) => void this.received(eventId, watch, s)));
    let set = this.listeners.get(eventId);
    if (!set) this.listeners.set(eventId, (set = new Set()));
    set.add(watch);
    void this.ready.then(async () => {
      if (watch.closed) return;
      if (!this.status.online && await this.loadBase(eventId)) listener(this.local(eventId));
      watch.resubscribe();
    });
    return () => {
      watch.close();
      set.delete(watch);
      if (!set.size) this.listeners.delete(eventId);
    };
  }

  private async received(eventId: string, watch: Watch, s: EventSnapshot | null) {
    if (watch.closed) return;
    if (s) {
      this.keepBase(s);
      if (this.status.online) watch.listener(s);
      return;
    }
    // Rien reçu : serveur injoignable (copie locale) ou événement réellement inaccessible
    if (!this.status.online || !(await this.inner.reachable())) {
      this.goOffline();
      if (watch.closed) return;
      watch.listener((await this.loadBase(eventId)) ? this.local(eventId) : null);
      return;
    }
    await this.forgetCopy(eventId);
    watch.listener(null);
  }

  // ── Scan (F-61) ────────────────────────────────────────────────────

  async scan(eventId: string, token: string, direction: Direction, method: ScanMethod, stationId: string): Promise<ScanResult> {
    await this.ready;
    return this.lock(async () => {
      // La file doit partir avant tout scan en ligne, pour que le serveur reçoive les passages dans l'ordre
      if (this.status.online && this.queue.length && !(await this.flush())) this.goOffline();
      if (this.status.online) {
        const t0 = this.now();
        try {
          const r = await this.inner.scan(eventId, token, direction, method, stationId);
          this.measureClock(t0, this.now(), r.passage?.at);
          return r;
        } catch (err) {
          if (!(err instanceof StoreError && err.code === 'unreachable')) throw err;
          this.goOffline();
        }
      }
      return this.scanOffline(eventId, token, direction, method, stationId);
    });
  }

  /** Décalage de l'horloge de l'appareil, d'après l'heure d'un passage enregistré par le serveur. */
  private measureClock(t0: number, t1: number, serverAt: string | undefined) {
    if (!serverAt) return;
    const rttMs = t1 - t0;
    // Une mesure rapide est plus précise ; une mesure ancienne finit par être remplacée
    if (rttMs > 1500 || rttMs > this.clock.rttMs * 2) { this.clock = { ...this.clock, rttMs: this.clock.rttMs * 1.1 }; return; }
    this.clock = { offsetMs: Date.parse(serverAt) - (t0 + t1) / 2, rttMs };
    void this.vault.set(KEYS.clock, this.clock);
  }

  private async scanOffline(eventId: string, token: string, direction: Direction, method: ScanMethod, stationId: string): Promise<ScanResult> {
    if (!(await this.loadBase(eventId))) {
      throw new StoreError('unreachable', 'Serveur injoignable et aucune copie locale de cet événement sur ce poste');
    }
    const snap = this.local(eventId)!;
    const user: User = this.session?.user ?? { id: '', email: '', name: '' };
    const at = new Date(this.now() + this.clock.offsetMs).toISOString();
    const participant: Participant | undefined = snap.participants.find((p) => p.token === token.trim());
    const decision = decideScan(participant, direction);
    const common = { eventId, at, agentId: user.id, agentName: user.name, stationId, method };

    if (decision.result === 'refused') {
      const refusal: OfflineRefusal = {
        id: newRecordId(), reason: decision.reason, at, method, participantId: participant?.id ?? null,
        sample: decision.reason === 'unknown' ? token.trim().slice(0, 12) : '',
      };
      this.queue.push({ eventId, stationId, refusal });
    }
    const applied = participant ? applyScan(participant, decision, { ...common, origin: 'offline', passageId: newRecordId() }) : null;
    if (applied) {
      const { passage } = applied;
      this.queue.push({ eventId, stationId, passage: { id: passage.id, participantId: passage.participantId, direction: passage.direction, at, method } });
    }
    if (decision.result !== 'warning') {
      await this.saveQueue(); // enregistré sur l'appareil avant de répondre à l'agent
      this.emitLocal(eventId);
    }
    return { decision, participant: applied?.participant ?? participant ?? null, passage: applied?.passage ?? null };
  }

  // ── Comptes ────────────────────────────────────────────────────────

  async getSession() {
    await this.ready;
    try {
      const s = await this.inner.getSession();
      await this.remember(s);
      return s;
    } catch (err) {
      if (!(err instanceof StoreError && err.code === 'unreachable')) throw err;
      this.goOffline();
      return this.session; // hors ligne : dernière session connue de ce poste
    }
  }

  private async remember(s: Session | null) {
    if (s && this.session && s.user.id !== this.session.user.id) {
      for (const id of Object.keys(this.status.copies)) await this.forgetCopy(id);
    }
    this.session = s;
    if (s) await this.vault.set(KEYS.session, s);
    else await this.vault.delete(KEYS.session);
  }

  async signUp(input: SignUpInput) { const s = await this.inner.signUp(input); await this.remember(s); return s; }
  async signIn(email: string, password: string) { const s = await this.inner.signIn(email, password); await this.remember(s); return s; }
  async createOrganization(name: string) { const s = await this.inner.createOrganization(name); await this.remember(s); return s; }

  /** Refusée tant que des passages hors ligne n'ont pas pu être envoyés : ils seraient perdus. */
  async signOut() {
    await this.ready;
    await this.lock(async () => {
      if (this.queue.length && !(await this.flush())) {
        throw new StoreError('invalid', `${this.queue.length} passage(s) enregistré(s) hors ligne ne sont pas encore envoyés : reconnectez ce poste au réseau avant de vous déconnecter`);
      }
      for (const t of this.saveTimers.values()) clearTimeout(t);
      this.saveTimers.clear();
      this.bases.clear();
      this.session = null;
      await this.vault.clear(); // copie locale, session et clé de chiffrement (F-60)
      this.setStatus({ copies: {}, duplicates: 0, rejected: 0, pending: 0 });
      await this.inner.signOut();
    });
  }

  // ── Opérations transmises telles quelles au serveur ────────────────

  listMembers(orgId: string) { return this.inner.listMembers(orgId); }
  addMember(orgId: string, email: string, role: Parameters<EventStore['addMember']>[2]) { return this.inner.addMember(orgId, email, role); }
  setMemberRole(orgId: string, userId: string, role: Parameters<EventStore['setMemberRole']>[2]) { return this.inner.setMemberRole(orgId, userId, role); }
  removeMember(orgId: string, userId: string) { return this.inner.removeMember(orgId, userId); }
  listEvents(orgId: string) { return this.inner.listEvents(orgId); }
  createEvent(orgId: string, input: NewEvent) { return this.inner.createEvent(orgId, input); }
  updateEvent(id: string, patch: EventPatch) { return this.inner.updateEvent(id, patch); }
  duplicateEvent(id: string, name: string) { return this.inner.duplicateEvent(id, name); }
  async deleteEvent(id: string) { await this.inner.deleteEvent(id); await this.forgetCopy(id); }
  addParticipants(eventId: string, list: NewParticipant[]) { return this.inner.addParticipants(eventId, list); }
  updateParticipant(id: string, patch: ParticipantPatch) { return this.inner.updateParticipant(id, patch); }
  deleteParticipant(id: string) { return this.inner.deleteParticipant(id); }
  revokeToken(id: string) { return this.inner.revokeToken(id); }
  closeDay(eventId: string, stationId: string) { return this.inner.closeDay(eventId, stationId); }
  syncOffline(eventId: string, batch: SyncBatch) { return this.inner.syncOffline(eventId, batch); }
  getRegistrationInfo(eventId: string) { return this.inner.getRegistrationInfo(eventId); }
  register(eventId: string, form: RegistrationForm) { return this.inner.register(eventId, form); }
  getAccessPage(token: string) { return this.inner.getAccessPage(token); }

  /** Arrête les essais de reconnexion (tests). */
  dispose() { clearInterval(this.probeTimer); for (const t of this.saveTimers.values()) clearTimeout(t); }
}

/** Un abonné de l'application et son abonnement au serveur, renouvelé au retour du réseau. */
class Watch {
  closed = false;
  private stop: (() => void) | null = null;
  constructor(readonly listener: (s: EventSnapshot | null) => void, private open: () => () => void) {}
  resubscribe() { if (this.closed) return; this.stop?.(); this.stop = this.open(); }
  close() { this.closed = true; this.stop?.(); }
}
