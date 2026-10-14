/// <reference path="../pb_data/types.d.ts" />
// Routes d'Event Control. La logique est dans server/src, compilée dans lib/ec.cjs
// (npm run build:hooks). Chaque gestionnaire s'exécute isolé : il charge le module lui-même.

// En-têtes de sécurité sur toutes les réponses, application comprise (NF-21) : aucune ressource
// extérieure, pas d'intégration dans une autre page, caméra réservée à l'application.
routerUse((e) => {
  const h = e.response.header();
  h.set('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'", // décodeur de QR code (WebAssembly)
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "worker-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(), payment=(), usb=()');
  h.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return e.next();
});

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
routerAdd('POST', '/api/ec/participants/{id}/accept', (e) => require(`${__hooks}/lib/ec.cjs`).acceptParticipant(e));
routerAdd('POST', '/api/ec/participants/{id}/token', (e) => require(`${__hooks}/lib/ec.cjs`).revokeToken(e));

routerAdd('GET', '/api/ec/public/events/{id}', (e) => require(`${__hooks}/lib/ec.cjs`).registrationInfo(e));
routerAdd('POST', '/api/ec/public/events/{id}/register', (e) => require(`${__hooks}/lib/ec.cjs`).register(e));
routerAdd('GET', '/api/ec/public/access/{token}', (e) => require(`${__hooks}/lib/ec.cjs`).accessPage(e));

// Agents par code d'accès (F-04)
routerAdd('POST', '/api/ec/join', (e) => require(`${__hooks}/lib/ec.cjs`).joinEvent(e));
routerAdd('PUT', '/api/ec/events/{id}/access-code', (e) => require(`${__hooks}/lib/ec.cjs`).setAccessCode(e));
routerAdd('GET', '/api/ec/events/{id}/agents', (e) => require(`${__hooks}/lib/ec.cjs`).listEventAgents(e));

// Protection des données (NF-32 à NF-34, F-77, RG-09)
routerAdd('GET', '/api/ec/orgs/{org}/privacy', (e) => require(`${__hooks}/lib/ec.cjs`).getOrgPrivacy(e));
routerAdd('PUT', '/api/ec/orgs/{org}/privacy', (e) => require(`${__hooks}/lib/ec.cjs`).setOrgPrivacy(e));
routerAdd('GET', '/api/ec/orgs/{org}/reports', (e) => require(`${__hooks}/lib/ec.cjs`).listReports(e));
routerAdd('GET', '/api/ec/orgs/{org}/audit', (e) => require(`${__hooks}/lib/ec.cjs`).listAudit(e));
routerAdd('POST', '/api/ec/events/{id}/purge', (e) => require(`${__hooks}/lib/ec.cjs`).purgeEvent(e));
routerAdd('POST', '/api/ec/events/{id}/export-log', (e) => require(`${__hooks}/lib/ec.cjs`).logExport(e));
routerAdd('GET', '/api/ec/participants/{id}/export', (e) => require(`${__hooks}/lib/ec.cjs`).exportParticipant(e));
routerAdd('POST', '/api/ec/maintenance/purge', (e) => require(`${__hooks}/lib/ec.cjs`).purgeDueRoute(e));

// Purge automatique à l'échéance de conservation (NF-33), chaque nuit à 2 h (temps universel)
cronAdd('ec-purge', '0 2 * * *', () => require(`${__hooks}/lib/ec.cjs`).purgeDue());
