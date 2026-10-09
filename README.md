# Event Control

Contrôle d'accès et fréquentation en temps réel pour salons et événements professionnels :
inscriptions avec QR code, scan des entrées et des sorties, jauge de sécurité, typologies de
participants et statistiques.

Le périmètre fonctionnel est décrit dans [docs/cahier-des-charges.md](docs/cahier-des-charges.md).
Ce document fait référence : le développement part de lui, et non d'un code existant.

## Démarrer

Prérequis : Node.js 24.

```
npm install
npm run dev        # application sur http://localhost:5173
npm test           # tests automatiques
npm run build      # vérification des types et version de production (dossier dist)
```

En l'absence de serveur, les données sont conservées dans le navigateur. Deux onglets ouverts
côte à côte se synchronisent en temps réel : ils simulent deux postes de scan.

## Organisation du code

| Dossier | Contenu |
|---|---|
| `src/domain` | Règles métier pures et testées : scan, présence, jauge, couleurs, import CSV |
| `src/data` | Accès aux données : contrat `EventStore` et implémentation locale (navigateur) |
| `src/export` | Classeur Excel et fichiers CSV |
| `src/pages`, `src/ui` | Écrans et composants |
