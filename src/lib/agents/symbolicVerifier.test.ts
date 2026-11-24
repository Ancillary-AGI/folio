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

  it('classifies rails by token, not by substring', () => {
    /* `10V` contains `0V`, and the old substring test called it ground — so a
     * real 10 V rail was filed as ground and a short on it went unreported. */
    const tenVolt = verifyCircuitTopology([
      { id: 'n10', netName: '10V', pins: [{ componentId: 'u1', pinId: 'VIN', pinKind: 'power' }] },
    ]);
    expect(tenVolt.metrics.groundNets).toEqual([]);
    expect(tenVolt.metrics.powerNets).toContain('10V');
    expect(tenVolt.errors.some((e) => e.code === 'ERC_POWER_GROUND_SHORT')).toBe(false);

    // A true 0 V net is still ground.
    const zero = verifyCircuitTopology([
      { id: 'n0', netName: '0V', pins: [{ componentId: 'u1', pinId: 'GND', pinKind: 'ground' }] },
    ]);
    expect(zero.metrics.groundNets).toContain('0V');

    // `VCC+` is a supply; `IN+` is a signal net, not a power rail.
    const supply = verifyCircuitTopology([
      { id: 'nvcc', netName: 'VCC+', pins: [{ componentId: 'u1', pinId: 'VCC', pinKind: 'power' }] },
    ]);
    expect(supply.metrics.powerNets).toContain('VCC+');
    const signal = verifyCircuitTopology([
      { id: 'nin', netName: 'IN+', pins: [{ componentId: 'u1', pinId: 'INP', pinKind: 'input' }] },
    ]);
    expect(signal.metrics.powerNets).toEqual([]);
    expect(signal.metrics.groundNets).toEqual([]);

    // A 10 V rail tied to ground is a genuine short.
    const shorted = verifyCircuitTopology([
      {
        id: 'nshort',
        netName: '10V',
        pins: [
          { componentId: 'u1', pinId: 'VIN', pinKind: 'power' },
          { componentId: 'u2', pinId: 'GND', pinKind: 'ground' },
        ],
      },
    ]);
    expect(shorted.errors.some((e) => e.code === 'ERC_POWER_GROUND_SHORT')).toBe(true);
  })

  it('does not treat a negative supply rail as ground', () => {
    /* `VEE` is the conventional name for a negative rail, and the library
     * declares the op-amp V- pin as a power pin. Classifying the *name* as
     * ground as well reported a correct dual-supply net as a short. */
    const vee = verifyCircuitTopology([
      { id: 'nvee', netName: 'VEE', pins: [{ componentId: 'u1', pinId: 'VEE', pinKind: 'power' }] },
    ]);
    expect(vee.metrics.groundNets).toEqual([]);
    expect(vee.metrics.powerNets).toContain('VEE');
    expect(vee.errors.some((e) => e.code === 'ERC_POWER_GROUND_SHORT')).toBe(false);

    // Tying the negative rail to ground is still a short.
    const tied = verifyCircuitTopology([
      {
        id: 'ntied',
        netName: 'VEE',
        pins: [
          { componentId: 'u1', pinId: 'VEE', pinKind: 'power' },
          { componentId: 'u2', pinId: 'GND', pinKind: 'ground' },
        ],
      },
    ]);
    expect(tied.errors.some((e) => e.code === 'ERC_POWER_GROUND_SHORT')).toBe(true);
  })

  it('refuses a truth table it cannot enumerate instead of claiming equivalence', () => {
    /* `1 << n` goes negative at 31 variables, so the loop never ran and the
     * function returned `equivalent: true` having checked nothing. */
    const variables = Array.from({ length: 24 }, (_, index) => `v${index}`)
    const alwaysTrue = () => true
    const alwaysFalse = () => false
    expect(() => verifyBooleanEquivalence(alwaysTrue, alwaysFalse, variables)).toThrow(/SAT solver/)
    // Well inside the limit, the comparison still decides correctly.
    expect(verifyBooleanEquivalence(alwaysTrue, alwaysTrue, ['a', 'b']).equivalent).toBe(true)
  })

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
