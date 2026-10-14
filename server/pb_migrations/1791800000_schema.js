/// <reference path="../pb_data/types.d.ts" />
// Schéma Event Control (cahier des charges, section 7).
//
// Lecture : réservée aux membres de l'organisation de l'événement (NF-24), y compris en temps réel.
// Écriture : aucune par l'API générique ; toutes les modifications passent par les routes
// /api/ec/* (pb_hooks), qui appliquent la matrice des droits (NF-20) et l'atomicité du scan (F-53).
// Les passages et refus ne sont ni modifiables ni supprimables (NF-23).

// La condition de connexion est indispensable : une liste de membres vide vaut '' dans les
// règles, et '' ?= @request.auth.id serait vrai pour un visiteur non connecté.
const member = (path) => `@request.auth.id != '' && (${[
  `${path}owners.id ?= @request.auth.id`,
  `${path}admins.id ?= @request.auth.id`,
  `${path}agents.id ?= @request.auth.id`,
].join(' || ')})`;

const text = (name, max, required = false) => ({ type: 'text', name, max, required });
const bool = (name) => ({ type: 'bool', name });
const int = (name, min = 0) => ({ type: 'number', name, onlyInt: true, min });
const json = (name) => ({ type: 'json', name, maxSize: 20000 });

migrate((app) => {
  const users = app.findCollectionByNameOrId('users');
  users.listRule = 'id = @request.auth.id';
  users.viewRule = 'id = @request.auth.id';
  users.createRule = null; // inscription par /api/ec/signup, qui crée aussi l'organisation
  users.updateRule = null;
  users.deleteRule = null;
  users.fields.getByName('password').min = 10;
  users.fields.getByName('name').required = true;
  app.save(users);

  const relation = (name, collection, opts = {}) => ({
    type: 'relation', name, collectionId: app.findCollectionByNameOrId(collection).id, maxSelect: 1, ...opts,
  });

  const organizations = new Collection({
    type: 'base', name: 'organizations',
    listRule: member(''), viewRule: member(''),
    fields: [
      text('name', 200, true),
      relation('owners', 'users', { maxSelect: 999 }),
      relation('admins', 'users', { maxSelect: 999 }),
      relation('agents', 'users', { maxSelect: 999 }),
      text('createdAt', 40),
    ],
  });
  app.save(organizations);

  const events = new Collection({
    type: 'base', name: 'events',
    listRule: member('org.'), viewRule: member('org.'),
    fields: [
      relation('org', 'organizations', { required: true, cascadeDelete: true }),
      text('name', 200, true),
      text('startDate', 10, true),
      text('endDate', 10, true),
      text('venue', 200),
      int('capacity'),
      json('thresholds'),
      json('types'),
      bool('registrationOpen'),
      text('createdAt', 40),
    ],
    indexes: ['CREATE INDEX idx_events_org ON events (org)'],
  });
  app.save(events);

  const participants = new Collection({
    type: 'base', name: 'participants',
    listRule: member('event.org.'), viewRule: member('event.org.'),
    fields: [
      relation('event', 'events', { required: true, cascadeDelete: true }),
      text('firstName', 100),
      text('lastName', 100),
      text('email', 320),
      text('phone', 40),
      text('company', 120),
      text('typeId', 60, true),
      text('token', 64, true),
      bool('tokenRevoked'),
      text('source', 10),
      text('consentAt', 40),
      text('createdAt', 40),
      bool('inside'),
      int('entryCount'),
      text('firstEntryAt', 40),
      text('lastMoveAt', 40),
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_participants_token ON participants (token)',
      'CREATE INDEX idx_participants_event ON participants (event)',
      "CREATE UNIQUE INDEX idx_participants_email ON participants (event, email) WHERE email != ''",
    ],
  });
  app.save(participants);

  const passages = new Collection({
    type: 'base', name: 'passages',
    listRule: member('event.org.'), viewRule: member('event.org.'),
    fields: [
      relation('event', 'events', { required: true, cascadeDelete: true }),
      relation('participant', 'participants', { required: true, cascadeDelete: true }), // RG-08
      text('typeId', 60),
      text('direction', 3, true),
      text('at', 40, true),
      text('agentId', 40),
      text('agentName', 100),
      text('stationId', 60),
      text('method', 10),
      text('origin', 10),
      bool('offlineDuplicate'),
    ],
    indexes: ['CREATE INDEX idx_passages_event ON passages (event, at)'],
  });
  app.save(passages);

  const refusals = new Collection({
    type: 'base', name: 'refusals',
    listRule: member('event.org.'), viewRule: member('event.org.'),
    fields: [
      relation('event', 'events', { required: true, cascadeDelete: true }),
      text('reason', 20, true),
      text('at', 40, true),
      text('agentId', 40),
      text('agentName', 100),
      text('stationId', 60),
      text('method', 10),
      text('participantId', 40),
      text('sample', 12),
    ],
    indexes: ['CREATE INDEX idx_refusals_event ON refusals (event, at)'],
  });
  app.save(refusals);

  // Limitation des tentatives (NF-22) : connexion et création de compte, par adresse réseau
  const settings = app.settings();
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    { label: '*:auth', maxRequests: 20, duration: 60 },
    { label: '/api/ec/signup', maxRequests: 10, duration: 60 },
    { label: '/api/', maxRequests: 600, duration: 10 },
  ];
  app.save(settings);
}, (app) => {
  for (const name of ['refusals', 'passages', 'participants', 'events', 'organizations']) {
    app.delete(app.findCollectionByNameOrId(name));
  }
});
