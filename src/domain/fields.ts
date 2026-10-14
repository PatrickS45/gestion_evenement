// Champs personnalisés par événement (F-33) et répartition des réponses (F-73).
// Module exécuté aussi par le serveur (hooks PocketBase, sans Intl).

export type FieldKind = 'text' | 'choice' | 'checkbox' | 'number';

export const FIELD_KINDS: Record<FieldKind, string> = {
  text: 'Texte court',
  choice: 'Liste de choix',
  checkbox: 'Case à cocher',
  number: 'Nombre',
};

export interface CustomField {
  id: string;
  label: string;
  kind: FieldKind;
  /** Choix proposés (liste de choix seulement). */
  options: string[];
  required: boolean;
  /** Types de participants concernés ; vide : tous. */
  typeIds: string[];
}

export type Answer = string | number | boolean;
export type Answers = Record<string, Answer>;

export const MAX_FIELDS = 20;
export const MAX_OPTIONS = 30;
const TEXT_MAX = 200;

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Définition des champs reçue vérifiée : libellés non vides, choix dédoublonnés, identifiants uniques. */
export function normalizeFields(raw: unknown): CustomField[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const fields: CustomField[] = [];
  for (const item of raw.slice(0, MAX_FIELDS)) {
    const r = (item ?? {}) as Record<string, unknown>;
    const id = text(r.id, 40);
    const label = text(r.label, 100);
    const kind = (r.kind as string) in FIELD_KINDS ? r.kind as FieldKind : null;
    if (!id || !label || !kind || seen.has(id)) continue;
    seen.add(id);
    const options = kind === 'choice'
      ? [...new Set((Array.isArray(r.options) ? r.options : []).map((o) => text(o, 100)).filter(Boolean))].slice(0, MAX_OPTIONS)
      : [];
    if (kind === 'choice' && options.length < 2) continue;
    fields.push({
      id, label, kind, options, required: r.required === true,
      typeIds: Array.isArray(r.typeIds) ? r.typeIds.map((t) => text(t, 60)).filter(Boolean) : [],
    });
  }
  return fields;
}

/** Champs demandés à un participant de ce type. */
export function fieldsFor(fields: CustomField[], typeId: string): CustomField[] {
  return fields.filter((f) => f.typeIds.length === 0 || f.typeIds.includes(typeId));
}

/**
 * Réponses vérifiées pour un participant de ce type : les champs qui ne le concernent pas sont ignorés,
 * les valeurs converties ; `error` nomme le premier champ obligatoire manquant ou invalide.
 */
export function checkAnswers(fields: CustomField[], typeId: string, raw: unknown, { required = true } = {}): { answers: Answers; error: string | null } {
  const input = (raw ?? {}) as Record<string, unknown>;
  const answers: Answers = {};
  for (const f of fieldsFor(fields, typeId)) {
    const v = input[f.id];
    let value: Answer | null = null;
    if (f.kind === 'text') value = text(v, TEXT_MAX) || null;
    else if (f.kind === 'choice') value = typeof v === 'string' && f.options.includes(v) ? v : null;
    else if (f.kind === 'checkbox') value = v === true || v === 'true' ? true : null;
    else {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN;
      value = Number.isFinite(n) ? n : null;
      if (value === null && v !== undefined && v !== '' && v !== null) return { answers, error: `« ${f.label} » doit être un nombre` };
    }
    if (value === null) {
      if (f.required && required) return { answers, error: f.kind === 'checkbox' ? `Cochez « ${f.label} »` : `Renseignez « ${f.label} »` };
      continue;
    }
    answers[f.id] = value;
  }
  return { answers, error: null };
}

/** Réponse affichée ou exportée. */
export function answerText(f: CustomField, v: Answer | undefined): string {
  if (v === undefined) return '';
  if (f.kind === 'checkbox') return v === true ? 'Oui' : '';
  return typeof v === 'number' ? v.toLocaleString('fr-FR') : String(v);
}

// ─── Répartition des réponses (F-73) ─────────────────────────────────

export interface FieldStats {
  fieldId: string;
  label: string;
  kind: FieldKind;
  /** Participants concernés par le champ, et ceux qui y ont répondu. */
  asked: number;
  answered: number;
  /** Liste de choix : nombre de réponses par choix ; case : cochées. */
  counts?: { value: string; count: number }[];
  /** Nombre : somme, moyenne, minimum, maximum. */
  numbers?: { sum: number; average: number; min: number; max: number };
}

/** Répartition des réponses, sans les textes libres (ils pourraient contenir des données personnelles). */
export function fieldStats(fields: CustomField[], participants: { typeId: string; answers: Answers }[]): FieldStats[] {
  return fields.map((f) => {
    const concerned = participants.filter((p) => f.typeIds.length === 0 || f.typeIds.includes(p.typeId));
    const values = concerned.map((p) => p.answers[f.id]).filter((v): v is Answer => v !== undefined);
    const s: FieldStats = { fieldId: f.id, label: f.label, kind: f.kind, asked: concerned.length, answered: values.length };
    if (f.kind === 'choice') s.counts = f.options.map((o) => ({ value: o, count: values.filter((v) => v === o).length }));
    if (f.kind === 'checkbox') s.counts = [{ value: 'Oui', count: values.filter((v) => v === true).length }];
    if (f.kind === 'number') {
      const nums = values.filter((v): v is number => typeof v === 'number');
      if (nums.length) {
        const sum = nums.reduce((a, b) => a + b, 0);
        s.numbers = { sum, average: Math.round((sum / nums.length) * 100) / 100, min: Math.min(...nums), max: Math.max(...nums) };
      }
    }
    return s;
  });
}
