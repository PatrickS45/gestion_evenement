/// <reference path="../pb_data/types.d.ts" />
// Champs personnalisés par événement et réponses des participants (F-33).

migrate((app) => {
  const events = app.findCollectionByNameOrId('events');
  events.fields.add(new Field({ type: 'json', name: 'fields', maxSize: 50000 }));
  app.save(events);
  const participants = app.findCollectionByNameOrId('participants');
  participants.fields.add(new Field({ type: 'json', name: 'answers', maxSize: 20000 }));
  app.save(participants);
}, (app) => {
  const events = app.findCollectionByNameOrId('events');
  events.fields.removeByName('fields');
  app.save(events);
  const participants = app.findCollectionByNameOrId('participants');
  participants.fields.removeByName('answers');
  app.save(participants);
});
