import { Suspense, useEffect } from 'react';
import { SessionProvider, ToastProvider, useSession } from './app/context';
import { LazyDataProtection, LazyMembers } from './app/lazy';
import { useRoute } from './app/router';
import { Events, SignIn } from './pages/Home';
import { EventShell } from './pages/EventShell';
import { Access, Register } from './pages/Public';
import { requestTour, TourProvider } from './ui/Tour';

function Organizer({ route }: { route: string[] }) {
  const { session } = useSession();
  if (session === undefined) return <main className="page"><p role="status">Chargement…</p></main>;
  if (!session) return <SignIn />;
  if (route[0] === 'e' && route[1]) return <EventShell key={session.user.id} eventId={route[1]} section={route[2] ?? 'direct'} />;
  if (route[0] === 'membres' || route[0] === 'donnees') {
    return <Suspense fallback={<main className="page"><p role="status">Chargement…</p></main>}>{route[0] === 'membres' ? <LazyMembers /> : <LazyDataProtection />}</Suspense>;
  }
  return <Events />;
}

export function App() {
  const route = useRoute();
  // Lien de visite guidée à envoyer à un prospect : #/visite
  const tourLink = route[0] === 'visite';
  // Mémorisé avant le premier affichage (idempotent) : l'écran de connexion s'ouvre sur la création de compte
  if (tourLink) requestTour();
  useEffect(() => { if (tourLink) window.location.replace('#/'); }, [tourLink]);
  return (
    <ToastProvider>
      {route[0] === 'inscription' && route[1] ? <Register eventId={route[1]} />
        : route[0] === 'acces' && route[1] ? <Access token={route[1]} />
          : <SessionProvider><TourProvider><Organizer route={route} /></TourProvider></SessionProvider>}
    </ToastProvider>
  );
}
