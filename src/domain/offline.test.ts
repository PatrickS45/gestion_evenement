import { replayPassages } from './attendance';
import { makeParticipant, makePassage } from './fixtures';
import { reconcile, replayParticipant } from './offline';

const at = (hhmm: string) => `2027-03-11T${hhmm}:00.000Z`;
const offline = { origin: 'offline' as const };

describe('replayParticipant — présence par le dernier passage utile (RG-01)', () => {
  it('journal sans conflit : entrées et sorties alternées, rien n\'est doublon', () => {
    const r = replayParticipant([
      makePassage('p1', 'in', at('09:00'), { id: 'a' }),
      makePassage('p1', 'out', at('10:00'), { id: 'b' }),
      makePassage('p1', 'in', at('11:00'), { id: 'c' }),
    ]);
    expect(r).toEqual({ inside: true, entryCount: 2, firstEntryAt: at('09:00'), lastMoveAt: at('11:00'), duplicates: new Set() });
  });

  it('rejoue dans l\'ordre de l\'heure réelle, pas dans l\'ordre d\'arrivée', () => {
    const r = replayParticipant([
      makePassage('p1', 'in', at('11:00'), { id: 'c' }),
      makePassage('p1', 'out', at('10:00'), { id: 'b', ...offline }),
      makePassage('p1', 'in', at('09:00'), { id: 'a', ...offline }),
    ]);
    expect(r).toMatchObject({ inside: true, entryCount: 2, firstEntryAt: at('09:00'), lastMoveAt: at('11:00') });
    expect(r.duplicates.size).toBe(0);
  });

  it('deux entrées sans sortie : la seconde est le doublon (F-63)', () => {
    const r = replayParticipant([
      makePassage('p1', 'in', at('09:05'), { id: 'poste2', ...offline }),
      makePassage('p1', 'in', at('09:00'), { id: 'poste1', ...offline }),
    ]);
    expect(r).toMatchObject({ inside: true, entryCount: 1, firstEntryAt: at('09:00'), lastMoveAt: at('09:00') });
    expect([...r.duplicates]).toEqual(['poste2']);
  });

  it('sortie d\'une personne déjà sortie : doublon, la présence ne change pas', () => {
    const r = replayParticipant([
      makePassage('p1', 'in', at('09:00'), { id: 'a' }),
      makePassage('p1', 'out', at('12:00'), { id: 'b', ...offline }),
      makePassage('p1', 'out', at('12:01'), { id: 'c', ...offline }),
    ]);
    expect(r).toMatchObject({ inside: false, entryCount: 1, lastMoveAt: at('12:00') });
    expect([...r.duplicates]).toEqual(['c']);
  });

  it('sortie de clôture après une sortie hors ligne : la clôture ne compte pas', () => {
    const r = replayParticipant([
      makePassage('p1', 'in', at('09:00'), { id: 'a' }),
      makePassage('p1', 'out', at('18:00'), { id: 'cloture', origin: 'closing' }),
      makePassage('p1', 'out', at('17:30'), { id: 'b', ...offline }),
    ]);
    expect(r).toMatchObject({ inside: false, lastMoveAt: at('17:30') });
    expect([...r.duplicates]).toEqual(['cloture']);
  });

  it('même milliseconde sur deux postes : départage stable par identifiant', () => {
    const r = replayParticipant([
      makePassage('p1', 'in', at('09:00'), { id: 'y' }),
      makePassage('p1', 'in', at('09:00'), { id: 'x' }),
    ]);
    expect([...r.duplicates]).toEqual(['y']);
  });
});

describe('reconcile — intégration des passages d\'un poste hors ligne (F-61, F-63)', () => {
  const lea = makeParticipant({ id: 'p1' });

  it('ajoute les passages reçus et met à jour la présence du participant', () => {
    const r = reconcile(lea, [], [
      makePassage('p1', 'in', at('09:00'), { id: 'a', ...offline }),
      makePassage('p1', 'out', at('10:00'), { id: 'b', ...offline }),
    ]);
    expect(r.participant).toMatchObject({ inside: false, entryCount: 1, firstEntryAt: at('09:00'), lastMoveAt: at('10:00') });
    expect(r.added.map((p) => [p.id, p.offlineDuplicate])).toEqual([['a', false], ['b', false]]);
    expect(r.changed).toEqual([]);
  });

  it('un lot renvoyé après une coupure n\'est compté qu\'une fois', () => {
    const batch = [makePassage('p1', 'in', at('09:00'), { id: 'a', ...offline })];
    const first = reconcile(lea, [], batch);
    const again = reconcile(first.participant, first.added, batch);
    expect(again.added).toEqual([]);
    expect(again.changed).toEqual([]);
    expect(again.participant).toEqual(first.participant);
  });

  it('un passage en double dans le même lot n\'est ajouté qu\'une fois', () => {
    const p = makePassage('p1', 'in', at('09:00'), { id: 'a', ...offline });
    expect(reconcile(lea, [], [p, p]).added).toHaveLength(1);
  });

  it('entrée hors ligne plus ancienne qu\'une entrée en ligne : l\'entrée en ligne devient le doublon', () => {
    const online = makePassage('p1', 'in', at('09:05'), { id: 'en-ligne' });
    const inside = { ...lea, inside: true, entryCount: 1, firstEntryAt: at('09:05'), lastMoveAt: at('09:05') };
    const r = reconcile(inside, [online], [makePassage('p1', 'in', at('09:00'), { id: 'hors-ligne', ...offline })]);
    expect(r.added.map((p) => [p.id, p.offlineDuplicate])).toEqual([['hors-ligne', false]]);
    expect(r.changed).toEqual([{ ...online, offlineDuplicate: true }]);
    expect(r.participant).toMatchObject({ inside: true, entryCount: 1, firstEntryAt: at('09:00'), lastMoveAt: at('09:00') });
  });

  it('une sortie reçue en retard rend valide une entrée jusque-là doublon', () => {
    const known = [
      makePassage('p1', 'in', at('09:00'), { id: 'a' }),
      makePassage('p1', 'in', at('11:00'), { id: 'b', ...offline, offlineDuplicate: true }),
    ];
    const r = reconcile({ ...lea, inside: true, entryCount: 1 }, known, [makePassage('p1', 'out', at('10:00'), { id: 'c', ...offline })]);
    expect(r.changed).toEqual([{ ...known[1]!, offlineDuplicate: false }]);
    expect(r.participant).toMatchObject({ inside: true, entryCount: 2, lastMoveAt: at('11:00') });
  });

  it('le comptage reste égal au rejeu du journal complet (RG-02)', () => {
    // Deux postes coupés du réseau scannent les mêmes personnes, puis se synchronisent l'un après l'autre
    const poste1 = [
      makePassage('p1', 'in', at('09:00'), { id: '1a', ...offline }),
      makePassage('p2', 'in', at('09:01'), { id: '1b', ...offline }),
      makePassage('p2', 'out', at('09:30'), { id: '1c', ...offline }),
    ];
    const poste2 = [
      makePassage('p1', 'in', at('09:02'), { id: '2a', ...offline }),
      makePassage('p2', 'in', at('09:40'), { id: '2b', ...offline }),
      makePassage('p3', 'in', at('09:03'), { id: '2c', ...offline }),
    ];
    const people = new Map(['p1', 'p2', 'p3'].map((id) => [id, makeParticipant({ id })]));
    const journal = new Map<string, ReturnType<typeof reconcile>['added']>();
    for (const batch of [poste1, poste2]) {
      for (const [id, person] of people) {
        const known = journal.get(id) ?? [];
        const r = reconcile(person, known, batch.filter((p) => p.participantId === id));
        const updated = known.map((p) => r.changed.find((c) => c.id === p.id) ?? p);
        journal.set(id, [...updated, ...r.added]);
        people.set(id, r.participant);
      }
    }
    const all = [...journal.values()].flat();
    expect(all.filter((p) => p.offlineDuplicate).map((p) => p.id)).toEqual(['2a']);
    const present = [...people.values()].filter((p) => p.inside).map((p) => p.id).sort();
    expect(present).toEqual(['p1', 'p2', 'p3']);
    expect([...replayPassages(all).insideIds].sort()).toEqual(present);
    expect(people.get('p2')).toMatchObject({ entryCount: 2 });
  });
});
