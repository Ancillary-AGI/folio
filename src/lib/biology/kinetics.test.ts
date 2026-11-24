import { describe, expect, it } from 'vitest'

import {
  auditDetailedBalance,
  conservationDrift,
  conservationLaws,
  decayNetwork,
  kineticsDerivative,
  michaelisMentenInitialRate,
  michaelisMentenNetwork,
  networkRank,
  reactionFluxes,
  reactionVectors,
  resolveNetwork,
  simulateReactionNetwork,
  type ReactionNetwork,
} from './kinetics'

const UNITS = (values: number[]): number[] => values

/** A⇌B with a single reversible step. */
function dimer(forwardRate: number, reverseRate: number): ReactionNetwork {
  return {
    name: 'A⇌B',
    species: ['A', 'B'],
    reactions: [
      {
        name: 'isomerisation',
        reactants: [{ species: 'A', stoichiometry: 1 }],
        products: [{ species: 'B', stoichiometry: 1 }],
        forwardRate,
        reverseRate,
      },
    ],
  }
}

describe('mass-action integration', () => {
  it('decays an irreversible first-order species exactly', () => {
    const k = 0.5
    const samples = simulateReactionNetwork(
      { species: ['A', 'B'], reactions: [{ reactants: [{ species: 'A', stoichiometry: 1 }], products: [{ species: 'B', stoichiometry: 1 }], forwardRate: k }] },
      [1, 0],
      { tEnd: 20, dt: 1 },
    )
    for (const sample of samples) {
      expect(sample.concentrations[0]).toBeCloseTo(Math.exp(-k * sample.time), 6)
      // One species in, one out: the sum is the initial amount, wherever it sits.
      expect(sample.concentrations[0] + sample.concentrations[1]).toBeCloseTo(1, 10)
    }
    const halfLife = samples.find((sample) => sample.concentrations[0] < 0.5)
    expect(halfLife?.time).toBeGreaterThanOrEqual(Math.LN2 / k)
    expect(halfLife?.time).toBeLessThanOrEqual(Math.LN2 / k + 1)
  })

  it('relaxes a reversible pair at the rate its two constants add up to', () => {
    const forward = 0.7
    const reverse = 0.3
    const initial = 1
    const equilibriumB = (forward * initial) / (forward + reverse)
    // Three relaxation time constants of the (kf + kr) = 1 s⁻¹ mode, so the
    // final sample is within round-off of the equilibrium it is chasing.
    const samples = simulateReactionNetwork(dimer(forward, reverse), UNITS([initial, 0]), { tEnd: 20, dt: 0.2 })
    const last = samples[samples.length - 1]
    expect(last.concentrations[1]).toBeCloseTo(equilibriumB, 6)
    // B − B_eq is a single exponential with rate kf + kr, so its log slope is the
    // relaxation constant rather than a fitted magic number.
    // Indexed rather than matched on the clock: the reported times come out of a
    // strided integration, so exact float equality on `time` is a coin flip.
    const at = (time: number) => samples[Math.round(time / 0.2)]
    const early = at(2)
    const late = at(8)
    const slope = Math.log(Math.abs(late.concentrations[1] - equilibriumB) / Math.abs(early.concentrations[1] - equilibriumB)) / (late.time - early.time)
    expect(slope).toBeCloseTo(-(forward + reverse), 3)
    // The equilibrium ratio is the constant ratio, independent of how it was loaded.
    expect(last.concentrations[1] / last.concentrations[0]).toBeCloseTo(forward / reverse, 5)
  })

  it('carries a source and a sink with no species on one side', () => {
    // ∅ → A at rate s, A → ∅ at δ: A(t) = (s/δ)(1 − e^−δt), the inflow equation.
    const network: ReactionNetwork = {
      species: ['A'],
      reactions: [
        { name: 'inflow', reactants: [], products: [{ species: 'A', stoichiometry: 1 }], forwardRate: 2 },
        { name: 'clearance', reactants: [{ species: 'A', stoichiometry: 1 }], products: [], forwardRate: 0.5 },
      ],
    }
    const samples = simulateReactionNetwork(network, [0], { tEnd: 40, dt: 1 })
    for (const sample of samples) {
      expect(sample.concentrations[0]).toBeCloseTo(4 * (1 - Math.exp(-0.5 * sample.time)), 5)
    }
    expect(samples[samples.length - 1].concentrations[0]).toBeCloseTo(4, 4)
  })

  it('reports one flux per reaction and a derivative that matches S·v', () => {
    const network = dimer(0.7, 0.3)
    const resolved = resolveNetwork(network)
    const concentrations = [0.8, 0.2]
    const fluxes = reactionFluxes(resolved, concentrations)
    expect(fluxes).toHaveLength(1)
    expect(fluxes[0]).toBeCloseTo(0.7 * 0.8 - 0.3 * 0.2, 12)
    expect(kineticsDerivative(resolved)(0, concentrations)).toEqual([-fluxes[0], fluxes[0]])
    expect(() => reactionFluxes(resolved, [1, 2, 3])).toThrow(/concentrations/)
  })

  it('keeps a termolecular step at the rate its stoichiometry implies', () => {
    // 2A → B is written as an elementary step, so the rate is k·A². The model
    // takes that literally, which is the honest reading of the notation.
    const network: ReactionNetwork = {
      species: ['A', 'B'],
      reactions: [{ reactants: [{ species: 'A', stoichiometry: 2 }], products: [{ species: 'B', stoichiometry: 1 }], forwardRate: 1 }],
    }
    const resolved = resolveNetwork(network)
    expect(reactionFluxes(resolved, [3, 0])[0]).toBe(9)
    expect(resolved.orders[0]).toEqual({ forward: 2, reverse: 1 })
  })

  it('never sends a concentration below zero on a stiff enzyme cycle', () => {
    // Binding is the fast step (100 × 5 substrate ≈ 500 s⁻¹) and catalysis the
    // slow one, which is exactly the stiffness that lets a naive solver overshoot.
    // Vmax = kcat·E₀ = 2.5, so 5 units of substrate clear in a few time units.
    const network = michaelisMentenNetwork({
      enzyme: 'E',
      substrate: 'S',
      complex: 'ES',
      product: 'P',
      association: 100,
      dissociation: 10,
      catalyticRate: 5,
    })
    const samples = simulateReactionNetwork(network, [0.5, 5, 0, 0], { tEnd: 10, dt: 0.1 })
    expect(Math.min(...samples.flatMap((sample) => sample.concentrations))).toBeGreaterThan(-1e-12)
    // Everything that left S has to arrive in P eventually, and by t = 10 the
    // turnover is done: the substrate moiety sits in the product and nowhere else.
    expect(samples[samples.length - 1].concentrations[3]).toBeGreaterThan(4.99)
    expect(samples[samples.length - 1].concentrations[1]).toBeLessThan(0.01)
  })
})

describe('conservation laws', () => {
  it('finds the moiety of a dimer and holds it through the run', () => {
    const laws = conservationLaws(dimer(0.7, 0.3))
    expect(laws).toHaveLength(1)
    expect(Math.abs(laws[0].coefficients[0] - laws[0].coefficients[1])).toBeLessThan(1e-12)
    const samples = simulateReactionNetwork(dimer(0.7, 0.3), [1, 0], { tEnd: 20, dt: 0.25 })
    expect(conservationDrift(dimer(0.7, 0.3), samples)).toBeLessThan(1e-9)
    expect(samples.map((sample) => laws[0].value(sample.concentrations))[10]).toBeCloseTo(1 / Math.SQRT2, 9)
  })

  it('counts both moieties of an enzyme mechanism', () => {
    const network = michaelisMentenNetwork({ enzyme: 'E', substrate: 'S', complex: 'ES', product: 'P', association: 100, dissociation: 10, catalyticRate: 5 })
    const laws = conservationLaws(network)
    expect(laws).toHaveLength(2)
    const samples = simulateReactionNetwork(network, [0.5, 5, 0, 0], { tEnd: 10, dt: 0.1 })
    // Structural invariants are the sharpest test a simulator has: they must not
    // move by more than round-off, whatever the rate constants are.
    expect(conservationDrift(network, samples)).toBeLessThan(1e-9)
  })

  it('has nothing to conserve in a network that destroys and creates', () => {
    const decay = decayNetwork(['A', 'B'], 0.2)
    expect(conservationLaws(decay)).toHaveLength(0)
    expect(conservationDrift(decay, simulateReactionNetwork(decay, [1, 1], { tEnd: 10, dt: 1 }))).toBe(0)
  })

  it('reports the rank and the reaction vectors consistently', () => {
    const network = dimer(0.7, 0.3)
    expect(networkRank(network)).toBe(1)
    expect(reactionVectors(network)).toEqual([[-1, 1]])
  })
})

describe('detailed balance', () => {
  const cycle = (third: number): ReactionNetwork => ({
    name: 'A⇌B⇌C⇌A',
    species: ['A', 'B', 'C'],
    reactions: [
      { reactants: [{ species: 'A', stoichiometry: 1 }], products: [{ species: 'B', stoichiometry: 1 }], forwardRate: 2, reverseRate: 1 },
      { reactants: [{ species: 'B', stoichiometry: 1 }], products: [{ species: 'C', stoichiometry: 1 }], forwardRate: 3, reverseRate: 1 },
      // The third leg closes the loop; its constants decide whether the cycle can rest.
      { reactants: [{ species: 'C', stoichiometry: 1 }], products: [{ species: 'A', stoichiometry: 1 }], forwardRate: 1, reverseRate: third },
    ],
  })

  it('accepts a loop whose equilibrium constants multiply to one', () => {
    // κ = 2, 3, 1/6: the product is 1, so the cycle can sit at equilibrium.
    const report = auditDetailedBalance(cycle(6))
    expect(report.cycles).toHaveLength(1)
    expect(report.consistent).toBe(true)
    expect(report.cycles[0].balanced).toBe(true)
    expect(report.cycles[0].logImbalance).toBeLessThan(1e-9)
  })

  it('flags a loop that would pump flux forever', () => {
    const report = auditDetailedBalance(cycle(2))
    expect(report.consistent).toBe(false)
    expect(report.cycles[0].balanced).toBe(false)
    expect(report.cycles[0].fixable).toBe(true)
    expect(report.cycles[0].logImbalance).toBeGreaterThan(0.1)
    expect(report.cycles[0].note).toMatch(/pumps flux/)
    expect(report.note).toMatch(/1 of 1 independent cycles/)
  })

  it('says plainly when an irreversible step makes a cycle unfixed-able', () => {
    const network: ReactionNetwork = {
      species: ['A', 'B', 'C'],
      reactions: [
        { reactants: [{ species: 'A', stoichiometry: 1 }], products: [{ species: 'B', stoichiometry: 1 }], forwardRate: 1 },
        { reactants: [{ species: 'B', stoichiometry: 1 }], products: [{ species: 'C', stoichiometry: 1 }], forwardRate: 1 },
        { reactants: [{ species: 'C', stoichiometry: 1 }], products: [{ species: 'A', stoichiometry: 1 }], forwardRate: 1 },
      ],
    }
    const report = auditDetailedBalance(network)
    expect(report.consistent).toBe(false)
    expect(report.cycles[0].fixable).toBe(false)
    expect(report.cycles[0].note).toMatch(/irreversible/)
  })

  it('has nothing to balance in an open chain', () => {
    const report = auditDetailedBalance({
      species: ['A', 'B', 'C'],
      reactions: [
        { reactants: [{ species: 'A', stoichiometry: 1 }], products: [{ species: 'B', stoichiometry: 1 }], forwardRate: 1, reverseRate: 1 },
        { reactants: [{ species: 'B', stoichiometry: 1 }], products: [{ species: 'C', stoichiometry: 1 }], forwardRate: 1, reverseRate: 1 },
      ],
    })
    expect(report.cycles).toHaveLength(0)
    expect(report.consistent).toBe(true)
    expect(report.note).toMatch(/no reaction cycles/)
  })
})

describe('Michaelis–Menten against its own shortcut', () => {
  const options = { enzyme: 'E', substrate: 'S', complex: 'ES', product: 'P', association: 100, dissociation: 10, catalyticRate: 5 }

  it('reproduces the initial-rate formula when the enzyme is a trace', () => {
    const total = michaelisMentenInitialRate({ enzyme: 0.001, substrate: 10, association: 100, dissociation: 10, catalyticRate: 5 })
    expect(total.km).toBeCloseTo(0.15, 12)
    expect(total.vmax).toBeCloseTo(0.005, 12)
    expect(total.initialRate).toBeCloseTo((0.005 * 10) / (10 + 0.15), 12)

    const samples = simulateReactionNetwork(michaelisMentenNetwork(options), [0.001, 10, 0, 0], { tEnd: 2, dt: 0.02 })
    // The product appears at kcat·[ES]; measure the slope once the complex has
    // formed, and compare it with what the formula promises.
    const window = samples.filter((sample) => sample.time >= 0.1 && sample.time <= 0.5)
    const slope = (window[window.length - 1].concentrations[3] - window[0].concentrations[3]) / (window[window.length - 1].time - window[0].time)
    expect(slope).toBeCloseTo(total.initialRate, 5)
    expect(Math.abs(slope / total.initialRate - 1)).toBeLessThan(0.005)
  })

  it('under-predicts once the enzyme is a real share of the substrate', () => {
    // The formula assumes free substrate equals total substrate. At 10 % enzyme
    // loading that is false, and the mechanism is the one that is right.
    const formula = michaelisMentenInitialRate({ enzyme: 1, substrate: 10, association: 100, dissociation: 10, catalyticRate: 5 })
    const samples = simulateReactionNetwork(michaelisMentenNetwork(options), [1, 10, 0, 0], { tEnd: 2, dt: 0.02 })
    const window = samples.filter((sample) => sample.time >= 0.1 && sample.time <= 0.5)
    const slope = (window[window.length - 1].concentrations[3] - window[0].concentrations[3]) / (window[window.length - 1].time - window[0].time)
    expect(slope).toBeLessThan(formula.initialRate)
    expect(slope / formula.initialRate).toBeGreaterThan(0.9)
  })

  it('lets binding be irreversible, which is a different mechanism', () => {
    const network = michaelisMentenNetwork({ ...options, reversibleBinding: false })
    const report = auditDetailedBalance(network)
    expect(report.consistent).toBe(true)
    expect(networkRank(network)).toBe(2)
  })
})

describe('validation', () => {
  const cases: [ReactionNetwork, RegExp][] = [
    [{ species: [], reactions: [] }, /at least one species/],
    [{ species: ['A', 'A'], reactions: [] }, /declared twice/],
    [{ species: [''], reactions: [] }, /needs a name/],
    [{ species: ['A'], reactions: [] }, /declares no reactions/],
    [{ species: ['A'], reactions: [{ reactants: [{ species: 'B', stoichiometry: 1 }], products: [], forwardRate: 1 }] }, /not a declared species/],
    [{ species: ['A'], reactions: [{ reactants: [{ species: 'A', stoichiometry: 0 }], products: [], forwardRate: 1 }] }, /positive whole number/],
    [{ species: ['A'], reactions: [{ reactants: [{ species: 'A', stoichiometry: 1.5 }], products: [], forwardRate: 1 }] }, /positive whole number/],
    [{ species: ['A'], reactions: [{ reactants: [{ species: 'A', stoichiometry: -1 }], products: [], forwardRate: 1 }] }, /positive whole number/],
    [{ species: ['A'], reactions: [{ reactants: [{ species: 'A', stoichiometry: 1 }], products: [], forwardRate: 0 }] }, /Forward rate/],
    [{ species: ['A'], reactions: [{ reactants: [{ species: 'A', stoichiometry: 1 }], products: [], forwardRate: -1 }] }, /Forward rate/],
    [{ species: ['A'], reactions: [{ reactants: [{ species: 'A', stoichiometry: 1 }], products: [], forwardRate: 1, reverseRate: 0 }] }, /Reverse rate/],
    [{ species: ['A'], reactions: [{ reactants: [], products: [], forwardRate: 1 }] }, /neither reactants nor products/],
  ]
  it('refuses a network it cannot interpret', () => {
    for (const [network, message] of cases) expect(() => resolveNetwork(network)).toThrow(message)
  })

  it('checks the run against the species list', () => {
    expect(() => simulateReactionNetwork(dimer(1, 1), [1], { tEnd: 5, dt: 0.1 })).toThrow(/Initial concentrations need 2 values/)
    expect(() => simulateReactionNetwork(dimer(1, 1), [-1, 1], { tEnd: 5, dt: 0.1 })).toThrow(/non-negative/)
  })

  it('names the reaction that is at fault', () => {
    const network: ReactionNetwork = {
      species: ['A'],
      reactions: [{ name: 'leak', reactants: [{ species: 'A', stoichiometry: 1 }], products: [], forwardRate: Number.NaN }],
    }
    expect(() => resolveNetwork(network)).toThrow(/Forward rate of reaction leak/)
  })

  it('refuses a rate constant that cannot be evaluated', () => {
    expect(() => michaelisMentenNetwork({ enzyme: 'E', substrate: 'S', complex: 'ES', product: 'P', association: -1, dissociation: 1, catalyticRate: 1 })).toThrow(/Association rate/)
    expect(() => decayNetwork(['A'], 0)).toThrow(/Decay rate/)
    expect(() => decayNetwork([], 1)).toThrow(/at least one species/)
  })
})
