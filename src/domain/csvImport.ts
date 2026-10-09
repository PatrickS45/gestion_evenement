// Import de participants depuis un CSV ou un copier-coller de tableur (F-22).
// Analyse en deux temps : on calcule un aperçu, l'utilisateur valide, puis on enregistre.
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
}

export interface ImportPreview {
  /** Colonne retenue pour chaque champ (en-tête d'origine), ou null si absente. */
  columns: Record<ImportField, string | null>;
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

function mapColumns(header: string[]): Record<ImportField, number> {
  const map = { lastName: -1, firstName: -1, email: -1, phone: -1, company: -1, type: -1 };
  const taken = new Set<number>();
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

export function previewImport(text: string, types: ParticipantType[], existingEmails: Iterable<string>): ImportPreview {
  const preview: ImportPreview = {
    columns: { lastName: null, firstName: null, email: null, phone: null, company: null, type: null },
    accepted: [], skipped: [], duplicates: [], warnings: [], error: null,
  };

  const clean = text.replace(/^\uFEFF/, '');
  if (!clean.trim()) { preview.error = 'Le fichier est vide.'; return preview; }

  const rows = parseCsv(clean, detectSeparator(clean.split(/\r?\n/)[0] ?? ''));
  const header = rows[0] ?? [];
  const cols = mapColumns(header);
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
    preview.accepted.push(row);
  });

  return preview;
}
