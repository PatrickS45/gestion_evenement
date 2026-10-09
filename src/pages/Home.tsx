import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, useAgent, useNotify, useStore } from '../app/context';
import { href, navigate } from '../app/router';
import type { EventInfo } from '../domain/model';

const dayLabel = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

export function SignIn() {
  const { signIn } = useAgent();
  const [name, setName] = useState('');
  const submit = (e: FormEvent) => { e.preventDefault(); if (name.trim()) signIn(name); };
  return (
    <main className="public">
      <form className="public-card stack" onSubmit={submit}>
        <h1 style={{ fontSize: 26 }}>Event Control</h1>
        <p className="muted">Version de démonstration : les données restent sur cet appareil.</p>
        <div className="field">
          <label htmlFor="agent-name">Votre nom</label>
          <span className="hint" id="agent-hint">Il apparaîtra dans le journal des passages que vous enregistrez.</span>
          <input id="agent-name" className="input" autoComplete="name" required value={name} onChange={(e) => setName(e.target.value)} aria-describedby="agent-hint" />
        </div>
        <button className="btn" type="submit">Continuer</button>
      </form>
    </main>
  );
}

export function Events() {
  const store = useStore();
  const notify = useNotify();
  const { agent, signOut } = useAgent();
  const [events, setEvents] = useState<EventInfo[] | null>(null);
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '', venue: '', capacity: '1000' });
  const [error, setError] = useState('');

  useEffect(() => { store.listEvents().then(setEvents); }, [store]);
  useEffect(() => { document.title = 'Événements – Event Control'; }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const event = await store.createEvent({
        name: form.name, startDate: form.startDate, endDate: form.endDate || form.startDate,
        venue: form.venue, capacity: parseInt(form.capacity, 10) || 0,
      });
      notify(`Événement « ${event.name} » créé`);
      navigate('e', event.id, 'parametres');
    } catch (err) { setError(errorMessage(err)); }
  };

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });

  return (
    <>
      <header className="topbar on-dark">
        <div className="topbar-inner">
          <span className="brand">Event Control</span>
          <span className="topbar-meta">{agent?.name} · {agent?.stationId} · <button className="btn btn-ghost btn-small" style={{ color: '#fff' }} onClick={signOut}>Changer d'utilisateur</button></span>
        </div>
      </header>
      <main className="page stack">
        <h1 style={{ fontSize: 24 }}>Événements</h1>

        {events === null ? <p role="status">Chargement…</p> : events.length === 0
          ? <p className="muted">Aucun événement pour le moment. Créez le premier ci-dessous.</p>
          : (
            <ul className="grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {events.map((ev) => (
                <li key={ev.id} className="card stack" style={{ gap: 6 }}>
                  <h2 style={{ fontSize: 18, margin: 0 }}><a href={href('e', ev.id, 'direct')}>{ev.name}</a></h2>
                  <p className="muted">
                    {ev.startDate === ev.endDate ? dayLabel(ev.startDate) : `Du ${dayLabel(ev.startDate)} au ${dayLabel(ev.endDate)}`}
                    {ev.venue && <><br />{ev.venue}</>}
                  </p>
                  <p className="small">Jauge : {ev.capacity.toLocaleString('fr-FR')} personnes</p>
                </li>
              ))}
            </ul>
          )}

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
      </main>
    </>
  );
}
