import { describe, expect, it } from 'vitest';
import {
  MONTE_CARLO_WGSL,
  runAcceleratedMonteCarlo,
} from './gpuMonteCarlo';

describe('Hardware-Accelerated Monte Carlo Engine', () => {
  it('contains valid WGSL compute shader code targeting WebGPU workgroups', () => {
    expect(MONTE_CARLO_WGSL).toContain('@compute');
    expect(MONTE_CARLO_WGSL).toContain('@workgroup_size(64)');
    expect(MONTE_CARLO_WGSL).toContain('outputVout');
  });

  it('runs 10,000 voltage divider iterations and derives Gaussian moments and 3-sigma yield', async () => {
    // 10V divider with R1 = 10k (+-5%), R2 = 10k (+-5%)
    // Nominal Vout = 5.0V
    const stats = await runAcceleratedMonteCarlo({
      iterations: 10000,
      parameters: [
        { name: 'R1', nominal: 10000, tolerancePercent: 5.0, distribution: 'gaussian' },
        { name: 'R2', nominal: 10000, tolerancePercent: 5.0, distribution: 'gaussian' },
      ],
      evaluateNode: (p) => 10.0 * (p.R2 / (p.R1 + p.R2)),
    });

    expect(stats.iterations).toBe(10000);
    expect(stats.mean).toBeCloseTo(5.0, 1);
    expect(stats.min).toBeLessThan(5.0);
    expect(stats.max).toBeGreaterThan(5.0);
    expect(stats.stdDev).toBeGreaterThan(0);
    // 3-sigma yield for Gaussian distribution should be >= 99%
    expect(stats.yield3SigmaPercent).toBeGreaterThanOrEqual(99.0);
    expect(stats.samples.length).toBe(10000);
  });

  it('handles uniform distribution bounds accurately', async () => {
    const stats = await runAcceleratedMonteCarlo({
      iterations: 2000,
      parameters: [{ name: 'V', nominal: 5.0, tolerancePercent: 10.0, distribution: 'uniform' }],
      evaluateNode: (p) => p.V,
    });

    expect(stats.min).toBeGreaterThanOrEqual(4.49);
    expect(stats.max).toBeLessThanOrEqual(5.51);
  });
});
