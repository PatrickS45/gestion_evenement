// Suite de contrat rejouée contre un vrai serveur PocketBase (base temporaire, hooks compilés).
// Ignorée si le binaire n'est pas installé : npm run server:install.
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventSource } from 'eventsource';
import { PocketStore } from './pocketStore';
import { describeStoreContract } from './storeContract';

const root = fileURLToPath(new URL('../..', import.meta.url));
const binary = join(root, 'server/bin', process.platform === 'win32' ? 'pocketbase.exe' : 'pocketbase');
const installed = existsSync(binary);
const port = 18000 + Math.floor(Math.random() * 1000);
const url = `http://127.0.0.1:${port}`;

let server: ChildProcess | undefined;
let dataDir = '';

if (installed) {
  (globalThis as { EventSource?: unknown }).EventSource ??= EventSource; // temps réel sous Node

  beforeAll(async () => {
    execFileSync(process.execPath, [join(root, 'scripts/build-hooks.mjs')]);
    dataDir = mkdtempSync(join(tmpdir(), 'event-control-pb-'));
    const dirs = [`--dir=${dataDir}`, `--hooksDir=${join(root, 'server/pb_hooks')}`, `--migrationsDir=${join(root, 'server/pb_migrations')}`];
    execFileSync(binary, ['migrate', 'up', ...dirs]);
    execFileSync(binary, ['superuser', 'upsert', 'admin@test.local', 'superuser-de-test', ...dirs]);
    server = spawn(binary, ['serve', `--http=127.0.0.1:${port}`, ...dirs], { stdio: 'ignore' });

    for (let i = 0; ; i++) {
      try { if ((await fetch(`${url}/api/health`)).ok) break; } catch { /* pas encore démarré */ }
      if (i > 100) throw new Error('PocketBase ne démarre pas');
      await new Promise((r) => setTimeout(r, 100));
    }

    // Les tests créent de nombreux comptes depuis la même adresse : limitation désactivée
    const admin = new PocketStore(url).pb;
    await admin.collection('_superusers').authWithPassword('admin@test.local', 'superuser-de-test');
    await admin.settings.update({ rateLimits: { enabled: false } });
  }, 60_000);

  afterAll(() => {
    server?.kill();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  });
}

describe.skipIf(!installed)('PocketStore (serveur)', () => {
  describeStoreContract('PocketStore', async () => [new PocketStore(url), new PocketStore(url)] as const);

  it('lecture directe des collections : rien pour un utilisateur non connecté', async () => {
    const anonymous = new PocketStore(url).pb;
    for (const c of ['organizations', 'events', 'participants', 'passages', 'refusals']) {
      expect((await anonymous.collection(c).getList(1, 1)).totalItems, c).toBe(0);
    }
    await expect(anonymous.collection('passages').create({})).rejects.toMatchObject({ status: 403 });
  });

  it('lecture directe des collections : un utilisateur connecté ne voit que ses organisations (NF-24)', async () => {
    const outsider = new PocketStore(url);
    const session = await outsider.signUp({ name: 'Ext', email: `ext-${Date.now()}@x.fr`, password: 'motdepasse-solide', organization: 'Ailleurs' });
    const orgs = await outsider.pb.collection('organizations').getFullList();
    expect(orgs.map((o) => o.id)).toEqual([session.memberships[0]!.orgId]);
    for (const c of ['events', 'participants', 'passages', 'refusals', 'users']) {
      const visible = (await outsider.pb.collection(c).getList(1, 1)).totalItems;
      expect(visible, c).toBe(c === 'users' ? 1 : 0); // lui-même, dans users
    }
    await expect(outsider.pb.collection('participants').update('x', { inside: true }))
      .rejects.toSatisfy((e: { status: number }) => e.status === 403 || e.status === 404);
  });
});
