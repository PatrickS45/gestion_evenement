import { LocalStore, memoryKeyValue, queueLock, type Bus } from './localStore';
import { StoreError, type EventSnapshot } from './store';

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

const PASSWORD = 'motdepasse-solide';

/** Poste a : Claire, propriétaire de l'organisation. Poste b : Bruno, agent d'accueil. */
async function setup() {
  const [a, b] = twoStations();
  const session = await a.signUp({ name: 'Claire Owner', email: 'claire@x.fr', password: PASSWORD, organization: 'Salon Pro' });
  const orgId = session.memberships[0]!.orgId;
  await b.signUp({ name: 'Bruno Agent', email: 'bruno@x.fr', password: PASSWORD, organization: 'Perso Bruno' });
  await a.addMember(orgId, 'Bruno@X.fr', 'agent');
  const event = await a.createEvent(orgId, { name: 'Salon', startDate: '2027-03-11', endDate: '2027-03-12', capacity: 1100 });
  const [lea, marc] = await a.addParticipants(event.id, [
    { firstName: 'Léa', lastName: 'Petit', email: 'lea@x.fr', typeId: 'magasin', source: 'manual' },
    { firstName: 'Marc', lastName: 'Roy', email: 'marc@x.fr', typeId: 'exposant', source: 'import', company: 'Roy & Fils' },
  ]);
  return { a, b, orgId, event, lea: lea!, marc: marc! };
}

describe('LocalStore — comptes, organisations et droits', () => {
  it('connexion par email et mot de passe ; mot de passe jamais stocké en clair (F-01, NF-22)', async () => {
    const { a } = await setup();
    await a.signOut();
    expect(await a.getSession()).toBeNull();
    await expect(a.signIn('claire@x.fr', 'mauvais-mot-de-passe')).rejects.toMatchObject({ code: 'unauthenticated' });
    const session = await a.signIn(' CLAIRE@x.fr ', PASSWORD);
    expect(session.user).toMatchObject({ name: 'Claire Owner', email: 'claire@x.fr' });
    expect(JSON.stringify(session)).not.toContain(PASSWORD);
  });

  it('bloque après 5 échecs de connexion en une minute (NF-22)', async () => {
    const [a] = twoStations();
    for (let i = 0; i < 5; i++) await expect(a.signIn('x@x.fr', 'faux')).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(a.signIn('x@x.fr', 'faux')).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('refuse un deuxième compte avec le même email et un mot de passe trop court', async () => {
    const [a] = twoStations();
    await expect(a.signUp({ name: 'X', email: 'x@x.fr', password: 'court', organization: 'O' })).rejects.toMatchObject({ code: 'invalid' });
    await a.signUp({ name: 'X', email: 'x@x.fr', password: PASSWORD, organization: 'O' });
    await expect(a.signUp({ name: 'Y', email: 'X@x.fr', password: PASSWORD, organization: 'P' })).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('un utilisateur appartient à plusieurs organisations, avec un rôle dans chacune (F-02)', async () => {
    const { b } = await setup();
    const session = (await b.getSession())!;
    expect(session.memberships.map((m) => [m.orgName, m.role])).toEqual([['Perso Bruno', 'owner'], ['Salon Pro', 'agent']]);
  });

  it('l\'agent scanne mais ne modifie ni l\'événement ni les participants, et ne clôture pas la journée', async () => {
    const { b, event, lea } = await setup();
    expect((await b.scan(event.id, lea.token, 'in', 'camera', 'sortie')).passage).toMatchObject({ agentName: 'Bruno Agent' });
    await expect(b.updateEvent(event.id, { capacity: 5 })).rejects.toMatchObject({ code: 'forbidden' });
    await expect(b.addParticipants(event.id, [{ firstName: 'A', lastName: 'B', email: '', typeId: 'visiteur', source: 'manual' }]))
      .rejects.toMatchObject({ code: 'forbidden' });
    await expect(b.deleteParticipant(lea.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(b.closeDay(event.id, 'sortie')).rejects.toMatchObject({ code: 'forbidden' });
    let snap: EventSnapshot | undefined;
    b.subscribe(event.id, (s) => { snap = s; });
    expect(snap!.role).toBe('agent');
  });

  it('seul le propriétaire supprime un événement (F-16) et gère les membres', async () => {
    const { a, b, orgId, event } = await setup();
    const bruno = (await b.getSession())!.user;
    await a.setMemberRole(orgId, bruno.id, 'admin');
    await expect(b.deleteEvent(event.id)).rejects.toMatchObject({ code: 'forbidden' });
    await expect(b.listMembers(orgId)).rejects.toMatchObject({ code: 'forbidden' });
    await b.updateEvent(event.id, { capacity: 900 }); // l'administrateur modifie l'événement
    await a.deleteEvent(event.id);
    expect(await a.listEvents(orgId)).toEqual([]);
  });

  it('un non-membre ne voit ni l\'événement ni ses participants (NF-24)', async () => {
    const { a, b, orgId, event, lea } = await setup();
    await a.removeMember(orgId, (await b.getSession())!.user.id);
    const received: EventSnapshot[] = [];
    b.subscribe(event.id, (s) => received.push(s));
    expect(received).toEqual([]);
    await expect(b.listEvents(orgId)).rejects.toMatchObject({ code: 'not-found' });
    await expect(b.scan(event.id, lea.token, 'in', 'camera', 'x')).rejects.toMatchObject({ code: 'not-found' });
  });

  it('sans connexion, rien n\'est accessible sauf les pages publiques', async () => {
    const { a, event, lea } = await setup();
    await a.signOut();
    await expect(a.scan(event.id, lea.token, 'in', 'camera', 'x')).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(await a.getAccessPage(lea.token)).toMatchObject({ firstName: 'Léa' });
  });

  it('l\'organisation garde toujours au moins un propriétaire', async () => {
    const { a, orgId } = await setup();
    const claire = (await a.getSession())!.user;
    await expect(a.setMemberRole(orgId, claire.id, 'admin')).rejects.toMatchObject({ code: 'invalid' });
    await expect(a.removeMember(orgId, claire.id)).rejects.toMatchObject({ code: 'invalid' });
  });
});

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
    expect((await a.scan(event.id, lea.token, 'in', 'camera', 'entree')).decision).toEqual({ result: 'refused', reason: 'unknown' });
    expect((await a.scan(event.id, renewed.token, 'in', 'camera', 'entree')).decision.result).toBe('accepted');
  });

  it('supprime l\'événement avec toutes ses données', async () => {
    const { a, orgId, event, lea } = await setup();
    await a.scan(event.id, lea.token, 'in', 'camera', 'entree');
    await a.deleteEvent(event.id);
    expect(await a.listEvents(orgId)).toEqual([]);
    expect(await a.getAccessPage(lea.token)).toBeNull();
  });
});

describe('LocalStore — scan', () => {
  it('enregistre entrée, refus « déjà présent », sortie et retour', async () => {
    const { a, event, lea } = await setup();
    expect((await a.scan(event.id, lea.token, 'in', 'camera', 'entree')).decision).toMatchObject({ result: 'accepted', firstEntry: true });
    expect((await a.scan(event.id, lea.token, 'in', 'camera', 'entree')).decision).toMatchObject({ result: 'refused', reason: 'already-inside' });
    expect((await a.scan(event.id, lea.token, 'out', 'camera', 'sortie')).decision).toMatchObject({ result: 'accepted', direction: 'out' });
    const back = await a.scan(event.id, lea.token, 'in', 'search', 'entree');
    expect(back.decision).toMatchObject({ result: 'accepted', entryNumber: 2 });
    expect(back.passage).toMatchObject({ typeId: 'magasin', method: 'search', agentName: 'Claire Owner', stationId: 'entree' });
  });

  it('journalise les refus, avec le début du code lu pour un QR inconnu', async () => {
    const { a, event } = await setup();
    await a.scan(event.id, 'https://exemple.fr/faux-billet', 'in', 'camera', 'entree');
    let snap: EventSnapshot | undefined;
    a.subscribe(event.id, (s) => { snap = s; });
    expect(snap!.refusals).toHaveLength(1);
    expect(snap!.refusals[0]).toMatchObject({ reason: 'unknown', sample: 'https://exem', participantId: null });
  });

  it('deux postes scannent le même badge au même instant : une seule entrée (F-53)', async () => {
    const { a, b, event, lea } = await setup();
    const results = await Promise.all([
      a.scan(event.id, lea.token, 'in', 'camera', 'entree'),
      b.scan(event.id, lea.token, 'in', 'camera', 'sortie'),
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
    await a.scan(event.id, marc.token, 'in', 'camera', 'entree');
    expect(seen).toEqual([0, 1]);
  });

  it('clôture de journée : sortie de tous les présents, marquée « clôture » (F-59)', async () => {
    const { a, event, lea, marc } = await setup();
    await a.scan(event.id, lea.token, 'in', 'camera', 'entree');
    await a.scan(event.id, marc.token, 'in', 'camera', 'entree');
    expect(await a.closeDay(event.id, 'entree')).toBe(2);
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
