import { describe, expect, it } from 'vitest';
import { MOTOR_NEMA17, MOTOR_RS550, TRANSFORMER_230_12, machineByPartNumber, shaftPowerW } from './machines';

describe('electromechanical machines', () => {
  it('conserves shaft power P = tw on the RS-550', () => {
    // 0.02 N·m at 12000 RPM = 0.02 * 1256.6 = ~25.1 W shaft.
    expect(shaftPowerW(MOTOR_RS550.torqueNm, MOTOR_RS550.speedRpm)).toBeCloseTo(25.13, 1);
  });
  it('holds the NEMA-17 datasheet numbers', () => {
    expect(MOTOR_NEMA17.torqueNm).toBe(0.4);
    expect(MOTOR_NEMA17.windingOhms).toBe(30);
  });
  it('keeps the transformer turns ratio at V1/V2', () => {
    expect(TRANSFORMER_230_12.turnsRatio).toBeCloseTo(230 / 12, 9);
    expect(TRANSFORMER_230_12.vaRating).toBe(30);
  });
  it('looks parts up and refuses unknown ones', () => {
    expect(machineByPartNumber('RS-550VC-7525')).toBe(MOTOR_RS550);
    expect(() => machineByPartNumber('NOPE-1')).toThrow(/Unknown machine/);
  });
});
