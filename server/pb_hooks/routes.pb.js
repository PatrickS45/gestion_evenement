/// <reference path="../pb_data/types.d.ts" />
// Routes d'Event Control. La logique est dans server/src, compilée dans lib/ec.cjs
// (npm run build:hooks). Chaque gestionnaire s'exécute isolé : il charge le module lui-même.

routerAdd('GET', '/api/ec/session', (e) => require(`${__hooks}/lib/ec.cjs`).session(e));
routerAdd('POST', '/api/ec/signup', (e) => require(`${__hooks}/lib/ec.cjs`).signUp(e));

routerAdd('POST', '/api/ec/orgs', (e) => require(`${__hooks}/lib/ec.cjs`).createOrganization(e));
routerAdd('GET', '/api/ec/orgs/{org}/members', (e) => require(`${__hooks}/lib/ec.cjs`).listMembers(e));
routerAdd('POST', '/api/ec/orgs/{org}/members', (e) => require(`${__hooks}/lib/ec.cjs`).addMember(e));
routerAdd('PATCH', '/api/ec/orgs/{org}/members/{user}', (e) => require(`${__hooks}/lib/ec.cjs`).setMemberRole(e));
routerAdd('DELETE', '/api/ec/orgs/{org}/members/{user}', (e) => require(`${__hooks}/lib/ec.cjs`).removeMember(e));
routerAdd('POST', '/api/ec/orgs/{org}/events', (e) => require(`${__hooks}/lib/ec.cjs`).createEvent(e));

routerAdd('PATCH', '/api/ec/events/{id}', (e) => require(`${__hooks}/lib/ec.cjs`).updateEvent(e));
routerAdd('DELETE', '/api/ec/events/{id}', (e) => require(`${__hooks}/lib/ec.cjs`).deleteEvent(e));
routerAdd('POST', '/api/ec/events/{id}/duplicate', (e) => require(`${__hooks}/lib/ec.cjs`).duplicateEvent(e));
routerAdd('POST', '/api/ec/events/{id}/participants', (e) => require(`${__hooks}/lib/ec.cjs`).addParticipants(e));
routerAdd('POST', '/api/ec/events/{id}/scan', (e) => require(`${__hooks}/lib/ec.cjs`).scan(e));
routerAdd('POST', '/api/ec/events/{id}/close-day', (e) => require(`${__hooks}/lib/ec.cjs`).closeDay(e));
routerAdd('POST', '/api/ec/events/{id}/sync', (e) => require(`${__hooks}/lib/ec.cjs`).syncOffline(e));

routerAdd('PATCH', '/api/ec/participants/{id}', (e) => require(`${__hooks}/lib/ec.cjs`).updateParticipant(e));
routerAdd('DELETE', '/api/ec/participants/{id}', (e) => require(`${__hooks}/lib/ec.cjs`).deleteParticipant(e));
routerAdd('POST', '/api/ec/participants/{id}/token', (e) => require(`${__hooks}/lib/ec.cjs`).revokeToken(e));

routerAdd('GET', '/api/ec/public/events/{id}', (e) => require(`${__hooks}/lib/ec.cjs`).registrationInfo(e));
routerAdd('POST', '/api/ec/public/events/{id}/register', (e) => require(`${__hooks}/lib/ec.cjs`).register(e));
routerAdd('GET', '/api/ec/public/access/{token}', (e) => require(`${__hooks}/lib/ec.cjs`).accessPage(e));
