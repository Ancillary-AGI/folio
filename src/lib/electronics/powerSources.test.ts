import { describe, expect, it } from 'vitest';
import {
  BATTERY_LIBRARY,
  batteryOcvAtSoc,
  batteryTerminalVoltage,
  calculateBuckConverter,
  calculateLdoThermal,
} from './powerSources';

describe('Power Sources & Conversion Calculators', () => {
  it('models Li-ion and LiFePO4 discharge voltages accurately', () => {
    const liIon = BATTERY_LIBRARY.find((b) => b.id === 'batt-18650-3000mah')!;
    expect(liIon).toBeDefined();

    // Full charge at 100% SOC
    expect(batteryOcvAtSoc(liIon, 1.0)).toBeCloseTo(4.2, 1);
    // Cut-off at 0% SOC
    expect(batteryOcvAtSoc(liIon, 0.0)).toBeCloseTo(3.0, 1);
    // Mid charge ~ 3.7V
    expect(batteryOcvAtSoc(liIon, 0.5)).toBeCloseTo(3.7, 1);

    // Terminal voltage with 10A draw: V_term = OCV - 10 * 0.025 = OCV - 0.25V
    const ocvMid = batteryOcvAtSoc(liIon, 0.5);
    const vTerm = batteryTerminalVoltage(liIon, 0.5, 10.0);
    expect(vTerm).toBeCloseTo(ocvMid - 0.25, 2);
  });

  it('models coin cells with high internal resistance', () => {
    const cr2032 = BATTERY_LIBRARY.find((b) => b.id === 'batt-coin-cr2032')!;
    expect(cr2032.internalResistanceOhms).toBe(20.0);

    // 10mA pulsed load drops 200mV (0.01 * 20)
    const ocv = batteryOcvAtSoc(cr2032, 0.8);
    const vLoaded = batteryTerminalVoltage(cr2032, 0.8, 0.01);
    expect(vLoaded).toBeCloseTo(ocv - 0.2, 2);
  });

  it('calculates synchronous buck converter inductance and capacitance correctly', () => {
    // 12V -> 3.3V @ 2A, 500 kHz, 90% efficiency
    const result = calculateBuckConverter({
      vinV: 12.0,
      voutV: 3.3,
      ioutA: 2.0,
      switchingFreqHz: 500e3,
      efficiencyPercent: 90,
      inductorRippleRatio: 0.3,
      maxVoutRippleV: 0.033, // 33mV (1%)
    });

    expect(result.dutyCycle).toBeGreaterThan(0.25);
    expect(result.dutyCycle).toBeLessThan(0.35);
    expect(result.inductanceMicroH).toBeGreaterThan(0);
    expect(result.inductorPeakCurrentA).toBeGreaterThan(2.0); // DC + ripple/2
    expect(result.minOutputCapacitanceUf).toBeGreaterThan(0);
  });

  it('evaluates LDO thermal junction temperature and detects overheating', () => {
    // 5V -> 3.3V @ 500mA in SOT-223 (theta_ja = 60 C/W)
    // Pd = (5 - 3.3) * 0.5 = 0.85 W
    // Tj = 25 + 0.85 * 60 = 25 + 51 = 76 C (safe)
    const safe = calculateLdoThermal(5.0, 3.3, 0.5, 0.005, 60, 25);
    expect(safe.powerDissipationW).toBeCloseTo(0.875, 2);
    expect(safe.junctionTempC).toBeCloseTo(77.5, 1);
    expect(safe.isOverheating).toBe(false);

    // 12V -> 3.3V @ 500mA in SOT-223 (theta_ja = 60 C/W)
    // Pd = (12 - 3.3) * 0.5 = 4.35 W
    // Tj = 25 + 4.35 * 60 = 286 C (overheating!)
    const hot = calculateLdoThermal(12.0, 3.3, 0.5, 0.005, 60, 25);
    expect(hot.isOverheating).toBe(true);
    expect(hot.junctionTempC).toBeGreaterThan(125);
  });
});
