import { LocalStore, memoryKeyValue, queueLock, type Bus } from './localStore';
import { describeStoreContract } from './storeContract';

// Deux « onglets » partageant le même stockage, le même verrou et un canal de diffusion,
// chacun avec sa propre session
function twoStations() {
  const storage = memoryKeyValue();
  const handlers: { owner: number; fn: (m: string) => void }[] = [];
  const bus = (owner: number): Bus => ({
    post: (m) => handlers.filter((h) => h.owner !== owner).forEach((h) => h.fn(m)),
    listen: (fn) => { handlers.push({ owner, fn }); },
  });
  const lock = queueLock();
  return [new LocalStore(storage, bus(1), lock), new LocalStore(storage, bus(2), lock)] as const;
}

describeStoreContract('LocalStore', async () => twoStations());

describe('LocalStore — spécificités', () => {
  it('bloque après 5 échecs de connexion en une minute (NF-22)', async () => {
    const [a] = twoStations();
    for (let i = 0; i < 5; i++) await expect(a.signIn('x@x.fr', 'faux')).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(a.signIn('x@x.fr', 'faux')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('rattache à la première organisation les événements créés avant les comptes', async () => {
    const storage = memoryKeyValue();
    storage.set('event-control:db', JSON.stringify({
      version: 1, participants: {}, passages: [], refusals: [],
      events: { e1: { id: 'e1', name: 'Ancien', startDate: '2026-01-01', endDate: '2026-01-01', venue: '', capacity: 10, thresholds: { warn: 0.8, critical: 0.95 }, types: [], registrationOpen: false, createdAt: '' } },
    }));
    const store = new LocalStore(storage, null);
    const session = await store.signUp({ name: 'A', email: 'a@x.fr', password: 'motdepasse-solide', organization: 'Org' });
    expect((await store.listEvents(session.memberships[0]!.orgId)).map((e) => e.name)).toEqual(['Ancien']);
  });

  it("purge automatique à l'échéance de conservation, au démarrage de l'application (NF-33)", async () => {
    let now = new Date('2027-03-01T10:00:00Z');
    const store = new LocalStore(memoryKeyValue(), null, queueLock(), memoryKeyValue(), () => now);
    const orgId = (await store.signUp({ name: 'A', email: 'a@x.fr', password: 'motdepasse-solide', organization: 'Org' })).memberships[0]!.orgId;
    const event = await store.createEvent(orgId, { name: 'Salon', startDate: '2027-03-11', endDate: '2027-03-12' });
    await store.addParticipants(event.id, [{ firstName: 'Léa', lastName: 'Petit', email: 'lea@x.fr', typeId: 'magasin', source: 'manual' }]);
    now = new Date('2027-06-11T10:00:00Z');
    expect(await store.purgeDue()).toBe(0);
    now = new Date('2027-06-12T10:00:00Z');
    expect(await store.purgeDue()).toBe(1);
    expect((await store.listEvents(orgId))[0]!.purgedAt).toBe('2027-06-12T10:00:00.000Z');
    expect((await store.listAudit(orgId))[0]).toMatchObject({ action: 'purge', actorName: 'Purge automatique' });
    expect(await store.purgeDue()).toBe(0);
  });
});
