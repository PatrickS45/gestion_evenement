/// <reference path="../pb_data/types.d.ts" />
// Protection des données (NF-32, NF-33, F-77, RG-09) : politique de confidentialité, purge, bilans, traces.
// Bilans et traces ne se lisent que par les routes /api/ec, qui vérifient le rôle ; aucune écriture directe.

const text = (name, max, required = false) => ({ type: 'text', name, max, required });
const json = (name, maxSize) => ({ type: 'json', name, maxSize });

migrate((app) => {
  const events = app.findCollectionByNameOrId('events');
  events.fields.add(new Field(json('privacy', 10000)));
  events.fields.add(new Field(text('purgedAt', 40)));
  app.save(events);

  const organizations = app.findCollectionByNameOrId('organizations');
  organizations.fields.add(new Field(json('privacy', 10000)));
  app.save(organizations);

  const orgId = organizations.id;
  app.save(new Collection({
    type: 'base', name: 'reports',
    fields: [
      { type: 'relation', name: 'org', collectionId: orgId, maxSelect: 1, required: true, cascadeDelete: true },
      text('eventId', 40),
      json('report', 500000),
      text('createdAt', 40),
    ],
    indexes: ['CREATE INDEX idx_reports_org ON reports (org, createdAt)'],
  }));

  app.save(new Collection({
    type: 'base', name: 'audit',
    fields: [
      { type: 'relation', name: 'org', collectionId: orgId, maxSelect: 1, required: true, cascadeDelete: true },
      text('eventId', 40),
      text('eventName', 200),
      text('actorId', 40),
      text('actorName', 100),
      text('action', 30, true),
      { type: 'number', name: 'count', onlyInt: true, min: 0 },
      text('detail', 200),
      text('at', 40, true),
    ],
    indexes: ['CREATE INDEX idx_audit_org ON audit (org, at)'],
  }));
}, (app) => {
  for (const name of ['audit', 'reports']) app.delete(app.findCollectionByNameOrId(name));
  for (const [name, fields] of [['events', ['privacy', 'purgedAt']], ['organizations', ['privacy']]]) {
    const c = app.findCollectionByNameOrId(name);
    for (const f of fields) c.fields.removeByName(f);
    app.save(c);
  }
});
