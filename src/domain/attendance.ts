// Fréquentation : rejeu du journal des passages (RG-01 à RG-05) et vue « Direct » (F-65).
import type { EventInfo, Participant, ParticipantType, Passage } from './model';
import { floorQuarter, parisDay, QUARTER_MS, toMs } from './time';
import { gaugeLevel, type GaugeLevel } from './gauge';

export interface DayStats {
  day: string;
  entries: number;
  exits: number;
  /** Participants ayant au moins une entrée ce jour-là (RG-03). */
  visitors: number;
  peak: number;
  peakAt: number | null;
}

export interface Replay {
  insideIds: Set<string>;
  /** Nombre de présents après chaque passage pris en compte. */
  timeline: { at: number; present: number }[];
  peak: { value: number; at: number | null };
  days: DayStats[];
}

/**
 * Rejoue le journal dans l'ordre chronologique. Les doublons hors ligne (F-63) et les
 * passages incohérents (entrée d'un présent, sortie d'un absent) sont ignorés pour le comptage.
 */
export function replayPassages(passages: Passage[]): Replay {
  const sorted = passages
    .filter((p) => !p.offlineDuplicate)
    .map((p) => ({ ...p, t: toMs(p.at) }))
    .sort((a, b) => a.t - b.t);

  const inside = new Set<string>();
  const timeline: Replay['timeline'] = [];
  const days = new Map<string, DayStats & { ids: Set<string> }>();
  let peak: Replay['peak'] = { value: 0, at: null };

  for (const p of sorted) {
    const dayKey = parisDay(p.t);
    let day = days.get(dayKey);
    if (!day) {
      day = { day: dayKey, entries: 0, exits: 0, visitors: 0, peak: 0, peakAt: null, ids: new Set() };
      days.set(dayKey, day);
    }

    if (p.direction === 'in') {
      if (inside.has(p.participantId)) continue;
      inside.add(p.participantId);
      day.entries++;
      day.ids.add(p.participantId);
    } else {
      if (!inside.has(p.participantId)) continue;
      inside.delete(p.participantId);
      day.exits++;
    }

    const present = inside.size;
    timeline.push({ at: p.t, present });
    if (present > peak.value) peak = { value: present, at: p.t };
    if (present > day.peak) { day.peak = present; day.peakAt = p.t; }
  }

  return {
    insideIds: inside,
    timeline,
    peak,
    days: [...days.values()].map(({ ids, ...d }) => ({ ...d, visitors: ids.size })),
  };
}

/** Nombre maximal de présents par quart d'heure sur une journée, du premier passage jusqu'à `until`. */
export function quarterCurve(timeline: Replay['timeline'], day: string, until: number): { start: number; present: number }[] {
  const ofDay = timeline.filter((p) => parisDay(p.at) === day);
  if (ofDay.length === 0) return [];

  let current = 0;
  for (const p of timeline) { if (p.at >= ofDay[0]!.at) break; current = p.present; }

  const curve: { start: number; present: number }[] = [];
  const last = Math.max(ofDay[ofDay.length - 1]!.at, parisDay(until) === day ? until : 0);
  let i = 0;
  for (let start = floorQuarter(ofDay[0]!.at); start <= floorQuarter(last); start += QUARTER_MS) {
    let max = current;
    while (i < ofDay.length && ofDay[i]!.at < start + QUARTER_MS) {
      current = ofDay[i]!.present;
      max = Math.max(max, current);
      i++;
    }
    curve.push({ start, present: max });
  }
  return curve;
}

export interface TypeLive extends ParticipantType {
  registered: number;
  came: number;
  present: number;
  entriesToday: number;
  exitsToday: number;
  /** Sociétés ou enseignes distinctes parmi les inscrits de ce type. */
  companies: number;
}

export interface LiveView {
  present: number;
  capacity: number;
  level: GaugeLevel;
  /** Le nombre de présents correspond-il au rejeu du journal ? (RG-02) */
  consistent: boolean;
  byType: TypeLive[];
  today: DayStats;
  days: DayStats[];
  curve: { start: number; present: number }[];
  recent: Passage[];
}

const normalizeCompany = (c: string) => c.trim().toLowerCase().replace(/\s+/g, ' ');

export function liveView(event: EventInfo, participants: Participant[], passages: Passage[], now: number): LiveView {
  const replay = replayPassages(passages);
  const present = participants.filter((p) => p.inside).length;
  const todayKey = parisDay(now);
  const today = replay.days.find((d) => d.day === todayKey)
    ?? { day: todayKey, entries: 0, exits: 0, visitors: 0, peak: 0, peakAt: null };
  const todayPassages = passages.filter((p) => !p.offlineDuplicate && parisDay(p.at) === todayKey);

  const byType = event.types.map((t): TypeLive => {
    const ofType = participants.filter((p) => p.typeId === t.id);
    return {
      ...t,
      registered: ofType.length,
      came: ofType.filter((p) => p.entryCount > 0).length,
      present: ofType.filter((p) => p.inside).length,
      entriesToday: todayPassages.filter((p) => p.typeId === t.id && p.direction === 'in').length,
      exitsToday: todayPassages.filter((p) => p.typeId === t.id && p.direction === 'out').length,
      companies: new Set(ofType.map((p) => normalizeCompany(p.company)).filter(Boolean)).size,
    };
  });

  return {
    present,
    capacity: event.capacity,
    level: gaugeLevel(present, event.capacity, event.thresholds),
    consistent: present === replay.insideIds.size,
    byType,
    today,
    days: replay.days,
    curve: quarterCurve(replay.timeline, todayKey, now),
    recent: [...passages].sort((a, b) => toMs(b.at) - toMs(a.at)).slice(0, 12),
  };
}
