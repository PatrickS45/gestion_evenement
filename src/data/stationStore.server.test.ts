// Coupure réelle : le serveur PocketBase est arrêté pendant que deux postes scannent, puis relancé
// (recette 10.2, test hors ligne). Ignoré si le binaire n'est pas installé : npm run server:install.
import { PocketStore } from './pocketStore';
import { StationStore } from './stationStore';
import { snapshotOf } from './storeContract';
import type { EventSnapshot } from './store';
import { serverInstalled, startTestServer, type TestServer } from './testServer';
import { memoryBackend, Vault } from './vault';

let server: TestServer | undefined;

if (serverInstalled) {
  beforeAll(async () => { server = await startTestServer(); }, 60_000);
  afterAll(() => server?.stop());
}

const PASSWORD = 'motdepasse-solide';

describe.skipIf(!serverInstalled)('StationStore sur PocketBase — coupure du serveur', () => {
  it('deux postes continuent de scanner, puis se synchronisent : doublon signalé, comptage juste', async () => {
    const url = server!.url;
    const owner = new PocketStore(url);
    const n = Date.now().toString(36);
    const orgId = (await owner.signUp({ name: 'Claire', email: `claire-${n}@x.fr`, password: PASSWORD, organization: 'Salon' })).memberships[0]!.orgId;
    const event = await owner.createEvent(orgId, { name: 'Salon', startDate: '2027-03-11', endDate: '2099-12-31', capacity: 100 });
    const [lea, marc, zoe] = await owner.addParticipants(event.id, ['Léa', 'Marc', 'Zoé'].map((firstName, i) => (
      { firstName, lastName: `Nom${i}`, email: `p${i}@x.fr`, typeId: 'magasin', source: 'manual' as const })));

    const stations = await Promise.all(['bruno', 'chloe'].map(async (name) => {
      const inner = new PocketStore(url);
      const store = new StationStore(inner, new Vault(memoryBackend()), { probeMs: 200 });
      await store.signUp({ name, email: `${name}-${n}@x.fr`, password: PASSWORD, organization: `Perso ${name}` });
      await owner.addMember(orgId, `${name}-${n}@x.fr`, 'agent');
      await store.getSession();
      await store.prepare(event.id);
      return store;
    }));
    const [a, b] = stations as [StationStore, StationStore];
    const seen: EventSnapshot[] = [];
    const stop = a.subscribe(event.id, (s) => s && seen.push(s));
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(0));

    server!.cut();
    expect((await a.scan(event.id, lea!.token, 'in', 'camera', 'poste-1')).passage).toMatchObject({ origin: 'offline' });
    expect((await b.scan(event.id, lea!.token, 'in', 'camera', 'poste-2')).passage).toMatchObject({ origin: 'offline' });
    await b.scan(event.id, marc!.token, 'in', 'camera', 'poste-2');
    expect(a.getStatus()).toMatchObject({ online: false, pending: 1 });
    expect(b.getStatus()).toMatchObject({ online: false, pending: 2 });

    await server!.resume();
    await vi.waitFor(() => expect([a.getStatus().online, b.getStatus().online]).toEqual([true, true]), { timeout: 10_000, interval: 100 });
    expect(a.getStatus().duplicates + b.getStatus().duplicates).toBe(1);

    const snap = (await snapshotOf(owner, event.id))!;
    expect(snap.participants.filter((p) => p.inside).map((p) => p.firstName).sort()).toEqual(['Léa', 'Marc']);
    expect(snap.passages.filter((p) => p.offlineDuplicate)).toHaveLength(1);

    // Le poste a retrouvé le temps réel : un scan de l'autre poste lui parvient
    await b.scan(event.id, zoe!.token, 'in', 'camera', 'poste-2');
    await vi.waitFor(() => expect(seen.at(-1)!.participants.filter((p) => p.inside)).toHaveLength(3), { timeout: 5000 });
    stop();
    for (const s of stations) s.dispose();
  }, 60_000);
});
