// Test de charge (NF-05, recette 10.2) : pic du premier client, NF-02, contre un vrai serveur PocketBase
// avec sa configuration de production (limitation des requêtes comprise : les postes partagent le Wi-Fi).
//   npm run test:charge   serveur temporaire local, scans enchaînés aussi vite que les postes le peuvent
//   CHARGE_MINUTES=30     arrivées réparties sur 30 minutes, comme le jour J
//   CHARGE_URL=https://…  serveur déjà en ligne (recette) : comptes et organisation de test y restent,
//                         l'événement de test est supprimé à la fin
//   CHARGE_COUPURE_MINUTES=15  durée réelle de la coupure du second test (recette n° 3)
import { liveView, replayPassages } from '../domain/attendance';
import { compareNames, type Direction, type Participant } from '../domain/model';
import { PocketStore } from './pocketStore';
import { StationStore } from './stationStore';
import type { EventSnapshot, NewParticipant } from './store';
import { serverInstalled, startTestServer, type TestServer } from './testServer';
import { memoryBackend, Vault } from './vault';

const PARTICIPANTS = 1100;
const ARRIVALS = 400;
const SIMULTANEOUS = 20; // badges lus au même instant sur les deux postes (F-53), compris dans les arrivées
const UNKNOWN = 10;
const EXITS = 25;
const RETURNS = 10;
const MINUTES = Number(process.env.CHARGE_MINUTES ?? 0);
const REMOTE = process.env.CHARGE_URL;
const CUT_MINUTES = Number(process.env.CHARGE_COUPURE_MINUTES ?? 0);
const PASSWORD = 'motdepasse-solide';

const SCAN_LIMIT_MS = 1000; // NF-03
const PROPAGATION_LIMIT_MS = 3000; // NF-04

interface Scan { station: 0 | 1; token: string; direction: Direction }

/** Poste ou écran Direct qui suit l'événement en temps réel, et note quand chaque passage lui parvient. */
class Watcher {
  snapshot: EventSnapshot | null = null;
  readonly seenAt = new Map<string, number>();
  private waiters: (() => void)[] = [];
  readonly unsubscribe: () => void;

  constructor(store: PocketStore, eventId: string) {
    this.unsubscribe = store.subscribe(eventId, (s) => {
      const now = performance.now();
      this.snapshot = s;
      for (const p of s?.passages ?? []) if (!this.seenAt.has(p.id)) this.seenAt.set(p.id, now);
      for (const w of this.waiters.splice(0)) w();
    });
  }

  /** Attend que l'état transmis satisfasse `ok`. */
  async until(ok: (s: EventSnapshot) => boolean, timeoutMs: number, what: string) {
    const deadline = performance.now() + timeoutMs;
    while (!this.snapshot || !ok(this.snapshot)) {
      const left = deadline - performance.now();
      if (left <= 0) throw new Error(`Délai dépassé : ${what}`);
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.waiters.push(() => { clearTimeout(timer); resolve(); });
      });
    }
  }
}

function percentile(values: number[], p: number) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] ?? 0;
}

const stats = (values: number[]) => ({
  mesures: values.length,
  'médiane (ms)': Math.round(percentile(values, 50)),
  'p95 (ms)': Math.round(percentile(values, 95)),
  'max (ms)': Math.round(Math.max(...values)),
});

let server: TestServer | undefined;

if (serverInstalled && !REMOTE) {
  beforeAll(async () => { server = await startTestServer({ rateLimits: true }); }, 60_000);
  afterAll(() => server?.stop());
}

describe.skipIf(!serverInstalled && !REMOTE)('Test de charge — pic du premier client (NF-02, NF-05)', () => {
  it(`${PARTICIPANTS} participants, 2 postes, ${ARRIVALS} arrivées${MINUTES ? ` en ${MINUTES} minutes` : ' sans pause'}`, async () => {
    const url = REMOTE ?? server!.url;
    const n = Date.now().toString(36);

    // ── Mise en place : propriétaire, deux agents d'accueil, un événement de 1 100 participants
    const owner = new PocketStore(url);
    const stations = [new PocketStore(url), new PocketStore(url)] as const;
    const session = await owner.signUp({ name: 'Claire Owner', email: `claire-${n}@x.fr`, password: PASSWORD, organization: 'Salon Pro' });
    const orgId = session.memberships[0]!.orgId;
    for (const [i, store] of stations.entries()) {
      const email = `agent${i + 1}-${n}@x.fr`;
      await store.signUp({ name: `Agent ${i + 1}`, email, password: PASSWORD, organization: `Perso ${i + 1}` });
      await owner.addMember(orgId, email, 'agent');
    }
    const event = await owner.createEvent(orgId, { name: 'Salon', startDate: '2027-03-11', endDate: '2027-03-12', capacity: PARTICIPANTS });
    const types = event.types.map((t) => t.id);
    const list: NewParticipant[] = Array.from({ length: PARTICIPANTS }, (_, i) => ({
      firstName: `Prénom${i}`, lastName: `Nom${String(i).padStart(4, '0')}`, email: `p${i}@charge.fr`,
      company: `Magasin ${i % 150}`, typeId: types[i % types.length]!, source: 'import',
    }));
    let started = performance.now();
    const imported = await owner.addParticipants(event.id, list); // import CSV en une fois, comme l'écran Participants
    const importMs = performance.now() - started;
    expect(imported).toHaveLength(PARTICIPANTS);

    // Les deux postes et l'écran Direct suivent l'événement pendant tout le test
    const watchers = [...stations, owner].map((s) => new Watcher(s, event.id));
    started = performance.now();
    await Promise.all(watchers.map((w) => w.until((s) => s.participants.length === PARTICIPANTS, 30_000, 'chargement initial')));
    const loadMs = performance.now() - started;

    // ── Scénario : arrivées réparties sur les deux postes, badges lus en même temps,
    //    QR codes inconnus, sorties puis retours
    const shuffled = [...imported].sort(() => Math.random() - 0.5);
    const arriving = shuffled.slice(0, ARRIVALS);
    const together = arriving.slice(0, SIMULTANEOUS);
    const alone = arriving.slice(SIMULTANEOUS);
    const leaving = alone.slice(0, EXITS);
    const back = leaving.slice(0, RETURNS);
    const queues: Scan[][] = [[], []];
    alone.forEach((p, i) => queues[i % 2]!.push({ station: i % 2 as 0 | 1, token: p.token, direction: 'in' }));
    for (let i = 0; i < UNKNOWN; i++) queues[i % 2]!.push({ station: i % 2 as 0 | 1, token: `inconnu-${i}-${n}`, direction: 'in' });

    const scanMs: number[] = [];
    const sentAt = new Map<string, { at: number; station: number }>();
    const errors: string[] = [];
    const scan = async ({ station, token, direction }: Scan) => {
      const at = performance.now();
      try {
        const r = await stations[station].scan(event.id, token, direction, 'camera', `poste-${station + 1}`);
        scanMs.push(performance.now() - at);
        if (r.passage) sentAt.set(r.passage.id, { at, station });
        return r;
      } catch (err) {
        errors.push(`${direction} ${token.slice(0, 8)} : ${(err as Error).message}`);
        return null;
      }
    };

    // Chaque poste scanne une personne à la fois ; au rythme du jour J si CHARGE_MINUTES est donné
    const runStation = async (queue: Scan[], spacingMs: number) => {
      const t0 = performance.now();
      for (const [i, s] of queue.entries()) {
        const wait = t0 + i * spacingMs - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        await scan(s);
      }
    };
    const totalScans = queues[0]!.length + queues[1]!.length + SIMULTANEOUS + EXITS + RETURNS;
    const spacing = (MINUTES * 60_000) / (totalScans / 2);

    started = performance.now();
    await Promise.all(queues.map((q) => runStation(q, spacing)));
    const doubles = await Promise.all(together.map(async (p, i) => {
      if (spacing) await new Promise((r) => setTimeout(r, i * spacing));
      return Promise.all(stations.map((_, s) => scan({ station: s as 0 | 1, token: p.token, direction: 'in' })));
    }));
    await runStation(leaving.map((p) => ({ station: 1, token: p.token, direction: 'out' })), spacing);
    await runStation(back.map((p) => ({ station: 0, token: p.token, direction: 'in' })), spacing);
    const scenarioMs = performance.now() - started;

    // ── Attendus
    const expected = {
      present: ARRIVALS - EXITS + RETURNS,
      entries: ARRIVALS + RETURNS,
      exits: EXITS,
      alreadyInside: SIMULTANEOUS,
      unknown: UNKNOWN,
    };
    const counts = (s: EventSnapshot) => ({
      present: s.participants.filter((p) => p.inside).length,
      entries: s.passages.filter((p) => p.direction === 'in').length,
      exits: s.passages.filter((p) => p.direction === 'out').length,
      alreadyInside: s.refusals.filter((r) => r.reason === 'already-inside').length,
      unknown: s.refusals.filter((r) => r.reason === 'unknown').length,
    });
    const passagesTotal = expected.entries + expected.exits;
    await Promise.all(watchers.map((w) => w.until((s) => s.passages.length >= passagesTotal && s.refusals.length >= UNKNOWN + SIMULTANEOUS, 15_000, 'propagation finale')));

    // Propagation (NF-04) : du scan sur un poste à sa réception par l'autre poste et par l'écran Direct
    const propagationMs: number[] = [];
    for (const [id, { at, station }] of sentAt) {
      for (const [w, watcher] of watchers.entries()) {
        if (w === station) continue;
        const seen = watcher.seenAt.get(id);
        if (seen !== undefined) propagationMs.push(seen - at);
      }
    }

    // État relu depuis la base par une nouvelle session, comparé à ce que voient les postes en direct
    const reloaded = new PocketStore(url);
    await reloaded.signIn(`claire-${n}@x.fr`, PASSWORD);
    const fresh = new Watcher(reloaded, event.id);
    await fresh.until((s) => s.participants.length === PARTICIPANTS, 30_000, 'relecture');
    const db = fresh.snapshot!;
    for (const w of [...watchers, fresh]) w.unsubscribe();
    if (REMOTE) await owner.deleteEvent(event.id);

    console.log(`\nTest de charge — ${REMOTE ?? 'serveur local temporaire'} — ${PARTICIPANTS} participants, ${totalScans} scans${MINUTES ? ` répartis sur ${MINUTES} min` : ''}`);
    console.table({
      'import des participants': { 'durée (ms)': Math.round(importMs) },
      'chargement initial des 3 écrans': { 'durée (ms)': Math.round(loadMs) },
      'scénario complet': { 'durée (ms)': Math.round(scenarioMs) },
    });
    console.table({ 'scan (NF-03 < 1 s)': stats(scanMs), 'propagation (NF-04 < 3 s)': stats(propagationMs) });
    console.table({ attendu: expected, base: counts(db), ...Object.fromEntries(watchers.map((w, i) => [['poste 1', 'poste 2', 'Direct'][i], counts(w.snapshot!)])) });

    // ── Vérifications : aucune erreur, aucun écart de comptage, délais tenus
    expect(errors).toEqual([]);
    expect(scanMs).toHaveLength(totalScans + SIMULTANEOUS);
    expect(counts(db)).toEqual(expected);
    for (const w of watchers) expect(counts(w.snapshot!)).toEqual(expected);

    // Badges lus en même temps : une entrée, un refus « déjà présent », jamais deux entrées (F-53)
    for (const pair of doubles) {
      expect(pair.map((r) => r?.decision.result).sort()).toEqual(['accepted', 'refused']);
    }

    // Chaque participant est cohérent avec son journal de passages
    for (const p of db.participants) {
      const own = db.passages.filter((x) => x.participantId === p.id);
      expect(p.entryCount, p.lastName).toBe(own.filter((x) => x.direction === 'in').length);
      expect(p.inside, p.lastName).toBe(own.at(-1)?.direction === 'in');
    }
    // Les postes affichent exactement les mêmes présents que la base
    const insideIds = (s: EventSnapshot) => s.participants.filter((p) => p.inside).sort(compareNames).map((p) => p.id);
    for (const w of watchers) expect(insideIds(w.snapshot!)).toEqual(insideIds(db));

    expect(Math.max(...scanMs)).toBeLessThan(SCAN_LIMIT_MS);
    expect(propagationMs).toHaveLength(passagesTotal * 2);
    expect(Math.max(...propagationMs)).toBeLessThan(PROPAGATION_LIMIT_MS);
  }, (MINUTES * 60 + 300) * 1000);

  // Recette n° 3 : coupure du réseau sur les deux postes, scans croisés, puis synchronisation.
  // La coupure est simulée en arrêtant le serveur : impossible sur un serveur distant.
  it.skipIf(!!REMOTE)(`coupure sur les deux postes${CUT_MINUTES ? ` pendant ${CUT_MINUTES} minutes` : ''}, puis synchronisation (F-61, F-63)`, async () => {
    const url = server!.url;
    const n = `c${Date.now().toString(36)}`;
    const owner = new PocketStore(url);
    const orgId = (await owner.signUp({ name: 'Claire Owner', email: `claire-${n}@x.fr`, password: PASSWORD, organization: 'Salon Pro' })).memberships[0]!.orgId;
    const event = await owner.createEvent(orgId, { name: 'Salon', startDate: '2027-03-11', endDate: '2099-12-31', capacity: PARTICIPANTS });
    const imported = await owner.addParticipants(event.id, Array.from({ length: PARTICIPANTS }, (_, i) => ({
      firstName: `Prénom${i}`, lastName: `Nom${String(i).padStart(4, '0')}`, email: `p${i}@coupure.fr`,
      typeId: event.types[i % event.types.length]!.id, source: 'import' as const,
    })));

    const stations: StationStore[] = [];
    for (const i of [1, 2]) {
      const st = new StationStore(new PocketStore(url), new Vault(memoryBackend()), { probeMs: 500 });
      await st.signUp({ name: `Agent ${i}`, email: `agent${i}-${n}@x.fr`, password: PASSWORD, organization: `Perso ${i}` });
      await owner.addMember(orgId, `agent${i}-${n}@x.fr`, 'agent');
      await st.getSession();
      stations.push(st);
    }
    const [a, b] = stations as [StationStore, StationStore];
    const direct = new Watcher(owner, event.id); // écran Direct, resté ouvert pendant la coupure
    await direct.until((s) => s.participants.length === PARTICIPANTS, 30_000, 'chargement initial');

    const people = [...imported].sort(() => Math.random() - 0.5);
    const before = people.slice(0, 100); // entrés avant la coupure
    const during = people.slice(100, 300); // arrivés pendant la coupure
    const both = people.slice(300, 315); // badge lu sur les deux postes pendant la coupure
    const leaving = before.slice(0, 20); // sortis pendant la coupure, sur le poste 2…
    const leavingTwice = leaving.slice(0, 5); // … et aussi sur le poste 1
    const rescanned = before.slice(20, 25); // rescannés en entrée : la copie sait qu'ils sont déjà là

    type Step = [StationStore, Participant, Direction, string];
    const scan = ([st, p, direction, station]: Step) => st.scan(event.id, p.token, direction, 'camera', station);
    for (const [i, p] of before.entries()) await scan([i % 2 ? b : a, p, 'in', `poste-${(i % 2) + 1}`]);
    for (const st of stations) await st.prepare(event.id); // copie de secours avant l'ouverture

    server!.cut();
    const steps: Step[] = [
      ...during.map((p, i): Step => [i % 2 ? b : a, p, 'in', `poste-${(i % 2) + 1}`]),
      ...both.flatMap((p): Step[] => [[a, p, 'in', 'poste-1'], [b, p, 'in', 'poste-2']]),
      ...leaving.map((p): Step => [b, p, 'out', 'poste-2']),
      ...leavingTwice.map((p): Step => [a, p, 'out', 'poste-1']),
      ...rescanned.map((p): Step => [a, p, 'in', 'poste-1']),
    ];
    const spacing = (CUT_MINUTES * 60_000) / steps.length;
    const decisions: string[] = [];
    for (const step of steps) {
      decisions.push((await scan(step)).decision.result);
      if (spacing) await new Promise((r) => setTimeout(r, spacing));
    }
    expect([a.getStatus().online, b.getStatus().online]).toEqual([false, false]);
    expect(decisions.filter((d) => d === 'refused')).toHaveLength(rescanned.length);
    const sent = a.getStatus().pending + b.getStatus().pending;

    const started = performance.now();
    await server!.resume();
    for (const st of stations) {
      await vi.waitFor(() => expect(st.getStatus()).toMatchObject({ online: true, pending: 0 }), { timeout: 30_000, interval: 100 });
    }
    const syncMs = performance.now() - started;

    // Attendus : chaque doublon est détecté, signalé aux postes et exclu du comptage
    const duplicates = both.length + leavingTwice.length;
    const present = before.length + during.length + both.length - leaving.length;
    const reloaded = new PocketStore(url);
    await reloaded.signIn(`claire-${n}@x.fr`, PASSWORD);
    const fresh = new Watcher(reloaded, event.id);
    await fresh.until((s) => s.participants.length === PARTICIPANTS, 30_000, 'relecture');
    const db = fresh.snapshot!;
    await direct.until((s) => s.passages.length === db.passages.length && s.participants.filter((p) => p.inside).length === present, 15_000, 'écran Direct');
    const view = liveView(db.event, db.participants, db.passages, Date.now());
    const reported = a.getStatus().duplicates + b.getStatus().duplicates;

    console.log(`\nRecette n° 3 — serveur coupé, ${steps.length} scans hors ligne sur 2 postes, ${sent} enregistrements envoyés au retour`);
    console.table({
      attendu: { doublons: duplicates, présents: present, 'refus « déjà présent »': rescanned.length },
      obtenu: { doublons: reported, présents: view.present, 'refus « déjà présent »': db.refusals.filter((r) => r.reason === 'already-inside').length },
    });
    console.table({ 'synchronisation des 2 postes au retour du serveur': { 'durée (ms)': Math.round(syncMs) } });

    expect(reported).toBe(duplicates);
    expect(a.getStatus().rejected + b.getStatus().rejected).toBe(0);
    expect(view.duplicates).toHaveLength(duplicates);
    expect(view.duplicates.every((d) => d.original !== null && d.duplicate.origin === 'offline')).toBe(true);
    expect(view.present).toBe(present);
    expect(view.consistent).toBe(true);
    expect(replayPassages(db.passages).insideIds.size).toBe(present);
    expect(db.refusals.filter((r) => r.reason === 'already-inside')).toHaveLength(rescanned.length);
    for (const p of db.participants) {
      const counted = db.passages.filter((x) => x.participantId === p.id && !x.offlineDuplicate);
      expect(p.entryCount, p.lastName).toBe(counted.filter((x) => x.direction === 'in').length);
    }
    expect(direct.snapshot!.passages.filter((p) => p.offlineDuplicate)).toHaveLength(duplicates);

    for (const w of [direct, fresh]) w.unsubscribe();
    for (const st of stations) st.dispose();
  }, (CUT_MINUTES * 60 + 300) * 1000);
});
