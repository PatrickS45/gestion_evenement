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
  /** Coupure : arrête le serveur sans effacer ses données ; `resume` le relance au même endroit. */
  cut(): void;
  resume(): Promise<void>;
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
  const launch = () => spawn(binary, ['serve', `--http=127.0.0.1:${port}`, ...dirs], { stdio: 'ignore' });
  let server = launch();
  const stop = () => {
    server.kill();
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  const started = async () => {
    for (let i = 0; ; i++) {
      try { if ((await fetch(`${url}/api/health`)).ok) return; } catch { /* pas encore démarré */ }
      if (i > 100) throw new Error('PocketBase ne démarre pas');
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const cut = () => { server.kill(); };
  const resume = async () => {
    await new Promise((r) => setTimeout(r, 300)); // libération du port
    server = launch();
    await started();
  };

  try {
    await started();
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
  return { url, stop, cut, resume };
}
