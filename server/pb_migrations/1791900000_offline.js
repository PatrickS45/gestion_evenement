/// <reference path="../pb_data/types.d.ts" />
// Mode hors ligne (F-61, F-63) : à chaque lot reçu, le journal de chaque participant concerné est relu.

migrate((app) => {
  const passages = app.findCollectionByNameOrId('passages');
  passages.indexes.push('CREATE INDEX idx_passages_participant ON passages (participant, at)');
  app.save(passages);
}, (app) => {
  const passages = app.findCollectionByNameOrId('passages');
  passages.indexes = passages.indexes.filter((i) => !i.includes('idx_passages_participant'));
  app.save(passages);
});
