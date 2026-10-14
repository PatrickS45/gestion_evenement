// Statistiques détaillées (F-71 à F-74), calculées à partir du journal des passages ; les doublons hors ligne
// (F-63) sont écartés. Module exécuté aussi par le serveur pour le bilan anonyme (sans Intl).
import type { Passage, Refusal, ScanMethod } from './model';
import { floorQuarter, parisDay, parisOffsetMs, QUARTER_MS, toMs } from './time';

export interface DayFlow {
  day: string;
  /** Personnes arrivées : première entrée de la journée de chacune (les retours n'en sont pas). */
  arrivals: number;
  /** Arrivées par quart d'heure, de la première à la dernière (F-71). */
  arrivalsByQuarter: { start: number; count: number }[];
  firstArrival: number | null;
  lastArrival: number | null;
  /** Heure à laquelle la moitié, puis 90 %, des arrivées du jour avaient eu lieu. */
  half: number | null;
  ninety: number | null;
  /** Sorties par heure de Paris, 0 à 23, hors clôture de journée (F-72). */
  exitsByHour: number[];
  /** Durée moyenne de présence par visiteur sur la journée, séjours terminés seulement (F-72). */
  averageStayMs: number | null;
  /** Entrées par visiteur de la journée, retours compris (F-72). */
  averageEntries: number | null;
}

/** Heure de Paris, 0 à 23. */
export function parisHour(t: number): number {
  return new Date(t + parisOffsetMs(t)).getUTCHours();
}

/** Instant où la part `share` des arrivées triées a eu lieu. */
function quantile(sorted: number[], share: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.max(0, Math.ceil(share * sorted.length) - 1)]!;
}

/** Affluence et comportement, jour par jour (F-71, F-72). */
export function dailyFlows(passages: Passage[]): DayFlow[] {
  const counted = passages
    .filter((p) => !p.offlineDuplicate)
    .map((p) => ({ ...p, t: toMs(p.at), day: parisDay(p.at) }))
    .sort((a, b) => a.t - b.t);
  const days = [...new Set(counted.map((p) => p.day))];

  return days.map((day): DayFlow => {
    const ofDay = counted.filter((p) => p.day === day);
    const firstIn = new Map<string, number>();
    const entries = new Map<string, number>();
    const stays = new Map<string, number>();
    const openSince = new Map<string, number>();
    const exitsByHour = Array.from({ length: 24 }, () => 0);

    for (const p of ofDay) {
      if (p.direction === 'in') {
        if (openSince.has(p.participantId)) continue; // entrée d'un présent : ignorée, comme au comptage
        if (!firstIn.has(p.participantId)) firstIn.set(p.participantId, p.t);
        entries.set(p.participantId, (entries.get(p.participantId) ?? 0) + 1);
        openSince.set(p.participantId, p.t);
      } else {
        const since = openSince.get(p.participantId);
        if (p.origin !== 'closing') exitsByHour[parisHour(p.t)]!++;
        if (since === undefined) continue; // entré un jour précédent : pas de séjour mesurable ce jour-là
        stays.set(p.participantId, (stays.get(p.participantId) ?? 0) + (p.t - since));
        openSince.delete(p.participantId);
      }
    }

    const arrivalTimes = [...firstIn.values()].sort((a, b) => a - b);
    const byQuarter: DayFlow['arrivalsByQuarter'] = [];
    if (arrivalTimes.length) {
      for (let start = floorQuarter(arrivalTimes[0]!); start <= floorQuarter(arrivalTimes[arrivalTimes.length - 1]!); start += QUARTER_MS) {
        byQuarter.push({ start, count: arrivalTimes.filter((t) => t >= start && t < start + QUARTER_MS).length });
      }
    }
    // Séjours terminés : visiteurs sortis à la fin de leur dernier passage de la journée
    const finished = [...stays.entries()].filter(([id]) => !openSince.has(id)).map(([, ms]) => ms);
    const visitors = firstIn.size;
    const totalEntries = [...entries.values()].reduce((a, b) => a + b, 0);

    return {
      day,
      arrivals: visitors,
      arrivalsByQuarter: byQuarter,
      firstArrival: arrivalTimes[0] ?? null,
      lastArrival: arrivalTimes[arrivalTimes.length - 1] ?? null,
      half: quantile(arrivalTimes, 0.5),
      ninety: quantile(arrivalTimes, 0.9),
      exitsByHour,
      averageStayMs: finished.length ? finished.reduce((a, b) => a + b, 0) / finished.length : null,
      averageEntries: visitors ? totalEntries / visitors : null,
    };
  });
}

// ─── Contrôle (F-74) : nomme les agents, n'entre donc pas dans le bilan anonyme ──

export interface ControlStats {
  byAgent: { agentId: string; agentName: string; entries: number; exits: number; refusals: number }[];
  byStation: { stationId: string; entries: number; exits: number; refusals: number }[];
  byMethod: Record<ScanMethod, number>;
  refusals: { unknown: number; alreadyInside: number };
  offlineDuplicates: number;
  /** Passages enregistrés hors ligne puis synchronisés (doublons compris). */
  offline: number;
}

export function controlStats(passages: Passage[], refusals: Refusal[]): ControlStats {
  const scans = passages.filter((p) => p.origin !== 'closing');
  const agents = new Map<string, ControlStats['byAgent'][number]>();
  const stations = new Map<string, ControlStats['byStation'][number]>();
  const agent = (id: string, name: string) => {
    let a = agents.get(id);
    if (!a) agents.set(id, (a = { agentId: id, agentName: name, entries: 0, exits: 0, refusals: 0 }));
    return a;
  };
  const station = (id: string) => {
    let s = stations.get(id);
    if (!s) stations.set(id, (s = { stationId: id, entries: 0, exits: 0, refusals: 0 }));
    return s;
  };
  const byMethod: Record<ScanMethod, number> = { camera: 0, scanner: 0, search: 0, manual: 0 };

  for (const p of scans) {
    const key = p.direction === 'in' ? 'entries' : 'exits';
    agent(p.agentId, p.agentName)[key]++;
    station(p.stationId)[key]++;
    byMethod[p.method]++;
  }
  for (const r of refusals) {
    agent(r.agentId, r.agentName).refusals++;
    station(r.stationId).refusals++;
    byMethod[r.method]++;
  }
  const total = (x: { entries: number; exits: number; refusals: number }) => x.entries + x.exits + x.refusals;
  return {
    byAgent: [...agents.values()].sort((a, b) => total(b) - total(a)),
    byStation: [...stations.values()].sort((a, b) => total(b) - total(a)),
    byMethod,
    refusals: {
      unknown: refusals.filter((r) => r.reason === 'unknown').length,
      alreadyInside: refusals.filter((r) => r.reason === 'already-inside').length,
    },
    offlineDuplicates: passages.filter((p) => p.offlineDuplicate).length,
    offline: passages.filter((p) => p.origin === 'offline').length,
  };
}
