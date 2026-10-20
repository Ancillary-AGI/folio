import { describe, expect, it } from 'vitest';
import {
  AWG_TABLE,
  calculateHarnessLoopDrop,
  copperResistanceAtTemp,
  getBundleDeratingFactor,
  recommendWireGauge,
} from './wireHarness';

describe('Wire Harness & AWG Engineering', () => {
  it('defines standard AWG parameters with strictly monotonic dimensions', () => {
    const gauges = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
    for (let i = 0; i < gauges.length - 1; i += 1) {
      const thicker = AWG_TABLE[gauges[i]];
      const thinner = AWG_TABLE[gauges[i + 1]];
      expect(thicker.diameterMm).toBeGreaterThan(thinner.diameterMm);
      expect(thicker.crossSectionMm2).toBeGreaterThan(thinner.crossSectionMm2);
      expect(thinner.dcResistanceOhmsPerKmAt20C).toBeGreaterThan(thicker.dcResistanceOhmsPerKmAt20C);
      expect(thicker.ampacityChassisA).toBeGreaterThan(thinner.ampacityChassisA);
    }
  });

  it('adjusts copper conductor resistance over temperature', () => {
    const r20 = 10.0; // 10 ohms at 20C
    const r80 = copperResistanceAtTemp(r20, 80);
    // delta_T = 60 C -> 10 * (1 + 0.00393 * 60) = 10 * 1.2358 = 12.358 ohms
    expect(r80).toBeCloseTo(12.358, 2);

    const r0 = copperResistanceAtTemp(r20, 0);
    expect(r0).toBeLessThan(r20);
  });

  it('applies bundle derating factors according to loaded conductor count', () => {
    expect(getBundleDeratingFactor(2)).toBe(1.0);
    expect(getBundleDeratingFactor(5)).toBe(0.8);
    expect(getBundleDeratingFactor(8)).toBe(0.7);
    expect(getBundleDeratingFactor(16)).toBe(0.5);
    expect(getBundleDeratingFactor(30)).toBe(0.4);
    expect(() => getBundleDeratingFactor(0)).toThrow(/least 1/);
  });

  it('calculates loop drop and warns when ampacity is exceeded', () => {
    // 5m one-way run (10m total loop) of AWG 24 carrying 3A on a 12V rail
    const drop = calculateHarnessLoopDrop(24, 5.0, 3.0, 12.0);
    expect(drop.resistanceOhms).toBeGreaterThan(0);
    expect(drop.voltageDropV).toBeGreaterThan(0);
    expect(drop.powerLossW).toBeGreaterThan(0);
    // AWG 24 bundle ampacity is 2.1A, so 3A exceeds safe bundle ampacity
    expect(drop.isAmpacityExceeded).toBe(true);
  });

  it('recommends an appropriate wire gauge for voltage drop and safety', () => {
    // 3A continuous on 12V over 3 meters with <= 2% allowed drop
    const { recommendedAwg, result } = recommendWireGauge(3.0, 3.0, 12.0, 2.0);
    expect(result.isAmpacityExceeded).toBe(false);
    expect(result.voltageDropPercent).toBeLessThanOrEqual(2.0);
    // Should choose a safe gauge like AWG 18 or AWG 16
    expect(recommendedAwg).toBeLessThanOrEqual(18);
  });
});
