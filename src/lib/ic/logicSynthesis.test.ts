import { describe, expect, it } from 'vitest';
import { synthesizeGates, type GatePrimitive } from './logicSynthesis';

describe('Silicon Logic Synthesis & STA', () => {
  it('synthesizes a 1-bit full adder and computes core area and critical path', () => {
    // 1-bit Full Adder:
    // S = A ^ B ^ Cin (two XOR2 gates)
    // Cout = (A & B) | (Cin & (A ^ B)) (AND2, XOR2, AND2, OR2)
    const gates: GatePrimitive[] = [
      { id: 'xor_ab', kind: 'XOR2', inputs: { A: 'A', B: 'B' }, outputs: { X: 'wire_ab' } },
      { id: 'xor_sum', kind: 'XOR2', inputs: { A: 'wire_ab', B: 'Cin' }, outputs: { X: 'Sum' } },
      { id: 'and_ab', kind: 'AND2', inputs: { A: 'A', B: 'B' }, outputs: { X: 'wire_and_ab' } },
      { id: 'and_cin_ab', kind: 'AND2', inputs: { A: 'wire_ab', B: 'Cin' }, outputs: { X: 'wire_and_cin' } },
      { id: 'or_cout', kind: 'OR2', inputs: { A: 'wire_and_ab', B: 'wire_and_cin' }, outputs: { X: 'Cout' } },
    ];

    const result = synthesizeGates('full_adder_1bit', gates, ['A', 'B', 'Cin'], ['Sum', 'Cout']);

    expect(result.metrics.gateCount).toBe(5);
    expect(result.metrics.totalCellAreaUm2).toBeGreaterThan(0);
    expect(result.metrics.criticalPathDelayPs).toBeGreaterThan(100); // 2 cascaded gates > 100ps
    expect(result.metrics.maxOperatingFreqMhz).toBeGreaterThan(500); // Sky130 full adder easily exceeds 500 MHz
    expect(result.instances.length).toBe(5);
    expect(result.nets.get('Sum')).toBeDefined();
    expect(result.nets.get('Cout')).toBeDefined();
    expect(result.metrics.criticalPath.length).toBeGreaterThanOrEqual(3);
    expect(['A', 'B', 'Cin']).toContain(result.metrics.criticalPath[0]);
    expect(['Sum', 'Cout']).toContain(result.metrics.criticalPath[result.metrics.criticalPath.length - 1]);
    expect(result.metrics.criticalPath).toEqual([...new Set(result.metrics.criticalPath)]);
  });

  it('rejects a combinational loop instead of reporting a timing result', () => {
    const loop: GatePrimitive[] = [
      { id: 'gate', kind: 'AND2', inputs: { A: 'a', B: 'fb' }, outputs: { X: 'm' } },
      { id: 'inv', kind: 'INV', inputs: { A: 'm' }, outputs: { Y: 'fb' } },
    ];
    expect(() => synthesizeGates('loop', loop, ['a'], ['m'])).toThrow(/Combinational loop detected/);
  });

  it('rejects an undriven primary output instead of reporting 0 ps', () => {
    const and: GatePrimitive[] = [
      { id: 'and', kind: 'AND2', inputs: { A: 'a', B: 'b' }, outputs: { X: 'y' } },
    ];
    expect(() => synthesizeGates('floating', and, ['a', 'b'], ['z'])).toThrow(/no timing path/);
  });

  it('rejects a net with multiple drivers', () => {
    const double: GatePrimitive[] = [
      { id: 'i1', kind: 'INV', inputs: { A: 'a' }, outputs: { Y: 'y' } },
      { id: 'i2', kind: 'INV', inputs: { A: 'b' }, outputs: { Y: 'y' } },
    ];
    expect(() => synthesizeGates('double', double, ['a', 'b'], ['y'])).toThrow(/multiple drivers/);
  });

  it('rejects synthesis with empty gate list', () => {
    expect(() => synthesizeGates('empty', [], [], [])).toThrow(/empty/);
  });

  it('rejects a non-finite or negative clock frequency', () => {
    const inv: GatePrimitive[] = [
      { id: 'i1', kind: 'INV', inputs: { A: 'a' }, outputs: { Y: 'y' } },
    ];
    expect(() => synthesizeGates('bad-clock', inv, ['a'], ['y'], Number.NaN)).toThrow(/Clock frequency/);
    expect(() => synthesizeGates('bad-clock', inv, ['a'], ['y'], -10)).toThrow(/Clock frequency/);
  });
});
