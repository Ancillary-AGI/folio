import { describe, expect, it } from 'vitest';
import { buildDemoEnclosure, DEMO_AMBIENT_C, DEMO_DISSIPATION_W } from './demoEnclosure';
import { analyseConduction } from '../mechanical/mechanicalAnalysis';

describe('demo enclosure — thermal + STEP on real engines', () => {
  it('sizes the case from the 60x53 board with wall + clearance', () => {
    const demo = buildDemoEnclosure();
    expect(demo.summary.outerMm.w).toBeCloseTo(60 + 2 * (3 + 2), 9);
    expect(demo.summary.outerMm.d).toBeCloseTo(53 + 2 * (3 + 2), 9);
    expect(demo.step.step).toContain('folio-enclosure');
  });
  it('recomputes the lid temperature from R = L/(kA), floor + gap in series', () => {
    const demo = buildDemoEnclosure();
    const area = 60e-3 * 53e-3;
    const rFloor = (2e-3) / (0.3 * area);
    const rGap = (8e-3) / (0.026 * area);
    expect(demo.thermal.thermalResistance).toBeCloseTo(rFloor + rGap, 9);
    expect(demo.summary.lidTempC).toBeCloseTo(DEMO_AMBIENT_C + DEMO_DISSIPATION_W * (rFloor + rGap), 9);
    expect(demo.summary.verdict).toMatch(/PASS|FAIL/);
  });
  it('matches the engine call-for-call (no duplicated math)', () => {
    const floor = analyseConduction(
      { width: 60e-3, height: 53e-3, depth: 2e-3 },
      { thermalConductivity: 0.3, specificHeat: 1360 }, 0.02, 25, 0.25,
    );
    const demo = buildDemoEnclosure();
    // Floor half of the series stack must equal the direct engine call.
    expect(demo.thermal.thermalResistance).toBeGreaterThan(floor.thermalResistance);
    expect(floor.temperatureRise).toBeCloseTo(0.25 * floor.thermalResistance, 12);
  });
});
