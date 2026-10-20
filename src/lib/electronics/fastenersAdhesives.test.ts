import { describe, expect, it } from 'vitest';
import {
  CONFORMAL_COATINGS,
  POTTING_COMPOUNDS,
  STANDARD_STANDOFFS,
  THREAD_PITCH_MM,
  TIM_LIBRARY,
  thermalResistanceKw,
} from './fastenersAdhesives';

describe('Fasteners & Adhesives physical modeling', () => {
  it('defines standard metric standoffs with keepouts and clearance holes', () => {
    expect(STANDARD_STANDOFFS.length).toBeGreaterThanOrEqual(4);
    for (const standoff of STANDARD_STANDOFFS) {
      expect(standoff.keepoutDiameterMm).toBeGreaterThan(standoff.outerDiameterMm);
      expect(standoff.recommendedHoleDiameterMm).toBeGreaterThan(Number(standoff.thread.replace('M', '')));
      expect(standoff.maxTorqueNm).toBeGreaterThan(0);
      expect(THREAD_PITCH_MM[standoff.thread]).toBeGreaterThan(0);
    }
  });

  it('calculates thermal resistance accurately from thickness, conductivity and area', () => {
    // 1mm thickness, 3.0 W/(m·K), 10mm x 10mm (100 mm2) area:
    // R_th = (1e-3 m) / (3.0 * 100e-6 m2) = 1e-3 / 3e-4 = 3.333 K/W
    const rth = thermalResistanceKw(3.0, 1.0, 100.0);
    expect(rth).toBeCloseTo(3.333, 2);

    // Doubling area halves thermal resistance
    const rthDoubleArea = thermalResistanceKw(3.0, 1.0, 200.0);
    expect(rthDoubleArea).toBeCloseTo(1.667, 2);

    expect(() => thermalResistanceKw(0, 1.0, 100.0)).toThrow(/positive/);
    expect(() => thermalResistanceKw(3.0, -1.0, 100.0)).toThrow(/positive/);
    expect(() => thermalResistanceKw(3.0, 1.0, 0)).toThrow(/positive/);
  });

  it('covers thermal interface materials with dielectric breakdown properties', () => {
    const pad = TIM_LIBRARY.find((t) => t.id === 'tim-pad-standard');
    expect(pad).toBeDefined();
    expect(pad?.conductivityWmk).toBe(3.0);
    expect(pad?.dielectricStrengthKvMm).toBeGreaterThan(0);

    const silver = TIM_LIBRARY.find((t) => t.id === 'tim-grease-silver');
    expect(silver?.dielectricStrengthKvMm).toBe(0); // silver paste is conductive
  });

  it('provides IPC-CC-830 conformal coatings with dielectric and environmental ratings', () => {
    expect(CONFORMAL_COATINGS.AR.reworkability).toBe('easy');
    expect(CONFORMAL_COATINGS.XY.ipcStandard).toContain('Type XY');
    expect(CONFORMAL_COATINGS.SR.tempRangeC[1]).toBe(200); // Silicone 200C
    expect(CONFORMAL_COATINGS.UR.dielectricStrengthVmil).toBeGreaterThan(3000);
  });

  it('provides industrial potting compounds for shock and moisture protection', () => {
    expect(POTTING_COMPOUNDS.length).toBeGreaterThanOrEqual(2);
    const pu = POTTING_COMPOUNDS.find((p) => p.baseChemistry === 'polyurethane');
    expect(pu?.shoreHardness).toContain('Shore A');
    const epoxy = POTTING_COMPOUNDS.find((p) => p.baseChemistry === 'epoxy');
    expect(epoxy?.shoreHardness).toContain('Shore D');
  });
});
