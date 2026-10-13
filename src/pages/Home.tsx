import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, useNotify, useSession, useStore } from '../app/context';
import { href, navigate } from '../app/router';
import { PASSWORD_MIN_LENGTH } from '../data/password';
import { can, ROLE_LABELS } from '../domain/access';
import type { EventInfo } from '../domain/model';

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Connexion (F-01), ou création d'un compte et de sa première organisation. */
export function SignIn() {
  const store = useStore();
  const { setSession } = useSession();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '', organization: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = `${mode === 'signin' ? 'Connexion' : 'Créer un compte'} – Event Control`; }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      setSession(mode === 'signin' ? await store.signIn(form.email, form.password) : await store.signUp(form));
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const switchTo = (m: typeof mode) => { setMode(m); setError(''); };

  return (
    <main className="public">
      <form className="public-card stack" onSubmit={submit} aria-labelledby="signin-title">
        <p style={{ fontWeight: 800, color: 'var(--brand)' }}>Event Control</p>
        <h1 id="signin-title" style={{ fontSize: 26 }}>{mode === 'signin' ? 'Connexion' : 'Créer un compte'}</h1>
        <p className="muted">Version de démonstration : les données restent sur cet appareil.</p>
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="su-name" className="required">Votre nom</label>
            <span className="hint" id="su-name-hint">Il apparaîtra dans le journal des passages que vous enregistrez.</span>
            <input id="su-name" className="input" autoComplete="name" required maxLength={100} value={form.name} onChange={set('name')} aria-describedby="su-name-hint" />
          </div>
        )}
        <div className="field">
          <label htmlFor="si-email" className="required">Adresse email</label>
          <input id="si-email" type="email" className="input" autoComplete="email" required value={form.email} onChange={set('email')} />
        </div>
        <div className="field">
          <label htmlFor="si-password" className="required">Mot de passe</label>
          {mode === 'signup' && <span className="hint" id="si-password-hint">{PASSWORD_MIN_LENGTH} caractères au moins.</span>}
          <input id="si-password" type="password" className="input" required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? PASSWORD_MIN_LENGTH : undefined}
            value={form.password} onChange={set('password')}
            aria-describedby={mode === 'signup' ? 'si-password-hint' : undefined} />
        </div>
        {mode === 'signup' && (
          <div className="field">
            <label htmlFor="su-org" className="required">Nom de votre organisation</label>
            <span className="hint" id="su-org-hint">Vous en serez le propriétaire et pourrez y ajouter votre équipe.</span>
            <input id="su-org" className="input" autoComplete="organization" required maxLength={200} value={form.organization} onChange={set('organization')} aria-describedby="su-org-hint" />
          </div>
        )}
        {error && <p role="alert" className="error">{error}</p>}
        <button className="btn" type="submit" disabled={busy}>{mode === 'signin' ? 'Se connecter' : 'Créer le compte'}</button>
        <p className="small">
          {mode === 'signin'
            ? <>Pas encore de compte ? <button type="button" className="btn btn-ghost btn-small" onClick={() => switchTo('signup')}>Créer un compte</button></>
            : <>Déjà inscrit ? <button type="button" className="btn btn-ghost btn-small" onClick={() => switchTo('signin')}>Se connecter</button></>}
        </p>
      </form>
    </main>
  );
}

/** Utilisateur, rôle, poste et déconnexion, dans la barre du haut. */
export function UserMeta({ role }: { role?: keyof typeof ROLE_LABELS }) {
  const { session, stationId, signOut } = useSession();
  return (
    <span className="topbar-meta">
      {session?.user.name}{role && <> ({ROLE_LABELS[role].toLowerCase()})</>} · {stationId} ·{' '}
      <button className="btn btn-ghost btn-small" style={{ color: '#fff' }} onClick={() => { void signOut().then(() => navigate()); }}>Se déconnecter</button>
    </span>
  );
}

export function Events() {
  const store = useStore();
  const notify = useNotify();
  const { session, org, selectOrg, setSession } = useSession();
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '', venue: '', capacity: '1000' });
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setEvents(null);
    if (org) store.listEvents(org.orgId).then(setEvents, () => setEvents([]));
  }, [store, org]);
  useEffect(() => { document.title = 'Événements – Event Control'; }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!org) return;
    setError('');
    try {
      const event = await store.createEvent(org.orgId, {
        name: form.name, startDate: form.startDate, endDate: form.endDate || form.startDate,
        venue: form.venue, capacity: parseInt(form.capacity, 10) || 0,
      });
      notify(`Événement « ${event.name} » créé`);
      navigate('e', event.id, 'parametres');
    } catch (err) { setError(errorMessage(err)); }
  };

  const createOrg = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const before = new Set(session?.memberships.map((m) => m.orgId));
      const next = await store.createOrganization(orgName);
      setSession(next);
      const created = next.memberships.find((m) => !before.has(m.orgId));
      if (created) selectOrg(created.orgId);
      setOrgName('');
      notify(`Organisation « ${created?.orgName ?? orgName} » créée`);
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  const memberships = session?.memberships ?? [];

  return (
    <>
      <header className="topbar on-dark">
        <div className="topbar-inner">
          <span className="brand">Event Control</span>
          <UserMeta role={org?.role} />
        </div>
      </header>
      <main className="page stack">
        <div className="row-between" style={{ alignItems: 'flex-end' }}>
          <h1 style={{ fontSize: 24 }}>Événements{org && <> – {org.orgName}</>}</h1>
          <div className="row">
            {memberships.length > 1 && (
              <div className="field">
                <label htmlFor="org-select">Organisation</label>
                <select id="org-select" className="input" value={org?.orgId ?? ''} onChange={(e) => selectOrg(e.target.value)}>
                  {memberships.map((m) => <option key={m.orgId} value={m.orgId}>{m.orgName} ({ROLE_LABELS[m.role].toLowerCase()})</option>)}
                </select>
              </div>
            )}
            {can(org?.role, 'members.manage') && <a className="btn btn-secondary" href={href('membres')}>Membres</a>}
          </div>
        </div>

        {!org ? <p className="muted">Vous n'êtes membre d'aucune organisation. Créez la vôtre ci-dessous.</p>
          : events === null ? <p role="status">Chargement…</p>
            : events.length === 0
              ? <p className="muted">Aucun événement pour le moment.{can(org.role, 'event.create') && ' Créez le premier ci-dessous.'}</p>
              : (
                <ul className="grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {events.map((ev) => (
                    <li key={ev.id} className="card stack" style={{ gap: 6 }}>
                      <h2 style={{ fontSize: 18, margin: 0 }}><a href={href('e', ev.id, can(org.role, 'event.edit') ? 'direct' : 'scan')}>{ev.name}</a></h2>
                      <p className="muted">
                        {ev.startDate === ev.endDate ? dayLabel(ev.startDate) : `Du ${dayLabel(ev.startDate)} au ${dayLabel(ev.endDate)}`}
                        {ev.venue && <><br />{ev.venue}</>}
                      </p>
                      <p className="small">Jauge : {ev.capacity.toLocaleString('fr-FR')} personnes</p>
                    </li>
                  ))}
                </ul>
              )}

        {can(org?.role, 'event.create') && (
          <form className="card stack" onSubmit={create} aria-labelledby="new-event">
            <h2 id="new-event">Nouvel événement</h2>
            <div className="form-grid">
              <div className="field">
                <label htmlFor="ev-name" className="required">Nom</label>
                <input id="ev-name" className="input" required maxLength={200} value={form.name} onChange={set('name')} />
              </div>
              <div className="field">
                <label htmlFor="ev-start" className="required">Premier jour</label>
                <input id="ev-start" type="date" className="input" required value={form.startDate} onChange={set('startDate')} />
              </div>
              <div className="field">
                <label htmlFor="ev-end">Dernier jour</label>
                <input id="ev-end" type="date" className="input" min={form.startDate} value={form.endDate} onChange={set('endDate')} />
              </div>
              <div className="field">
                <label htmlFor="ev-venue">Lieu</label>
                <input id="ev-venue" className="input" maxLength={200} value={form.venue} onChange={set('venue')} />
              </div>
              <div className="field">
                <label htmlFor="ev-capacity" className="required">Jauge (personnes présentes au maximum)</label>
                <input id="ev-capacity" type="number" min={0} inputMode="numeric" className="input" required value={form.capacity} onChange={set('capacity')} />
              </div>
            </div>
            {error && <p role="alert" className="error">{error}</p>}
            <div><button className="btn" type="submit">Créer l'événement</button></div>
          </form>
        )}

        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Créer une autre organisation</summary>
          <form className="row" style={{ marginTop: 12, alignItems: 'flex-end' }} onSubmit={createOrg}>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="org-name" className="required">Nom de l'organisation</label>
              <input id="org-name" className="input" required maxLength={200} value={orgName} onChange={(e) => setOrgName(e.target.value)} />
            </div>
            <button className="btn btn-secondary" type="submit">Créer</button>
          </form>
        </details>
      </main>
    </>
  );
}
