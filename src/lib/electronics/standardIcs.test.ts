import { describe, expect, it } from 'vitest';
import {
  astable555,
  gateUnits,
  IC_74HC00,
  IC_74HC02,
  IC_74HC04,
  IC_74HC08,
  IC_74HC32,
  IC_74HC86,
  IC_NE555,
  monostable555,
  STANDARD_LOGIC_ICS,
  type LogicGateSpec,
} from './standardIcs';

describe('74-series pinouts', () => {
  it('gives every part fourteen pins numbered 1 to 14 with GND on 7 and VCC on 14', () => {
    for (const spec of STANDARD_LOGIC_ICS) {
      expect(spec.pinCount).toBe(14);
      expect(spec.pins).toHaveLength(14);
      const numbers = spec.pins.map((pin) => pin.number).sort((a, b) => a - b);
      expect(numbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
      expect(spec.pins.find((pin) => pin.name === 'GND')?.number).toBe(7);
      expect(spec.pins.find((pin) => pin.name === 'VCC')?.number).toBe(14);
    }
  });

  it('puts the 7400 NAND on its datasheet pins, including the mirrored second half', () => {
    const byNumber = new Map(IC_74HC00.pins.map((pin) => [pin.number, pin.name]));
    expect(byNumber.get(1)).toBe('1A');
    expect(byNumber.get(2)).toBe('1B');
    expect(byNumber.get(3)).toBe('1Y');
    expect(byNumber.get(4)).toBe('2A');
    expect(byNumber.get(6)).toBe('2Y');
    // Gates 3 and 4 run output-first, the reversal every datasheet shows.
    expect(byNumber.get(8)).toBe('3Y');
    expect(byNumber.get(9)).toBe('3A');
    expect(byNumber.get(10)).toBe('3B');
    expect(byNumber.get(11)).toBe('4Y');
    expect(byNumber.get(12)).toBe('4A');
    expect(byNumber.get(13)).toBe('4B');
  });

  it('puts the 7402 NOR on its own layout, which differs from the 7400', () => {
    const byNumber = new Map(IC_74HC02.pins.map((pin) => [pin.number, pin.name]));
    expect(byNumber.get(1)).toBe('1Y');
    expect(byNumber.get(2)).toBe('1A');
    expect(byNumber.get(3)).toBe('1B');
    expect(byNumber.get(4)).toBe('2Y');
    expect(byNumber.get(8)).toBe('3A');
    expect(byNumber.get(9)).toBe('3B');
    expect(byNumber.get(10)).toBe('3Y');
    expect(byNumber.get(11)).toBe('4A');
    expect(byNumber.get(12)).toBe('4B');
    expect(byNumber.get(13)).toBe('4Y');
  });

  it('alternates A and Y down the hex inverter', () => {
    const byNumber = new Map(IC_74HC04.pins.map((pin) => [pin.number, pin.kind]));
    for (const [input, output] of [
      [1, 2],
      [3, 4],
      [5, 6],
      [9, 8],
      [11, 10],
      [13, 12],
    ] as const) {
      expect(byNumber.get(input)).toBe('input');
      expect(byNumber.get(output)).toBe('output');
    }
  });

  it('shares the standard quad layout across AND, OR and XOR', () => {
    for (const spec of [IC_74HC08, IC_74HC32, IC_74HC86]) {
      const byNumber = new Map(spec.pins.map((pin) => [pin.number, pin.name]));
      expect(byNumber.get(1)).toBe('1A');
      expect(byNumber.get(3)).toBe('1Y');
      expect(byNumber.get(4)).toBe('2A');
      expect(byNumber.get(6)).toBe('2Y');
      expect(byNumber.get(8)).toBe('3Y');
      expect(byNumber.get(9)).toBe('3A');
      expect(byNumber.get(11)).toBe('4Y');
      expect(byNumber.get(12)).toBe('4A');
    }
  });
});

describe('gate units', () => {
  it('splits every quad part into four two-input gates on pins of the right kind', () => {
    for (const spec of [IC_74HC00, IC_74HC02, IC_74HC08, IC_74HC32, IC_74HC86]) {
      const units = gateUnits(spec);
      expect(units).toHaveLength(4);
      expect(units.map((unit) => unit.label)).toEqual(['1', '2', '3', '4']);
      for (const unit of units) {
        expect(unit.inputs).toHaveLength(2);
        expect(spec.pins.find((pin) => pin.number === unit.output)?.kind).toBe('output');
        for (const input of unit.inputs) {
          expect(spec.pins.find((pin) => pin.number === input)?.kind).toBe('input');
        }
      }
    }
  });

  it('splits the hex inverter into six single-input gates', () => {
    const units = gateUnits(IC_74HC04);
    expect(units).toHaveLength(6);
    expect(units[0].inputs).toEqual([1]);
    expect(units[0].output).toBe(2);
    expect(units[5].inputs).toEqual([13]);
    expect(units[5].output).toBe(12);
  });

  it('never assigns one pin to two gates', () => {
    for (const spec of STANDARD_LOGIC_ICS) {
      const used = gateUnits(spec).flatMap((unit) => [...unit.inputs, unit.output]);
      expect(new Set(used).size).toBe(used.length);
    }
  });

  it('refuses to split a sequential part', () => {
    const sequential = { ...IC_74HC00, gate: undefined } as LogicGateSpec;
    expect(() => gateUnits(sequential)).toThrow(/not a combinational/);
  });

  it('refuses a package that declares more gates than it has pins for', () => {
    expect(() => gateUnits({ ...IC_74HC00, unitsPerPackage: 5 })).toThrow(/names only 4/);
  });

  it('refuses a gate with no output or the wrong input count', () => {
    const noOutput = {
      ...IC_74HC00,
      pins: IC_74HC00.pins.map((pin) =>
        pin.name === '1Y' ? { ...pin, kind: 'input' as const } : pin,
      ),
    };
    expect(() => gateUnits(noOutput)).toThrow(/gate 1 has no output pin/);

    const wrongInputs = {
      ...IC_74HC00,
      pins: IC_74HC00.pins.filter((pin) => pin.name !== '1B'),
    };
    expect(() => gateUnits(wrongInputs)).toThrow(/gate 1 has 1 inputs, expected 2/);
  });
});

describe('datasheet truth tables', () => {
  /** Every published row, written out rather than generated. */
  const ROWS: Array<[string, number, number, number]> = [
    ['NAND', 0, 0, 1], ['NAND', 0, 1, 1], ['NAND', 1, 0, 1], ['NAND', 1, 1, 0],
    ['AND', 0, 0, 0], ['AND', 0, 1, 0], ['AND', 1, 0, 0], ['AND', 1, 1, 1],
    ['OR', 0, 0, 0], ['OR', 0, 1, 1], ['OR', 1, 0, 1], ['OR', 1, 1, 1],
    ['NOR', 0, 0, 1], ['NOR', 0, 1, 0], ['NOR', 1, 0, 0], ['NOR', 1, 1, 0],
    ['XOR', 0, 0, 0], ['XOR', 0, 1, 1], ['XOR', 1, 0, 1], ['XOR', 1, 1, 0],
    ['NOT', 0, 0, 1], ['NOT', 1, 0, 0],
  ];

  it('has one library part for every gate in the tables', () => {
    const gates = new Set(ROWS.map(([gate]) => gate));
    const shipped = new Set(STANDARD_LOGIC_ICS.map((spec) => spec.gate));
    expect(shipped).toEqual(gates);
  });

  it('agrees with the published rows, including NAND as the inverse of AND', () => {
    const and = new Map(ROWS.filter(([g]) => g === 'AND').map(([, a, b, y]) => [`${a}${b}`, y]));
    const nand = new Map(ROWS.filter(([g]) => g === 'NAND').map(([, a, b, y]) => [`${a}${b}`, y]));
    for (const key of ['00', '01', '10', '11']) {
      expect(nand.get(key)).toBe(and.get(key) === 1 ? 0 : 1);
    }
    // XOR is parity, so the two rows with an odd number of ones are the only highs.
    const highs = ROWS.filter(([g, , , y]) => g === 'XOR' && y === 1).map(([, a, b]) => a + b);
    expect(highs).toEqual([1, 1]);
  });

  it('gives the inverter a single input per gate and the rest two', () => {
    for (const spec of STANDARD_LOGIC_ICS) {
      expect(spec.inputsPerGate).toBe(spec.gate === 'NOT' ? 1 : 2);
      expect(spec.unitsPerPackage).toBe(spec.gate === 'NOT' ? 6 : 4);
    }
  });

  it('quotes plausible HC-family propagation delays', () => {
    for (const spec of STANDARD_LOGIC_ICS) {
      expect(spec.typicalDelayNs).toBeGreaterThan(5);
      expect(spec.typicalDelayNs).toBeLessThan(25);
    }
  });
});

describe('NE555 timer', () => {
  it('matches the 8-pin datasheet pinout', () => {
    const byNumber = new Map(IC_NE555.pins.map((pin) => [pin.number, pin]));
    expect(IC_NE555.pinCount).toBe(8);
    expect(IC_NE555.pins).toHaveLength(8);
    expect(byNumber.get(1)?.name).toBe('GND');
    expect(byNumber.get(2)?.name).toBe('TRIG');
    expect(byNumber.get(3)?.name).toBe('OUT');
    expect(byNumber.get(4)?.name).toBe('RESET');
    expect(byNumber.get(5)?.name).toBe('CTRL');
    expect(byNumber.get(6)?.name).toBe('THRES');
    expect(byNumber.get(7)?.name).toBe('DISCH');
    expect(byNumber.get(8)?.name).toBe('VCC');
    expect(byNumber.get(3)?.kind).toBe('output');
    expect(byNumber.get(7)?.kind).toBe('output');
  });

  it('trips its comparators at one and two thirds of the supply', () => {
    // Three equal 5 kΩ resistors in the internal divider.
    expect(IC_NE555.triggerFraction).toBeCloseTo(1 / 3, 15);
    expect(IC_NE555.thresholdFraction).toBeCloseTo(2 / 3, 15);
    expect(IC_NE555.thresholdFraction).toBeCloseTo(2 * IC_NE555.triggerFraction, 15);
  });

  it('operates over the datasheet supply range', () => {
    expect(IC_NE555.supplyMin).toBeLessThanOrEqual(5);
    expect(IC_NE555.supplyMax).toBeGreaterThanOrEqual(15);
    expect(IC_NE555.maxOutputCurrent).toBeGreaterThan(0.1);
  });
});

describe('555 timing formulas', () => {
  it('matches the astable datasheet example: 10k, 10k, 100nF gives about 480 Hz', () => {
    // The worked example on every datasheet: R1 = R2 = 10 kΩ, C = 100 nF.
    const result = astable555(10e3, 10e3, 100e-9);
    expect(result.frequency).toBeGreaterThan(470);
    expect(result.frequency).toBeLessThan(490);
    expect(result.highTime).toBeCloseTo(Math.LN2 * 20e3 * 100e-9, 15);
    expect(result.lowTime).toBeCloseTo(Math.LN2 * 10e3 * 100e-9, 15);
  });

  it('reproduces the 1.44/((R1 + 2R2)C) rule of thumb to within its rounding', () => {
    const r1 = 4.7e3;
    const r2 = 33e3;
    const c = 10e-9;
    const result = astable555(r1, r2, c);
    const exact = 1 / (Math.LN2 * (r1 + 2 * r2) * c);
    expect(result.frequency).toBeCloseTo(exact, 6);
    // 1.44 is 1/ln2 rounded to two decimals, so the rule of thumb sits about 0.2% low.
    const ruleOfThumb = 1.44 / ((r1 + 2 * r2) * c);
    const relativeError = Math.abs(result.frequency - ruleOfThumb) / result.frequency;
    expect(relativeError).toBeLessThan(0.005);
  });

  it('bounds the duty cycle above 50%, because R1 always charges', () => {
    for (const [r1, r2] of [
      [1e3, 1e3],
      [1e3, 100e3],
      [100e3, 1e3],
    ] as const) {
      const result = astable555(r1, r2, 1e-8);
      expect(result.dutyCycle).toBeGreaterThan(0.5);
      expect(result.dutyCycle).toBeLessThan(1);
      expect(result.period).toBeCloseTo(result.highTime + result.lowTime, 18);
      expect(result.frequency).toBeCloseTo(1 / result.period, 12);
    }
  });

  it('drives the duty cycle toward 100% as R2 shrinks against R1', () => {
    // duty = (R1 + R2)/(R1 + 2R2), so it approaches 1 only when R2 << R1.
    const skewed = astable555(1e6, 1, 1e-9);
    expect(skewed.dutyCycle).toBeGreaterThan(0.999);
    // t_high = ln2(R1 + R2)C and t_low = ln2·R2·C, so halving R2 halves the low time
    // while the high time falls only by the R2 share of R1 + R2.
    const base = astable555(10e3, 10e3, 1e-9);
    const halved = astable555(10e3, 5e3, 1e-9);
    expect(halved.lowTime / base.lowTime).toBeCloseTo(0.5, 12);
    expect(halved.highTime / base.highTime).toBeCloseTo(15e3 / 20e3, 12);
  });

  it('drives the duty cycle toward 50% as R1 shrinks against R2', () => {
    // The other limit: a vanishing R1 leaves an almost symmetric output.
    const nearSquare = astable555(1, 1e6, 1e-9);
    expect(nearSquare.dutyCycle).toBeLessThan(0.51);
    expect(nearSquare.dutyCycle).toBeGreaterThanOrEqual(0.5);
  });

  it('matches the monostable 1.1RC rule of thumb and the exact ln3', () => {
    const exact = monostable555(10e3, 100e-9);
    expect(exact).toBeCloseTo(Math.log(3) * 10e3 * 100e-9, 15);
    expect(exact).toBeCloseTo(1.1 * 10e3 * 100e-9, 4);
    expect(exact).toBeGreaterThan(1.09 * 10e3 * 100e-9);
    expect(exact).toBeLessThan(1.11 * 10e3 * 100e-9);
  });

  it('scales both timings linearly with capacitance', () => {
    const single = astable555(10e3, 10e3, 1e-9);
    const decade = astable555(10e3, 10e3, 1e-8);
    expect(decade.frequency / single.frequency).toBeCloseTo(0.1, 12);
    expect(monostable555(10e3, 1e-8) / monostable555(10e3, 1e-9)).toBeCloseTo(10, 12);
  });

  it('rejects a non-positive component value', () => {
    expect(() => astable555(0, 1e3, 1e-9)).toThrow(/R1/);
    expect(() => astable555(1e3, 0, 1e-9)).toThrow(/R2/);
    expect(() => astable555(1e3, 1e3, 0)).toThrow(/capacitance/);
    expect(() => monostable555(-1, 1e-9)).toThrow(/resistance/);
    expect(() => monostable555(1e3, Number.NaN)).toThrow(/capacitance/);
  });
});

