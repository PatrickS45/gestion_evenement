/// <reference path="../pb_data/types.d.ts" />
// Validation manuelle des inscriptions (F-37) : option de l'événement, statut du participant.
// Les participants déjà enregistrés (statut vide) sont considérés comme acceptés.

migrate((app) => {
  const events = app.findCollectionByNameOrId('events');
  events.fields.add(new Field({ type: 'bool', name: 'requireApproval' }));
  app.save(events);
  const participants = app.findCollectionByNameOrId('participants');
  participants.fields.add(new Field({ type: 'text', name: 'status', max: 10 }));
  app.save(participants);
}, (app) => {
  const events = app.findCollectionByNameOrId('events');
  events.fields.removeByName('requireApproval');
  app.save(events);
  const participants = app.findCollectionByNameOrId('participants');
  participants.fields.removeByName('status');
  app.save(participants);
});
