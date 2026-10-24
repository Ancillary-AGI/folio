import { describe, expect, it } from 'vitest';
import {
  verifyBooleanEquivalence,
  verifyCircuitTopology,
  type CircuitNode,
} from './symbolicVerifier';

describe('Symbolic Verifier for AI Agents', () => {
  it('detects power-ground short circuits deterministically', () => {
    const nodes: CircuitNode[] = [
      {
        id: 'node-short',
        netName: 'VCC_GND_SHORT',
        pins: [
          { componentId: 'v1', pinId: 'p1', pinKind: 'power' },
          { componentId: 'g1', pinId: 'p1', pinKind: 'ground' },
        ],
      },
    ];

    const result = verifyCircuitTopology(nodes);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERC_POWER_GROUND_SHORT')).toBe(true);
  });

  it('detects bus contention when two push-pull outputs drive the same net', () => {
    const nodes: CircuitNode[] = [
      {
        id: 'node-bus',
        netName: 'DATA_BUS',
        pins: [
          { componentId: 'u1_tx', pinId: 'out', pinKind: 'output' },
          { componentId: 'u2_tx', pinId: 'out', pinKind: 'output' },
          { componentId: 'u3_rx', pinId: 'in', pinKind: 'input' },
        ],
      },
    ];

    const result = verifyCircuitTopology(nodes);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.code === 'ERC_BUS_CONTENTION')).toBe(true);
  });

  it('treats a passive pull-up as a driver and still flags a truly floating input', () => {
    const pulledUp = verifyCircuitTopology([
      {
        id: 'node-pullup',
        netName: 'CS_N',
        pins: [
          { componentId: 'u1', pinId: 'CS', pinKind: 'input' },
          { componentId: 'r1', pinId: '2', pinKind: 'passive' },
        ],
      },
    ]);
    expect(pulledUp.warnings.some((w) => w.code === 'ERC_FLOATING_INPUT')).toBe(false);

    const floating = verifyCircuitTopology([
      {
        id: 'node-floating',
        netName: 'EN',
        pins: [{ componentId: 'u1', pinId: 'EN', pinKind: 'input' }],
      },
    ]);
    expect(floating.warnings.some((w) => w.code === 'ERC_FLOATING_INPUT')).toBe(true);
  });

  it('formally proves boolean equivalence between Demorgan transformed expressions', () => {
    // Demorgan's Law: !(A & B) == (!A | !B)
    const nandExpr = (inps: Record<string, boolean>) => !(inps.A && inps.B);
    const norDeMorgan = (inps: Record<string, boolean>) => !inps.A || !inps.B;

    const proof = verifyBooleanEquivalence(nandExpr, norDeMorgan, ['A', 'B']);
    expect(proof.equivalent).toBe(true);
    expect(proof.counterExample).toBeUndefined();

    // False equivalence check: !(A & B) != (!A & !B)
    const falseExpr = (inps: Record<string, boolean>) => !inps.A && !inps.B;
    const counterProof = verifyBooleanEquivalence(nandExpr, falseExpr, ['A', 'B']);
    expect(counterProof.equivalent).toBe(false);
    expect(counterProof.counterExample).toBeDefined();
  });
});
