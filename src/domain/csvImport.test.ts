import type { CustomField } from './fields';
import { matchType, parseCsv, previewImport } from './csvImport';
import { DEFAULT_TYPES } from './colors';

describe('parseCsv', () => {
  it('respecte les guillemets, séparateurs et sauts de ligne internes', () => {
    expect(parseCsv('a;"b;c";"d ""e"""\n1;2;3', ';')).toEqual([['a', 'b;c', 'd "e"'], ['1', '2', '3']]);
    expect(parseCsv('"ligne\nsuite";x\r\ny;z', ';')).toEqual([['ligne\nsuite', 'x'], ['y', 'z']]);
  });
});

describe('matchType', () => {
  it('reconnaît le libellé sans casse, accents ni pluriel', () => {
    expect(matchType(DEFAULT_TYPES, 'EXPOSANTS')?.id).toBe('exposant');
    expect(matchType(DEFAULT_TYPES, ' magasin ')?.id).toBe('magasin');
    expect(matchType(DEFAULT_TYPES, 'presse')).toBeUndefined();
  });
});

describe('previewImport', () => {
  it('reconnaît les colonnes par leur en-tête, dans n\'importe quel ordre', () => {
    const p = previewImport('Société;Prénom;Nom;E-mail;Type\nMaison Roy;Marc;Roy;MARC@roy.fr;Exposants', DEFAULT_TYPES, []);
    expect(p.error).toBeNull();
    expect(p.columns).toMatchObject({ company: 'Société', firstName: 'Prénom', lastName: 'Nom', email: 'E-mail', type: 'Type' });
    expect(p.accepted).toEqual([{ line: 2, lastName: 'Roy', firstName: 'Marc', email: 'marc@roy.fr', phone: '', company: 'Maison Roy', typeId: 'exposant', answers: {} }]);
  });

  it('« Nom de la société » va à la société, pas au nom', () => {
    const p = previewImport('Nom;Nom de la société\nDurand;ACME', DEFAULT_TYPES, []);
    expect(p.accepted[0]).toMatchObject({ lastName: 'Durand', company: 'ACME' });
  });

  it('détecte la tabulation (copier-coller depuis un tableur) et la virgule', () => {
    expect(previewImport('Nom\tEmail\nA\ta@x.fr', DEFAULT_TYPES, []).accepted[0]!.email).toBe('a@x.fr');
    expect(previewImport('Nom,Email\nB,b@x.fr', DEFAULT_TYPES, []).accepted[0]!.email).toBe('b@x.fr');
  });

  it('écarte les lignes sans nom ou avec un email invalide, en indiquant pourquoi', () => {
    const p = previewImport('Nom;Email\n;x@x.fr\nPaul;pas-un-email\n\nAnne;anne@x.fr', DEFAULT_TYPES, []);
    expect(p.accepted.map((r) => r.lastName)).toEqual(['Anne']);
    expect(p.skipped).toEqual([
      { line: 2, reason: 'Nom manquant' },
      { line: 3, reason: 'Email invalide : pas-un-email' },
    ]);
  });

  it('signale les doublons, déjà inscrits ou répétés dans le fichier', () => {
    const p = previewImport('Nom;Email\nA;deja@x.fr\nB;b@x.fr\nC;B@X.FR', DEFAULT_TYPES, ['Deja@x.fr']);
    expect(p.accepted.map((r) => r.lastName)).toEqual(['B']);
    expect(p.duplicates).toEqual([{ line: 2, email: 'deja@x.fr' }, { line: 4, email: 'b@x.fr' }]);
  });

  it('applique le premier type quand le type est absent, et avertit quand il est inconnu', () => {
    const p = previewImport('Nom;Type\nA;\nB;Presse', DEFAULT_TYPES, []);
    expect(p.accepted.map((r) => r.typeId)).toEqual(['visiteur', 'visiteur']);
    expect(p.warnings).toEqual([{ line: 3, message: 'Type « Presse » inconnu : « Visiteur » appliqué' }]);
  });

  it('retire la protection anti-formule d\'un export précédent', () => {
    const p = previewImport("Nom;Société\n'=Durand;'@ACME", DEFAULT_TYPES, []);
    expect(p.accepted[0]).toMatchObject({ lastName: '=Durand', company: '@ACME' });
  });

  it('refuse un fichier sans en-tête reconnaissable', () => {
    expect(previewImport('Durand;durand@x.fr', DEFAULT_TYPES, []).error).toMatch(/Nom/);
    expect(previewImport('   ', DEFAULT_TYPES, []).error).toBe('Le fichier est vide.');
  });
});

describe('import des réponses aux questions (F-33)', () => {
  const fields: CustomField[] = [
    { id: 'nommag', label: 'Nom du magasin', kind: 'text', options: [], required: false, typeIds: [] },
    { id: 'pdv', label: 'Points de vente', kind: 'number', options: [], required: true, typeIds: ['magasin'] },
    { id: 'region', label: 'Région', kind: 'choice', options: ['Centre', 'Île-de-France'], required: false, typeIds: [] },
    { id: 'dej', label: 'Déjeuner', kind: 'checkbox', options: [], required: false, typeIds: [] },
  ];

  it('reconnaît les colonnes par le libellé exact de la question, avant les colonnes habituelles', () => {
    const p = previewImport('Nom;Prénom;Nom du magasin;Type;Points de vente;Région;Déjeuner\nRoy;Marc;Roy & Fils;Magasin;12;ile-de-france;x', DEFAULT_TYPES, [], fields);
    expect(p.columns.lastName).toBe('Nom');
    expect(p.fieldColumns.map((c) => c.fieldId)).toEqual(['nommag', 'pdv', 'region', 'dej']);
    expect(p.accepted[0]).toMatchObject({ lastName: 'Roy', answers: { nommag: 'Roy & Fils', pdv: 12, region: 'Île-de-France', dej: true } });
    expect(p.warnings).toEqual([]);
  });

  it('ignore une réponse invalide en le signalant, et les questions d\'un autre type', () => {
    const p = previewImport('Nom;Type;Points de vente;Région;Déjeuner\nA;Magasin;beaucoup;Mars;non\nB;Exposant;5;;', DEFAULT_TYPES, [], fields);
    expect(p.accepted.map((r) => r.answers)).toEqual([{}, {}]);
    expect(p.warnings.map((w) => [w.line, w.message])).toEqual([
      [2, '« Points de vente » : réponse « beaucoup » non reconnue, ignorée'],
      [2, '« Région » : réponse « Mars » non reconnue, ignorée'],
    ]);
  });
});
