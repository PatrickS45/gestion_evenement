import { InPageLink, SectionNav } from '../ui/SectionNav';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, useNotify, useStore } from '../app/context';
import { navigate, publicUrl } from '../app/router';
import type { EventSnapshot, Member } from '../data/store';
import { can } from '../domain/access';
import { MAX_TYPES, nextTypeColor, TYPE_PALETTE } from '../domain/colors';
import { newId } from '../domain/ids';
import type { ParticipantType } from '../domain/model';
import { privacyComplete, purgeDay, type PrivacyPolicy } from '../domain/privacy';
import { parisDay } from '../domain/time';
import { QrImage, TypeBadge } from '../ui/components';
import { longDay, PrivacyFields } from '../ui/privacy';
import { FieldsEditor } from '../ui/fields';
import { BrandingEditor } from '../ui/branding';

const SETTINGS_SECTIONS = [
  { id: 'settings-title', label: 'Événement' },
  { id: 'reg-title', label: 'Inscriptions' },
  { id: 'fields-title', label: 'Questions' },
  { id: 'branding-title', label: 'Apparence' },
  { id: 'code-title', label: 'Agents' },
  { id: 'privacy-title', label: 'Données personnelles' },
  { id: 'manage-title', label: 'Gestion' },
];

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
  const [privacy, setPrivacy] = useState<PrivacyPolicy>(event.privacy);
  const [privacyError, setPrivacyError] = useState('');
  const purged = !!event.purgedAt;
  const [codeAgents, setCodeAgents] = useState<Member[] | null>(null);
  useEffect(() => {
    store.listEventAgents(event.id).then(setCodeAgents, () => setCodeAgents([]));
  }, [store, event.id, event.accessCode]);

  const setAccessCode = async (enabled: boolean) => {
    const n = codeAgents?.length ?? 0;
    if (!enabled && !confirm(`Désactiver le code ? ${n ? `Les ${n} agent(s) qui l'ont utilisé perdront aussitôt l'accès à l'événement.` : 'Il ne permettra plus de rejoindre l\'événement.'}`)) return;
    try {
      await store.setAccessCode(event.id, enabled);
      notify(enabled ? 'Nouveau code d\'accès créé' : 'Code désactivé et accès retirés');
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };
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

  const savePrivacy = async (e: FormEvent) => {
    e.preventDefault();
    setPrivacyError('');
    try { await store.updateEvent(event.id, { privacy }); notify('Politique de confidentialité enregistrée'); }
    catch (err) { setPrivacyError(errorMessage(err)); }
  };

  const privacyAsDefault = async () => {
    try { await store.setOrgPrivacy(event.orgId, privacy); notify('Politique reprise pour les prochains événements de l\'organisation'); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const purgeNow = async () => {
    const answer = prompt(`Purger maintenant les données personnelles des ${participants.length} participants de « ${event.name} » ? Seul le bilan anonyme sera conservé. Cette action est définitive.\n\nTapez PURGER pour confirmer.`);
    if (answer?.trim().toUpperCase() !== 'PURGER') return;
    try { await store.purgeEvent(event.id); notify('Données personnelles purgées ; le bilan anonyme est conservé'); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const toggleRegistration = async () => {
    try {
      await store.updateEvent(event.id, { registrationOpen: !event.registrationOpen });
      notify(event.registrationOpen ? 'Inscriptions fermées' : 'Inscriptions ouvertes');
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const toggleApproval = async () => {
    try {
      await store.updateEvent(event.id, { requireApproval: !event.requireApproval });
      notify(event.requireApproval ? 'Inscriptions acceptées automatiquement' : 'Inscriptions validées manuellement');
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const duplicate = async () => {
    const name = prompt('Nom du nouvel événement (paramètres et types copiés, sans les participants) :', `${event.name} (copie)`);
    if (!name?.trim()) return;
    try { const copy = await store.duplicateEvent(event.id, name.trim()); notify('Événement dupliqué'); navigate('e', copy.id, 'parametres'); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const remove = async () => {
    if (!confirm(`Supprimer définitivement « ${event.name} » et toutes les données de ses ${participants.length} participants ? Son bilan anonyme sera conservé.`)) return;
    try { await store.deleteEvent(event.id); notify('Événement supprimé'); navigate(); }
    catch (err) { notify(errorMessage(err), 'danger'); }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="page-title">Paramètres</h2>
          <p className="page-sub">{event.name}</p>
        </div>
      </div>
      <div className="settings">
        <SectionNav sections={SETTINGS_SECTIONS} />
        <div className="settings-content stack">
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

        <section className="card stack" aria-labelledby="reg-title">
          <h2 id="reg-title" style={{ marginBottom: 0 }}>Formulaire d'inscription</h2>
          <div className="row" style={{ alignItems: 'flex-start', gap: 20 }}>
            <div className="stack" style={{ flex: 1, minWidth: 240, gap: 10 }}>
              <p>
                Inscriptions : <strong style={{ color: event.registrationOpen ? 'var(--ok)' : 'var(--danger)' }}>{event.registrationOpen ? 'ouvertes' : 'fermées'}</strong>
              </p>
              <p className="muted">
                Les participants choisissent leur type et s'inscrivent ; ils obtiennent leur QR code
                {event.requireApproval ? ' après acceptation par un administrateur (onglet Participants).' : ' aussitôt.'} Imprimez ce QR code sur une affiche ou partagez le lien.
              </p>
              <label className="row" style={{ flexWrap: 'nowrap', cursor: 'pointer' }}>
                <input type="checkbox" checked={event.requireApproval} onChange={() => void toggleApproval()} disabled={purged} />
                <span>Valider manuellement chaque inscription avant de délivrer le QR code</span>
              </label>
              {event.registrationOpen && <p className="small" style={{ wordBreak: 'break-all' }}>{registerUrl}</p>}
              {!event.registrationOpen && !purged && !privacyComplete(event.privacy) && (
                <p className="notice notice-warn">
                  Avant d'ouvrir les inscriptions, renseignez le responsable du traitement et le contact pour les données
                  personnelles (<InPageLink to="privacy-title">section Données personnelles</InPageLink>) : ils sont affichés sur le formulaire.
                </p>
              )}
              <div className="row">
                <button className={event.registrationOpen ? 'btn btn-secondary' : 'btn'} onClick={toggleRegistration}
                  disabled={!event.registrationOpen && (purged || !privacyComplete(event.privacy))}>
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

        <section className="card stack" aria-labelledby="fields-title">
          <h2 id="fields-title" style={{ marginBottom: 0 }}>Questions du formulaire</h2>
          <p className="muted">Questions supplémentaires posées à l'inscription, éventuellement à certains types seulement. Les réponses alimentent les statistiques.</p>
          <FieldsEditor key={event.id} fields={event.fields} types={event.types}
            onSave={async (fields) => { await store.updateEvent(event.id, { fields }); notify('Questions enregistrées'); }} />
        </section>

        <section className="card stack" aria-labelledby="branding-title">
          <h2 id="branding-title" style={{ marginBottom: 0 }}>Apparence des pages publiques</h2>
          <p className="muted">Couleur et logo de l'organisateur, sur le formulaire d'inscription et la page de chaque participant. Une couleur trop claire est assombrie pour rester lisible.</p>
          <BrandingEditor key={event.id} value={event.branding} disabled={purged}
            onSave={async (branding) => { await store.updateEvent(event.id, { branding }); notify('Apparence enregistrée'); }} />
        </section>

        <section className="card stack" aria-labelledby="code-title">
          <h2 id="code-title" style={{ marginBottom: 0 }}>Code d'accès des agents</h2>
          <p className="muted">
            Un agent d'accueil saisit ce code dans l'application pour rejoindre cet événement seul : il scanne et consulte la jauge,
            sans voir les autres événements ni l'organisation. Désactivez le code s'il a circulé : les accès obtenus avec lui sont retirés.
          </p>
          {event.accessCode
            ? <p style={{ fontFamily: 'ui-monospace, monospace', fontSize: 34, fontWeight: 800, letterSpacing: 6 }} aria-label={`Code : ${event.accessCode.split('').join(' ')}`}>{event.accessCode}</p>
            : <p>Aucun code actif.</p>}
          <div className="row">
            {event.accessCode
              ? <>
                <button className="btn btn-secondary" onClick={() => { navigator.clipboard?.writeText(event.accessCode!); notify('Code copié'); }}>Copier le code</button>
                <button className="btn btn-danger" onClick={() => void setAccessCode(false)}>Désactiver le code</button>
              </>
              : <button className="btn" onClick={() => void setAccessCode(true)} disabled={purged}>Créer un code d'accès</button>}
          </div>
          {codeAgents && codeAgents.length > 0 && (
            <p className="small">Ont rejoint avec le code : {codeAgents.map((a) => a.name).join(', ')}.</p>
          )}
        </section>

        <form className="card stack" onSubmit={savePrivacy} aria-labelledby="privacy-title" noValidate>
          <h2 id="privacy-title" style={{ marginBottom: 0 }}>Données personnelles</h2>
          <p className="muted">
            L'organisateur est responsable du traitement ; ces informations sont affichées sur le formulaire d'inscription et la
            page de chaque participant. À l'échéance, les données personnelles sont effacées automatiquement : seul un bilan anonyme est conservé.
          </p>
          {purged
            ? <p className="notice notice-info">Données personnelles purgées le {longDay(parisDay(event.purgedAt!))}.</p>
            : <p>Effacement automatique prévu le <strong>{longDay(purgeDay({ endDate: event.endDate, privacy }))}</strong>.</p>}
          <PrivacyFields value={privacy} onChange={setPrivacy} idPrefix="ev-privacy" />
          {privacyError && <p role="alert" className="error">{privacyError}</p>}
          <div className="row">
            <button className="btn" type="submit">Enregistrer</button>
            <button className="btn btn-secondary" type="button" onClick={() => void privacyAsDefault()}>Reprendre pour les prochains événements</button>
          </div>
        </form>

        <section className="card stack card-danger" aria-labelledby="manage-title">
          <h2 id="manage-title" style={{ marginBottom: 0 }}>Gestion</h2>
          <p className="muted">Préparer l'édition suivante, ou effacer les données de cet événement. Ces actions sont tracées.</p>
          <div className="row">
            <button className="btn btn-secondary" onClick={duplicate}>Dupliquer pour une prochaine édition</button>
            {can(snapshot.role, 'event.delete') && !purged && <button className="btn btn-danger" onClick={() => void purgeNow()}>Purger les données personnelles</button>}
            {can(snapshot.role, 'event.delete') && <button className="btn btn-danger" onClick={remove}>Supprimer l'événement</button>}
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}
