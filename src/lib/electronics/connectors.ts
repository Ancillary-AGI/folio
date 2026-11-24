/**
 * Connectors, power sources, and switches — the parts real schematics need.
 *
 * The electronics library covers silicon (logic, timers, MCUs, SoCs) but a
 * board cannot be drawn without its edges: barrel jacks and USB-C for power,
 * pin headers and terminal blocks for wiring, tactile and slide switches for
 * control, relays for load switching, fuses for protection, and crystals for
 * clocks. Every entry names its pins the way its datasheet does; the test
 * asserts pin counts, power-pin placement, and current/voltage ratings
 * rather than restating the implementation.
 */
import type { IcPin } from './standardIcs';

export type PassiveKind = 'connector' | 'power' | 'switch' | 'relay' | 'protection' | 'clock' | 'electromechanical';

export interface PassiveSpec {
  id: string;
  partNumber: string;
  name: string;
  kind: PassiveKind;
  pinCount: number;
  pins: readonly IcPin[];
  /** Maximum current through any pin, amps. */
  maxCurrentA: number;
  /** Maximum voltage across the part, volts. */
  maxVoltageV: number;
  description: string;
}

const pins = (names: Array<[number, string, IcPin['kind']]>): IcPin[] =>
  names.map(([number, name, kind]) => ({ number, name, kind }));

export const CONN_BARREL_JACK: PassiveSpec = {
  id: 'barrel-jack-21mm',
  partNumber: 'PJ-102A',
  name: 'DC barrel jack 2.1mm',
  kind: 'connector',
  pinCount: 3,
  pins: pins([[1, 'TIP/+', 'power'], [2, 'SLEEVE/GND', 'power'], [3, 'SWITCH', 'bidirectional']]),
  maxCurrentA: 5,
  maxVoltageV: 24,
  description: 'Switched barrel jack: pin 3 disconnects the battery when the plug inserts.',
};

export const CONN_USB_C: PassiveSpec = {
  id: 'usb-c-16p',
  partNumber: 'TYPE-C-16P',
  name: 'USB-C receptacle 16-pin',
  kind: 'connector',
  pinCount: 16,
  pins: pins([
    [1, 'GND', 'power'], [2, 'SSTXp1', 'bidirectional'], [3, 'SSTXn1', 'bidirectional'],
    [4, 'VBUS', 'power'], [5, 'CC1', 'bidirectional'], [6, 'Dp1', 'bidirectional'],
    [7, 'Dn1', 'bidirectional'], [8, 'SBU1', 'bidirectional'], [9, 'VBUS', 'power'],
    [10, 'SSTXn2', 'bidirectional'], [11, 'SSTXp2', 'bidirectional'], [12, 'GND', 'power'],
    [13, 'CC2', 'bidirectional'], [14, 'Dp2', 'bidirectional'], [15, 'Dn2', 'bidirectional'],
    [16, 'SBU2', 'bidirectional'],
  ]),
  maxCurrentA: 3,
  maxVoltageV: 20,
  description: 'Mid-mount USB-C: dual VBUS/GND, CC lines for PD negotiation, Dp/Dn doubled.',
};

export const CONN_HEADER_2X20: PassiveSpec = {
  id: 'header-2x20',
  partNumber: 'HDR-2X20-254',
  name: 'Pin header 2x20 2.54mm',
  kind: 'connector',
  pinCount: 40,
  pins: Array.from({ length: 40 }, (_, i) => ({ number: i + 1, name: `P${i + 1}`, kind: 'bidirectional' as const })),
  maxCurrentA: 3,
  maxVoltageV: 250,
  description: 'Raspberry-Pi-style 40-pin GPIO header.',
};

export const SW_TACTILE: PassiveSpec = {
  id: 'tactile-6mm',
  partNumber: 'TS-6MM',
  name: 'Tactile switch 6mm',
  kind: 'switch',
  pinCount: 4,
  pins: pins([[1, 'A1', 'passive'], [2, 'A2', 'passive'], [3, 'B1', 'passive'], [4, 'B2', 'passive']]),
  maxCurrentA: 0.05,
  maxVoltageV: 12,
  description: 'Momentary NO: A1-A2 and B1-B2 are internally common; press closes A to B.',
};

export const RELAY_SRD_05: PassiveSpec = {
  id: 'relay-srd-05vdc',
  partNumber: 'SRD-05VDC-SL-C',
  name: 'Relay 5V 10A SPDT',
  kind: 'relay',
  pinCount: 5,
  pins: pins([[1, 'COIL+', 'input'], [2, 'COIL-', 'power'], [3, 'COM', 'passive'], [4, 'NO', 'passive'], [5, 'NC', 'passive']]),
  maxCurrentA: 10,
  maxVoltageV: 250,
  description: 'Songle-class cube relay: 5 V coil, 10 A contacts, COM rests on NC.',
};

export const FUSE_0805: PassiveSpec = {
  id: 'fuse-0805',
  partNumber: 'FUSE-0805',
  name: 'Fuse 0805 SMD',
  kind: 'protection',
  pinCount: 2,
  pins: pins([[1, 'IN', 'passive'], [2, 'OUT', 'passive']]),
  maxCurrentA: 2,
  maxVoltageV: 32,
  description: 'Fast-acting SMD fuse; opens above its rating to protect the rail.',
};

export const XTAL_HC49: PassiveSpec = {
  id: 'xtal-hc49',
  partNumber: 'HC49S-16M',
  name: 'Crystal 16MHz HC-49S',
  kind: 'clock',
  pinCount: 2,
  pins: pins([[1, 'XIN', 'passive'], [2, 'XOUT', 'passive']]),
  maxCurrentA: 0.001,
  maxVoltageV: 5,
  description: 'Fundamental-mode quartz crystal with 20 pF load expectation.',
};

export const STANDARD_PASSIVES: readonly PassiveSpec[] = [
  CONN_BARREL_JACK, CONN_USB_C, CONN_HEADER_2X20, SW_TACTILE, RELAY_SRD_05, FUSE_0805, XTAL_HC49,
];

/** Find a part by part number. Fail-loud on unknown parts. */
export function passiveByPartNumber(partNumber: string): PassiveSpec {
  const found = STANDARD_PASSIVES.find((p) => p.partNumber === partNumber);
  if (!found) throw new Error(`Unknown passive part number: ${partNumber}.`);
  return found;
}
