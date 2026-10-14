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
npm test           # tests automatiques (y compris contre le serveur, s'il est installé)
npm run build      # vérification des types et version de production (dossier dist)
```

Au premier lancement, créez un compte : il crée aussi votre organisation, dont vous êtes propriétaire.
Pour montrer les rôles, créez un second compte, puis ajoutez-le comme agent d'accueil depuis la page
« Membres » du premier. La session est propre à chaque onglet : un onglet propriétaire et un onglet
agent peuvent fonctionner côte à côte.

### Sans serveur : démonstration sur un appareil

Par défaut, les données sont conservées dans le navigateur. Deux onglets ouverts côte à côte se
synchronisent en temps réel : ils simulent deux postes de scan.

### Avec le serveur PocketBase : plusieurs appareils

```
npm run server:install   # télécharge PocketBase (version figée, archive vérifiée) dans server/bin
npm run server           # serveur sur http://127.0.0.1:8090, données dans server/pb_data
```

Puis copier `.env.example` en `.env.local` et relancer `npm run dev`. Les requêtes `/api` sont relayées
par Vite vers PocketBase : un téléphone du réseau local n'a besoin que de l'adresse du poste de
développement (`npm run dev -- --host`). L'administration de PocketBase est sur http://127.0.0.1:8090/_/.

## Organisation du code

| Dossier | Contenu |
|---|---|
| `src/domain` | Règles métier pures et testées : scan, présence, jauge, couleurs, import CSV, droits par rôle |
| `src/data` | Contrat `EventStore`, ses deux implémentations (navigateur et PocketBase) et la suite de tests commune `storeContract.ts` |
| `src/export` | Classeur Excel et fichiers CSV |
| `src/pages`, `src/ui` | Écrans et composants |
| `server/pb_migrations` | Schéma de la base et règles de lecture (réservée aux membres de l'organisation) |
| `server/src` | Routes `/api/ec` : toutes les écritures, avec les droits et le scan atomique ; réutilise `src/domain` |
| `server/pb_hooks` | Déclaration des routes ; `lib/ec.cjs` est compilé depuis `server/src` (`npm run build:hooks`) |
