import { contrastRatio, DEFAULT_TYPES, INK, nextTypeColor, TYPE_PALETTE, textOn, WHITE } from './colors';
import { newAccessCode, newToken } from './ids';
import { gaugeLevel } from './gauge';
import { parisDay, parisTime } from './time';

describe('couleurs', () => {
  it('calcule le contraste WCAG', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 0);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('choisit toujours un texte lisible sur chaque couleur de la palette', () => {
    for (const { hex } of TYPE_PALETTE) {
      expect(contrastRatio(hex, textOn(hex))).toBeGreaterThanOrEqual(3); // texte en gros caractères
    }
    expect(textOn('#1baf7a')).toBe(INK);   // turquoise clair : texte foncé
    expect(textOn('#4a3aa7')).toBe(WHITE); // violet foncé : texte blanc
  });

  it('propose une couleur pas encore utilisée', () => {
    expect(nextTypeColor(DEFAULT_TYPES)).toBe(TYPE_PALETTE[3].hex);
  });
});

describe('identifiants', () => {
  it('jeton de 160 bits, unique', () => {
    const tokens = new Set(Array.from({ length: 1000 }, newToken));
    expect(tokens.size).toBe(1000);
    for (const t of tokens) expect(t).toMatch(/^[0-9a-f]{40}$/);
  });

  it('code d\'accès lisible, sans caractères ambigus', () => {
    for (let i = 0; i < 200; i++) expect(newAccessCode()).toMatch(/^[A-HJKMNP-Z2-9]{8}$/);
  });
});

describe('jauge', () => {
  it('niveaux par défaut à 80 % et 95 %', () => {
    expect(gaugeLevel(799, 1000)).toBe('normal');
    expect(gaugeLevel(800, 1000)).toBe('attention');
    expect(gaugeLevel(950, 1000)).toBe('critical');
    expect(gaugeLevel(1000, 1000)).toBe('critical');
    expect(gaugeLevel(1001, 1000)).toBe('over');
    expect(gaugeLevel(5, 0)).toBe('normal');
  });
});

describe('heure de Paris', () => {
  it('formate en heure de Paris, été comme hiver', () => {
    expect(parisTime('2027-03-11T08:05:00Z')).toBe('09:05'); // hiver, UTC+1
    expect(parisTime('2027-07-11T08:05:00Z')).toBe('10:05'); // été, UTC+2
    expect(parisDay('2027-03-11T23:30:00Z')).toBe('2027-03-12');
  });
});
