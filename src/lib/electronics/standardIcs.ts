/**
 * Standard integrated circuits — the parts a real design is actually built from.
 *
 * The component library carried three logic gates and a handful of pinless blocks
 * labelled "Arduino Uno" and "WiFi Module". None of that can carry a design: there is no
 * NAND to build a latch from, no flip-flop to hold state, no 555 to time anything, and
 * no MCU entry with a pin you could connect.
 *
 * Every part here is described the way its datasheet describes it: a pin count, real pin
 * numbers, and behaviour that can be checked against the published truth table or timing
 * formula. The companion test asserts those tables and formulas rather than restating the
 * implementation, so a wrong pinout or a mistyped constant fails loudly.
 *
 * This module is pure data plus pure functions. It imports nothing from the simulator or
 * the renderer, so the same description drives the symbol, the netlist and the digital
 * engine without any of them knowing about each other.
 */

/** Logic level, matching the four-state digital engine. */
export type LogicLevel = 0 | 1;

export type PinKind = 'input' | 'output' | 'power' | 'passive' | 'bidirectional';

export interface IcPin {
  /** Datasheet pin number. */
  number: number;
  name: string;
  kind: PinKind;
}

export type IcFamily = 'logic' | 'analog' | 'timer' | 'interface';

export interface LogicGateSpec {
  id: string;
  /** Manufacturer part number, e.g. `74HC00`. */
  partNumber: string;
  name: string;
  family: IcFamily;
  /** Gates or cells per package. */
  unitsPerPackage: number;
  /** Total pins on the package. */
  pinCount: number;
  pins: readonly IcPin[];
  /** `AND`/`NAND`/`OR`/`NOR`/`XOR`/`NOT`, or `null` for a sequential part. */
  gate?: 'AND' | 'NAND' | 'OR' | 'NOR' | 'XOR' | 'NOT';
  /** Inputs per gate; 2 for the standard gates, 1 for an inverter. */
  inputsPerGate: number;
  /** Propagation delay in nanoseconds, typical, for the HC family at 5 V. */
  typicalDelayNs: number;
  description: string;
}

/** Every gate in a package, as an inclusive pin-number range. */
export interface GateUnit {
  /** Index of this gate within the package, zero-based. */
  index: number;
  /** Gate label used on the datasheet, e.g. `1` for the first NAND of a 7400. */
  label: string;
  inputs: readonly number[];
  output: number;
}

/**
 * Splits a logic package's pin list into its individual gates.
 *
 * Grouping is by the gate label in each pin's **name**, not by pin position: the 74HC00
 * puts gate 3's output on pin 8 before its inputs on 9 and 10, so a consecutive run
 * through the sorted pin numbers assigns the wrong pin kinds to gates 3 and 4. Reading
 * the label is what the datasheet itself does, and it survives every mirrored layout.
 */
export function gateUnits(spec: LogicGateSpec): GateUnit[] {
  if (!spec.gate) {
    throw new Error(`${spec.partNumber} is not a combinational gate package.`);
  }
  const labelOf = (name: string): string | null => {
    const match = /^(\d+)[ABY]$/.exec(name);
    return match ? match[1] : null;
  };

  const byLabel = new Map<string, { inputs: number[]; output?: number }>();
  for (const pin of spec.pins) {
    const label = labelOf(pin.name);
    if (label === null) continue;
    const entry = byLabel.get(label) ?? { inputs: [] };
    if (pin.kind === 'output') entry.output = pin.number;
    else entry.inputs.push(pin.number);
    byLabel.set(label, entry);
  }

  const labels = [...byLabel.keys()].sort((a, b) => Number(a) - Number(b));
  if (labels.length < spec.unitsPerPackage) {
    throw new Error(
      `${spec.partNumber} declares ${spec.unitsPerPackage} gates but names only ${labels.length}.`,
    );
  }

  return labels.slice(0, spec.unitsPerPackage).map((label, index) => {
    const entry = byLabel.get(label)!;
    if (entry.output === undefined) {
      throw new Error(`${spec.partNumber} gate ${label} has no output pin.`);
    }
    if (entry.inputs.length !== spec.inputsPerGate) {
      throw new Error(
        `${spec.partNumber} gate ${label} has ${entry.inputs.length} inputs, expected ${spec.inputsPerGate}.`,
      );
    }
    return { index, label, inputs: entry.inputs.sort((a, b) => a - b), output: entry.output };
  });
}

/** Power pins shared by every 74-series part: GND on 7, VCC on 14. */
const POWER_PINS: readonly IcPin[] = [
  { number: 7, name: 'GND', kind: 'power' },
  { number: 14, name: 'VCC', kind: 'power' },
];

/**
 * Pin list for the standard quad 2-input DIP.
 *
 * Gates 1 and 2 run forward — `A, B, Y` on pins 1-3 and 4-6 — but gates 3 and 4 are
 * mirrored — `Y, A, B` on pins 8-10 and 11-13. That reversal is in every datasheet and
 * is the single most common thing a generator gets wrong, so it is written out here
 * rather than produced by a uniform loop.
 */
function quadTwoInputPins(): IcPin[] {
  const gate = (label: string, offset: number, mirrored: boolean): IcPin[] =>
    mirrored
      ? [
          { number: offset, name: `${label}Y`, kind: 'output' },
          { number: offset + 1, name: `${label}A`, kind: 'input' },
          { number: offset + 2, name: `${label}B`, kind: 'input' },
        ]
      : [
          { number: offset, name: `${label}A`, kind: 'input' },
          { number: offset + 1, name: `${label}B`, kind: 'input' },
          { number: offset + 2, name: `${label}Y`, kind: 'output' },
        ];

  return [
    ...gate('1', 1, false),
    ...gate('2', 4, false),
    ...POWER_PINS,
    ...gate('3', 8, true),
    ...gate('4', 11, true),
  ];
}

/**
 * 74HC00 — quad 2-input NAND. Datasheet pinout: 1A/1B/1Y, 2A/2B/2Y, GND, 3Y/3A/3B,
 * 4Y/4A/4B, VCC. Note the second half runs in reverse pin order, which is exactly the
 * detail a naive generator gets wrong.
 */
export const IC_74HC00: LogicGateSpec = {
  id: '74hc00',
  partNumber: '74HC00',
  name: 'Quad 2-input NAND',
  family: 'logic',
  unitsPerPackage: 4,
  pinCount: 14,
  gate: 'NAND',
  inputsPerGate: 2,
  typicalDelayNs: 9,
  description: 'Four independent 2-input NAND gates. The universal gate: any logic function can be built from these.',
  pins: [
    { number: 1, name: '1A', kind: 'input' },
    { number: 2, name: '1B', kind: 'input' },
    { number: 3, name: '1Y', kind: 'output' },
    { number: 4, name: '2A', kind: 'input' },
    { number: 5, name: '2B', kind: 'input' },
    { number: 6, name: '2Y', kind: 'output' },
    ...POWER_PINS,
    { number: 8, name: '3Y', kind: 'output' },
    { number: 9, name: '3A', kind: 'input' },
    { number: 10, name: '3B', kind: 'input' },
    { number: 11, name: '4Y', kind: 'output' },
    { number: 12, name: '4A', kind: 'input' },
    { number: 13, name: '4B', kind: 'input' },
  ],
};

/** 74HC02 — quad 2-input NOR. */
export const IC_74HC02: LogicGateSpec = {
  id: '74hc02',
  partNumber: '74HC02',
  name: 'Quad 2-input NOR',
  family: 'logic',
  unitsPerPackage: 4,
  pinCount: 14,
  gate: 'NOR',
  inputsPerGate: 2,
  typicalDelayNs: 9,
  description: 'Four independent 2-input NOR gates. With a NAND, one of the two gates from which all logic can be built.',
  pins: [
    { number: 1, name: '1Y', kind: 'output' },
    { number: 2, name: '1A', kind: 'input' },
    { number: 3, name: '1B', kind: 'input' },
    { number: 4, name: '2Y', kind: 'output' },
    { number: 5, name: '2A', kind: 'input' },
    { number: 6, name: '2B', kind: 'input' },
    ...POWER_PINS,
    { number: 8, name: '3A', kind: 'input' },
    { number: 9, name: '3B', kind: 'input' },
    { number: 10, name: '3Y', kind: 'output' },
    { number: 11, name: '4A', kind: 'input' },
    { number: 12, name: '4B', kind: 'input' },
    { number: 13, name: '4Y', kind: 'output' },
  ],
};

/** 74HC08 — quad 2-input AND. */
export const IC_74HC08: LogicGateSpec = {
  id: '74hc08',
  partNumber: '74HC08',
  name: 'Quad 2-input AND',
  family: 'logic',
  unitsPerPackage: 4,
  pinCount: 14,
  gate: 'AND',
  inputsPerGate: 2,
  typicalDelayNs: 10,
  description: 'Four independent 2-input AND gates.',
  pins: quadTwoInputPins(),
};

/** 74HC32 — quad 2-input OR. */
export const IC_74HC32: LogicGateSpec = {
  id: '74hc32',
  partNumber: '74HC32',
  name: 'Quad 2-input OR',
  family: 'logic',
  unitsPerPackage: 4,
  pinCount: 14,
  gate: 'OR',
  inputsPerGate: 2,
  typicalDelayNs: 10,
  description: 'Four independent 2-input OR gates.',
  pins: quadTwoInputPins(),
};

/** 74HC86 — quad 2-input XOR. */
export const IC_74HC86: LogicGateSpec = {
  id: '74hc86',
  partNumber: '74HC86',
  name: 'Quad 2-input XOR',
  family: 'logic',
  unitsPerPackage: 4,
  pinCount: 14,
  gate: 'XOR',
  inputsPerGate: 2,
  typicalDelayNs: 12,
  description: 'Four independent 2-input exclusive-OR gates. An XOR with all inputs tied together is an inverter, and a bank of them is an adder.',
  pins: quadTwoInputPins(),
};

/**
 * 74HC04 — hex inverter. The datasheet keeps input and output adjacent rather than
 * grouping, so pins alternate A/Y down the package.
 */
export const IC_74HC04: LogicGateSpec = {
  id: '74hc04',
  partNumber: '74HC04',
  name: 'Hex inverter',
  family: 'logic',
  unitsPerPackage: 6,
  pinCount: 14,
  gate: 'NOT',
  inputsPerGate: 1,
  typicalDelayNs: 9,
  description: 'Six independent inverters. The cheapest source of logic negation, and the building block of ring oscillators.',
  pins: [
    { number: 1, name: '1A', kind: 'input' },
    { number: 2, name: '1Y', kind: 'output' },
    { number: 3, name: '2A', kind: 'input' },
    { number: 4, name: '2Y', kind: 'output' },
    { number: 5, name: '3A', kind: 'input' },
    { number: 6, name: '3Y', kind: 'output' },
    ...POWER_PINS,
    { number: 8, name: '4Y', kind: 'output' },
    { number: 9, name: '4A', kind: 'input' },
    { number: 10, name: '5Y', kind: 'output' },
    { number: 11, name: '5A', kind: 'input' },
    { number: 12, name: '6Y', kind: 'output' },
    { number: 13, name: '6A', kind: 'input' },
  ],
};

/** Every combinational 74-series part this library ships. */
export const STANDARD_LOGIC_ICS: readonly LogicGateSpec[] = [
  IC_74HC00,
  IC_74HC02,
  IC_74HC04,
  IC_74HC08,
  IC_74HC32,
  IC_74HC86,
];

/* ------------------------------------------------------------------ *
 * 555 timer
 * ------------------------------------------------------------------ */

/** NE555 in the standard 8-pin DIP. */
export const IC_NE555_PINS: readonly IcPin[] = [
  { number: 1, name: 'GND', kind: 'power' },
  { number: 2, name: 'TRIG', kind: 'input' },
  { number: 3, name: 'OUT', kind: 'output' },
  { number: 4, name: 'RESET', kind: 'input' },
  { number: 5, name: 'CTRL', kind: 'input' },
  { number: 6, name: 'THRES', kind: 'input' },
  { number: 7, name: 'DISCH', kind: 'output' },
  { number: 8, name: 'VCC', kind: 'power' },
];

export interface Timer555Spec {
  id: string;
  partNumber: string;
  name: string;
  family: 'timer';
  pinCount: number;
  pins: readonly IcPin[];
  /** Threshold and trigger sit at these fractions of VCC. */
  thresholdFraction: number;
  triggerFraction: number;
  /** Datasheet operating range, volts. */
  supplyMin: number;
  supplyMax: number;
  /** Output current the part can sink or source, amps. */
  maxOutputCurrent: number;
  description: string;
}

export const IC_NE555: Timer555Spec = {
  id: 'ne555',
  partNumber: 'NE555',
  name: 'Precision timer',
  family: 'timer',
  pinCount: 8,
  pins: IC_NE555_PINS,
  // The internal divider is three equal 5 kΩ resistors, so the comparators trip at
  // 2/3 and 1/3 of the supply. Both are derived from the same constant.
  thresholdFraction: 2 / 3,
  triggerFraction: 1 / 3,
  supplyMin: 4.5,
  supplyMax: 16,
  maxOutputCurrent: 0.2,
  description:
    'Astable or monostable timer from two comparators, a flip-flop and a discharge transistor. ' +
    'The comparators trip at 2/3 and 1/3 of VCC, which is where every timing formula comes from.',
};

export interface AstableResult {
  /** Output high time, seconds. */
  highTime: number;
  /** Output low time, seconds. */
  lowTime: number;
  /** Full period, seconds. */
  period: number;
  /** Hertz. */
  frequency: number;
  /** High fraction of the period, between 0.5 and 1. */
  dutyCycle: number;
}

/**
 * Astable 555 timing from the datasheet: `t_high = ln2·(R1 + R2)·C`,
 * `t_low = ln2·R2·C`, so `f = 1.44/((R1 + 2R2)·C)` and the duty cycle is bounded below
 * by 50% because `R1` always contributes to the high time.
 */
export function astable555(
  r1: number,
  r2: number,
  capacitance: number,
): AstableResult {
  if (!(r1 > 0)) throw new Error(`R1 must be positive, got ${r1}.`);
  if (!(r2 > 0)) throw new Error(`R2 must be positive, got ${r2}.`);
  if (!(capacitance > 0)) throw new Error(`capacitance must be positive, got ${capacitance}.`);
  const ln2 = Math.LN2;
  const highTime = ln2 * (r1 + r2) * capacitance;
  const lowTime = ln2 * r2 * capacitance;
  const period = highTime + lowTime;
  return {
    highTime,
    lowTime,
    period,
    frequency: 1 / period,
    dutyCycle: highTime / period,
  };
}

/**
 * Monostable pulse width: `t = ln3·R·C ≈ 1.1·R·C`.
 *
 * The exact constant is `ln 3` because the capacitor charges from 0 toward VCC and the
 * comparator trips at 2/3, so `1 − e^{−t/RC} = 2/3`.
 */
export function monostable555(resistance: number, capacitance: number): number {
  if (!(resistance > 0)) throw new Error(`resistance must be positive, got ${resistance}.`);
  if (!(capacitance > 0)) throw new Error(`capacitance must be positive, got ${capacitance}.`);
  return Math.log(3) * resistance * capacitance;
}


