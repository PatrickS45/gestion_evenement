// Suite de tests du contrat EventStore, commune à l'implémentation locale et au serveur PocketBase :
// les deux doivent appliquer les mêmes règles de gestion et les mêmes droits (NF-26).
import { newRecordId } from '../domain/ids';
import type { Direction } from '../domain/model';
import type { EventSnapshot, EventStore, OfflinePassage } from './store';

/** Deux postes (deux sessions) sur les mêmes données. */
export type StationsFactory = () => Promise<readonly [EventStore, EventStore]>;

const PASSWORD = 'motdepasse-solide';
let counter = 0;

/** Premier état transmis par subscribe, puis désabonnement. */
export function snapshotOf(store: EventStore, eventId: string): Promise<EventSnapshot | null> {
  return new Promise((resolve) => {
    let done = false;
    const unsubscribe = store.subscribe(eventId, (s) => {
      if (done) return;
      done = true;
      resolve(s);
      setTimeout(() => unsubscribe(), 0);
    });
  });
}

export function describeStoreContract(name: string, twoStations: StationsFactory) {
  /** Poste a : Claire, propriétaire de l'organisation. Poste b : Bruno, agent d'accueil. */
  async function setup() {
    const [a, b] = await twoStations();
    const n = `${Date.now().toString(36)}${++counter}`;
    const emails = { claire: `claire-${n}@x.fr`, bruno: `bruno-${n}@x.fr` };
    const session = await a.signUp({ name: 'Claire Owner', email: emails.claire, password: PASSWORD, organization: 'Salon Pro' });
    const orgId = session.memberships[0]!.orgId;
    await b.signUp({ name: 'Bruno Agent', email: emails.bruno, password: PASSWORD, organization: 'Perso Bruno' });
    await a.addMember(orgId, emails.bruno.toUpperCase(), 'agent');
    const event = await a.createEvent(orgId, { name: 'Salon', startDate: '2027-03-11', endDate: '2027-03-12', capacity: 1100 });
    const [lea, marc] = await a.addParticipants(event.id, [
      { firstName: 'Léa', lastName: 'Petit', email: 'lea@x.fr', typeId: 'magasin', source: 'manual' },
      { firstName: 'Marc', lastName: 'Roy', email: 'marc@x.fr', typeId: 'exposant', source: 'import', company: 'Roy & Fils' },
    ]);
    return { a, b, orgId, emails, event, lea: lea!, marc: marc! };
  }

  describe(`${name} — comptes, organisations et droits`, () => {
    it('connexion par email et mot de passe, jamais renvoyé (F-01, NF-22)', async () => {
      const { a, emails } = await setup();
      await a.signOut();
      expect(await a.getSession()).toBeNull();
      await expect(a.signIn(emails.claire, 'mauvais-mot-de-passe')).rejects.toMatchObject({ code: 'unauthenticated' });
      const session = await a.signIn(` ${emails.claire.toUpperCase()} `, PASSWORD);
      expect(session.user).toMatchObject({ name: 'Claire Owner', email: emails.claire });
      expect(JSON.stringify(session)).not.toContain(PASSWORD);
    });

    it('refuse un deuxième compte avec le même email et un mot de passe trop court', async () => {
      const { a, emails } = await setup();
      await expect(a.signUp({ name: 'X', email: `court-${emails.claire}`, password: 'court', organization: 'O' }))
        .rejects.toMatchObject({ code: 'invalid' });
      await expect(a.signUp({ name: 'Y', email: emails.claire, password: PASSWORD, organization: 'P' }))
        .rejects.toMatchObject({ code: 'duplicate' });
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
      expect((await snapshotOf(b, event.id))!.role).toBe('agent');
    });

    it('seul le propriétaire supprime un événement (F-16) et gère les membres', async () => {
      const { a, b, orgId, event } = await setup();
      const bruno = (await b.getSession())!.user;
      await a.setMemberRole(orgId, bruno.id, 'admin');
      await expect(b.deleteEvent(event.id)).rejects.toMatchObject({ code: 'forbidden' });
      await expect(b.listMembers(orgId)).rejects.toMatchObject({ code: 'forbidden' });
      expect((await b.updateEvent(event.id, { capacity: 900 })).capacity).toBe(900); // l'administrateur modifie
      expect((await a.listMembers(orgId)).map((m) => [m.name, m.role])).toEqual([['Bruno Agent', 'admin'], ['Claire Owner', 'owner']]);
      await a.deleteEvent(event.id);
      expect(await a.listEvents(orgId)).toEqual([]);
    });

    it('un non-membre ne voit ni l\'événement ni ses participants (NF-24)', async () => {
      const { a, b, orgId, event, lea } = await setup();
      await a.removeMember(orgId, (await b.getSession())!.user.id);
      await b.getSession(); // appartenances relues après le retrait
      expect(await snapshotOf(b, event.id)).toBeNull();
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

    it('crée une organisation supplémentaire dont on est propriétaire', async () => {
      const { a } = await setup();
      const session = await a.createOrganization('Deuxième');
      expect(session.memberships.find((m) => m.orgName === 'Deuxième')?.role).toBe('owner');
    });
  });

  describe(`${name} — événements et participants`, () => {
    it('crée un événement avec les trois types par défaut, inscriptions fermées', async () => {
      const { event } = await setup();
      expect(event.types.map((t) => t.label)).toEqual(['Visiteur', 'Exposant', 'Magasin']);
      expect(event.registrationOpen).toBe(false);
    });

    it('modifie la jauge, les seuils et les types', async () => {
      const { a, event } = await setup();
      const types = [...event.types, { id: 'presse', label: 'Presse', color: '#e87ba4' }];
      const updated = await a.updateEvent(event.id, { capacity: 1200, thresholds: { warn: 0.7, critical: 0.9 }, types });
      expect(updated).toMatchObject({ capacity: 1200, thresholds: { warn: 0.7, critical: 0.9 } });
      expect(updated.types.map((t) => t.id)).toEqual(['visiteur', 'exposant', 'magasin', 'presse']);
    });

    it('duplique un événement sans ses participants (F-15)', async () => {
      const { a, event } = await setup();
      await a.updateEvent(event.id, { types: [{ id: 'unique', label: 'Unique', color: '#2a78d6' }] });
      const copy = await a.duplicateEvent(event.id, 'Salon 2028');
      expect(copy).toMatchObject({ name: 'Salon 2028', capacity: 1100, registrationOpen: false });
      expect(copy.types.map((t) => t.id)).toEqual(['unique']);
      expect((await snapshotOf(a, copy.id))!.participants).toEqual([]);
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

    it('modifie puis supprime un participant (F-23)', async () => {
      const { a, event, lea } = await setup();
      expect(await a.updateParticipant(lea.id, { company: 'Boutique Léa', typeId: 'visiteur' }))
        .toMatchObject({ company: 'Boutique Léa', typeId: 'visiteur', token: lea.token });
      await expect(a.updateParticipant(lea.id, { email: 'marc@x.fr' })).rejects.toMatchObject({ code: 'duplicate' });
      await a.deleteParticipant(lea.id);
      expect((await snapshotOf(a, event.id))!.participants.map((p) => p.firstName)).toEqual(['Marc']);
    });

    it('régénère le jeton : l\'ancien QR code est refusé (F-26)', async () => {
      const { a, event, lea } = await setup();
      const renewed = await a.revokeToken(lea.id);
      expect(renewed.token).not.toBe(lea.token);
      expect(renewed.token).toMatch(/^[0-9a-f]{40}$/);
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

  describe(`${name} — scan`, () => {
    it('enregistre entrée, refus « déjà présent », sortie et retour', async () => {
      const { a, event, lea } = await setup();
      expect((await a.scan(event.id, lea.token, 'in', 'camera', 'entree')).decision).toMatchObject({ result: 'accepted', firstEntry: true });
      expect((await a.scan(event.id, lea.token, 'in', 'camera', 'entree')).decision).toMatchObject({ result: 'refused', reason: 'already-inside' });
      expect((await a.scan(event.id, lea.token, 'out', 'camera', 'sortie')).decision).toMatchObject({ result: 'accepted', direction: 'out' });
      expect((await a.scan(event.id, lea.token, 'out', 'camera', 'sortie')).decision).toEqual({ result: 'warning', reason: 'not-inside' });
      const back = await a.scan(event.id, lea.token, 'in', 'search', 'entree');
      expect(back.decision).toMatchObject({ result: 'accepted', entryNumber: 2 });
      expect(back.passage).toMatchObject({ typeId: 'magasin', method: 'search', agentName: 'Claire Owner', stationId: 'entree' });
      expect(back.participant).toMatchObject({ inside: true, entryCount: 2 });
    });

    it('journalise les refus, avec le début du code lu pour un QR inconnu', async () => {
      const { a, event } = await setup();
      await a.scan(event.id, 'https://exemple.fr/faux-billet', 'in', 'camera', 'entree');
      const snap = (await snapshotOf(a, event.id))!;
      expect(snap.refusals).toHaveLength(1);
      expect(snap.refusals[0]).toMatchObject({ reason: 'unknown', sample: 'https://exem', participantId: null });
    });

    it('deux postes scannent le même badge au même instant : une seule entrée (F-53)', async () => {
      const { a, b, event, lea } = await setup();
      const results = await Promise.all([
        a.scan(event.id, lea.token, 'in', 'camera', 'entree'),
        b.scan(event.id, lea.token, 'in', 'camera', 'sortie'),
      ]);
      expect(results.map((r) => r.decision.result).sort()).toEqual(['accepted', 'refused']);
      expect((await snapshotOf(a, event.id))!.passages).toHaveLength(1);
    });

    it('un passage sur un poste est visible en direct sur l\'autre', async () => {
      const { a, b, event, marc } = await setup();
      const seen: number[] = [];
      const unsubscribe = b.subscribe(event.id, (s) => seen.push(s!.participants.filter((p) => p.inside).length));
      await vi.waitFor(() => expect(seen).toEqual([0]));
      await a.scan(event.id, marc.token, 'in', 'camera', 'entree');
      await vi.waitFor(() => expect(seen.at(-1)).toBe(1), { timeout: 3000 }); // NF-04 : moins de 3 secondes
      unsubscribe();
    });

    it('clôture de journée : sortie de tous les présents, marquée « clôture » (F-59)', async () => {
      const { a, event, lea, marc } = await setup();
      await a.scan(event.id, lea.token, 'in', 'camera', 'entree');
      await a.scan(event.id, marc.token, 'in', 'camera', 'entree');
      expect(await a.closeDay(event.id, 'entree')).toBe(2);
      const snap = (await snapshotOf(a, event.id))!;
      expect(snap.participants.every((p) => !p.inside)).toBe(true);
      expect(snap.passages.filter((p) => p.origin === 'closing')).toHaveLength(2);
    });
  });

  describe(`${name} — hors ligne (F-61 à F-63)`, () => {
    const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
    const offline = (participantId: string, direction: Direction, minutesAgo: number): OfflinePassage =>
      ({ id: newRecordId(), participantId, direction, at: ago(minutesAgo), method: 'camera' });
    const statuses = (r: { passages: { status: string }[] }) => r.passages.map((p) => p.status);

    it('enregistre les passages avec leur heure réelle et met la présence à jour', async () => {
      const { a, b, event, lea, marc } = await setup();
      const sent = [offline(lea.id, 'in', 20), offline(marc.id, 'in', 15), offline(marc.id, 'out', 5)];
      const r = await b.syncOffline(event.id, { stationId: 'entree', passages: sent, refusals: [] });
      expect(r.passages).toEqual(sent.map((p) => ({ id: p.id, status: 'counted' })));
      const snap = (await snapshotOf(a, event.id))!;
      expect(snap.passages.find((p) => p.id === sent[0]!.id)).toMatchObject({
        at: sent[0]!.at, origin: 'offline', offlineDuplicate: false, agentName: 'Bruno Agent', stationId: 'entree', typeId: 'magasin',
      });
      expect(snap.participants.find((p) => p.id === lea.id)).toMatchObject({ inside: true, entryCount: 1, firstEntryAt: sent[0]!.at });
      expect(snap.participants.find((p) => p.id === marc.id)).toMatchObject({ inside: false, entryCount: 1 });
    });

    it('deux postes hors ligne font entrer la même personne : la seconde entrée est un doublon', async () => {
      const { a, b, event, lea } = await setup();
      expect(statuses(await a.syncOffline(event.id, { stationId: 'poste-1', passages: [offline(lea.id, 'in', 10)], refusals: [] }))).toEqual(['counted']);
      expect(statuses(await b.syncOffline(event.id, { stationId: 'poste-2', passages: [offline(lea.id, 'in', 8)], refusals: [] }))).toEqual(['duplicate']);
      const snap = (await snapshotOf(a, event.id))!;
      expect(snap.passages.map((p) => [p.stationId, p.offlineDuplicate]).sort()).toEqual([['poste-1', false], ['poste-2', true]]);
      expect(snap.participants.find((p) => p.id === lea.id)).toMatchObject({ inside: true, entryCount: 1 });
    });

    it("un lot renvoyé après une coupure n'est pas compté deux fois", async () => {
      const { a, b, event, lea } = await setup();
      const batch = { stationId: 'poste-2', passages: [offline(lea.id, 'in', 10), offline(lea.id, 'out', 5)], refusals: [] };
      const first = await b.syncOffline(event.id, batch);
      expect(await b.syncOffline(event.id, batch)).toEqual(first);
      const snap = (await snapshotOf(a, event.id))!;
      expect(snap.passages).toHaveLength(2);
      expect(snap.participants.find((p) => p.id === lea.id)).toMatchObject({ inside: false, entryCount: 1 });
    });

    it("entrée hors ligne antérieure à une entrée en ligne : c'est l'entrée en ligne qui devient le doublon", async () => {
      const { a, b, event, lea } = await setup();
      const online = (await a.scan(event.id, lea.token, 'in', 'camera', 'poste-1')).passage!;
      const synced = await b.syncOffline(event.id, { stationId: 'poste-2', passages: [offline(lea.id, 'in', 3)], refusals: [] });
      expect(synced).toEqual({ passages: [expect.objectContaining({ status: 'counted' })], newDuplicates: 1 }); // le doublon est l'entrée déjà reçue
      const snap = (await snapshotOf(a, event.id))!;
      expect(snap.passages.find((p) => p.id === online.id)).toMatchObject({ offlineDuplicate: true });
      expect(snap.participants.find((p) => p.id === lea.id)).toMatchObject({ inside: true, entryCount: 1 });
      // Le scan en ligne suivant s'appuie sur la présence réconciliée
      expect((await a.scan(event.id, lea.token, 'in', 'camera', 'poste-1')).decision).toMatchObject({ result: 'refused', reason: 'already-inside' });
    });

    it('journalise les refus décidés hors ligne, une seule fois', async () => {
      const { a, b, event, lea } = await setup();
      const refusals = [
        { id: newRecordId(), reason: 'unknown' as const, at: ago(4), method: 'camera' as const, participantId: null, sample: 'https://exem' },
        { id: newRecordId(), reason: 'already-inside' as const, at: ago(3), method: 'camera' as const, participantId: lea.id, sample: '' },
      ];
      await b.syncOffline(event.id, { stationId: 'poste-2', passages: [], refusals });
      await b.syncOffline(event.id, { stationId: 'poste-2', passages: [], refusals });
      const snap = (await snapshotOf(a, event.id))!;
      expect(snap.refusals.map((r) => [r.reason, r.participantId, r.sample, r.stationId]).sort()).toEqual([
        ['already-inside', lea.id, '', 'poste-2'], ['unknown', null, 'https://exem', 'poste-2'],
      ]);
    });

    it('rejette un participant inconnu, une heure trop en avance ou un identifiant invalide, sans bloquer le reste', async () => {
      const { a, b, event, lea } = await setup();
      const other = await a.createEvent((await a.getSession())!.memberships[0]!.orgId, { name: 'Autre', startDate: '2027-04-01', endDate: '2027-04-01' });
      const [stranger] = await a.addParticipants(other.id, [{ firstName: 'Zoé', lastName: 'Ailleurs', email: 'zoe@x.fr', typeId: 'magasin', source: 'manual' }]);
      const future = { ...offline(lea.id, 'in', 0), at: new Date(Date.now() + 3_600_000).toISOString() };
      const r = await b.syncOffline(event.id, {
        stationId: 'poste-2',
        passages: [offline(stranger!.id, 'in', 5), future, { ...offline(lea.id, 'in', 5), id: 'PAS-VALIDE' }, offline(lea.id, 'in', 2)],
        refusals: [],
      });
      expect(statuses(r)).toEqual(['rejected', 'rejected', 'rejected', 'counted']);
      expect((await snapshotOf(a, event.id))!.passages).toHaveLength(1);
    });

    it("réservé aux membres connectés de l'organisation (NF-20, NF-24)", async () => {
      const { a, b, event, lea, orgId, emails } = await setup();
      const batch = { stationId: 'x', passages: [offline(lea.id, 'in', 1)], refusals: [] };
      await a.removeMember(orgId, (await a.listMembers(orgId)).find((m) => m.email === emails.bruno)!.userId);
      await expect(b.syncOffline(event.id, batch)).rejects.toMatchObject({ code: 'not-found' });
      await a.signOut();
      await expect(a.syncOffline(event.id, batch)).rejects.toMatchObject({ code: 'unauthenticated' });
    });
  });

  describe(`${name} — inscription publique`, () => {
    const form = { firstName: 'Sophie', lastName: 'Martin', email: 'sophie@x.fr', phone: '', company: 'Maison Martin', typeId: 'exposant', consent: true };

    it('refuse tant que les inscriptions sont fermées', async () => {
      const { a, event } = await setup();
      expect(await a.getRegistrationInfo(event.id)).toMatchObject({ eventName: 'Salon', open: false });
      await expect(a.register(event.id, form)).rejects.toMatchObject({ code: 'closed' });
    });

    it('inscrit, renvoie un jeton et ne montre au participant que ses propres données', async () => {
      const { a, event } = await setup();
      await a.updateEvent(event.id, { registrationOpen: true, privacy: { contact: 'dpo@salon.fr' } });
      const { token } = await a.register(event.id, form);
      const page = await a.getAccessPage(token);
      expect(page).toMatchObject({ eventName: 'Salon', firstName: 'Sophie', company: 'Maison Martin', entryCount: 0 });
      expect(page!.type?.label).toBe('Exposant');
      expect(Object.keys(page!)).not.toContain('email');
      expect(await a.getAccessPage('jeton-inconnu')).toBeNull();
    });

    it('exige le consentement et refuse un email déjà inscrit', async () => {
      const { a, event } = await setup();
      await a.updateEvent(event.id, { registrationOpen: true, privacy: { contact: 'dpo@salon.fr' } });
      await expect(a.register(event.id, { ...form, consent: false })).rejects.toMatchObject({ code: 'invalid' });
      await expect(a.register(event.id, { ...form, email: 'lea@x.fr' })).rejects.toMatchObject({ code: 'duplicate' });
    });
  });

  describe(`${name} — protection des données (NF-32 à NF-34, F-77, RG-09)`, () => {
    it("politique de l'organisation reprise par ses nouveaux événements, et par les copies", async () => {
      const { a, b, orgId, event } = await setup();
      expect(event.privacy).toMatchObject({ controller: 'Salon Pro', contact: '', retentionMonths: 3, legalBasis: 'consent' });
      await expect(b.setOrgPrivacy(orgId, { contact: 'x' })).rejects.toMatchObject({ code: 'forbidden' }); // agent
      const policy = await a.setOrgPrivacy(orgId, { contact: 'dpo@salon.fr', retentionMonths: 6, legalBasis: 'contract' });
      expect(await b.getOrgPrivacy(orgId)).toEqual(policy);
      const next = await a.createEvent(orgId, { name: 'Salon 2028', startDate: '2028-03-09', endDate: '2028-03-10' });
      expect(next.privacy).toEqual({ controller: 'Salon Pro', contact: 'dpo@salon.fr', legalBasis: 'contract', retentionMonths: 6, details: '' });
      const updated = await a.updateEvent(next.id, { privacy: { details: 'Contrôle d\'accès au salon' } });
      expect((await a.duplicateEvent(updated.id, 'Copie')).privacy.details).toBe('Contrôle d\'accès au salon');
    });

    it('inscriptions publiques impossibles sans contact pour les données ; politique et date de purge affichées au public', async () => {
      const { a, event } = await setup();
      await expect(a.updateEvent(event.id, { registrationOpen: true })).rejects.toMatchObject({ code: 'invalid' });
      await a.updateEvent(event.id, { registrationOpen: true, privacy: { contact: 'dpo@salon.fr', retentionMonths: 1 } });
      const info = await a.getRegistrationInfo(event.id);
      expect(info?.privacy).toMatchObject({ controller: 'Salon Pro', contact: 'dpo@salon.fr', retentionMonths: 1, purgeDay: '2027-04-12' });
      const { token } = await a.register(event.id, { firstName: 'S', lastName: 'Martin', email: 's@x.fr', phone: '', company: '', typeId: 'magasin', consent: true });
      expect((await a.getAccessPage(token))?.privacy.purgeDay).toBe('2027-04-12');
    });

    it("purge : bilan anonyme enregistré, données personnelles effacées, l'événement ne reçoit plus rien (NF-33, F-77)", async () => {
      const { a, b, orgId, event, lea } = await setup();
      await b.scan(event.id, lea.token, 'in', 'camera', 'entree');
      await expect(b.purgeEvent(event.id)).rejects.toMatchObject({ code: 'forbidden' }); // agent
      const report = await a.purgeEvent(event.id);
      expect(report).toMatchObject({ eventId: event.id, eventName: 'Salon', registered: 2, came: 1, reason: 'purge', peak: { value: 1 } });
      expect(JSON.stringify(report)).not.toMatch(/Léa|Petit|lea@x\.fr|Roy/);

      const snap = (await snapshotOf(a, event.id))!;
      expect(snap.event.purgedAt).toBe(report.generatedAt);
      expect([snap.participants.length, snap.passages.length, snap.refusals.length]).toEqual([0, 0, 0]);
      expect(await a.getAccessPage(lea.token)).toBeNull();
      await expect(b.scan(event.id, lea.token, 'in', 'camera', 'entree')).rejects.toMatchObject({ code: 'closed' });
      await expect(a.addParticipants(event.id, [{ firstName: 'X', lastName: 'Y', email: '', typeId: 'magasin', source: 'manual' }])).rejects.toMatchObject({ code: 'closed' });
      await expect(a.updateEvent(event.id, { registrationOpen: true, privacy: { contact: 'dpo@salon.fr' } })).rejects.toMatchObject({ code: 'closed' });
      await expect(a.purgeEvent(event.id)).rejects.toMatchObject({ code: 'closed' });
      expect(await a.listReports(orgId)).toEqual([report]);
    });

    it('suppression d\'un événement : son bilan anonyme est conservé (F-77)', async () => {
      const { a, orgId, event } = await setup();
      await a.deleteEvent(event.id);
      expect(await a.listReports(orgId)).toEqual([expect.objectContaining({ eventName: 'Salon', registered: 2, reason: 'deletion' })]);
    });

    it('trace les imports, exports, effacements et purges : qui, quand, combien (RG-09)', async () => {
      const { a, b, orgId, event, lea, marc } = await setup(); // setup importe Marc (source « import »)
      await a.logExport(event.id, 'workbook', 2);
      await expect(a.logExport(event.id, 'autre' as never, 1)).rejects.toMatchObject({ code: 'invalid' });
      await expect(b.logExport(event.id, 'workbook', 2)).rejects.toMatchObject({ code: 'forbidden' });
      const record = await a.exportParticipant(marc.id);
      await a.deleteParticipant(lea.id);
      await a.purgeEvent(event.id);
      await expect(b.listAudit(orgId)).rejects.toMatchObject({ code: 'forbidden' });
      const trail = await a.listAudit(orgId);
      expect(trail.map((t) => [t.action, t.count, t.actorName])).toEqual([
        ['purge', 1, 'Claire Owner'],
        ['participant.delete', 1, 'Claire Owner'],
        ['participant.export', 1, 'Claire Owner'],
        ['export', 2, 'Claire Owner'],
        ['import', 1, 'Claire Owner'],
      ]);
      expect(trail[3]).toMatchObject({ eventId: event.id, eventName: 'Salon', detail: 'Classeur Excel complet' });
      expect(record.eventName).toBe('Salon');
    });

    it("données d'une personne, à sa demande : tout ce qui la concerne, rien sur les agents (NF-34)", async () => {
      const { a, b, event, lea } = await setup();
      await b.scan(event.id, lea.token, 'in', 'camera', 'entree');
      await b.scan(event.id, lea.token, 'in', 'camera', 'entree'); // refus « déjà présent »
      await expect(b.exportParticipant(lea.id)).rejects.toMatchObject({ code: 'forbidden' });
      const record = await a.exportParticipant(lea.id);
      expect(record.participant).toMatchObject({ firstName: 'Léa', email: 'lea@x.fr', entryCount: 1 });
      expect(record.passages).toEqual([expect.objectContaining({ direction: 'in', stationId: 'entree', origin: 'online' })]);
      expect(record.refusals).toEqual([expect.objectContaining({ reason: 'already-inside', stationId: 'entree' })]);
      expect(JSON.stringify(record)).not.toContain('Bruno');
    });
  });
}
