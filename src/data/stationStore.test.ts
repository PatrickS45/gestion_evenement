import { LocalStore, memoryKeyValue, queueLock, type Bus, type KeyValue } from './localStore';
import { StationStore, type ReachableStore } from './stationStore';
import { snapshotOf } from './storeContract';
import { StoreError, type EventSnapshot, type EventStore } from './store';
import { memoryBackend, Vault } from './vault';

/** Accès au « serveur » qu'on peut couper : tout échoue en `unreachable`, plus rien n'arrive en direct. */
function cuttable(inner: EventStore): ReachableStore & { down: boolean } {
  const state = { down: false };
  const guard = <T>(fn: () => Promise<T>) => (state.down ? Promise.reject(new StoreError('unreachable', 'Serveur injoignable')) : fn());
  const handler: ProxyHandler<EventStore> = {
    get(target, prop) {
      if (prop === 'down') return state.down;
      if (prop === 'reachable') return async () => !state.down;
      if (prop === 'subscribe') {
        return (eventId: string, listener: (s: EventSnapshot | null) => void) => {
          if (state.down) { setTimeout(() => listener(null), 0); return () => {}; }
          return target.subscribe(eventId, (s) => { if (!state.down) listener(s); });
        };
      }
      const value = Reflect.get(target, prop) as unknown;
      return typeof value === 'function' ? (...args: unknown[]) => guard(() => value.apply(target, args)) : value;
    },
    set(_target, prop, value) { if (prop === 'down') { state.down = value; return true; } return false; },
  };
  return new Proxy(inner, handler) as unknown as ReachableStore & { down: boolean };
}

const PASSWORD = 'motdepasse-solide';
let serverNow = Date.parse('2027-03-11T09:00:00.000Z');

/** Un « serveur » (stockage partagé) et des postes, chacun avec sa session, son coffre et son accès coupable. */
function world() {
  const storage = memoryKeyValue();
  const handlers: { owner: number; fn: (m: string) => void }[] = [];
  const lock = queueLock();
  let n = 0;
  const station = (options: { clockSkewMs?: number; vault?: Vault; session?: KeyValue } = {}) => {
    const owner = ++n;
    const bus: Bus = {
      post: (m) => handlers.filter((h) => h.owner !== owner).forEach((h) => h.fn(m)),
      listen: (fn) => { handlers.push({ owner, fn }); },
    };
    const session = options.session ?? memoryKeyValue();
    const net = cuttable(new LocalStore(storage, bus, lock, session, () => new Date(serverNow)));
    const vault = options.vault ?? new Vault(memoryBackend());
    const store = new StationStore(net, vault, { now: () => serverNow + (options.clockSkewMs ?? 0), today: () => '2027-03-11', probeMs: 20 });
    return { store, net, vault, session };
  };
  return { station };
}

async function setup() {
  const w = world();
  const admin = w.station();
  const s = await admin.store.signUp({ name: 'Claire', email: 'claire@x.fr', password: PASSWORD, organization: 'Salon' });
  const orgId = s.memberships[0]!.orgId;
  const event = await admin.store.createEvent(orgId, { name: 'Salon', startDate: '2027-03-11', endDate: '2027-03-12', capacity: 100 });
  const [lea, marc] = await admin.store.addParticipants(event.id, [
    { firstName: 'Léa', lastName: 'Petit', email: 'lea@x.fr', typeId: 'magasin', source: 'manual' },
    { firstName: 'Marc', lastName: 'Roy', email: 'marc@x.fr', typeId: 'exposant', source: 'manual' },
  ]);
  const agent = async (name: string, options?: Parameters<typeof w.station>[0]) => {
    const st = w.station(options);
    await st.store.signUp({ name, email: `${name}@x.fr`, password: PASSWORD, organization: `Perso ${name}` });
    await admin.store.addMember(orgId, `${name}@x.fr`, 'agent');
    await st.store.getSession();
    await st.store.prepare(event.id);
    return st;
  };
  return { w, admin, event, lea: lea!, marc: marc!, agent };
}

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const until = (ok: () => boolean) => vi.waitFor(() => { if (!ok()) throw new Error('pas encore'); }, { timeout: 2000, interval: 10 });

describe('Vault — coffre chiffré (F-60)', () => {
  it('relit ce qu\'il a enregistré, sans jamais le stocker en clair', async () => {
    const backend = memoryBackend();
    const vault = new Vault(backend);
    await vault.set('copie', { nom: 'Léa Petit', jeton: 'abcdef123456' });
    expect(await vault.get('copie')).toEqual({ nom: 'Léa Petit', jeton: 'abcdef123456' });
    const stored = backend.raw.get('copie') as { data: ArrayBuffer };
    expect(new TextDecoder().decode(stored.data)).not.toContain('Petit');
    expect(await new Vault(backend).get('copie')).toEqual({ nom: 'Léa Petit', jeton: 'abcdef123456' }); // après rechargement
  });

  it('vider le coffre détruit la clé : une copie des anciennes données est illisible', async () => {
    const backend = memoryBackend();
    const vault = new Vault(backend);
    await vault.set('copie', { secret: 1 });
    const stolen = backend.raw.get('copie');
    await vault.clear();
    expect(backend.raw.size).toBe(0);
    await backend.set('copie', stolen);
    expect(await vault.get('copie')).toBeNull();
  });
});

describe('StationStore — poste résistant aux coupures (F-60 à F-64)', () => {
  afterEach(() => { serverNow += 3_600_000; });

  it('en ligne, le scan passe par le serveur', async () => {
    const { admin, event, lea, agent } = await setup();
    const a = await agent('bruno');
    expect((await a.store.scan(event.id, lea.token, 'in', 'camera', 'poste-1')).passage).toMatchObject({ origin: 'online' });
    expect(a.store.getStatus()).toMatchObject({ online: true, pending: 0 });
    expect((await snapshotOf(admin.store, event.id))!.passages).toHaveLength(1);
    a.store.dispose();
  });

  it('serveur injoignable : scan décidé sur le poste, mis en file, puis envoyé au retour du réseau (F-61, F-62)', async () => {
    const { admin, event, lea, marc, agent } = await setup();
    const a = await agent('bruno');
    a.net.down = true;
    const r = await a.store.scan(event.id, lea.token, 'in', 'camera', 'poste-1');
    expect(r.decision).toMatchObject({ result: 'accepted', firstEntry: true });
    expect(r.passage).toMatchObject({ origin: 'offline', agentName: 'bruno' });
    expect((await a.store.scan(event.id, lea.token, 'in', 'camera', 'poste-1')).decision).toMatchObject({ result: 'refused', reason: 'already-inside' });
    expect((await a.store.scan(event.id, 'faux-billet', 'in', 'camera', 'poste-1')).decision).toEqual({ result: 'refused', reason: 'unknown' });
    expect((await a.store.scan(event.id, marc.token, 'out', 'camera', 'poste-1')).decision.result).toBe('warning'); // rien en file
    expect(a.store.getStatus()).toMatchObject({ online: false, pending: 3 });
    expect((await snapshotOf(admin.store, event.id))!.passages).toHaveLength(0);

    a.net.down = false;
    await until(() => a.store.getStatus().online);
    expect(a.store.getStatus()).toMatchObject({ pending: 0, duplicates: 0 });
    const snap = (await snapshotOf(admin.store, event.id))!;
    expect(snap.passages).toEqual([expect.objectContaining({ id: r.passage!.id, origin: 'offline', at: r.passage!.at, stationId: 'poste-1' })]);
    expect(snap.refusals.map((x) => x.reason).sort()).toEqual(['already-inside', 'unknown']);
    expect(snap.participants.find((p) => p.id === lea.id)).toMatchObject({ inside: true, entryCount: 1 });
    a.store.dispose();
  });

  it('hors ligne, la présence affichée est une estimation : la copie plus les passages du poste (F-64)', async () => {
    const { event, lea, marc, agent } = await setup();
    const a = await agent('bruno');
    const seen: number[] = [];
    const stop = a.store.subscribe(event.id, (s) => s && seen.push(s.participants.filter((p) => p.inside).length));
    await until(() => seen.length > 0);
    a.net.down = true;
    await a.store.scan(event.id, lea.token, 'in', 'camera', 'p');
    await a.store.scan(event.id, marc.token, 'in', 'camera', 'p');
    await until(() => seen.at(-1) === 2);
    stop();
    a.store.dispose();
  });

  it('recette : deux postes coupés font entrer la même personne ; au retour, un doublon signalé, comptage juste (F-63)', async () => {
    const { admin, event, lea, marc, agent } = await setup();
    const [a, b] = [await agent('bruno'), await agent('chloe')];
    a.net.down = true;
    b.net.down = true;
    expect((await a.store.scan(event.id, lea.token, 'in', 'camera', 'poste-1')).decision.result).toBe('accepted');
    serverNow += 60_000;
    expect((await b.store.scan(event.id, lea.token, 'in', 'camera', 'poste-2')).decision.result).toBe('accepted'); // aucune coordination
    await b.store.scan(event.id, marc.token, 'in', 'camera', 'poste-2');

    a.net.down = false;
    await until(() => a.store.getStatus().online);
    b.net.down = false;
    await until(() => b.store.getStatus().online);
    expect(b.store.getStatus()).toMatchObject({ pending: 0, duplicates: 1 });

    const snap = (await snapshotOf(admin.store, event.id))!;
    expect(snap.passages.filter((p) => p.offlineDuplicate).map((p) => p.stationId)).toEqual(['poste-2']);
    expect(snap.participants.filter((p) => p.inside)).toHaveLength(2);
    expect(snap.participants.find((p) => p.id === lea.id)).toMatchObject({ entryCount: 1 });
    a.store.dispose();
    b.store.dispose();
  });

  it('page rechargée pendant la coupure : session, copie et file sont conservées', async () => {
    const { admin, event, lea, marc, agent } = await setup();
    const a = await agent('bruno');
    a.net.down = true;
    await a.store.scan(event.id, lea.token, 'in', 'camera', 'p');
    a.store.dispose();

    // Même appareil : même coffre et même session de connexion, nouveau chargement de l'application
    const reloaded = new StationStore(a.net, a.vault, { now: () => serverNow, today: () => '2027-03-11', probeMs: 20 });
    expect((await reloaded.getSession())?.user.name).toBe('bruno');
    const first = await new Promise<EventSnapshot | null>((resolve) => { const stop = reloaded.subscribe(event.id, (s) => { resolve(s); setTimeout(() => stop(), 0); }); });
    expect(first?.participants.find((p) => p.id === lea.id)).toMatchObject({ inside: true });
    expect((await reloaded.scan(event.id, lea.token, 'in', 'camera', 'p')).decision).toMatchObject({ reason: 'already-inside' });
    await reloaded.scan(event.id, marc.token, 'in', 'camera', 'p');
    expect(reloaded.getStatus()).toMatchObject({ online: false, pending: 3 });

    a.net.down = false;
    await until(() => reloaded.getStatus().online);
    expect((await snapshotOf(admin.store, event.id))!.participants.filter((p) => p.inside)).toHaveLength(2);
    reloaded.dispose();
  });

  it('corrige l\'heure des passages hors ligne du décalage d\'horloge du poste', async () => {
    const { admin, event, lea, marc, agent } = await setup();
    const a = await agent('bruno', { clockSkewMs: -10 * 60_000 }); // téléphone en retard de 10 minutes
    await a.store.scan(event.id, marc.token, 'in', 'camera', 'p'); // en ligne : mesure du décalage
    a.net.down = true;
    serverNow += 5 * 60_000;
    const r = await a.store.scan(event.id, lea.token, 'in', 'camera', 'p');
    expect(Math.abs(Date.parse(r.passage!.at) - serverNow)).toBeLessThan(1000);
    a.net.down = false;
    await until(() => a.store.getStatus().online);
    expect((await snapshotOf(admin.store, event.id))!.passages.find((p) => p.id === r.passage!.id)?.at).toBe(r.passage!.at);
    a.store.dispose();
  });

  it('la file part avant tout nouveau scan en ligne, pour garder l\'ordre des passages', async () => {
    const { admin, event, lea, agent } = await setup();
    const a = await agent('bruno');
    a.net.down = true;
    await a.store.scan(event.id, lea.token, 'in', 'camera', 'p');
    serverNow += 60_000;
    a.store.dispose(); // pas de reconnexion automatique : c'est le scan qui la déclenche
    a.net.down = false;
    await a.store.probe();
    expect((await a.store.scan(event.id, lea.token, 'out', 'camera', 'p')).passage).toMatchObject({ origin: 'online' });
    const snap = (await snapshotOf(admin.store, event.id))!;
    expect(snap.passages.map((p) => [p.origin, p.direction])).toEqual([['offline', 'in'], ['online', 'out']]);
    expect(snap.participants.find((p) => p.id === lea.id)).toMatchObject({ inside: false });
  });

  it('sans copie locale, le scan hors ligne est impossible et le dit', async () => {
    const { event, lea, w } = await setup();
    const st = w.station();
    st.net.down = true;
    await expect(st.store.scan(event.id, lea.token, 'in', 'camera', 'p')).rejects.toMatchObject({ code: 'unreachable', message: expect.stringContaining('copie locale') });
    st.store.dispose();
  });

  it('déconnexion refusée tant que des passages attendent ; acceptée ensuite, et le coffre est vidé (F-60)', async () => {
    const { event, lea, agent } = await setup();
    const a = await agent('bruno');
    a.net.down = true;
    await a.store.scan(event.id, lea.token, 'in', 'camera', 'p');
    await expect(a.store.signOut()).rejects.toMatchObject({ code: 'invalid', message: expect.stringContaining('pas encore envoyés') });
    a.net.down = false;
    await a.store.signOut();
    expect(a.store.getStatus()).toMatchObject({ pending: 0, copies: {} });
    expect(await a.vault.get('queue')).toBeNull();
    expect(await a.vault.get(`copy:${event.id}`)).toBeNull();
    a.store.dispose();
  });

  it('la copie d\'un événement terminé est effacée au démarrage', async () => {
    const { event, agent } = await setup();
    const a = await agent('bruno');
    expect(Object.keys(a.store.getStatus().copies)).toEqual([event.id]);
    a.store.dispose();
    const later = new StationStore(a.net, a.vault, { now: () => serverNow, today: () => '2027-03-13', probeMs: 20 });
    await later.ready;
    expect(later.getStatus().copies).toEqual({});
    expect(await a.vault.get(`copy:${event.id}`)).toBeNull();
    later.dispose();
    await tick();
  });
});
