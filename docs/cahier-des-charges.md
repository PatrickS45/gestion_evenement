# Cahier des charges fonctionnel — Event Control

| | |
|---|---|
| **Version** | 1.0 — 9 octobre 2026 |
| **Auteur** | [Nom de l'éditeur] — auto-entrepreneur, SIRET 798 419 248 00025 |
| **Statut** | Document de référence pour le développement de la version 1 |
| **Premier client visé** | Salon professionnel, mars 2027, environ 1 100 participants sur 2 jours |

Ce document décrit **ce que le logiciel doit faire** : utilisateurs, fonctions, règles métier et contraintes. Il ne décrit pas la manière de le programmer. Il sert de base unique au développement ; toute fonction absente de ce document est hors périmètre jusqu'à sa mise à jour.

Les exigences sont numérotées (`F-xx` fonctionnelles, `NF-xx` non fonctionnelles) et rattachées à un lot de livraison :

- **Lot 1 — Démonstration** : le cœur du produit, à montrer au prospect.
- **Lot 2 — Production** : ce qui est nécessaire pour exploiter un vrai événement (déclenché par la signature d'un contrat).
- **Lot 3 — Évolutions** : fonctions à valeur ajoutée pour les clients suivants.

---

## 1. Contexte et objectifs

### 1.1 Le besoin

Un organisateur de salon ou d'événement professionnel doit :

1. **savoir à tout moment combien de personnes sont dans la salle**, pour respecter la capacité maximale autorisée du lieu (jauge de sécurité) ;
2. **distinguer en permanence plusieurs typologies de participants** (par exemple visiteurs, exposants, magasins), à l'accueil comme dans les chiffres ;
3. **recueillir les inscriptions** des participants et leur remettre un justificatif d'accès ;
4. **fournir des statistiques** après l'événement (fréquentation, profils, affluence), notamment pour vendre l'édition suivante aux exposants.

### 1.2 La réponse

Une application web, utilisable sur ordinateur, tablette et téléphone, qui :

- gère les inscriptions et délivre à chaque participant un **QR code personnel** ;
- permet à des **agents d'accueil** d'enregistrer les **entrées et les sorties** en scannant ce QR code ;
- affiche **en temps réel** la présence dans la salle par rapport à la jauge ;
- produit des **statistiques et des exports**.

### 1.3 Objectifs mesurables

| Objectif | Cible |
|---|---|
| Temps d'enregistrement d'un passage au scan | moins de 2 secondes, retour visuel compris |
| Délai d'affichage d'un passage sur les autres postes | moins de 3 secondes en ligne |
| Continuité de service en cas de coupure réseau | les scans continuent sans interruption (lot 2) |
| Écart de comptage en fin de journée | zéro écart entre le journal des passages et le nombre de présents |

---

## 2. Glossaire

| Terme | Définition |
|---|---|
| **Organisation** | L'entité cliente (société, association, collectivité) qui organise des événements. |
| **Événement** | Une manifestation, sur un ou plusieurs jours, avec sa liste de participants et sa jauge. |
| **Participant** | Une personne inscrite à un événement, titulaire d'un QR code. Appelé aussi « inscrit ». |
| **Type de participant** | Typologie fixée pour l'événement (ex. Visiteur, Exposant, Magasin), associée à une couleur. |
| **Passage** | L'enregistrement d'une entrée ou d'une sortie d'un participant, horodaté. |
| **Présent** | Participant dont le dernier passage est une entrée. |
| **Jauge** | Nombre maximal de personnes présentes simultanément autorisé dans le lieu. |
| **Poste de scan** | Un appareil (téléphone, tablette, ordinateur avec douchette) utilisé par un agent pour enregistrer les passages. |
| **Mode du poste** | Entrée ou Sortie : sens des passages enregistrés par ce poste. |
| **Jeton** | Identifiant secret et aléatoire contenu dans le QR code d'un participant. |
| **Bilan** | Synthèse chiffrée et anonyme d'un événement, conservée après suppression des données personnelles. |

---

## 3. Utilisateurs et rôles

| Rôle | Qui | Accès |
|---|---|---|
| **Propriétaire** | Le responsable de l'organisation cliente | Tout, y compris la gestion des membres, la suppression d'événements et les paramètres RGPD |
| **Administrateur** | Membre de l'équipe d'organisation | Gestion des événements, des participants, des statistiques ; pas de suppression d'organisation |
| **Agent d'accueil** | Personne au scan le jour J | Scan, recherche d'un participant, consultation de la jauge ; **pas d'export ni de modification en masse** |
| **Participant** | Le public | Formulaire d'inscription, sa propre page d'accès avec son QR code ; aucun autre accès |
| **Éditeur** | Le développeur et exploitant de la plateforme | Administration technique de la plateforme ; n'accède aux données des clients que pour le support, sur demande |

**F-01** (lot 1) — Un utilisateur se connecte avec son adresse email et un mot de passe.
**F-02** (lot 1) — Un utilisateur peut appartenir à plusieurs organisations, avec un rôle par organisation.
**F-03** (lot 2) — Le propriétaire invite des membres par email et leur attribue un rôle ; il peut retirer un membre à tout moment, ce qui lui retire immédiatement l'accès.
**F-04** (lot 2) — Un agent d'accueil peut rejoindre un événement précis à l'aide d'un **code d'accès** communiqué par l'organisateur, sans voir les autres événements de l'organisation. L'organisateur peut désactiver ce code.
**F-05** (lot 3) — Double authentification facultative pour les propriétaires et administrateurs.

---

## 4. Exigences fonctionnelles

### 4.1 Événements

**F-10** (lot 1) — Créer un événement : nom, dates de début et de fin (un ou plusieurs jours), lieu (texte libre), jauge.
**F-11** (lot 1) — La **jauge** est un nombre entier modifiable à tout moment par un administrateur ; valeur proposée par défaut : 1 000.
**F-12** (lot 1) — Chaque événement définit ses **types de participants** : par défaut trois types (Visiteur, Exposant, Magasin), chacun avec un libellé et une couleur. L'administrateur peut renommer les types, en ajouter (dix au plus) et changer leurs couleurs parmi une palette prédéfinie.
**F-13** (lot 1) — La palette proposée garantit que les couleurs restent distinguables entre elles, y compris pour les personnes daltoniennes, et lisibles sur fond blanc. Un type n'est **jamais signalé par sa couleur seule** : son libellé l'accompagne partout.
**F-14** (lot 2) — Personnalisation visuelle de l'événement : logo et couleur principale de l'organisateur, appliqués au formulaire d'inscription et à la page participant. Le contraste des textes est vérifié automatiquement ; une couleur qui ne permet pas une lecture suffisante est refusée ou ajustée.
**F-15** (lot 1) — Dupliquer un événement (paramètres, types, champs du formulaire) sans ses participants, pour préparer l'édition suivante.
**F-16** (lot 1) — Supprimer un événement (propriétaire uniquement) : toutes ses données personnelles sont effacées ; son bilan anonyme est conservé (voir 4.8).

### 4.2 Participants

**F-20** (lot 1) — Un participant est défini par : nom, prénom, email, téléphone (facultatif), société ou enseigne (facultatif), type, et les réponses aux champs personnalisés du formulaire (lot 2).
**F-21** (lot 1) — Ajouter un participant à la main.
**F-22** (lot 1) — Importer une liste depuis un fichier CSV ou un copier-coller depuis un tableur :
- séparateur détecté automatiquement (point-virgule, virgule, tabulation) ;
- colonnes reconnues par leur en-tête (nom, prénom, email, téléphone, société, type) ;
- le type est reconnu par son libellé, sans tenir compte des majuscules ni du pluriel ; à défaut, le premier type de l'événement est appliqué ;
- un **aperçu** avant validation indique le nombre de lignes, les lignes ignorées et pourquoi ;
- un email déjà présent dans l'événement est signalé comme doublon et n'est pas réimporté.
**F-23** (lot 1) — Modifier un participant (y compris son type) et le supprimer.
**F-24** (lot 1) — Rechercher un participant par nom, email ou société ; filtrer par type et par statut (jamais venu, présent, sorti).
**F-25** (lot 1) — Chaque participant reçoit à sa création un **jeton** aléatoire d'au moins 128 bits, impossible à deviner, unique sur toute la plateforme. Le QR code contient uniquement ce jeton, aucune donnée personnelle.
**F-26** (lot 2) — Régénérer le jeton d'un participant (QR code perdu ou partagé) : l'ancien QR code est immédiatement refusé.

### 4.3 Formulaire d'inscription public

**F-30** (lot 1) — Chaque événement dispose d'un **lien d'inscription public** et du QR code correspondant, à imprimer sur une affiche ou à diffuser.
**F-31** (lot 1) — L'administrateur ouvre et ferme les inscriptions ; formulaire fermé = message explicite, aucune inscription possible.
**F-32** (lot 1) — Le formulaire demande : type (choix parmi les types de l'événement, présentés avec leur couleur et leur libellé), nom, prénom, email, société ou enseigne, téléphone (facultatif), et une **case de consentement** obligatoire renvoyant vers la politique de confidentialité de l'événement.
**F-33** (lot 2) — Champs personnalisés par événement : texte court, liste de choix, case à cocher, nombre ; obligatoires ou non ; affichables pour certains types seulement (ex. « Nombre de points de vente » pour le type Magasin). Ces champs alimentent les statistiques (F-73).
**F-34** (lot 1) — Après validation, le participant voit **immédiatement sa page d'accès** avec son QR code et un message de confirmation l'invitant à la conserver.
**F-35** (lot 2) — Un **email de confirmation** contenant le lien vers la page d'accès et le QR code est envoyé automatiquement. L'organisateur peut renvoyer cet email à un participant ou à tous.
**F-36** (lot 2) — Protection contre les abus : limitation du nombre d'inscriptions par adresse réseau et par minute, champ piège invisible pour les robots, refus d'un email déjà inscrit à l'événement (le participant peut alors redemander son lien d'accès).
**F-37** (lot 2) — Option de **validation manuelle** : les inscriptions restent « en attente » jusqu'à acceptation par un administrateur ; le QR code n'est délivré qu'après acceptation.

### 4.4 Page d'accès du participant

**F-40** (lot 1) — Accessible uniquement via un lien contenant son jeton ; elle affiche le nom de l'événement, le nom du participant, son **type** (couleur et libellé), son QR code et la politique de confidentialité.
**F-41** (lot 1) — Le QR code reste affiché en permanence, y compris après la première entrée : il sert à **chaque entrée et chaque sortie**.
**F-42** (lot 1) — La page ne donne accès à aucune information sur les autres participants.
**F-43** (lot 2) — Ajout du billet à Apple Wallet et Google Wallet (lot 3 si non retenu au lot 2).

### 4.5 Scan des entrées et des sorties

**F-50** (lot 1) — L'agent choisit le **mode de son poste** : Entrée ou Sortie, par deux boutons très visibles. Le mode est mémorisé sur l'appareil et affiché en permanence pendant le scan.
**F-51** (lot 1) — Moyens d'identification :
- caméra de l'appareil (téléphone ou tablette) ;
- douchette USB ou Bluetooth : le champ de saisie reçoit le code et le valide automatiquement ;
- recherche par nom (participant sans téléphone) ;
- saisie manuelle de la référence.
**F-52** (lot 1) — Règles d'enregistrement d'un passage :

| Mode | Situation du participant | Résultat |
|---|---|---|
| Entrée | Jamais venu | **Entrée acceptée**, « première entrée » |
| Entrée | Sorti | **Entrée acceptée**, « retour » avec le numéro de l'entrée |
| Entrée | Déjà présent | **Refus** : « déjà dans la salle depuis HH:MM » ; la tentative est journalisée |
| Sortie | Présent | **Sortie acceptée** |
| Sortie | Absent ou jamais venu | **Avertissement** : « pas enregistré dans la salle — vérifiez le mode du poste » ; aucun passage enregistré |
| Les deux | Jeton inconnu ou révoqué | **Refus** : « QR code non reconnu » ; la tentative est journalisée |

**F-53** (lot 1) — L'enregistrement d'un passage est **atomique** : si deux postes scannent le même participant au même instant, un seul passage est enregistré, l'autre poste reçoit le refus approprié.
**F-54** (lot 1) — Retour à l'agent après chaque scan :
- un **bandeau aux couleurs du type** du participant, avec son libellé en grand (ex. « EXPOSANT ») ;
- le résultat en clair (accepté, refusé, avertissement) avec un pictogramme, jamais par la couleur seule ;
- le nom et la société du participant ;
- un **signal sonore et une vibration** différents selon le résultat (lot 2).
**F-55** (lot 1) — Une relecture du même QR code par la caméra dans les 10 secondes est ignorée (le participant est encore devant l'objectif).
**F-56** (lot 1) — La présence actuelle et la jauge sont affichées en permanence sur l'écran de scan.
**F-57** (lot 1) — **Jauge atteinte** : l'entrée reste enregistrée mais l'agent voit une alerte bloquante à acquitter. Option d'événement (lot 2) : **refuser les entrées** tant que la présence est au niveau de la jauge.
**F-58** (lot 1) — Chaque passage enregistre : participant, type, sens, date et heure, agent, poste, moyen d'identification. Le journal des passages ne peut être ni modifié ni supprimé passage par passage.
**F-59** (lot 1) — **Clôture de journée** : un administrateur enregistre en une fois la sortie de toutes les personnes encore comptées comme présentes, pour repartir de zéro le lendemain. Ces sorties sont marquées « clôture » dans le journal.

### 4.6 Mode hors-ligne (lot 2)

Le réseau d'un lieu accueillant plus de 1 000 personnes est souvent saturé. Le scan doit continuer sans réseau.

**F-60** (lot 2) — Avant l'ouverture, chaque poste télécharge la liste des participants de l'événement (jetons, noms, sociétés, types, statut de présence). Cette copie locale est chiffrée sur l'appareil et effacée à la fin de l'événement ou à la déconnexion.
**F-61** (lot 2) — Hors ligne, les passages sont validés sur l'appareil à partir de cette copie, enregistrés localement, puis envoyés au serveur dès le retour du réseau, dans l'ordre et avec leur heure réelle.
**F-62** (lot 2) — Un indicateur permanent montre l'état du poste : en ligne, hors ligne, nombre de passages en attente d'envoi.
**F-63** (lot 2) — Hors ligne, deux postes ne peuvent pas se coordonner : un même participant peut être accepté deux fois. À la synchronisation, ces cas sont **détectés, signalés** dans le tableau de bord et corrigés dans le comptage (le second passage est conservé dans le journal mais marqué « doublon hors ligne »).
**F-64** (lot 2) — Hors ligne, la présence affichée sur un poste n'est qu'une estimation (ses propres passages) ; l'écran l'indique clairement.

### 4.7 Fréquentation en temps réel

**F-65** (lot 1) — Un écran « Direct » affiche, mis à jour en temps réel :
- le **nombre de personnes présentes** et la jauge, avec le pourcentage ;
- un niveau d'alerte : normal (moins de 80 %), attention (80 à 95 %), critique (95 % et plus), dépassement (plus de 100 %), chacun avec couleur, pictogramme et texte ;
- **par type** : présents, entrées et sorties du jour, nombre de participants venus sur nombre d'inscrits, nombre de sociétés distinctes ;
- pour la journée en cours : entrées, sorties, **visiteurs différents**, pic de présence et son heure ;
- la **courbe de présence** de la journée par quart d'heure ;
- un tableau **par journée** pour les événements sur plusieurs jours ;
- les derniers passages (sens, nom, type, heure).
**F-66** (lot 1) — Mode **plein écran** lisible à distance, pour un grand écran à l'accueil ou au PC sécurité.
**F-67** (lot 2) — Alertes actives : notification sur les postes de l'équipe quand un seuil de jauge est franchi.
**F-68** (lot 1) — Les seuils d'alerte (80 % et 95 % par défaut) sont modifiables par événement (lot 2).

### 4.8 Statistiques, exports et bilan

**F-70** (lot 1) — Synthèse : inscrits, venus, jamais venus, taux de présence, par type et au total.
**F-71** (lot 2) — Affluence : arrivées par quart d'heure, première et dernière arrivée, heure à laquelle 50 % et 90 % des participants étaient arrivés, pic de présence ; par jour.
**F-72** (lot 2) — Comportement : durée moyenne de présence, nombre moyen d'entrées par participant, répartition des sorties par heure.
**F-73** (lot 2) — Profils : répartition par type, nombre de **sociétés ou enseignes distinctes** par type (ex. « 42 magasins représentés »), répartition des réponses aux champs personnalisés.
**F-74** (lot 2) — Contrôle : passages par agent et par poste, moyens d'identification utilisés, tentatives refusées (QR inconnus, déjà présents), doublons hors ligne.
**F-75** (lot 1) — Exports :
- **Excel** multi-onglets : synthèse, affluence, par type, participants (avec statut et nombre d'entrées), journal des passages, tentatives refusées ;
- **CSV** par liste (présents, jamais venus, journal) ;
- **bilan PDF** d'une page, **sans aucune donnée personnelle**, prêt à diffuser.
Les exports ne doivent jamais permettre l'exécution de formules dans un tableur.
**F-76** (lot 1) — Les exports sont réservés aux propriétaires et administrateurs.
**F-77** (lot 2) — **Bilan anonyme** : à la clôture de l'événement et avant toute suppression de données, un bilan chiffré sans donnée personnelle est enregistré et conservé sans limite de durée.
**F-78** (lot 3) — **Historique** : comparaison des bilans des événements d'une organisation (taux de présence, affluence, répartition par type), avec export Excel.

### 4.9 Fonctions des lots suivants (lot 3)

**F-80** — Impression de **badges** à l'arrivée (nom, société, type en couleur) sur imprimante d'étiquettes.
**F-81** — **Scan de contacts par les exposants** : un exposant scanne le badge d'un visiteur sur son stand et récupère ses coordonnées, avec le consentement du visiteur ; option payante par exposant.
**F-82** — Organisation multi-événements avec abonnement et facturation en ligne.
**F-83** — Envoi de SMS (rappel, lien d'accès).

---

## 5. Règles de gestion

| Réf. | Règle |
|---|---|
| **RG-01** | La présence d'un participant est déterminée par son **dernier passage** : entrée = présent, sortie ou aucun passage = absent. |
| **RG-02** | Le nombre de présents est la somme des participants présents. Il doit toujours être égal au résultat du rejeu du journal des passages ; un contrôle de cohérence le vérifie. |
| **RG-03** | Un « visiteur différent » d'une journée est un participant ayant au moins une entrée ce jour-là. |
| **RG-04** | Le pic de présence est la valeur maximale atteinte par le nombre de présents, calculée en rejouant le journal. |
| **RG-05** | Une journée commence à 00:00 heure de Paris. Les participants encore présents à minuit restent présents (d'où la clôture de journée, F-59). |
| **RG-06** | Un jeton révoqué (F-26) est traité comme inconnu. |
| **RG-07** | Le type d'un participant peut être modifié ; les passages déjà enregistrés conservent le type en vigueur au moment du passage. |
| **RG-08** | La suppression d'un participant supprime ses passages ; les statistiques déjà exportées ne sont pas modifiées. |
| **RG-09** | Toute action sur des données personnelles en masse (import, export, suppression) est tracée : qui, quand, combien de lignes. |

---

## 6. Exigences non fonctionnelles

### 6.1 Volumétrie et performance

**NF-01** — Dimensionnement de référence : 5 000 participants et 10 postes de scan simultanés par événement ; 20 événements actifs en même temps sur la plateforme.
**NF-02** — Premier client : 1 100 participants, 2 postes, 2 jours, pic estimé de 400 arrivées en 30 minutes.
**NF-03** — Temps de réponse d'un scan en ligne : moins de 1 seconde au serveur ; hors ligne : moins de 300 millisecondes.
**NF-04** — Propagation d'un passage vers les autres postes et l'écran Direct : moins de 3 secondes.
**NF-05** — Un test de charge simulant le pic du premier client est réalisé avant l'événement.

### 6.2 Disponibilité et continuité

**NF-10** — Disponibilité visée pendant les jours d'événement : 99,9 %. Hors événement : meilleur effort.
**NF-11** — Sauvegarde quotidienne de la base, conservée 30 jours, restauration testée avant chaque événement client.
**NF-12** — **Procédure de secours** documentée et remise au client : export la veille de la liste des participants en PDF et CSV, pointage papier, ressaisie après coup.
**NF-13** — Supervision : alerte à l'éditeur si le service ne répond plus pendant un événement.

### 6.3 Sécurité

**NF-20** — Toutes les règles d'accès sont appliquées **par le serveur** ; l'interface ne fait que les refléter.
**NF-21** — Communications chiffrées (HTTPS uniquement), en-têtes de sécurité (politique de contenu, interdiction d'intégration dans une autre page, etc.).
**NF-22** — Mots de passe stockés de façon irréversible ; limitation des tentatives de connexion.
**NF-23** — Le journal des passages et celui des refus sont en ajout seul.
**NF-24** — Aucune liste de participants n'est accessible sans être membre de l'événement ; la page participant n'expose que les données de son titulaire.
**NF-25** — Dépendances logicielles surveillées ; mise à jour de sécurité sous 30 jours (sous 7 jours si critique).
**NF-26** — Tests automatisés des règles d'accès, exécutés à chaque modification.

### 6.4 Protection des données (RGPD)

**NF-30** — **Hébergement en France**, chez un hébergeur de droit européen. Aucun transfert de données personnelles hors de l'Union européenne, y compris pour l'envoi des emails et les polices de caractères.
**NF-31** — Répartition des rôles : le client est **responsable de traitement**, l'éditeur est **sous-traitant** (contrat article 28 signé avec chaque client).
**NF-32** — Politique de confidentialité **par événement**, renseignée par l'organisateur (identité du responsable, contact du DPO, base légale, durée de conservation), affichée sur le formulaire et la page participant.
**NF-33** — **Purge automatique** des données personnelles d'un événement au terme de la durée de conservation choisie (par défaut 3 mois après la fin de l'événement), précédée d'un rappel à l'organisateur 15 jours avant ; le bilan anonyme est conservé.
**NF-34** — Droits des personnes : l'organisateur peut exporter et effacer les données d'un participant à sa demande.
**NF-35** — Aucun traceur ni outil de mesure d'audience tiers.
**NF-36** — Registre des traitements et liste des sous-traitants ultérieurs (hébergeur, service d'emails) tenus à jour et communicables au client.

### 6.5 Accessibilité

**NF-40** — Conformité visée **RGAA 4.1, niveau AA**, pour le formulaire d'inscription et la page participant (publics) comme pour l'application des organisateurs.
**NF-41** — Points d'attention : contrastes, navigation au clavier, focus visible, étiquettes de champs, annonces des résultats de scan aux lecteurs d'écran, information jamais portée par la couleur seule, respect de la préférence « réduire les animations ».
**NF-42** — Audit d'accessibilité avant la mise en production du lot 2.

### 6.6 Compatibilité

**NF-50** — Navigateurs : versions récentes de Chrome, Edge, Firefox, Safari ; Android 10 et plus, iOS 15 et plus.
**NF-51** — Application installable sur l'écran d'accueil (application web progressive).
**NF-52** — Interface en français ; textes regroupés pour permettre une traduction ultérieure (anglais au lot 3).

---

## 7. Données manipulées

Description fonctionnelle, sans préjuger de l'implémentation.

| Entité | Informations principales |
|---|---|
| **Organisation** | nom, membres et rôles, paramètres RGPD par défaut |
| **Utilisateur** | email, nom, mot de passe (protégé), organisations |
| **Événement** | nom, dates, lieu, jauge, seuils d'alerte, types, champs personnalisés, apparence, état des inscriptions, code d'accès agents, durée de conservation, politique de confidentialité |
| **Type de participant** | libellé, couleur, ordre |
| **Participant** | identité, coordonnées, société, type, réponses aux champs personnalisés, jeton, origine (import, saisie, formulaire), consentement (date), statut (en attente, accepté), présence actuelle, nombre d'entrées, dates de première et dernière entrée |
| **Passage** | participant, type au moment du passage, sens, date et heure, agent, poste, moyen d'identification, origine (en ligne, hors ligne, clôture), marqueur de doublon |
| **Tentative refusée** | motif, date et heure, agent, poste, participant concerné le cas échéant, début du code lu |
| **Bilan** | chiffres agrégés de l'événement, sans donnée personnelle |
| **Trace d'action** | auteur, action, date, volume concerné |

---

## 8. Choix techniques retenus

| Domaine | Choix | Raison |
|---|---|---|
| Interface | Application web progressive (React) | un seul développement pour ordinateur, tablette et téléphone ; installable |
| Serveur et base de données | PocketBase, hébergé en France | comptes, temps réel et règles d'accès intégrés ; un seul service à exploiter ; sauvegarde simple |
| Opérations sensibles (scan, clôture, purge) | Traitements côté serveur | atomicité et contrôle des règles de gestion |
| Hors ligne | Copie locale chiffrée et file d'envoi | continuité du scan sans réseau (F-60 à F-64) |
| Emails | Prestataire européen (ex. Brevo) | conformité NF-30 |
| Hébergeur | À choisir : OVHcloud, Scaleway, Clever Cloud ou Scalingo | droit européen, datacentres en France |

---

## 9. Hors périmètre de la version 1

- Billetterie payante et paiement en ligne.
- Gestion des stands, du plan du salon et de la logistique exposants.
- Application mobile native (le web progressif suffit).
- Contrôle d'accès matériel (tourniquets, portiques).
- Reconnaissance faciale ou toute donnée biométrique.

---

## 10. Livraison et recette

### 10.1 Contenu des lots

| Lot | Contenu | Déclencheur |
|---|---|---|
| **1 — Démonstration** | F-01, F-02, F-10 à F-13, F-15, F-16, F-20 à F-25, F-30 à F-32, F-34, F-40 à F-42, F-50 à F-59, F-65, F-66, F-70, F-75, F-76 | immédiat |
| **2 — Production** | F-03, F-04, F-14, F-26, F-33, F-35 à F-37, F-60 à F-64, F-67, F-68, F-71 à F-74, F-77, NF-30 à NF-36, NF-42 | signature du contrat |
| **3 — Évolutions** | F-05, F-43, F-78, F-80 à F-83 | selon la demande |

### 10.2 Recette du premier client

Avant l'événement de mars 2027 :

1. **Recette fonctionnelle** avec l'organisateur, sur un événement de test, scénario par scénario (inscription, import, scan entrée et sortie, jauge, statistiques, exports).
2. **Test de charge** : 1 100 participants, 2 postes, 400 arrivées simulées en 30 minutes, sans erreur ni écart de comptage.
3. **Test hors ligne** : coupure du réseau pendant 15 minutes sur les deux postes, puis synchronisation ; vérification des doublons signalés et du comptage final.
4. **Répétition sur site** si possible, avec les téléphones et le réseau réels.
5. **Remise de la procédure de secours** (NF-12).

---

## 11. Questions ouvertes pour le client

| # | Question | Impact |
|---|---|---|
| Q1 | Libellés définitifs des trois types de participants ? | F-12 |
| Q2 | La jauge de 1 100 est-elle une présence simultanée maximale ? Faut-il **refuser** les entrées une fois atteinte ? | F-57 |
| Q3 | Les sorties sont-elles systématiquement scannées, ou seulement en fin de journée ? | F-52, F-59 |
| Q4 | Inscription uniquement à l'avance, ou aussi sur place le jour J ? | F-30, F-21 |
| Q5 | Champs du formulaire et liste précise des statistiques attendues (ex. définition d'un « magasin ») ? | F-33, F-73 |
| Q6 | Validation automatique ou manuelle des inscriptions ? | F-37 |
| Q7 | Réseau sur place (Wi-Fi dédié, 4G) et horaires des deux journées ? | F-60 à F-64, NF-02 |
| Q8 | Charte : codes couleur, logo ? | F-14 |
| Q9 | Durée de conservation des données souhaitée et contact du DPO ? | NF-32, NF-33 |
| Q10 | Badges imprimés à l'arrivée attendus ? | F-80 |

---

## Historique du document

| Version | Date | Modification |
|---|---|---|
| 1.0 | 9 octobre 2026 | Création |
