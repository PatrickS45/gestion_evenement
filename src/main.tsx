import { StrictMode } from 'react';
import '@fontsource-variable/instrument-sans';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './app/context';
import { browserSession, createBrowserStore } from './data/localStore';
import { PocketStore } from './data/pocketStore';
import { StationStore } from './data/stationStore';
import { indexedDbBackend, Vault } from './data/vault';
import './styles.css';

// Avec VITE_POCKETBASE_URL (fichier .env.local), les données sont sur le serveur, et chaque poste
// continue de scanner en cas de coupure (copie chiffrée, file d'envoi) ; sans, elles restent dans
// le navigateur (démonstration sur un seul appareil).
const serverUrl = import.meta.env.VITE_POCKETBASE_URL as string | undefined;
const local = serverUrl ? null : createBrowserStore();
const store = local ?? new StationStore(new PocketStore(serverUrl!, browserSession()), new Vault(indexedDbBackend()));
// Sans serveur, la purge à l'échéance de conservation (NF-33) a lieu au démarrage ; sinon, le serveur la fait chaque nuit
void local?.purgeDue();

// Application disponible sans réseau ; en développement, le rechargement de Vite suffit
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
  // À chaque démarrage, le service worker complète sa copie des fichiers (modules chargés à la demande, mise à jour)
  navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage('precache')).catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
);
