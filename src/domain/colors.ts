// Couleurs des types de participants (F-12, F-13) et contrôle de lisibilité.
import type { ParticipantType } from './model';

/**
 * Palette proposée, dans cet ordre. Les trois premières couleurs restent distinguables
 * entre elles même toutes affichées ensemble, y compris pour les personnes daltoniennes.
 * Au-delà, la distinction repose sur le libellé, toujours affiché avec la couleur.
 */
export const TYPE_PALETTE = [
  { name: 'Bleu',    hex: '#2a78d6' },
  { name: 'Orange',  hex: '#eb6834' },
  { name: 'Turquoise', hex: '#1baf7a' },
  { name: 'Jaune',   hex: '#eda100' },
  { name: 'Rose',    hex: '#e87ba4' },
  { name: 'Vert',    hex: '#008300' },
  { name: 'Violet',  hex: '#4a3aa7' },
  { name: 'Rouge',   hex: '#e34948' },
] as const;

export const MAX_TYPES = 10;

export const DEFAULT_TYPES: ParticipantType[] = [
  { id: 'visiteur', label: 'Visiteur', color: TYPE_PALETTE[0].hex },
  { id: 'exposant', label: 'Exposant', color: TYPE_PALETTE[1].hex },
  { id: 'magasin',  label: 'Magasin',  color: TYPE_PALETTE[2].hex },
];

export const INK = '#1c1d22';
export const WHITE = '#ffffff';

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function parseHex(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Couleur invalide : ${hex}`);
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Luminance relative WCAG 2.x. */
export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Rapport de contraste WCAG entre deux couleurs (1 à 21). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Texte à poser sur un fond coloré : blanc ou encre, selon ce qui contraste le mieux. */
export function textOn(background: string): string {
  return contrastRatio(background, WHITE) >= contrastRatio(background, INK) ? WHITE : INK;
}

/** Couleur suivante de la palette, non encore utilisée par les types existants. */
export function nextTypeColor(types: ParticipantType[]): string {
  const used = new Set(types.map((t) => t.color.toLowerCase()));
  return (TYPE_PALETTE.find((c) => !used.has(c.hex)) ?? TYPE_PALETTE[types.length % TYPE_PALETTE.length]!).hex;
}
