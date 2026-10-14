// Service worker (public/sw.js) exécuté avec un cache et un réseau simulés : tous les fichiers de
// l'application doivent être gardés, pour qu'un poste coupé du réseau puisse ouvrir n'importe quel écran.
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

type Handler = (event: { waitUntil(p: Promise<unknown>): void; data?: unknown; request?: unknown; respondWith?(r: unknown): void }) => void;

function loadWorker(network: Record<string, string>, online = { value: true }) {
  const store = new Map<string, string>();
  const handlers: Record<string, Handler> = {};
  const fetched: string[] = [];
  const response = (url: string) => {
    const body = network[url];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, json: async () => JSON.parse(body!), clone() { return this; }, body };
  };
  const fetch = async (input: string | { url: string }) => {
    const url = typeof input === 'string' ? input : new URL(input.url).pathname;
    fetched.push(url);
    if (!online.value) throw new TypeError('Failed to fetch');
    return response(url);
  };
  const cache = {
    match: async (url: string) => store.get(url),
    add: async (url: string) => {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      store.set(url, r.body!);
    },
    put: async (url: string, r: { body: string }) => { store.set(url, r.body); },
  };
  const self = {
    addEventListener: (type: string, fn: Handler) => { handlers[type] = fn; },
    skipWaiting: async () => undefined,
    clients: { claim: async () => undefined },
    location: { origin: 'https://ec.test' },
  };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), {
    self, fetch, URL, Response, Promise, Set, Object, JSON, console,
    caches: { open: async () => cache, keys: async () => [], delete: async () => true, match: async (u: string) => store.get(u) },
  });
  const dispatch = async (type: string, extra: object = {}) => {
    const pending: Promise<unknown>[] = [];
    handlers[type]!({ waitUntil: (p) => { pending.push(p); }, ...extra });
    await Promise.all(pending);
  };
  return { store, fetched, dispatch };
}

const manifest = {
  'index.html': { file: 'assets/index-a1.js', css: ['assets/index-a1.css'], imports: ['_context-c3.js'] },
  '_context-c3.js': { file: 'assets/context-c3.js' },
  'src/ui/CameraScanner.tsx': { file: 'assets/CameraScanner-b2.js', assets: ['assets/zxing_reader-d4.wasm'], isDynamicEntry: true },
  'src/pages/Settings.tsx': { file: 'assets/Settings-e5.js', isDynamicEntry: true },
};
const files = ['/', '/assets/index-a1.js', '/assets/index-a1.css', '/assets/context-c3.js', '/assets/CameraScanner-b2.js', '/assets/zxing_reader-d4.wasm', '/assets/Settings-e5.js'];
const network = Object.fromEntries([...files.map((f) => [f, `contenu ${f}`]), ['/asset-manifest.json', JSON.stringify(manifest)]]);

describe('service worker : fonctionnement hors ligne', () => {
  it("garde dès l'installation tous les fichiers construits, modules chargés à la demande et décodeur compris", async () => {
    const sw = loadWorker(network);
    await sw.dispatch('install');
    expect([...sw.store.keys()].sort()).toEqual([...files].sort());
  });

  it('au démarrage suivant, ne télécharge que les fichiers nouveaux (mise à jour de l\'application)', async () => {
    const sw = loadWorker(network);
    await sw.dispatch('install');
    const updated = { ...manifest, 'src/pages/Settings.tsx': { file: 'assets/Settings-f6.js', isDynamicEntry: true } };
    network['/asset-manifest.json'] = JSON.stringify(updated);
    network['/assets/Settings-f6.js'] = 'nouveau';
    sw.fetched.length = 0;
    await sw.dispatch('message', { data: 'precache' });
    expect(sw.store.get('/assets/Settings-f6.js')).toBe('nouveau');
    expect(sw.fetched.filter((u) => u.startsWith('/assets/'))).toEqual(['/assets/Settings-f6.js']);
    network['/asset-manifest.json'] = JSON.stringify(manifest);
  });

  it('hors ligne, l\'installation ne bloque pas et rien n\'est perdu', async () => {
    const online = { value: false };
    const sw = loadWorker(network, online);
    await expect(sw.dispatch('install')).resolves.toBeUndefined();
    expect(sw.store.size).toBe(0);
    online.value = true;
    await sw.dispatch('message', { data: 'precache' });
    expect(sw.store.size).toBe(files.length);
  });
});
