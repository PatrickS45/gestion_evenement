import { useEffect } from 'react';
import { useEventSnapshot } from '../app/context';
import { href } from '../app/router';
import { can, type Action } from '../domain/access';
import { UserMeta } from './Home';
import { Participants } from './Participants';
import { Scan } from './Scan';
import { Live } from './Live';
import { Settings } from './Settings';
import { Exports } from './Exports';

/** Sections et droit requis pour les voir : l'agent d'accueil n'a accès qu'au direct et au scan. */
const SECTIONS: readonly { id: string; label: string; requires: Action }[] = [
  { id: 'direct', label: 'Direct', requires: 'scan' },
  { id: 'scan', label: 'Scan', requires: 'scan' },
  { id: 'participants', label: 'Participants', requires: 'participants.manage' },
  { id: 'exports', label: 'Statistiques et exports', requires: 'stats.export' },
  { id: 'parametres', label: 'Paramètres', requires: 'event.edit' },
];

export function EventShell({ eventId, section }: { eventId: string; section: string }) {
  const snapshot = useEventSnapshot(eventId);
  const sections = SECTIONS.filter((s) => snapshot && can(snapshot.role, s.requires));
  const current = sections.find((s) => s.id === section) ?? sections[0] ?? SECTIONS[0]!;

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
          <UserMeta role={snapshot.role} />
        </div>
      </header>
      <nav className="tabs no-print" aria-label="Sections de l'événement">
        <div className="tabs-inner">
          {sections.map((s) => (
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
