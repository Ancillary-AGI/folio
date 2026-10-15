import { describe, expect, it } from 'vitest';
import { ARM_L1_MM, ARM_L2_MM, buildDemoArm } from './demoArm';

describe('demo arm — FK + trajectory + gated STEP', () => {
  it('places the tip at (L1+L2, 0) home and (0, L1+L2) folded', () => {
    const demo = buildDemoArm();
    expect(demo.home.position[0] * 1000).toBeCloseTo(ARM_L1_MM + ARM_L2_MM, 6);
    expect(demo.home.position[1] * 1000).toBeCloseTo(0, 6);
    expect(demo.folded.position[0] * 1000).toBeCloseTo(0, 6);
    expect(demo.folded.position[1] * 1000).toBeCloseTo(ARM_L1_MM + ARM_L2_MM, 6);
    expect(demo.reachMm).toBe(ARM_L1_MM + ARM_L2_MM);
  });
  it('times the 90° shoulder sweep within limits (triangular: t = 2√(d/a))', () => {
    const demo = buildDemoArm();
    const d = Math.PI / 2;
    // d <= v²/a (1.5708 <= 0.5625)? No: 1.5708 > 0.5625 → trapezoidal.
    // t = d/v + v/a = 1.5708/1.5 + 1.5/4.
    expect(demo.durationS).toBeCloseTo(d / 1.5 + 1.5 / 4, 9);
    expect(demo.peakVel).toBeCloseTo(1.5, 9);
    expect(demo.samples).toBe(50);
  });
  it('exports STEP through the manufacturability gate', () => {
    const demo = buildDemoArm();
    expect(demo.export.ok).toBe(true);
    if (demo.export.ok) {
      expect(demo.export.step).toContain('folio-demo-arm');
      expect(demo.export.chainLength).toBeCloseTo(ARM_L1_MM + ARM_L2_MM, 6);
    }
    expect(demo.verdict).toMatch(/^PASS/);
  });
});
