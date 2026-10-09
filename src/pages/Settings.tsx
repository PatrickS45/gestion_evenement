import { useState, type FormEvent } from 'react';
import { errorMessage, useNotify, useStore } from '../app/context';
import { navigate, publicUrl } from '../app/router';
import type { EventSnapshot } from '../data/store';
import { MAX_TYPES, nextTypeColor, TYPE_PALETTE } from '../domain/colors';
import { newId } from '../domain/ids';
import type { ParticipantType } from '../domain/model';
import { QrImage, TypeBadge } from '../ui/components';

export function Settings({ snapshot }: { snapshot: EventSnapshot }) {
  const store = useStore();
  const notify = useNotify();
  const { event, participants } = snapshot;
  const [form, setForm] = useState({
    name: event.name, startDate: event.startDate, endDate: event.endDate, venue: event.venue,
    capacity: String(event.capacity),
    warn: String(Math.round(event.thresholds.warn * 100)), critical: String(Math.round(event.thresholds.critical * 100)),
  });
  const [types, setTypes] = useState<ParticipantType[]>(event.types);
  const [error, setError] = useState('');
  const registerUrl = publicUrl('inscription', event.id);
  const usage = (typeId: string) => participants.filter((p) => p.typeId === typeId).length;

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const setType = (i: number, patch: Partial<ParticipantType>) => setTypes(types.map((t, j) => (i === j ? { ...t, ...patch } : t)));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const warn = Number(form.warn) / 100, critical = Number(form.critical) / 100;
    if (!(warn > 0 && warn < critical && critical <= 1)) { setError('Les seuils doivent vérifier : 0 < attention < critique ≤ 100 %.'); return; }
    if (types.some((t) => !t.label.trim())) { setError('Chaque type doit avoir un libellé.'); return; }
    try {
      await store.updateEvent(event.id, {
        name: form.name.trim(), startDate: form.startDate, endDate: form.endDate || form.startDate, venue: form.venue.trim(),
        capacity: parseInt(form.capacity, 10), thresholds: { warn, critical },
        types: types.map((t) => ({ ...t, label: t.label.trim() })),
      });
      notify('Paramètres enregistrés');
    } catch (err) { setError(errorMessage(err)); }
  };

  const toggleRegistration = async () => {
    try {
      await store.updateEvent(event.id, { registrationOpen: !event.registrationOpen });
      notify(event.registrationOpen ? 'Inscriptions fermées' : 'Inscriptions ouvertes');
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const duplicate = async () => {
    const name = prompt('Nom du nouvel événement (paramètres et types copiés, sans les participants) :', `${event.name} (copie)`);
    if (!name?.trim()) return;
    try { const copy = await store.duplicateEvent(event.id, name.trim()); notify('Événement dupliqué'); navigate('e', copy.id, 'parametres'); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const remove = async () => {
    if (!confirm(`Supprimer définitivement « ${event.name} » et toutes les données de ses ${participants.length} participants ?`)) return;
    try { await store.deleteEvent(event.id); notify('Événement supprimé'); navigate(); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };

  return (
    <div className="stack">
      <section className="card stack" aria-labelledby="reg-title">
        <h2 id="reg-title" style={{ marginBottom: 0 }}>Formulaire d'inscription</h2>
        <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
          <div className="stack" style={{ flex: 1, minWidth: 240, gap: 10 }}>
            <p>
              Inscriptions : <strong style={{ color: event.registrationOpen ? 'var(--ok)' : 'var(--danger)' }}>{event.registrationOpen ? 'ouvertes' : 'fermées'}</strong>
            </p>
            <p className="muted">Les participants choisissent leur type, s'inscrivent et obtiennent aussitôt leur QR code. Imprimez ce QR code sur une affiche ou partagez le lien.</p>
            {event.registrationOpen && <p className="small" style={{ wordBreak: 'break-all' }}>{registerUrl}</p>}
            <div className="row">
              <button className={event.registrationOpen ? 'btn btn-secondary' : 'btn'} onClick={toggleRegistration}>
                {event.registrationOpen ? 'Fermer les inscriptions' : 'Ouvrir les inscriptions'}
              </button>
              {event.registrationOpen && <>
                <button className="btn btn-secondary" onClick={() => { navigator.clipboard?.writeText(registerUrl); notify('Lien copié'); }}>Copier le lien</button>
                <a className="btn btn-secondary" href={registerUrl} target="_blank" rel="noreferrer">Ouvrir le formulaire<span className="sr-only"> (nouvel onglet)</span></a>
              </>}
            </div>
          </div>
          {event.registrationOpen && <QrImage text={registerUrl} size={160} label="QR code du formulaire d'inscription" />}
        </div>
      </section>

      <form className="card stack" onSubmit={save} aria-labelledby="settings-title" noValidate>
        <h2 id="settings-title" style={{ marginBottom: 0 }}>Événement</h2>
        <div className="form-grid">
          <div className="field"><label htmlFor="s-name" className="required">Nom</label><input id="s-name" className="input" value={form.name} onChange={set('name')} /></div>
          <div className="field"><label htmlFor="s-start" className="required">Premier jour</label><input id="s-start" type="date" className="input" value={form.startDate} onChange={set('startDate')} /></div>
          <div className="field"><label htmlFor="s-end">Dernier jour</label><input id="s-end" type="date" className="input" min={form.startDate} value={form.endDate} onChange={set('endDate')} /></div>
          <div className="field"><label htmlFor="s-venue">Lieu</label><input id="s-venue" className="input" value={form.venue} onChange={set('venue')} /></div>
        </div>

        <h3>Jauge</h3>
        <div className="form-grid">
          <div className="field"><label htmlFor="s-cap" className="required">Personnes présentes au maximum</label><input id="s-cap" type="number" min={0} inputMode="numeric" className="input" value={form.capacity} onChange={set('capacity')} /></div>
          <div className="field"><label htmlFor="s-warn">Alerte « attention » à (%)</label><input id="s-warn" type="number" min={1} max={99} className="input" value={form.warn} onChange={set('warn')} /></div>
          <div className="field"><label htmlFor="s-crit">Alerte « critique » à (%)</label><input id="s-crit" type="number" min={1} max={100} className="input" value={form.critical} onChange={set('critical')} /></div>
        </div>

        <fieldset style={{ border: 'none', padding: 0, margin: 0 }} className="stack">
          <legend style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Types de participants</legend>
          <p className="small">Le libellé accompagne toujours la couleur. Un type utilisé par des participants ne peut pas être supprimé.</p>
          {types.map((t, i) => {
            const used = usage(t.id);
            return (
              <div key={t.id} className="row" style={{ alignItems: 'flex-end' }}>
                <div className="field" style={{ flex: 2, minWidth: 160 }}>
                  <label htmlFor={`t-label-${i}`}>Libellé du type {i + 1}</label>
                  <input id={`t-label-${i}`} className="input" maxLength={30} value={t.label} onChange={(e) => setType(i, { label: e.target.value })} />
                </div>
                <div className="field" style={{ flex: 1, minWidth: 140 }}>
                  <label htmlFor={`t-color-${i}`}>Couleur</label>
                  <select id={`t-color-${i}`} className="input" value={t.color} onChange={(e) => setType(i, { color: e.target.value })}>
                    {TYPE_PALETTE.map((c) => <option key={c.hex} value={c.hex}>{c.name}</option>)}
                  </select>
                </div>
                <div style={{ paddingBottom: 10, minWidth: 120 }}><TypeBadge type={t} /></div>
                <button type="button" className="btn btn-danger btn-small" disabled={used > 0 || types.length <= 1}
                  onClick={() => setTypes(types.filter((_, j) => j !== i))}
                  aria-label={`Supprimer le type ${t.label}`} title={used > 0 ? `${used} participant(s) de ce type` : undefined}>Supprimer</button>
              </div>
            );
          })}
          {types.length < MAX_TYPES && (
            <div><button type="button" className="btn btn-secondary btn-small"
              onClick={() => setTypes([...types, { id: newId().slice(0, 8), label: '', color: nextTypeColor(types) }])}>Ajouter un type</button></div>
          )}
        </fieldset>

        {error && <p role="alert" className="error">{error}</p>}
        <div><button className="btn" type="submit">Enregistrer</button></div>
      </form>

      <section className="card stack" aria-labelledby="manage-title">
        <h2 id="manage-title" style={{ marginBottom: 0 }}>Gestion</h2>
        <div className="row">
          <button className="btn btn-secondary" onClick={duplicate}>Dupliquer pour une prochaine édition</button>
          <button className="btn btn-danger" onClick={remove}>Supprimer l'événement</button>
        </div>
      </section>
    </div>
  );
}
