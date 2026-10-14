/// <reference path="../pb_data/types.d.ts" />
// Personnalisation visuelle des pages publiques (F-14) : couleur et logo intégré (image réduite, 150 000 caractères au plus).

migrate((app) => {
  const events = app.findCollectionByNameOrId('events');
  events.fields.add(new Field({ type: 'json', name: 'branding', maxSize: 200000 }));
  app.save(events);
}, (app) => {
  const events = app.findCollectionByNameOrId('events');
  events.fields.removeByName('branding');
  app.save(events);
});
