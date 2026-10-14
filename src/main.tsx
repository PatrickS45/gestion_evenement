import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { StoreProvider } from './app/context';
import { browserSession, createBrowserStore } from './data/localStore';
import { PocketStore } from './data/pocketStore';
import './styles.css';

// Avec VITE_POCKETBASE_URL (fichier .env.local), les données sont sur le serveur ;
// sans, elles restent dans le navigateur (démonstration sur un seul appareil).
const serverUrl = import.meta.env.VITE_POCKETBASE_URL as string | undefined;
const store = serverUrl ? new PocketStore(serverUrl, browserSession()) : createBrowserStore();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
);
