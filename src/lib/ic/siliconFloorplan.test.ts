import { describe, expect, it } from 'vitest';
import { generateDieFloorplan } from './siliconFloorplan';

describe('Silicon Die Floorplanning & PDN', () => {
  it('generates a die floorplan with core sizing matching target utilization', () => {
    // 500 um2 cell area, target 50% utilization -> core area ~ 1000 um2
    const fp = generateDieFloorplan(
      'alu_core',
      500.0,
      {
        inputs: ['a', 'b', 'op[0]', 'op[1]'],
        outputs: ['res[0]', 'res[1]', 'zero'],
        clocks: ['clk'],
        resets: ['rst_n'],
      },
      { targetUtilizationPercent: 50 },
    );

    expect(fp.coreWidthUm).toBeGreaterThan(0);
    expect(fp.coreHeightUm).toBeGreaterThan(0);
    expect(fp.dieWidthUm).toBeGreaterThan(fp.coreWidthUm);
    expect(fp.dieHeightUm).toBeGreaterThan(fp.coreHeightUm);
    expect(fp.utilizationPercent).toBeLessThanOrEqual(55);
    expect(fp.rowCount).toBeGreaterThanOrEqual(4);
    expect(fp.ioPads.length).toBeGreaterThanOrEqual(9); // inputs + outputs + clk + rst + vdd + vss
    expect(fp.powerStripes.length).toBeGreaterThan(0);
    expect(fp.estimatedIrDropMv).toBeGreaterThanOrEqual(0);
  });

  it('rejects floorplan with invalid cell area', () => {
    expect(() => generateDieFloorplan('bad', 0, { inputs: [], outputs: [] })).toThrow(/positive/);
  });

  it('rejects options that would divide by zero or produce no die', () => {
    expect(() =>
      generateDieFloorplan('bad', 500, { inputs: [], outputs: [] }, { aspectRatio: 0 }),
    ).toThrow(/Aspect ratio/);
    expect(() =>
      generateDieFloorplan('bad', 500, { inputs: [], outputs: [] }, { targetUtilizationPercent: 0 }),
    ).toThrow(/utilization/);
    expect(() =>
      generateDieFloorplan('bad', 500, { inputs: [], outputs: [] }, { padPitchUm: Number.NaN }),
    ).toThrow(/Pad pitch/);
    expect(() =>
      generateDieFloorplan('bad', 500, { inputs: [], outputs: [] }, { coreToDieMarginUm: -1 }),
    ).toThrow(/margin/);
  });
});
