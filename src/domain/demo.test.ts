import { buildDemo, DEMO_COUNTS } from './demo';
import { replayPassages } from './attendance';
import { parisDay, toMs } from './time';

// Un jeudi de mars, 15 h 20 à Paris
const NOW = new Date('2027-03-11T14:20:00Z').getTime();

describe('buildDemo', () => {
  const demo = buildDemo('evt', NOW);

  it('crée 1 100 inscrits répartis sur les trois types, aux emails uniques', () => {
    expect(demo.participants).toHaveLength(1100);
    for (const [type, n] of Object.entries(DEMO_COUNTS)) {
      expect(demo.participants.filter((p) => p.typeId === type)).toHaveLength(n);
    }
    expect(new Set(demo.participants.map((p) => p.email)).size).toBe(1100);
    expect(new Set(demo.participants.map((p) => p.token)).size).toBe(1100);
  });

  it('n\'enregistre aucun passage ni refus dans le futur', () => {
    expect(demo.passages.every((p) => toMs(p.at) <= NOW)).toBe(true);
    expect(demo.refusals.every((r) => toMs(r.at) <= NOW)).toBe(true);
  });

  it('couvre deux journées : hier, clôturée, et aujourd\'hui en cours', () => {
    const r = replayPassages(demo.passages);
    expect(r.days.map((d) => d.day)).toEqual(['2027-03-10', parisDay(NOW)]);
    const yesterday = demo.passages.filter((p) => parisDay(p.at) === '2027-03-10');
    expect(yesterday.some((p) => p.origin === 'closing')).toBe(true);
    // À la fin de la veille, plus personne dans la salle
    expect(r.days[0]!.entries).toBe(r.days[0]!.exits);
  });

  it('est cohérente : le journal rejoué donne exactement les présents (RG-02)', () => {
    const r = replayPassages(demo.passages);
    const inside = demo.participants.filter((p) => p.inside).map((p) => p.id).sort();
    expect([...r.insideIds].sort()).toEqual(inside);
  });

  it('montre une salle animée, sous la jauge, avec des refus et des retours', () => {
    const present = demo.participants.filter((p) => p.inside).length;
    expect(present).toBeGreaterThan(400);
    expect(present).toBeLessThan(1100);
    expect(demo.participants.some((p) => p.entryCount >= 2)).toBe(true);
    expect(demo.refusals.length).toBeGreaterThan(0);
  });

  it('donne les mêmes participants et QR codes sur tous les appareils, à toute heure', () => {
    const later = buildDemo('autre', NOW + 5 * 3600_000);
    expect(later.participants.map((p) => [p.firstName, p.lastName, p.company, p.token]))
      .toEqual(demo.participants.map((p) => [p.firstName, p.lastName, p.company, p.token]));
    for (const p of demo.participants) expect(p.token).toMatch(/^[0-9a-f]{40}$/);
  });

  it('est reproductible', () => {
    const again = buildDemo('evt', NOW);
    expect(again.passages.length).toBe(demo.passages.length);
    expect(again.participants.map((p) => p.email)).toEqual(demo.participants.map((p) => p.email));
  });
});
