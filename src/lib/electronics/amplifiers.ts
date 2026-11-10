/**
 * Amplifiers and comparators — the analogue front end of a design.
 *
 * Each part below is the pin table from its own datasheet, and the URL of the
 * document it was read from, because a pin number that cannot be checked is a
 * pin number that will be doubted. Parts whose pin tables could not be opened
 * from here (the Microchip MCP6xxx family, the AD620, the NXP PCF8591) are not
 * in this file, even though they are common — a well-known part with a guessed
 * pinout is worse than no part at all.
 *
 * Where the app's SPICE model library already contains a subcircuit for a part,
 * `spiceModel` names it, so the dock can say what the solver actually models
 * rather than implying the whole catalog is simulated.
 *
 * Pure data plus pure lookups; imports nothing from the simulator or renderer.
 */
import type { IcPin } from './standardIcs';

export type AmplifierFamily =
  | 'op-amp'
  | 'comparator'
  | 'instrumentation-amp'
  | 'current-sense-amp';

export interface AmplifierSpec {
  id: string;
  partNumber: string;
  name: string;
  manufacturer: string;
  family: AmplifierFamily;
  /** Package(s) the pin table above applies to. */
  package: string;
  pinCount: number;
  pins: readonly IcPin[];
  /** Supply range as the datasheet's own recommended-conditions table states it. */
  supplyRange: string;
  /** The number a designer checks first: gain, slew, offset, or a pin behaviour. */
  keyRating: string;
  /** Where this pin table was read from. */
  datasheetUrl: string;
  /** A subcircuit in `lib/simulation/vendorModels.ts` that models this part, when one exists. */
  spiceModel?: string;
  description: string;
}

const pins = (names: Array<[number, string, IcPin['kind']]>): IcPin[] =>
  names.map(([number, name, kind]) => ({ number, name, kind }));

/** The 8-pin dual op-amp/comparator body used by five of the parts below. */
const DUAL8 = 'SOIC-8 / PDIP-8';

/**
 * LM358 — dual general-purpose op-amp. Pin 4 is the negative (lowest) supply, so
 * the part works from a single supply with pin 4 at ground; that trips up anyone
 * used to the ±-rail numbering of other dual packages.
 */
export const AMP_LM358: AmplifierSpec = {
  id: 'opamp-lm358',
  partNumber: 'LM358',
  name: 'Dual op-amp, single supply',
  manufacturer: 'Texas Instruments',
  family: 'op-amp',
  package: DUAL8,
  pinCount: 8,
  pins: pins([
    [1, 'OUT1', 'output'], [2, 'IN1-', 'input'], [3, 'IN1+', 'input'], [4, 'V-', 'power'],
    [5, 'IN2+', 'input'], [6, 'IN2-', 'input'], [7, 'OUT2', 'output'], [8, 'V+', 'power'],
  ]),
  supplyRange: '3 V to 36 V',
  keyRating: 'Two amplifiers in one 8-pin body; pin 4 is the lowest supply, so it runs single-supply',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/lm358.pdf',
  spiceModel: 'LM358',
  description:
    'The workhorse dual op-amp for sensor buffering and filtering on a single rail: OUT1/IN1 on pins 1-3, OUT2/IN2 on pins 5-7, supply across 4 and 8.',
};

/** TL072 — dual JFET-input op-amp; the datasheet's own summary is 1 mV typical offset and 20 V/µs slew. */
export const AMP_TL072: AmplifierSpec = {
  id: 'opamp-tl072',
  partNumber: 'TL072',
  name: 'Dual JFET-input op-amp',
  manufacturer: 'Texas Instruments',
  family: 'op-amp',
  package: DUAL8,
  pinCount: 8,
  pins: pins([
    [1, '1OUT', 'output'], [2, '1IN-', 'input'], [3, '1IN+', 'input'], [4, 'VCC-', 'power'],
    [5, '2IN+', 'input'], [6, '2IN-', 'input'], [7, '2OUT', 'output'], [8, 'VCC+', 'power'],
  ]),
  supplyRange: 'Split rails, per the datasheet recommended-conditions table',
  keyRating: 'JFET input, 1 mV typical offset, 20 V/µs slew rate',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/tl072.pdf',
  description:
    'Low-bias-current dual op-amp for audio and instrument front ends. Same pin order as the LM358 but with the rails labelled VCC-/VCC+ on pins 4 and 8.',
};

/** OPA2134 — dual audio op-amp; the datasheet lists (V+)−(V−) up to 36 V. */
export const AMP_OPA2134: AmplifierSpec = {
  id: 'opamp-opa2134',
  partNumber: 'OPA2134',
  name: 'Dual soundPlus audio op-amp',
  manufacturer: 'Texas Instruments',
  family: 'op-amp',
  package: DUAL8,
  pinCount: 8,
  pins: pins([
    [1, 'OUT A', 'output'], [2, '-IN A', 'input'], [3, '+IN A', 'input'], [4, 'V-', 'power'],
    [5, '+IN B', 'input'], [6, '-IN B', 'input'], [7, 'OUT B', 'output'], [8, 'V+', 'power'],
  ]),
  supplyRange: '(V+) − (V−) up to 36 V',
  keyRating: 'Channel A on pins 1-3, channel B mirrored on 5-7, rails on 4 and 8',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/opa2134.pdf',
  description:
    'Low-noise, low-distortion dual bipolar op-amp used in line-level audio stages and precision buffers.',
};

/** LM393 — dual comparator with open-collector outputs, so the output needs a pull-up. */
export const CMP_LM393: AmplifierSpec = {
  id: 'comparator-lm393',
  partNumber: 'LM393',
  name: 'Dual comparator, open-collector',
  manufacturer: 'Texas Instruments',
  family: 'comparator',
  package: DUAL8,
  pinCount: 8,
  pins: pins([
    [1, '1OUT', 'output'], [2, '1IN-', 'input'], [3, '1IN+', 'input'], [4, 'GND', 'power'],
    [5, '2IN+', 'input'], [6, '2IN-', 'input'], [7, '2OUT', 'output'], [8, 'VCC', 'power'],
  ]),
  supplyRange: '2 V to 36 V',
  keyRating: 'Open-collector outputs — a pull-up resistor is required to get a high level',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/lm393.pdf',
  description:
    'Two independent comparators with the same input order as the LM358 and GND/VCC on pins 4 and 8. Outputs sink current; they never source.',
};

/**
 * TLV3501 — fast single comparator in SOT-23-6 with a shutdown pin. The datasheet
 * note read here: the part is disabled when SHDN is within 0.9 V of the most
 * positive supply, and enabled when it is 1.7 V or more below it.
 */
export const CMP_TLV3501: AmplifierSpec = {
  id: 'comparator-tlv3501',
  partNumber: 'TLV3501',
  name: 'Fast comparator with shutdown',
  manufacturer: 'Texas Instruments',
  family: 'comparator',
  package: 'SOT-23-6 (DBV)',
  pinCount: 6,
  pins: pins([
    [1, '-IN', 'input'], [2, 'V-', 'power'], [3, '+IN', 'input'],
    [4, 'V+', 'power'], [5, 'OUT', 'output'], [6, 'SHDN', 'input'],
  ]),
  supplyRange: 'Single supply, per the datasheet recommended-conditions table',
  keyRating: 'Disabled when SHDN is within 0.9 V of V+; enabled at 1.7 V or more below it',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/tlv3501.pdf',
  description:
    'Nano-second comparator for zero-crossing and threshold detection, with a SHDN pin that idles the output stage.',
};

/** INA128 — programmable-gain instrumentation amplifier; gain is set by one resistor between pins 1 and 8. */
export const AMP_INA128: AmplifierSpec = {
  id: 'instamp-ina128',
  partNumber: 'INA128',
  name: 'Programmable-gain instrumentation amp',
  manufacturer: 'Texas Instruments',
  family: 'instrumentation-amp',
  package: DUAL8,
  pinCount: 8,
  pins: pins([
    [1, 'RG', 'passive'], [2, 'VIN-', 'input'], [3, 'VIN+', 'input'], [4, 'V-', 'power'],
    [5, 'REF', 'input'], [6, 'VO', 'output'], [7, 'V+', 'power'], [8, 'RG', 'passive'],
  ]),
  supplyRange: '(V+) − (V−) up to 36 V',
  keyRating: 'Gain = 1 + 50 kΩ/RG, the resistor sitting across pins 1 and 8',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/ina128.pdf',
  description:
    'Strain-gauge and thermocouple front end: differential inputs on 2/3, output on 6, reference on 5 sets the output centre, and one gain resistor across 1 and 8.',
};

/** OPA2188 — zero-drift dual op-amp; agent-read pin table, 4 V to 36 V total supply, 2 MHz. */
export const AMP_OPA2188: AmplifierSpec = {
  id: 'opamp-opa2188',
  partNumber: 'OPA2188',
  name: 'Zero-drift dual op-amp',
  manufacturer: 'Texas Instruments',
  family: 'op-amp',
  package: 'VSSOP-8 (DGK) / SO-8 (D)',
  pinCount: 8,
  pins: pins([
    [1, 'OUT A', 'output'], [2, '-IN A', 'input'], [3, '+IN A', 'input'], [4, 'V-', 'power'],
    [5, '+IN B', 'input'], [6, '-IN B', 'input'], [7, 'OUT B', 'output'], [8, 'V+', 'power'],
  ]),
  supplyRange: '4 V to 36 V total (±2 V to ±18 V)',
  keyRating: '25 µV max offset, 0.03 µV/°C drift, 2 MHz gain bandwidth',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/opa2188.pdf',
  description:
    'Chopper-stabilised dual op-amp for DC-coupled measurement: inputs include the negative rail and the output swings rail-to-rail.',
};

/** ADA4528-2 — zero-drift dual, offered in MSOP and LFCSP, not in SO-8. */
export const AMP_ADA4528_2: AmplifierSpec = {
  id: 'opamp-ada4528-2',
  partNumber: 'ADA4528-2',
  name: 'Zero-drift dual op-amp 2.2-5.5 V',
  manufacturer: 'Analog Devices',
  family: 'op-amp',
  package: 'MSOP-8 (RM) / LFCSP-8 (CP)',
  pinCount: 8,
  pins: pins([
    [1, 'OUT A', 'output'], [2, '-IN A', 'input'], [3, '+IN A', 'input'], [4, 'V-', 'power'],
    [5, '+IN B', 'input'], [6, '-IN B', 'input'], [7, 'OUT B', 'output'], [8, 'V+', 'power'],
  ]),
  supplyRange: '2.2 V to 5.5 V (±1.1 V to ±2.75 V)',
  keyRating: '2.5 µV max offset, 0.015 µV/°C drift, 3 MHz bandwidth at gain 100',
  datasheetUrl:
    'https://www.analog.com/media/en/technical-documentation/data-sheets/ADA4528-1_4528-2.pdf',
  description:
    'Low-voltage zero-drift dual for 3.3 V and 5 V sensor paths. There is no SO-8 option, so the footprint is MSOP or LFCSP; the LFCSP adds an exposed pad.',
};

/**
 * INA180 — fixed-gain current-sense amplifier in SOT-23-5.
 *
 * Two pinouts exist: the A-grade table below (pin 1 OUT) and a mirrored B-grade
 * one, so the grade letter is part of the footprint, not just a speed option.
 */
export const AMP_INA180: AmplifierSpec = {
  id: 'cs-amp-ina180',
  partNumber: 'INA180A1',
  name: 'Current-sense amplifier 20 V/V',
  manufacturer: 'Texas Instruments',
  family: 'current-sense-amp',
  package: 'SOT-23-5 (DBV)',
  pinCount: 5,
  pins: pins([
    [1, 'OUT', 'output'], [2, 'GND', 'power'], [3, 'IN+', 'input'],
    [4, 'IN-', 'input'], [5, 'VS', 'power'],
  ]),
  supplyRange: '2.7 V to 5.5 V',
  keyRating: 'Fixed 20 V/V (A1 grade), common-mode −0.2 V to 26 V independent of supply',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/ina180.pdf',
  description:
    'Shunt-monitor amplifier for bus current telemetry. Pinout A (this table) is the A-grade part; the B-grade INA180B* ships a mirrored pinout, so check the suffix before landing a footprint.',
};

/** Every amplifier and comparator this library ships. */
export const STANDARD_AMPLIFIERS: readonly AmplifierSpec[] = [
  AMP_LM358,
  AMP_TL072,
  AMP_OPA2134,
  AMP_OPA2188,
  AMP_ADA4528_2,
  AMP_INA128,
  AMP_INA180,
  CMP_LM393,
  CMP_TLV3501,
];

/** Find an amplifier by part number. Fail-loud on unknown parts. */
export function amplifierByPartNumber(partNumber: string): AmplifierSpec {
  const found = STANDARD_AMPLIFIERS.find((spec) => spec.partNumber === partNumber);
  if (!found) throw new Error(`Unknown amplifier part number: ${partNumber}.`);
  return found;
}
