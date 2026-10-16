import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, useNotify, useSession, useStore } from '../app/context';
import { href, navigate } from '../app/router';
import { AppHeader } from '../ui/AppHeader';
import { PASSWORD_MIN_LENGTH } from '../data/password';
import { can, ROLE_LABELS } from '../domain/access';
import type { EventInfo } from '../domain/model';
import { purgeDay, retentionState } from '../domain/privacy';
import { parisDay } from '../domain/time';
import { longDay } from '../ui/privacy';
import { Modal } from '../ui/components';
import { Calendar, ChevronRight, Compass, MapPin, Plus, Sparkles, Users } from 'lucide-react';
import { tourRequested, useTour } from '../ui/Tour';

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

/** Connexion (F-01), ou création d'un compte : avec sa première organisation, ou pour rejoindre un événement par code (F-04). */
export function SignIn() {
  const store = useStore();
  const { setSession } = useSession();
  // Arrivée par le lien de visite guidée : on propose directement de créer un compte
  const [mode, setMode] = useState<'signin' | 'signup'>(() => (tourRequested() ? 'signup' : 'signin'));
  const [form, setForm] = useState({ name: '', email: '', password: '', organization: '', code: '' });
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { document.title = `${mode === 'signin' ? 'Connexion' : 'Créer un compte'} – Event Control`; }, [mode]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signin') { setSession(await store.signIn(form.email, form.password)); return; }
      const created = await store.signUp({ name: form.name, email: form.email, password: form.password, organization: joining ? '' : form.organization });
      if (!joining) { setSession(created); return; }
      // Le compte existe : même si le code est refusé, l'agent pourra le ressaisir une fois connecté
      try {
        const session = await store.joinEvent(form.code);
        setSession(session);
        const access = session.eventAccess[0];
        if (access) navigate('e', access.eventId, 'scan');
      } catch (err) { setSession(await store.getSession()); throw err; }
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
        {!import.meta.env.VITE_POCKETBASE_URL && <p className="muted">Version de démonstration : les données restent sur cet appareil.</p>}
        {tourRequested() && mode === 'signup' && (
          <p className="notice notice-info">Créez un compte de démonstration pour lancer la visite guidée : un nom, un email et un mot de passe de votre choix suffisent. Aucune donnée n'est transmise.</p>
        )}
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
          <fieldset style={{ border: 'none', padding: 0, margin: 0 }} className="stack">
            <legend className="label" style={{ marginBottom: 8 }}>Vous êtes</legend>
            <label className="row" style={{ flexWrap: 'nowrap', cursor: 'pointer' }}>
              <input type="radio" name="su-kind" checked={!joining} onChange={() => setJoining(false)} />
              <span>Organisateur : je crée mon organisation</span>
            </label>
            <label className="row" style={{ flexWrap: 'nowrap', cursor: 'pointer' }}>
              <input type="radio" name="su-kind" checked={joining} onChange={() => setJoining(true)} />
              <span>Agent d'accueil : j'ai un code d'accès à un événement</span>
            </label>
          </fieldset>
        )}
        {mode === 'signup' && !joining && (
          <div className="field">
            <label htmlFor="su-org" className="required">Nom de votre organisation</label>
            <span className="hint" id="su-org-hint">Vous en serez le propriétaire et pourrez y ajouter votre équipe.</span>
            <input id="su-org" className="input" autoComplete="organization" required maxLength={200} value={form.organization} onChange={set('organization')} aria-describedby="su-org-hint" />
          </div>
        )}
        {mode === 'signup' && joining && (
          <div className="field">
            <label htmlFor="su-code" className="required">Code d'accès</label>
            <span className="hint" id="su-code-hint">8 caractères, communiqués par l'organisateur.</span>
            <input id="su-code" className="input" required autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12}
              value={form.code} onChange={set('code')} aria-describedby="su-code-hint" style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: 2 }} />
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

export function Events() {
  const store = useStore();
  const notify = useNotify();
  const { session, org, selectOrg, setSession } = useSession();
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '', venue: '', capacity: '1000' });
  const [orgName, setOrgName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const tour = useTour();

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

  // Version de démonstration seulement : salon fictif complet, pour montrer Direct et les statistiques
  const loadDemo = async () => {
    if (!org || !store.seedDemo) return;
    try {
      const event = await store.seedDemo(org.orgId);
      notify("Démonstration chargée : 1 100 inscrits, hier et aujourd'hui");
      navigate('e', event.id, 'direct');
    } catch (err) { notify(errorMessage(err), 'danger'); }
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
  const eventAccess = session?.eventAccess ?? [];
  const today = parisDay(Date.now());

  const join = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const before = new Set(eventAccess.map((a) => a.eventId));
      const next = await store.joinEvent(code);
      setSession(next);
      setCode('');
      const joined = next.eventAccess.find((a) => !before.has(a.eventId));
      notify(joined ? `Vous avez rejoint « ${joined.eventName} »` : 'Vous avez déjà accès à cet événement');
      if (joined) navigate('e', joined.eventId, 'scan');
    } catch (err) { notify(errorMessage(err), 'danger'); }
  };

  return (
    <>
      <AppHeader title={org?.orgName} role={org?.role} />
      <main className="page stack">
        <div className="page-head">
          <div className="stack" style={{ gap: 2 }}>
            <h1 className="page-title">Événements</h1>
            {org && <p className="page-sub">{org.orgName}</p>}
          </div>
          <div className="row" style={{ alignItems: 'flex-end' }}>
            {memberships.length > 1 && (
              <div className="field">
                <label htmlFor="org-select">Organisation</label>
                <select id="org-select" className="input" value={org?.orgId ?? ''} onChange={(e) => selectOrg(e.target.value)}>
                  {memberships.map((m) => <option key={m.orgId} value={m.orgId}>{m.orgName} ({ROLE_LABELS[m.role].toLowerCase()})</option>)}
                </select>
              </div>
            )}
            {tour.available && can(org?.role, 'event.create') && (
              <button className="btn" onClick={() => void tour.start()}><Compass size={18} aria-hidden="true" />Visite guidée</button>
            )}
            {can(org?.role, 'event.create') && store.seedDemo && (
              <button className="btn btn-secondary" onClick={() => void loadDemo()}><Sparkles size={18} aria-hidden="true" />Charger une démonstration</button>
            )}
            {can(org?.role, 'event.create') && (
              <button className={store.seedDemo ? 'btn btn-secondary' : 'btn'} onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true" />Nouvel événement</button>
            )}
          </div>
        </div>

        {eventAccess.length > 0 && (
          <section aria-labelledby="joined-title" className="stack">
            <h2 id="joined-title" style={{ fontSize: 18 }}>Événements rejoints avec un code</h2>
            <ul className="grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {eventAccess.map((a) => (
                <li key={a.eventId} className="card stack" style={{ gap: 6 }}>
                  <h3 style={{ fontSize: 18, margin: 0 }}><a href={href('e', a.eventId, 'scan')}>{a.eventName}</a></h3>
                  <p className="muted">{a.startDate === a.endDate ? dayLabel(a.startDate) : `Du ${dayLabel(a.startDate)} au ${dayLabel(a.endDate)}`}</p>
                  <p className="small">Agent d'accueil</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!org ? <p className="muted">Vous n'êtes membre d'aucune organisation. Rejoignez un événement avec son code, ou créez votre organisation ci-dessous.</p>
          : events === null ? <p role="status">Chargement…</p>
            : events.length === 0
              ? <div className="card empty"><Calendar size={28} aria-hidden="true" /><p>Aucun événement pour le moment.{can(org.role, 'event.create') && ' Créez le premier avec « Nouvel événement ».'}</p></div>
              : (
                <ul className="event-grid">
                  {events.map((ev) => {
                    const phase = ev.endDate < today ? 'past' : ev.startDate > today ? 'future' : 'live';
                    return (
                      <li key={ev.id}>
                        <a className="event-card" href={href('e', ev.id, can(org.role, 'event.edit') ? 'direct' : 'scan')}>
                          <span className="row-between" style={{ flexWrap: 'nowrap' }}>
                            <span className={`pill ${phase === 'live' ? 'pill-ok' : phase === 'future' ? 'pill-info' : 'pill-muted'}`}>
                              {phase === 'live' ? 'En cours' : phase === 'future' ? 'À venir' : 'Terminé'}
                            </span>
                            <ChevronRight size={18} aria-hidden="true" className="event-card-arrow" />
                          </span>
                          <span className="event-card-name">{ev.name}</span>
                          <span className="event-card-meta">
                            <span><Calendar size={15} aria-hidden="true" />{ev.startDate === ev.endDate ? dayLabel(ev.startDate) : `Du ${dayLabel(ev.startDate)} au ${dayLabel(ev.endDate)}`}</span>
                            {ev.venue && <span><MapPin size={15} aria-hidden="true" />{ev.venue}</span>}
                            <span><Users size={15} aria-hidden="true" />Jauge de {ev.capacity.toLocaleString('fr-FR')} personnes</span>
                          </span>
                          {ev.purgedAt
                            ? <span className="pill pill-muted">Données purgées · bilan conservé</span>
                            : retentionState(ev, today) !== 'kept' && can(org.role, 'event.edit') && (
                              <span className="pill pill-warn">Effacement des données le {longDay(purgeDay(ev))}</span>
                            )}
                        </a>
                      </li>
                    );
                  })}
                </ul>
              )}

        <Modal open={creating} onClose={() => { setCreating(false); setError(''); }} title="Nouvel événement">
          <form className="stack" onSubmit={create} aria-label="Nouvel événement">
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
        </Modal>

        <form className="card stack" onSubmit={join} aria-labelledby="join-title">
          <h2 id="join-title" style={{ marginBottom: 0 }}>Rejoindre un événement avec un code</h2>
          <p className="muted">Agent d'accueil : saisissez le code communiqué par l'organisateur. Vous n'aurez accès qu'à cet événement.</p>
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <label htmlFor="join-code" className="sr-only">Code d'accès</label>
            <input id="join-code" className="input" required autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={12}
              value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code à 8 caractères" style={{ fontFamily: 'ui-monospace, monospace', letterSpacing: 2 }} />
            <button className="btn" type="submit">Rejoindre</button>
          </div>
        </form>

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
