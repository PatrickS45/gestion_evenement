// Réconciliation des passages enregistrés hors ligne (F-61, F-63).
// Hors ligne, deux postes ne peuvent pas se coordonner : un participant peut être entré deux fois.
// Les passages arrivent au serveur en retard mais avec leur heure réelle ; le journal du participant
// est alors rejoué dans l'ordre chronologique, et la présence en découle (RG-01, RG-02).
import type { Participant, Passage } from './model';
import { toMs } from './time';

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

/** Ordre du journal : heure réelle, puis, à la même milliseconde, l'ordre d'enregistrement fourni. */
function chronological(passages: Passage[]): Passage[] {
  return passages
    .map((p, i) => ({ p, t: toMs(p.at), i }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
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

export interface Reconciliation {
  participant: Participant;
  /** Passages reçus à ajouter au journal, avec leur marquage « doublon hors ligne ». */
  added: Passage[];
  /** Passages déjà connus dont le marquage change : à réécrire. */
  changed: Passage[];
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
  };
}
