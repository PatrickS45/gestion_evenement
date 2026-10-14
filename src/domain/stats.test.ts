import { makePassage } from './fixtures';
import type { Refusal } from './model';
import { controlStats, dailyFlows, parisHour } from './stats';

// 11 mars 2027 : heure d'hiver, Paris = UTC + 1
const at = (hhmm: string, day = '11') => `2027-03-${day}T${hhmm}:00.000Z`;

describe('affluence et comportement par journée (F-71, F-72)', () => {
  const journal = [
    makePassage('a', 'in', at('08:00'), { stationId: 'p1' }), // 9 h à Paris
    makePassage('b', 'in', at('08:10')),
    makePassage('c', 'in', at('08:20')),
    makePassage('d', 'in', at('09:40')),
    makePassage('a', 'out', at('10:00')), // séjour de a : 2 h
    makePassage('a', 'in', at('11:00')), // retour : pas une nouvelle arrivée
    makePassage('a', 'out', at('11:30')), // a : 2 h 30 au total
    makePassage('b', 'out', at('09:10')), // b : 1 h
    makePassage('b', 'in', at('09:12', '11'), { origin: 'offline', offlineDuplicate: true }), // doublon écarté
    makePassage('c', 'out', at('17:00'), { origin: 'closing' }), // c : 8 h 40, clôture hors répartition
    // d reste dans la salle : séjour non terminé
    makePassage('a', 'in', at('08:30', '12')),
  ];
  const [day1, day2] = dailyFlows(journal);

  it('arrivées : première entrée de chacun, par quart d\'heure, première et dernière', () => {
    expect(day1).toMatchObject({ day: '2027-03-11', arrivals: 4, firstArrival: Date.parse(at('08:00')), lastArrival: Date.parse(at('09:40')) });
    expect(day1!.arrivalsByQuarter.map((q) => q.count)).toEqual([2, 1, 0, 0, 0, 0, 1]); // 8:00, 8:15 … 9:30
    expect(day1!.arrivalsByQuarter.reduce((s, q) => s + q.count, 0)).toBe(4);
  });

  it('heure à laquelle 50 % et 90 % des visiteurs du jour étaient arrivés', () => {
    expect(day1!.half).toBe(Date.parse(at('08:10'))); // 2e arrivée sur 4
    expect(day1!.ninety).toBe(Date.parse(at('09:40'))); // 4e sur 4
  });

  it('durée moyenne de présence sur les séjours terminés, entrées par visiteur, sorties par heure de Paris', () => {
    const minutes = (ms: number | null) => (ms === null ? null : ms / 60_000);
    expect(minutes(day1!.averageStayMs)).toBe((150 + 60 + 520) / 3); // a, b, c ; d encore là
    expect(day1!.averageEntries).toBe(5 / 4);
    expect(day1!.exitsByHour[10]).toBe(1); // b sort à 10 h 10, heure de Paris
    expect(day1!.exitsByHour[11]).toBe(1); // a à 11 h
    expect(day1!.exitsByHour[12]).toBe(1); // a à 12 h 30
    expect(day1!.exitsByHour.reduce((s, n) => s + n, 0)).toBe(3); // la clôture n'est pas comptée
  });

  it('chaque journée est calculée à part (RG-05)', () => {
    expect(day2).toMatchObject({ day: '2027-03-12', arrivals: 1, averageStayMs: null, averageEntries: 1 });
  });

  it('heure de Paris en été comme en hiver', () => {
    expect(parisHour(Date.parse('2027-03-11T08:00:00Z'))).toBe(9);
    expect(parisHour(Date.parse('2027-07-11T08:00:00Z'))).toBe(10);
  });
});

describe('contrôle (F-74)', () => {
  const refusal = (over: Partial<Refusal>): Refusal => ({
    id: 'r', eventId: 'evt', reason: 'unknown', at: at('09:00'), agentId: 'ag1', agentName: 'Bruno', stationId: 'entree',
    method: 'camera', participantId: null, sample: '', ...over,
  });

  it('passages par agent et par poste, moyens d\'identification, refus, hors ligne et doublons', () => {
    const s = controlStats([
      makePassage('a', 'in', at('08:00'), { agentId: 'ag1', agentName: 'Bruno', stationId: 'entree', method: 'camera' }),
      makePassage('b', 'in', at('08:01'), { agentId: 'ag1', agentName: 'Bruno', stationId: 'entree', method: 'scanner' }),
      makePassage('a', 'out', at('09:00'), { agentId: 'ag2', agentName: 'Chloé', stationId: 'sortie', method: 'search' }),
      makePassage('c', 'in', at('09:05'), { agentId: 'ag2', agentName: 'Chloé', stationId: 'sortie', origin: 'offline', offlineDuplicate: true }),
      makePassage('b', 'out', at('18:00'), { agentId: 'ag3', agentName: 'Claire', stationId: 'bureau', method: 'manual', origin: 'closing' }),
    ], [refusal({}), refusal({ reason: 'already-inside', agentId: 'ag2', agentName: 'Chloé', stationId: 'sortie', method: 'manual' })]);

    expect(s.byAgent).toEqual([
      { agentId: 'ag1', agentName: 'Bruno', entries: 2, exits: 0, refusals: 1 },
      { agentId: 'ag2', agentName: 'Chloé', entries: 1, exits: 1, refusals: 1 },
    ]); // la clôture n'est pas un scan
    expect(s.byStation.map((x) => [x.stationId, x.entries, x.exits, x.refusals])).toEqual([['entree', 2, 0, 1], ['sortie', 1, 1, 1]]);
    expect(s.byMethod).toEqual({ camera: 3, scanner: 1, search: 1, manual: 1 });
    expect(s.refusals).toEqual({ unknown: 1, alreadyInside: 1 });
    expect([s.offline, s.offlineDuplicates]).toEqual([1, 1]);
  });
});
