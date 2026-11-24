/**
 * Automatic controller tuning — the design half of the numerical toolbox.
 *
 * Everything here answers the control-engineering question "what gains, and how
 * do I know they are right?" using the same four routes a human engineer uses:
 *
 *   1. Rules of thumb on a identified model (Ziegler–Nichols open-loop, SIMC
 *      λ-tuning) — `gainsFromFopdt`, fed by `fitFopdt` in `../ml/systemIdentification`.
 *   2. Relay auto-tuning — `relayAutoTune`, which closes the loop with a
 *      hysteretic relay, measures the real limit cycle, and converts it to an
 *      ultimate gain and period (Åström–Hägglund). This is what a DCS does in
 *      "autotune" mode.
 *   3. Search over the actual closed-loop simulation — `tuneBySearch`, using the
 *      differential-evolution / Nelder-Mead / simulated-annealing heuristics in
 *      `../ml/optimizers` against a cost function whose every term is reported.
 *   4. Surrogate-assisted search — `tuneBySurrogate`, which spends a Gaussian
 *      process on cheap predictions so an expensive simulation is only run on
 *      the few candidates worth measuring.
 *
 * None of this is the agent layer. An agent creates designs without a human in
 * the loop; a tuner here is a deterministic numerical routine that the engineer
 * starts, bounds and audits. Every result carries its cost breakdown, its
 * margins, its termination reason and the evaluations it consumed, so a tuning
 * claim can be re-run and checked rather than trusted.
 *
 * Honest limits, stated up front:
 *   • The linear routes (1, 3, 4) judge the *continuous-time* loop. Actuator
 *     saturation and anti-windup are nonlinear and are checked separately with
 *     `simulateSampledLoop`.
 *   • Rules of thumb are tuned for self-regulating first-order plants. Ziegler–
 *     Nichols is documented to give ~40–60 % overshoot and to be aggressive on
 *     delay-dominant plants; that behaviour is reported, not hidden.
 *   • Search finds the best point *inside the bounds you gave it* under the
 *     budget you allowed. `termination: 'budget'` means the cap ran out, not
 *     that the optimum was found.
 */

import { createRandomSource, shuffleInPlace } from '../ml/random'
import { GaussianProcessRegressor } from '../ml/gaussianProcess'
import {
  differentialEvolution,
  nelderMead,
  simulatedAnnealing,
  type Bounds,
  type OptimizerResult,
} from '../ml/optimizers'
import type { FopdtModel } from '../ml/systemIdentification'
import {
  DEFAULT_DERIVATIVE_FILTER_SECONDS,
  pidStep,
  pidTransferFunction,
  initialPidState,
  type PidGains,
  type PidLimits,
} from './pid'
import {
  simulateStateSpace,
  stabilityMargins,
  stepResponseMetrics,
  tfFeedback,
  tfPoles,
  tfSeries,
  tfToStateSpace,
  type MarginOptions,
  type StabilityMargins,
  type StepMetrics,
  type TransferFunction,
} from './transferFunction'

export type ControllerStructure = 'P' | 'PI' | 'PID'

const STRUCTURE_COUNTS: Record<ControllerStructure, number> = { P: 1, PI: 2, PID: 3 }

/**
 * Cost handed back for a candidate that cannot be scored at all (diverging or
 * non-finite loop). It is a large *finite* number on purpose: the optimisers
 * reject non-finite objectives outright, and a crashed simulation must rank as
 * "very bad but measured" rather than crash the whole search.
 */
export const INFEASIBLE_COST = 1e6

export interface LoopSpec {
  /** Process model `P(s)`, in the units the engineer works in. */
  plant: TransferFunction
  /** Horizon every candidate is judged over. */
  tEndSeconds: number
  dtSeconds: number
  /** Step applied to the reference (default 1). Scales every metric. */
  setpointStep?: number
  /** Derivative filter of the controller; must be > 0 (the PID module's rule). */
  derivativeFilterSeconds?: number
  /**
   * Frequency scan used to evaluate gain/phase margin on the loop transfer
   * `L = P·C`. Margin targets are *ignored* — with a note — when this is absent,
   * because guessing a scan range is how a margin constraint silently stops
   * biting.
   */
  marginScan?: MarginOptions
}

export interface PerformanceTargets {
  /** Percent of the final value. Default 10 %. */
  maxOvershootPct?: number
  /** Default 60 % of the horizon. */
  maxSettlingSeconds?: number
  /** Only enforced when `marginScan` is supplied. Default 30°. */
  minPhaseMarginDeg?: number
  /** Only enforced when `marginScan` is supplied. Default 6 dB. */
  minGainMarginDb?: number
}

export interface CostWeights {
  /** Normalised integral time-weighted absolute error. Default 1. */
  error?: number
  /** Quadratic overshoot violation. Default 4. */
  overshoot?: number
  /** Quadratic settling-time violation. Default 2. */
  settling?: number
  /** Closed-loop instability. Default 1e3 per unit of spectral abscissa. */
  stability?: number
  /** Margin violations. Default 5. */
  margin?: number
}

interface CostWeighting {
  error: number
  overshoot: number
  settling: number
  stability: number
  margin: number
}

interface ResolvedTargets {
  maxOvershootPct: number
  maxSettlingSeconds: number
  minPhaseMarginDeg: number
  minGainMarginDb: number
}

export interface LoopEvaluation {
  gains: PidGains
  structure: ControllerStructure
  /** Reference-to-output closed loop `P·C / (1 + P·C)`. */
  complementary: TransferFunction
  /** Loop transfer `P·C`, the object the margins belong to. */
  openLoop: TransferFunction
  metrics: StepMetrics
  /** Normalised integral time-weighted absolute error, dimensionless. */
  normalisedError: number
  /** ∫|e|·t dt in output-units·s², the un-normalised form. */
  itae: number
  steadyStateError: number
  /** `null` when no `marginScan` was supplied. */
  margins: StabilityMargins | null
  /** Largest closed-loop pole real part; < 0 is stable. */
  spectralAbscissa: number
  cost: number
  /** Every cost term, so the engineer can see what drove the tuner. */
  breakdown: { error: number; overshoot: number; settling: number; stability: number; margin: number }
  /** Reference step and the simulated response, for the trace chart. */
  trace: Array<{ time: number; output: number; reference: number; error: number }>
  notes: string[]
}

function resolveWeights(weights: CostWeights = {}): CostWeighting {
  const entries = [
    ['error', weights.error ?? 1],
    ['overshoot', weights.overshoot ?? 4],
    ['settling', weights.settling ?? 2],
    ['stability', weights.stability ?? 1e3],
    ['margin', weights.margin ?? 5],
  ] as const
  const resolved: CostWeighting = { error: 0, overshoot: 0, settling: 0, stability: 0, margin: 0 }
  for (const [name, value] of entries) {
    if (!Number.isFinite(value) || value < 0) throw new Error(`Cost weight ${name} must be a finite non-negative number (got ${value}).`)
    resolved[name] = value
  }
  return resolved
}

function validateSpec(spec: LoopSpec): { setpointStep: number; derivativeFilterSeconds: number } {
  if (!Number.isFinite(spec.tEndSeconds) || spec.tEndSeconds <= 0) throw new Error(`Loop horizon must be positive (got ${spec.tEndSeconds}).`)
  if (!Number.isFinite(spec.dtSeconds) || spec.dtSeconds <= 0) throw new Error(`Loop sample interval must be positive (got ${spec.dtSeconds}).`)
  if (spec.tEndSeconds / spec.dtSeconds > 200_000) throw new Error(`Horizon ${spec.tEndSeconds} s at ${spec.dtSeconds} s exceeds 200000 samples — coarsen dt or shorten the run.`)
  if (spec.dtSeconds >= spec.tEndSeconds / 8) throw new Error(`The horizon holds only ${Math.floor(spec.tEndSeconds / spec.dtSeconds)} samples; a cost function that coarse cannot resolve a transient.`)
  const setpointStep = spec.setpointStep ?? 1
  if (!Number.isFinite(setpointStep) || setpointStep === 0) throw new Error(`Setpoint step must be finite and non-zero (got ${setpointStep}).`)
  const derivativeFilterSeconds = spec.derivativeFilterSeconds ?? DEFAULT_DERIVATIVE_FILTER_SECONDS
  if (!Number.isFinite(derivativeFilterSeconds) || derivativeFilterSeconds <= 0) {
    throw new Error(`Derivative filter time constant must be positive (got ${derivativeFilterSeconds}).`)
  }
  if (spec.marginScan) {
    if (!(spec.marginScan.fMinHz > 0) || !(spec.marginScan.fMaxHz > spec.marginScan.fMinHz)) {
      throw new Error(`Margin scan needs 0 < fMinHz < fMaxHz (got ${spec.marginScan.fMinHz}..${spec.marginScan.fMaxHz}).`)
    }
  }
  return { setpointStep, derivativeFilterSeconds }
}

function assertGainsFinite(gains: PidGains): void {
  for (const [name, value] of [
    ['kp', gains.kp],
    ['ki', gains.ki],
    ['kd', gains.kd],
  ] as const) {
    if (!Number.isFinite(value)) throw new Error(`Tuner produced a non-finite ${name} (${value}).`)
  }
}

/**
 * Simulate a plant in a sampled loop whose input is produced by `decide`, a
 * function of the current time, the current measurement and the step index.
 *
 * The control value is held across each interval (zero-order hold) and the
 * algebraic feedthrough `D·u` of the plant uses the value held from the previous
 * sample. That is exactly what a digital controller does; it also means no
 * algebraic loop is assumed, so a relay or a saturating PID can be simulated
 * even though `simulateStateSpace` cannot close such a loop.
 */
function marchSampledLoop(
  plant: TransferFunction,
  options: { dtSeconds: number; tEndSeconds: number },
  decide: (time: number, measurement: number, step: number) => number,
): Array<{ time: number; output: number; control: number }> {
  const ss = tfToStateSpace(plant)
  const dt = options.dtSeconds
  const steps = Math.ceil(options.tEndSeconds / dt)
  if (steps > 200_000) throw new Error(`Sampled loop needs ${steps} steps (limit 200000); coarsen dt or shorten the run.`)
  const dimension = ss.b.length
  let state = new Array<number>(dimension).fill(0)
  let heldControl = decide(0, ss.d * 0, 0)

  const advance = (x: number[], u: number): number[] => {
    const derivative = (x0: number[]): number[] => {
      const out = new Array<number>(dimension).fill(0)
      for (let i = 0; i < dimension; i += 1) {
        let sum = ss.b[i] * u
        const row = ss.a[i]
        for (let j = 0; j < dimension; j += 1) sum += row[j] * x0[j]
        out[i] = sum
      }
      return out
    }
    const k1 = derivative(x)
    const k2 = derivative(x.map((value, i) => value + (dt / 2) * k1[i]))
    const k3 = derivative(x.map((value, i) => value + (dt / 2) * k2[i]))
    const k4 = derivative(x.map((value, i) => value + dt * k3[i]))
    return x.map((value, i) => value + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]))
  }

  const measurementOf = (x: readonly number[], u: number): number => {
    let y = ss.d * u
    for (let i = 0; i < dimension; i += 1) y += ss.c[i] * x[i]
    return y
  }

  const samples: Array<{ time: number; output: number; control: number }> = []
  for (let step = 0; step <= steps; step += 1) {
    const time = Math.min(step * dt, options.tEndSeconds)
    const measurement = measurementOf(state, heldControl)
    samples.push({ time, output: measurement, control: heldControl })
    if (step === steps) break
    if (!Number.isFinite(measurement)) {
      throw new Error(`Sampled loop diverged at t = ${time.toFixed(4)} s (${measurement}); the plant or the controller is not realisable as configured.`)
    }
    heldControl = decide(time, measurement, step)
    if (!Number.isFinite(heldControl)) throw new Error(`Controller returned a non-finite output at t = ${time.toFixed(4)} s.`)
    state = advance(state, heldControl)
  }
  return samples
}

/** Trapezoidal ∫|e|·t dt, scaled so the value is comparable across runs. */
function integralTimeWeightedAbsoluteError(
  trace: ReadonlyArray<{ time: number; error: number }>,
): number {
  let sum = 0
  for (let i = 1; i < trace.length; i += 1) {
    const dt = trace[i].time - trace[i - 1].time
    const left = Math.abs(trace[i - 1].error) * trace[i - 1].time
    const right = Math.abs(trace[i].error) * trace[i].time
    sum += 0.5 * (left + right) * dt
  }
  return sum
}

function worstViolations(
  metrics: StepMetrics,
  margins: StabilityMargins | null,
  targets: ResolvedTargets,
  scanningMargins: boolean,
): { overshoot: number; settling: number; margin: number; marginNotes: string[] } {
  const overshoot = Number.isFinite(metrics.overshootPct)
    ? Math.max(0, metrics.overshootPct - targets.maxOvershootPct) / Math.max(targets.maxOvershootPct, 1e-9)
    : 1
  const settling = Number.isFinite(metrics.settlingTimeSeconds)
    ? Math.max(0, metrics.settlingTimeSeconds - targets.maxSettlingSeconds) / Math.max(targets.maxSettlingSeconds, 1e-9)
    : 1
  const marginNotes: string[] = []
  let margin = 0
  if (!scanningMargins) {
    marginNotes.push('No marginScan supplied: phase and gain margin targets were not enforced.')
  } else if (margins) {
    if (Number.isFinite(margins.phaseMarginDeg) && margins.phaseMarginDeg < targets.minPhaseMarginDeg) {
      margin += (targets.minPhaseMarginDeg - margins.phaseMarginDeg) / Math.max(targets.minPhaseMarginDeg, 1e-9)
    }
    if (Number.isFinite(margins.gainMarginDb) && margins.gainMarginDb < targets.minGainMarginDb) {
      margin += (targets.minGainMarginDb - margins.gainMarginDb) / Math.max(targets.minGainMarginDb, 1e-9)
    }
    if (Number.isNaN(margins.phaseMarginDeg)) marginNotes.push('Phase margin is undefined over the scan: the loop gain never crosses 0 dB.')
    if (Number.isNaN(margins.gainMarginDb)) marginNotes.push('Gain margin is undefined over the scan: the loop phase never crosses −180°. An Infinity margin means the loop cannot be driven unstable by gain alone.')
  }
  return { overshoot, settling, margin, marginNotes }
}

/**
 * Full evaluation of one candidate gain set against the spec.
 *
 * This is the objective every search method uses, exposed on its own so an
 * engineer can score any gains they like and read *why* the tuner liked or
 * disliked them.
 */
export function loopEvaluation(
  gainsIn: PidGains,
  spec: LoopSpec,
  targets: PerformanceTargets = {},
  weights: CostWeights = {},
): LoopEvaluation {
  const { setpointStep, derivativeFilterSeconds } = validateSpec(spec)
  const gains: PidGains = { ...gainsIn, derivativeFilterSeconds }
  assertGainsFinite(gains)
  const structure = structureOf(gains)
  const cost = resolveWeights(weights)
  const resolvedTargets: ResolvedTargets = {
    maxOvershootPct: targets.maxOvershootPct ?? 10,
    maxSettlingSeconds: targets.maxSettlingSeconds ?? 0.6 * spec.tEndSeconds,
    minPhaseMarginDeg: targets.minPhaseMarginDeg ?? 30,
    minGainMarginDb: targets.minGainMarginDb ?? 6,
  }
  if (!(resolvedTargets.maxOvershootPct > 0)) throw new Error('Overshoot target must be positive.')
  if (!(resolvedTargets.maxSettlingSeconds > 0)) throw new Error('Settling-time target must be positive.')

  const controller = pidTransferFunction(gains)
  const openLoop = tfSeries(spec.plant, controller)
  const complementary = tfFeedback(openLoop)

  const notes: string[] = []
  const spectralAbscissa = largestPoleRealPart(complementary)
  const marginScan = spec.marginScan
  const scanningMargins = marginScan !== undefined
  const margins = marginScan ? stabilityMargins(openLoop, marginScan) : null

  const samples = simulateStateSpace(
    tfToStateSpace(complementary),
    () => setpointStep,
    { tEndSeconds: spec.tEndSeconds, dtSeconds: spec.dtSeconds },
  )
  if (samples.some((sample) => !Number.isFinite(sample.output))) {
    notes.push('Closed-loop simulation produced a non-finite sample: the loop is not realisable with these gains.')
    return infeasibleEvaluation(gains, structure, complementary, openLoop, setpointStep, spectralAbscissa, margins, notes)
  }

  const trace = samples.map((sample) => ({
    time: sample.timeSeconds,
    output: sample.output,
    reference: setpointStep,
    error: setpointStep - sample.output,
  }))
  const itae = integralTimeWeightedAbsoluteError(trace)
  // Dimensionless: an error of the full step for the full horizon scores 1.
  const normalisation = Math.abs(setpointStep) * spec.tEndSeconds ** 2 / 2
  const normalisedError = itae / normalisation

  const metrics = stepResponseMetrics(samples)
  if (!margins?.closedLoopStable && scanningMargins) notes.push('Margin check reports the closed loop unstable.')
  const violations = worstViolations(metrics, margins, resolvedTargets, scanningMargins)
  notes.push(...violations.marginNotes)

  const breakdown = {
    error: cost.error * normalisedError,
    overshoot: cost.overshoot * violations.overshoot ** 2,
    settling: cost.settling * violations.settling ** 2,
    stability: spectralAbscissa > 0 ? cost.stability * spectralAbscissa * Math.max(1, Math.abs(setpointStep)) : 0,
    margin: cost.margin * violations.margin ** 2,
  }
  const total = breakdown.error + breakdown.overshoot + breakdown.settling + breakdown.stability + breakdown.margin
  if (!Number.isFinite(total)) {
    notes.push('Cost overflowed; treating this candidate as infeasible.')
    return infeasibleEvaluation(gains, structure, complementary, openLoop, setpointStep, spectralAbscissa, margins, notes)
  }
  if (spectralAbscissa > 0) notes.push(`Closed loop unstable (largest pole real part ${spectralAbscissa.toExponential(3)}); penalty ${breakdown.stability.toExponential(3)}.`)
  if (Number.isNaN(metrics.riseTimeSeconds)) notes.push('Response never rose through 10 %/90 % of the step, so rise time is undefined.')
  if (metrics.settlingTimeSeconds >= spec.tEndSeconds - spec.dtSeconds) notes.push('Response was still outside the ±2 % band at the end of the horizon.')

  return {
    gains,
    structure,
    complementary,
    openLoop,
    metrics,
    normalisedError,
    itae,
    steadyStateError: trace.length > 0 ? trace[trace.length - 1].error : Number.NaN,
    margins,
    spectralAbscissa,
    cost: total,
    breakdown,
    trace,
    notes,
  }
}

function infeasibleEvaluation(
  gains: PidGains,
  structure: ControllerStructure,
  complementary: TransferFunction,
  openLoop: TransferFunction,
  setpointStep: number,
  spectralAbscissa: number,
  margins: StabilityMargins | null,
  notes: string[],
): LoopEvaluation {
  return {
    gains,
    structure,
    complementary,
    openLoop,
    metrics: {
      steadyState: Number.NaN,
      overshootPct: Number.NaN,
      riseTimeSeconds: Number.NaN,
      settlingTimeSeconds: Number.NaN,
    },
    // The transient never produced a readable curve, so its integrals and its
    // endpoint are reported as undefined instead of being padded with zeros.
    normalisedError: Number.NaN,
    itae: Number.NaN,
    steadyStateError: Number.NaN,
    margins,
    spectralAbscissa,
    cost: INFEASIBLE_COST,
    breakdown: { error: 0, overshoot: 0, settling: 0, stability: INFEASIBLE_COST, margin: 0 },
    trace: [{ time: 0, output: 0, reference: setpointStep, error: setpointStep }],
    notes,
  }
}

function largestPoleRealPart(tf: TransferFunction): number {
  const poles = tfPoles(tf)
  if (poles.length === 0) return 0
  return Math.max(...poles.map((pole) => pole.re))
}

function structureOf(gains: PidGains): ControllerStructure {
  if (Math.abs(gains.kd) > 0) return 'PID'
  if (Math.abs(gains.ki) > 0) return 'PI'
  return 'P'
}

/* ------------------------------------------------------------------ *
 * Rules of thumb on an identified model
 * ------------------------------------------------------------------ */

export type TuningRule = 'ziegler-nichols' | 'simc'

export interface RuleBasedTuning {
  gains: PidGains
  rule: TuningRule
  structure: ControllerStructure
  /** The intermediate quantities the rule used, in seconds and absolute units. */
  detail: Record<string, number>
  /** What the rule is known to do, and where it is being pushed past that. */
  notes: string[]
}

/**
 * Gains from a first-order-plus-dead-time model.
 *
 * Ziegler–Nichols open-loop (Ziegler & Nichols, 1942):
 *   P   Kp = 0.5·τ/(K·L)
 *   PI  Kp = 0.45·τ/(K·L), Ti = 0.83·τ
 *   PID Kp = 0.6·τ/(K·L),  Ti = 0.5·τ, Td = 0.125·τ
 *
 * SIMC / λ-tuning (Skogestad, 2003), which trades a documented response time for
 * robustness instead of chasing the stability boundary:
 *   Kp = τ/(K·(λ + L)),  Ti = min(τ, 4·(λ + L)),  Td = 0 for a first-order model
 *
 * `K` is the modelled static gain and may be negative for a reverse-acting
 * plant; the gains then come out negative, which is correct, not a bug.
 */
export function gainsFromFopdt(
  model: FopdtModel,
  options: { rule: TuningRule; structure?: ControllerStructure; lambdaSeconds?: number },
): RuleBasedTuning {
  const structure = options.structure ?? 'PID'
  const K = model.gain
  const tau = model.timeConstant
  const deadTime = model.deadTime
  if (!(Math.abs(K) > 0)) throw new Error('The model static gain is zero, so no controller setting can be derived from it.')
  if (!(tau > 0)) throw new Error(`Model time constant must be positive (got ${tau}).`)

  const notes: string[] = []
  if (K < 0) notes.push(`Static gain is negative (${K}), so the controller is reverse-acting: kp, ki and kd all come out negative.`)
  if (Math.abs(K) < 1e-6) notes.push(`Static gain is very small (${K}), so the proportional gain is correspondingly large — check the actuator rating before applying this.`)

  if (options.rule === 'ziegler-nichols') {
    if (!(deadTime > 0)) {
      throw new Error(
        'Ziegler–Nichols open-loop divides by the dead time, and this model has none. Use rule "simc" (λ-tuning), which does not need dead time, or re-measure the step test with a finer sample interval.',
      )
    }
    const ratio = tau / (K * deadTime)
    let kp: number
    let ti = Number.NaN
    let td = Number.NaN
    if (structure === 'P') kp = 0.5 * ratio
    else if (structure === 'PI') {
      kp = 0.45 * ratio
      ti = 0.83 * tau
    } else {
      kp = 0.6 * ratio
      ti = 0.5 * tau
      td = 0.125 * tau
    }
    notes.push('Ziegler–Nichols targets the stability boundary: a quarter-decay ratio, about 40 % overshoot and aggressive derivative are the rule\'s documented behaviour, not a defect.')
    if (deadTime / tau > 0.5) notes.push(`Dead time is ${(100 * deadTime / tau).toFixed(1)} % of the time constant; Z-N is known to be badly over-tuned on delay-dominant plants. Prefer simc with λ ≥ L.`)
    return {
      gains: buildGains(kp, ti, td, structure),
      rule: 'ziegler-nichols',
      structure,
      detail: { 'Kp': kp, 'Ti seconds': ti, 'Td seconds': td, 'K': K, 'tau seconds': tau, 'dead time seconds': deadTime },
      notes,
    }
  }

  const lambda = options.lambdaSeconds ?? (deadTime > 0 ? deadTime : 0.1 * tau)
  if (!(lambda > 0)) throw new Error(`SIMC closed-loop time constant must be positive (got ${lambda}).`)
  const kp = tau / (K * (lambda + deadTime))
  const ti = Math.min(tau, 4 * (lambda + deadTime))
  if (structure === 'PID') notes.push('SIMC assigns no derivative action to a first-order-plus-delay model, so the PID request degenerates to PI — a derivative term would only amplify noise.')
  if (lambda < deadTime) notes.push(`λ (${lambda}) is below the dead time (${deadTime}); the loop will be faster than the plant can be observed and will ring.`)
  notes.push('SIMC keeps a documented margin: the setpoint response time λ is the robustness dial, λ = L is aggressive, λ ≥ 3L is conservative.')
  return {
    gains: buildGains(kp, ti, Number.NaN, structure),
    rule: 'simc',
    structure,
    detail: { 'Kp': kp, 'Ti seconds': ti, 'lambda seconds': lambda, 'K': K, 'tau seconds': tau, 'dead time seconds': deadTime },
    notes,
  }
}

function buildGains(kp: number, ti: number, td: number, structure: ControllerStructure): PidGains {
  const gains: PidGains = { kp, ki: 0, kd: 0 }
  if (structure === 'PI' || structure === 'PID') {
    if (!(ti > 0)) throw new Error(`Integral time from the identified model is not positive (${ti}); the model is not usable for tuning.`)
    gains.ki = kp / ti
  }
  if (structure === 'PID' && Number.isFinite(td)) {
    if (!(td >= 0)) throw new Error(`Derivative time is negative (${td}); the identified model cannot support a PID rule.`)
    gains.kd = kp * td
    // The filter must be shorter than the derivative action it is filtering, or
    // the "derivative" is really just a gain.
    gains.derivativeFilterSeconds = Math.min(DEFAULT_DERIVATIVE_FILTER_SECONDS, 0.1 * td)
  }
  for (const value of [gains.kp, gains.ki, gains.kd]) {
    if (!Number.isFinite(value)) throw new Error('Rule-based tuning produced a non-finite gain; check the model constants.')
  }
  return gains
}

/* ------------------------------------------------------------------ *
 * Ultimate-cycle rules (relay auto-tuning output)
 * ------------------------------------------------------------------ */

/**
 * Ziegler–Nichols closed-loop (ultimate-cycle) settings:
 *   P   Kp = 0.5·Ku
 *   PI  Kp = 0.45·Ku, Ti = Tu/1.2
 *   PID Kp = 0.6·Ku,  Ti = Tu/2, Td = Tu/8
 */
export function gainsFromUltimateCycle(
  ultimate: { ultimateGain: number; periodSeconds: number },
  options: { structure?: ControllerStructure } = {},
): RuleBasedTuning {
  const structure = options.structure ?? 'PID'
  const ku = ultimate.ultimateGain
  const period = ultimate.periodSeconds
  if (!(ku > 0)) throw new Error(`Ultimate gain must be positive (got ${ku}). A relay test on a reverse-acting plant needs the amplitude sign flipped.`)
  if (!(period > 0)) throw new Error(`Oscillation period must be positive (got ${period}).`)
  const kp = structure === 'P' ? 0.5 * ku : structure === 'PI' ? 0.45 * ku : 0.6 * ku
  const ti = structure === 'P' ? Number.NaN : structure === 'PI' ? period / 1.2 : period / 2
  const td = structure === 'PID' ? period / 8 : Number.NaN
  const gains: PidGains = { kp, ki: 0, kd: 0 }
  if (Number.isFinite(ti)) gains.ki = kp / ti
  if (Number.isFinite(td)) {
    gains.kd = kp * td
    gains.derivativeFilterSeconds = Math.min(DEFAULT_DERIVATIVE_FILTER_SECONDS, 0.1 * td)
  }
  return {
    gains,
    rule: 'ziegler-nichols',
    structure,
    detail: { 'Kp': kp, 'Ti seconds': ti, 'Td seconds': td, 'Ku': ku, 'Tu seconds': period },
    notes: ['Closed-loop Z-N from the measured ultimate cycle; expect a quarter-decay step response, i.e. visible overshoot by design.'],
  }
}

/* ------------------------------------------------------------------ *
 * Relay auto-tuning
 * ------------------------------------------------------------------ */

export interface RelayAutoTuneOptions {
  /** Relay output magnitude. Sign sets the initial polarity, magnitude the drive. */
  relayAmplitude: number
  /** Hysteresis half-width on the error signal; keeps the relay from chattering. */
  hysteresis: number
  dtSeconds: number
  tEndSeconds: number
  /** Loop reference the relay switches around (default 0). */
  setpoint?: number
  /**
   * Cycles discarded before measuring (default 5). The relay envelope does not
   * start at the limit cycle: it *grows* into it, taking eight cycles or more on
   * a heavily filtered plant, so a short warm-up measures a transient and calls
   * it a critical gain.
   */
  warmupCycles?: number
  /** Cycles averaged into the result (default 5). */
  cyclesToMeasure?: number
}

export interface RelayAutoTuneResult {
  /** Describing-function critical gain Ku = 4d/(π·√(a² − h²)). */
  ultimateGain: number
  /** Measured limit-cycle period Tu. */
  periodSeconds: number
  /** Oscillation amplitude about the setpoint. */
  amplitude: number
  /** Frequency of the ultimate cycle, rad/s — where the plant phase is −180°. */
  ultimateFrequency: number
  switches: number
  cyclesMeasured: number
  /** Amplitude spread across the measured cycles; a settled cycle is ~0. */
  amplitudeSpreadFraction: number
  /** Period spread across the measured cycles; the other sign of an unsettled cycle. */
  periodSpreadFraction: number
  samples: Array<{ time: number; output: number; control: number }>
  notes: string[]
}

/**
 * Relay (autotune) test: replace the controller with a hysteretic relay, let the
 * loop settle into a limit cycle, and read the critical gain and period off the
 * oscillation — the describing-function relation
 *
 *   Ku = 4d / (π·√(a² − h²)),  phase of the relay = −arcsin(h/a)
 *
 * This needs no plant model, which is exactly why it is used in the field; the
 * price is that it is a describing-function approximation, so the result is an
 * amplitude-domain average, not an exact −180° crossing. The notes say how far
 * from that ideal the measurement landed.
 *
 * The loop is started from rest, so the oscillation has to *grow* into the limit
 * cycle. On a plant with the filtering of `1/(s+1)³` that takes eight cycles or
 * more; `warmupCycles` and the two spread figures exist because measuring before
 * that settles produces a confidently wrong Ku.
 */
export function relayAutoTune(plant: TransferFunction, options: RelayAutoTuneOptions): RelayAutoTuneResult {
  const { relayAmplitude, hysteresis, dtSeconds, tEndSeconds } = options
  if (!Number.isFinite(relayAmplitude) || relayAmplitude === 0) throw new Error(`Relay amplitude must be finite and non-zero (got ${relayAmplitude}).`)
  if (!Number.isFinite(hysteresis) || hysteresis < 0) throw new Error(`Relay hysteresis must be finite and non-negative (got ${hysteresis}).`)
  if (!(dtSeconds > 0) || !(tEndSeconds > dtSeconds)) throw new Error('Relay test needs 0 < dtSeconds < tEndSeconds.')
  const warmup = options.warmupCycles ?? 5
  const measure = options.cyclesToMeasure ?? 5
  if (!Number.isInteger(warmup) || warmup < 0) throw new Error(`warmupCycles must be a non-negative integer (got ${warmup}).`)
  if (!Number.isInteger(measure) || measure < 2) throw new Error(`cyclesToMeasure must be an integer ≥ 2 (got ${measure}).`)
  const setpoint = options.setpoint ?? 0
  if (!Number.isFinite(setpoint)) throw new Error(`Relay setpoint must be finite (got ${setpoint}).`)

  let output = relayAmplitude > 0 ? relayAmplitude : -relayAmplitude
  const decide = (_time: number, measurement: number): number => {
    const error = setpoint - measurement
    if (error < -hysteresis) output = -Math.abs(relayAmplitude)
    else if (error > hysteresis) output = Math.abs(relayAmplitude)
    return output
  }

  const samples = marchSampledLoop(plant, { dtSeconds, tEndSeconds }, decide)

  // Rising crossings of the measurement through the setpoint, interpolated
  // between samples so the period is not quantised to the sample interval.
  const crossings: number[] = []
  for (let i = 1; i < samples.length; i += 1) {
    const previous = samples[i - 1].output - setpoint
    const current = samples[i].output - setpoint
    if (previous < 0 && current >= 0) {
      const fraction = current === previous ? 0 : -previous / (current - previous)
      crossings.push(samples[i - 1].time + fraction * dtSeconds)
    }
  }
  const switches = samples.filter((_, index) => index > 0 && Math.sign(samples[index].control) !== Math.sign(samples[index - 1].control)).length
  if (switches < 2 * (warmup + measure)) {
    throw new Error(
      `The relay only switched ${switches} times in ${tEndSeconds} s; a limit cycle needs at least ${2 * (warmup + measure)}. Increase tEndSeconds, check the plant is stable open-loop, or flip the relay sign if the plant is reverse-acting.`,
    )
  }
  const usable = crossings.slice(warmup)
  if (usable.length < measure + 1) {
    throw new Error(
      `Only ${Math.max(0, usable.length)} crossings survive the ${warmup}-cycle warm-up; the record is too short for ${measure} measured cycles.`,
    )
  }

  const periods: number[] = []
  const amplitudes: number[] = []
  for (let cycle = 0; cycle < measure; cycle += 1) {
    const start = usable[cycle]
    const end = usable[cycle + 1]
    periods.push(end - start)
    let peak = -Infinity
    let trough = Infinity
    for (const sample of samples) {
      if (sample.time < start || sample.time > end) continue
      peak = Math.max(peak, sample.output)
      trough = Math.min(trough, sample.output)
    }
    amplitudes.push((peak - trough) / 2)
  }
  const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / values.length
  const periodSeconds = mean(periods)
  const amplitude = mean(amplitudes)
  const amplitudeSpreadFraction = (Math.max(...amplitudes) - Math.min(...amplitudes)) / Math.max(amplitude, 1e-12)
  const periodSpreadFraction = (Math.max(...periods) - Math.min(...periods)) / Math.max(periodSeconds, 1e-12)
  const notes: string[] = []

  if (!(amplitude > hysteresis)) {
    throw new Error(
      `Oscillation amplitude (${amplitude}) does not exceed the hysteresis (${hysteresis}), so √(a² − h²) is not real: the relay band is wider than the cycle. Reduce hysteresis or raise the relay amplitude.`,
    )
  }
  if (amplitudeSpreadFraction > 0.1) {
    notes.push(`Amplitude varied ${(100 * amplitudeSpreadFraction).toFixed(1)} % across the measured cycles, so the limit cycle had not settled; extend tEndSeconds or raise warmupCycles before trusting Ku.`)
  }
  if (periodSpreadFraction > 0.05) {
    notes.push(`Period varied ${(100 * periodSpreadFraction).toFixed(1)} % across the measured cycles: the frequency is still moving with the envelope, so Tu is a transient value rather than the ultimate cycle.`)
  }
  const hysteresisPhaseDeg = Math.asin(Math.min(1, hysteresis / amplitude)) * (180 / Math.PI)
  if (hysteresisPhaseDeg > 3) {
    notes.push(`Hysteresis adds ${hysteresisPhaseDeg.toFixed(1)}° of relay phase lag, so the measured period sits slightly off the true −180° crossing. Ziegler–Nichols tolerates this; a model-based margin check may not.`)
  }
  if (hysteresis === 0) notes.push('Hysteresis is zero: the relay can chatter at the sample rate. The measured period is only as good as dtSeconds.')

  const ultimateGain = (4 * Math.abs(relayAmplitude)) / (Math.PI * Math.sqrt(amplitude * amplitude - hysteresis * hysteresis))
  return {
    ultimateGain,
    periodSeconds,
    amplitude,
    ultimateFrequency: 2 * Math.PI / periodSeconds,
    switches,
    cyclesMeasured: measure,
    amplitudeSpreadFraction,
    periodSpreadFraction,
    samples,
    notes,
  }
}

/** Relay test followed by the Ziegler–Nichols ultimate-cycle settings. */
export function autoTuneByRelay(
  plant: TransferFunction,
  options: RelayAutoTuneOptions & { structure?: ControllerStructure },
): { relay: RelayAutoTuneResult; tuning: RuleBasedTuning } {
  const relay = relayAutoTune(plant, options)
  const tuning = gainsFromUltimateCycle(
    { ultimateGain: relay.ultimateGain, periodSeconds: relay.periodSeconds },
    { structure: options.structure },
  )
  return { relay, tuning: { ...tuning, notes: [...relay.notes, ...tuning.notes] } }
}

/* ------------------------------------------------------------------ *
 * Tuning by search over the real simulation
 * ------------------------------------------------------------------ */

export type SearchMethod = 'differential-evolution' | 'nelder-mead' | 'simulated-annealing'

export interface SearchTuningOptions {
  structure: ControllerStructure
  /** One bound per free gain, in order kp, ki, kd. */
  bounds: Bounds[]
  /** Hard cap on *simulations* of the closed loop. */
  maxEvaluations: number
  method?: SearchMethod
  /** Only used by nelder-mead and simulated-annealing. */
  start?: number[]
  seed?: number
  targets?: PerformanceTargets
  weights?: CostWeights
  populationSize?: number
}

export interface TunedLoop {
  gains: PidGains
  evaluation: LoopEvaluation
  method: SearchMethod
  termination: OptimizerResult['termination']
  evaluations: number
  history: number[]
  notes: string[]
}

function decodeGains(parameters: readonly number[], structure: ControllerStructure, filterSeconds: number): PidGains {
  const [kp = 0, ki = 0, kd = 0] = parameters
  if (structure === 'P') return { kp, ki: 0, kd: 0, derivativeFilterSeconds: filterSeconds }
  if (structure === 'PI') return { kp, ki, kd: 0, derivativeFilterSeconds: filterSeconds }
  return { kp, ki, kd, derivativeFilterSeconds: filterSeconds }
}

/**
 * Tune by minimising `loopEvaluation`'s cost over the free gains.
 *
 * Every candidate is a real closed-loop simulation of the plant model supplied,
 * so the budget is a simulation budget and `termination` says honestly whether
 * it ran out. The winner is re-evaluated before being returned, so the reported
 * metrics, margins and cost come from one deterministic evaluation rather than
 * from whatever the search happened to cache.
 */
export function tuneBySearch(spec: LoopSpec, options: SearchTuningOptions): TunedLoop {
  const { derivativeFilterSeconds } = validateSpec(spec)
  const expected = STRUCTURE_COUNTS[options.structure]
  if (options.bounds.length !== expected) {
    throw new Error(`${options.structure} tuning needs ${expected} gain bounds (kp${options.structure === 'PI' || options.structure === 'PID' ? ', ki' : ''}${options.structure === 'PID' ? ', kd' : ''}), got ${options.bounds.length}.`)
  }
  const method = options.method ?? 'differential-evolution'
  const notes: string[] = []

  const objective = (parameters: readonly number[]): number =>
    loopEvaluation(decodeGains(parameters, options.structure, derivativeFilterSeconds), spec, options.targets, options.weights).cost

  let result: OptimizerResult
  if (method === 'nelder-mead') {
    const start = options.start ?? options.bounds.map((bound) => bound.low + 0.25 * (bound.high - bound.low))
    if (start.length !== expected) throw new Error(`Start point has ${start.length} entries for ${expected} free gains.`)
    result = nelderMead(objective, start, { bounds: options.bounds, maxEvaluations: options.maxEvaluations })
  } else if (method === 'simulated-annealing') {
    const start = options.start ?? options.bounds.map((bound) => bound.low + 0.5 * (bound.high - bound.low))
    if (start.length !== expected) throw new Error(`Start point has ${start.length} entries for ${expected} free gains.`)
    result = simulatedAnnealing(objective, start, { bounds: options.bounds, maxEvaluations: options.maxEvaluations, seed: options.seed })
  } else {
    result = differentialEvolution(objective, {
      bounds: options.bounds,
      maxEvaluations: options.maxEvaluations,
      seed: options.seed,
      populationSize: options.populationSize,
    })
  }

  const gains = decodeGains(result.parameters, options.structure, derivativeFilterSeconds)
  const evaluation = loopEvaluation(gains, spec, options.targets, options.weights)
  if (evaluation.cost > result.objective + 1e-9) {
    notes.push(`Re-evaluation scored ${evaluation.cost.toExponential(3)} against the search's ${result.objective.toExponential(3)}; the search result was not reproducible and the re-evaluated number is the one reported.`)
  }
  if (result.termination === 'budget') notes.push(`Search stopped at the ${options.maxEvaluations}-simulation budget, so these gains are the best found — not the best possible.`)
  if (evaluation.spectralAbscissa > 0) notes.push('WARNING: the search returned gains whose closed loop is unstable; widen the bounds or lower the budget and start again.')
  if (!spec.marginScan && (options.targets?.minPhaseMarginDeg !== undefined || options.targets?.minGainMarginDb !== undefined)) {
    notes.push('Margin targets were given without a marginScan, so they were not enforced.')
  }
  return {
    gains: evaluation.gains,
    evaluation,
    method,
    termination: result.termination,
    evaluations: result.evaluations,
    history: result.history,
    notes,
  }
}

/**
 * Rule-of-thumb search box for a FOPDT model: ±one order of magnitude around
 * the Ziegler–Nichols PID gains, with ki and kd floored at zero.
 *
 * It is a starting box, not a result — the point is that a search needs bounds,
 * and bounds taken from a published rule are defensible in a way that "0..100"
 * is not. Negative-kp plants (reverse action) get the box mirrored.
 */
export function suggestGainBounds(model: FopdtModel, structure: ControllerStructure = 'PID'): Bounds[] {
  const base = gainsFromFopdt(model, { rule: 'ziegler-nichols', structure })
  const kp = base.gains.kp
  const span = (value: number, low: number, high: number): Bounds => ({
    low: value >= 0 ? low : -high,
    high: value >= 0 ? high : -low,
  })
  const bounds: Bounds[] = [span(kp, Math.abs(kp) / 10, Math.abs(kp) * 10)]
  if (structure === 'PI' || structure === 'PID') {
    const ki = base.gains.ki
    bounds.push({ low: Math.min(0, ki * 10), high: Math.max(0, ki * 10) })
  }
  if (structure === 'PID') {
    const kd = base.gains.kd
    bounds.push({ low: Math.min(0, kd * 10), high: Math.max(0, kd * 10) })
  }
  return bounds
}

/* ------------------------------------------------------------------ *
 * Surrogate-assisted tuning (for expensive evaluations)
 * ------------------------------------------------------------------ */

export interface SurrogateTuningOptions {
  structure: ControllerStructure
  bounds: Bounds[]
  /** Cap on *simulations*. Surrogate and acquisition work is free by design. */
  maxSimulations: number
  initialDesignSize?: number
  /** Sequential points added after the initial design (default 10). */
  surrogateRounds?: number
  /** Random candidates scored by the acquisition each round (default 400). */
  acquisitionCandidates?: number
  /** Standard deviations of uncertainty worth exploring (default 1.0). */
  explorationSigma?: number
  seed?: number
  targets?: PerformanceTargets
  weights?: CostWeights
}

export interface SurrogateTuningResult {
  gains: PidGains
  evaluation: LoopEvaluation
  /** Every real simulation scored, with its cost — the audit trail. */
  samples: Array<{ parameters: number[]; cost: number }>
  /**
   * Closed-loop runs spent by the search itself. The winning gains are then
   * simulated once more to produce `evaluation`, so the function as a whole
   * performs `simulations + 1` runs; the budget cap applies to this number.
   */
  simulations: number
  roundsUsed: number
  termination: 'budget' | 'converged'
  history: number[]
  notes: string[]
}

/**
 * Bayesian-style sequential tuning: a Gaussian process is fitted to the costs of
 * the designs already simulated, a lower-confidence-bound acquisition picks the
 * next point, and only that point is simulated. It is the right tool when one
 * closed-loop run is expensive (long horizon, fine dt, or a hardware-in-the-loop
 * plant) because it aims the few allowed simulations at the part of the box the
 * surrogate believes is both good and uncertain.
 *
 * Honest limits: the surrogate only knows the sampled points, so an initial
 * design that misses a narrow basin will never find it; and the GP is trained on
 * costs in raw units, so a cost span of 1e12 makes the kernel length scale
 * meaningless — normalise the plant if that happens.
 */
export function tuneBySurrogate(spec: LoopSpec, options: SurrogateTuningOptions): SurrogateTuningResult {
  const { derivativeFilterSeconds } = validateSpec(spec)
  const expected = STRUCTURE_COUNTS[options.structure]
  if (options.bounds.length !== expected) throw new Error(`Surrogate tuning needs ${expected} bounds for ${options.structure}, got ${options.bounds.length}.`)
  if (!Number.isInteger(options.maxSimulations) || options.maxSimulations < 1) throw new Error(`Simulation budget must be a positive integer (got ${options.maxSimulations}).`)
  const initialDesignSize = options.initialDesignSize ?? Math.min(options.maxSimulations, Math.max(8, 10 * expected))
  if (!Number.isInteger(initialDesignSize) || initialDesignSize < 4) throw new Error(`Initial design needs at least 4 points (got ${initialDesignSize}).`)
  if (initialDesignSize > options.maxSimulations) throw new Error(`Initial design of ${initialDesignSize} points exceeds the ${options.maxSimulations}-simulation budget.`)
  const rounds = options.surrogateRounds ?? 10
  if (!Number.isInteger(rounds) || rounds < 0) throw new Error(`surrogateRounds must be a non-negative integer (got ${rounds}).`)
  const candidates = options.acquisitionCandidates ?? 400
  if (!Number.isInteger(candidates) || candidates < 16) throw new Error(`acquisitionCandidates must be an integer ≥ 16 (got ${candidates}).`)
  const explorationSigma = options.explorationSigma ?? 1
  if (!(explorationSigma >= 0)) throw new Error(`explorationSigma must be ≥ 0 (got ${explorationSigma}).`)

  const random = createRandomSource(options.seed ?? 20260427)
  const notes: string[] = []
  const score = (parameters: number[]): number =>
    loopEvaluation(decodeGains(parameters, options.structure, derivativeFilterSeconds), spec, options.targets, options.weights).cost

  // Latin-hypercube design: one point per stratum per dimension, strata order
  // shuffled, so the box is covered evenly instead of clustering by chance.
  const strata = Array.from({ length: initialDesignSize }, (_, i) => i)
  const design: number[][] = []
  for (let d = 0; d < expected; d += 1) {
    const order = shuffleInPlace([...strata], createRandomSource((options.seed ?? 1) * 31 + d))
    for (let i = 0; i < initialDesignSize; i += 1) {
      const fraction = (order[i] + random.next()) / initialDesignSize
      const value = options.bounds[d].low + fraction * (options.bounds[d].high - options.bounds[d].low)
      if (design[i] === undefined) design[i] = []
      design[i][d] = value
    }
  }

  const samples: Array<{ parameters: number[]; cost: number }> = []
  for (const point of design) samples.push({ parameters: point, cost: score(point) })
  const history: number[] = [Math.min(...samples.map((sample) => sample.cost))]

  const toUnit = (point: readonly number[]): number[] =>
    point.map((value, d) => (value - options.bounds[d].low) / (options.bounds[d].high - options.bounds[d].low))
  const fromUnit = (point: readonly number[]): number[] =>
    point.map((value, d) => options.bounds[d].low + Math.min(1, Math.max(0, value)) * (options.bounds[d].high - options.bounds[d].low))

  let roundsUsed = 0
  let termination: SurrogateTuningResult['termination'] = 'budget'

  /** Next point to simulate, or `null` when the surrogate cannot propose one. */
  const proposePoint = (training: number[][], costs: number[], round: number): number[] | null => {
    try {
      const gp = new GaussianProcessRegressor().fit(training, costs)
      let bestScore = Number.POSITIVE_INFINITY
      let proposal: number[] | null = null
      for (let candidate = 0; candidate < candidates; candidate += 1) {
        const point = options.bounds.map(() => random.next())
        const prediction = gp.predict(point)
        // Minimise the lower confidence bound: mean minus σ of exploration.
        const bound = prediction.mean - explorationSigma * prediction.standardDeviation
        if (Number.isFinite(bound) && bound < bestScore) {
          bestScore = bound
          proposal = point
        }
      }
      if (!proposal) notes.push(`Surrogate step stopped at round ${round + 1}: the acquisition found no finite candidate among ${candidates} draws.`)
      return proposal
    } catch (error) {
      notes.push(`Surrogate step stopped at round ${round + 1}: ${error instanceof Error ? error.message : String(error)}. The returned gains are the best directly simulated ones.`)
      return null
    }
  }

  for (let round = 0; round < rounds; round += 1) {
    if (samples.length >= options.maxSimulations) break
    const training = samples.map((sample) => toUnit(sample.parameters))
    const costs = samples.map((sample) => sample.cost)
    const distinct = new Set(costs).size
    if (distinct < 2) {
      notes.push('Every design sampled so far scored identically, so the surrogate has nothing to discriminate; the search stopped early.')
      break
    }
    const proposal = proposePoint(training, costs, round)
    if (!proposal) break
    const parameters = fromUnit(proposal)
    samples.push({ parameters, cost: score(parameters) })
    roundsUsed += 1
    history.push(Math.min(...samples.map((sample) => sample.cost)))
    const recent = history.slice(-6)
    if (recent.length === 6 && recent.every((value) => value === recent[0])) {
      termination = 'converged'
      notes.push('Best simulated cost did not improve over 6 consecutive surrogate-guided rounds.')
      break
    }
  }
  if (termination !== 'converged' && samples.length >= options.maxSimulations) {
    notes.push(`Hit the ${options.maxSimulations}-simulation budget; treat the gains as best-found, not optimal.`)
  }

  const best = samples.reduce((leading, sample) => (sample.cost < leading.cost ? sample : leading), samples[0])
  const evaluation = loopEvaluation(decodeGains(best.parameters, options.structure, derivativeFilterSeconds), spec, options.targets, options.weights)
  notes.unshift(`Cost surface was probed at ${samples.length} real simulations (${roundsUsed} chosen by the surrogate).`)
  return {
    gains: evaluation.gains,
    evaluation,
    samples,
    simulations: samples.length,
    roundsUsed,
    termination,
    history,
    notes,
  }
}

/* ------------------------------------------------------------------ *
 * Sampled-loop verification (nonlinear: saturation, anti-windup)
 * ------------------------------------------------------------------ */

export interface SampledLoopVerification {
  samples: Array<{ time: number; output: number; control: number; error: number; saturated: boolean }>
  metrics: StepMetrics
  /** Samples where the actuator was at a limit; non-zero means the linear tuning was not the whole story. */
  saturatedSamples: number
  notes: string[]
}

/**
 * Run the *discrete* controller (`pidStep`, measurement-derivative, conditional
 * integration) against the plant with an optional actuator limit.
 *
 * The linear routes above assume an ideal actuator. This is where an engineer
 * finds out whether the tuned gains survive saturation, and it is a genuinely
 * different simulation: a saturating loop is nonlinear and no transfer function
 * can express it.
 */
export function simulateDiscreteLoop(
  plant: TransferFunction,
  gains: PidGains,
  options: {
    dtSeconds: number
    tEndSeconds: number
    setpoint?: number | ((time: number) => number)
    limits?: PidLimits
  },
): SampledLoopVerification {
  const dt = options.dtSeconds
  const tEnd = options.tEndSeconds
  if (!(dt > 0) || !(tEnd > dt)) throw new Error(`Sampled loop needs 0 < dtSeconds < tEndSeconds (got ${dt} and ${tEnd}).`)
  const setpoint = options.setpoint ?? 1
  const reference: (time: number) => number = typeof setpoint === 'function' ? setpoint : () => setpoint
  let state = initialPidState(0)
  let saturatedSamples = 0

  const decide = (time: number, measurement: number): number => {
    const step = pidStep(state, gains, reference(time), measurement, dt, options.limits)
    state = step.state
    if (step.saturated) saturatedSamples += 1
    return step.output
  }

  const raw = marchSampledLoop(plant, { dtSeconds: dt, tEndSeconds: tEnd }, decide)
  const samples = raw.map((sample) => ({
    time: sample.time,
    output: sample.output,
    control: sample.control,
    error: reference(sample.time) - sample.output,
    saturated:
      options.limits !== undefined &&
      (sample.control <= options.limits.minOutput + 1e-12 || sample.control >= options.limits.maxOutput - 1e-12),
  }))
  const metrics = stepResponseMetrics(samples.map((sample) => ({ timeSeconds: sample.time, output: sample.output, state: [] })))
  const notes: string[] = []
  if (saturatedSamples > 0) notes.push(`Actuator hit its limit on ${saturatedSamples} of ${samples.length} samples; windup and slew are nonlinear effects the linear tuning did not model.`)
  if (options.limits === undefined) notes.push('No actuator limits supplied, so this run only checks the sampling and derivative filter, not saturation.')
  const lastError = samples.length > 0 ? Math.abs(samples[samples.length - 1].error) : Number.NaN
  if (Number.isFinite(lastError) && Math.abs(reference(tEnd)) > 0 && lastError > 0.05 * Math.abs(reference(tEnd))) {
    notes.push(`Final error is ${(100 * lastError / Math.abs(reference(tEnd))).toFixed(1)} % of the reference — check for a missing integrator (ki = 0) or a stuck actuator.`)
  }
  return { samples, metrics, saturatedSamples, notes }
}
