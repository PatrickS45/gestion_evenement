// Niveaux de jauge (F-65) : couleur, pictogramme et texte, jamais la couleur seule.
import type { GaugeThresholds } from './model';

export type GaugeLevel = 'normal' | 'attention' | 'critical' | 'over';

export const DEFAULT_THRESHOLDS: GaugeThresholds = { warn: 0.8, critical: 0.95 };

export function gaugeLevel(present: number, capacity: number, t: GaugeThresholds = DEFAULT_THRESHOLDS): GaugeLevel {
  if (capacity <= 0) return 'normal';
  const ratio = present / capacity;
  if (ratio > 1) return 'over';
  if (ratio >= t.critical) return 'critical';
  if (ratio >= t.warn) return 'attention';
  return 'normal';
}

export const GAUGE_LEVELS: Record<GaugeLevel, { label: string; icon: string; color: string; background: string }> = {
  normal:    { label: 'Fréquentation normale',          icon: '✓', color: '#0d6b3f', background: '#e8f5ee' },
  attention: { label: 'Attention : jauge bientôt atteinte', icon: '!', color: '#8a4b00', background: '#fdf3e1' },
  critical:  { label: 'Critique : filtrer les entrées',  icon: '⛔', color: '#a1161b', background: '#fdeaea' },
  over:      { label: 'Jauge dépassée',                  icon: '⛔', color: '#a1161b', background: '#fdeaea' },
};

/** Pourcentage de remplissage, plafonné à 100 pour l'affichage d'une barre. */
export function gaugePercent(present: number, capacity: number): number {
  if (capacity <= 0) return 0;
  return Math.round((present / capacity) * 100);
}
