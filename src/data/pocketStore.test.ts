// Suite de contrat rejouée contre un vrai serveur PocketBase (base temporaire, hooks compilés).
// Ignorée si le binaire n'est pas installé : npm run server:install.
import { PocketStore } from './pocketStore';
import { describeStoreContract } from './storeContract';
import { serverInstalled, startTestServer, type TestServer } from './testServer';

let server: TestServer | undefined;
let url = '';

if (serverInstalled) {
  beforeAll(async () => { server = await startTestServer(); url = server.url; }, 60_000);
  afterAll(() => server?.stop());
}

describe.skipIf(!serverInstalled)('PocketStore (serveur)', () => {
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
