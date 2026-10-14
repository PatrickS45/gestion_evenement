/// <reference path="../pb_data/types.d.ts" />
// Agents rejoignant un seul événement avec un code d'accès (F-04) : ils lisent cet événement, ses
// participants, passages et refus, y compris en temps réel, sans être membres de l'organisation.

const member = (path) => `@request.auth.id != '' && (${[
  `${path}org.owners.id ?= @request.auth.id`,
  `${path}org.admins.id ?= @request.auth.id`,
  `${path}org.agents.id ?= @request.auth.id`,
  `${path}agents.id ?= @request.auth.id`,
].join(' || ')})`;

migrate((app) => {
  const events = app.findCollectionByNameOrId('events');
  events.fields.add(new Field({ type: 'relation', name: 'agents', collectionId: app.findCollectionByNameOrId('users').id, maxSelect: 999 }));
  events.fields.add(new Field({ type: 'text', name: 'accessCode', max: 20 }));
  events.indexes.push("CREATE UNIQUE INDEX idx_events_access_code ON events (accessCode) WHERE accessCode != ''");
  events.listRule = member('');
  events.viewRule = member('');
  app.save(events);
  const settings = app.settings();
  settings.rateLimits.rules = [{ label: '/api/ec/join', maxRequests: 10, duration: 60 }, ...settings.rateLimits.rules];
  app.save(settings);

  for (const name of ['participants', 'passages', 'refusals']) {
    const c = app.findCollectionByNameOrId(name);
    c.listRule = member('event.');
    c.viewRule = member('event.');
    app.save(c);
  }
}, (app) => {
  const events = app.findCollectionByNameOrId('events');
  events.fields.removeByName('agents');
  events.fields.removeByName('accessCode');
  events.indexes = events.indexes.filter((i) => !i.includes('idx_events_access_code'));
  app.save(events);
});
