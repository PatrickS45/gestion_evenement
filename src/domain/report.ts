// Bilan anonyme d'un événement (F-77) : uniquement des chiffres agrégés, aucune donnée personnelle.
// Enregistré avant toute suppression de données (purge, suppression de l'événement) et conservé sans limite.
// Module exécuté aussi par le serveur (hooks PocketBase, sans Intl).
import { quarterCurve, replayPassages } from './attendance';
import type { EventInfo, Iso, Participant, ParticipantType, Passage, Refusal } from './model';

export type ReportReason = 'purge' | 'deletion';

export interface ReportDay {
  day: string;
  entries: number;
  exits: number;
  visitors: number;
  peak: number;
  peakAt: Iso | null;
  /** Présence maximale par quart d'heure. */
  curve: { start: Iso; present: number }[];
}

export interface EventReport {
  eventId: string;
  eventName: string;
  startDate: string;
  endDate: string;
  venue: string;
  capacity: number;
  registered: number;
  came: number;
  peak: { value: number; at: Iso | null };
  byType: (ParticipantType & { registered: number; came: number; companies: number })[];
  days: ReportDay[];
  refusals: number;
  offlineDuplicates: number;
  generatedAt: Iso;
  reason: ReportReason;
}

const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
const normalizeCompany = (c: string) => c.trim().toLowerCase().replace(/\s+/g, ' ');

export function anonymousReport(
  event: EventInfo,
  participants: Participant[],
  passages: Passage[],
  refusals: Refusal[],
  generatedAt: Iso,
  reason: ReportReason,
): EventReport {
  const replay = replayPassages(passages);
  return {
    eventId: event.id,
    eventName: event.name,
    startDate: event.startDate,
    endDate: event.endDate,
    venue: event.venue,
    capacity: event.capacity,
    registered: participants.length,
    came: participants.filter((p) => p.entryCount > 0).length,
    peak: { value: replay.peak.value, at: iso(replay.peak.at) },
    byType: event.types.map((t) => {
      const ofType = participants.filter((p) => p.typeId === t.id);
      return {
        ...t,
        registered: ofType.length,
        came: ofType.filter((p) => p.entryCount > 0).length,
        companies: new Set(ofType.map((p) => normalizeCompany(p.company)).filter(Boolean)).size,
      };
    }),
    days: replay.days.map((d) => ({
      day: d.day, entries: d.entries, exits: d.exits, visitors: d.visitors, peak: d.peak, peakAt: iso(d.peakAt),
      curve: quarterCurve(replay.timeline, d.day, 0).map((c) => ({ start: new Date(c.start).toISOString(), present: c.present })),
    })),
    refusals: refusals.length,
    offlineDuplicates: passages.filter((p) => p.offlineDuplicate).length,
    generatedAt,
    reason,
  };
}
