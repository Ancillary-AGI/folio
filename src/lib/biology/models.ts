/**
 * Curated models for the three biology modules that ship solvers but no presets.
 *
 * `excitability`, `mitochondrion`, `tissue` and `geneticCircuit` each carry their
 * own preset registry. Reaction networks, the circulation and pharmacokinetics do
 * not, and a library dock cannot offer a row that places nothing — so this file
 * is where those named models live.
 *
 * Two rules hold every row here honest:
 *
 * 1. **Inputs are stated, outputs are not.** A note describes the parameter set
 *    and what to watch. It never quotes a peak, a half-life or an ejection
 *    fraction, because those are what the run produces and the panel measures
 *    them live. Quoting them here would be a claim this file does not earn.
 * 2. **Units belong to the model.** Reaction networks are µM and seconds;
 *    pharmacokinetics is mg, L and hours; the circulation is mmHg, mL and seconds.
 *    They are never mixed inside one run and never silently rescaled.
 *
 * The pharmacokinetic numbers are illustrative parameter sets, not clinical
 * recommendations for any real compound. They are chosen to put each curve's
 * interesting feature inside the run window.
 */

import type { BiologicalScale } from './scales'
import type { BiologyWindow } from './modelSupport'
import type { ReactionNetwork } from './kinetics'
import { michaelisMentenNetwork } from './kinetics'
import type { CirculationParameters, StarlingForces } from './haemodynamics'
import { RESTING_CIRCULATION } from './haemodynamics'
import type { CellPreset, IntegrateAndFireParameters } from './excitability'
import { CELL_PRESETS, EXCITABLE_FITZHUGH_NAGUMO } from './excitability'
import type { CablePreset } from './tissue'
import type { CircuitPreset } from './geneticCircuit'
import { CIRCUIT_PRESETS, presetCircuit } from './geneticCircuit'
import type { MitochondrionPreset } from './mitochondrion'
import { MITOCHONDRION_PRESETS } from './mitochondrion'
import { INCOHERENT_POPULATION, PACEMAKER_POPULATION, TISSUE_PRESETS } from './tissue'
import type {
  AbsorptionParameters,
  BolusParameters,
  InfusionParameters,
  TwoCompartmentParameters,
} from './pharmacokinetics'

/* ------------------------------------------------------------------ *
 * Molecule — mass-action reaction networks
 * ------------------------------------------------------------------ */

export interface ReactionPreset {
  id: string
  name: string
  category: string
  note: string
  network: ReactionNetwork
  /** One value per species, in `network.species` order, µM. */
  initial: number[]
  window: BiologyWindow
  /** What the panel should check this run against, in one line. */
  check: string
  /**
   * A closed form the panel plots against the integrated run, named by which one.
   *
   * The panel reads the rate constants off `network` rather than trusting this
   * marker, so a dial that moves `k₁` moves the formula with it.
   */
  closedForm?: 'michaelis-menten'
}

/**
 * The Michaelis–Menten mechanism integrated as mass action.
 *
 * Two steps, four species, and deliberately *not* the Michaelis–Menten formula:
 * the quasi-steady-state and free-enzyme assumptions that turn one into the other
 * are exactly what this run can be compared against, so the panel shows both and
 * lets the difference be seen rather than asserted.
 */
const MM_NETWORK: ReactionNetwork = michaelisMentenNetwork({
  enzyme: 'E',
  substrate: 'S',
  complex: 'ES',
  product: 'P',
  association: 2,
  dissociation: 1,
  catalyticRate: 5,
})

const COMPETITIVE_NETWORK: ReactionNetwork = {
  name: 'Enzyme with a competitive inhibitor',
  species: ['E', 'S', 'ES', 'P', 'I', 'EI'],
  reactions: [
    {
      name: 'binding',
      reactants: [
        { species: 'E', stoichiometry: 1 },
        { species: 'S', stoichiometry: 1 },
      ],
      products: [{ species: 'ES', stoichiometry: 1 }],
      forwardRate: 2,
      reverseRate: 1,
    },
    {
      name: 'catalysis',
      reactants: [{ species: 'ES', stoichiometry: 1 }],
      products: [
        { species: 'E', stoichiometry: 1 },
        { species: 'P', stoichiometry: 1 },
      ],
      forwardRate: 5,
    },
    {
      name: 'inhibitor binding',
      reactants: [
        { species: 'E', stoichiometry: 1 },
        { species: 'I', stoichiometry: 1 },
      ],
      products: [{ species: 'EI', stoichiometry: 1 }],
      forwardRate: 2,
      reverseRate: 2,
    },
  ],
}

const DIMER_NETWORK: ReactionNetwork = {
  name: 'Reversible dimerisation',
  species: ['A', 'A2'],
  reactions: [
    {
      name: 'association',
      reactants: [{ species: 'A', stoichiometry: 2 }],
      products: [{ species: 'A2', stoichiometry: 1 }],
      forwardRate: 0.5,
      reverseRate: 0.125,
    },
  ],
}

/**
 * A cycle whose rate constants cannot all be satisfied at once.
 *
 * Going round forwards multiplies the constants to 1; going back multiplies them
 * to 0.25. No choice of concentrations makes both directions equal at every step,
 * so the loop carries net flux at equilibrium with no fuel species to pay for it.
 * That is the defect `auditDetailedBalance` exists to catch, and this row is the
 * demonstration — a design that looks like a three-step pathway and is impossible.
 */
const UNBALANCED_NETWORK: ReactionNetwork = {
  name: 'Three-step cycle with an unbalanced loop',
  species: ['X', 'Y', 'Z'],
  reactions: [
    { name: 'X→Y', reactants: [{ species: 'X', stoichiometry: 1 }], products: [{ species: 'Y', stoichiometry: 1 }], forwardRate: 1, reverseRate: 1 },
    { name: 'Y→Z', reactants: [{ species: 'Y', stoichiometry: 1 }], products: [{ species: 'Z', stoichiometry: 1 }], forwardRate: 1, reverseRate: 1 },
    { name: 'Z→X', reactants: [{ species: 'Z', stoichiometry: 1 }], products: [{ species: 'X', stoichiometry: 1 }], forwardRate: 1, reverseRate: 0.25 },
  ],
}

export const REACTION_PRESETS: readonly ReactionPreset[] = [
  {
    id: 'mm-enzyme',
    name: 'Enzyme mechanism, mass action',
    category: 'Enzyme kinetics',
    note: 'E + S ⇄ ES → E + P with k₁ = 2 µM⁻¹s⁻¹, k₋₁ = 1 s⁻¹, kcat = 5 s⁻¹, 1 µM enzyme and 100 µM substrate. '
      + 'The full mechanism, integrated — the Michaelis–Menten formula is offered alongside it as the '
      + 'approximation the run is being measured against, not as the answer.',
    network: MM_NETWORK,
    initial: [1, 100, 0, 0],
    window: { tEnd: 20, dt: 0.1 },
    check: 'Initial rate against Vmax·S/(Km + S), and the enzyme moiety conservation law.',
    closedForm: 'michaelis-menten',
  },
  {
    id: 'competitive-inhibition',
    name: 'Competitive inhibitor on the free enzyme',
    category: 'Enzyme kinetics',
    note: 'The same mechanism plus E + I ⇄ EI at k = 2 µM⁻¹s⁻¹ either way, with 20 µM inhibitor against 1 µM '
      + 'enzyme and 100 µM substrate. The inhibitor only competes for free E, so product still appears at '
      + 'the same Vmax once substrate out-competes it — the panel reports the flux, not that conclusion.',
    network: COMPETITIVE_NETWORK,
    initial: [1, 100, 0, 0, 20, 0],
    window: { tEnd: 20, dt: 0.1 },
    check: 'Three conservation laws: enzyme moiety, inhibitor moiety, and substrate plus product.',
  },
  {
    id: 'dimer-equilibrium',
    name: 'Reversible dimerisation 2A ⇄ A₂',
    category: 'Binding equilibria',
    note: '2 A ⇄ A₂ with kf = 0.5 µM⁻¹s⁻¹ and kr = 0.125 s⁻¹ from 10 µM monomer and nothing else. The '
      + 'stoichiometry is a bimolecular reactant written as a coefficient of 2, which is what makes the '
      + 'mass-action rate quadratic in [A] — the reason the equilibrium lands well short of all-dimer.',
    network: DIMER_NETWORK,
    initial: [10, 0],
    window: { tEnd: 200, dt: 0.5 },
    check: 'Kd from the ratio of the rate constants against the concentrations the run settles at.',
  },
  {
    id: 'unbalanced-cycle',
    name: 'Cycle that breaks detailed balance',
    category: 'Structural checks',
    note: 'X ⇄ Y ⇄ Z ⇄ X with every step 1:1 except the last, whose reverse constant is 0.25. Around the loop '
      + 'the forward product is 1 and the reverse is 0.25, so the cycle cannot be at equilibrium and will '
      + 'turn for ever. Nothing here is asked to consume fuel, which is precisely why the audit rejects it.',
    network: UNBALANCED_NETWORK,
    initial: [1, 0, 0],
    window: { tEnd: 100, dt: 0.5 },
    check: 'The detailed-balance audit of the one independent cycle, which reports it as unfixable.',
  },
]

export function reactionPreset(id: string): ReactionPreset {
  const found = REACTION_PRESETS.find((preset) => preset.id === id)
  if (!found) throw new Error(`No reaction-network preset "${id}". Known: ${REACTION_PRESETS.map((p) => p.id).join(', ')}.`)
  return found
}

/* ------------------------------------------------------------------ *
 * Cell — the third excitability family
 * ------------------------------------------------------------------ */

/**
 * A leaky integrate-and-fire neuron that fires tonically.
 *
 * The drive sits above threshold, so the membrane climbs to it, crosses, resets
 * and climbs again; the period is set by `tauMs`, the drive-to-threshold gap and
 * the refractory hold, and the panel reports the intervals it measures rather
 * than a rate claimed here. This is the only one of the three cell families that
 * has no spike *shape* to discuss — a spike is an event, not a waveform — so it
 * is the row to read when the question is timing rather than mechanism.
 */
export const TONIC_LIF: IntegrateAndFireParameters = {
  tauMs: 20,
  restMillivolts: -65,
  thresholdMillivolts: -50,
  resetMillivolts: -65,
  driveMillivolts: -40,
  refractoryMs: 2,
}

/* ------------------------------------------------------------------ *
 * Organ — the left heart and its arteries
 * ------------------------------------------------------------------ */

export interface CirculationPreset {
  id: string
  name: string
  category: string
  /** Which input moved relative to `RESTING_CIRCULATION`, and by how much. */
  note: string
  parameters: CirculationParameters
  /** Ventricular volume the run starts at, mL. */
  initialVolume: number
  window: BiologyWindow
}

/**
 * Every row below changes exactly one input from `RESTING_CIRCULATION`, so the
 * run is an intervention with a single variable rather than a new parameter set.
 * The window is the 14 s at a 3 ms step the resting preset is documented against.
 */
const RESTING_WINDOW: BiologyWindow = { tEnd: 14, dt: 0.003 }

export const CIRCULATION_PRESETS: readonly CirculationPreset[] = [
  {
    id: 'resting',
    name: 'Left heart at rest',
    category: 'Baseline',
    note: 'The reference beat: resistance 1.2 mmHg·s/mL, compliance 1.6 mL/mmHg, 0.86 s cycle, peak elastance '
      + '2 mmHg/mL. Competent valves, so the reverse gradient is met with a 10⁴× resistance.',
    parameters: RESTING_CIRCULATION,
    initialVolume: 120,
    window: RESTING_WINDOW,
  },
  {
    id: 'high-afterload',
    name: 'Afterload doubled',
    category: 'Interventions',
    note: 'Peripheral resistance 1.2 → 2.4 mmHg·s/mL. Nothing else moves, so whatever the stroke volume, '
      + 'pulse pressure or loop area does is the load\'s doing alone.',
    parameters: { ...RESTING_CIRCULATION, resistance: 2.4 },
    initialVolume: 120,
    window: RESTING_WINDOW,
  },
  {
    id: 'stiff-artery',
    name: 'Arterial compliance halved',
    category: 'Interventions',
    note: 'Compliance 1.6 → 0.8 mL/mmHg with resistance unchanged. The RC time constant therefore halves, and '
      + 'with it the artery\'s ability to smooth the ejection into a steady distal flow.',
    parameters: { ...RESTING_CIRCULATION, compliance: 0.8 },
    initialVolume: 120,
    window: RESTING_WINDOW,
  },
  {
    id: 'inotropic',
    name: 'Contractility raised',
    category: 'Interventions',
    note: 'Peak elastance 2 → 3.5 mmHg/mL. End-diastolic elastance, rate and load all stay where they were, '
      + 'which is what makes this an inotropy experiment rather than a different heart.',
    parameters: { ...RESTING_CIRCULATION, elastanceMax: 3.5 },
    initialVolume: 120,
    window: RESTING_WINDOW,
  },
  {
    id: 'slow-rate',
    name: 'Heart rate 0.86 s → 1.2 s',
    category: 'Interventions',
    note: 'Beat period lengthened by forty percent with every other input untouched. Diastole is the part '
      + 'that grows, so this is the filling-time experiment.',
    parameters: { ...RESTING_CIRCULATION, beatPeriod: 1.2 },
    initialVolume: 120,
    window: { tEnd: 19, dt: 0.003 },
  },
  {
    id: 'regurgitant',
    name: 'Leaky aortic valve',
    category: 'Interventions',
    note: 'The closed valve\'s reverse resistance cut from 10⁴× to 20× the forward one. The orifice model is '
      + 'unchanged, because there is none: a finite leak factor is the whole regurgitation mechanism here.',
    parameters: { ...RESTING_CIRCULATION, reverseLeakFactor: 20 },
    initialVolume: 120,
    window: { tEnd: 20, dt: 0.003 },
  },
]

export function circulationPreset(id: string): CirculationPreset {
  const found = CIRCULATION_PRESETS.find((preset) => preset.id === id)
  if (!found) throw new Error(`No circulation preset "${id}". Known: ${CIRCULATION_PRESETS.map((p) => p.id).join(', ')}.`)
  return found
}

/** A capillary bed with a normal arterial and venular end, mmHg. */
export const RESTING_CAPILLARY: { arterialEnd: StarlingForces; venularEnd: StarlingForces; filtrationCoefficientArea: number } = {
  arterialEnd: {
    capillaryPressure: 35,
    interstitialPressure: 1,
    plasmaOncoticPressure: 25,
    interstitialOncoticPressure: 1,
    reflectionCoefficient: 0.9,
  },
  venularEnd: {
    capillaryPressure: 15,
    interstitialPressure: 1,
    plasmaOncoticPressure: 25,
    interstitialOncoticPressure: 1,
    reflectionCoefficient: 0.9,
  },
  filtrationCoefficientArea: 1,
}

/* ------------------------------------------------------------------ *
 * System — drug disposition
 * ------------------------------------------------------------------ */

export interface PharmacokineticPreset {
  id: string
  name: string
  category: string
  note: string
  window: BiologyWindow
}

export interface OralPreset extends PharmacokineticPreset {
  kind: 'oral'
  parameters: AbsorptionParameters
}

export interface BolusDosingPreset extends PharmacokineticPreset {
  kind: 'bolus-repeat'
  parameters: BolusParameters
  dosingIntervalHours: number
  doses: number
}

export interface TwoCompartmentPreset extends PharmacokineticPreset {
  kind: 'two-compartment'
  parameters: TwoCompartmentParameters
}

export interface InfusionPreset extends PharmacokineticPreset {
  kind: 'infusion'
  parameters: InfusionParameters
}

export interface SaturablePreset extends PharmacokineticPreset {
  kind: 'saturable'
  /** The sink's capacity, its half-saturation concentration and the space it clears. */
  parameters: { vmax: number; km: number; volume: number }
  /** mg/h. At or above `vmax` there is no plateau, and that is the point. */
  infusionRate: number
}

export type AnyPharmacokineticPreset =
  | OralPreset
  | BolusDosingPreset
  | TwoCompartmentPreset
  | InfusionPreset
  | SaturablePreset

export const PHARMACOKINETIC_PRESETS: readonly AnyPharmacokineticPreset[] = [
  {
    id: 'oral-once',
    kind: 'oral',
    name: 'Single oral dose',
    category: 'One compartment',
    note: '100 mg, F = 0.8, ka = 1.5 h⁻¹ into a 40 L volume cleared at 5 L/h, with a 0.5 h lag. Absorption is '
      + 'four times elimination, so the terminal limb is elimination and the curve has a real rising phase.',
    parameters: {
      dose: 100, volume: 40, clearance: 5, absorptionRate: 1.5, bioavailability: 0.8, lagTime: 0.5,
    },
    window: { tEnd: 24, dt: 0.1 },
  },
  {
    id: 'bolus-q8h',
    kind: 'bolus-repeat',
    name: 'Repeat IV bolus, every 8 h',
    category: 'Multiple dosing',
    note: '50 mg into 20 L cleared at 4 L/h — a 3.5 h half-life dosed every 8 h — for five doses. Linear '
      + 'superposition only because the model is linear; the accumulation factor is reported next to it.',
    parameters: { dose: 50, volume: 20, clearance: 4 },
    dosingIntervalHours: 8,
    doses: 5,
    window: { tEnd: 48, dt: 0.25 },
  },
  {
    id: 'two-compartment',
    kind: 'two-compartment',
    name: 'Two compartments: distribution then elimination',
    category: 'Two compartments',
    note: '100 mg into a 15 L central bucket sharing with a 120 L peripheral one through 25 L/h, cleared 3 L/h '
      + 'from the centre only. The curve has two slopes; the terminal one is the half-life a schedule is '
      + 'argued from, and the log-linear fit of the whole curve is shown to prove why the other does not count.',
    parameters: {
      dose: 100, volumeCentral: 15, volumePeripheral: 120, clearance: 3, distributionClearance: 25,
    },
    window: { tEnd: 48, dt: 0.25 },
  },
  {
    id: 'infusion',
    kind: 'infusion',
    name: 'Constant infusion',
    category: 'One compartment',
    note: '60 mg/h into 20 L cleared at 4 L/h from a body holding nothing. The plateau is set by clearance '
      + 'alone at 15 mg/L; the volume only decides how long the run takes to get there.',
    parameters: { rate: 60, volume: 20, clearance: 4 },
    window: { tEnd: 48, dt: 0.25 },
  },
  {
    id: 'saturable-infusion',
    kind: 'saturable',
    name: 'Infusion against a capacity-limited sink',
    category: 'Non-linear',
    note: 'Vmax 50 mg/h, Km 5 mg/L, 20 L, infused at 40 mg/h — below capacity, so a plateau exists and can be '
      + 'compared with the closed form. Raise the rate past 50 mg/h in the panel and the plateau disappears; '
      + 'the amount then climbs for the whole run, which is the result rather than an error.',
    parameters: { vmax: 50, km: 5, volume: 20 },
    infusionRate: 40,
    window: { tEnd: 48, dt: 0.25 },
  },
]

export function pharmacokineticPreset(id: string): AnyPharmacokineticPreset {
  const found = PHARMACOKINETIC_PRESETS.find((preset) => preset.id === id)
  if (!found) throw new Error(`No pharmacokinetic preset "${id}". Known: ${PHARMACOKINETIC_PRESETS.map((p) => p.id).join(', ')}.`)
  return found
}

/* ------------------------------------------------------------------ *
 * One index of every model the biology workspace can load
 * ------------------------------------------------------------------ */

/**
 * Which solver a row hands its parameters to.
 *
 * The scale says which view draws the row; this says which loader in that view
 * runs it. Both are carried on the row because a panel that re-derived either one
 * from the id string is a panel that breaks when an id is renamed.
 */
export type BioModelFamily =
  | 'kinetics'
  | 'oxphos'
  | 'hodgkin-huxley'
  | 'fitzhugh-nagumo'
  | 'integrate-and-fire'
  | 'gene-circuit'
  | 'cable'
  | 'oscillators'
  | 'circulation'
  | 'starling'
  | 'pharmacokinetics'

/**
 * A row the library dock can offer and the panel can actually place.
 *
 * One list serves both, because the failure mode this guards against is the one
 * the structures workspace already hit: a catalog that names a preset the panel
 * cannot load. Here the id is the only handle, it is built from the registries
 * themselves rather than typed twice, and `loadBioModel` throws for anything that
 * is not in the index — so a row and a loader cannot drift apart silently.
 */
export interface BioModelRow {
  /** `<scale>-<presetId>`, unique across the whole domain. */
  id: string
  scale: BiologicalScale
  family: BioModelFamily
  name: string
  /** The sticky header the dock files the row under. */
  category: string
  /** Short right-aligned readout of the model's own inputs — never its results. */
  spec: string
  description: string
}

function countRow(
  id: string,
  scale: BiologicalScale,
  family: BioModelFamily,
  name: string,
  category: string,
  spec: string,
  description: string,
): BioModelRow {
  return { id, scale, family, name, category, spec, description }
}

/** Every loadable model, in scale order, built from the registries. */
export function bioModelRows(): BioModelRow[] {
  const rows: BioModelRow[] = []

  for (const preset of REACTION_PRESETS) {
    rows.push(countRow(
      `molecule-${preset.id}`,
      'molecule',
      'kinetics',
      preset.name,
      preset.category,
      `${preset.network.species.length} species · ${preset.network.reactions.length} reactions`,
      preset.note,
    ))
  }

  for (const preset of MITOCHONDRION_PRESETS) {
    rows.push(countRow(
      `organelle-${preset.id}`,
      'organelle',
      'oxphos',
      preset.name,
      'Respiratory states',
      `${preset.parameters.oxygenMicromolar} µM O₂ · ${preset.parameters.atpDemandNanoMolPerSecondPerMilligram} mg⁻¹s⁻¹ demand`,
      preset.note,
    ))
  }

  for (const preset of CELL_PRESETS) {
    const p = preset.HodgkinHuxley
    rows.push(countRow(
      `cell-hh-${preset.id}`,
      'cell',
      'hodgkin-huxley',
      preset.name,
      'Conductance-based',
      `gNa ${p.sodiumConductanceMilliSiemensPerCm2} · gK ${p.potassiumConductanceMilliSiemensPerCm2} · gL ${p.leakConductanceMilliSiemensPerCm2} mS/cm²`,
      preset.note,
    ))
  }
  rows.push(countRow(
    'cell-fhn',
    'cell',
    'fitzhugh-nagumo',
    'FitzHugh–Nagumo relaxation oscillator',
    'Two-variable reduced model',
    `ε ${EXCITABLE_FITZHUGH_NAGUMO.epsilon} · a ${EXCITABLE_FITZHUGH_NAGUMO.a} · b ${EXCITABLE_FITZHUGH_NAGUMO.b}`,
    'The cubic fast nullcline and one slow recovery variable. Dimensionless: v is not a millivolt and no ion '
      + 'current is represented, so this is the topology of an excitable membrane rather than its physiology.',
  ))
  rows.push(countRow(
    'cell-lif',
    'cell',
    'integrate-and-fire',
    'Leaky integrate-and-fire, tonically firing',
    'Point neuron',
    `τ ${TONIC_LIF.tauMs} ms · threshold ${TONIC_LIF.thresholdMillivolts} mV`,
    'An exponential-integrate membrane driven above its own threshold, with an absolute refractory hold. Solved '
      + 'in closed form between spikes, so the spike times are analytic rather than detected off a trace.',
  ))
  for (const preset of CIRCUIT_PRESETS) {
    rows.push(countRow(
      `cell-circuit-${preset.id}`,
      'cell',
      'gene-circuit',
      preset.name,
      'Gene circuits',
      `${preset.circuit.species.length} species · ${preset.circuit.edges.length} regulatory edges`,
      preset.note,
    ))
  }

  for (const preset of TISSUE_PRESETS) {
    rows.push(countRow(
      `tissue-${preset.id}`,
      'tissue',
      'cable',
      preset.name,
      'One-dimensional cable',
      `${preset.cable.cells} compartments · ${preset.cable.lengthMm} mm · D ${preset.cable.diffusivityMm2PerMs} mm²/ms`,
      preset.note,
    ))
  }
  rows.push(countRow(
    'tissue-pacemakers',
    'tissue',
    'oscillators',
    'Locked pacemaker population',
    'Coupled oscillators',
    `${PACEMAKER_POPULATION.naturalFrequenciesHz.length} oscillators · K ${PACEMAKER_POPULATION.couplingHertz} Hz`,
    'A hundred clocks spread ±0.1 Hz about 1 Hz, coupled above the mean-field locking threshold. Coupling is '
      + 'all-to-all, which collapses to the mean field exactly, so the integration costs O(N) per step.',
  ))
  rows.push(countRow(
    'tissue-incoherent',
    'tissue',
    'oscillators',
    'Uncoupled-spread population',
    'Coupled oscillators',
    `${INCOHERENT_POPULATION.naturalFrequenciesHz.length} oscillators · K ${INCOHERENT_POPULATION.couplingHertz} Hz`,
    'The same spread driven below its locking threshold: the population never agrees on a phase, and the order '
      + 'parameter stays low no matter how long the run goes.',
  ))

  for (const preset of CIRCULATION_PRESETS) {
    rows.push(countRow(
      `organ-${preset.id}`,
      'organ',
      'circulation',
      preset.name,
      preset.category,
      `${Math.round(60 / preset.parameters.beatPeriod)} bpm · R ${preset.parameters.resistance} mmHg·s/mL`,
      preset.note,
    ))
  }
  rows.push(countRow(
    'organ-capillary-starling',
    'organ',
    'starling',
    'Capillary bed, Starling forces',
    'Microcirculation',
    `Pc ${RESTING_CAPILLARY.arterialEnd.capillaryPressure}→${RESTING_CAPILLARY.venularEnd.capillaryPressure} mmHg`,
    'Filtration at the arteriolar and venular ends of one capillary against the same oncotic difference. No '
      + 'time domain here — it is an algebraic force balance, and the net the lymphatics must carry is reported '
      + 'rather than assumed away.',
  ))

  for (const preset of PHARMACOKINETIC_PRESETS) {
    rows.push(countRow(
      `system-${preset.id}`,
      'system',
      'pharmacokinetics',
      preset.name,
      preset.category,
      pharmacokineticSpec(preset),
      preset.note,
    ))
  }

  return rows
}

function pharmacokineticSpec(preset: AnyPharmacokineticPreset): string {
  switch (preset.kind) {
    case 'oral':
      return `F ${preset.parameters.bioavailability} · ka ${preset.parameters.absorptionRate} h⁻¹ · CL ${preset.parameters.clearance} L/h`
    case 'bolus-repeat':
      return `${preset.doses} × ${preset.parameters.dose} mg every ${preset.dosingIntervalHours} h`
    case 'two-compartment':
      return `Vc ${preset.parameters.volumeCentral} L · Vp ${preset.parameters.volumePeripheral} L`
    case 'infusion':
      return `${preset.parameters.rate} mg/h · CL ${preset.parameters.clearance} L/h`
    case 'saturable':
      return `Vmax ${preset.parameters.vmax} mg/h · infused ${preset.infusionRate} mg/h`
  }
}

/** The row for one id, or null when the id is not in the index. */
export function bioModelRow(id: string): BioModelRow | null {
  return bioModelRows().find((row) => row.id === id) ?? null
}

/**
 * What a row hands to its solver.
 *
 * `loadBioModel` is the only way the panel gets from a dock row to a parameter
 * set, so the ids the dock shows and the ids the solvers accept are the same
 * ids by construction. `oscillators` carries the population rather than a preset
 * because the two Kuramoto rows differ only in their coupling.
 */
export type LoadedBioModel =
  | { row: BioModelRow; family: 'kinetics'; preset: ReactionPreset }
  | { row: BioModelRow; family: 'oxphos'; preset: MitochondrionPreset }
  | { row: BioModelRow; family: 'hodgkin-huxley'; preset: CellPreset }
  | { row: BioModelRow; family: 'fitzhugh-nagumo' }
  | { row: BioModelRow; family: 'integrate-and-fire' }
  | { row: BioModelRow; family: 'gene-circuit'; preset: CircuitPreset }
  | { row: BioModelRow; family: 'cable'; preset: CablePreset }
  | { row: BioModelRow; family: 'oscillators'; population: { naturalFrequenciesHz: number[]; couplingHertz: number } }
  | { row: BioModelRow; family: 'circulation'; preset: CirculationPreset }
  | { row: BioModelRow; family: 'starling' }
  | { row: BioModelRow; family: 'pharmacokinetics'; preset: AnyPharmacokineticPreset }

export function loadBioModel(id: string): LoadedBioModel {
  const row = bioModelRow(id)
  if (!row) throw new Error(`"${id}" is not a model the biology workspace can load.`)
  const presetId = row.id.replace(`${row.scale}-`, '')
  switch (row.family) {
    case 'kinetics':
      return { row, family: 'kinetics', preset: reactionPreset(presetId) }
    case 'oxphos': {
      const preset = MITOCHONDRION_PRESETS.find((candidate) => candidate.id === presetId)
      if (!preset) throw new Error(`No mitochondrion preset "${presetId}".`)
      return { row, family: 'oxphos', preset }
    }
    case 'hodgkin-huxley': {
      const preset = CELL_PRESETS.find((candidate) => candidate.id === presetId.replace('hh-', ''))
      if (!preset) throw new Error(`No cell preset "${presetId}".`)
      return { row, family: 'hodgkin-huxley', preset }
    }
    case 'fitzhugh-nagumo':
    case 'integrate-and-fire':
      return { row, family: row.family }
    case 'gene-circuit':
      return { row, family: 'gene-circuit', preset: presetCircuit(presetId.replace('circuit-', '')) }
    case 'cable': {
      const preset = TISSUE_PRESETS.find((candidate) => candidate.id === presetId)
      if (!preset) throw new Error(`No cable preset "${presetId}".`)
      return { row, family: 'cable', preset }
    }
    case 'oscillators':
      return {
        row,
        family: 'oscillators',
        population: row.id === 'tissue-pacemakers' ? PACEMAKER_POPULATION : INCOHERENT_POPULATION,
      }
    case 'circulation':
      return { row, family: 'circulation', preset: circulationPreset(presetId) }
    case 'starling':
      return { row, family: 'starling' }
    case 'pharmacokinetics':
      return { row, family: 'pharmacokinetics', preset: pharmacokineticPreset(presetId) }
  }
}
