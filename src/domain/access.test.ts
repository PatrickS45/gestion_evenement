import { can } from './access';

describe('droits par rôle (section 3)', () => {
  it('l\'agent d\'accueil scanne mais n\'exporte ni ne modifie', () => {
    expect(can('agent', 'scan')).toBe(true);
    expect(can('agent', 'stats.export')).toBe(false);
    expect(can('agent', 'participants.manage')).toBe(false);
    expect(can('agent', 'event.edit')).toBe(false);
    expect(can('agent', 'day.close')).toBe(false);
  });

  it('l\'administrateur gère événements, participants et exports, sans supprimer ni gérer les membres', () => {
    expect(can('admin', 'event.create')).toBe(true);
    expect(can('admin', 'participants.manage')).toBe(true);
    expect(can('admin', 'stats.export')).toBe(true);
    expect(can('admin', 'event.delete')).toBe(false);
    expect(can('admin', 'members.manage')).toBe(false);
  });

  it('le propriétaire peut tout faire', () => {
    expect(can('owner', 'event.delete')).toBe(true);
    expect(can('owner', 'members.manage')).toBe(true);
  });

  it('sans rôle, aucun droit', () => {
    expect(can(null, 'scan')).toBe(false);
    expect(can(undefined, 'scan')).toBe(false);
  });
});
