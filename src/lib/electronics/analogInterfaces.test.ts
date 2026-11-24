import { describe, expect, it } from 'vitest';
import { ADC_MCP3008, adcLsb, adcQuantNoiseRms, i2cRiseTimeNs, opAmpGain, uartBaudError, uartFrameBits } from './analogInterfaces';

describe('analog and data interfaces', () => {
  it('computes MCP3008 LSB and quantization noise from first principles', () => {
    expect(adcLsb(ADC_MCP3008)).toBeCloseTo(5 / 1024, 9);
    expect(adcQuantNoiseRms(ADC_MCP3008)).toBeCloseTo(5 / 1024 / Math.sqrt(12), 9);
    expect(() => adcLsb({ ...ADC_MCP3008, bits: 0 })).toThrow(/positive/);
  });
  it('computes closed-loop op-amp gains with sign', () => {
    expect(opAmpGain({ kind: 'inverting', rIn: 10_000, rF: 100_000 })).toBe(-10);
    expect(opAmpGain({ kind: 'non-inverting', rIn: 10_000, rF: 100_000 })).toBe(11);
    expect(opAmpGain({ kind: 'voltage-follower' })).toBe(1);
    expect(() => opAmpGain({ kind: 'inverting', rIn: 0, rF: 1000 })).toThrow(/positive/);
  });
  it('counts UART frame bits and baud error', () => {
    expect(uartFrameBits({ baud: 115200, dataBits: 8, stopBits: 1, parity: 'none' })).toBe(10);
    expect(uartFrameBits({ baud: 9600, dataBits: 8, stopBits: 1, parity: 'even' })).toBe(11);
    expect(uartBaudError(115200, 115385)).toBeCloseTo(0.0016, 3);
    expect(() => uartBaudError(0, 9600)).toThrow(/positive/);
  });
  it('estimates I2C rise time from R and C', () => {
    // 4.7k + 100pF: 0.8473 * 4700 * 100e-12 = ~398ns.
    expect(i2cRiseTimeNs({ pullupOhms: 4700, busCapacitanceF: 100e-12, vdd: 3.3 })).toBeCloseTo(398, 0);
    expect(() => i2cRiseTimeNs({ pullupOhms: 0, busCapacitanceF: 1e-9, vdd: 3.3 })).toThrow(/positive/);
  });
});
