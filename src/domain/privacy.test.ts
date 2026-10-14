import { makeEvent, makeParticipant, makePassage } from './fixtures';
import {
  addMonths, defaultPrivacy, normalizePrivacy, privacyComplete, purgeDay, retentionState, RETENTION_DEFAULT_MONTHS,
} from './privacy';
import { anonymousReport } from './report';

describe('politique de confidentialité et conservation (NF-32, NF-33)', () => {
  it('par défaut : responsable donné, contact à renseigner, consentement, 3 mois', () => {
    expect(defaultPrivacy('Salon Pro')).toEqual({ controller: 'Salon Pro', contact: '', legalBasis: 'consent', retentionMonths: 3, details: '' });
    expect(RETENTION_DEFAULT_MONTHS).toBe(3);
  });

  it('vérifie ce que saisit l\'organisateur et garde l\'existant pour le reste', () => {
    const base = { ...defaultPrivacy('Salon Pro'), contact: 'dpo@salon.fr' };
    expect(normalizePrivacy({ retentionMonths: 6, legalBasis: 'contract' }, base)).toEqual({ ...base, retentionMonths: 6, legalBasis: 'contract' });
    expect(normalizePrivacy({ retentionMonths: 0, legalBasis: 'autre', contact: '  rgpd@x.fr  ' }, base))
      .toEqual({ ...base, contact: 'rgpd@x.fr' });
    expect(normalizePrivacy({ retentionMonths: 37 }, base).retentionMonths).toBe(3);
    expect(normalizePrivacy({ retentionMonths: 2.5 }, base).retentionMonths).toBe(3);
    expect(normalizePrivacy({ details: 'x'.repeat(5000) }, base).details).toHaveLength(2000);
  });

  it('inscriptions publiques : responsable et contact obligatoires', () => {
    expect(privacyComplete(defaultPrivacy('Salon Pro'))).toBe(false);
    expect(privacyComplete({ ...defaultPrivacy('Salon Pro'), contact: 'dpo@salon.fr' })).toBe(true);
    expect(privacyComplete({ ...defaultPrivacy(' '), contact: 'dpo@salon.fr' })).toBe(false);
  });

  it('date de purge : fin de l\'événement plus la durée choisie, au dernier jour du mois si besoin', () => {
    expect(addMonths('2027-03-12', 3)).toBe('2027-06-12');
    expect(addMonths('2027-11-30', 3)).toBe('2028-02-29');
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(purgeDay({ endDate: '2027-03-12', privacy: defaultPrivacy() })).toBe('2027-06-12');
  });

  it('rappel 15 jours avant, puis purge due ; « purgé » une fois fait', () => {
    const event = { endDate: '2027-03-12', privacy: defaultPrivacy(), purgedAt: null };
    expect(retentionState(event, '2027-05-27')).toBe('kept');
    expect(retentionState(event, '2027-05-28')).toBe('reminder');
    expect(retentionState(event, '2027-06-12')).toBe('due');
    expect(retentionState({ ...event, purgedAt: '2027-06-12T01:00:00.000Z' }, '2027-06-12')).toBe('purged');
  });
});

describe('bilan anonyme (F-77)', () => {
  const event = makeEvent({ id: 'evt', name: 'Salon', capacity: 10 });
  const participants = [
    makeParticipant({ id: 'a', firstName: 'Léa', lastName: 'Petit', email: 'lea@x.fr', company: 'Maison Petit', typeId: 'magasin', entryCount: 1, token: 'secret-a' }),
    makeParticipant({ id: 'b', firstName: 'Marc', lastName: 'Roy', email: 'marc@x.fr', company: 'maison  petit', typeId: 'magasin', token: 'secret-b' }),
    makeParticipant({ id: 'c', firstName: 'Zoé', lastName: 'Duval', email: 'zoe@x.fr', company: 'Stand Z', typeId: 'exposant', entryCount: 2, token: 'secret-c' }),
  ];
  const passages = [
    makePassage('a', 'in', '2027-03-11T08:00:00.000Z', { typeId: 'magasin', agentName: 'Bruno Agent' }),
    makePassage('c', 'in', '2027-03-11T08:10:00.000Z', { typeId: 'exposant' }),
    makePassage('c', 'out', '2027-03-11T09:00:00.000Z', { typeId: 'exposant' }),
    makePassage('c', 'in', '2027-03-12T08:00:00.000Z', { typeId: 'exposant' }),
    makePassage('c', 'in', '2027-03-12T08:01:00.000Z', { typeId: 'exposant', origin: 'offline', offlineDuplicate: true }),
  ];
  const report = anonymousReport(event, participants, passages, [], '2027-06-12T01:00:00.000Z', 'purge');

  it('chiffres agrégés : inscrits, venus, pic, par type, par jour avec la courbe', () => {
    expect(report).toMatchObject({ eventName: 'Salon', registered: 3, came: 2, peak: { value: 2, at: '2027-03-11T08:10:00.000Z' }, offlineDuplicates: 1, reason: 'purge' });
    expect(report.byType.find((t) => t.id === 'magasin')).toMatchObject({ registered: 2, came: 1, companies: 1 });
    expect(report.days.map((d) => [d.day, d.entries, d.exits, d.visitors, d.peak])).toEqual([['2027-03-11', 2, 1, 2, 2], ['2027-03-12', 1, 0, 1, 2]]);
    expect(report.days[0]!.curve[0]).toEqual({ start: '2027-03-11T08:00:00.000Z', present: 2 });
  });

  it('ne contient aucune donnée personnelle', () => {
    const json = JSON.stringify(report);
    for (const secret of ['Léa', 'Petit', 'lea@x.fr', 'Maison', 'Stand Z', 'secret-a', 'Bruno', '"a"', '"c"']) {
      expect(json, secret).not.toContain(secret);
    }
  });
});
