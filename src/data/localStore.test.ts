import { LocalStore, queueLock, type Bus, type KeyValue } from './localStore';
import { StoreError, type Agent, type EventSnapshot } from './store';

// Deux « onglets » partageant le même stockage, le même verrou et un canal de diffusion
function twoStations() {
  const data = new Map<string, string>();
  const storage: KeyValue = { get: (k) => data.get(k) ?? null, set: (k, v) => { data.set(k, v); } };
  const handlers: { owner: number; fn: (m: string) => void }[] = [];
  const bus = (owner: number): Bus => ({
    post: (m) => handlers.filter((h) => h.owner !== owner).forEach((h) => h.fn(m)),
    listen: (fn) => { handlers.push({ owner, fn }); },
  });
  const lock = queueLock();
  return [new LocalStore(storage, bus(1), lock), new LocalStore(storage, bus(2), lock)] as const;
}

const agent1: Agent = { id: 'a1', name: 'Agent 1', stationId: 'entree' };
const agent2: Agent = { id: 'a2', name: 'Agent 2', stationId: 'sortie' };

async function setup() {
  const [a, b] = twoStations();
  const event = await a.createEvent({ name: 'Salon', startDate: '2027-03-11', endDate: '2027-03-12', capacity: 1100 });
  const [lea, marc] = await a.addParticipants(event.id, [
    { firstName: 'Léa', lastName: 'Petit', email: 'lea@x.fr', typeId: 'magasin', source: 'manual' },
    { firstName: 'Marc', lastName: 'Roy', email: 'marc@x.fr', typeId: 'exposant', source: 'import', company: 'Roy & Fils' },
  ]);
  return { a, b, event, lea: lea!, marc: marc! };
}

describe('LocalStore — événements et participants', () => {
  it('crée un événement avec les trois types par défaut, inscriptions fermées', async () => {
    const { event } = await setup();
    expect(event.types.map((t) => t.label)).toEqual(['Visiteur', 'Exposant', 'Magasin']);
    expect(event.registrationOpen).toBe(false);
  });

  it('refuse un email déjà inscrit à l\'événement', async () => {
    const { a, event } = await setup();
    await expect(a.addParticipants(event.id, [{ firstName: 'X', lastName: 'Y', email: 'LEA@x.fr', typeId: 'visiteur', source: 'manual' }]))
      .rejects.toMatchObject({ code: 'duplicate' });
  });

  it('applique le premier type si le type demandé n\'existe pas', async () => {
    const { a, event } = await setup();
    const [p] = await a.addParticipants(event.id, [{ firstName: 'Z', lastName: 'Z', email: '', typeId: 'presse', source: 'manual' }]);
    expect(p!.typeId).toBe('visiteur');
  });

  it('régénère le jeton : l\'ancien QR code est refusé (F-26)', async () => {
    const { a, event, lea } = await setup();
    const renewed = await a.revokeToken(lea.id);
    expect(renewed.token).not.toBe(lea.token);
    expect((await a.scan(event.id, lea.token, 'in', 'camera', agent1)).decision).toEqual({ result: 'refused', reason: 'unknown' });
    expect((await a.scan(event.id, renewed.token, 'in', 'camera', agent1)).decision.result).toBe('accepted');
  });

  it('supprime l\'événement avec toutes ses données', async () => {
    const { a, event, lea } = await setup();
    await a.scan(event.id, lea.token, 'in', 'camera', agent1);
    await a.deleteEvent(event.id);
    expect(await a.listEvents()).toEqual([]);
    expect(await a.getAccessPage(lea.token)).toBeNull();
  });
});

describe('LocalStore — scan', () => {
  it('enregistre entrée, refus « déjà présent », sortie et retour', async () => {
    const { a, event, lea } = await setup();
    expect((await a.scan(event.id, lea.token, 'in', 'camera', agent1)).decision).toMatchObject({ result: 'accepted', firstEntry: true });
    expect((await a.scan(event.id, lea.token, 'in', 'camera', agent1)).decision).toMatchObject({ result: 'refused', reason: 'already-inside' });
    expect((await a.scan(event.id, lea.token, 'out', 'camera', agent2)).decision).toMatchObject({ result: 'accepted', direction: 'out' });
    const back = await a.scan(event.id, lea.token, 'in', 'search', agent1);
    expect(back.decision).toMatchObject({ result: 'accepted', entryNumber: 2 });
    expect(back.passage).toMatchObject({ typeId: 'magasin', method: 'search', agentId: 'a1', stationId: 'entree' });
  });

  it('journalise les refus, avec le début du code lu pour un QR inconnu', async () => {
    const { a, event } = await setup();
    await a.scan(event.id, 'https://exemple.fr/faux-billet', 'in', 'camera', agent1);
    let snap: EventSnapshot | undefined;
    a.subscribe(event.id, (s) => { snap = s; });
    expect(snap!.refusals).toHaveLength(1);
    expect(snap!.refusals[0]).toMatchObject({ reason: 'unknown', sample: 'https://exem', participantId: null });
  });

  it('deux postes scannent le même badge au même instant : une seule entrée (F-53)', async () => {
    const { a, b, event, lea } = await setup();
    const results = await Promise.all([
      a.scan(event.id, lea.token, 'in', 'camera', agent1),
      b.scan(event.id, lea.token, 'in', 'camera', agent2),
    ]);
    expect(results.map((r) => r.decision.result).sort()).toEqual(['accepted', 'refused']);
    let snap: EventSnapshot | undefined;
    a.subscribe(event.id, (s) => { snap = s; });
    expect(snap!.passages).toHaveLength(1);
  });

  it('un passage sur un poste est visible en direct sur l\'autre', async () => {
    const { a, b, event, marc } = await setup();
    const seen: number[] = [];
    b.subscribe(event.id, (s) => seen.push(s.participants.filter((p) => p.inside).length));
    await a.scan(event.id, marc.token, 'in', 'camera', agent1);
    expect(seen).toEqual([0, 1]);
  });

  it('clôture de journée : sortie de tous les présents, marquée « clôture » (F-59)', async () => {
    const { a, event, lea, marc } = await setup();
    await a.scan(event.id, lea.token, 'in', 'camera', agent1);
    await a.scan(event.id, marc.token, 'in', 'camera', agent1);
    expect(await a.closeDay(event.id, agent1)).toBe(2);
    let snap: EventSnapshot | undefined;
    a.subscribe(event.id, (s) => { snap = s; });
    expect(snap!.participants.every((p) => !p.inside)).toBe(true);
    expect(snap!.passages.filter((p) => p.origin === 'closing')).toHaveLength(2);
  });
});

describe('LocalStore — inscription publique', () => {
  const form = { firstName: 'Sophie', lastName: 'Martin', email: 'sophie@x.fr', phone: '', company: 'Maison Martin', typeId: 'exposant', consent: true };

  it('refuse tant que les inscriptions sont fermées', async () => {
    const { a, event } = await setup();
    await expect(a.register(event.id, form)).rejects.toMatchObject({ code: 'closed' });
  });

  it('inscrit, renvoie un jeton et ne montre au participant que ses propres données', async () => {
    const { a, event } = await setup();
    await a.updateEvent(event.id, { registrationOpen: true });
    const { token } = await a.register(event.id, form);
    const page = await a.getAccessPage(token);
    expect(page).toMatchObject({ eventName: 'Salon', firstName: 'Sophie', company: 'Maison Martin', entryCount: 0 });
    expect(page!.type?.label).toBe('Exposant');
    expect(Object.keys(page!)).not.toContain('email');
  });

  it('exige le consentement et refuse un email déjà inscrit', async () => {
    const { a, event } = await setup();
    await a.updateEvent(event.id, { registrationOpen: true });
    await expect(a.register(event.id, { ...form, consent: false })).rejects.toBeInstanceOf(StoreError);
    await expect(a.register(event.id, { ...form, email: 'lea@x.fr' })).rejects.toMatchObject({ code: 'duplicate' });
  });
});
