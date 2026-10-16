// Texte du résultat plein écran après un scan (F-54) : un titre lisible à un mètre, un détail.
import type { Iso } from '../domain/model';
import type { ScanDecision } from '../domain/scan';
import type { Feedback } from './feedback';

export interface FlashText {
  tone: Feedback;
  title: string;
  detail: string;
}

export function flashText(decision: ScanDecision, formatTime: (iso: Iso) => string): FlashText {
  switch (decision.result) {
    case 'accepted':
      if (decision.direction === 'out') return { tone: 'accepted', title: 'Sortie enregistrée', detail: 'Au revoir et à bientôt' };
      return decision.firstEntry
        ? { tone: 'accepted', title: 'Bienvenue', detail: 'Première entrée' }
        : { tone: 'accepted', title: 'Bon retour', detail: `${decision.entryNumber}e entrée` };
    case 'refused':
      return decision.reason === 'unknown'
        ? { tone: 'refused', title: 'QR code non reconnu', detail: 'Ce badge ne correspond à aucun inscrit de l\'événement' }
        : { tone: 'refused', title: 'Déjà dans la salle', detail: decision.since ? `Entrée enregistrée à ${formatTime(decision.since)}` : 'Entrée déjà enregistrée' };
    case 'warning':
      return { tone: 'warning', title: 'Pas dans la salle', detail: 'Aucune entrée en cours : vérifiez le mode du poste' };
  }
}

/** Durée d'affichage : brève quand tout va bien, plus longue quand l'agent doit agir. */
export function flashDuration(tone: Feedback): number {
  return tone === 'accepted' ? 1800 : 4000;
}
