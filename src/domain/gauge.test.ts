import { gaugeAlert, gaugeLevel, type GaugeLevel } from './gauge';

describe('alertes de jauge (F-67)', () => {
  /** Rejoue une suite de niveaux et renvoie les alertes émises. */
  const run = (levels: GaugeLevel[], start: GaugeLevel = 'normal') => {
    let alerted = start;
    return levels.map((l) => { const r = gaugeAlert(alerted, l); alerted = r.alerted; return r.alert; });
  };

  it('prévient à chaque niveau franchi en montant', () => {
    expect(run(['normal', 'attention', 'critical', 'over'])).toEqual([null, 'attention', 'critical', 'over']);
  });

  it("ne répète pas l'alerte quand la présence oscille autour d'un seuil", () => {
    expect(run(['attention', 'critical', 'attention', 'critical', 'attention'])).toEqual(['attention', 'critical', null, null, null]);
  });

  it('après un retour à la normale, le seuil est de nouveau signalé', () => {
    expect(run(['attention', 'normal', 'attention'])).toEqual(['attention', null, 'attention']);
  });

  it("à l'ouverture de l'écran, le niveau déjà atteint n'est pas signalé", () => {
    expect(run(['critical', 'critical', 'over'], 'critical')).toEqual([null, null, 'over']);
  });

  it('niveaux selon les seuils de l\'événement (F-68)', () => {
    expect(gaugeLevel(79, 100)).toBe('normal');
    expect(gaugeLevel(80, 100)).toBe('attention');
    expect(gaugeLevel(70, 100, { warn: 0.7, critical: 0.9 })).toBe('attention');
    expect(gaugeLevel(101, 100)).toBe('over');
  });
});
