// Protection du formulaire d'inscription (F-36), sur un serveur configuré comme en production.
import { PocketStore } from './pocketStore';
import { serverInstalled, startTestServer, type TestServer } from './testServer';

let server: TestServer | undefined;
if (serverInstalled) {
  beforeAll(async () => { server = await startTestServer({ rateLimits: true }); }, 60_000);
  afterAll(() => server?.stop());
}

describe.skipIf(!serverInstalled)('inscriptions limitées par adresse réseau (F-36)', () => {
  it('au-delà de 20 inscriptions par minute depuis la même adresse, les suivantes sont refusées', async () => {
    const owner = new PocketStore(server!.url);
    const orgId = (await owner.signUp({ name: 'Claire', email: 'claire@x.fr', password: 'motdepasse-solide', organization: 'Salon' })).memberships[0]!.orgId;
    const event = await owner.createEvent(orgId, { name: 'Salon', startDate: '2027-03-11', endDate: '2027-03-12' });
    await owner.updateEvent(event.id, { registrationOpen: true, privacy: { contact: 'dpo@salon.fr' } });
    const visitor = new PocketStore(server!.url);
    const form = (i: number) => ({ firstName: 'P', lastName: `N${i}`, email: `p${i}@x.fr`, phone: '', company: '', typeId: 'magasin', consent: true });
    const results = [];
    for (let i = 0; i < 22; i++) results.push(await visitor.register(event.id, form(i)).then(() => 'ok', (e: { message: string }) => e.message));
    expect(results.slice(0, 20).every((r) => r === 'ok')).toBe(true);
    expect(results.slice(20)).toEqual(['Trop de tentatives, réessayez dans une minute', 'Trop de tentatives, réessayez dans une minute']);
    // Le formulaire lui-même reste consultable
    expect((await visitor.getRegistrationInfo(event.id))?.open).toBe(true);
  }, 60_000);
});
