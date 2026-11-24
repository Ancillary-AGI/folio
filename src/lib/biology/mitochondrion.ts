/**
 * Organelle-scale energetics: a mitochondrion as a proton-driven power supply.
 *
 * The model is the chemiosmotic loop in its lumped form — electron transport
 * pumps protons and builds an electrochemical potential, the potential falls
 * back through ATP synthase (the only place ATP is made) and through a leak
 * conductance, and the adenylate pool sets how hard the synthase is pulled.
 * Everything the panel reports — proton-motive force, oxygen consumption, ATP
 * output, respiratory control — is an output of that loop, not a label.
 *
 * Equations
 * ---------
 * Transport capacity (NADH-linked, oxygen saturating):
 *
 *   PMF_eq   = ΔE · (2 / n_H)                 the thermodynamic ceiling
 *   J_pump   = Jmax · ([O2]/(Km + [O2])) · (1 − PMF/PMF_eq)
 *
 * Return pathways (all substrate-limited, so no concentration can be driven
 * past what the pool holds and none can go negative):
 *
 *   J_atp    = L_atp · [ADP]/(K_adp + [ADP]) · max(0, min(PMF, PMF − PMF_atp))
 *   J_leak   = G_leak · max(0, PMF)
 *   J_hydrol = demand · [ATP]/(K_atp + [ATP])
 *
 * State (the adenylate pool is conserved, so ATP = pool − ADP):
 *
 *   dPMF/dt   = (J_pump − J_atp − J_leak) / C
 *   d[ADP]/dt = (J_hydrol − J_atp / n_ATP) / V_matrix
 *
 * `PMF_eq` comes from the redox span and the pumping stoichiometry, and `PMF_atp`
 * from the phosphorylation potential of the current masses. Neither is typed in as
 * a resting voltage: both move when their inputs move, which is what makes an
 * uncoupler or a hypoxic run do something.
 *
 * The two Michaelis factors are not numerical clamps standing in for a bound; they
 * are the substrate kinetics of the enzymes themselves. ADP is a substrate of F1F0
 * with a K_m in the tens of micromolar, and ATP is the substrate of the loading
 * ATPase. That is also what makes acceptor (respiratory) control a property of the
 * model rather than a thing it is told: clamp either factor off and the pool runs
 * out of its bounds.
 *
 * Time is seconds, potential is millivolts, concentrations are millimolar in the
 * matrix lump, fluxes are nmol per second per mg of mitochondrial protein.
 *
 * Honest limits
 * -------------
 * - **One electrochemical state.** Δψ and ΔpH are reported as a fixed fraction of
 *   a single proton-motive force. In a real mitochondrion the split moves — ΔpH
 *   grows when K⁺/H⁺ exchange is restricted — and this model cannot show that.
 * - **Linear leak.** The inner-membrane proton conductance is exponential in Δψ;
 *   a linear conductance is the first-order stand-in, so uncoupler titration is
 *   qualitative rather than quantitatively right.
 * - **The adenylate pool is one lump.** Cytosolic ATP, creatine kinase, the
 *   translocase and the phosphate carrier are folded into `protonsPerATP` (the
 *   textbook 3 through F1F0 plus 1 for phosphate symport) and one matrix volume.
 *   No AMP, no compartmentalised ATP.
 * - **No metabolite dynamics.** Substrate supply is a single oxygen Michaelis and
 *   a fixed transport capacity: no TCA cycle, no NADH redox state, no calcium
 *   activation of the dehydrogenases, no reactive oxygen species.
 * - **Cristae and complexes are not geometry.** `protonsPerElectronPair` is a
 *   stoichiometry (10 for a NADH-linked chain: complexes I + III + IV), not a
 *   conductance derived from membrane area, and the organelle network's fission
 *   and fusion is out of scope entirely.
 * - Capacitance, conductances and matrix volume are lumped per-mg-protein
 *   parameters of *this* model, set so the resting force, the state-4 oxygen
 *   uptake and the state-4→3 transition land on the order of magnitude reported
 *   for respiring isolated mitochondria. They are calibration values, not
 *   measurements of anything.
 */

import {
  integrateModel,
  requireFraction,
  requireNonNegative,
  requirePositive,
  traceRange,
  type BiologyWindow,
} from './modelSupport'

/** Faraday constant, C/mol. */
export const FARADAY_CONSTANT = 96485.33212
/** Gas constant, J/(mol·K). */
export const GAS_CONSTANT = 8.314462618
/** Standard transformed midpoint potential of the NAD⁺/NADH couple at pH 7, volts. */
export const NAD_REDOX_VOLTS = -0.32
/** Standard transformed midpoint potential of the ½O₂/H₂O couple at pH 7, volts. */
export const OXYGEN_REDOX_VOLTS = 0.82
/** Standard transformed free energy of ATP hydrolysis at pH 7, J/mol. */
export const ATP_HYDROLYSIS_GIBBS_JOULES_PER_MOL = -30500
/** Electrons carried by one reduced pair into the chain. */
const ELECTRONS_PER_PAIR = 2
/** Electron pairs consumed by reducing one O₂ to water. */
const PAIRS_PER_OXYGEN = 2

/** Millivolts of Nernst slope per pH unit at an absolute temperature. */
export const nernstSlopeMillivoltsPerPh = (temperatureKelvin: number): number =>
  (Math.LN10 * GAS_CONSTANT * temperatureKelvin) / FARADAY_CONSTANT * 1000

export interface MitochondrionParameters {
  /** Absolute temperature, K. Sets the Nernst slope and the ATP cost. */
  temperatureKelvin: number
  /** Maximum electron-transport proton flux at saturating substrate, nmol H⁺/(s·mg). */
  transportCapacityNanoMolPerSecondPerMilligram: number
  /** Oxygen Michaelis constant, µM. */
  oxygenKmMicromolar: number
  /** Oxygen available to the chain, µM. */
  oxygenMicromolar: number
  /** Protons translocated per electron pair by the coupled complexes. */
  protonsPerElectronPair: number
  /**
   * Protons that must return through F1F0 and the phosphate carrier to deliver
   * one ATP into the pool. Textbook 3 + 1.
   */
  protonsPerATP: number
  /**
   * Compliance of the proton circuit: how many millivolts one nmol/mg of
   * translocated charge is worth. Sets the electrical relaxation time.
   */
  protonCapacitanceMillivoltsPerNanoMolPerMilligram: number
  /** Linear proton-leak conductance, nmol H⁺/(s·mg·mV). */
  leakConductanceNanoMolPerSecondPerMilligramPerMillivolt: number
  /** ATP-synthase conductance above its threshold, nmol H⁺/(s·mg·mV). */
  synthaseConductanceNanoMolPerSecondPerMilligramPerMillivolt: number
  /** Matrix water volume per mg protein, µL/mg — converts fluxes to concentrations. */
  matrixVolumeMicrolitersPerMilligram: number
  /** Total adenylate (ATP + ADP) in the matrix lump, mM. Conserved by the model. */
  adenylatePoolMillimolar: number
  /** Inorganic phosphate in the matrix lump, mM. */
  phosphateMillimolar: number
  /** ATP consumed by the loading ATPase at saturating ATP, nmol ATP/(s·mg). */
  atpDemandNanoMolPerSecondPerMilligram: number
  /**
   * Michaelis constant of ATP synthase for matrix ADP, mM. ADP is the substrate, so
   * the synthase cannot run the pool below zero; tens of µM is the measured range.
   */
  synthaseAdpKmMillimolar: number
  /** Michaelis constant of the loading ATPase for matrix ATP, mM. */
  demandAtpKmMillimolar: number
  /** Fraction of the proton-motive force carried as membrane potential. */
  membranePotentialFraction: number
}

/** Substrate-replete, acceptor-poor: the classic resting (state 4) lump. */
export const STATE4_MITOCHONDRION: MitochondrionParameters = {
  temperatureKelvin: 310.15,
  transportCapacityNanoMolPerSecondPerMilligram: 10,
  oxygenKmMicromolar: 10,
  oxygenMicromolar: 180,
  protonsPerElectronPair: 10,
  protonsPerATP: 4,
  protonCapacitanceMillivoltsPerNanoMolPerMilligram: 0.6,
  leakConductanceNanoMolPerSecondPerMilligramPerMillivolt: 0.004,
  synthaseConductanceNanoMolPerSecondPerMilligramPerMillivolt: 0.075,
  matrixVolumeMicrolitersPerMilligram: 0.5,
  adenylatePoolMillimolar: 5,
  phosphateMillimolar: 10,
  atpDemandNanoMolPerSecondPerMilligram: 0,
  synthaseAdpKmMillimolar: 0.03,
  demandAtpKmMillimolar: 0.1,
  membranePotentialFraction: 0.85,
}

/** The same organelle with an ATPase on it. */
export const STATE3_MITOCHONDRION: MitochondrionParameters = {
  ...STATE4_MITOCHONDRION,
  atpDemandNanoMolPerSecondPerMilligram: 0.3,
}

export interface MitochondrionInitialState {
  /** Proton-motive force at t=0, mV. Zero starts an uncharged membrane. */
  protonMotiveForceMillivolts: number
  /** Matrix ADP at t=0, mM. Must fit inside the adenylate pool. */
  adpMillimolar: number
}

export const UNCHARGED_START: MitochondrionInitialState = {
  protonMotiveForceMillivolts: 0,
  adpMillimolar: 0.05,
}

export interface MitochondrionSample {
  timeSecond: number
  protonMotiveForceMillivolts: number
  /** Membrane-potential component of the force, mV. */
  membranePotentialMillivolts: number
  /** pH component expressed in pH units (matrix alkaline relative to the lump). */
  phGradient: number
  adpMillimolar: number
  atpMillimolar: number
  /** Proton flux pushed out by electron transport, nmol H⁺/(s·mg). */
  transportFlux: number
  /** Proton flux returned through ATP synthase, nmol H⁺/(s·mg). */
  synthaseFlux: number
  /** Proton flux lost through the leak, nmol H⁺/(s·mg). */
  leakFlux: number
  /** Gross ATP appearance at synthase, nmol ATP/(s·mg). Equal to delivery at steady state. */
  atpProduction: number
  /** Oxygen consumption implied by the transport flux, nmol O₂/(s·mg). */
  oxygenConsumption: number
}

export interface OxPhosMetrics {
  /** Thermodynamic ceiling set by the redox span and the stoichiometry, mV. */
  equilibriumForceMillivolts: number
  /** Force the synthase needs at the final adenylate masses, mV. */
  atpThresholdMillivolts: number
  /** Free energy of making ATP at those masses, J/mol. */
  atpGibbsEnergyJoulesPerMol: number
  /** Proton-motive force averaged over the last quarter of the run, mV. */
  steadyForceMillivolts: number
  /** Oxygen over the same window, nmol O₂/(s·mg). */
  steadyOxygenConsumption: number
  /** ATP output over the same window, nmol ATP/(s·mg). */
  steadyATPProduction: number
  /** Share of pumped protons that came back through synthase, not leak. */
  couplingEfficiency: number
  /** Highest and lowest force reached, mV. */
  forceRange: { min: number; max: number }
  /** False when the last quarter was still moving relative to the one before it. */
  settled: boolean
}

export interface MitochondrionResult {
  samples: MitochondrionSample[]
  metrics: OxPhosMetrics
  parameters: MitochondrionParameters
}

/**
 * The thermodynamic ceiling on the proton-motive force: the redox span per
 * electron, scaled by how many protons that span is asked to pay for.
 *
 * NADH→O₂ at pH 7 is 1.14 V and a NADH-linked chain moves 10 protons per electron
 * pair, so the ceiling is 1.14 × 2/10 = 228 mV. That is why the resting force of
 * isolated mitochondria sits just below it rather than anywhere arbitrary.
 */
export function equilibriumForceMillivolts(parameters: MitochondrionParameters): number {
  const span = OXYGEN_REDOX_VOLTS - NAD_REDOX_VOLTS
  return span * (ELECTRONS_PER_PAIR / parameters.protonsPerElectronPair) * 1000
}

/**
 * Free energy of phosphorylating ADP at the current matrix masses, J/mol.
 *
 * Mass action runs on mol/L, so millimolar is divided by 1000. ADP or ATP at zero
 * would make the log term infinite, and `1e-9` keeps it finite: the threshold
 * simply becomes unreachable and that pathway stops.
 */
export function atpGibbsEnergyJoulesPerMol(
  parameters: MitochondrionParameters,
  adpMillimolar: number,
): number {
  const atp = Math.max(parameters.adenylatePoolMillimolar - adpMillimolar, 1e-6) / 1000
  const adp = Math.max(adpMillimolar, 1e-6) / 1000
  const phosphate = Math.max(parameters.phosphateMillimolar, 1e-6) / 1000
  return -ATP_HYDROLYSIS_GIBBS_JOULES_PER_MOL + GAS_CONSTANT * parameters.temperatureKelvin * Math.log(atp / (adp * phosphate))
}

/** Minimum proton-motive force that can drive synthesis at these masses, mV. */
export function synthesisThresholdMillivolts(
  parameters: MitochondrionParameters,
  adpMillimolar: number,
): number {
  const gibbs = atpGibbsEnergyJoulesPerMol(parameters, adpMillimolar)
  return (gibbs / (parameters.protonsPerATP * FARADAY_CONSTANT)) * 1000
}

/** Transport rate: oxygen saturation times the fraction of the redox span left over. */
function transportFluxAt(parameters: MitochondrionParameters, forceMillivolts: number): number {
  const ceiling = equilibriumForceMillivolts(parameters)
  const saturation =
    parameters.oxygenMicromolar / (parameters.oxygenKmMicromolar + parameters.oxygenMicromolar)
  // Back-pressure: the chain cannot pump against a force it cannot afford, so the
  // rate reaches zero exactly at the ceiling. The upper clamp matters as much as the
  // lower one — below zero force the span term would otherwise exceed capacity and
  // a discharged membrane would pump harder than a saturated one.
  const driving = Math.min(1, Math.max(0, 1 - forceMillivolts / ceiling))
  return parameters.transportCapacityNanoMolPerSecondPerMilligram * saturation * driving
}

/**
 * Synthase proton flux: an ADP-saturated conductance in series with the
 * phosphorylation back-EMF.
 *
 * Two bounds do the work. `min(force, force − threshold)` keeps the flux
 * discharging-only, so a force that has fallen below zero (or a threshold that has
 * gone negative on a fully charged ADP pool) cannot drive current the other way.
 * The Michaelis term makes the flux proportional to ADP near zero, which is what
 * holds the pool inside its own bounds: without it a run with no demand eats ADP
 * past nothing and the mass-action threshold then has no argument left.
 */
function synthaseFluxAt(
  parameters: MitochondrionParameters,
  forceMillivolts: number,
  adpMillimolar: number,
): number {
  const adp = Math.max(0, adpMillimolar)
  const substrate = adp / (parameters.synthaseAdpKmMillimolar + adp)
  const threshold = synthesisThresholdMillivolts(parameters, adp)
  const discharging = Math.min(forceMillivolts, forceMillivolts - threshold)
  return parameters.synthaseConductanceNanoMolPerSecondPerMilligramPerMillivolt * substrate * Math.max(0, discharging)
}

/** The loading ATPase, limited by the ATP it has to burn. */
export function effectiveDemandFlux(
  parameters: MitochondrionParameters,
  adpMillimolar: number,
): number {
  const atp = Math.max(0, parameters.adenylatePoolMillimolar - adpMillimolar)
  return (
    parameters.atpDemandNanoMolPerSecondPerMilligram *
    (atp / (parameters.demandAtpKmMillimolar + atp))
  )
}

function leakFluxAt(parameters: MitochondrionParameters, forceMillivolts: number): number {
  return parameters.leakConductanceNanoMolPerSecondPerMilligramPerMillivolt * Math.max(0, forceMillivolts)
}

export function validateMitochondrionRun(
  parameters: MitochondrionParameters,
  initial: MitochondrionInitialState,
): void {
  requirePositive(parameters.temperatureKelvin, 'Absolute temperature')
  requireNonNegative(parameters.transportCapacityNanoMolPerSecondPerMilligram, 'Transport capacity')
  requirePositive(parameters.oxygenKmMicromolar, 'Oxygen Michaelis constant')
  requireNonNegative(parameters.oxygenMicromolar, 'Oxygen concentration')
  requirePositive(parameters.protonsPerElectronPair, 'Protons per electron pair')
  requirePositive(parameters.protonsPerATP, 'Protons per ATP')
  requirePositive(parameters.protonCapacitanceMillivoltsPerNanoMolPerMilligram, 'Proton capacitance')
  requireNonNegative(parameters.leakConductanceNanoMolPerSecondPerMilligramPerMillivolt, 'Leak conductance')
  requireNonNegative(parameters.synthaseConductanceNanoMolPerSecondPerMilligramPerMillivolt, 'Synthase conductance')
  requirePositive(parameters.matrixVolumeMicrolitersPerMilligram, 'Matrix volume')
  requirePositive(parameters.adenylatePoolMillimolar, 'Adenylate pool')
  requirePositive(parameters.phosphateMillimolar, 'Phosphate')
  requireNonNegative(parameters.atpDemandNanoMolPerSecondPerMilligram, 'ATP demand')
  requirePositive(parameters.synthaseAdpKmMillimolar, 'Synthase ADP Michaelis constant')
  requirePositive(parameters.demandAtpKmMillimolar, 'Demand ATP Michaelis constant')
  requireFraction(parameters.membranePotentialFraction, 'Membrane-potential fraction of the proton-motive force')
  requireNonNegative(initial.protonMotiveForceMillivolts, 'Initial proton-motive force')
  requireNonNegative(initial.adpMillimolar, 'Initial ADP')
  if (initial.adpMillimolar > parameters.adenylatePoolMillimolar) {
    throw new Error(
      `Initial ADP ${initial.adpMillimolar} mM exceeds the adenylate pool of ${parameters.adenylatePoolMillimolar} mM; ` +
        'the pool is conserved, so there is no ATP left to make.',
    )
  }
}

/**
 * The fastest relaxation the proton loop has anywhere inside the box it can reach.
 *
 * This cannot be read off the parameters by inspection. The electrical relaxation
 * `C / (leak + synthase)` is 7.6 s, but the synthase is *also* sensitive to ADP —
 * through the Michaelis factor and, far more, through the mass-action threshold,
 * which moves 6.4 mV per e-fold of ADP. That feedback is roughly fifty times faster
 * than the electrical relaxation, and sizing the step from the slower of the two
 * makes the integrator resolve the force while it mis-solves the adenylate pool: the
 * run lands on a state whose fluxes do not balance, at a level that depends on how
 * often the caller asked for samples. Measured, with the step sized this way, the
 * reported steady state is identical to 6 decimals at reporting steps from 0.01 s to
 * 0.5 s; sized from `C / (leak + synthase)` alone, a 0.5 s cadence is 0.05 mM — 30 %
 * — off the ADP of the converged run.
 *
 * So the rate is evaluated numerically over a grid spanning the reachable region
 * (force 0…ceiling, ADP 0…pool), with grid points kept away from the kinks the
 * `max(0, …)` limits put in the fluxes. The dominant eigenvalue of a 2×2 Jacobian is
 * closed-form, so this is a handful of flux evaluations, not a solver.
 */
export function fastestRelaxationTime(parameters: MitochondrionParameters): number {
  const ceiling = equilibriumForceMillivolts(parameters)
  const pool = parameters.adenylatePoolMillimolar
  const rate = (force: number, adp: number): [number, number] => {
    const pumped = transportFluxAt(parameters, force)
    const returned = synthaseFluxAt(parameters, force, adp)
    const leaked = leakFluxAt(parameters, force)
    return [
      (pumped - returned - leaked) / parameters.protonCapacitanceMillivoltsPerNanoMolPerMilligram,
      (effectiveDemandFlux(parameters, adp) - returned / parameters.protonsPerATP) /
        parameters.matrixVolumeMicrolitersPerMilligram,
    ]
  }
  const dForceStep = ceiling * 1e-6
  const dAdpStep = pool * 1e-6
  let fastest = Number.POSITIVE_INFINITY
  for (const forceFraction of [0.02, 0.25, 0.5, 0.75, 0.95]) {
    for (const adpFraction of [0.002, 0.02, 0.2, 0.6, 0.95]) {
      const force = forceFraction * ceiling
      const adp = adpFraction * pool
      const [baseForce, baseAdp] = rate(force, adp)
      const [forceOfForce, adpOfForce] = rate(force + dForceStep, adp)
      const [forceOfAdp, adpOfAdp] = rate(force, adp + dAdpStep)
      const j11 = (forceOfForce - baseForce) / dForceStep
      const j12 = (forceOfAdp - baseForce) / dAdpStep
      const j21 = (adpOfForce - baseAdp) / dForceStep
      const j22 = (adpOfAdp - baseAdp) / dAdpStep
      // Dominant eigenvalue magnitude of [[j11, j12], [j21, j22]]: the trace/determinant
      // pair, with the complex case (a spiral) handled by |λ| = √det.
      const trace = j11 + j22
      const determinant = j11 * j22 - j12 * j21
      const discriminant = trace * trace - 4 * determinant
      const magnitude =
        discriminant >= 0
          ? Math.max(
              Math.abs((trace + Math.sqrt(discriminant)) / 2),
              Math.abs((trace - Math.sqrt(discriminant)) / 2),
            )
          : Math.sqrt(Math.abs(determinant))
      if (magnitude > 0) fastest = Math.min(fastest, 1 / magnitude)
    }
  }
  if (!Number.isFinite(fastest)) throw new Error('The proton loop has no relaxation to size a step from.')
  return fastest
}

/**
 * Run the oxidative-phosphorylation loop.
 *
 * The internal step is sized from `fastestRelaxationTime`, which scans the whole
 * reachable box rather than the starting point: a run begins wherever the caller
 * puts it, and the fast substrate feedback is just as fast when the trace never
 * visits the corner it was measured in.
 */
export function simulateMitochondrion(
  parameters: MitochondrionParameters,
  initial: MitochondrionInitialState,
  window: BiologyWindow,
): MitochondrionResult {
  validateMitochondrionRun(parameters, initial)

  const derivative = (_time: number, state: readonly number[]): number[] => {
    const [force, adp] = state
    const pumped = transportFluxAt(parameters, force)
    const returned = synthaseFluxAt(parameters, force, adp)
    const leaked = leakFluxAt(parameters, force)
    const dForce = (pumped - returned - leaked) / parameters.protonCapacitanceMillivoltsPerNanoMolPerMilligram
    // ADP is refilled by the ATPase and drained by the synthase. Both are fluxes
    // per mg, so the matrix volume turns them into a concentration rate.
    const dAdp =
      (effectiveDemandFlux(parameters, adp) - returned / parameters.protonsPerATP) /
      parameters.matrixVolumeMicrolitersPerMilligram
    return [dForce, dAdp]
  }

  const samples = integrateModel(
    derivative,
    [initial.protonMotiveForceMillivolts, initial.adpMillimolar],
    window,
    fastestRelaxationTime(parameters),
  )

  const reported = samples.map<MitochondrionSample>((sample) => {
    const [force, adp] = sample.state
    const returned = synthaseFluxAt(parameters, force, adp)
    const pumped = transportFluxAt(parameters, force)
    return {
      timeSecond: sample.time,
      protonMotiveForceMillivolts: force,
      membranePotentialMillivolts: force * parameters.membranePotentialFraction,
      phGradient:
        (force * (1 - parameters.membranePotentialFraction)) / nernstSlopeMillivoltsPerPh(parameters.temperatureKelvin),
      adpMillimolar: adp,
      atpMillimolar: parameters.adenylatePoolMillimolar - adp,
      transportFlux: pumped,
      synthaseFlux: returned,
      leakFlux: leakFluxAt(parameters, force),
      atpProduction: returned / parameters.protonsPerATP,
      // n protons per electron pair, 2 pairs per O₂: the stoichiometry, inverted.
      oxygenConsumption: pumped / parameters.protonsPerElectronPair / PAIRS_PER_OXYGEN,
    }
  })

  return { samples: reported, metrics: summarise(reported, parameters), parameters }
}

/** Mean of a whole window; `slice` has already chosen which part of the run it is. */
function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Cannot average an empty trace.')
  let total = 0
  for (const value of values) total += value
  return total / values.length
}

function summarise(samples: MitochondrionSample[], parameters: MitochondrionParameters): OxPhosMetrics {
  const forces = samples.map((sample) => sample.protonMotiveForceMillivolts)
  const quarter = Math.max(1, Math.floor(samples.length / 4))
  const tail = samples.slice(-quarter)
  const before = samples.slice(Math.max(0, samples.length - 2 * quarter), Math.max(1, samples.length - quarter))
  const tailForce = mean(tail.map((sample) => sample.protonMotiveForceMillivolts))
  const priorForce = mean(before.map((sample) => sample.protonMotiveForceMillivolts))
  const pumped = mean(tail.map((sample) => sample.transportFlux))
  const returned = mean(tail.map((sample) => sample.synthaseFlux))
  const finalAdp = samples[samples.length - 1].adpMillimolar
  return {
    equilibriumForceMillivolts: equilibriumForceMillivolts(parameters),
    atpThresholdMillivolts: synthesisThresholdMillivolts(parameters, finalAdp),
    atpGibbsEnergyJoulesPerMol: atpGibbsEnergyJoulesPerMol(parameters, finalAdp),
    steadyForceMillivolts: tailForce,
    steadyOxygenConsumption: mean(tail.map((sample) => sample.oxygenConsumption)),
    steadyATPProduction: mean(tail.map((sample) => sample.atpProduction)),
    couplingEfficiency: pumped > 0 ? returned / pumped : 0,
    forceRange: traceRange(forces),
    settled: Math.abs(tailForce - priorForce) <= 0.02 * Math.max(Math.abs(tailForce), 1),
  }
}

/**
 * Respiratory control ratio: acceptor-driven uptake over resting uptake.
 *
 * A ratio of two measured runs, so it inherits whatever the runs did. The two
 * parameter sets have to differ only in the load, which is why this takes whole
 * parameter sets rather than a number — the caller can still get it wrong, and the
 * doc says so rather than hiding it.
 */
export function respiratoryControlRatio(
  control: MitochondrionParameters,
  stimulated: MitochondrionParameters,
  initial: MitochondrionInitialState,
  window: BiologyWindow,
): { controlRatio: number; state4Oxygen: number; state3Oxygen: number } {
  const state4 = simulateMitochondrion(control, initial, window)
  const state3 = simulateMitochondrion(stimulated, initial, window)
  const resting = state4.metrics.steadyOxygenConsumption
  const active = state3.metrics.steadyOxygenConsumption
  if (!(resting > 0)) {
    throw new Error('The resting state consumed no oxygen, so no control ratio can be formed.')
  }
  return { controlRatio: active / resting, state4Oxygen: resting, state3Oxygen: active }
}

/** The load dial on its own, for building a state-3 pair from a state-4 lump. */
export function withLoad(
  parameters: MitochondrionParameters,
  atpDemandNanoMolPerSecondPerMilligram: number,
): MitochondrionParameters {
  requireNonNegative(atpDemandNanoMolPerSecondPerMilligram, 'ATP demand')
  return { ...parameters, atpDemandNanoMolPerSecondPerMilligram }
}

/**
 * An uncoupler or an inhibitor, as multipliers.
 *
 * `leakMultiplier` is the uncoupler (more proton return, same chain),
 * `transportMultiplier` the inhibitor (less chain capacity, same leak) and
 * `oxygenMicromolar` the hypoxia. Multipliers rather than new absolute values, so
 * a titration cannot silently move a parameter it was not asked to move.
 */
export function withPerturbation(
  parameters: MitochondrionParameters,
  options: { leakMultiplier?: number; transportMultiplier?: number; oxygenMicromolar?: number } = {},
): MitochondrionParameters {
  const leak = options.leakMultiplier ?? 1
  const transport = options.transportMultiplier ?? 1
  requireNonNegative(leak, 'Leak multiplier')
  requireNonNegative(transport, 'Transport multiplier')
  if (options.oxygenMicromolar !== undefined) requireNonNegative(options.oxygenMicromolar, 'Oxygen concentration')
  return {
    ...parameters,
    leakConductanceNanoMolPerSecondPerMilligramPerMillivolt:
      parameters.leakConductanceNanoMolPerSecondPerMilligramPerMillivolt * leak,
    transportCapacityNanoMolPerSecondPerMilligram:
      parameters.transportCapacityNanoMolPerSecondPerMilligram * transport,
    oxygenMicromolar: options.oxygenMicromolar ?? parameters.oxygenMicromolar,
  }
}

export interface MitochondrionPreset {
  id: string
  name: string
  /**
   * What this state does, in the numbers the run below produces. Notes are written
   * from measurements taken on `window`, not from what the textbook says should
   * happen — the two differ here, and the panel quotes this text to the user.
   */
  note: string
  parameters: MitochondrionParameters
  initial: MitochondrionInitialState
  /** The run the note describes. Hypoxia needs longer than the rest to settle. */
  window: BiologyWindow
}

export const MITOCHONDRION_PRESETS: readonly MitochondrionPreset[] = [
  {
    id: 'state4-resting',
    name: 'Resting (state 4) mitochondrion',
    note: 'Saturating oxygen, no ATP demand. The force charges to 207.9 mV against a 228 mV redox '
      + 'ceiling — and stops a few hundredths of a millivolt short of what making ATP costs once the '
      + 'pool has eaten its own ADP. The synthase never turns, so the 0.042 nmol O₂/(s·mg) of oxygen '
      + 'bought only pays for the leak.',
    parameters: STATE4_MITOCHONDRION,
    initial: { protonMotiveForceMillivolts: 150, adpMillimolar: 0.05 },
    window: { tEnd: 100, dt: 0.5 },
  },
  {
    id: 'state3-active',
    name: 'Phosphorylating (state 3) mitochondrion',
    note: 'The same organelle with an ATPase on it: oxygen uptake goes from 0.042 to 0.095 nmol '
      + 'O₂/(s·mg) and the force falls to 182.1 mV, below the threshold the resting state needed. '
      + 'That pair of moves is respiratory control, and the ratio of the two fluxes — 2.3 — is '
      + 'measured, not set.',
    parameters: STATE3_MITOCHONDRION,
    initial: { protonMotiveForceMillivolts: 150, adpMillimolar: 0.6 },
    window: { tEnd: 100, dt: 0.5 },
  },
  {
    id: 'uncoupled',
    name: 'Uncoupled (FCCP-like leak)',
    note: 'Leak conductance times 40. The force collapses to 47.0 mV, oxygen runs at 0.376 nmol '
      + 'O₂/(s·mg) — three and a half times the phosphorylating rate — and ATP output falls to 0.4 % '
      + 'of it. The demand is still on, so what that trickle cannot cover comes out of the pool: '
      + '100 s later all 5 mM of adenylates are ADP.',
    parameters: withPerturbation(STATE3_MITOCHONDRION, { leakMultiplier: 40 }),
    initial: { protonMotiveForceMillivolts: 150, adpMillimolar: 0.6 },
    window: { tEnd: 100, dt: 0.5 },
  },
  {
    id: 'hypoxic',
    name: 'Hypoxic matrix',
    note: 'Oxygen at 3 µM against a 10 µM Michaelis, so transport is substrate-limited: uptake drops '
      + 'to 0.064 nmol O₂/(s·mg) and the force sags to 102.0 mV. Output only falls a quarter, because '
      + 'the demand in this model stays fixed — the pool is what pays, draining to 0.26 mM ATP of 5 mM, '
      + 'and it takes 200 s to get there.',
    parameters: withPerturbation(STATE3_MITOCHONDRION, { oxygenMicromolar: 3 }),
    initial: { protonMotiveForceMillivolts: 150, adpMillimolar: 0.6 },
    // Two hundred seconds, not the hundred the others settle in: at 100 s this run is
    // still sliding and `metrics.settled` says so. The step ceiling will not pay for
    // much longer than this either — 400 s throws.
    window: { tEnd: 200, dt: 0.5 },
  },
]
