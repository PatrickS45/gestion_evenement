import { Suspense, useEffect } from 'react';
import { Activity, ChartColumn, ScanLine, Settings, Users, type LucideIcon } from 'lucide-react';
import { useEventSnapshot } from '../app/context';
import { href } from '../app/router';
import { can, type Action } from '../domain/access';
import { Scan } from './Scan';
import { Live } from './Live';
import { LazyExports, LazyParticipants, LazySettings } from '../app/lazy';
import { StationBar } from '../ui/StationBar';
import { RetentionBanner } from '../ui/privacy';
import { GaugeAlerts } from '../ui/GaugeAlerts';
import { AppHeader } from '../ui/AppHeader';

/** Sections et droit requis pour les voir : l'agent d'accueil n'a accès qu'au direct et au scan. */
const SECTIONS: readonly { id: string; label: string; requires: Action; icon: LucideIcon }[] = [
  { id: 'direct', label: 'Direct', requires: 'scan', icon: Activity },
  { id: 'scan', label: 'Scan', requires: 'scan', icon: ScanLine },
  { id: 'participants', label: 'Participants', requires: 'participants.manage', icon: Users },
  { id: 'exports', label: 'Statistiques', requires: 'stats.export', icon: ChartColumn },
  { id: 'parametres', label: 'Paramètres', requires: 'event.edit', icon: Settings },
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
    <>
      <AppHeader />
      <main className="page stack">
        <h1 className="page-title">Événement introuvable</h1>
        <p><a href={href()}>Retour à la liste des événements</a></p>
      </main>
    </>
  );

  const { event } = snapshot;
  const nav = sections.map((s) => ({ id: s.id, label: s.label, icon: s.icon, href: href('e', eventId, s.id) }));
  return (
    <>
      <AppHeader title={event.name} nav={nav} current={current.id} role={snapshot.role} eventId={eventId} />
      <StationBar eventId={eventId} />
      <RetentionBanner event={event} role={snapshot.role} />
      {!event.purgedAt && <GaugeAlerts key={event.id} event={event} present={snapshot.participants.filter((p) => p.inside).length} />}
      <main className={current.id === 'scan' ? 'page page-scan' : 'page'}>
        <h1 className="sr-only">{current.label} – {event.name}</h1>
        {current.id === 'direct' && <Live snapshot={snapshot} />}
        {current.id === 'scan' && <Scan snapshot={snapshot} />}
        <Suspense fallback={<p role="status">Chargement…</p>}>
          {current.id === 'participants' && <LazyParticipants snapshot={snapshot} />}
          {current.id === 'exports' && <LazyExports snapshot={snapshot} />}
          {current.id === 'parametres' && <LazySettings snapshot={snapshot} />}
        </Suspense>
      </main>
    </>
  );
}
