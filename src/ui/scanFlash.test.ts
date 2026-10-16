import { flashDuration, flashText } from './scanFlash';

const fmt = () => '09:42';

describe('flashText', () => {
  it('entrée : première entrée ou retour numéroté', () => {
    expect(flashText({ result: 'accepted', direction: 'in', firstEntry: true, entryNumber: 1 }, fmt))
      .toEqual({ tone: 'accepted', title: 'Bienvenue', detail: 'Première entrée' });
    expect(flashText({ result: 'accepted', direction: 'in', firstEntry: false, entryNumber: 3 }, fmt))
      .toEqual({ tone: 'accepted', title: 'Bon retour', detail: '3e entrée' });
  });

  it('sortie acceptée', () => {
    expect(flashText({ result: 'accepted', direction: 'out' }, fmt).title).toBe('Sortie enregistrée');
  });

  it('refus : QR inconnu, ou déjà présent avec l\'heure d\'entrée', () => {
    expect(flashText({ result: 'refused', reason: 'unknown' }, fmt)).toMatchObject({ tone: 'refused', title: 'QR code non reconnu' });
    expect(flashText({ result: 'refused', reason: 'already-inside', since: 'x' }, fmt))
      .toEqual({ tone: 'refused', title: 'Déjà dans la salle', detail: 'Entrée enregistrée à 09:42' });
    expect(flashText({ result: 'refused', reason: 'already-inside', since: null }, fmt).detail).toBe('Entrée déjà enregistrée');
  });

  it('avertissement : sortie d\'une personne absente', () => {
    expect(flashText({ result: 'warning', reason: 'not-inside' }, fmt)).toMatchObject({ tone: 'warning', title: 'Pas dans la salle' });
  });

  it('affiche plus longtemps ce qui demande une action', () => {
    expect(flashDuration('accepted')).toBeLessThan(flashDuration('refused'));
    expect(flashDuration('warning')).toBe(flashDuration('refused'));
  });
});
