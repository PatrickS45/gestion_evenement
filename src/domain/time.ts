// Les journées et heures affichées suivent l'heure de Paris, quel que soit le fuseau de l'appareil (RG-05).
// Le jour calendaire est calculé sans Intl : ce module sert aussi au serveur (hooks PocketBase, sans Intl),
// pour le bilan anonyme établi avant la purge (F-77). Les formats d'affichage, eux, utilisent Intl.

const TIME_ZONE = 'Europe/Paris';
const HOUR_MS = 3_600_000;

let formats: { time: Intl.DateTimeFormat; date: Intl.DateTimeFormat } | null = null;
const intl = () => (formats ??= {
  time: new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit' }),
  date: new Intl.DateTimeFormat('fr-FR', { timeZone: TIME_ZONE, weekday: 'short', day: '2-digit', month: '2-digit' }),
});

/** Dernier dimanche d'un mois, à 01:00 temps universel : changement d'heure européen. */
function lastSundayAt1Utc(year: number, month: number): number {
  const last = new Date(Date.UTC(year, month + 1, 0, 1));
  return last.getTime() - last.getUTCDay() * 24 * HOUR_MS;
}

/** Décalage de l'heure de Paris sur le temps universel : +2 h en heure d'été, +1 h sinon (règle européenne). */
export function parisOffsetMs(t: number): number {
  const year = new Date(t).getUTCFullYear();
  return t >= lastSundayAt1Utc(year, 2) && t < lastSundayAt1Utc(year, 9) ? 2 * HOUR_MS : HOUR_MS;
}

export const QUARTER_MS = 15 * 60 * 1000;

export function toMs(t: number | string | Date): number {
  return typeof t === 'number' ? t : new Date(t).getTime();
}

/** Jour calendaire à Paris, au format AAAA-MM-JJ. */
export function parisDay(t: number | string | Date): string {
  const ms = toMs(t);
  return new Date(ms + parisOffsetMs(ms)).toISOString().slice(0, 10);
}

/** Heure à Paris, « 14:05 ». */
export function parisTime(t: number | string | Date): string {
  return intl().time.format(new Date(toMs(t)));
}

/** Date courte à Paris, « ven. 12/03 ». */
export function parisShortDate(t: number | string | Date): string {
  return intl().date.format(new Date(toMs(t)));
}

/**
 * Début du quart d'heure contenant t. Les décalages de Paris (UTC+1 / UTC+2)
 * étant des heures entières, l'arrondi en temps universel tombe juste.
 */
export function floorQuarter(t: number): number {
  return Math.floor(t / QUARTER_MS) * QUARTER_MS;
}
