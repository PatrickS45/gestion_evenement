import { SessionProvider, ToastProvider, useSession } from './app/context';
import { useRoute } from './app/router';
import { Events, SignIn } from './pages/Home';
import { EventShell } from './pages/EventShell';
import { Members } from './pages/Members';
import { Access, Register } from './pages/Public';

function Organizer({ route }: { route: string[] }) {
  const { session } = useSession();
  if (session === undefined) return <main className="page"><p role="status">Chargement…</p></main>;
  if (!session) return <SignIn />;
  if (route[0] === 'e' && route[1]) return <EventShell key={session.user.id} eventId={route[1]} section={route[2] ?? 'direct'} />;
  if (route[0] === 'membres') return <Members />;
  return <Events />;
}

export function App() {
  const route = useRoute();
  return (
    <ToastProvider>
      {route[0] === 'inscription' && route[1] ? <Register eventId={route[1]} />
        : route[0] === 'acces' && route[1] ? <Access token={route[1]} />
          : <SessionProvider><Organizer route={route} /></SessionProvider>}
    </ToastProvider>
  );
}
