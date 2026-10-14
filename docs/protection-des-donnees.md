# Protection des données — Event Control

Document destiné au client (responsable de traitement) et à son délégué à la protection des données (DPO).
Il décrit les traitements réalisés par Event Control, les mesures en place et ce qui reste à renseigner avant la
mise en production. Il sert de base à la fiche du registre du client et au contrat de sous-traitance (article 28).

Les points marqués **À renseigner** dépendent de choix qui ne sont pas encore faits (hébergeur, service d'emails)
ou d'informations propres au client.

## 1. Rôles (NF-31)

| Rôle | Qui | Responsabilités |
|---|---|---|
| Responsable de traitement | Le client, organisateur de l'événement | Finalités, base légale, durée de conservation, information des personnes, réponse aux demandes |
| Sous-traitant | L'éditeur d'Event Control | Héberger et faire fonctionner le service selon les instructions du client, sécurité, assistance |
| Sous-traitants ultérieurs | Voir section 5 | Hébergement, envoi des emails |

Un contrat de sous-traitance (article 28 du RGPD) est signé avec chaque client avant la mise en service.

## 2. Fiche du traitement « Contrôle d'accès à un événement »

Modèle de fiche pour le registre du client (article 30.1). L'éditeur tient de son côté le registre des catégories
de traitements effectués pour le compte de ses clients (article 30.2).

| Rubrique | Contenu |
|---|---|
| Finalités | Gérer les inscriptions ; contrôler les entrées et sorties ; suivre la fréquentation (jauge de sécurité) ; produire des statistiques anonymes |
| Base légale | Choisie par l'organisateur pour chaque événement : consentement, exécution d'un contrat (inscription) ou intérêt légitime (contrôle d'accès et sécurité). Affichée au public |
| Personnes concernées | Participants inscrits (visiteurs, exposants, magasins…) ; membres de l'équipe de l'organisateur (comptes) |
| Données des participants | Nom, prénom, email, téléphone (facultatif), société ou enseigne, type de participant, date du consentement, jeton du QR code, horaires d'entrée et de sortie, tentatives refusées (motif, heure, poste) |
| Données de l'équipe | Nom, email, mot de passe (stocké sous forme irréversible), rôle, nom du poste et horaires des scans réalisés |
| Destinataires | Membres de l'organisation de l'événement, selon leur rôle (section 4) ; aucun autre destinataire, aucune cession ni revente |
| Transferts hors UE | Aucun (NF-30) : hébergement en France ; aucune police de caractères, statistique d'audience ou ressource chargée depuis un tiers (NF-35) |
| Durée de conservation | Choisie par l'organisateur pour chaque événement : **3 mois après la fin par défaut**, de 1 à 36 mois. Effacement automatique à l'échéance (section 3) |
| Données conservées ensuite | Un bilan chiffré sans aucune donnée personnelle (inscrits, venus, pic de présence, répartition par type, affluence), conservé sans limite (F-77) |
| Mesures de sécurité | Section 6 |

## 3. Cycle de vie des données

1. **Collecte.** Par import de fichier, saisie par l'équipe, ou formulaire d'inscription public. Le formulaire
   n'ouvre que si l'organisateur a renseigné le responsable du traitement et un contact pour les données. Il affiche
   le responsable, la base légale, la durée de conservation et la date d'effacement, les droits des personnes et le
   recours auprès de la CNIL. La même information figure sur la page d'accès de chaque participant (NF-32). Le
   consentement coché est horodaté.
2. **Utilisation pendant l'événement.** Scan des QR codes, présence en direct, statistiques. Hors ligne, une copie de
   la liste est conservée chiffrée sur les postes de scan (section 6).
3. **Rappel.** Quinze jours avant l'échéance, un rappel s'affiche pour les administrateurs dans l'application (NF-33).
   **À compléter :** l'envoi de ce rappel par email arrivera avec le service d'emails.
4. **Effacement.** À l'échéance, le serveur efface automatiquement chaque nuit les participants, leurs passages et les
   tentatives refusées. Le bilan anonyme est enregistré juste avant. Le propriétaire peut aussi purger plus tôt, ou
   supprimer l'événement ; dans ce cas aussi, le bilan est enregistré avant toute suppression.
5. **Postes de scan.** La copie locale est effacée à la déconnexion de l'agent, et au premier démarrage qui suit la fin
   de l'événement.

Les sauvegardes du serveur sont conservées 30 jours (NF-11) : une donnée effacée disparaît des sauvegardes au plus
tard 30 jours après son effacement.

## 4. Accès aux données

| Rôle | Accès |
|---|---|
| Propriétaire | Tout, y compris les membres, la purge et la suppression d'un événement |
| Administrateur | Événements, participants, statistiques et exports, traces des actions |
| Agent d'accueil | Scan, recherche d'un participant et jauge ; ni export ni modification |
| Participant | Sa seule page d'accès : nom, société, type, QR code, nombre d'entrées ; jamais son email |

Les règles d'accès sont appliquées par le serveur (NF-20) et vérifiées par des tests automatiques à chaque
modification (NF-26).

## 5. Sous-traitants ultérieurs (NF-36)

| Prestataire | Rôle | Localisation des données | Garanties |
|---|---|---|---|
| **À renseigner** (OVHcloud, Scaleway, Clever Cloud ou Scalingo) | Hébergement du serveur et des sauvegardes | France | Contrat de sous-traitance de l'hébergeur ; droit européen |
| **À renseigner** (ex. Brevo) | Envoi des emails de confirmation et de rappel (lot 2) | Union européenne | Contrat de sous-traitance du prestataire |

Le client est informé de tout changement de sous-traitant ultérieur avant sa mise en œuvre et peut s'y opposer.

## 6. Mesures de sécurité

- **Échanges** : HTTPS uniquement. En-têtes de sécurité sur toutes les réponses (NF-21) :
  - politique de contenu (aucune ressource extérieure) ;
  - interdiction d'intégrer l'application dans une autre page ;
  - caméra réservée à l'application ;
  - aucune information transmise aux sites tiers (référent).
- **Comptes** : mots de passe stockés de façon irréversible ; tentatives de connexion et de création de compte
  limitées (NF-22) ; droits par rôle (section 4).
- **Journal des passages** : en ajout seul, il ne peut être ni modifié ni supprimé passage par passage (NF-23).
- **QR codes** : jeton aléatoire de 160 bits, régénérable en cas de perte ou de partage. L'ancien code est alors refusé.
- **Postes hors ligne** : la copie locale et la file d'attente sont chiffrées sur l'appareil (AES-GCM 256 bits,
  clé non exportable). Cela protège les données si quelqu'un récupère les fichiers du navigateur, mais pas sur un
  appareil déverrouillé et compromis. Les postes doivent donc rester sous la surveillance de l'équipe.
- **Traces (RG-09)** : chaque action sur des données personnelles est tracée (qui, quand, combien de personnes).
  Elles sont consultables par les propriétaires et administrateurs, page « Données personnelles ». Les actions
  tracées :
  - import ;
  - export du classeur ou des listes ;
  - export des données d'une personne ;
  - effacement d'une personne ;
  - suppression d'un événement ;
  - purge, manuelle ou automatique.
- **Dépendances** : surveillées, mises à jour de sécurité sous 30 jours, ou 7 jours si critique (NF-25).

## 7. Demandes des personnes (NF-34)

| Demande | Dans l'application | Délai légal |
|---|---|---|
| Accès, portabilité | Participants › « Ses données » : fichier de tout ce qui concerne la personne (identité, passages, tentatives refusées), sans données sur l'équipe | 1 mois |
| Rectification | Participants › « Modifier » | 1 mois |
| Effacement | Participants › « Supprimer » : la personne et ses passages | 1 mois |
| Opposition, limitation | Selon la base légale ; à défaut d'autre solution, effacement | 1 mois |

Ces actions sont tracées. Le contact affiché au public est celui que l'organisateur a renseigné.

## 8. Violation de données

L'éditeur informe le client sans délai, et au plus tard dans les 24 heures, de toute violation de données dont il a
connaissance. Il lui transmet les éléments nécessaires à sa notification à la CNIL, qui doit intervenir dans les
72 heures (article 33). **À renseigner :** le contact du client pour ces alertes.

## 9. Restant à faire avant la mise en production

- Choisir l'hébergeur et le service d'emails, puis compléter la section 5.
- Signer le contrat de sous-traitance avec le client.
- Obtenir du client sa durée de conservation et le contact de son DPO (question Q9 du cahier des charges).
- Envoyer par email le rappel avant la purge (avec le service d'emails).
- Faire l'audit d'accessibilité (NF-42).
