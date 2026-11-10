/**
 * Board power — the regulators that turn a wall or battery voltage into the rails
 * everything else runs from.
 *
 * Every pin table here was read from the datasheet named in `datasheetUrl`. Two
 * rules shaped this file. First, the package is part of the identity: an LM317 in
 * TO-220 has three pins and the same die in SOT-223 has four, because the tab is
 * bonded to the output. Second, parts whose documents were unreachable from here
 * are not encoded — ST's L7805CV (its pin labels are rasterised in the copy we
 * could fetch), onsemi's MC7800 family, Microchip's MCP1700/MCP1802 LDOs and the
 * MP1584 buck module. When those datasheets can be read, the rows belong here.
 *
 * `spiceModel` names a subcircuit already in `lib/simulation/vendorModels.ts`, so
 * the dock can distinguish "this part is simulated" from "this part is a footprint
 * and a BOM line".
 *
 * Pure data plus pure lookups; imports nothing from the simulator or renderer.
 */
import type { IcPin } from './standardIcs';

export type PowerFamily =
  | 'fixed-regulator'
  | 'adjustable-regulator'
  | 'ldo'
  | 'buck-converter';

export interface PowerSpec {
  id: string;
  partNumber: string;
  name: string;
  manufacturer: string;
  family: PowerFamily;
  package: string;
  pinCount: number;
  pins: readonly IcPin[];
  /** Output voltage, or the adjustable range the datasheet states. */
  vout: string;
  /** Output current the datasheet rates, amps. */
  ioutA: number;
  /** Maximum input voltage, volts. */
  vinMaxV: number;
  /** Dropout, quiescent current, or the control-pin behaviour that bites in a layout. */
  keyRating: string;
  datasheetUrl: string;
  /** A subcircuit in `lib/simulation/vendorModels.ts` that models this part, when one exists. */
  spiceModel?: string;
  description: string;
}

const pins = (names: Array<[number, string, IcPin['kind']]>): IcPin[] =>
  names.map(([number, name, kind]) => ({ number, name, kind }));

/**
 * LM7805 / LM7812 — the three-terminal positive regulators.
 *
 * INPUT-GND-OUTPUT left to right is the TO-220 order for this family, which is
 * also why a regulator swapped in from another manufacturer's data sheet can be
 * installed backwards: some families put ground on pin 3.
 */
function make78xx(partNumber: string, vout: string, id: string, spiceModel?: string): PowerSpec {
  return {
    id,
    partNumber,
    name: `${vout} 3-terminal positive regulator`,
    manufacturer: 'Texas Instruments',
    family: 'fixed-regulator',
    package: 'TO-220 (NDE)',
    pinCount: 3,
    pins: pins([
      [1, 'INPUT', 'input'], [2, 'GND', 'power'], [3, 'OUTPUT', 'output'],
    ]),
    vout,
    ioutA: 1.5,
    vinMaxV: 35,
    keyRating:
      'Quiescent current 8 mA max; about 2 V dropout at 1 A, so the input needs roughly 7 V for a regulated 5 V',
    datasheetUrl: 'https://www.ti.com/lit/ds/symlink/lm340.pdf',
    spiceModel,
    description:
      'Fixed monolithic regulator with current limit and thermal shutdown in three pins, the LM340/LM78xx family document being the source of this table.',
  };
}

export const REG_LM7805: PowerSpec = make78xx('LM7805', '5 V', 'reg-lm7805', 'LM7805');
export const REG_LM7812: PowerSpec = make78xx('LM7812', '12 V', 'reg-lm7812');

/** LM317 — adjustable regulator: ADJUST is pin 1, output 2, input 3. */
export const REG_LM317T: PowerSpec = {
  id: 'reg-lm317t',
  partNumber: 'LM317T',
  name: 'Adjustable positive regulator',
  manufacturer: 'Texas Instruments',
  family: 'adjustable-regulator',
  package: 'TO-220 (KCS/KCT)',
  pinCount: 3,
  pins: pins([
    [1, 'ADJUST', 'input'], [2, 'OUTPUT', 'output'], [3, 'INPUT', 'input'],
  ]),
  vout: '1.25 V to 37 V',
  ioutA: 1.5,
  vinMaxV: 40,
  keyRating: 'Sets with two resistors; 65 dB typical ripple rejection; input-to-output differential up to 40 V',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/lm317.pdf',
  spiceModel: 'LM317',
  description:
    'Three-terminal adjustable regulator. The tab is the output, not ground, so an isolated mounting kit is required on a grounded heatsink.',
};

/** LM317 in SOT-223: the same three functions plus pin 4, the tab bonded to OUTPUT. */
export const REG_LM317MPX: PowerSpec = {
  id: 'reg-lm317-sot223',
  partNumber: 'LM317MPX',
  name: 'Adjustable regulator, SOT-223',
  manufacturer: 'Texas Instruments',
  family: 'adjustable-regulator',
  package: 'SOT-223 (DCY, 4-pin)',
  pinCount: 4,
  pins: pins([
    [1, 'ADJUST', 'input'], [2, 'OUTPUT', 'output'], [3, 'INPUT', 'input'], [4, 'OUTPUT', 'power'],
  ]),
  vout: '1.25 V to 37 V',
  ioutA: 1.5,
  vinMaxV: 40,
  keyRating: 'Pin 4 is the package tab, internally tied to OUTPUT',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/lm317.pdf',
  spiceModel: 'LM317',
  description:
    'The surface-mount LM317. Four pads, not three: the datasheet pin table lists OUTPUT on pin 2 and the tab, which is where the heat leaves the part.',
};

/** AMS1117 — the SOT-223 LDO that is on almost every dev board. */
export const REG_AMS1117_33: PowerSpec = {
  id: 'reg-ams1117-3.3',
  partNumber: 'AMS1117-3.3',
  name: '3.3 V 1 A low-dropout regulator',
  manufacturer: 'Advanced Monolithic Systems',
  family: 'ldo',
  package: 'SOT-223',
  pinCount: 3,
  pins: pins([
    [1, 'GROUND', 'power'], [2, 'VOUT', 'output'], [3, 'VIN', 'input'],
  ]),
  vout: '3.3 V ±1.5%',
  ioutA: 1,
  vinMaxV: 15,
  keyRating: 'Dropout 1.1 V typical / 1.3 V max at 0.8 A',
  datasheetUrl: 'http://www.advanced-monolithic.com/pdf/ds1117.pdf',
  description:
    'Fixed 3.3 V LDO. Pin 1 is ground on the fixed part and adjust on the adjustable AMS1117, so the suffix decides what that pad does.',
};

/**
 * TPS54331 — 3 A non-synchronous buck. The DD body is SOIC-8; the DDA PowerPAD
 * variant adds a ninth, unnumbered pad that must go to ground.
 */
export const BUCK_TPS54331: PowerSpec = {
  id: 'buck-tps54331',
  partNumber: 'TPS54331DR',
  name: '3 A step-down converter',
  manufacturer: 'Texas Instruments',
  family: 'buck-converter',
  package: 'SOIC-8 (DD)',
  pinCount: 8,
  pins: pins([
    [1, 'BOOT', 'output'], [2, 'VIN', 'power'], [3, 'EN', 'input'], [4, 'SS', 'input'],
    [5, 'VSENSE', 'input'], [6, 'COMP', 'output'], [7, 'GND', 'power'], [8, 'PH', 'output'],
  ]),
  vout: 'Adjustable down to 0.8 V',
  ioutA: 3,
  vinMaxV: 28,
  keyRating: '573 kHz, cycle-by-cycle current limit, pulse-skipping Eco-mode; EN floating = enabled',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/tps54331.pdf',
  description:
    'Bootstrap-driven buck regulator with soft start on SS and the feedback divider landing on VSENSE. Pin 8 PH is the switching node — keep that copper small.',
};

/** TPS5430 in the PowerPAD package: pins 2 and 3 are not connected internally. */
export const BUCK_TPS5430: PowerSpec = {
  id: 'buck-tps5430',
  partNumber: 'TPS5430DDA',
  name: '3 A wide-VIN step-down converter',
  manufacturer: 'Texas Instruments',
  family: 'buck-converter',
  package: 'HSOIC-8 with PowerPAD (DDA)',
  pinCount: 9,
  pins: pins([
    [1, 'BOOT', 'output'], [2, 'NC', 'passive'], [3, 'NC', 'passive'], [4, 'VSENSE', 'input'],
    [5, 'ENA', 'input'], [6, 'GND', 'power'], [7, 'VIN', 'power'], [8, 'PH', 'output'],
    [9, 'DAP', 'power'],
  ]),
  vout: '0.802 V reference, adjustable',
  ioutA: 3,
  vinMaxV: 36,
  keyRating: '573 kHz; the datasheet recommends a 5.5 V to 36 V input for this ordering',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/tps5430.pdf',
  description:
    'Higher-voltage buck cousin of the TPS54331 with a different pin map: two no-connect pins, enable on 5, and pin 9 the exposed pad that must join ground.',
};

/** TPS7A4700 — low-noise 1 A LDO for analog rails, VQFN-20 only in this revision. */
export const LDO_TPS7A4700: PowerSpec = {
  id: 'ldo-tps7a4700',
  partNumber: 'TPS7A4700RGWR',
  name: '1 A low-noise high-PSRR LDO',
  manufacturer: 'Texas Instruments',
  family: 'ldo',
  package: 'VQFN-20 (RGW), 5x5 mm',
  pinCount: 20,
  pins: pins([
    [1, 'OUT', 'output'], [2, 'OUT', 'output'], [3, 'SENSE/FB', 'input'],
    [4, '6P4V2', 'passive'], [5, '6P4V1', 'passive'], [6, '3P2V', 'passive'],
    [7, 'GND', 'power'], [8, '1P6V', 'passive'], [9, '0P8V', 'passive'], [10, '0P4V', 'passive'],
    [11, '0P2V', 'passive'], [12, '0P1V', 'passive'], [13, 'EN', 'input'], [14, 'NR', 'input'],
    [15, 'IN', 'power'], [16, 'IN', 'power'], [17, 'NC', 'passive'], [18, 'NC', 'passive'],
    [19, 'NC', 'passive'], [20, 'OUT', 'output'],
  ]),
  vout: '1.4 V to 20.5 V (TPS7A4701: to 34 V)',
  ioutA: 1,
  vinMaxV: 36,
  keyRating: 'ANY-OUT pins 8-12 tie to ground to add fixed offsets; the exposed pad is ground',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/tps7a47.pdf',
  description:
    'High-PSRR bipolar LDO for clean analog and RF rails. This revision of the document packages the part only as the 20-lead VQFN, so any older 8-pin footprint in a library is describing a different variant.',
};

/** Every power part this library ships. */
export const STANDARD_POWER_PARTS: readonly PowerSpec[] = [
  REG_LM7805,
  REG_LM7812,
  REG_LM317T,
  REG_LM317MPX,
  REG_AMS1117_33,
  LDO_TPS7A4700,
  BUCK_TPS54331,
  BUCK_TPS5430,
];

/** Find a power part by part number. Fail-loud on unknown parts. */
export function powerByPartNumber(partNumber: string): PowerSpec {
  const found = STANDARD_POWER_PARTS.find((spec) => spec.partNumber === partNumber);
  if (!found) throw new Error(`Unknown power part number: ${partNumber}.`);
  return found;
}
