// Étapes de la visite guidée : un parcours de la démonstration, écran par écran, pour un prospect
// qui découvre l'application seul.

export type TourSection = 'home' | 'direct' | 'scan' | 'participants' | 'exports' | 'parametres';

export interface TourStep {
  section: TourSection;
  /** Élément mis en lumière (sélecteur CSS) ; aucun : fenêtre centrée. */
  target?: string;
  /** Mettre en lumière la carte qui contient l'élément plutôt que l'élément lui-même. */
  card?: boolean;
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    section: 'direct',
    title: 'Bienvenue dans Event Control',
    body: 'En quelques minutes, découvrez comment contrôler les entrées et les sorties d\'un salon, suivre la jauge en temps réel et obtenir vos statistiques. Un salon fictif de 1 100 inscrits, sur deux jours, a été chargé pour l\'exemple.',
  },
  {
    section: 'direct', target: '.live-hero',
    title: 'La jauge en temps réel',
    body: 'Le nombre de personnes présentes dans la salle, comparé à la capacité autorisée. À 80 % puis à 95 % de la jauge, une alerte s\'affiche sur tous les postes de l\'équipe, avec un son et une vibration.',
  },
  {
    section: 'direct', target: '.kpi-grid',
    title: 'La journée en un coup d\'œil',
    body: 'Entrées, sorties, visiteurs différents et pic de présence de la journée, mis à jour à chaque scan.',
  },
  {
    section: 'direct', target: '.type-grid',
    title: 'Vos typologies de participants',
    body: 'Visiteurs, exposants et magasins sont distingués en permanence : présents, venus, inscrits, et nombre de sociétés ou d\'enseignes représentées. Les types et leurs couleurs se règlent pour chaque événement.',
  },
  {
    section: 'direct', target: '.dash-bottom',
    title: 'Affluence et derniers passages',
    body: 'La courbe montre la présence par quart d\'heure ; le journal liste chaque entrée et chaque sortie, avec le type de la personne. Pratique pour renforcer l\'accueil au bon moment.',
  },
  {
    section: 'participants', target: '.people', card: true,
    title: 'Les inscrits',
    body: 'Importez votre liste depuis Excel (copier-coller ou fichier CSV), ajoutez une personne à la main, cherchez par nom ou par société, filtrez par type ou par statut : jamais venu, dans la salle, sorti.',
  },
  {
    section: 'participants', target: 'table.people button[aria-label^="QR"]',
    title: 'Un QR code par personne',
    body: 'Chaque inscrit reçoit un QR code personnel, sur une page d\'accès qu\'il garde sur son téléphone ou qu\'il imprime. Il le présente à chaque entrée et à chaque sortie. Ouvrez-en un pour le voir.',
  },
  {
    section: 'scan', target: '.scan-mode-row',
    title: 'Le poste de scan : entrée ou sortie',
    body: 'Chaque téléphone de l\'accueil se règle sur « Entrée » ou « Sortie ». Avec deux agents, l\'un enregistre les arrivées, l\'autre les départs : la présence dans la salle est toujours juste.',
  },
  {
    section: 'scan', target: '.viewfinder',
    title: 'Scanner un badge',
    body: 'La caméra du téléphone lit le QR code en une fraction de seconde. Le résultat s\'affiche en plein écran : vert si la personne entre, rouge si elle est déjà dans la salle ou inconnue, avec son type bien visible. Une douchette fonctionne aussi sur ordinateur.',
  },
  {
    section: 'scan', target: '.scan-actions',
    title: 'Sans QR code ? Par le nom',
    body: 'Une personne a oublié son badge : retrouvez-la par son nom ou sa société, puis enregistrez son entrée d\'un geste. Essayez : « Rechercher », tapez un nom, puis « Entrée ».',
  },
  {
    section: 'exports', target: '.page-head',
    title: 'Statistiques et exports',
    body: 'Bilan par type, par journée, affluence par quart d\'heure, durée moyenne de présence, contrôle par agent. Exportez un classeur Excel complet, ou un bilan PDF d\'une page sans aucune donnée personnelle, prêt à diffuser.',
  },
  {
    section: 'parametres', target: '#settings-title', card: true,
    title: 'Votre événement',
    body: 'Dates, lieu, jauge maximale et seuils d\'alerte, typologies et couleurs : tout se règle ici, et l\'événement se duplique pour l\'édition suivante.',
  },
  {
    section: 'parametres', target: '#reg-title', card: true,
    title: 'Les inscriptions en ligne',
    body: 'Un formulaire public, avec son QR code à imprimer sur une affiche : chaque visiteur s\'inscrit, choisit son profil et reçoit aussitôt son QR code. Questions personnalisées et validation manuelle possibles.',
  },
  {
    section: 'parametres', target: '#code-title', card: true,
    title: 'Vos agents d\'accueil',
    body: 'Un code d\'accès suffit à un agent pour rejoindre l\'événement depuis son téléphone : il ne voit que le scan et la jauge, rien d\'autre de votre organisation.',
  },
  {
    section: 'parametres', target: '#privacy-title', card: true,
    title: 'Le RGPD intégré',
    body: 'Responsable du traitement, base légale et durée de conservation affichés au public ; effacement automatique des données à l\'échéance, avec un bilan anonyme conservé. Hébergement en France en production.',
  },
  {
    section: 'direct',
    title: 'À vous de jouer',
    body: 'Scannez, ajoutez des inscrits, ouvrez le formulaire d\'inscription, réglez la jauge à 600 pour voir les alertes… Vous pouvez relancer cette visite à tout moment depuis votre menu, en haut à droite. Version de démonstration : vos essais restent sur cet appareil.',
  },
];
