import { describe, expect, it } from 'vitest';
import {
  STANDARD_PACKAGES,
  calculateBondWireParasitics,
  packageSiliconDie,
} from './chipPackaging';

describe('IC Packaging Co-Design & Bondwires', () => {
  it('calculates gold bondwire loop parasitics based on 3D geometry', () => {
    // 1 mm straight span with 0.25 mm loop height
    const res = calculateBondWireParasitics(0, 0, 1000, 0, 0.25);
    expect(res.wireLengthMm).toBeGreaterThan(1.0); // curve length > chord
    expect(res.inductanceNh).toBeGreaterThan(1.0); // ~1 nH/mm
    expect(res.resistanceOhms).toBeGreaterThan(0.05); // ~55 mOhm/mm
    expect(res.capacitancePf).toBeGreaterThan(0.1);
  });

  it('packages a silicon die into a QFN-32 package and generates STEP 3D models', () => {
    const diePads = [
      { index: 1, name: 'VDD', xUm: 0, yUm: 500 },
      { index: 2, name: 'VSS', xUm: 0, yUm: -500 },
      { index: 3, name: 'CLK', xUm: 500, yUm: 0 },
      { index: 4, name: 'DATA', xUm: -500, yUm: 0 },
    ];

    const chip = packageSiliconDie('qfn-32', 1500, 1500, diePads);

    expect(chip.packageSpec.family).toBe('QFN');
    expect(chip.bondWires.length).toBe(4);
    for (const bw of chip.bondWires) {
      expect(bw.parasitics.inductanceNh).toBeGreaterThan(0);
      expect(bw.parasitics.wireLengthMm).toBeGreaterThan(0);
    }
    expect(chip.stepModel).toContain('ISO-10303-21');
    expect(chip.stepModel).toContain('ADVANCED_FACE');
  });

  it('rejects oversized silicon die that exceeds package cavity limit', () => {
    const qfn32Spec = STANDARD_PACKAGES['qfn-32'];
    expect(qfn32Spec).toBeDefined();
    // Die width 4000 um exceeds max 3000 um
    expect(() => packageSiliconDie('qfn-32', 4000, 1500, [])).toThrow(/exceeds/);
  });
});
