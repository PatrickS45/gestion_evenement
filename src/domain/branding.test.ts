import { brandPalette, MIN_CONTRAST, mix, normalizeBranding, readableColor } from './branding';
import { contrastRatio, WHITE } from './colors';

describe('personnalisation visuelle (F-14)', () => {
  it('garde une couleur déjà lisible', () => {
    expect(readableColor('#1C2B4A')).toMatchObject({ color: '#1c2b4a', adjusted: false });
  });

  it("assombrit juste assez une couleur trop claire, en gardant sa teinte", () => {
    for (const light of ['#ffd400', '#7fdbff', '#ff8c00', '#ffffff', '#2a78d6']) {
      const r = readableColor(light);
      expect(r.contrast, light).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrastRatio(r.color, WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(r.adjusted, light).toBe(true);
      // juste assez : un cran plus clair ne suffirait pas
      expect(contrastRatio(mix(r.color, light, 0.05), WHITE), light).toBeLessThan(MIN_CONTRAST + 0.5);
    }
    // jaune vif : reste un jaune foncé (rouge et vert dominants)
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(readableColor('#ffd400').color.slice(i, i + 2), 16)) as [number, number, number];
    expect(r > b && g > b).toBe(true);
  });

  it('palette des pages publiques : bouton lisible, fond des messages clair', () => {
    const p = brandPalette({ color: '#ffd400', logo: null })!;
    expect(contrastRatio(p.accent, WHITE)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(contrastRatio(p.accent, p.accentSoft)).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(brandPalette({ color: null, logo: null })).toBeNull();
  });

  it('accepte une couleur et un logo d\'image matricielle ; refuse le reste', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo=';
    expect(normalizeBranding({ color: ' #FF8800 ', logo: png })).toEqual({ color: '#ff8800', logo: png });
    expect(normalizeBranding({ color: 'red', logo: 'data:image/svg+xml;base64,PHN2Zz4=' })).toEqual({ color: null, logo: null });
    expect(normalizeBranding({ logo: 'https://exemple.fr/logo.png' }).logo).toBeNull();
    expect(normalizeBranding({ logo: `data:image/png;base64,${'A'.repeat(200_000)}` }).logo).toBeNull();
    expect(normalizeBranding({ logo: null }, { color: '#112233', logo: png })).toEqual({ color: '#112233', logo: null });
  });
});
