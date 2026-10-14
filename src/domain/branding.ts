// Personnalisation visuelle de l'événement (F-14) : couleur principale et logo de l'organisateur,
// appliqués au formulaire d'inscription et à la page participant. La couleur est ajustée si elle ne
// permet pas une lecture suffisante (WCAG 2.1 AA : 4,5:1 pour le texte blanc des boutons).
// Module exécuté aussi par le serveur (hooks PocketBase, sans Intl).
import { contrastRatio, WHITE } from './colors';

export interface Branding {
  /** Couleur choisie par l'organisateur (#rrggbb) ; null : couleurs de l'application. */
  color: string | null;
  /** Logo en image intégrée (PNG, JPEG ou WebP, réduite sur le poste) ; null : aucun. */
  logo: string | null;
}

export const NO_BRANDING: Branding = { color: null, logo: null };

/** Contraste minimal du texte blanc sur la couleur (boutons, bandeau). */
export const MIN_CONTRAST = 4.5;
/** Taille maximale du logo intégré, en caractères (environ 110 Ko d'image). */
export const LOGO_MAX_LENGTH = 150_000;
export const LOGO_MAX_WIDTH = 400;
export const LOGO_MAX_HEIGHT = 160;

const HEX = /^#[0-9a-f]{6}$/;
// Images matricielles seulement : un SVG peut contenir du script
const LOGO = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mélange de deux couleurs : `share` de `b` dans `a`. */
export function mix(a: string, b: string, share: number): string {
  const [ra, ga, ba] = rgb(a), [rb, gb, bb] = rgb(b);
  return `#${hex2(ra + (rb - ra) * share)}${hex2(ga + (gb - ga) * share)}${hex2(ba + (bb - ba) * share)}`;
}

/**
 * Couleur lisible : la couleur choisie si elle atteint le contraste requis avec `light` (texte blanc
 * sur la couleur, ou texte de la couleur sur ce fond clair), sinon la même teinte, assombrie juste assez.
 */
export function readableColor(hex: string, light: string = WHITE): { color: string; adjusted: boolean; contrast: number } {
  const base = hex.toLowerCase();
  if (contrastRatio(base, light) >= MIN_CONTRAST) return { color: base, adjusted: false, contrast: contrastRatio(base, light) };
  for (let step = 1; step <= 100; step++) {
    const darker = mix(base, '#000000', step / 100);
    if (contrastRatio(darker, light) >= MIN_CONTRAST) return { color: darker, adjusted: true, contrast: contrastRatio(darker, light) };
  }
  return { color: '#000000', adjusted: true, contrast: contrastRatio('#000000', light) };
}

/** Fond clair des messages d'information, dans la teinte de la couleur. */
const softOf = (hex: string) => mix(hex.toLowerCase(), WHITE, 0.92);

/** Couleur effectivement appliquée : lisible en texte blanc dessus comme en texte sur son fond clair. */
export function appliedColor(hex: string): { color: string; adjusted: boolean; contrast: number } {
  return readableColor(hex, softOf(hex));
}

/** Couleurs appliquées aux pages publiques ; null : celles de l'application. */
export function brandPalette(b: Branding): { accent: string; accentSoft: string; page: string } | null {
  if (!b.color) return null;
  return {
    accent: appliedColor(b.color).color,
    accentSoft: softOf(b.color),
    page: mix(appliedColor(b.color).color, '#000000', 0.35),
  };
}

/** Personnalisation reçue vérifiée ; les champs absents reprennent ceux de `base`. */
export function normalizeBranding(raw: unknown, base: Branding = NO_BRANDING): Branding {
  const r = (raw ?? {}) as Record<string, unknown>;
  const color = 'color' in r
    ? (typeof r.color === 'string' && HEX.test(r.color.trim().toLowerCase()) ? r.color.trim().toLowerCase() : null)
    : base.color;
  const logo = 'logo' in r
    ? (typeof r.logo === 'string' && r.logo.length <= LOGO_MAX_LENGTH && LOGO.test(r.logo) ? r.logo : null)
    : base.logo;
  return { color, logo };
}
