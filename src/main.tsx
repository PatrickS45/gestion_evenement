import { StrictMode } from 'react';
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
const store = serverUrl
  ? new StationStore(new PocketStore(serverUrl, browserSession()), new Vault(indexedDbBackend()))
  : createBrowserStore();

// Application disponible sans réseau ; en développement, le rechargement de Vite suffit
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
);
