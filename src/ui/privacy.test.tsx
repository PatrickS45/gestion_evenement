// Rendu des composants de protection des données, sans navigateur : contenu affiché et absence d'erreur.
import { renderToStaticMarkup } from 'react-dom/server';
import { makeEvent, makeParticipant, makePassage } from '../domain/fixtures';
import { anonymousReport } from '../domain/report';
import { PublicPrivacyNotice, RetentionBanner } from './privacy';
import { ReportView } from './ReportView';

const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('affichage de la protection des données', () => {
  it('information du public : responsable, base légale, date d\'effacement, contact (NF-32)', () => {
    const html = text(renderToStaticMarkup(<PublicPrivacyNotice privacy={{
      controller: 'Salon Pro SAS', contact: 'dpo@salon.fr', legalBasis: 'contract', retentionMonths: 3, details: 'Aucun transfert.', purgeDay: '2027-06-12',
    }} />));
    for (const expected of ['Salon Pro SAS', 'Exécution d\'un contrat', '3 mois', '12 juin 2027', 'dpo@salon.fr', 'Aucun transfert.', 'CNIL']) {
      expect(html).toContain(expected);
    }
  });

  it('rappel avant la purge pour les administrateurs, rien pour les agents ni hors période (NF-33)', () => {
    const event = makeEvent({ endDate: '2027-03-12' });
    expect(text(renderToStaticMarkup(<RetentionBanner event={event} role="admin" today="2027-06-01" />))).toContain('effacées le 12 juin 2027');
    expect(renderToStaticMarkup(<RetentionBanner event={event} role="agent" today="2027-06-01" />)).toBe('');
    expect(renderToStaticMarkup(<RetentionBanner event={event} role="admin" today="2027-04-01" />)).toBe('');
    expect(text(renderToStaticMarkup(<RetentionBanner event={{ ...event, purgedAt: '2027-06-12T01:00:00.000Z' }} role="owner" />))).toContain('purgées le 12 juin 2027');
  });

  it('bilan anonyme : chiffres, types et journées (F-77)', () => {
    const report = anonymousReport(
      makeEvent({ name: 'Salon', capacity: 10 }),
      [makeParticipant({ id: 'a', typeId: 'magasin', entryCount: 1 }), makeParticipant({ id: 'b', typeId: 'exposant' })],
      [makePassage('a', 'in', '2027-03-11T08:00:00.000Z', { typeId: 'magasin' })],
      [], '2027-06-12T01:00:00.000Z', 'purge',
    );
    const html = text(renderToStaticMarkup(<ReportView report={report} />));
    expect(html).toContain('Bilan — Salon');
    expect(html).toContain('Inscrits 2');
    expect(html).toContain('Jour 1');
    expect(html).toContain('sans donnée personnelle');
    expect(html).toContain('Première arrivée');
    expect(html).toContain('50 % des visiteurs arrivés à');
  });
});
