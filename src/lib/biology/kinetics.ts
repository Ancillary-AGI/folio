/**
 * Reaction kinetics: mass-action networks, what they conserve, and whether they
 * can exist.
 *
 * The gene-circuit module hides chemistry inside Hill functions. This module is
 * the layer underneath: species, elementary reactions, and a rate law written
 * straight from the stoichiometry. It is what a design that has enzymes,
 * substrates, inhibitors or a metabolite pool needs, because those parts do not
 * obey a Hill curve — they obey the mechanism they are made of.
 *
 * Rate law
 * --------
 * For reaction `j` with reactants `R`, products `P`, forward rate `kf` and an
 * optional reverse rate `kr`:
 *
 *   v_j = kf · Π_{i∈R} C_i^(stoich) − kr · Π_{i∈P} C_i^(stoich)
 *   dC_i/dt = Σ_j (ν_products − ν_reactants)_ij · v_j
 *
 * Honest limits
 * -------------
 * - **Elementary steps only.** Exponents are the stoichiometric coefficients, so a
 *   reaction written as `2A → B` is treated as a termolecular collision. Real
 *   overall reactions frequently are not elementary, and their true order comes
 *   from the mechanism, not the balanced equation. If a mechanism is what you mean,
 *   write the mechanism.
 * - **Well-mixed and deterministic.** No diffusion, no spatial gradient, no
 *   copy-number noise. A network whose key species has ten molecules is not
 *   described by continuous concentrations; it needs the stochastic simulation
 *   algorithm, which is not this module.
 * - **Isothermal, and with no energy species.** ATP, NADH, proton gradients and
 *   light are not modelled as fuels here, so the detailed-balance check below is a
 *   statement about the rate constants as given, not about a real driven cell.
 * - **Conservation laws are structural.** They come from the stoichiometry matrix
 *   and hold for every rate law that respects it, but they do not know about a
 *   species you forgot to declare.
 * - Concentrations are dimensionless and time is in the model's own unit. Rate
 *   constants for higher-order steps must carry matching units or the numbers mean
 *   nothing.
 */

import { leftNullSpace, nullSpace, matrixRank, transposeMatrix } from '../math/matrixKernel'
import { integrateModel, requireNonNegative, requirePositive, type BiologyWindow } from './modelSupport'

export interface SpeciesAmount {
  species: string
  /** Positive integer. Fractional stoichiometry is not an elementary step. */
  stoichiometry: number
}

export interface Reaction {
  name?: string
  reactants: SpeciesAmount[]
  products: SpeciesAmount[]
  /** Forward rate constant. */
  forwardRate: number
  /** Reverse rate constant. Omitting it makes the step irreversible. */
  reverseRate?: number
}

export interface ReactionNetwork {
  name?: string
  /** Species ids, in the order every reported vector uses. */
  species: string[]
  reactions: Reaction[]
}

export interface ResolvedNetwork {
  network: ReactionNetwork
  /** Species × reactions. Negative for consumed, positive for produced. */
  stoichiometry: number[][]
  /** Reactant and product molecularities per reaction, for reporting a rate law's order. */
  orders: { forward: number; reverse: number }[]
  indexOf: Map<string, number>
}

export interface ReactionSample {
  time: number
  concentrations: number[]
  /** Net flux of every reaction at this instant, in the reaction order. */
  fluxes: number[]
}

function readAmounts(entries: readonly SpeciesAmount[], label: string, indexOf: Map<string, number>): Map<number, number> {
  const merged = new Map<number, number>()
  for (const entry of entries) {
    const index = indexOf.get(entry.species)
    if (index === undefined) throw new Error(`${label} names "${entry.species}", which is not a declared species.`)
    if (!Number.isInteger(entry.stoichiometry) || entry.stoichiometry <= 0) {
      throw new Error(`${label}: stoichiometry of ${entry.species} must be a positive whole number (got ${entry.stoichiometry}).`)
    }
    merged.set(index, (merged.get(index) ?? 0) + entry.stoichiometry)
  }
  return merged
}

export function resolveNetwork(network: ReactionNetwork): ResolvedNetwork {
  if (network.species.length === 0) throw new Error('A reaction network needs at least one species.')
  const indexOf = new Map<string, number>()
  for (const id of network.species) {
    if (!id) throw new Error('Every species needs a name.')
    if (indexOf.has(id)) throw new Error(`Species "${id}" is declared twice.`)
    indexOf.set(id, indexOf.size)
  }
  if (network.reactions.length === 0) throw new Error(`Network "${network.name ?? 'unnamed'}" declares no reactions, so nothing changes.`)

  const stoichiometry: number[][] = network.species.map(() => new Array<number>(network.reactions.length).fill(0))
  const orders: { forward: number; reverse: number }[] = []
  network.reactions.forEach((reaction, column) => {
    const label = reactionLabel(reaction, column)
    requirePositive(reaction.forwardRate, `Forward rate of reaction ${label}`)
    if (reaction.reverseRate !== undefined) {
      requirePositive(reaction.reverseRate, `Reverse rate of reaction ${label}`)
    }
    const reactants = readAmounts(reaction.reactants, `Reactants of ${label}`, indexOf)
    const products = readAmounts(reaction.products, `Products of ${label}`, indexOf)
    if (reactants.size === 0 && products.size === 0) {
      throw new Error(`Reaction ${label} changes nothing: it has neither reactants nor products.`)
    }
    for (const [index, count] of reactants) stoichiometry[index][column] -= count
    for (const [index, count] of products) stoichiometry[index][column] += count
    orders.push({
      forward: [...reactants.values()].reduce((sum, count) => sum + count, 0),
      reverse: [...products.values()].reduce((sum, count) => sum + count, 0),
    })
  })

  return { network, stoichiometry, orders, indexOf }
}

function reactionLabel(reaction: Reaction, index: number): string {
  return reaction.name ?? `#${index + 1}`
}

/** Mass-action net rate of every reaction at a concentration vector. */
export function reactionFluxes(resolved: ResolvedNetwork, concentrations: readonly number[]): number[] {
  if (concentrations.length !== resolved.network.species.length) {
    throw new Error(`Fluxes need ${resolved.network.species.length} concentrations, got ${concentrations.length}.`)
  }
  return resolved.network.reactions.map((reaction) => {
    let forward = reaction.forwardRate
    for (const entry of reaction.reactants) {
      forward *= concentrations[resolved.indexOf.get(entry.species) as number] ** entry.stoichiometry
    }
    if (reaction.reverseRate === undefined) return forward
    let reverse = reaction.reverseRate
    for (const entry of reaction.products) {
      reverse *= concentrations[resolved.indexOf.get(entry.species) as number] ** entry.stoichiometry
    }
    return forward - reverse
  })
}

/** `dC/dt = S·v` for the whole network. */
export function kineticsDerivative(resolved: ResolvedNetwork): (time: number, state: readonly number[]) => number[] {
  return (_time: number, state: readonly number[]): number[] => {
    const fluxes = reactionFluxes(resolved, state)
    return resolved.stoichiometry.map((row) => row.reduce((sum, coefficient, reaction) => sum + coefficient * fluxes[reaction], 0))
  }
}

/**
 * Step sizing, honestly estimated: the fastest local relaxation is the ratio of a
 * species' amount to the rate at which it is changing, taken at the starting point
 * and at unit concentrations. That catches a fast bimolecular bind and a fast
 * unimolecular decay alike. It is an estimate — a network whose stiffness only
 * appears mid-trajectory can still outrun it, and RK4 will then report a negative
 * concentration rather than pretend otherwise.
 */
function fastestRelaxationTime(resolved: ResolvedNetwork, initial: readonly number[]): number {
  const derivative = kineticsDerivative(resolved)
  const probe = [initial, resolved.network.species.map(() => 1)]
  let fastest = Number.POSITIVE_INFINITY
  for (const point of probe) {
    const rates = derivative(0, point)
    point.forEach((concentration, index) => {
      if (concentration > 0 && Math.abs(rates[index]) > 0) {
        fastest = Math.min(fastest, concentration / Math.abs(rates[index]))
      }
    })
  }
  // A network at rest has no relaxation to measure, so fall back on the fastest
  // rate constant, which is the only timescale it advertises.
  if (!Number.isFinite(fastest)) {
    const rateScale = Math.max(...resolved.network.reactions.map((reaction) => reaction.forwardRate))
    fastest = 1 / rateScale
  }
  return fastest
}

/** Simulate the network at the caller's cadence, reporting concentrations and fluxes. */
export function simulateReactionNetwork(
  network: ReactionNetwork,
  initial: readonly number[],
  window: BiologyWindow,
): ReactionSample[] {
  const resolved = resolveNetwork(network)
  if (initial.length !== network.species.length) {
    throw new Error(`Initial concentrations need ${network.species.length} values, got ${initial.length}.`)
  }
  for (const value of initial) requireNonNegative(value, 'Initial concentration')

  const samples = integrateModel(kineticsDerivative(resolved), initial, window, fastestRelaxationTime(resolved, initial))
  return samples.map((sample) => ({
    time: sample.time,
    concentrations: [...sample.state],
    fluxes: reactionFluxes(resolved, sample.state),
  }))
}

/* ------------------------------------------------------------------ *
 * Structural analysis — what the network cannot do
 * ------------------------------------------------------------------ */

export interface ConservationLaw {
  /** Coefficient per species, in declaration order; unit-normalised. */
  coefficients: number[]
  /** The value of the law at a concentration vector. */
  value: (concentrations: readonly number[]) => number
}

/**
 * The conserved moieties: every linear combination of species that no reaction can
 * change. These are properties of the stoichiometry, not of the rate constants, so
 * they hold even when the kinetics are wrong — which makes them the right thing to
 * check a simulation against.
 */
export function conservationLaws(network: ReactionNetwork): ConservationLaw[] {
  const resolved = resolveNetwork(network)
  return leftNullSpace(resolved.stoichiometry).map((coefficients) => ({
    coefficients,
    value: (concentrations: readonly number[]): number =>
      coefficients.reduce((sum, coefficient, index) => sum + coefficient * concentrations[index], 0),
  }))
}

/** Largest drift in any conservation law over a simulated trace, relative to its size. */
export function conservationDrift(
  network: ReactionNetwork,
  samples: readonly { concentrations: number[] }[],
): number {
  const laws = conservationLaws(network)
  if (laws.length === 0 || samples.length === 0) return 0
  let worst = 0
  for (const law of laws) {
    const values = samples.map((sample) => law.value(sample.concentrations))
    const scale = Math.max(...values.map((value) => Math.abs(value)), 1e-300)
    worst = Math.max(worst, (Math.max(...values) - Math.min(...values)) / scale)
  }
  return worst
}

export interface CycleAudit {
  /** Reaction indices the cycle runs through, with signed multiplicities. */
  coefficients: number[]
  /**
   * Σ c_j·ln(kf_j/kr_j), normalised by Σ|c_j|. Zero means the cycle can sit at
   * equilibrium; anything else means it cannot and will keep turning.
   */
  logImbalance: number
  balanced: boolean
  /** False when an irreversible step closes the loop: no rate constants can fix it. */
  fixable: boolean
  note: string
}

export interface DetailedBalanceReport {
  cycles: CycleAudit[]
  consistent: boolean
  /** The net flux a cycle carries at equilibrium; only meaningful for unbalanced cycles. */
  note: string
}

/**
 * Does this network obey detailed balance?
 *
 * At equilibrium every reaction must individually vanish, so around any cycle of
 * reactions the product of the equilibrium constants has to be 1. Read the other
 * way: if the rate constants around a loop multiply to something else, the loop is
 * a perpetual-motion machine — it will pump net flux forever at rest, with no fuel
 * species to pay for it. Real driven cycles (a kinase consuming ATP) do break
 * detailed balance, but only because the fuel is a species in the network; if the
 * fuel is not declared, the design is not driven, it is impossible.
 *
 * The cycle space comes from the null space of the stoichiometry matrix, so every
 * possible loop is covered by the independent cycles reported here — and the check
 * is necessary, not sufficient: a network can satisfy it and still be wrong.
 */
export function auditDetailedBalance(network: ReactionNetwork): DetailedBalanceReport {
  const resolved = resolveNetwork(network)
  const cycles = nullSpace(resolved.stoichiometry).map((coefficients): CycleAudit => {
    const weight = coefficients.reduce((sum, value) => sum + Math.abs(value), 0)
    const irreversible = coefficients.some(
      (weight2, reaction) => Math.abs(weight2) > 1e-12 && network.reactions[reaction].reverseRate === undefined,
    )
    if (irreversible) {
      return {
        coefficients,
        logImbalance: Number.POSITIVE_INFINITY,
        balanced: false,
        fixable: false,
        note: `This loop is closed by an irreversible step, so no choice of rate constants can balance it: `
          + 'it keeps turning as long as the loop is fed. Declare the fuel and product species if the cycle is meant to be driven.',
      }
    }
    const logSum = coefficients.reduce((sum, coefficient, reaction) => {
      const rates = network.reactions[reaction]
      return sum + coefficient * Math.log(rates.forwardRate / (rates.reverseRate as number))
    }, 0)
    const normalised = Math.abs(logSum) / Math.max(weight, 1e-300)
    const balanced = normalised < 1e-9
    return {
      coefficients,
      logImbalance: normalised,
      balanced,
      fixable: true,
      note: balanced
        ? 'Detailed balance holds around this loop: it can sit at equilibrium.'
        : `Rate constants around this loop disagree by ${normalised.toExponential(2)} per unit cycle multiplicity `
          + '(the product of the equilibrium constants is not 1), so the loop pumps flux at equilibrium.',
    }
  })
  const consistent = cycles.every((cycle) => cycle.balanced)
  return {
    cycles,
    consistent,
    note: cycles.length === 0
      ? 'The network has no reaction cycles, so there is nothing to balance: no loop can pump flux on its own.'
      : consistent
        ? 'Every independent cycle obeys detailed balance.'
        : `${cycles.filter((cycle) => !cycle.balanced).length} of ${cycles.length} independent cycles break detailed balance.`,
  }
}

/* ------------------------------------------------------------------ *
 * Named mechanisms — the shapes a design usually means
 * ------------------------------------------------------------------ */

export interface MichaelisMentenOptions {
  enzyme: string
  substrate: string
  complex: string
  product: string
  /** k1, the binding rate (per concentration per time). */
  association: number
  /** k−1, the unbinding rate. */
  dissociation: number
  /** kcat. */
  catalyticRate: number
  /** Set false to make the binding step irreversible, which is a different mechanism. */
  reversibleBinding?: boolean
}

/**
 * The classic two-step enzyme mechanism as a network, so it is integrated with the
 * full mass-action dynamics rather than with the assumptions that turn it into the
 * Michaelis–Menten formula.
 */
export function michaelisMentenNetwork(options: MichaelisMentenOptions): ReactionNetwork {
  const { enzyme, substrate, complex, product } = options
  requirePositive(options.association, 'Association rate')
  requirePositive(options.catalyticRate, 'Catalytic rate')
  if (options.reversibleBinding !== false) requirePositive(options.dissociation, 'Dissociation rate')
  return {
    name: `${substrate} → ${product} via ${enzyme}`,
    species: [enzyme, substrate, complex, product],
    reactions: [
      {
        name: 'binding',
        reactants: [{ species: enzyme, stoichiometry: 1 }, { species: substrate, stoichiometry: 1 }],
        products: [{ species: complex, stoichiometry: 1 }],
        forwardRate: options.association,
        reverseRate: options.reversibleBinding === false ? undefined : options.dissociation,
      },
      {
        name: 'catalysis',
        reactants: [{ species: complex, stoichiometry: 1 }],
        products: [{ species: enzyme, stoichiometry: 1 }, { species: product, stoichiometry: 1 }],
        forwardRate: options.catalyticRate,
      },
    ],
  }
}

/**
 * The rapid-equilibrium Michaelis–Menten initial rate: `Vmax·S/(Km + S)` with
 * `Km = (k−1 + kcat)/k1`.
 *
 * Provided so a simulation can be compared against the closed form a designer
 * would reach for, and so the difference between the two — which is real, and
 * grows with enzyme loading — is something the UI can show rather than hide.
 */
export function michaelisMentenInitialRate(
  options: { enzyme: number; substrate: number; association: number; dissociation: number; catalyticRate: number },
): { km: number; vmax: number; initialRate: number } {
  requirePositive(options.association, 'Association rate')
  requireNonNegative(options.dissociation, 'Dissociation rate')
  requirePositive(options.catalyticRate, 'Catalytic rate')
  requireNonNegative(options.enzyme, 'Total enzyme')
  requireNonNegative(options.substrate, 'Substrate')
  const km = (options.dissociation + options.catalyticRate) / options.association
  const vmax = options.catalyticRate * options.enzyme
  return { km, vmax, initialRate: vmax * options.substrate / (km + options.substrate) }
}

/** A first-order decay chain, the network every compartment model is built from. */
export function decayNetwork(species: readonly string[], ratePerTime: number): ReactionNetwork {
  if (species.length === 0) throw new Error('A decay chain needs at least one species.')
  requirePositive(ratePerTime, 'Decay rate')
  return {
    name: `${species.length}-species decay`,
    species: [...species],
    reactions: species.map((id) => ({
      name: `${id} decay`,
      reactants: [{ species: id, stoichiometry: 1 }],
      products: [],
      forwardRate: ratePerTime,
    })),
  }
}

/** Rank of the stoichiometry matrix — how many directions the network can move in. */
export function networkRank(network: ReactionNetwork): number {
  return matrixRank(resolveNetwork(network).stoichiometry)
}

/** Convenience: the transpose of the stoichiometry, for callers auditing reaction order. */
export function reactionVectors(network: ReactionNetwork): number[][] {
  return transposeMatrix(resolveNetwork(network).stoichiometry)
}
