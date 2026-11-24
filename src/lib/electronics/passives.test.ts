import { describe, expect, it } from 'vitest';
import { CHIP_PACKAGES, capacitor, inductor, nearestE12, resistor } from './passives';

describe('passive components', () => {
  it('rounds to the nearest E12 value in-decade', () => {
    expect(nearestE12(10_000)).toBe(10_000);
    expect(nearestE12(9_500)).toBe(10_000);
    expect(nearestE12(4_500)).toBe(4_700);
    expect(nearestE12(4_400)).toBe(4_700);
    expect(() => nearestE12(0)).toThrow(/positive/);
  });
  it('rates 0603 at 0.1W with 75V and 0201 lower', () => {
    expect(CHIP_PACKAGES['0603'].rating).toBe(0.1);
    expect(resistor(10_000).maxVoltageV).toBe(75);
    expect(resistor(10, '0201').maxVoltageV).toBe(25);
    expect(() => resistor(10, 'NOPE')).toThrow(/Unknown package/);
  });
  it('grades ceramic dielectrics by tolerance', () => {
    expect(capacitor(100e-9, 'C0G').tolerancePct).toBe(5);
    expect(capacitor(100e-9, 'X7R').tolerancePct).toBe(10);
    expect(inductor(10e-6).henries).toBe(10e-6);
    expect(() => capacitor(-1)).toThrow(/positive/);
  });
});
