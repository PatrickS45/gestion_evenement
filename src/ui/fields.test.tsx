// Rendu des champs personnalisés, sans navigateur (F-33).
import { renderToStaticMarkup } from 'react-dom/server';
import type { CustomField } from '../domain/fields';
import { DEFAULT_TYPES } from '../domain/colors';
import { FieldInput, FieldsEditor } from './fields';

const fields: CustomField[] = [
  { id: 'pdv', label: 'Nombre de points de vente', kind: 'number', options: [], required: true, typeIds: ['magasin'] },
  { id: 'region', label: 'Région', kind: 'choice', options: ['Centre', 'Autre'], required: false, typeIds: [] },
  { id: 'dej', label: 'Déjeuner sur place', kind: 'checkbox', options: [], required: false, typeIds: [] },
  { id: 'note', label: 'Remarque', kind: 'text', options: [], required: false, typeIds: [] },
];

describe('champs personnalisés à l\'écran (F-33)', () => {
  it('chaque type de champ a son contrôle et son libellé associé', () => {
    const html = fields.map((f) => renderToStaticMarkup(<FieldInput field={f} idPrefix="t" value={undefined} onChange={() => {}} />)).join('');
    expect(html).toContain('type="number"');
    expect(html).toContain('<option value="Centre">Centre</option>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('for="t-pdv"');
    expect(html).toContain('class="required"');
  });

  it("l'éditeur affiche les questions existantes", () => {
    const html = renderToStaticMarkup(<FieldsEditor fields={fields} types={DEFAULT_TYPES} onSave={async () => {}} />);
    expect(html).toContain('Question 4');
    expect(html).toContain('Nombre de points de vente');
    expect(html).toContain('Enregistrer les questions');
  });
});
