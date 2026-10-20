import { describe, expect, it } from 'vitest';
import {
  SKY130_CELLS,
  SKY130_PDK,
  calculateCellDelayPs,
} from './standardCellLibrary';

describe('Silicon Standard Cell Library (SkyWater 130nm HD)', () => {
  it('enforces SkyWater 130nm site pitch alignment on all cell widths', () => {
    expect(SKY130_PDK.standardCellHeightUm).toBe(2.72);
    expect(SKY130_PDK.sitePitchUm).toBe(0.46);

    for (const [, cell] of Object.entries(SKY130_CELLS)) {
      expect(cell.heightUm).toBe(SKY130_PDK.standardCellHeightUm);
      // Width must be an exact integer multiple of site pitch (0.46 um)
      const sites = Math.round(cell.widthUm / SKY130_PDK.sitePitchUm);
      expect(cell.widthUm).toBeCloseTo(sites * SKY130_PDK.sitePitchUm, 2);
      expect(cell.pins.length).toBeGreaterThan(0);
      expect(cell.intrinsicDelayPs).toBeGreaterThanOrEqual(0);
      expect(cell.driveResistanceOhms).toBeGreaterThan(0);
    }
  });

  it('calculates load-dependent RC propagation delay for standard cells', () => {
    const inv = SKY130_CELLS.INV;
    // Zero load delay = intrinsic delay (45 ps)
    expect(calculateCellDelayPs(inv, 0)).toBe(45);

    // 10 fF load capacitance:
    // rcDelay = 1200 ohms * 10 fF * 1e-3 = 12 ps
    // total = 45 + 12 = 57 ps
    const delay10fF = calculateCellDelayPs(inv, 10);
    expect(delay10fF).toBeCloseTo(57, 1);

    expect(() => calculateCellDelayPs(inv, -5)).toThrow(/non-negative/);
  });

  it('provides sequential storage elements (DFF) and balanced clock buffers', () => {
    const dff = SKY130_CELLS.DFF;
    expect(dff.kind).toBe('DFF');
    expect(dff.pins.some((p) => p.name === 'CLK')).toBe(true);
    expect(dff.pins.some((p) => p.name === 'D')).toBe(true);
    expect(dff.pins.some((p) => p.name === 'Q')).toBe(true);

    const clkbuf = SKY130_CELLS.CLKBUF;
    expect(clkbuf.driveResistanceOhms).toBeLessThan(SKY130_CELLS.INV.driveResistanceOhms); // Stronger drive
  });
});
