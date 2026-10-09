import { liveView, quarterCurve, replayPassages } from './attendance';
import { makeEvent, makeParticipant, makePassage } from './fixtures';

// 11 mars 2027 : Paris est en UTC+1 (heure d'hiver)
const at = (hhmm: string, day = '11') => `2027-03-${day}T${hhmm}:00+01:00`;

describe('replayPassages', () => {
  it('compte les présents, le pic et les visiteurs différents (RG-01, RG-03, RG-04)', () => {
    const r = replayPassages([
      makePassage('a', 'in', at('09:00')),
      makePassage('b', 'in', at('09:05')),
      makePassage('c', 'in', at('09:10')),
      makePassage('a', 'out', at('10:00')),
      makePassage('a', 'in', at('11:00')),
      makePassage('b', 'out', at('12:00')),
    ]);
    expect([...r.insideIds].sort()).toEqual(['a', 'c']);
    expect(r.peak.value).toBe(3);
    expect(r.days).toHaveLength(1);
    expect(r.days[0]).toMatchObject({ day: '2027-03-11', entries: 4, exits: 2, visitors: 3, peak: 3 });
  });

  it('trie le journal par heure, quel que soit l\'ordre d\'arrivée (synchronisation hors ligne)', () => {
    const r = replayPassages([
      makePassage('a', 'out', at('10:00')),
      makePassage('a', 'in', at('09:00')),
    ]);
    expect(r.insideIds.size).toBe(0);
    expect(r.days[0]!.exits).toBe(1);
  });

  it('ignore les doublons hors ligne et les passages incohérents', () => {
    const r = replayPassages([
      makePassage('a', 'in', at('09:00')),
      makePassage('a', 'in', at('09:01'), { offlineDuplicate: true }),
      makePassage('a', 'in', at('09:02')),
      makePassage('b', 'out', at('09:03')),
    ]);
    expect(r.insideIds.size).toBe(1);
    expect(r.days[0]).toMatchObject({ entries: 1, exits: 0 });
  });

  it('sépare les journées à minuit heure de Paris (RG-05)', () => {
    const r = replayPassages([
      makePassage('a', 'in', '2027-03-11T22:30:00Z'), // 23:30 à Paris, jour 1
      makePassage('b', 'in', '2027-03-11T23:30:00Z'), // 00:30 à Paris, jour 2
    ]);
    expect(r.days.map((d) => d.day)).toEqual(['2027-03-11', '2027-03-12']);
    // a reste présent à minuit : il compte encore dans le pic du jour 2
    expect(r.days[1]!.peak).toBe(2);
  });
});

describe('quarterCurve', () => {
  it('donne le maximum de présents par quart d\'heure, en reportant la valeur des tranches sans passage', () => {
    const r = replayPassages([
      makePassage('a', 'in', at('09:02')),
      makePassage('b', 'in', at('09:05')),
      makePassage('a', 'out', at('09:10')),
      makePassage('c', 'in', at('09:50')),
    ]);
    const curve = quarterCurve(r.timeline, '2027-03-11', new Date(at('09:55')).getTime());
    expect(curve.map((c) => c.present)).toEqual([2, 1, 1, 2]);
  });
});

describe('liveView', () => {
  it('agrège par type et vérifie la cohérence avec le journal (RG-02)', () => {
    const event = makeEvent({ capacity: 4 });
    const participants = [
      makeParticipant({ id: 'a', typeId: 'visiteur', inside: true, entryCount: 1, company: 'Maison A' }),
      makeParticipant({ id: 'b', typeId: 'exposant', inside: true, entryCount: 2, company: 'Stand B' }),
      makeParticipant({ id: 'c', typeId: 'exposant', inside: false, entryCount: 0, company: 'stand  b' }),
      makeParticipant({ id: 'd', typeId: 'magasin', inside: true, entryCount: 1, company: 'Enseigne D' }),
    ];
    const passages = [
      makePassage('a', 'in', at('09:00'), { typeId: 'visiteur' }),
      makePassage('b', 'in', at('09:00'), { typeId: 'exposant' }),
      makePassage('b', 'out', at('10:00'), { typeId: 'exposant' }),
      makePassage('b', 'in', at('11:00'), { typeId: 'exposant' }),
      makePassage('d', 'in', at('11:30'), { typeId: 'magasin' }),
    ];
    const v = liveView(event, participants, passages, new Date(at('12:00')).getTime());

    expect(v.present).toBe(3);
    expect(v.consistent).toBe(true);
    expect(v.level).toBe('normal'); // 3 / 4 = 75 %, sous le seuil de 80 %

    const exposant = v.byType.find((t) => t.id === 'exposant')!;
    expect(exposant).toMatchObject({ registered: 2, came: 1, present: 1, entriesToday: 2, exitsToday: 1 });
    expect(exposant.companies).toBe(1); // « Stand B » et « stand  b » : même structure
    expect(v.today).toMatchObject({ entries: 4, exits: 1, visitors: 3, peak: 3 });
    expect(v.recent[0]!.participantId).toBe('d');
  });

  it('signale une incohérence entre présents et journal', () => {
    const v = liveView(makeEvent(), [makeParticipant({ id: 'a', inside: true })], [], Date.now());
    expect(v.consistent).toBe(false);
  });

  it('niveau de jauge selon les seuils de l\'événement', () => {
    const inside = (n: number) => Array.from({ length: n }, (_, i) => makeParticipant({ id: `p${i}`, inside: true }));
    const now = Date.now();
    expect(liveView(makeEvent({ capacity: 10 }), inside(8), [], now).level).toBe('attention');
    expect(liveView(makeEvent({ capacity: 10 }), inside(10), [], now).level).toBe('critical');
    expect(liveView(makeEvent({ capacity: 10 }), inside(11), [], now).level).toBe('over');
  });
});
