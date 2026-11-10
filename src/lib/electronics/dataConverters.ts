/**
 * Data converters and the references that set their scale.
 *
 * Pin numbers, names and packages come from the manufacturer datasheet named in
 * `datasheetUrl` — several of these were read from the PDF in this workspace, the
 * rest from a datasheet opened and quoted during research. Anything that could not
 * be read is absent: the Microchip MCP3008/MCP3204 SPI ADCs, the MCP4922 dual SPI
 * DAC and the NXP PCF8591 are all common parts whose tables were unreachable from
 * here, so they are not encoded rather than remembered.
 *
 * Pure data plus pure lookups; imports nothing from the simulator or renderer.
 */
import type { IcPin } from './standardIcs';

export type ConverterFamily = 'adc' | 'dac' | 'voltage-reference';

export interface ConverterSpec {
  id: string;
  partNumber: string;
  name: string;
  manufacturer: string;
  family: ConverterFamily;
  package: string;
  pinCount: number;
  pins: readonly IcPin[];
  supplyRange: string;
  /** Resolution, channel count, or the output voltage a reference is trimmed to. */
  keyRating: string;
  datasheetUrl: string;
  description: string;
}

const pins = (names: Array<[number, string, IcPin['kind']]>): IcPin[] =>
  names.map(([number, name, kind]) => ({ number, name, kind }));

/**
 * ADS1115 — 16-bit delta-sigma ADC with an I2C interface, a programmable gain
 * amplifier and an internal reference, in VSSOP-10. ALERT/RDY (pin 2) is
 * open-drain, so it needs a pull-up like any interrupt line.
 */
export const ADC_ADS1115: ConverterSpec = {
  id: 'adc-ads1115',
  partNumber: 'ADS1115',
  name: '16-bit I2C ADC with PGA',
  manufacturer: 'Texas Instruments',
  family: 'adc',
  package: 'VSSOP-10 (DGS)',
  pinCount: 10,
  pins: pins([
    [1, 'ADDR', 'input'], [2, 'ALERT/RDY', 'output'], [3, 'GND', 'power'],
    [4, 'AIN0', 'input'], [5, 'AIN1', 'input'], [6, 'AIN2', 'input'], [7, 'AIN3', 'input'],
    [8, 'VDD', 'power'], [9, 'SDA', 'bidirectional'], [10, 'SCL', 'input'],
  ]),
  supplyRange: '2.0 V to 5.5 V',
  keyRating: '16-bit, 4 inputs through a differential mux, 8-860 SPS, four I2C addresses via ADDR',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/ads1115.pdf',
  description:
    'The go-to precision ADC for slow analog: AIN0-AIN3 on pins 4-7, ADDR picks one of four I2C addresses, and the open-drain ALERT/RDY doubles as a conversion-done interrupt.',
};

/** DAC8564 — quad 16-bit SPI DAC with an internal 2.5 V reference, TSSOP-16. */
export const DAC_DAC8564: ConverterSpec = {
  id: 'dac-dac8564',
  partNumber: 'DAC8564',
  name: 'Quad 16-bit SPI DAC',
  manufacturer: 'Texas Instruments',
  family: 'dac',
  package: 'TSSOP-16 (PW)',
  pinCount: 16,
  pins: pins([
    [1, 'VOUTA', 'output'], [2, 'VOUTB', 'output'], [3, 'VREFH/VREFOUT', 'power'],
    [4, 'AVDD', 'power'], [5, 'VREFL', 'power'], [6, 'GND', 'power'],
    [7, 'VOUTC', 'output'], [8, 'VOUTD', 'output'], [9, 'SYNC', 'input'],
    [10, 'SCLK', 'input'], [11, 'DIN', 'input'], [12, 'IOVDD', 'power'],
    [13, 'A0', 'input'], [14, 'A1', 'input'], [15, 'ENABLE', 'input'], [16, 'LDAC', 'input'],
  ]),
  supplyRange: '2.7 V to 5.5 V',
  keyRating: 'Four 16-bit channels, internal 2.5 V reference, 10 µs settling to ±0.003% FSR',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/dac8564.pdf',
  description:
    'Simultaneous-update quad DAC for set-point and waveform generation. LDAC (16) and ENABLE (15) are active-low, and A0/A1 address daisy-chained parts.',
};

/**
 * MCP4725 — 12-bit I2C DAC with an EEPROM that restores the output on power-up.
 * Pin table read from the DS22039 datasheet: VOUT 1, VSS 2, VDD 3, SDA 4, SCL 5, A0 6.
 */
export const DAC_MCP4725: ConverterSpec = {
  id: 'dac-mcp4725',
  partNumber: 'MCP4725A0T-E/CH',
  name: '12-bit I2C DAC with EEPROM',
  manufacturer: 'Microchip Technology',
  family: 'dac',
  package: 'SOT-23-6 (CH)',
  pinCount: 6,
  pins: pins([
    [1, 'VOUT', 'output'], [2, 'VSS', 'power'], [3, 'VDD', 'power'],
    [4, 'SDA', 'bidirectional'], [5, 'SCL', 'input'], [6, 'A0', 'input'],
  ]),
  supplyRange: '2.7 V to 5.5 V',
  keyRating: '12-bit buffered output, rail-to-rail, VDD doubles as the reference; setting survives power-off',
  datasheetUrl: 'https://ww1.microchip.com/downloads/en/DeviceDoc/22039d.pdf',
  description:
    'Single-channel trim DAC in six pins. The VDD rail is the reference, so a noisy supply is an output error; A0 selects one of eight I2C addresses.',
};

/** REF3025 — 2.5 V series precision reference, SOT-23-3, IN/OUT/GND. */
export const REF_REF3025: ConverterSpec = {
  id: 'ref-ref3025',
  partNumber: 'REF3025AIDBZT',
  name: '2.5 V precision reference',
  manufacturer: 'Texas Instruments',
  family: 'voltage-reference',
  package: 'SOT-23-3 (DBZ)',
  pinCount: 3,
  pins: pins([
    [1, 'IN', 'power'], [2, 'OUT', 'power'], [3, 'GND', 'power'],
  ]),
  supplyRange: 'Up to 7 V input-to-ground',
  keyRating: '2.5 V ±0.2% initial accuracy, 75 ppm/°C max, 42 µA typical quiescent',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/ref30.pdf',
  description:
    'Low-dropout series reference for ADC full-scale and DAC range. Three pins only: IN, OUT, GND.',
};

/** REF3033 — the 3.3 V sibling of the same die, read from the same SBVS032K table. */
export const REF_REF3033: ConverterSpec = {
  id: 'ref-ref3033',
  partNumber: 'REF3033AIDBZR',
  name: '3.3 V precision reference',
  manufacturer: 'Texas Instruments',
  family: 'voltage-reference',
  package: 'SOT-23-3 (DBZ)',
  pinCount: 3,
  pins: pins([
    [1, 'IN', 'power'], [2, 'OUT', 'power'], [3, 'GND', 'power'],
  ]),
  supplyRange: 'Up to 7 V input-to-ground',
  keyRating: '3.3 V (3.2967-3.3033 V), 42 µA typical quiescent, 70 mA output short-circuit limit',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/ref30.pdf',
  description:
    'Series reference for 3.3 V rails and sensor excitation. The absolute maximum on IN is only 7 V, so it cannot sit straight on an unregulated bus.',
};

/**
 * TL431 — programmable shunt reference (a 2.495 V bandgap with a sense pin), not a
 * series regulator. The pin order changes with the package, which is why the
 * package is part of the identity of this row.
 */
export const REF_TL431: ConverterSpec = {
  id: 'ref-tl431',
  partNumber: 'TL431ACDBZR',
  name: 'Programmable shunt reference',
  manufacturer: 'Texas Instruments',
  family: 'voltage-reference',
  package: 'SOT-23-3 (DBZ)',
  pinCount: 3,
  pins: pins([
    [1, 'CATHODE', 'bidirectional'], [2, 'REF', 'input'], [3, 'ANODE', 'power'],
  ]),
  supplyRange: 'Cathode 3 V to 36 V, biased at 10 mA',
  keyRating: 'V(ref) 2.495 V typical; shunt device, not a supply — it sinks current to hold a voltage',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/tl431.pdf',
  description:
    'The error amplifier and set point inside most flyback and linear supplies, and a precision 2.5 V Zener substitute. In SOT-23-5 the same part is CATHODE 3 / REF 4 / ANODE 5, so the package decides the footprint.',
};

/** Every converter and reference this library ships. */
export const STANDARD_CONVERTERS: readonly ConverterSpec[] = [
  ADC_ADS1115,
  DAC_DAC8564,
  DAC_MCP4725,
  REF_REF3025,
  REF_REF3033,
  REF_TL431,
];

/** Find a converter by part number. Fail-loud on unknown parts. */
export function converterByPartNumber(partNumber: string): ConverterSpec {
  const found = STANDARD_CONVERTERS.find((spec) => spec.partNumber === partNumber);
  if (!found) throw new Error(`Unknown converter part number: ${partNumber}.`);
  return found;
}
