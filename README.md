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

### Mode hors ligne (F-60 à F-64)

Avec le serveur, chaque poste garde une copie de secours chiffrée de l'événement qu'il affiche. Il la met à jour en
continu ; le bouton « Préparer le hors ligne » la force avant l'ouverture. Si le serveur ne répond plus, ou s'il met
plus de 2 s à répondre, le scan est validé sur le poste à partir de cette copie. Le passage est mis en file d'attente,
chiffrée elle aussi, puis envoyé dans l'ordre au retour du réseau. Le serveur rejoue alors le journal de chaque
participant à l'heure réelle et marque les doublons.

Un bandeau indique en permanence l'état du poste et le nombre de passages en attente. Hors ligne, la présence affichée
n'est qu'une estimation. La déconnexion est refusée tant que des passages attendent ; une fois acceptée, elle efface
la copie, la file et la clé de chiffrement. La copie d'un événement terminé est effacée au démarrage suivant.

En version de production (`npm run build`), un service worker permet d'ouvrir l'application sans réseau, à condition
qu'elle ait été ouverte une fois en ligne. En mode serveur, utilisez un seul onglet de scan par appareil : la file
d'attente est propre à l'appareil.

### Test de charge (NF-05)

```
npm run test:charge
```

Il simule le pic du premier client sur un serveur temporaire, configuré comme en production : 1 100 participants,
2 postes et 400 arrivées, avec des badges lus au même instant sur les deux postes, des QR codes inconnus, des
sorties et des retours. Il vérifie qu'aucun scan n'échoue, que la base, les deux postes et l'écran Direct
affichent les mêmes comptes, et que les délais sont tenus : scan en moins de 1 s, propagation en moins de 3 s.
Il affiche un rapport chiffré.

Un second test reproduit la recette n° 3. Le serveur est coupé pendant que les deux postes scannent, avec des
badges lus sur les deux postes, des sorties et des entrées refusées. Au retour du serveur, le test vérifie que chaque
doublon est signalé, que le comptage final est juste et que l'écran Direct, resté ouvert, affiche le même résultat.

- `CHARGE_MINUTES=30` répartit les arrivées sur 30 minutes, au rythme du jour J.
- `CHARGE_COUPURE_MINUTES=15` fait durer réellement la coupure du second test.
- `CHARGE_URL=https://…` vise un serveur déjà en ligne, pour la recette. Les comptes de test y restent ;
  l'événement de test est supprimé à la fin. Le test de coupure est alors ignoré.

Sous PowerShell : `$env:CHARGE_MINUTES=30; npm run test:charge`.

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
