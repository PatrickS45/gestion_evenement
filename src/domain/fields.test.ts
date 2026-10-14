import { checkAnswers, fieldStats, fieldsFor, normalizeFields, type CustomField } from './fields';

const fields: CustomField[] = [
  { id: 'pdv', label: 'Nombre de points de vente', kind: 'number', options: [], required: true, typeIds: ['magasin'] },
  { id: 'region', label: 'Région', kind: 'choice', options: ['Centre', 'Bretagne', 'Autre'], required: false, typeIds: [] },
  { id: 'dej', label: 'Déjeuner sur place', kind: 'checkbox', options: [], required: false, typeIds: [] },
  { id: 'note', label: 'Remarque', kind: 'text', options: [], required: false, typeIds: [] },
];

describe('champs personnalisés (F-33)', () => {
  it('vérifie la définition : libellé, type, au moins deux choix, identifiants uniques', () => {
    expect(normalizeFields([
      { id: 'a', label: ' Région ', kind: 'choice', options: ['Centre', 'Centre', ' Autre ', ''] },
      { id: 'b', label: '', kind: 'text' },
      { id: 'c', label: 'Liste vide', kind: 'choice', options: ['Seul'] },
      { id: 'a', label: 'Doublon', kind: 'text' },
      { id: 'd', label: 'Inconnu', kind: 'date' },
      { id: 'e', label: 'Nombre', kind: 'number', required: true, typeIds: ['magasin'] },
    ])).toEqual([
      { id: 'a', label: 'Région', kind: 'choice', options: ['Centre', 'Autre'], required: false, typeIds: [] },
      { id: 'e', label: 'Nombre', kind: 'number', options: [], required: true, typeIds: ['magasin'] },
    ]);
    expect(normalizeFields('n/a')).toEqual([]);
  });

  it('ne demande que les champs du type du participant', () => {
    expect(fieldsFor(fields, 'magasin').map((f) => f.id)).toEqual(['pdv', 'region', 'dej', 'note']);
    expect(fieldsFor(fields, 'exposant').map((f) => f.id)).toEqual(['region', 'dej', 'note']);
  });

  it('convertit et vérifie les réponses ; ignore les champs qui ne concernent pas le type', () => {
    expect(checkAnswers(fields, 'magasin', { pdv: '12', region: 'Centre', dej: true, note: '  RAS ', autre: 'x' }))
      .toEqual({ answers: { pdv: 12, region: 'Centre', dej: true, note: 'RAS' }, error: null });
    expect(checkAnswers(fields, 'exposant', { pdv: 3 })).toEqual({ answers: {}, error: null });
    expect(checkAnswers(fields, 'magasin', { pdv: '2,5', region: 'Mars' })).toEqual({ answers: { pdv: 2.5 }, error: null });
  });

  it('refuse un champ obligatoire manquant ou un nombre invalide', () => {
    expect(checkAnswers(fields, 'magasin', {}).error).toBe('Renseignez « Nombre de points de vente »');
    expect(checkAnswers(fields, 'magasin', { pdv: 'beaucoup' }).error).toBe('« Nombre de points de vente » doit être un nombre');
    const mustCheck: CustomField[] = [{ id: 'ok', label: 'Charte', kind: 'checkbox', options: [], required: true, typeIds: [] }];
    expect(checkAnswers(mustCheck, 'x', { ok: false }).error).toBe('Cochez « Charte »');
  });
});

describe('répartition des réponses (F-73)', () => {
  it('compte les choix et les cases, résume les nombres, ne reprend pas les textes', () => {
    const stats = fieldStats(fields, [
      { typeId: 'magasin', answers: { pdv: 10, region: 'Centre', dej: true, note: 'Léa Petit, 06…' } },
      { typeId: 'magasin', answers: { pdv: 4, region: 'Centre' } },
      { typeId: 'exposant', answers: { region: 'Autre', dej: true } },
    ]);
    expect(stats.find((s) => s.fieldId === 'pdv')).toMatchObject({ asked: 2, answered: 2, numbers: { sum: 14, average: 7, min: 4, max: 10 } });
    expect(stats.find((s) => s.fieldId === 'region')!.counts).toEqual([{ value: 'Centre', count: 2 }, { value: 'Bretagne', count: 0 }, { value: 'Autre', count: 1 }]);
    expect(stats.find((s) => s.fieldId === 'dej')).toMatchObject({ asked: 3, answered: 2, counts: [{ value: 'Oui', count: 2 }] });
    expect(JSON.stringify(stats)).not.toContain('Léa');
  });
});
