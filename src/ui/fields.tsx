// Champs personnalisés à l'écran (F-33) : saisie d'une réponse, et éditeur des questions de l'événement.
import { useState } from 'react';
import { FIELD_KINDS, MAX_FIELDS, type Answer, type CustomField, type FieldKind } from '../domain/fields';
import { newId } from '../domain/ids';
import type { ParticipantType } from '../domain/model';

/** Réponses saisies, avant vérification par le stockage. */
export type AnswerDraft = Record<string, Answer | ''>;

export function FieldInput({ field, value, onChange, idPrefix }: {
  field: CustomField; value: Answer | '' | undefined; onChange: (v: Answer | '') => void; idPrefix: string;
}) {
  const id = `${idPrefix}-${field.id}`;
  const label = <label htmlFor={id} className={field.required ? 'required' : undefined}>{field.label}</label>;
  switch (field.kind) {
    case 'checkbox':
      return (
        <label className="row" style={{ flexWrap: 'nowrap', cursor: 'pointer', alignItems: 'flex-start' }}>
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} style={{ width: 18, height: 18, marginTop: 3 }} />
          <span className={field.required ? 'required' : undefined}>{field.label}</span>
        </label>
      );
    case 'choice':
      return (
        <div className="field">{label}
          <select id={id} className="input" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)}>
            <option value="">—</option>
            {field.options.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      );
    case 'number':
      return (
        <div className="field">{label}
          <input id={id} type="number" inputMode="decimal" className="input" value={value === undefined || value === '' ? '' : String(value)} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
    default:
      return (
        <div className="field">{label}
          <input id={id} className="input" maxLength={200} value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value)} />
        </div>
      );
  }
}

/** Éditeur des questions du formulaire d'inscription. */
export function FieldsEditor({ fields, types, onSave }: { fields: CustomField[]; types: ParticipantType[]; onSave: (f: CustomField[]) => Promise<void> }) {
  const [draft, setDraft] = useState(fields.map((f) => ({ ...f, optionsText: f.options.join('\n') })));
  const [error, setError] = useState('');
  const set = (i: number, patch: Partial<(typeof draft)[number]>) => setDraft(draft.map((f, j) => (i === j ? { ...f, ...patch } : f)));

  const save = async () => {
    setError('');
    const cleaned = draft.map(({ optionsText, ...f }) => ({ ...f, label: f.label.trim(), options: optionsText.split('\n').map((o) => o.trim()).filter(Boolean) }));
    const bad = cleaned.find((f) => !f.label || (f.kind === 'choice' && f.options.length < 2));
    if (bad) { setError(bad.label ? `« ${bad.label} » : indiquez au moins deux choix, un par ligne.` : 'Chaque question doit avoir un libellé.'); return; }
    try { await onSave(cleaned); } catch (err) { setError(err instanceof Error ? err.message : 'Enregistrement impossible'); }
  };

  return (
    <div className="stack">
      {draft.length === 0 && <p className="muted">Aucune question supplémentaire : le formulaire demande le type, le nom, l'email, la société et le téléphone.</p>}
      {draft.map((f, i) => (
        <fieldset key={f.id} className="card stack" style={{ margin: 0 }}>
          <legend style={{ fontWeight: 700 }}>Question {i + 1}</legend>
          <div className="form-grid">
            <div className="field">
              <label htmlFor={`cf-label-${i}`} className="required">Libellé</label>
              <input id={`cf-label-${i}`} className="input" maxLength={100} value={f.label} onChange={(e) => set(i, { label: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={`cf-kind-${i}`}>Type de réponse</label>
              <select id={`cf-kind-${i}`} className="input" value={f.kind} onChange={(e) => set(i, { kind: e.target.value as FieldKind })}>
                {(Object.keys(FIELD_KINDS) as FieldKind[]).map((k) => <option key={k} value={k}>{FIELD_KINDS[k]}</option>)}
              </select>
            </div>
          </div>
          {f.kind === 'choice' && (
            <div className="field">
              <label htmlFor={`cf-options-${i}`}>Choix proposés, un par ligne</label>
              <textarea id={`cf-options-${i}`} className="input" rows={4} value={f.optionsText} onChange={(e) => set(i, { optionsText: e.target.value })} />
            </div>
          )}
          <label className="row" style={{ flexWrap: 'nowrap', cursor: 'pointer' }}>
            <input type="checkbox" checked={f.required} onChange={(e) => set(i, { required: e.target.checked })} />
            <span>Réponse obligatoire{f.kind === 'checkbox' && ' (la case doit être cochée)'}</span>
          </label>
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
            <legend className="small">Demandée aux types (aucun coché : tous)</legend>
            <div className="row">
              {types.map((t) => (
                <label key={t.id} className="row" style={{ flexWrap: 'nowrap', cursor: 'pointer', gap: 6 }}>
                  <input type="checkbox" checked={f.typeIds.includes(t.id)}
                    onChange={(e) => set(i, { typeIds: e.target.checked ? [...f.typeIds, t.id] : f.typeIds.filter((x) => x !== t.id) })} />
                  <span>{t.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div><button type="button" className="btn btn-danger btn-small" onClick={() => setDraft(draft.filter((_, j) => j !== i))}>Supprimer la question</button></div>
        </fieldset>
      ))}
      {error && <p role="alert" className="error">{error}</p>}
      <div className="row">
        {draft.length < MAX_FIELDS && (
          <button type="button" className="btn btn-secondary" onClick={() => setDraft([...draft, { id: newId().slice(0, 8), label: '', kind: 'text', options: [], optionsText: '', required: false, typeIds: [] }])}>
            Ajouter une question
          </button>
        )}
        <button type="button" className="btn" onClick={() => void save()}>Enregistrer les questions</button>
      </div>
    </div>
  );
}
