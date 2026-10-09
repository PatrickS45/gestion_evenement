import { applyScan, decideScan, decisionMessage, type ScanContext } from './scan';
import { makeParticipant } from './fixtures';

const ctx: ScanContext = {
  eventId: 'evt', at: '2027-03-11T09:00:00.000Z', agentId: 'a1', agentName: 'Agent 1',
  stationId: 'poste-1', method: 'camera', origin: 'online', passageId: 'ps-1',
};

describe('decideScan — tableau F-52', () => {
  it('jeton inconnu : refus', () => {
    expect(decideScan(undefined, 'in')).toEqual({ result: 'refused', reason: 'unknown' });
    expect(decideScan(undefined, 'out')).toEqual({ result: 'refused', reason: 'unknown' });
  });

  it('jeton révoqué : traité comme inconnu (RG-06)', () => {
    expect(decideScan(makeParticipant({ tokenRevoked: true }), 'in')).toEqual({ result: 'refused', reason: 'unknown' });
  });

  it('entrée d\'un participant jamais venu : première entrée', () => {
    expect(decideScan(makeParticipant(), 'in')).toEqual({ result: 'accepted', direction: 'in', firstEntry: true, entryNumber: 1 });
  });

  it('entrée d\'un participant sorti : retour numéroté', () => {
    const p = makeParticipant({ entryCount: 2, inside: false });
    expect(decideScan(p, 'in')).toEqual({ result: 'accepted', direction: 'in', firstEntry: false, entryNumber: 3 });
  });

  it('entrée d\'un participant déjà présent : refus avec l\'heure', () => {
    const p = makeParticipant({ inside: true, entryCount: 1, lastMoveAt: '2027-03-11T08:30:00.000Z' });
    expect(decideScan(p, 'in')).toEqual({ result: 'refused', reason: 'already-inside', since: '2027-03-11T08:30:00.000Z' });
  });

  it('sortie d\'un présent : acceptée', () => {
    expect(decideScan(makeParticipant({ inside: true, entryCount: 1 }), 'out')).toEqual({ result: 'accepted', direction: 'out' });
  });

  it('sortie d\'un absent ou jamais venu : avertissement', () => {
    expect(decideScan(makeParticipant(), 'out')).toEqual({ result: 'warning', reason: 'not-inside' });
    expect(decideScan(makeParticipant({ entryCount: 3 }), 'out')).toEqual({ result: 'warning', reason: 'not-inside' });
  });
});

describe('applyScan', () => {
  it('première entrée : présent, compteur et dates renseignés, passage journalisé', () => {
    const p = makeParticipant({ typeId: 'exposant' });
    const r = applyScan(p, decideScan(p, 'in'), ctx)!;
    expect(r.participant).toMatchObject({ inside: true, entryCount: 1, firstEntryAt: ctx.at, lastMoveAt: ctx.at });
    expect(r.passage).toMatchObject({ participantId: 'p1', typeId: 'exposant', direction: 'in', at: ctx.at, agentId: 'a1', origin: 'online' });
  });

  it('retour : la date de première entrée est conservée', () => {
    const p = makeParticipant({ entryCount: 1, firstEntryAt: '2027-03-11T08:00:00.000Z' });
    const r = applyScan(p, decideScan(p, 'in'), ctx)!;
    expect(r.participant.firstEntryAt).toBe('2027-03-11T08:00:00.000Z');
    expect(r.participant.entryCount).toBe(2);
  });

  it('sortie : le participant n\'est plus présent', () => {
    const p = makeParticipant({ inside: true, entryCount: 1 });
    const r = applyScan(p, decideScan(p, 'out'), ctx)!;
    expect(r.participant.inside).toBe(false);
    expect(r.passage.direction).toBe('out');
  });

  it('refus et avertissements : aucun passage', () => {
    const p = makeParticipant({ inside: true });
    expect(applyScan(p, decideScan(p, 'in'), ctx)).toBeNull();
    const q = makeParticipant();
    expect(applyScan(q, decideScan(q, 'out'), ctx)).toBeNull();
  });
});

describe('decisionMessage', () => {
  const fmt = () => '09:30';
  it('formule chaque cas', () => {
    expect(decisionMessage({ result: 'accepted', direction: 'in', firstEntry: true, entryNumber: 1 }, 'Léa', fmt)).toBe('Bienvenue Léa');
    expect(decisionMessage({ result: 'accepted', direction: 'in', firstEntry: false, entryNumber: 3 }, 'Léa', fmt)).toBe('Bon retour Léa (3e entrée)');
    expect(decisionMessage({ result: 'refused', reason: 'already-inside', since: 'x' }, 'Léa', fmt)).toBe('Léa est déjà dans la salle depuis 09:30');
    expect(decisionMessage({ result: 'refused', reason: 'unknown' }, '', fmt)).toBe('QR code non reconnu');
  });
});
