/**
 * Pharmacokinetics: what happens to a dose the body has to clear.
 *
 * The system scale of the biology domain needs a model that connects the other
 * four. A tissue does not receive "a dose"; it receives the concentration
 * history that perfusion delivers, and that history is set by distribution and
 * clearance. This module computes it.
 *
 * Models, all first-order linear compartment models plus one saturable case:
 *
 * - one-compartment bolus: `C(t) = (D/V)·e^−kt`, `k = CL/V`, `t½ = ln2/k`
 * - constant infusion: `C(t) = (R/CL)(1 − e^−kt)` (the Bateman plateau)
 * - first-order absorption with a lag: the Bateman curve, whose peak time is
 *   `ln(ka/k)/(ka − k)`
 * - two-compartment bolus: the biexponential built from the micro constants, so
 *   the distribution and elimination phases are the model's own, not fitted
 * - multiple dosing by superposition, plus the accumulation factor `1/(1 − e^−kτ)`
 * - Michaelis–Menten elimination, where steady state exists only while the input
 *   rate is below `Vmax`
 *
 * Units are fixed here and used nowhere else: hours, litres, mg, mg/L, L/h. One
 * call never mixes them with another scale's clock; the panel converts on display.
 *
 * Honest limits
 * -------------
 * These are *linear* models with instantaneous, well-mixed compartments, so
 * superposition is exact for them and is used deliberately. The consequences the
 * model cannot see: saturable binding, time-varying clearance (induction,
 * inhibition, renal decline), active metabolites, target-mediated drug disposition,
 * and anything site-specific. A two-compartment fit is not a physiological claim:
 * "peripheral volume" is a bookkeeping bucket, not an organ. The saturable case is
 * integrated rather than superposed, because superposition is false once the
 * elimination rate depends on concentration — that is stated where it matters.
 * The parameter estimator fits a log-linear one-compartment decay; feeding it a
 * biexponential curve returns a slope that means nothing, and the reported `r²`
 * is the guard rail that says so.
 */

import { leastSquares } from '../ml/linalg'
import { integrateModel, requireFraction, requireNonNegative, requirePositive, validateWindow, type BiologyWindow } from './modelSupport'

/** Milliseconds are never used here: the clock is hours, the volume is litres. */
export interface BolusParameters {
  /** Dose reaching the systemic circulation, mg. */
  dose: number
  /** Volume of distribution, L. */
  volume: number
  /** Clearance, L/h. */
  clearance: number
}

export interface CompartmentRate {
  /** Elimination rate constant, h⁻¹. */
  eliminationRate: number
  /** Elimination half-life, h. */
  halfLife: number
  /** Concentration immediately after the dose, mg/L. */
  initialConcentration: number
}

/** `k = CL/V` with the derived quantities a plot label needs. */
export function bolusRates(parameters: BolusParameters): CompartmentRate {
  requirePositive(parameters.dose, 'Dose')
  requirePositive(parameters.volume, 'Volume of distribution')
  requirePositive(parameters.clearance, 'Clearance')
  const eliminationRate = parameters.clearance / parameters.volume
  return {
    eliminationRate,
    halfLife: Math.LN2 / eliminationRate,
    initialConcentration: parameters.dose / parameters.volume,
  }
}

/** The exact one-compartment curve, kept separate so the integrator can be checked against it. */
export function oneCompartmentConcentration(parameters: BolusParameters, timeHours: number): number {
  const { eliminationRate, initialConcentration } = bolusRates(parameters)
  requireNonNegative(timeHours, 'Time')
  return initialConcentration * Math.exp(-eliminationRate * timeHours)
}

export interface ProfileSample {
  time: number
  /** Central-compartment concentration, mg/L. */
  concentration: number
  /** Amount still in the body, mg — the integral the clearance did not take. */
  amount: number
}

function toProfile(samples: readonly { time: number; state: readonly number[] }[], volume: number): ProfileSample[] {
  return samples.map((sample) => ({
    time: sample.time,
    concentration: sample.state[0] / volume,
    amount: sample.state[0],
  }))
}

/**
 * One-compartment bolus integrated from `dA/dt = −kA`.
 *
 * The analytic curve is trivially available, so this function exists to be
 * *compared* with it: it is the same integrator and step planner the saturable
 * and two-compartment models use, and the tests prove they agree.
 */
export function simulateOneCompartmentBolus(parameters: BolusParameters, window: BiologyWindow): ProfileSample[] {
  const { eliminationRate } = bolusRates(parameters)
  const samples = integrateModel(
    (_time, state) => [-eliminationRate * state[0]],
    [parameters.dose],
    window,
    1 / eliminationRate,
  )
  return toProfile(samples, parameters.volume)
}

export interface InfusionParameters {
  /** Infusion rate, mg/h. */
  rate: number
  volume: number
  clearance: number
}

/** `C = (R/CL)(1 − e^−kt)`; the plateau is set by clearance alone, not by volume. */
export function infusionConcentration(parameters: InfusionParameters, timeHours: number): number {
  requirePositive(parameters.rate, 'Infusion rate')
  requirePositive(parameters.volume, 'Volume of distribution')
  requirePositive(parameters.clearance, 'Clearance')
  requireNonNegative(timeHours, 'Time')
  const k = parameters.clearance / parameters.volume
  return (parameters.rate / parameters.clearance) * (1 - Math.exp(-k * timeHours))
}

/** Steady state of a constant infusion, mg/L. Reached exactly only at t → ∞. */
export function infusionSteadyState(parameters: InfusionParameters): number {
  requirePositive(parameters.rate, 'Infusion rate')
  requirePositive(parameters.clearance, 'Clearance')
  return parameters.rate / parameters.clearance
}

export function simulateInfusion(parameters: InfusionParameters, window: BiologyWindow): ProfileSample[] {
  requirePositive(parameters.rate, 'Infusion rate')
  requirePositive(parameters.volume, 'Volume of distribution')
  requirePositive(parameters.clearance, 'Clearance')
  const k = parameters.clearance / parameters.volume
  const samples = integrateModel(
    (_time, state) => [parameters.rate - k * state[0]],
    [0],
    window,
    1 / k,
  )
  return toProfile(samples, parameters.volume)
}

export interface AbsorptionParameters extends BolusParameters {
  /** First-order absorption rate constant, h⁻¹. Must differ from `CL/V`. */
  absorptionRate: number
  /** Fraction of the dose that reaches the circulation, 0…1. */
  bioavailability: number
  /** Delay before absorption starts, h. */
  lagTime?: number
}

/**
 * The Bateman curve. Two exponentials of opposite sign, which is what gives it a
 * rising limb, a peak, and a terminal limb whose slope is the *slower* of the two
 * constants — the reason a flip-flop dosing form can make clearance look like
 * absorption.
 */
export function absorptionConcentration(parameters: AbsorptionParameters, timeHours: number): number {
  requirePositive(parameters.absorptionRate, 'Absorption rate constant')
  requireFraction(parameters.bioavailability, 'Bioavailability')
  const lag = parameters.lagTime ?? 0
  requireNonNegative(lag, 'Lag time')
  const { eliminationRate } = bolusRates(parameters)
  const availableDose = parameters.bioavailability * parameters.dose
  const elapsed = timeHours - lag
  if (elapsed < 0) return 0
  if (Math.abs(parameters.absorptionRate - eliminationRate) < 1e-12) {
    // The limit ka → k: the two exponentials collapse and the bracket becomes t·e^−kt.
    return (availableDose * parameters.absorptionRate * elapsed * Math.exp(-eliminationRate * elapsed)) / parameters.volume
  }
  const coefficient =
    (availableDose * parameters.absorptionRate) /
    (parameters.volume * (parameters.absorptionRate - eliminationRate))
  return coefficient * (Math.exp(-eliminationRate * elapsed) - Math.exp(-parameters.absorptionRate * elapsed))
}

/** Time of the Bateman peak, h after the lag. `ln(ka/k)/(ka − k)`, positive for either ordering. */
export function absorptionPeakTime(parameters: AbsorptionParameters): number {
  const { eliminationRate } = bolusRates(parameters)
  const ka = parameters.absorptionRate
  if (Math.abs(ka - eliminationRate) < 1e-12) {
    // The limit of ln(ka/k)/(ka − k) as ka → k is 1/k, which is also where
    // t·e^−kt peaks: the degenerate case has an answer, so it gets one.
    return 1 / ka
  }
  return Math.log(ka / eliminationRate) / (ka - eliminationRate)
}

export function absorptionPeakConcentration(parameters: AbsorptionParameters): number {
  return absorptionConcentration(parameters, (parameters.lagTime ?? 0) + absorptionPeakTime(parameters))
}

export interface OralProfileSample extends ProfileSample {
  /** Amount still to be absorbed at the dose site, mg. */
  gutAmount: number
}

/**
 * Gut → central → out, integrated rather than superposed.
 *
 * This is the same curve as `absorptionConcentration` arrived at by simulation,
 * which is exactly why it is worth having: the closed-form Bateman is checked
 * against a general-purpose integrator on the identical parameter set.
 *
 * The lag is a split of the run, not a gate inside the derivative. A step method
 * evaluates the vector field at half-steps, so `time >= lag ? flux : 0` turns the
 * delay into a smear of one internal step and the curve starts rising before the
 * food has been swallowed; integrating the two halves separately keeps the delay
 * exact and the curve comparable with the shifted closed form.
 */
export function simulateOralAbsorption(parameters: AbsorptionParameters, window: BiologyWindow): OralProfileSample[] {
  requirePositive(parameters.absorptionRate, 'Absorption rate constant')
  requireFraction(parameters.bioavailability, 'Bioavailability')
  const lag = parameters.lagTime ?? 0
  requireNonNegative(lag, 'Lag time')
  if (lag >= window.tEnd) {
    throw new Error(`Lag time ${lag} h is not inside the simulation window, which ends at ${window.tEnd} h.`)
  }
  const { eliminationRate } = bolusRates(parameters)
  const ka = parameters.absorptionRate
  const loaded = parameters.bioavailability * parameters.dose
  const post = integrateModel(
    (_time, state) => [-ka * state[0], ka * state[0] - eliminationRate * state[1]],
    [loaded, 0],
    { ...window, tEnd: window.tEnd - lag },
    1 / Math.max(ka, eliminationRate),
  ).map((sample) => ({
    time: sample.time + lag,
    concentration: sample.state[1] / parameters.volume,
    amount: sample.state[1],
    gutAmount: sample.state[0],
  }))
  const pre: OralProfileSample[] = []
  const stepsBeforeLag = Math.max(0, Math.floor((lag - 1e-12) / window.dt) + 1)
  for (let index = 0; index < stepsBeforeLag; index += 1) {
    pre.push({ time: index * window.dt, concentration: 0, amount: 0, gutAmount: loaded })
  }
  return [...pre, ...post]
}

export interface TwoCompartmentParameters {
  dose: number
  /** Centrally available volume, L — the one the blood equilibrates with. */
  volumeCentral: number
  /** Peripheral bucket, L. Not an organ. */
  volumePeripheral: number
  clearance: number
  /** Intercompartmental clearance, L/h. */
  distributionClearance: number
}

export interface TwoCompartmentMacros {
  /** Distribution-phase rate constant, h⁻¹ (the faster root). */
  alpha: number
  /** Terminal-phase rate constant, h⁻¹ (the slower root). */
  beta: number
  /** Zero-time intercepts of the two exponentials, mg/L. */
  a: number
  b: number
  /** Terminal half-life, h — the one a dosing interval is argued from. */
  halfLife: number
  micro: { k10: number; k12: number; k21: number }
}

/**
 * Micro to macro constants.
 *
 * `α, β` are the roots of `λ² − (k10+k12+k21)λ + k10·k21 = 0`. The assignment of
 * `A` to `α` comes from solving the two initial conditions `C(0) = D/V1` and
 * `C'(0) = −k10·D/V1`; the asymmetric numerators (`α − k21`, `k21 − β`) are what
 * that solve produces, and both are positive for any physically sensible rate set.
 */
export function twoCompartmentMacros(parameters: TwoCompartmentParameters): TwoCompartmentMacros {
  requirePositive(parameters.dose, 'Dose')
  requirePositive(parameters.volumeCentral, 'Central volume')
  requirePositive(parameters.volumePeripheral, 'Peripheral volume')
  requirePositive(parameters.clearance, 'Clearance')
  requirePositive(parameters.distributionClearance, 'Distribution clearance')
  const k10 = parameters.clearance / parameters.volumeCentral
  const k12 = parameters.distributionClearance / parameters.volumeCentral
  const k21 = parameters.distributionClearance / parameters.volumePeripheral
  const sum = k10 + k12 + k21
  const product = k10 * k21
  const discriminant = sum * sum - 4 * product
  // sum² ≥ 4·product always holds for positive rates, but say so loudly rather
  // than returning NaN if a future edit breaks the invariant.
  if (discriminant < 0) throw new Error(`Two-compartment roots went complex (discriminant ${discriminant}).`)
  const spread = Math.sqrt(discriminant)
  const alpha = (sum + spread) / 2
  const beta = (sum - spread) / 2
  const scale = parameters.dose / parameters.volumeCentral
  return {
    alpha,
    beta,
    a: (scale * (alpha - k21)) / (alpha - beta),
    b: (scale * (k21 - beta)) / (alpha - beta),
    halfLife: Math.LN2 / beta,
    micro: { k10, k12, k21 },
  }
}

/** The closed-form biexponential the integrated two-compartment model is checked against. */
export function twoCompartmentConcentration(parameters: TwoCompartmentParameters, timeHours: number): number {
  const macro = twoCompartmentMacros(parameters)
  requireNonNegative(timeHours, 'Time')
  return macro.a * Math.exp(-macro.alpha * timeHours) + macro.b * Math.exp(-macro.beta * timeHours)
}

export interface TwoCompartmentProfileSample extends ProfileSample {
  /** Concentration in the peripheral bucket, mg/L. */
  peripheralConcentration: number
  /** mg in the peripheral bucket; `central + peripheral + eliminated = dose`. */
  peripheralAmount: number
}

export function simulateTwoCompartmentBolus(
  parameters: TwoCompartmentParameters,
  window: BiologyWindow,
): TwoCompartmentProfileSample[] {
  const macro = twoCompartmentMacros(parameters)
  const { k10, k12, k21 } = macro.micro
  // α never exceeds the sum of the three micro constants, so 1/(k10+k12+k21) is
  // a safe bound on the fastest relaxation without re-solving the roots.
  const fastestTau = 1 / (k10 + k12 + k21)
  const samples = integrateModel(
    (_time, state) => [-(k10 + k12) * state[0] + k21 * state[1], k12 * state[0] - k21 * state[1]],
    [parameters.dose, 0],
    window,
    fastestTau,
  )
  return samples.map((sample) => ({
    time: sample.time,
    concentration: sample.state[0] / parameters.volumeCentral,
    amount: sample.state[0],
    peripheralConcentration: sample.state[1] / parameters.volumePeripheral,
    peripheralAmount: sample.state[1],
  }))
}

/**
 * Amount tracking across the whole model — the conservation check a PK run
 * should never be without, because a dose that vanishes means the clearance term
 * was wired to the wrong compartment.
 */
export function twoCompartmentMassBalance(
  parameters: TwoCompartmentParameters,
  profile: readonly TwoCompartmentProfileSample[],
): { dose: number; recovered: number; eliminated: number } {
  const last = profile[profile.length - 1]
  if (!last) throw new Error('Mass balance needs at least one sample.')
  const recovered = last.amount + last.peripheralAmount
  return { dose: parameters.dose, recovered, eliminated: parameters.dose - recovered }
}

/** `1/(1 − e^−kτ)`: how many times higher the steady-state curve sits above the first dose. */
export function accumulationFactor(eliminationRate: number, dosingInterval: number): number {
  requirePositive(eliminationRate, 'Elimination rate constant')
  requirePositive(dosingInterval, 'Dosing interval')
  return 1 / (1 - Math.exp(-eliminationRate * dosingInterval))
}

/** Average concentration over a dosing interval at steady state: `D/(CL·τ)`, independent of volume. */
export function averageSteadyStateConcentration(parameters: BolusParameters, dosingInterval: number): number {
  requirePositive(dosingInterval, 'Dosing interval')
  requirePositive(parameters.dose, 'Dose')
  requirePositive(parameters.clearance, 'Clearance')
  return parameters.dose / (parameters.clearance * dosingInterval)
}

/** The reporting grid a window implies, validated the same way every run is. */
function timeGrid(window: BiologyWindow): number[] {
  validateWindow(window)
  const count = Math.round(window.tEnd / window.dt) + 1
  return Array.from({ length: count }, (_, index) => index * window.dt)
}

/**
 * Repeated bolus doses by superposition of the single-dose kernel.
 *
 * Exact only because the model is linear: a saturable model must be integrated
 * with the doses as state jumps instead (`saturableEliminationProfile`).
 */
export function multipleDoseBolusProfile(
  parameters: BolusParameters,
  options: { dosingInterval: number; doses: number; window: BiologyWindow },
): ProfileSample[] {
  requirePositive(options.dosingInterval, 'Dosing interval')
  if (!Number.isInteger(options.doses) || options.doses < 1) throw new Error(`Dose count must be a whole number of at least 1 (got ${options.doses}).`)
  const { eliminationRate, initialConcentration } = bolusRates(parameters)
  return timeGrid(options.window).map((time) => {
    let concentration = 0
    for (let index = 0; index < options.doses; index += 1) {
      const elapsed = time - index * options.dosingInterval
      if (elapsed >= 0) concentration += initialConcentration * Math.exp(-eliminationRate * elapsed)
    }
    return { time, concentration, amount: concentration * parameters.volume }
  })
}

/** Trough and peak of a superposed multiple-dose curve, reported at the sample grid. */
export function peakAndTrough(profile: readonly ProfileSample[]): {
  maximum: { time: number; concentration: number }
  minimum: { time: number; concentration: number }
} {
  if (profile.length === 0) throw new Error('Peak and trough need at least one sample.')
  let maximum = profile[0]
  let minimum = profile[0]
  for (const sample of profile) {
    if (sample.concentration > maximum.concentration) maximum = sample
    if (sample.concentration < minimum.concentration) minimum = sample
  }
  return {
    maximum: { time: maximum.time, concentration: maximum.concentration },
    minimum: { time: minimum.time, concentration: minimum.concentration },
  }
}

/** Trapezoidal area under the concentration curve, mg·h/L. */
export function areaUnderCurve(profile: readonly ProfileSample[]): number {
  if (profile.length < 2) throw new Error('Area under the curve needs at least two samples.')
  let area = 0
  for (let index = 1; index < profile.length; index += 1) {
    const dt = profile[index].time - profile[index - 1].time
    area += dt * (profile[index].concentration + profile[index - 1].concentration) / 2
  }
  return area
}

/**
 * `Dose/CL` is exact for a linear model, so a simulated AUC that disagrees is a
 * numerical error report, not a pharmacology result. This is the pairing that
 * makes the trapezoid worth running.
 */
export function doseNormalizedExposure(parameters: BolusParameters): { auc: number; clearance: number } {
  const { clearance } = parameters
  requirePositive(clearance, 'Clearance')
  return { auc: parameters.dose / clearance, clearance }
}

export interface EliminationFit {
  /** h⁻¹, from the slope of `ln C` against time. */
  eliminationRate: number
  halfLife: number
  /** mg/L, from the intercept. */
  initialConcentration: number
  /**
   * Coefficient of determination of the log-linear fit. Read it before believing
   * the rest: a two-compartment curve fitted this way returns a slope that is a
   * weighted average of nothing in particular, and the `r²` is where that shows.
   */
  coefficientOfDetermination: number
  /** Volume implied if the dose is known, L. */
  volume: number | null
}

/** Log-linear regression of a one-compartment decay curve. */
export function estimateElimination(
  profile: readonly ProfileSample[],
  options: { knownDose?: number } = {},
): EliminationFit {
  const usable = profile.filter((sample) => sample.concentration > 0)
  if (usable.length < 2) throw new Error('Parameter estimation needs at least two positive concentrations.')
  const design = usable.map((sample) => [1, sample.time])
  const target = usable.map((sample) => Math.log(sample.concentration))
  const [intercept, slope] = leastSquares(design, target)
  const eliminationRate = -slope
  if (!Number.isFinite(eliminationRate) || eliminationRate <= 0) {
    throw new Error(`Fitted elimination rate came out ${eliminationRate}; the curve is not a decay.`)
  }
  const fitted = target.map((_, index) => intercept + slope * design[index][1])
  const mean = target.reduce((sum, value) => sum + value, 0) / target.length
  const residual = target.reduce((sum, value, index) => sum + (value - fitted[index]) ** 2, 0)
  const total = target.reduce((sum, value) => sum + (value - mean) ** 2, 0)
  const coefficientOfDetermination = total > 0 ? 1 - residual / total : 1
  const initialConcentration = Math.exp(intercept)
  return {
    eliminationRate,
    halfLife: Math.LN2 / eliminationRate,
    initialConcentration,
    coefficientOfDetermination,
    volume: options.knownDose === undefined ? null : options.knownDose / initialConcentration,
  }
}

export interface SaturableParameters {
  dose: number
  volume: number
  /** Maximum elimination rate, mg/h. */
  vmax: number
  /** Concentration at half-maximal elimination, mg/L. */
  km: number
}

/**
 * Capacity-limited elimination: `dA/dt = −Vmax·C/(Km + C)` integrated, never
 * superposed.
 *
 * `steadyStateInfusionRate` is the boundary this model is designed to show: below
 * it an infusion finds a plateau, above it the body stores the drug without limit
 * and there is no steady state to report.
 */
export function saturableEliminationProfile(parameters: SaturableParameters, window: BiologyWindow): ProfileSample[] {
  requirePositive(parameters.dose, 'Dose')
  requirePositive(parameters.volume, 'Volume of distribution')
  requirePositive(parameters.vmax, 'Vmax')
  requirePositive(parameters.km, 'Km')
  const samples = integrateModel(
    (_time, state) => {
      const concentration = Math.max(0, state[0]) / parameters.volume
      return [(-parameters.vmax * concentration) / (parameters.km + concentration)]
    },
    [parameters.dose],
    window,
    // Below Km the loss is first order with rate Vmax/(V·Km), and that is the
    // fastest relaxation this vector field ever offers.
    (parameters.volume * parameters.km) / parameters.vmax,
  )
  return samples.map((sample) => ({
    time: sample.time,
    concentration: Math.max(0, sample.state[0]) / parameters.volume,
    amount: Math.max(0, sample.state[0]),
  }))
}

/**
 * Steady state of a constant infusion against a saturable sink.
 *
 * `R = Vmax·C/(Km + C)` solved for C gives `Km·R/(Vmax − R)`. When `R ≥ Vmax` the
 * capacity is exceeded and the function returns `null` rather than a negative
 * concentration — the honest answer is "this infusion cannot be balanced".
 */
export function saturableInfusionSteadyState(
  parameters: { vmax: number; km: number },
  infusionRate: number,
): number | null {
  requirePositive(parameters.vmax, 'Vmax')
  requirePositive(parameters.km, 'Km')
  requirePositive(infusionRate, 'Infusion rate')
  if (infusionRate >= parameters.vmax) return null
  return (parameters.km * infusionRate) / (parameters.vmax - infusionRate)
}

/**
 * Constant infusion against a capacity-limited sink, integrated.
 *
 * Below the `steadyStateInfusionRate` this settles at the analytic value; at or
 * above it the amount climbs for the whole run, which is the result the model is
 * there to show rather than an error to hide.
 */
export function saturableInfusionProfile(
  parameters: { vmax: number; km: number; volume: number },
  infusionRate: number,
  window: BiologyWindow,
): ProfileSample[] {
  requirePositive(parameters.volume, 'Volume of distribution')
  const steady = saturableInfusionSteadyState(parameters, infusionRate)
  const rateAt = (concentration: number): number => (parameters.vmax * concentration) / (parameters.km + concentration)
  const samples = integrateModel(
    (_time, state) => {
      const concentration = Math.max(0, state[0]) / parameters.volume
      return [infusionRate - rateAt(concentration)]
    },
    [0],
    window,
    // Near the plateau the sink's slope against concentration is
    // Vmax·Km/(Km + Css)², which is (Vmax − R)/(V·(Km + Css)) once the steady
    // state is substituted — so the relaxation time is its reciprocal. Above
    // capacity there is no plateau, and nothing faster than the reporting step.
    steady === null
      ? window.dt
      : (parameters.volume * (parameters.km + steady)) / (parameters.vmax - infusionRate),
  )
  return samples.map((sample) => ({
    time: sample.time,
    concentration: Math.max(0, sample.state[0]) / parameters.volume,
    amount: Math.max(0, sample.state[0]),
  }))
}

/**
 * Time for capacity-limited elimination to take the concentration from `from` to
 * `to`, in hours.
 *
 * The ODE is separable, so this is an exact quadrature rather than a fit:
 * `t = [(V·Km)·ln(A₀/A) + (A₀ − A)] / Vmax` written in amounts. It is the reason
 * the saturable curve can be checked pointwise instead of only eyeballed, and it
 * is the honest way to answer "how long until this is clear" for phenytoin-like
 * drugs, where the answer depends on how much is there.
 */
export function saturableElapsedTime(
  parameters: { vmax: number; km: number; volume: number },
  fromConcentration: number,
  toConcentration: number,
): number {
  requirePositive(parameters.vmax, 'Vmax')
  requirePositive(parameters.km, 'Km')
  requirePositive(parameters.volume, 'Volume of distribution')
  requirePositive(fromConcentration, 'Starting concentration')
  requirePositive(toConcentration, 'Ending concentration')
  if (toConcentration > fromConcentration) throw new Error('Clearing cannot end above the concentration it started at.')
  const fromAmount = fromConcentration * parameters.volume
  const toAmount = toConcentration * parameters.volume
  return ((parameters.volume * parameters.km * Math.log(fromAmount / toAmount) + (fromAmount - toAmount)) / parameters.vmax)
}

/**
 * Clearance the body actually offers at a given concentration: `Vmax/(Km + C)`.
 *
 * This is the quantity that makes the two regimes legible on one plot — it equals
 * `Vmax/Km` at low concentration and falls towards zero as the enzyme saturates,
 * which is why a saturable drug's half-life lengthens as the dose rises.
 */
export function concentrationDependentClearance(parameters: { vmax: number; km: number }, concentration: number): number {
  requirePositive(parameters.vmax, 'Vmax')
  requirePositive(parameters.km, 'Km')
  requireNonNegative(concentration, 'Concentration')
  return parameters.vmax / (parameters.km + concentration)
}
