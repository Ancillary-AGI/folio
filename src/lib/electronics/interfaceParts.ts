/**
 * Interface, isolation and driver parts — the parts that connect Folio's
 * silicon to wires, buses and other people's equipment: transceivers, digital
 * isolators, level translators, an Ethernet PHY, optocouplers, driver arrays
 * and the discrete switches that carry a load a pin cannot.
 *
 * Every entry below was read off the manufacturer's datasheet (or a text
 * rendering of it) and carries the URL it came from, so a designer can check a
 * pin number instead of trusting this file. Parts whose numbering could not be
 * read from a document were left out rather than guessed — the RS-232/RS-485
 * transceiver that "everyone knows" as pin-for-pin is exactly where a wrong
 * table costs a board.
 *
 * Two families deliberately are not here: two-terminal discretes (a diode or
 * TVS datasheet defines cathode polarity, never a pin number — the schematic
 * archetypes draw those), and radio modules whose only published pin tables come
 * from resellers rather than the silicon maker.
 *
 * Pin direction is the datasheet buffer type, which is not always what the name
 * suggests: on the LAN8720A the TX* pins are inputs, because the MAC drives them.
 *
 * Pure data plus pure lookups; imports nothing from the simulator or renderer.
 */
import type { IcPin } from './standardIcs';

export type InterfaceFamily =
  | 'rs485-transceiver'
  | 'can-transceiver'
  | 'rs232-transceiver'
  | 'digital-isolator'
  | 'level-translator'
  | 'ethernet-phy'
  | 'optocoupler'
  | 'driver-array'
  | 'bipolar-transistor'
  | 'mosfet';

export interface InterfaceSpec {
  id: string;
  partNumber: string;
  name: string;
  manufacturer: string;
  family: InterfaceFamily;
  package: string;
  pinCount: number;
  pins: readonly IcPin[];
  /** Supply the part runs from. A range or per-rail text where the datasheet gives one. */
  supplyVolts: number | string;
  /** The headline rating a designer checks before buying: isolation, bus fault, VCEO. */
  keyRating: string;
  /** Where this pin table was read from. */
  datasheetUrl: string;
  description: string;
}

const pins = (names: Array<[number, string, IcPin['kind']]>): IcPin[] =>
  names.map(([number, name, kind]) => ({ number, name, kind }));

/**
 * MAX3485 / SP3485 — 3.3 V half-duplex RS-485 transceiver, SOIC-8.
 *
 * Pins 6/7 are the differential bus pair (A = non-inverting, B = inverting), and
 * the two control inputs are active-low for /RE so a single GPIO can drive DE and
 * /RE together for half-duplex direction.
 */
export const IC_MAX3485: InterfaceSpec = {
  id: 'rs485-max3485',
  partNumber: 'MAX3485',
  name: 'RS-485 transceiver 3.3V half-duplex',
  manufacturer: 'Maxim Integrated (Analog Devices)',
  family: 'rs485-transceiver',
  package: 'SOIC-8',
  pinCount: 8,
  pins: pins([
    [1, 'RO', 'output'], [2, '/RE', 'input'], [3, 'DE', 'input'], [4, 'DI', 'input'],
    [5, 'GND', 'power'], [6, 'A', 'bidirectional'], [7, 'B', 'bidirectional'], [8, 'VCC', 'power'],
  ]),
  supplyVolts: 3.3,
  keyRating: 'VCC absolute max 7 V; driver output −7.5 V to +12.5 V; 10 Mbps',
  datasheetUrl: 'https://www.analog.com/media/cn/technical-documentation/data-sheets/1079.pdf',
  description: 'Half-duplex 3.3 V RS-485/RS-422 transceiver: DI/RO to the UART, A/B to the bus, DE and /RE to a direction GPIO.',
};

/** SP3485 — MaxLinear's pin-to-pin second source for the same SOIC-8 footprint. */
export const IC_SP3485: InterfaceSpec = {
  id: 'rs485-sp3485',
  partNumber: 'SP3485EN-L',
  name: 'RS-485 transceiver 3.3V half-duplex',
  manufacturer: 'MaxLinear',
  family: 'rs485-transceiver',
  package: 'NSOIC-8',
  pinCount: 8,
  pins: pins([
    [1, 'RO', 'output'], [2, '/RE', 'input'], [3, 'DE', 'input'], [4, 'DI', 'input'],
    [5, 'GND', 'power'], [6, 'A', 'bidirectional'], [7, 'B', 'bidirectional'], [8, 'VCC', 'power'],
  ]),
  supplyVolts: 3.3,
  keyRating: '−7 V to +12 V bus fault protection; 10 Mbps',
  datasheetUrl: 'https://www.maxlinear.com/ds/sp3485.pdf',
  description: 'Pin-compatible RS-485 second source: same DE//RE direction control and A/B bus pair as the MAX3485.',
};

/**
 * SN65HVD230 — 3.3 V CAN transceiver, SOIC-8.
 *
 * `D` is the driver input and `R` the receiver output (they read backwards from
 * the MCU side, which is why the datasheet names, not habit, decides the wiring);
 * `RS` sets the mode, so leaving it floating is a design error, not a convenience.
 */
export const IC_SN65HVD230: InterfaceSpec = {
  id: 'can-sn65hvd230',
  partNumber: 'SN65HVD230',
  name: 'CAN transceiver 3.3V',
  manufacturer: 'Texas Instruments',
  family: 'can-transceiver',
  package: 'SOIC-8',
  pinCount: 8,
  pins: pins([
    [1, 'D', 'input'], [2, 'GND', 'power'], [3, 'VCC', 'power'], [4, 'R', 'output'],
    [5, 'Vref', 'output'], [6, 'CANL', 'bidirectional'], [7, 'CANH', 'bidirectional'], [8, 'RS', 'input'],
  ]),
  supplyVolts: 3.3,
  keyRating: '±16 kV HBM on the bus pins; VCC absolute max 6 V; up to 1 Mb/s',
  datasheetUrl: 'https://www.ti.com/cn/lit/gpn/sn65hvd230',
  description: 'Device-curve CAN transceiver: D/R face the controller, CANH/CANL the 120 Ω terminated bus, RS programs slope or standby.',
};

/** MAX232 — dual RS-232 level converter with on-chip charge pump, DIP-16. */
export const IC_MAX232: InterfaceSpec = {
  id: 'rs232-max232',
  partNumber: 'MAX232CPL',
  name: 'RS-232 transceiver with charge pump',
  manufacturer: 'Texas Instruments (Maxim original)',
  family: 'rs232-transceiver',
  package: 'DIP-16',
  pinCount: 16,
  pins: pins([
    [1, 'C1+', 'passive'], [2, 'V+', 'power'], [3, 'C1-', 'passive'], [4, 'C2+', 'passive'],
    [5, 'C2-', 'passive'], [6, 'V-', 'power'], [7, 'T2OUT', 'output'], [8, 'R2IN', 'input'],
    [9, 'R2OUT', 'output'], [10, 'T2IN', 'input'], [11, 'T1IN', 'input'], [12, 'R1OUT', 'output'],
    [13, 'R1IN', 'input'], [14, 'T1OUT', 'output'], [15, 'GND', 'power'], [16, 'VCC', 'power'],
  ]),
  supplyVolts: 5,
  keyRating: 'Single 5 V supply; TIA/EIA-232-F levels; four 1 µF pump capacitors',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/max232.pdf',
  description: 'Two RS-232 channels from one 5 V rail; pins 1–6 are the charge-pump capacitors, not signals.',
};

/** PC817 — baseless phototransistor optocoupler, DIP-4/SOP-4. 5 kVrms of isolation between LED and collector. */
export const IC_PC817: InterfaceSpec = {
  id: 'iso-pc817',
  partNumber: 'PC817',
  name: 'Phototransistor optocoupler',
  manufacturer: 'Sharp',
  family: 'optocoupler',
  package: 'DIP-4',
  pinCount: 4,
  pins: pins([
    [1, 'Anode', 'input'], [2, 'Cathode', 'input'], [3, 'Emitter', 'output'], [4, 'Collector', 'output'],
  ]),
  supplyVolts: 5,
  keyRating: '5 kVrms isolation; VCEO 80 V; CTR 50–400 %',
  datasheetUrl: 'https://partsplanai.com/datasheet/04c5dfe12e1140687ec47236af43378758d2b84e2195cdf498cba06646b672f2/sharp-pc817',
  description: 'LED on 1/2 drives a phototransistor on 3/4; the classic way to break a ground loop around a feedback pin.',
};

/** 4N35 — six-pin optocoupler with a reachable base, for analog isolation and linear coupling. */
export const IC_4N35: InterfaceSpec = {
  id: 'iso-4n35',
  partNumber: '4N35',
  name: 'Phototransistor optocoupler with base pin',
  manufacturer: 'onsemi',
  family: 'optocoupler',
  package: 'DIP-6',
  pinCount: 6,
  pins: pins([
    [1, 'ANODE', 'input'], [2, 'CATHODE', 'input'], [3, 'N/C', 'passive'],
    [4, 'EMITTER', 'output'], [5, 'COLLECTOR', 'output'], [6, 'BASE', 'passive'],
  ]),
  supplyVolts: 5,
  keyRating: 'IF 50 mA dc; PD 200 mW; pin 3 unconnected',
  datasheetUrl: 'https://www.onsemi.com/download/data-sheet/pdf/4n35-d.pdf',
  description: 'Input LED on 1/2, output transistor on 4/5, and pin 6 brings the base out so speed and linearity can be biased.',
};

/**
 * ULN2003A — seven open-collector Darlington outputs with common cathode diodes.
 *
 * Outputs mirror inputs (1B drives 1C) but are numbered in reverse, so pin 10 is
 * 7C, not 8C; the COM rail on pin 9 is where a relay's flyback diode belongs.
 */
export const IC_ULN2003A: InterfaceSpec = {
  id: 'driver-uln2003a',
  partNumber: 'ULN2003A',
  name: 'Seven 500 mA Darlington driver array',
  manufacturer: 'STMicroelectronics',
  family: 'driver-array',
  package: 'DIP-16',
  pinCount: 16,
  pins: pins([
    [1, '1B', 'input'], [2, '2B', 'input'], [3, '3B', 'input'], [4, '4B', 'input'],
    [5, '5B', 'input'], [6, '6B', 'input'], [7, '7B', 'input'], [8, 'GND', 'power'],
    [9, 'COM', 'passive'], [10, '7C', 'output'], [11, '6C', 'output'], [12, '5C', 'output'],
    [13, '4C', 'output'], [14, '3C', 'output'], [15, '2C', 'output'], [16, '1C', 'output'],
  ]),
  supplyVolts: 5,
  keyRating: 'VCEO 50 V; 500 mA per output; free-wheeling diodes to COM',
  datasheetUrl: 'https://partsplanai.com/datasheet/d803ad3bdaae394f2536287061f7fa740ce8d20c79cc5cdf833c9eb415122087/stmicroelectronics-uln2003a',
  description: 'Logic-level inputs sink relay coils and stepper phases; outputs are numbered opposite the inputs, and COM clamps the flyback.',
};

/**
 * TIP120 — NPN Darlington in TO-220.
 *
 * Pin 2 is the collector and pin 3 the emitter — the opposite of the many hobby
 * diagrams that show a TO-220 as E-C-B, and the reason this row exists with the
 * datasheet attached.
 */
export const Q_TIP120: InterfaceSpec = {
  id: 'bjt-tip120',
  partNumber: 'TIP120',
  name: 'NPN Darlington transistor 60 V',
  manufacturer: 'onsemi',
  family: 'bipolar-transistor',
  package: 'TO-220-3',
  pinCount: 3,
  pins: pins([[1, 'BASE', 'input'], [2, 'COLLECTOR', 'passive'], [3, 'EMITTER', 'passive']]),
  supplyVolts: 60,
  keyRating: 'V(BR)CBO 60 V; 5 A continuous; hFE ~1000',
  datasheetUrl: 'https://www.onsemi.com/download/data-sheet/pdf/tip120-d.pdf',
  description: 'Darlington switch for loads a GPIO cannot drive: base on 1, collector on 2, emitter on 3.',
};

/** BSS138 — 50 V N-channel MOSFET in SOT-23, the usual level-shift switch. */
export const Q_BSS138: InterfaceSpec = {
  id: 'mosfet-bss138',
  partNumber: 'BSS138',
  name: 'N-channel MOSFET 50 V SOT-23',
  manufacturer: 'onsemi',
  family: 'mosfet',
  package: 'SOT-23',
  pinCount: 3,
  pins: pins([[1, 'GATE', 'input'], [2, 'SOURCE', 'passive'], [3, 'DRAIN', 'passive']]),
  supplyVolts: 50,
  keyRating: '50 V VDS; 0.22 A; logic-level gate',
  datasheetUrl: 'https://www.onsemi.com/download/data-sheet/pdf/bss138-d.pdf',
  description: 'Small-signal N-FET for open-drain level shifting; gate on 1, source on 2, drain on 3.',
};

/**
 * ISO7741 — quad-channel digital isolator, three channels forward and one back.
 *
 * The datasheet pin map splits the body into two supplies with two ground pins
 * each (GND1 on 2 and 8, GND2 on 9 and 15), which is what makes the barrier
 * real: a single ground pour across the middle shorts it. EN1 and EN2 disable
 * their side, and the part ships with the output defaulting high.
 */
export const IC_ISO7741: InterfaceSpec = {
  id: 'iso-iso7741',
  partNumber: 'ISO7741DW',
  name: 'Quad-channel digital isolator, 3 forward + 1 reverse',
  manufacturer: 'Texas Instruments',
  family: 'digital-isolator',
  package: 'SOIC-16 (DW, 10.30 x 7.50 mm) / SSOP-16 (DBQ, 4.90 x 3.90 mm)',
  pinCount: 16,
  pins: pins([
    [1, 'VCC1', 'power'], [2, 'GND1', 'power'], [3, 'INA', 'input'], [4, 'INB', 'input'],
    [5, 'INC', 'input'], [6, 'OUTD', 'output'], [7, 'EN1', 'input'], [8, 'GND1', 'power'],
    [9, 'GND2', 'power'], [10, 'EN2', 'input'], [11, 'IND', 'input'], [12, 'OUTC', 'output'],
    [13, 'OUTB', 'output'], [14, 'OUTA', 'output'], [15, 'GND2', 'power'], [16, 'VCC2', 'power'],
  ]),
  supplyVolts: '2.25 V to 5.5 V on each side',
  keyRating:
    'Up to 5000 VRMS isolation and 12.8 kV surge, 100 Mbps, 10.7 ns typical delay at 5 V, 100 kV/us CMTI',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/iso7741.pdf',
  description:
    'Four isolated logic channels with VCC1/GND1 driving INA, INB and INC and VCC2/GND2 driving OUTA, OUTB, OUTC plus the reverse IND to OUTD. EN1 and EN2 hold their side disabled; the default output is high.',
};

/**
 * TXB0104 — four-bit bidirectional level translator with auto direction sensing.
 *
 * Two rails, and the datasheet condition that VCCA must not exceed VCCB is a
 * layout decision, not a suggestion. OE is referenced to VCCA and the datasheet
 * asks for a pull-down so the part stays high-impedance through power-up.
 */
export const IC_TXB0104: InterfaceSpec = {
  id: 'translator-txb0104',
  partNumber: 'TXB0104',
  name: '4-bit bidirectional level translator',
  manufacturer: 'Texas Instruments',
  family: 'level-translator',
  package: 'SOIC-14 (D) / TSSOP-14 (PW)',
  pinCount: 14,
  pins: pins([
    [1, 'VCCA', 'power'], [2, 'A1', 'bidirectional'], [3, 'A2', 'bidirectional'],
    [4, 'A3', 'bidirectional'], [5, 'A4', 'bidirectional'], [6, 'NC', 'passive'],
    [7, 'GND', 'power'], [8, 'OE', 'input'], [9, 'NC', 'passive'],
    [10, 'B4', 'bidirectional'], [11, 'B3', 'bidirectional'], [12, 'B2', 'bidirectional'],
    [13, 'B1', 'bidirectional'], [14, 'VCCB', 'power'],
  ]),
  supplyVolts: 'VCCA 1.2 V to 3.6 V; VCCB 1.65 V to 5.5 V (VCCA must not exceed VCCB)',
  keyRating:
    'Automatic direction sensing, ±15 kV HBM on the B port, 5 µA max ICC, VCC isolation puts all outputs high-impedance if either rail is at ground',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/txb0104.pdf',
  description:
    'Non-inverting four-bit translator between any of the 1.2, 1.5, 1.8, 2.5, 3.3 and 5 V nodes. Pins 6 and 9 are no-connect; OE sits on 8, is referenced to VCCA and needs a pull-down to stay off during power-up.',
};

/**
 * PCA9306 — I2C level translator built as two pass switches, not a driver.
 *
 * Because it is a switch, VREF1 may be as low as 1.2 V but the two rails must
 * stay at least 0.6 V apart, and the pass current is limited to 64 mA. EN gates
 * both sides. The datasheet's setup section is a warning as much as a schematic:
 * VREF2 needs an external resistance to VCC2 — the normal setup ties EN and VREF2
 * together into a 200 kΩ resistor — because wiring VREF2 straight to the rail
 * leaves nothing limiting the VCC2-to-VCC1 current through the pass FET.
 */
export const IC_PCA9306: InterfaceSpec = {
  id: 'translator-pca9306',
  partNumber: 'PCA9306',
  name: '2-bit I2C bus level translator',
  manufacturer: 'Texas Instruments',
  family: 'level-translator',
  package: 'SSOP-8 (DCT) / VSSOP-8 (DCU) / X2SON-8 (DQE) / DSBGA-8 (YZT)',
  pinCount: 8,
  pins: pins([
    [1, 'GND', 'power'], [2, 'VREF1', 'power'], [3, 'SCL1', 'bidirectional'],
    [4, 'SDA1', 'bidirectional'], [5, 'SDA2', 'bidirectional'], [6, 'SCL2', 'bidirectional'],
    [7, 'VREF2', 'power'], [8, 'EN', 'input'],
  ]),
  supplyVolts:
    'VREF1 1.2 V up to VREF2 - 0.6 V; VREF2 from VREF1 + 0.6 V up to 5.5 V (threshold about 0.6 V at room temperature)',
  keyRating:
    'Pass-switch topology with 64 mA max pass current, I/O rated 0 to 5.5 V, -40 to 85 C, ±2 kV HBM and ±1 kV CDM',
  datasheetUrl: 'https://www.ti.com/lit/ds/symlink/pca9306.pdf',
  description:
    'The two switch pairs that join a 1.8 V MCU I2C bus to a 5 V device: side 1 on SCL1/SDA1, side 2 mirrored as SDA2/SCL2, each referenced to its own VREF pin and gated by EN on pin 8. The part supplies no drive of its own, so the bus pull-ups still set the rise time on both sides.',
};

/**
 * LAN8720A — 10/100 Ethernet PHY with an RMII host interface.
 *
 * Three supplies, not one: VDDIO for the host side, VDD1A/VDD2A for the analog
 * front end, and VDDCR at 1.2 V from the on-chip regulator unless REGOFF is
 * strapped. Pins 2, 3, 7, 8, 10 and 11 double as configuration straps latched at
 * reset, which is why their buffer type in the datasheet is two-way. The line
 * pairs are analogue input/output on all four pins — the same copper transmits
 * and receives — and the datasheet states plainly that the digital signals are
 * not 5 V tolerant.
 */
export const IC_LAN8720A: InterfaceSpec = {
  id: 'phy-lan8720a',
  partNumber: 'LAN8720A',
  name: '10/100 Ethernet PHY with RMII',
  manufacturer: 'Microchip Technology (SMSC)',
  family: 'ethernet-phy',
  package: 'QFN-24 (4 x 4 x 0.85 mm) with exposed VSS pad',
  pinCount: 24,
  pins: pins([
    [1, 'VDD2A', 'power'], [2, 'LED2/nINTSEL', 'bidirectional'], [3, 'LED1/REGOFF', 'bidirectional'],
    [4, 'XTAL2', 'output'], [5, 'XTAL1/CLKIN', 'input'], [6, 'VDDCR', 'power'],
    [7, 'RXD1/MODE1', 'bidirectional'], [8, 'RXD0/MODE0', 'bidirectional'], [9, 'VDDIO', 'power'],
    [10, 'RXER/PHYAD0', 'bidirectional'], [11, 'CRS_DV/MODE2', 'bidirectional'], [12, 'MDIO', 'bidirectional'],
    [13, 'MDC', 'input'], [14, 'nINT/REFCLKO', 'output'], [15, 'nRST', 'input'],
    [16, 'TXEN', 'input'], [17, 'TXD0', 'input'], [18, 'TXD1', 'input'],
    [19, 'VDD1A', 'power'], [20, 'TXN', 'bidirectional'], [21, 'TXP', 'bidirectional'],
    [22, 'RXN', 'bidirectional'], [23, 'RXP', 'bidirectional'], [24, 'RBIAS', 'passive'],
  ]),
  supplyVolts:
    'VDDIO 1.6-3.6 V; VDD1A and VDD2A 3.3 V analog; VDDCR 1.2 V from the on-chip regulator unless REGOFF is strapped',
  keyRating:
    'RBIAS needs a 12.1 kΩ 1 % resistor to ground (1.2 V nominal, about 1 mW); the digital signals are not 5 V tolerant; the exposed pad is VSS and must be grounded',
  datasheetUrl: 'https://ww1.microchip.com/downloads/en/DeviceDoc/00002165B.pdf',
  description:
    'The PHY that turns an MCU RMII bus into a magnetics-coupled twisted pair: TXEN and TXD0/TXD1 are MAC inputs, RXD0/RXD1, RXER and CRS_DV are MAC outputs, MDIO/MDC carry the SMI register access, and the line-side pairs are analogue both ways. MODE0-MODE2 and PHYAD0 straps share the receive pins and latch at reset, so a load on those pins needs an external resistor.',
};

export const STANDARD_INTERFACE_PARTS: readonly InterfaceSpec[] = [
  IC_MAX3485, IC_SP3485, IC_SN65HVD230, IC_MAX232,
  IC_PC817, IC_4N35, IC_ULN2003A, Q_TIP120, Q_BSS138,
  IC_ISO7741, IC_TXB0104, IC_PCA9306, IC_LAN8720A,
];

/** Find an interface part by part number. Fail-loud on unknown parts. */
export function interfaceByPartNumber(partNumber: string): InterfaceSpec {
  const found = STANDARD_INTERFACE_PARTS.find((part) => part.partNumber === partNumber);
  if (!found) throw new Error(`Unknown interface part number: ${partNumber}.`);
  return found;
}
