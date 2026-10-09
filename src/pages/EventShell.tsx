import { useEffect } from 'react';
import { useAgent, useEventSnapshot } from '../app/context';
import { href } from '../app/router';
import { Participants } from './Participants';
import { Scan } from './Scan';
import { Live } from './Live';
import { Settings } from './Settings';
import { Exports } from './Exports';

const SECTIONS = [
  { id: 'direct', label: 'Direct' },
  { id: 'scan', label: 'Scan' },
  { id: 'participants', label: 'Participants' },
  { id: 'exports', label: 'Statistiques et exports' },
  { id: 'parametres', label: 'Paramètres' },
] as const;

export function EventShell({ eventId, section }: { eventId: string; section: string }) {
  const snapshot = useEventSnapshot(eventId);
  const { agent } = useAgent();
  const current = SECTIONS.find((s) => s.id === section) ?? SECTIONS[0];

  useEffect(() => {
    if (snapshot) document.title = `${current.label} – ${snapshot.event.name} – Event Control`;
  }, [snapshot, current]);

  if (snapshot === undefined) return <main className="page"><p role="status">Chargement…</p></main>;
  if (snapshot === null) return (
    <main className="page stack">
      <h1 style={{ fontSize: 22 }}>Événement introuvable</h1>
      <p><a href={href()}>Retour à la liste des événements</a></p>
    </main>
  );

  const { event } = snapshot;
  return (
    <>
      <header className="topbar on-dark no-print">
        <div className="topbar-inner">
          <div>
            <a className="brand" href={href()}>Event Control</a>
            <span aria-hidden="true"> › </span>
            <span style={{ fontWeight: 700 }}>{event.name}</span>
          </div>
          <span className="topbar-meta">{agent?.name} · {agent?.stationId}</span>
        </div>
      </header>
      <nav className="tabs no-print" aria-label="Sections de l'événement">
        <div className="tabs-inner">
          {SECTIONS.map((s) => (
            <a key={s.id} className="tab" href={href('e', eventId, s.id)} aria-current={s.id === current.id ? 'page' : undefined}>{s.label}</a>
          ))}
        </div>
      </nav>
      <main className="page">
        <h1 className="sr-only">{current.label} – {event.name}</h1>
        {current.id === 'direct' && <Live snapshot={snapshot} />}
        {current.id === 'scan' && <Scan snapshot={snapshot} />}
        {current.id === 'participants' && <Participants snapshot={snapshot} />}
        {current.id === 'exports' && <Exports snapshot={snapshot} />}
        {current.id === 'parametres' && <Settings snapshot={snapshot} />}
      </main>
    </>
  );
}
