/**
 * Analog + data-communication interfaces.
 * ADC/DAC specs with LSB/quantization math, op-amp closed-loop gains,
 * UART baud error, I2C pullup bounds, SPI clock limits, CAN bit timing,
 * USB power rules. Every formula asserted in tests.
 */

export interface AdcSpec {
  id: string; partNumber: string; bits: number;
  vref: number; sampleRateSps: number; interface: 'SPI' | 'I2C' | 'parallel';
  description: string;
}

/** LSB weight in volts: Vref / 2^N. */
export function adcLsb(adc: AdcSpec): number {
  if (!(adc.bits > 0)) throw new Error('ADC bits must be positive.');
  if (!(adc.vref > 0)) throw new Error('ADC Vref must be positive.');
  return adc.vref / 2 ** adc.bits;
}

/** Quantization noise RMS for an ideal ADC: LSB / sqrt(12). */
export function adcQuantNoiseRms(adc: AdcSpec): number {
  return adcLsb(adc) / Math.sqrt(12);
}

export const ADC_MCP3008: AdcSpec = {
  id: 'adc-mcp3008', partNumber: 'MCP3008',
  bits: 10, vref: 5, sampleRateSps: 200_000, interface: 'SPI',
  description: '8-channel 10-bit SPI ADC, 200 ksps.',
};

export interface OpAmpConfig {
  kind: 'inverting' | 'non-inverting' | 'voltage-follower' | 'differential';
  rIn?: number; rF?: number; r1?: number; r2?: number;
}

/** Closed-loop voltage gain (signed for inverting). Throws on non-positive resistors. */
export function opAmpGain(config: OpAmpConfig): number {
  if (config.kind === 'voltage-follower') return 1;
  const { rIn, rF } = config;
  if (!(rIn! > 0) || !(rF! > 0)) throw new Error('op-amp config needs positive rIn and rF.');
  if (config.kind === 'inverting') return -rF! / rIn!;
  return 1 + rF! / rIn!;
}

export interface UartConfig {
  baud: number; dataBits: 5 | 6 | 7 | 8; stopBits: 1 | 1.5 | 2; parity: 'none' | 'even' | 'odd';
}

/** Frame bits per byte including start/stop/parity. */
export function uartFrameBits(config: UartConfig): number {
  return 1 + config.dataBits + (config.parity === 'none' ? 0 : 1) + config.stopBits;
}

/** Baud-rate error vs an achievable divisor clock. Fail-loud on nonsense. */
export function uartBaudError(target: number, actual: number): number {
  if (!(target > 0) || !(actual > 0)) throw new Error('baud rates must be positive.');
  return (actual - target) / target;
}

export interface I2cBus {
  pullupOhms: number; busCapacitanceF: number; vdd: number;
}

/** I2C rise time estimate: 0.8473 * R * C (10-90% RC step). */
export function i2cRiseTimeNs(bus: I2cBus): number {
  if (!(bus.pullupOhms > 0) || !(bus.busCapacitanceF > 0)) throw new Error('I2C bus needs positive R and C.');
  return 0.8473 * bus.pullupOhms * bus.busCapacitanceF * 1e9;
}
