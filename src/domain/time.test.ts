import { parisDay, parisOffsetMs } from './time';

const intlDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

describe('parisDay — sans Intl, pour le serveur', () => {
  it('donne le même jour que Intl, d\'heure en heure sur cinq ans', () => {
    const start = Date.UTC(2026, 0, 1);
    for (let t = start; t < Date.UTC(2031, 0, 1); t += 3_600_000 + 7 * 60_000) {
      expect(parisDay(t), new Date(t).toISOString()).toBe(intlDay.format(new Date(t)));
    }
  });

  it('suit les changements d\'heure à 01:00 temps universel, le dernier dimanche de mars et d\'octobre', () => {
    expect(parisOffsetMs(Date.parse('2027-03-28T00:59:59Z'))).toBe(3_600_000);
    expect(parisOffsetMs(Date.parse('2027-03-28T01:00:00Z'))).toBe(7_200_000);
    expect(parisOffsetMs(Date.parse('2027-10-31T00:59:59Z'))).toBe(7_200_000);
    expect(parisOffsetMs(Date.parse('2027-10-31T01:00:00Z'))).toBe(3_600_000);
    expect(parisDay('2027-07-14T22:30:00Z')).toBe('2027-07-15'); // minuit et demi à Paris
    expect(parisDay('2027-01-14T22:30:00Z')).toBe('2027-01-14'); // 23 h 30 à Paris
  });
});
