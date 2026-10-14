import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // En développement, /api est relayé vers PocketBase : avec VITE_POCKETBASE_URL=/ (voir .env.example),
  // un téléphone du réseau local n'a besoin que de l'adresse du serveur Vite (npm run dev -- --host)
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8090' } },
  // Liste des fichiers construits : le service worker les garde tous, pour le fonctionnement hors ligne
  build: { manifest: 'asset-manifest.json' },
  test: {
    globals: true,
    environment: 'node',
    // Le test de charge dure plusieurs minutes : lancé à part (npm run test:charge)
    ...(mode === 'charge'
      ? { include: ['src/**/*.charge.test.ts'] }
      : { exclude: [...configDefaults.exclude, '**/*.charge.test.ts'] }),
  },
}));
