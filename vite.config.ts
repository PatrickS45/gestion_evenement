import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // En développement, /api est relayé vers PocketBase : avec VITE_POCKETBASE_URL=/ (voir .env.example),
  // un téléphone du réseau local n'a besoin que de l'adresse du serveur Vite (npm run dev -- --host)
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8090' } },
  test: {
    globals: true,
    environment: 'node',
  },
});
