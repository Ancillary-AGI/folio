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
  });

  it('rejects synthesis with empty gate list', () => {
    expect(() => synthesizeGates('empty', [], [], [])).toThrow(/empty/);
  });
});
