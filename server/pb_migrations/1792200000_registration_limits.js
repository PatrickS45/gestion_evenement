/// <reference path="../pb_data/types.d.ts" />
// Protection du formulaire d'inscription (F-36) : au plus 20 inscriptions par minute et par adresse réseau.
// Une limite plus basse bloquerait les inscriptions sur place, faites depuis le même Wi-Fi.

const RULE = { label: 'POST /api/ec/public/', maxRequests: 20, duration: 60 };

migrate((app) => {
  const settings = app.settings();
  settings.rateLimits.rules = [RULE, ...settings.rateLimits.rules.filter((r) => r.label !== RULE.label)];
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.rateLimits.rules = settings.rateLimits.rules.filter((r) => r.label !== RULE.label);
  app.save(settings);
});
