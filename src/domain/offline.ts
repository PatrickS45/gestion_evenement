// Réconciliation des passages enregistrés hors ligne (F-61, F-63).
// Hors ligne, deux postes ne peuvent pas se coordonner : un participant peut être entré deux fois.
// Les passages arrivent au serveur en retard mais avec leur heure réelle ; le journal du participant
// est alors rejoué dans l'ordre chronologique, et la présence en découle (RG-01, RG-02).
// Module exécuté aussi par le serveur (moteur des hooks PocketBase, sans Intl) : pas d'import de ./time.
import type { Direction, Iso, Participant, Passage, RefusalReason, ScanMethod } from './model';

// ─── Lots envoyés par un poste au retour du réseau ───────────────────

/** Passage validé sur un poste hors ligne ; l'identifiant est créé par le poste (envoi rejouable). */
export interface OfflinePassage {
  id: string;
  participantId: string;
  direction: Direction;
  /** Heure réelle du passage, corrigée du décalage d'horloge du poste. */
  at: Iso;
  method: ScanMethod;
}

/** Refus décidé sur un poste hors ligne, journalisé comme en ligne. */
export interface OfflineRefusal {
  id: string;
  reason: RefusalReason;
  at: Iso;
  method: ScanMethod;
  participantId: string | null;
  sample: string;
}

export interface SyncBatch {
  stationId: string;
  passages: OfflinePassage[];
  refusals: OfflineRefusal[];
}

/** Sort d'un passage envoyé : compté, doublon hors ligne (F-63), ou rejeté (participant supprimé, données invalides). */
export type SyncStatus = 'counted' | 'duplicate' | 'rejected';

export interface SyncResult {
  passages: { id: string; status: SyncStatus }[];
  /**
   * Variation du nombre de doublons due à ce lot, passages des autres postes compris : une entrée hors
   * ligne plus ancienne fait d'un passage déjà reçu le doublon. La somme sur tous les envois est le total.
   */
  newDuplicates: number;
}

/** Taille maximale d'un lot ; au-delà, le poste envoie en plusieurs fois. */
export const SYNC_MAX = 500;
/** Avance tolérée sur l'heure du serveur ; en deçà, l'heure est ramenée à celle du serveur. */
export const CLOCK_TOLERANCE_MS = 5 * 60_000;

/** Identifiant créé par un poste : 15 caractères [a-z0-9], le format des enregistrements du serveur. */
export const RECORD_ID = /^[a-z0-9]{15}$/;

const DIRECTIONS: readonly string[] = ['in', 'out'];
const METHODS: readonly string[] = ['camera', 'scanner', 'search', 'manual'];
const REASONS: readonly string[] = ['unknown', 'already-inside'];
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Heure d'un passage reçu : null si illisible ou trop en avance sur le serveur. */
function receivedAt(v: unknown, nowMs: number): Iso | null {
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (!Number.isFinite(t) || t > nowMs + CLOCK_TOLERANCE_MS) return null;
  return new Date(Math.min(t, nowMs)).toISOString();
}

/** Passage reçu d'un poste, vérifié ; null s'il est invalide. */
export function parseOfflinePassage(raw: unknown, nowMs: number): OfflinePassage | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const at = receivedAt(r.at, nowMs);
  const id = text(r.id, 15);
  const participantId = text(r.participantId, 40);
  if (!at || !RECORD_ID.test(id) || !participantId || !DIRECTIONS.includes(r.direction as string) || !METHODS.includes(r.method as string)) return null;
  return { id, participantId, direction: r.direction as Direction, at, method: r.method as ScanMethod };
}

/** Refus reçu d'un poste, vérifié ; null s'il est invalide. */
export function parseOfflineRefusal(raw: unknown, nowMs: number): OfflineRefusal | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const at = receivedAt(r.at, nowMs);
  const id = text(r.id, 15);
  if (!at || !RECORD_ID.test(id) || !REASONS.includes(r.reason as string) || !METHODS.includes(r.method as string)) return null;
  return {
    id, reason: r.reason as RefusalReason, at, method: r.method as ScanMethod,
    participantId: text(r.participantId, 40) || null, sample: text(r.sample, 12),
  };
}

// ─── Rejeu du journal d'un participant ───────────────────────────────

export interface ParticipantReplay {
  inside: boolean;
  entryCount: number;
  firstEntryAt: string | null;
  lastMoveAt: string | null;
  /**
   * Passages qui ne changent rien à la présence (entrée d'un présent, sortie d'un absent) :
   * conservés dans le journal mais marqués « doublon hors ligne » et exclus du comptage (F-63).
   */
  duplicates: Set<string>;
}

/** Ordre du journal : heure réelle, puis identifiant, pour que chaque rejeu donne le même résultat. */
function chronological(passages: Passage[]): Passage[] {
  return passages
    .map((p) => ({ p, t: Date.parse(p.at) }))
    .sort((a, b) => a.t - b.t || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0))
    .map(({ p }) => p);
}

/** Rejoue le journal complet d'un participant : son état de présence et ses doublons. */
export function replayParticipant(passages: Passage[]): ParticipantReplay {
  const r: ParticipantReplay = { inside: false, entryCount: 0, firstEntryAt: null, lastMoveAt: null, duplicates: new Set() };
  for (const p of chronological(passages)) {
    if ((p.direction === 'in') === r.inside) { r.duplicates.add(p.id); continue; }
    r.inside = p.direction === 'in';
    if (r.inside) {
      r.entryCount++;
      r.firstEntryAt ??= p.at;
    }
    r.lastMoveAt = p.at;
  }
  return r;
}

export interface DuplicateReport {
  duplicate: Passage;
  /** Passage déjà compté que le doublon répète ; null s'il n'y en a pas (sortie d'une personne jamais entrée). */
  original: Passage | null;
}

/** Doublons hors ligne du journal (F-63), avec le passage qu'ils répètent, du plus récent au plus ancien. */
export function offlineDuplicates(passages: Passage[]): DuplicateReport[] {
  const lastCounted = new Map<string, Passage>();
  const reports: DuplicateReport[] = [];
  for (const p of chronological(passages)) {
    if (p.offlineDuplicate) reports.push({ duplicate: p, original: lastCounted.get(p.participantId) ?? null });
    else lastCounted.set(p.participantId, p);
  }
  return reports.reverse();
}

export interface Reconciliation {
  participant: Participant;
  /** Passages reçus à ajouter au journal, avec leur marquage « doublon hors ligne ». */
  added: Passage[];
  /** Passages déjà connus dont le marquage change : à réécrire. */
  changed: Passage[];
  /** Variation du nombre de doublons du participant. */
  newDuplicates: number;
}

/**
 * Intègre au journal d'un participant des passages reçus d'un poste hors ligne.
 * Un passage déjà connu (même identifiant, lot renvoyé après une coupure) n'est pas ajouté deux fois.
 * Le marquage peut changer pour des passages déjà enregistrés : une sortie reçue en retard peut rendre
 * valide une entrée jusque-là doublon, et une entrée hors ligne plus ancienne peut faire d'une entrée
 * en ligne le second passage.
 */
export function reconcile(participant: Participant, known: Passage[], received: Passage[]): Reconciliation {
  const ids = new Set(known.map((p) => p.id));
  const fresh = received.filter((p) => !ids.has(p.id) && (ids.add(p.id), true));
  const journal = [...known, ...fresh];
  const replay = replayParticipant(journal);

  const passages = journal.map((p) => {
    const offlineDuplicate = replay.duplicates.has(p.id);
    return offlineDuplicate === p.offlineDuplicate ? p : { ...p, offlineDuplicate };
  });
  const changed = passages.slice(0, known.length).filter((p, i) => p !== known[i]);

  return {
    participant: {
      ...participant,
      inside: replay.inside,
      entryCount: replay.entryCount,
      firstEntryAt: replay.firstEntryAt,
      lastMoveAt: replay.lastMoveAt,
    },
    added: passages.slice(known.length),
    changed,
    newDuplicates: replay.duplicates.size - known.filter((p) => p.offlineDuplicate).length,
  };
}
