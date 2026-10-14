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
  describeStoreContract('PocketStore', async () => [new PocketStore(url), new PocketStore(url), new PocketStore(url)] as const);

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

  it("purge automatique à l'échéance de conservation, réservée à l'administration du serveur (NF-33)", async () => {
    const owner = new PocketStore(url);
    const n = Date.now().toString(36);
    const orgId = (await owner.signUp({ name: 'Claire', email: `purge-${n}@x.fr`, password: 'motdepasse-solide', organization: 'Salon' })).memberships[0]!.orgId;
    const event = await owner.createEvent(orgId, { name: 'Ancien salon', startDate: '2090-01-10', endDate: '2090-01-11' });
    const later = await owner.createEvent(orgId, { name: 'Salon suivant', startDate: '2090-03-10', endDate: '2090-03-11' });
    await owner.addParticipants(event.id, [{ firstName: 'Léa', lastName: 'Petit', email: 'lea@x.fr', typeId: 'magasin', source: 'import' }]);

    await expect(owner.pb.send('/api/ec/maintenance/purge', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 403 });
    const admin = new PocketStore(url).pb;
    await admin.collection('_superusers').authWithPassword('admin@test.local', 'superuser-de-test');
    const run = (today: string) => admin.send<{ purged: number }>('/api/ec/maintenance/purge', { method: 'POST', body: { today } });
    const purgedAt = async () => (await owner.listEvents(orgId)).find((e) => e.id === event.id)?.purgedAt;
    await run('2090-04-10'); // la veille de l'échéance (fin + 3 mois) ; les événements des autres tests, eux, sont purgés
    expect(await purgedAt()).toBeNull();
    expect((await run('2090-04-11')).purged).toBe(1);

    const events = await owner.listEvents(orgId);
    expect(events.find((e) => e.id === event.id)?.purgedAt).toBeTruthy();
    expect(events.find((e) => e.id === later.id)?.purgedAt).toBeNull();
    expect(await owner.listReports(orgId)).toEqual([expect.objectContaining({ eventName: 'Ancien salon', registered: 1, reason: 'purge' })]);
    expect((await owner.listAudit(orgId))[0]).toMatchObject({ action: 'purge', count: 1, actorName: 'Purge automatique', detail: 'Échéance de conservation' });
  });

  it('en-têtes de sécurité sur toutes les réponses (NF-21)', async () => {
    const r = await fetch(`${url}/api/health`);
    expect(r.headers.get('content-security-policy')).toMatch(/default-src 'self'.*frame-ancestors 'none'/);
    expect(r.headers.get('x-frame-options')).toBe('DENY');
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    expect(r.headers.get('permissions-policy')).toContain('camera=(self)');
  });
});
