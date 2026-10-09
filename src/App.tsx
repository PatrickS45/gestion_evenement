import { AgentProvider, ToastProvider, useAgent } from './app/context';
import { useRoute } from './app/router';
import { Events, SignIn } from './pages/Home';
import { EventShell } from './pages/EventShell';
import { Access, Register } from './pages/Public';

function Organizer({ route }: { route: string[] }) {
  const { agent } = useAgent();
  if (!agent) return <SignIn />;
  if (route[0] === 'e' && route[1]) return <EventShell eventId={route[1]} section={route[2] ?? 'direct'} />;
  return <Events />;
}

export function App() {
  const route = useRoute();
  return (
    <ToastProvider>
      {route[0] === 'inscription' && route[1] ? <Register eventId={route[1]} />
        : route[0] === 'acces' && route[1] ? <Access token={route[1]} />
          : <AgentProvider><Organizer route={route} /></AgentProvider>}
    </ToastProvider>
  );
}
