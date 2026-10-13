import { describe, expect, it } from 'vitest';
import { SOC_256, STANDARD_SOCS, interfaceGroup, powerRails, validateBallMap } from './socPackages';

describe('SoC ball maps', () => {
  it('covers the full 16x16 grid with centred coordinates', () => {
    expect(SOC_256.balls).toHaveLength(256);
    const xs = SOC_256.balls.map((b) => b.x);
    expect(Math.min(...xs)).toBeCloseTo(-6, 9);
    expect(Math.max(...xs)).toBeCloseTo(6, 9);
    expect(STANDARD_SOCS).toContain(SOC_256);
  });
  it('carries VDDIO, VDD_CORE, and GND rails', () => {
    const rails = powerRails(SOC_256);
    expect([...rails.keys()].sort()).toEqual(['VDDIO', 'VDD_CORE']);
    expect(rails.get('VDD_CORE')).toHaveLength(4);
    expect(SOC_256.balls.some((b) => b.kind === 'ground' && b.net === 'GND')).toBe(true);
  });
  it('groups DDR bytes and high-speed interfaces', () => {
    expect(interfaceGroup(SOC_256, 'DDR_DQ0')).toHaveLength(8);
    expect(interfaceGroup(SOC_256, 'USB')).toHaveLength(2);
    expect(interfaceGroup(SOC_256, 'ETH')).toHaveLength(4);
  });
  it('validates ball maps and refuses broken ones', () => {
    expect(() => validateBallMap(SOC_256)).not.toThrow();
    expect(() => validateBallMap({ ...SOC_256, balls: SOC_256.balls.slice(1) })).toThrow(/256/);
    expect(() => validateBallMap({
      ...SOC_256,
      balls: SOC_256.balls.map((b) => ({ ...b, kind: 'signal' as const })),
    })).toThrow(/no power balls/);
  });
});
