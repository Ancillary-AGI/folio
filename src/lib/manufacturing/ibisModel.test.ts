import { describe, expect, it } from 'vitest';
import { driverImpedance, ivCurrent, parseIbis, parseSI } from './ibisModel';

const IBS = `[IBIS Ver] 3.2
[File Name] demo.ibs
[Component] DEMO_QFP
[Pin] signal_name model_name
1 DQ0 FAST_IO
2 DQ1 FAST_IO
[Model] FAST_IO
Model_type I/O
C_comp 2.5pF 2.0pF 3.0pF
[Pulldown]
| V I
-0.5 -10m
0.0 0.0
0.5 12m
1.0 25m
[Pullup]
| V I (referenced to VCC=3.3)
-3.3 -25m
-2.8 -12m
-2.3 0.0
[GND Clamp]
-1.0 -30m
-0.5 -5m
0.0 0.0
[End]
`;

describe('IBIS buffer models', () => {
  it('parses components, pins, models, C_comp, and I-V tables', () => {
    const file = parseIbis(IBS);
    expect(file.version).toBe('3.2');
    expect(file.components).toHaveLength(1);
    expect(file.components[0].pins).toEqual([
      { pin: '1', signal: 'DQ0', model: 'FAST_IO' },
      { pin: '2', signal: 'DQ1', model: 'FAST_IO' },
    ]);
    const model = file.models[0];
    expect(model.modelType).toBe('I/O');
    expect(model.cComp.typical).toBeCloseTo(2.5e-12, 20);
    expect(model.cComp.min).toBeCloseTo(2.0e-12, 20);
    expect(model.pulldown).toHaveLength(4);
    expect(model.pullup).toHaveLength(3);
    expect(model.gndClamp).toHaveLength(3);
  });
  it('interpolates I-V current and derives driver impedance', () => {
    const file = parseIbis(IBS);
    const model = file.models[0];
    // Midpoint of the 0.5V/12mA -> 1.0V/25mA segment at 0.75V.
    expect(ivCurrent(model.pulldown, 0.75)).toBeCloseTo(0.0185, 9);
    // dV/dI over that segment: 0.5V / 13mA ≈ 38.5 ohm.
    expect(driverImpedance(model, 0.75, false)).toBeCloseTo(0.5 / 0.013, 6);
    expect(() => ivCurrent(model.pulldown, 5)).toThrow(/outside I-V range/);
  });
  it('parses SI suffixes and rejects malformed input', () => {
    expect(parseSI('2.5pF', 1, '')).toBeCloseTo(2.5e-12, 20);
    expect(parseSI('-10m', 1, '')).toBeCloseTo(-0.01, 9);
    expect(parseSI('100MHz', 1, '')).toBeCloseTo(1e8, 0);
    expect(() => parseSI('3.3Q', 1, '')).toThrow(/prefix/);
    expect(() => parseIbis('garbage')).toThrow(/IBIS Ver/);
    expect(() => parseIbis('[IBIS Ver] 3.2\n[Model] NO_TABLES\nModel_type Output\nC_comp 1pF\n[End]')).toThrow(/no Pullup\/Pulldown/);
    expect(() => parseIbis('[IBIS Ver] 3.2\n[Model] NO_CCOMP\nModel_type Output\n[Pullup]\n0 0\n1 0.01\n[End]')).toThrow(/C_comp/);
  });
});
