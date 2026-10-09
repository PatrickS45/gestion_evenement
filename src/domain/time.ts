// Les journées et heures affichées suivent l'heure de Paris, quel que soit le fuseau de l'appareil (RG-05).

const TIME_ZONE = 'Europe/Paris';

const dayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
});
const timeFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit',
});
const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: '2-digit',
});

export const QUARTER_MS = 15 * 60 * 1000;

export function toMs(t: number | string | Date): number {
  return typeof t === 'number' ? t : new Date(t).getTime();
}

/** Jour calendaire à Paris, au format AAAA-MM-JJ. */
export function parisDay(t: number | string | Date): string {
  return dayFormat.format(new Date(toMs(t)));
}

/** Heure à Paris, « 14:05 ». */
export function parisTime(t: number | string | Date): string {
  return timeFormat.format(new Date(toMs(t)));
}

/** Date courte à Paris, « ven. 12/03 ». */
export function parisShortDate(t: number | string | Date): string {
  return dateFormat.format(new Date(toMs(t)));
}

/**
 * Début du quart d'heure contenant t. Les décalages de Paris (UTC+1 / UTC+2)
 * étant des heures entières, l'arrondi en temps universel tombe juste.
 */
export function floorQuarter(t: number): number {
  return Math.floor(t / QUARTER_MS) * QUARTER_MS;
}
