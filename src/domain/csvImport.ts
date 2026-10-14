// Import de participants depuis un CSV ou un copier-coller de tableur (F-22).
// Analyse en deux temps : on calcule un aperçu, l'utilisateur valide, puis on enregistre.
import { checkAnswers, type Answers, type CustomField } from './fields';
import type { ParticipantType } from './model';

export type ImportField = 'lastName' | 'firstName' | 'email' | 'phone' | 'company' | 'type';

export interface ImportRow {
  line: number;
  lastName: string;
  firstName: string;
  email: string;
  phone: string;
  company: string;
  typeId: string;
  /** Réponses aux questions de l'événement, déjà vérifiées (F-33). */
  answers: Answers;
}

export interface ImportPreview {
  /** Colonne retenue pour chaque champ (en-tête d'origine), ou null si absente. */
  columns: Record<ImportField, string | null>;
  /** Colonnes reconnues comme des réponses aux questions de l'événement (F-33). */
  fieldColumns: { fieldId: string; label: string; header: string }[];
  accepted: ImportRow[];
  skipped: { line: number; reason: string }[];
  duplicates: { line: number; email: string }[];
  /** Avertissements non bloquants (ex. type inconnu remplacé par le type par défaut). */
  warnings: { line: number; message: string }[];
  /** Erreur bloquante (fichier vide, en-tête introuvable). */
  error: string | null;
}

/** Minuscules, sans accents ni espaces superflus. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// Ordre de priorité : les libellés les plus spécifiques d'abord
// (« Nom de la société » doit aller à la société, pas au nom).
const FIELD_KEYWORDS: [ImportField, string[]][] = [
  ['company',   ['societe', 'entreprise', 'enseigne', 'organisation', 'organisme', 'structure', 'company', 'raison sociale']],
  ['firstName', ['prenom', 'first name', 'firstname', 'given name']],
  ['email',     ['email', 'e-mail', 'mail', 'courriel']],
  ['phone',     ['telephone', 'tel', 'phone', 'mobile', 'portable']],
  ['type',      ['type', 'typologie', 'profil', 'categorie', 'qualite']],
  ['lastName',  ['nom', 'name', 'last name', 'lastname', 'surname']],
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function detectSeparator(firstLine: string): string {
  const counts = [';', '\t', ','].map((sep) => [sep, firstLine.split(sep).length - 1] as const);
  const best = counts.sort((a, b) => b[1] - a[1])[0]!;
  return best[1] > 0 ? best[0] : ';';
}

/** Découpage CSV respectant les guillemets (champs contenant le séparateur ou des sauts de ligne). */
export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field.trim() === '') { field = ''; quoted = true; }
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Un export protégé contre l'injection de formules préfixe certaines cellules d'une apostrophe
const unprotect = (v: string) => v.trim().replace(/^'(?=[=+\-@])/, '');

function mapColumns(header: string[], taken = new Set<number>()): Record<ImportField, number> {
  const map = { lastName: -1, firstName: -1, email: -1, phone: -1, company: -1, type: -1 };
  for (const [field, keywords] of FIELD_KEYWORDS) {
    const idx = header.findIndex((h, i) => !taken.has(i) && keywords.some((k) => normalize(h).includes(k)));
    if (idx >= 0) { map[field] = idx; taken.add(idx); }
  }
  return map;
}

/** Retrouve un type par son libellé ou son identifiant, sans tenir compte de la casse, des accents ni du pluriel. */
export function matchType(types: ParticipantType[], value: string): ParticipantType | undefined {
  const v = normalize(value).replace(/s$/, '');
  if (!v) return undefined;
  return types.find((t) => normalize(t.id).replace(/s$/, '') === v || normalize(t.label).replace(/s$/, '') === v);
}

const YES = new Set(['oui', 'o', 'x', 'yes', 'y', '1', 'vrai', 'true']);

/** Réponse lue dans une cellule, convertie pour le champ ; null si vide ou invalide. */
function readAnswer(field: CustomField, raw: string): { value: Answers[string] } | { invalid: true } | null {
  if (!raw) return null;
  let candidate: unknown = raw;
  if (field.kind === 'checkbox') {
    if (!YES.has(normalize(raw))) return normalize(raw) === 'non' || normalize(raw) === '0' ? null : { invalid: true };
    candidate = true;
  }
  if (field.kind === 'choice') {
    const option = field.options.find((o) => normalize(o) === normalize(raw));
    if (!option) return { invalid: true };
    candidate = option;
  }
  const r = checkAnswers([{ ...field, typeIds: [], required: false }], '', { [field.id]: candidate });
  return r.error || r.answers[field.id] === undefined ? { invalid: true } : { value: r.answers[field.id]! };
}

export function previewImport(text: string, types: ParticipantType[], existingEmails: Iterable<string>, fields: CustomField[] = []): ImportPreview {
  const preview: ImportPreview = {
    fieldColumns: [],
    columns: { lastName: null, firstName: null, email: null, phone: null, company: null, type: null },
    accepted: [], skipped: [], duplicates: [], warnings: [], error: null,
  };

  const clean = text.replace(/^\uFEFF/, '');
  if (!clean.trim()) { preview.error = 'Le fichier est vide.'; return preview; }

  const rows = parseCsv(clean, detectSeparator(clean.split(/\r?\n/)[0] ?? ''));
  const header = rows[0] ?? [];
  // Questions d'abord, par leur libellé exact : « Nom du magasin » ne doit pas devenir la colonne « Nom »
  const taken = new Set<number>();
  const fieldCols: { field: CustomField; index: number }[] = [];
  for (const field of fields) {
    const index = header.findIndex((h, i) => !taken.has(i) && normalize(h) === normalize(field.label));
    if (index < 0) continue;
    taken.add(index);
    fieldCols.push({ field, index });
    preview.fieldColumns.push({ fieldId: field.id, label: field.label, header: header[index]!.trim() });
  }
  const cols = mapColumns(header, taken);
  if (cols.lastName < 0 && cols.firstName < 0) {
    preview.error = 'Colonne « Nom » introuvable : la première ligne doit contenir les en-têtes (Nom, Prénom, Email, Société, Type…).';
    return preview;
  }
  for (const field of Object.keys(cols) as ImportField[]) {
    preview.columns[field] = cols[field] >= 0 ? (header[cols[field]] ?? '').trim() : null;
  }

  const defaultType = types[0];
  const seen = new Set([...existingEmails].map((e) => e.trim().toLowerCase()));
  const cell = (r: string[], i: number) => (i >= 0 ? unprotect(r[i] ?? '') : '');

  rows.slice(1).forEach((r, index) => {
    const line = index + 2;
    if (r.every((c) => c.trim() === '')) return;

    const row: ImportRow = {
      line,
      lastName: cell(r, cols.lastName).slice(0, 100),
      firstName: cell(r, cols.firstName).slice(0, 100),
      email: cell(r, cols.email).toLowerCase().slice(0, 320),
      phone: cell(r, cols.phone).slice(0, 40),
      company: cell(r, cols.company).replace(/\s+/g, ' ').slice(0, 120),
      typeId: defaultType?.id ?? '',
      answers: {},
    };

    if (!row.lastName && !row.firstName) { preview.skipped.push({ line, reason: 'Nom manquant' }); return; }
    if (row.email && !EMAIL.test(row.email)) { preview.skipped.push({ line, reason: `Email invalide : ${row.email}` }); return; }
    if (row.email) {
      if (seen.has(row.email)) { preview.duplicates.push({ line, email: row.email }); return; }
      seen.add(row.email);
    }

    const rawType = cell(r, cols.type);
    if (rawType) {
      const t = matchType(types, rawType);
      if (t) row.typeId = t.id;
      else preview.warnings.push({ line, message: `Type « ${rawType} » inconnu : « ${defaultType?.label} » appliqué` });
    }
    for (const { field, index } of fieldCols) {
      if (field.typeIds.length && !field.typeIds.includes(row.typeId)) continue; // question d'un autre type
      const raw = cell(r, index);
      const answer = readAnswer(field, raw);
      if (answer && 'value' in answer) row.answers[field.id] = answer.value;
      else if (answer) preview.warnings.push({ line, message: `« ${field.label} » : réponse « ${raw} » non reconnue, ignorée` });
    }
    preview.accepted.push(row);
  });

  return preview;
}
