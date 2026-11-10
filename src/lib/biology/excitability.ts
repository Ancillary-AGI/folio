/**
 * Cell-scale excitability: what a membrane does when you inject current.
 *
 * Three models, in order of how much they cost and how much they claim:
 *
 * - **Hodgkin–Huxley** (1952): four states — membrane potential plus the sodium
 *   activation/inactivation and potassium activation gates. This is the reference
 *   for spike shape, threshold, and refractory behaviour, and it is the model
 *   most other excitable-tissue work is calibrated against.
 * - **FitzHugh–Nagumo**: two states, the fast voltage and one slow recovery
 *   variable. It reproduces excitability, refractoriness and traveling pulses at
 *   a fraction of the cost, which is why it is the model the tissue module
 *   propagates. It does not reproduce spike shape or ion currents.
 * - **Leaky integrate-and-fire**: one state plus a reset. Used for counting
 *   spikes and for networks where the shape does not matter. Its spikes are
 *   vertical lines, not action potentials.
 *
 * Time is milliseconds, potential is millivolts (absolute, so the resting value
 * is about −65 mV, not 0 as Hodgkin and Huxley plotted it), currents are
 * µA/cm² and conductances mS/cm².
 *
 * Honest limits
 * -------------
 * - Rate functions are the classic squid formulations. Mammalian cortex channels
 *   have different kinetics and temperature corrections (Q₁₀) are not applied —
 *   the default parameters are the original room-temperature squid values, and a
 *   mammalian cell at 37 °C spikes faster than these equations say.
 * - Reversal potentials are constants. A real cell's intracellular ion
 *   concentrations drift during a train, and no pump is modelled.
 * - No calcium, no after-hyperpolarisation potassium current, no glia, no
 *   dendrites. The cell is an isopotential sphere (one compartment), so a
 *   propagated axon spike and its initiation are the same event here.
 * - The integrate-and-fire reset is instantaneous; real refractory tails are
 *   graded.
 */

import {
  integrateModel,
  requireFinite,
  requireNonNegative,
  requirePositive,
  validateWindow,
  type BiologyWindow,
} from './modelSupport'

/* ------------------------------------------------------------------ *
 * Hodgkin–Huxley
 * ------------------------------------------------------------------ */

export interface HodgkinHuxleyParameters {
  /** Membrane capacitance, µF/cm². */
  capacitanceUfPerCm2: number
  /** Maximum sodium, potassium and leak conductances, mS/cm². */
  sodiumConductanceMilliSiemensPerCm2: number
  potassiumConductanceMilliSiemensPerCm2: number
  leakConductanceMilliSiemensPerCm2: number
  /** Reversal potentials, mV. */
  sodiumReversalMillivolts: number
  potassiumReversalMillivolts: number
  leakReversalMillivolts: number
}

/** The original 1952 squid giant axon constants, at room temperature. */
export const CLASSIC_HODGKIN_HUXLEY: HodgkinHuxleyParameters = {
  capacitanceUfPerCm2: 1,
  sodiumConductanceMilliSiemensPerCm2: 120,
  potassiumConductanceMilliSiemensPerCm2: 36,
  leakConductanceMilliSiemensPerCm2: 0.3,
  sodiumReversalMillivolts: 50,
  potassiumReversalMillivolts: -77,
  leakReversalMillivolts: -54.387,
}

/** One current-clamp square pulse, in the units of the model. */
export interface StimulusPulse {
  amplitudeMicroAmpPerCm2: number
  startMs: number
  durationMs: number
}

/** Membrane potential and the three gating variables at one instant. */
export interface GateRates {
  alphaM: number
  betaM: number
  alphaH: number
  betaH: number
  alphaN: number
  betaN: number
}

/**
 * `a·x / (1 − e^(−x/b))` with the removable singularity at `x = 0` handled.
 *
 * Written naively this is 0/0 at the potential where the rate function is
 * defined, and a solver stepping across it sees NaN. The exact limit is `a·b`,
 * and near zero the series is `a·b·(1 + x/(2b) + …)`, so the small-|x| branch is
 * the limit plus its first correction rather than a fudge factor. `expm1` keeps
 * the denominator accurate for small arguments instead of cancelling it away.
 */
function linearOverSaturation(a: number, b: number, x: number): number {
  if (Math.abs(x / b) < 1e-6) return a * b * (1 + x / (2 * b))
  return (a * x) / -Math.expm1(-x / b)
}

export function HodgkinHuxleyRateFunctions(potentialMillivolts: number): GateRates {
  const v = potentialMillivolts
  return {
    alphaM: linearOverSaturation(0.1, 10, v + 40),
    betaM: 4 * Math.exp(-(v + 65) / 18),
    alphaH: 0.07 * Math.exp(-(v + 65) / 20),
    betaH: 1 / (1 + Math.exp(-(v + 35) / 10)),
    alphaN: linearOverSaturation(0.01, 10, v + 55),
    betaN: 0.125 * Math.exp(-(v + 65) / 80),
  }
}

/** `x∞ = α/(α+β)` for each gate — the value a gate relaxes to at fixed voltage. */
export function gateSteadyState(potentialMillivolts: number): { m: number; h: number; n: number } {
  const rates = HodgkinHuxleyRateFunctions(potentialMillivolts)
  const steady = (alpha: number, beta: number): number => alpha / (alpha + beta)
  return {
    m: steady(rates.alphaM, rates.betaM),
    h: steady(rates.alphaH, rates.betaH),
    n: steady(rates.alphaN, rates.betaN),
  }
}

/** Gate time constant `1/(α+β)` in ms — what the integrator's step is sized from. */
export function gateTimeConstants(potentialMillivolts: number): { tauM: number; tauH: number; tauN: number } {
  const rates = HodgkinHuxleyRateFunctions(potentialMillivolts)
  return {
    tauM: 1 / (rates.alphaM + rates.betaM),
    tauH: 1 / (rates.alphaH + rates.betaH),
    tauN: 1 / (rates.alphaN + rates.betaN),
  }
}

export interface HodgkinHuxleyInitialState {
  potentialMillivolts: number
  m: number
  h: number
  n: number
}

export const RESTING_STATE: HodgkinHuxleyInitialState = {
  potentialMillivolts: -65,
  m: 0.0529,
  h: 0.596,
  n: 0.3177,
}

export interface HodgkinHuxleySample {
  timeMs: number
  potentialMillivolts: number
  m: number
  h: number
  n: number
  sodiumCurrentMicroAmpPerCm2: number
  potassiumCurrentMicroAmpPerCm2: number
  leakCurrentMicroAmpPerCm2: number
  stimulusMicroAmpPerCm2: number
}

function validateHodgkinHuxley(parameters: HodgkinHuxleyParameters, initial: HodgkinHuxleyInitialState): void {
  requirePositive(parameters.capacitanceUfPerCm2, 'Membrane capacitance')
  requirePositive(parameters.sodiumConductanceMilliSiemensPerCm2, 'Sodium conductance')
  requirePositive(parameters.potassiumConductanceMilliSiemensPerCm2, 'Potassium conductance')
  requirePositive(parameters.leakConductanceMilliSiemensPerCm2, 'Leak conductance')
  for (const [value, name] of [
    [parameters.sodiumReversalMillivolts, 'Sodium reversal potential'],
    [parameters.potassiumReversalMillivolts, 'Potassium reversal potential'],
    [parameters.leakReversalMillivolts, 'Leak reversal potential'],
    [initial.potentialMillivolts, 'Initial potential'],
  ] as const) {
    requireFinite(value, name)
  }
  for (const [value, name] of [
    [initial.m, 'Initial m'],
    [initial.h, 'Initial h'],
    [initial.n, 'Initial n'],
  ] as const) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name} is a probability and must lie between 0 and 1 (got ${value}).`)
    }
  }
}

function ionicCurrents(
  state: readonly number[],
  parameters: HodgkinHuxleyParameters,
): { sodium: number; potassium: number; leak: number } {
  const [v, m, h, n] = state
  return {
    sodium: parameters.sodiumConductanceMilliSiemensPerCm2 * m ** 3 * h * (v - parameters.sodiumReversalMillivolts),
    potassium: parameters.potassiumConductanceMilliSiemensPerCm2 * n ** 4 * (v - parameters.potassiumReversalMillivolts),
    leak: parameters.leakConductanceMilliSiemensPerCm2 * (v - parameters.leakReversalMillivolts),
  }
}

export function simulateHodgkinHuxley(
  parameters: HodgkinHuxleyParameters,
  initial: HodgkinHuxleyInitialState,
  stimulus: (timeMs: number) => number,
  window: BiologyWindow,
): HodgkinHuxleySample[] {
  validateHodgkinHuxley(parameters, initial)

  const derivative = (time: number, state: readonly number[]): number[] => {
    const [v, m, h, n] = state
    const rates = HodgkinHuxleyRateFunctions(v)
    const currents = ionicCurrents(state, parameters)
    const injected = stimulus(time)
    return [
      (injected - currents.sodium - currents.potassium - currents.leak) / parameters.capacitanceUfPerCm2,
      rates.alphaM * (1 - m) - rates.betaM * m,
      rates.alphaH * (1 - h) - rates.betaH * h,
      rates.alphaN * (1 - n) - rates.betaN * n,
    ]
  }

  // Sodium activation is the fastest process in the model, and it is fastest of
  // all near the spike peak, where the classical 0.025 ms step comes from.
  const samples = integrateModel(
    derivative,
    [initial.potentialMillivolts, initial.m, initial.h, initial.n],
    window,
    0.5,
  )

  return samples.map((sample) => {
    const [potentialMillivolts, m, h, n] = sample.state
    const currents = ionicCurrents(sample.state, parameters)
    return {
      timeMs: sample.time,
      potentialMillivolts,
      m,
      h,
      n,
      sodiumCurrentMicroAmpPerCm2: currents.sodium,
      potassiumCurrentMicroAmpPerCm2: currents.potassium,
      leakCurrentMicroAmpPerCm2: currents.leak,
      stimulusMicroAmpPerCm2: stimulus(sample.time),
    }
  })
}

/* ------------------------------------------------------------------ *
 * Spike detection
 * ------------------------------------------------------------------ */

export interface DetectedSpike {
  /** Sample index of the maximum. */
  peakIndex: number
  peakTimeMs: number
  peakMillivolts: number
  /** The trough of the following after-hyperpolarisation, if the trace contains it. */
  followingTroughMillivolts: number | null
}

/**
 * Count action potentials by their threshold crossings, not by their peaks.
 *
 * A crossing rule with hysteresis (`upCrossMillivolts` to enter, `downCrossMillivolts`
 * to leave) is what makes the count robust: a shoulder on a falling edge or noise
 * near the peak would otherwise be counted as a second spike. The default
 * thresholds sit well above the −65 mV rest and below the +40 mV peak.
 */
export function detectSpikes(
  samples: readonly { timeMs: number; potentialMillivolts: number }[],
  options: { upCrossMillivolts?: number; downCrossMillivolts?: number } = {},
): DetectedSpike[] {
  const up = options.upCrossMillivolts ?? 0
  const down = options.downCrossMillivolts ?? -20
  if (!(down < up)) throw new Error('Spike detector hysteresis is inverted: the exit threshold must be below the entry threshold.')

  const spikes: DetectedSpike[] = []
  let inside = false
  let peakIndex = 0
  let peakTimeMs = 0
  let peakMillivolts = Number.NEGATIVE_INFINITY

  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i].potentialMillivolts
    if (!inside) {
      if (value > up) {
        inside = true
        peakIndex = i
        peakTimeMs = samples[i].timeMs
        peakMillivolts = value
      }
      continue
    }
    if (value > peakMillivolts) {
      peakIndex = i
      peakTimeMs = samples[i].timeMs
      peakMillivolts = value
    }
    if (value < down) {
      // The event is over; the peak is recorded and the search for the
      // after-hyperpolarisation trough starts at the sample after it.
      spikes.push({ peakIndex, peakTimeMs, peakMillivolts, followingTroughMillivolts: null })
      inside = false
      peakMillivolts = Number.NEGATIVE_INFINITY
    }
  }
  if (inside) {
    spikes.push({ peakIndex, peakTimeMs, peakMillivolts, followingTroughMillivolts: null })
  }

  for (let s = 0; s < spikes.length; s += 1) {
    const start = spikes[s].peakIndex + 1
    const limit = s + 1 < spikes.length ? spikes[s + 1].peakIndex : samples.length
    let trough: number | null = null
    for (let i = start; i < limit; i += 1) {
      const value = samples[i].potentialMillivolts
      if (trough === null || value < trough) trough = value
    }
    spikes[s].followingTroughMillivolts = trough
  }
  return spikes
}

/** Mean instantaneous frequency (Hz) over the spikes detected in a window. */
export function meanFiringRateHertz(spikes: readonly DetectedSpike[], fromMs = 0, toMs = Number.POSITIVE_INFINITY): number {
  const inWindow = spikes.filter((spike) => spike.peakTimeMs >= fromMs && spike.peakTimeMs <= toMs)
  if (inWindow.length < 2) return 0
  const span = inWindow[inWindow.length - 1].peakTimeMs - inWindow[0].peakTimeMs
  if (!(span > 0)) return 0
  return ((inWindow.length - 1) / span) * 1000
}

/* ------------------------------------------------------------------ *
 * In-silico stimulation experiments
 * ------------------------------------------------------------------ */

/** A square pulse train: `repetitions` copies of one pulse, spaced `periodMs` apart. */
export function pulseTrain(
  pulse: StimulusPulse,
  options: { repetitions?: number; periodMs?: number } = {},
): (timeMs: number) => number {
  requireNonNegative(pulse.amplitudeMicroAmpPerCm2, 'Stimulus amplitude')
  requireNonNegative(pulse.startMs, 'Stimulus start time')
  requirePositive(pulse.durationMs, 'Stimulus duration')
  const repetitions = options.repetitions ?? 1
  if (!Number.isInteger(repetitions) || repetitions < 1) {
    throw new Error(`Pulse repetitions must be a whole number of pulses (got ${repetitions}).`)
  }
  const period = options.periodMs ?? pulse.durationMs
  requirePositive(period, 'Pulse period')
  if (period < pulse.durationMs) {
    throw new Error(`Pulse period ${period} ms is shorter than the pulse itself (${pulse.durationMs} ms); the pulses would overlap.`)
  }
  return (timeMs: number): number => {
    if (timeMs < pulse.startMs) return 0
    const elapsed = timeMs - pulse.startMs
    const index = Math.floor(elapsed / period)
    if (index >= repetitions) return 0
    return elapsed - index * period < pulse.durationMs ? pulse.amplitudeMicroAmpPerCm2 : 0
  }
}

/**
 * Does this stimulus evoke a spike?
 *
 * Judged on the trace, not on a linearised argument: a spike is a crossing of the
 * detector threshold, which is the same rule used to count them.
 */
export function evokesSpike(
  parameters: HodgkinHuxleyParameters,
  initial: HodgkinHuxleyInitialState,
  stimulus: (timeMs: number) => number,
  window: BiologyWindow,
  thresholdMillivolts = 0,
): boolean {
  const samples = simulateHodgkinHuxley(parameters, initial, stimulus, window)
  return samples.some((sample) => sample.potentialMillivolts > thresholdMillivolts)
}

/**
 * Threshold current for one pulse width, found by bisection rather than asserted.
 *
 * The all-or-none property of an excitable membrane is what makes bisection valid
 * here — evocation is monotone in amplitude. `upperMicroAmpPerCm2` must be chosen
 * large enough to spike; if it does not, the search says so instead of returning
 * its own starting guess as if it were the answer.
 *
 * This is the threshold *for this duration*. The rheobase is the limit of that
 * quantity as the pulse gets long, which `strengthDurationCurve` reads off a set
 * of widths; calling this function once and naming the result a rheobase would be
 * a category error.
 */
export function findThresholdCurrent(
  parameters: HodgkinHuxleyParameters,
  initial: HodgkinHuxleyInitialState,
  pulseDurationMs: number,
  options: { upperMicroAmpPerCm2?: number; relativeTolerance?: number; window?: BiologyWindow } = {},
): { thresholdMicroAmpPerCm2: number; iterations: number; window: BiologyWindow } {
  const upper = options.upperMicroAmpPerCm2 ?? 50
  const tolerance = options.relativeTolerance ?? 1e-3
  if (!(upper > 0)) throw new Error('Rheobase search needs a positive upper bound.')
  if (!(tolerance > 0 && tolerance < 1)) throw new Error('Rheobase tolerance must be between 0 and 1.')

  const window = options.window ?? { tEnd: pulseDurationMs + 60, dt: 0.01 }
  const evoke = (amplitude: number): boolean =>
    evokesSpike(parameters, initial, pulseTrain({ amplitudeMicroAmpPerCm2: amplitude, startMs: 5, durationMs: pulseDurationMs }), window)

  if (!evoke(upper)) {
    throw new Error(
      `No spike at the search ceiling of ${upper} µA/cm² for a ${pulseDurationMs} ms pulse. ` +
        'Raise upperMicroAmpPerCm2 — a threshold cannot be reported from a range that never fired.',
    )
  }
  let low = 0
  let high = upper
  let iterations = 0
  while (high - low > tolerance * upper && iterations < 60) {
    const middle = (low + high) / 2
    iterations += 1
    if (evoke(middle)) high = middle
    else low = middle
  }
  return { thresholdMicroAmpPerCm2: high, iterations, window }
}

/**
 * The strength–duration curve: threshold amplitude as a function of pulse width.
 *
 * Chronaxie is reported as the pulse width at which the threshold reaches twice
 * the rheobase, interpolated between the computed points — the classic definition,
 * read off the computed curve rather than assumed from a fitted exponential.
 */
export function strengthDurationCurve(
  parameters: HodgkinHuxleyParameters,
  initial: HodgkinHuxleyInitialState,
  pulseWidthsMs: readonly number[],
  options: { upperMicroAmpPerCm2?: number; relativeTolerance?: number } = {},
): {
  points: { pulseWidthMs: number; thresholdMicroAmpPerCm2: number }[]
  rheobaseMicroAmpPerCm2: number
  chronaxieMs: number | null
} {
  if (pulseWidthsMs.length === 0) throw new Error('Strength–duration curve needs at least one pulse width.')
  const points = pulseWidthsMs.map((width) => {
    requirePositive(width, 'Pulse width')
    const search = findThresholdCurrent(parameters, initial, width, options)
    return { pulseWidthMs: width, thresholdMicroAmpPerCm2: search.thresholdMicroAmpPerCm2 }
  })
  const rheobase = Math.min(...points.map((point) => point.thresholdMicroAmpPerCm2))
  const doubled = rheobase * 2
  let chronaxie: number | null = null
  for (let i = 1; i < points.length; i += 1) {
    const previous = points[i - 1]
    const current = points[i]
    const spans = previous.thresholdMicroAmpPerCm2 >= doubled && current.thresholdMicroAmpPerCm2 <= doubled
    if (spans) {
      const fraction =
        (previous.thresholdMicroAmpPerCm2 - doubled) /
        (previous.thresholdMicroAmpPerCm2 - current.thresholdMicroAmpPerCm2)
      chronaxie = previous.pulseWidthMs + fraction * (current.pulseWidthMs - previous.pulseWidthMs)
      break
    }
  }
  return { points, rheobaseMicroAmpPerCm2: rheobase, chronaxieMs: chronaxie }
}

/* ------------------------------------------------------------------ *
 * FitzHugh–Nagumo
 * ------------------------------------------------------------------ */

export interface FitzHughNagumoParameters {
  /** Timescale ratio: the recovery variable is this much slower than the voltage. */
  epsilon: number
  a: number
  b: number
}

/** The classical excitable parameter set: at zero stimulus the cell rests and fires on a kick. */
export const EXCITABLE_FITZHUGH_NAGUMO: FitzHughNagumoParameters = { epsilon: 0.08, a: 0.7, b: 0.8 }

export interface FitzHughNagumoSample {
  time: number
  voltage: number
  recovery: number
}

/**
 * The relaxation form: `v̇ = v − v³/3 − w + I`, `ẇ = ε(v + a − b·w)`, written into
 * the two slots `out[offset]` and `out[offset + 1]`.
 *
 * Variables are dimensionless. This cubic is chosen over the bistable
 * `v(v−a)(1−v)` variant because it has the fast/slow geometry an excitable
 * travelling pulse needs: a Z-shaped v-nullcline, a stable rest below a critical
 * current, and a relaxation oscillation (slow depolarisation, fast spike, slow
 * recovery) above it. It is a topological twin of Hodgkin–Huxley, not a
 * quantitative one — `v` is not a millivolt and no ion current is represented.
 *
 * The cable keeps one pair of states per compartment inside a single long vector
 * and cannot afford a fresh two-element array per compartment per stage — that is
 * the difference between a run that paints and a run that stalls the tab. The
 * formula lives here once so the flat loop and the closure below cannot drift
 * apart.
 */
export function fitzhughNagumoReactionInto(
  parameters: FitzHughNagumoParameters,
  voltage: number,
  recovery: number,
  stimulus: number,
  out: number[],
  offset: number,
): void {
  out[offset] = voltage - voltage ** 3 / 3 - recovery + stimulus
  out[offset + 1] = parameters.epsilon * (voltage + parameters.a - parameters.b * recovery)
}

export function fitzhughNagumoDerivative(
  parameters: FitzHughNagumoParameters,
  stimulus: (time: number) => number,
): (time: number, state: readonly number[]) => number[] {
  return (time: number, state: readonly number[]): number[] => {
    const out: number[] = [0, 0]
    fitzhughNagumoReactionInto(parameters, state[0], state[1], stimulus(time), out, 0)
    return out
  }
}

export function simulateFitzHughNagumo(
  parameters: FitzHughNagumoParameters,
  initial: readonly number[],
  stimulus: (time: number) => number,
  window: BiologyWindow,
): FitzHughNagumoSample[] {
  requirePositive(parameters.epsilon, 'FitzHugh–Nagumo timescale ratio')
  requireFinite(parameters.a, 'FitzHugh–Nagumo a')
  requireFinite(parameters.b, 'FitzHugh–Nagumo b')
  if (initial.length !== 2) throw new Error(`FitzHugh–Nagumo needs two initial values (got ${initial.length}).`)
  const derivative = fitzhughNagumoDerivative(parameters, stimulus)
  return integrateModel(derivative, initial, window, parameters.epsilon).map((sample) => ({
    time: sample.time,
    voltage: sample.state[0],
    recovery: sample.state[1],
  }))
}

/* ------------------------------------------------------------------ *
 * Leaky integrate-and-fire
 * ------------------------------------------------------------------ */

export interface IntegrateAndFireParameters {
  /** Membrane time constant, ms. */
  tauMs: number
  restMillivolts: number
  thresholdMillivolts: number
  resetMillivolts: number
  /** Drive at which the membrane would sit if it never spiked, mV. */
  driveMillivolts: number
  /** Absolute refractory period after a spike, ms. */
  refractoryMs: number
  /** Potential the trace starts at, mV. Defaults to rest. */
  initialMillivolts?: number
}

export interface IntegrateAndFireResult {
  spikeTimesMs: number[]
  /** Inter-spike intervals, ms — empty for a single spike. */
  intervalsMs: number[]
  /** Steady subthreshold potential the drive pulls toward, mV. */
  asymptoteMillivolts: number
  /** Trace sampled at `window.dt`, with each spike reported at its analytic time. */
  samples: { timeMs: number; potentialMillivolts: number }[]
}

/**
 * Exact integrate-and-fire with exponential membrane updates.
 *
 * Between spikes the equation is linear, so the next value is computed in closed
 * form instead of being stepped — this model is therefore exact up to the
 * analytic solution of the spike-time crossing, and no internal step is needed.
 * That is also why it does not use `integrateModel`.
 */
export function simulateIntegrateAndFire(
  parameters: IntegrateAndFireParameters,
  window: BiologyWindow,
): IntegrateAndFireResult {
  requirePositive(parameters.tauMs, 'Membrane time constant')
  requireFinite(parameters.restMillivolts, 'Resting potential')
  requireFinite(parameters.driveMillivolts, 'Drive potential')
  requireFinite(parameters.thresholdMillivolts, 'Threshold potential')
  requireFinite(parameters.resetMillivolts, 'Reset potential')
  requireNonNegative(parameters.refractoryMs, 'Refractory period')
  if (!(parameters.thresholdMillivolts > parameters.restMillivolts)) {
    throw new Error(
      `Threshold ${parameters.thresholdMillivolts} mV must sit above rest ${parameters.restMillivolts} mV; ` +
        'otherwise the cell spikes from its own resting potential.',
    )
  }
  if (parameters.resetMillivolts > parameters.thresholdMillivolts) {
    throw new Error('Reset potential must not exceed threshold, or the cell fires continuously.')
  }
  requireFinite(parameters.initialMillivolts ?? parameters.restMillivolts, 'Initial potential')

  const asymptote = parameters.driveMillivolts
  const spikeTimes: number[] = []
  const samples: { timeMs: number; potentialMillivolts: number }[] = []
  validateWindow(window)
  const steps = Math.floor(window.tEnd / window.dt)
  let time = 0
  let potential = parameters.initialMillivolts ?? parameters.restMillivolts
  let refractoryUntil = Number.NEGATIVE_INFINITY

  samples.push({ timeMs: time, potentialMillivolts: potential })

  for (let step = 1; step <= steps; step += 1) {
    const target = step * window.dt
    while (time < target - 1e-12) {
      const remaining = target - time
      if (time < refractoryUntil) {
        // Held at reset during the absolute refractory period.
        const hold = Math.min(remaining, refractoryUntil - time)
        time += hold
        continue
      }
      if (!(asymptote > parameters.thresholdMillivolts)) {
        potential = asymptote + (potential - asymptote) * Math.exp(-remaining / parameters.tauMs)
        time = target
        break
      }
      // V(t) = V∞ + (V₀ − V∞)e^(−t/τ) reaches V_th after
      // τ·ln((V∞ − V₀)/(V∞ − V_th)); `distance` is the reciprocal of that ratio,
      // so a value at or above 1 means the membrane is already past threshold.
      const distance = (asymptote - parameters.thresholdMillivolts) / (asymptote - potential)
      const toThreshold = distance >= 1 ? 0 : distance <= 0 ? Infinity : -parameters.tauMs * Math.log(distance)
      if (!Number.isFinite(toThreshold) || toThreshold > remaining) {
        potential = asymptote + (potential - asymptote) * Math.exp(-remaining / parameters.tauMs)
        time = target
        break
      }
      time += toThreshold
      potential = parameters.thresholdMillivolts
      spikeTimes.push(time)
      potential = parameters.resetMillivolts
      refractoryUntil = time + parameters.refractoryMs
    }
    samples.push({ timeMs: target, potentialMillivolts: potential })
  }

  const intervals: number[] = []
  for (let i = 1; i < spikeTimes.length; i += 1) intervals.push(spikeTimes[i] - spikeTimes[i - 1])
  return { spikeTimesMs: spikeTimes, intervalsMs: intervals, asymptoteMillivolts: asymptote, samples }
}

/* ------------------------------------------------------------------ *
 * Presets for the UI
 * ------------------------------------------------------------------ */

export interface CellPreset {
  id: string
  name: string
  note: string
  HodgkinHuxley: HodgkinHuxleyParameters
  initial: HodgkinHuxleyInitialState
}

export const CELL_PRESETS: readonly CellPreset[] = [
  {
    id: 'squid-classic',
    name: 'Squid giant axon (Hodgkin–Huxley 1952)',
    note: 'Room-temperature constants from the original papers: rest ≈ −65 mV, spike peak ≈ +40 mV, '
      + 'and the current search puts the threshold for a 10 ms pulse near 2.4 µA/cm². '
      + 'No temperature correction applied — a mammalian axon at 37 °C would differ.',
    HodgkinHuxley: CLASSIC_HODGKIN_HUXLEY,
    initial: RESTING_STATE,
  },
  {
    id: 'high-conductance',
    name: 'Small cell with a leaky membrane',
    note: 'Resting potential closer to the leak reversal, and a shorter membrane time constant. '
      + 'Representative of a generic high-conductance cell, not a measured one.',
    HodgkinHuxley: {
      capacitanceUfPerCm2: 1,
      sodiumConductanceMilliSiemensPerCm2: 120,
      potassiumConductanceMilliSiemensPerCm2: 36,
      leakConductanceMilliSiemensPerCm2: 1,
      sodiumReversalMillivolts: 55,
      potassiumReversalMillivolts: -80,
      leakReversalMillivolts: -60,
    },
    initial: { ...RESTING_STATE, potentialMillivolts: -68 },
  },
]
