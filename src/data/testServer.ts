// Serveur PocketBase temporaire pour les tests : base vierge, hooks compilés, port tiré au hasard.
// Les tests qui l'utilisent sont ignorés si le binaire n'est pas installé : npm run server:install.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventSource } from 'eventsource';
import { PocketStore } from './pocketStore';

const root = fileURLToPath(new URL('../..', import.meta.url));
const binary = join(root, 'server/bin', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');

export const serverInstalled = existsSync(binary);

export interface TestServer {
  url: string;
  stop(): void;
}

/** @param rateLimits garder la limitation des requêtes de production (sinon désactivée) */
export async function startTestServer({ rateLimits = false } = {}): Promise<TestServer> {
  (globalThis as { EventSource?: unknown }).EventSource ??= EventSource; // temps réel sous Node

  execFileSync(process.execPath, [join(root, 'scripts/build-hooks.mjs')]);
  const dataDir = mkdtempSync(join(tmpdir(), 'event-control-pb-'));
  const dirs = [`--dir=${dataDir}`, `--hooksDir=${join(root, 'server/pb_hooks')}`, `--migrationsDir=${join(root, 'server/pb_migrations')}`];
  execFileSync(binary, ['migrate', 'up', ...dirs]);
  execFileSync(binary, ['superuser', 'upsert', 'admin@test.local', 'superuser-de-test', ...dirs]);
  const port = 18000 + Math.floor(Math.random() * 1000);
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(binary, ['serve', `--http=127.0.0.1:${port}`, ...dirs], { stdio: 'ignore' });
  const stop = () => {
    server.kill();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };

  try {
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* pas encore démarré */ }
      if (i > 100) throw new Error('PocketBase ne démarre pas');
      await new Promise((r) => setTimeout(r, 100));
    }
    if (!rateLimits) {
      // Les tests créent de nombreux comptes depuis la même adresse
      const admin = new PocketStore(url).pb;
      await admin.collection('_superusers').authWithPassword('admin@test.local', 'superuser-de-test');
      await admin.settings.update({ rateLimits: { enabled: false } });
    }
  } catch (err) {
    stop();
    throw err;
  }
  return { url, stop };
}
