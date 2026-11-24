/**
 * System identification — the toolbox end that feeds the control design loop.
 *
 * Two things are reported for every fitted model and they mean different
 * things, so the panel must not conflate them:
 *
 *   • one-step prediction error — the model is fed the measured past and asked
 *     for the next sample. Low here means the noise structure is captured.
 *   • free-running simulation error — the model is fed only its own past
 *     outputs. Low here means the model is usable for design and for what-if.
 *
 * A model with a good one-step score and a bad simulation score is a common
 * failure mode (over-fitted to the exogenous signal), and showing only the
 * first would hide it.
 */

import { leastSquares } from './linalg'
import { evaluateFit, type FitMetrics } from './regression'

export interface ArxModel {
  /** Output lags (na) and input lags (nb) actually used. */
  structure: { na: number; nb: number; delay: number }
  /** a₁…aₙa then b₀…b_nb, matching `regressor`. */
  coefficients: number[]
  oneStepResiduals: number[]
  oneStep: FitMetrics
  freeRun: FitMetrics
  /** Sample count that carried enough history to be scored. */
  scoredSamples: number
  predict(yPast: readonly number[], uPast: readonly number[]): number
  /** Difference-equation polynomials, ascending powers of z⁻¹: A(q⁻¹)y = B(q⁻¹)u. */
  aPolynomial: number[]
  bPolynomial: number[]
}

function validateSeries(values: readonly number[], label: string): void {
  if (values.length === 0) throw new Error(`${label} is empty.`)
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error(`${label} contains a non-finite sample; identify a clean segment instead.`)
  }
}

/**
 * ARX(na, nb, delay) fitted by least squares on the standard regressor
 * [y(k−1)…y(k−na), u(k−delay)…u(k−delay−nb)].
 *
 * The first `delay + max(na, nb)` samples are dropped because they lack
 * history; nothing is padded with zeros, which would teach the model a transient
 * that never happened.
 */
export function fitArx(
  output: readonly number[],
  input: readonly number[],
  options: { na: number; nb: number; delay?: number; ridgeLambda?: number },
): ArxModel {
  if (output.length !== input.length) {
    throw new Error(`Input and output series must be the same length, got ${input.length} vs ${output.length}.`)
  }
  validateSeries(output, 'ARX output')
  validateSeries(input, 'ARX input')

  const na = options.na
  const nb = options.nb
  const delay = options.delay ?? 1
  if (!Number.isInteger(na) || na < 0 || na > 50) throw new Error(`na must be an integer in 0..50, got ${na}.`)
  if (!Number.isInteger(nb) || nb < 0 || nb > 50) throw new Error(`nb must be an integer in 0..50, got ${nb}.`)
  if (!Number.isInteger(delay) || delay < 0) throw new Error(`Input delay must be a non-negative integer, got ${delay}.`)

  const start = Math.max(na, delay + nb)
  if (start >= output.length) {
    throw new Error(
      `ARX(${na}, ${nb}, ${delay}) needs more than ${start} samples to form a regressor; got ${output.length}. Lower the orders or supply more data.`,
    )
  }

  const parameterCount = na + nb + 1
  const rows: number[][] = []
  const targets: number[] = []
  for (let k = start; k < output.length; k += 1) {
    const regressor: number[] = []
    for (let i = 1; i <= na; i += 1) regressor.push(output[k - i])
    for (let i = 0; i <= nb; i += 1) regressor.push(input[k - delay - i])
    rows.push(regressor)
    targets.push(output[k])
  }
  if (rows.length < parameterCount + 1) {
    throw new Error(`${rows.length} usable regressors cannot identify ${parameterCount} ARX parameters; reduce the orders or add data.`)
  }

  const coefficients = leastSquares(rows, targets, options.ridgeLambda ?? 0)

  const oneStepPredictions: number[] = []
  const oneStepActual: number[] = []
  for (let k = start; k < output.length; k += 1) {
    let prediction = 0
    for (let i = 1; i <= na; i += 1) prediction += coefficients[i - 1] * output[k - i]
    for (let i = 0; i <= nb; i += 1) prediction += coefficients[na + i] * input[k - delay - i]
    oneStepPredictions.push(prediction)
    oneStepActual.push(output[k])
  }

  const freeRun = simulateArx(coefficients, na, nb, delay, input, output, start)
  const freeRunActual = output.slice(start)

  return {
    structure: { na, nb, delay },
    coefficients,
    oneStepResiduals: oneStepActual.map((actual, i) => actual - oneStepPredictions[i]),
    oneStep: evaluateFit(oneStepPredictions, oneStepActual),
    freeRun: evaluateFit(freeRun, [...freeRunActual]),
    scoredSamples: oneStepActual.length,
    aPolynomial: [1, ...Array.from({ length: na }, (_, i) => -coefficients[i])],
    bPolynomial: Array.from({ length: nb + 1 }, (_, i) => coefficients[na + i]),
    predict(yPast: readonly number[], uPast: readonly number[]): number {
      // Both series are the observed history in the same time order as the
      // training data, oldest → newest, and cover the same span: the newest
      // entry of each is the sample at t = m − 1, and the value returned is the
      // model's estimate for t = m.
      if (yPast.length < na) throw new Error(`predict needs ${na} past outputs, got ${yPast.length}.`)
      if (uPast.length < delay + nb) {
        throw new Error(`predict needs at least ${delay + nb} past inputs to cover delay ${delay} and ${nb} input lags, got ${uPast.length}.`)
      }
      if (yPast.some((value) => !Number.isFinite(value)) || uPast.some((value) => !Number.isFinite(value))) {
        throw new Error('predict history must be finite.')
      }
      let value = 0
      for (let i = 1; i <= na; i += 1) value += coefficients[i - 1] * yPast[yPast.length - i]
      for (let i = 0; i <= nb; i += 1) value += coefficients[na + i] * uPast[uPast.length - delay - i]
      return value
    },
  }
}

/** Free-running simulation: the model is fed its own outputs, only the input is measured. */
function simulateArx(
  coefficients: readonly number[],
  na: number,
  nb: number,
  delay: number,
  input: readonly number[],
  output: readonly number[],
  start: number,
): number[] {
  // `history` begins with the measured warm-up samples and then carries the
  // model's own predictions, which is exactly the difference between a free run
  // and a one-step prediction.
  const history = output.slice(0, start)
  const predicted: number[] = []
  for (let k = start; k < output.length; k += 1) {
    let value = 0
    for (let i = 1; i <= na; i += 1) value += coefficients[i - 1] * history[history.length - i]
    for (let i = 0; i <= nb; i += 1) value += coefficients[na + i] * input[k - delay - i]
    predicted.push(value)
    history.push(value)
  }
  return predicted
}

export interface FopdtModel {
  /** Steady-state gain (output units per input unit); negative for an inverting step. */
  gain: number
  /** Dominant time constant, in seconds. */
  timeConstant: number
  /** Apparent dead time, in seconds; never negative. */
  deadTime: number
  /** Output value before the step, carried so the model reproduces the trace. */
  baseline: number
  /** The step magnitude supplied by the caller, echoed for reproducibility. */
  stepSize: number
  /** Two-point (35 %/65 %) identification — the classic open-loop shortcut. */
  method: 'two-point 35/65'
  sampleIntervalSeconds: number
  /** Where the fit is expected to fail, in the caller's own units. */
  validityNotes: string[]
  /** Predicted absolute output trace (baseline + FOPDT change) at each time. */
  stepResponse(times: readonly number[]): Array<{ time: number; value: number }>
}

/**
 * First-order plus dead-time model from an open-loop step test.
 *
 * Uses the 35 %/65 % two-point method (Miller–Nichols–Swenson), which is
 * insensitive to the dead time and to noise near the start and the plateau —
 * unlike the tangent-at-inflection method, which needs a clean slope.
 *
 * The fit quality is reported through the residual against the measured curve
 * so the engineer sees whether a first-order model was appropriate at all.
 */
export function fitFopdt(
  times: readonly number[],
  response: readonly number[],
  options: { stepSize: number; fromValue?: number },
): FopdtModel & { fit: FitMetrics } {
  if (times.length !== response.length) throw new Error('Step test time and response arrays must match in length.')
  if (times.length < 8) throw new Error(`A step-response fit needs at least 8 samples to locate two levels; got ${times.length}.`)
  validateSeries(times, 'Step test times')
  validateSeries(response, 'Step response')
  if (!Number.isFinite(options.stepSize) || options.stepSize === 0) {
    throw new Error('The step size must be a non-zero finite number; pass the change you actually applied, with its sign.')
  }
  if (times.some((value, i) => i > 0 && value <= times[i - 1])) {
    throw new Error('Step test times must be strictly increasing.')
  }

  const start = options.fromValue ?? windowMean(response, 0, Math.max(2, Math.round(times.length * 0.05)))
  const tailStart = Math.max(0, times.length - Math.max(2, Math.round(times.length * 0.1)))
  const tail = windowMean(response, tailStart, times.length)
  // The achieved change is taken from a tail *average*, not from the maximum:
  // a maximum latches onto the largest noise spike and would inflate the gain.
  const achieved = tail - start
  if (Math.abs(achieved) < 1e-12 * Math.max(1, Math.abs(options.stepSize))) {
    throw new Error(
      'The response did not move measurably after the step, so there is no gain, time constant or dead time to identify. ' +
        'Check the step magnitude and that this channel is the one the input drives.',
    )
  }

  // Fractions of the achieved change: a falling (negative-gain) curve still
  // runs 0 → 1 here, which is why the two-point method works for both.
  const fraction = response.map((value) => (value - start) / achieved)
  const t35 = crossTime(times, fraction, 0.35)
  const t65 = crossTime(times, fraction, 0.65)
  if (t35 === null || t65 === null) {
    throw new Error('The response never passed both the 35 % and 65 % levels of its achieved change; a first-order model is not what this curve is.')
  }
  if (!(t65 > t35)) {
    throw new Error('The 65 % level was not reached after the 35 % level — the trace is not monotonic enough for two-point identification.')
  }

  const interval = medianInterval(times)
  // For y = 1 − e^−(t−θ)/τ the 35 % and 65 % crossings give
  // τ = (t65 − t35) / ln(0.65/0.35) and θ = t35 − τ·ln(1/0.65).
  const tau = (t65 - t35) / Math.log(0.65 / 0.35)
  const theta = t35 - tau * Math.log(1 / (1 - 0.35))
  const deadTime = Math.max(0, theta)
  const gain = achieved / options.stepSize

  const model = new Fopdt(gain, tau, deadTime, start, options.stepSize)
  const predicted = times.map((time) => model.responseAt(time))
  // Movement across the tail window against the equally long window just before
  // it: if the trace is still climbing, the "settled" value is not settled.
  const tailWidth = times.length - tailStart
  const beforeTail = windowMean(fraction, Math.max(0, tailStart - tailWidth), tailStart)
  const tailChange = Math.abs((tail - start) / achieved - beforeTail)

  const validityNotes: string[] = []
  if (theta < 0) {
    validityNotes.push('Apparent dead time is negative and was clamped to 0: the curve had already moved by the first sample, so any true delay is below the sampling interval.')
  }
  if (tau < 2 * interval) {
    validityNotes.push(`Time constant (${tau.toPrecision(4)} s) is under two sample intervals (${(2 * interval).toPrecision(4)} s): the data cannot resolve it and the value is dominated by sampling.`)
  }
  if (tailChange > 0.02) {
    validityNotes.push(`The trace still moved ${(tailChange * 100).toFixed(1)} % of its achieved change over the last 10 % of the record, so it had not settled — the gain is a lower bound and the time constant is optimistic. Extend the test.`)
  }

  return {
    gain,
    timeConstant: tau,
    deadTime,
    method: 'two-point 35/65',
    sampleIntervalSeconds: interval,
    baseline: start,
    stepSize: options.stepSize,
    validityNotes,
    stepResponse: (requestTimes: readonly number[]) =>
      requestTimes.map((time) => ({ time, value: model.responseAt(time) })),
    fit: evaluateFit(predicted, [...response]),
  }
}

class Fopdt {
  constructor(
    readonly gain: number,
    readonly timeConstant: number,
    readonly deadTime: number,
    readonly baseline: number,
    readonly stepSize: number,
  ) {}

  /** Absolute predicted output, including the pre-step baseline. */
  responseAt(time: number): number {
    return this.baseline + this.changeAt(time)
  }

  /** Change from baseline — the canonical FOPDT step response. */
  changeAt(time: number): number {
    if (time <= this.deadTime) return 0
    return this.gain * this.stepSize * (1 - Math.exp(-(time - this.deadTime) / this.timeConstant))
  }
}

function windowMean(values: readonly number[], from: number, to: number): number {
  let sum = 0
  let count = 0
  for (let i = from; i < to; i += 1) {
    sum += values[i]
    count += 1
  }
  if (count === 0) throw new Error('Window mean needs a non-empty window.')
  return sum / count
}

function crossTime(times: readonly number[], values: readonly number[], level: number): number | null {
  for (let i = 1; i < values.length; i += 1) {
    if (values[i - 1] < level && values[i] >= level) {
      const denominator = values[i] - values[i - 1]
      if (denominator === 0) return times[i]
      const fraction = (level - values[i - 1]) / denominator
      return times[i - 1] + fraction * (times[i] - times[i - 1])
    }
  }
  return null
}

function medianInterval(times: readonly number[]): number {
  const deltas: number[] = []
  for (let i = 1; i < times.length; i += 1) deltas.push(times[i] - times[i - 1])
  deltas.sort((a, b) => a - b)
  const middle = Math.floor(deltas.length / 2)
  return deltas.length % 2 === 0 ? (deltas[middle - 1] + deltas[middle]) / 2 : deltas[middle]
}

export interface FrequencyResponsePoint {
  frequencyHz: number
  magnitudeDb: number
  /** Principal value in (−180, 180]; unwrap only if the plant has integrators. */
  phaseDeg: number
  /**
   * Fraction of the window's *varying* output power the fitted harmonic explains.
   * Near 1 means a clean tone; low means the reading is noise or another tone;
   * `NaN` means the output held no varying component to attribute.
   * This is deliberately not called coherence — that needs several averages.
   */
  explainedPowerRatio: number
  /** Integer cycles used, after the settle window was dropped. */
  cycles: number
  samplesUsed: number
  /**
   * Why this point should be read with care. Empty means nothing was flagged:
   * a flagged point is still reported, because hiding a noisy Bode point is how
   * an engineer ends up trusting a measurement that cannot support it.
   */
  flags: string[]
}

export interface FrequencyResponseEstimate {
  points: FrequencyResponsePoint[]
  /** Sample interval of the recorded signals, taken as the median Δt. */
  sampleIntervalSeconds: number
  /** Frequencies with no point at all, with the reason — empty means every request produced a reading. */
  rejected: Array<{ frequencyHz: number; reason: string }>
}

/**
 * Non-parametric frequency-response estimate from a swept-sine (or single-sine)
 * record: the plant's gain and phase at each excitation frequency, obtained by
 * fitting a cosine/sine pair to the settled part of the record over an integer
 * number of cycles and taking the complex ratio of the two fits.
 *
 * This is the empirical Bode measurement — the check on a model-based Bode
 * plot, and the only honest way to get a response for a plant you cannot write
 * equations for.
 */
export function estimateFrequencyResponse(
  times: readonly number[],
  input: readonly number[],
  output: readonly number[],
  frequenciesHz: readonly number[],
  options: { settleCycles?: number } = {},
): FrequencyResponseEstimate {
  if (times.length !== input.length || times.length !== output.length) {
    throw new Error('Frequency response needs time, input and output arrays of equal length.')
  }
  validateSeries(times, 'Frequency response times')
  validateSeries(input, 'Frequency response input')
  validateSeries(output, 'Frequency response output')
  if (frequenciesHz.length === 0) throw new Error('Provide at least one excitation frequency.')
  if (times.length < 64) throw new Error(`Frequency response correlation needs at least 64 samples per record, got ${times.length}.`)
  if (times.some((value, i) => i > 0 && value <= times[i - 1])) throw new Error('Time axis must be strictly increasing.')

  const interval = medianInterval(times)
  const duration = times[times.length - 1] - times[0]
  const settleCycles = options.settleCycles ?? 1
  if (!Number.isInteger(settleCycles) || settleCycles < 0) throw new Error('settleCycles must be a non-negative integer.')

  const points: FrequencyResponseEstimate['points'] = []
  const rejected: FrequencyResponseEstimate['rejected'] = []

  for (const frequency of frequenciesHz) {
    if (!(frequency > 0)) {
      rejected.push({ frequencyHz: frequency, reason: 'Frequency must be positive.' })
      continue
    }
    const nyquist = 0.5 / interval
    if (frequency >= 0.9 * nyquist) {
      rejected.push({ frequencyHz: frequency, reason: `Above 90 % of the Nyquist frequency (${(0.9 * nyquist).toFixed(3)} Hz) for the ${(interval * 1000).toFixed(2)} ms sampling — the estimate would be aliasing, not measurement.` })
      continue
    }
    const period = 1 / frequency
    const cycles = Math.floor((duration - settleCycles * period) / period)
    if (cycles < 1) {
      rejected.push({ frequencyHz: frequency, reason: `Record is too short for one settled cycle at ${frequency} Hz (needs at least ${((settleCycles + 1) * period).toFixed(4)} s, has ${duration.toFixed(4)} s).` })
      continue
    }

    const windowStart = times[0] + settleCycles * period
    const windowEnd = windowStart + cycles * period
    // Least-squares harmonic fit at the excitation frequency over an integer
    // number of settled cycles: the signal is modelled as C·cos(ωt) + D·sin(ωt)
    // and the 2×2 normal equations are actually solved. Correlating straight
    // against the sinuses instead would leave a magnitude error of order 1/N,
    // because a window that holds whole *cycles* rarely holds whole *samples per
    // cycle* — the grid leaves cos and sin slightly non-orthogonal, and a plain
    // correlation reads that leak as gain.
    const window: number[] = []
    let scc = 0
    let css = 0
    let sss = 0
    let inCos = 0
    let inSin = 0
    let outCos = 0
    let outSin = 0
    let outSum = 0
    let outSquareSum = 0
    for (let i = 0; i < times.length; i += 1) {
      const t = times[i]
      if (t < windowStart || t > windowEnd) continue
      const cosine = Math.cos(2 * Math.PI * frequency * t)
      const sine = Math.sin(2 * Math.PI * frequency * t)
      scc += cosine * cosine
      css += cosine * sine
      sss += sine * sine
      inCos += input[i] * cosine
      inSin += input[i] * sine
      outCos += output[i] * cosine
      outSin += output[i] * sine
      outSum += output[i]
      outSquareSum += output[i] * output[i]
      window.push(i)
    }
    const samplesUsed = window.length
    if (samplesUsed < 8) {
      rejected.push({ frequencyHz: frequency, reason: `Only ${samplesUsed} samples fell inside the settled window; the estimate would be dominated by quadrature error.` })
      continue
    }

    const determinant = scc * sss - css * css
    if (!(Math.abs(determinant) > 1e-12 * Math.max(1, scc * sss))) {
      rejected.push({ frequencyHz: frequency, reason: 'Cosine and sine are collinear over this window (well under a half-cycle of samples) — the harmonic fit has no unique solution.' })
      continue
    }
    const fitHarmonic = (cosSide: number, sinSide: number): { cosine: number; sine: number } => ({
      cosine: (sss * cosSide - css * sinSide) / determinant,
      sine: (scc * sinSide - css * cosSide) / determinant,
    })
    const drive = fitHarmonic(inCos, inSin)
    const response = fitHarmonic(outCos, outSin)

    const drivePower = drive.cosine * drive.cosine + drive.sine * drive.sine
    if (!(drivePower > 1e-24)) {
      rejected.push({ frequencyHz: frequency, reason: 'No excitation energy at this frequency — the input was flat, so gain and phase are undefined.' })
      continue
    }
    // A·cos(ωt) + B·sin(ωt) is Re((A − jB)·e^{jωt}), so H = (C − jD)/(A − jB)
    // and the imaginary part is (C·B − D·A)/|Ũ|². A response that *leads* its
    // input therefore comes out positive — getting this sign backwards mirrors
    // every phase reading and makes an unstable plant look stable.
    const real = (response.cosine * drive.cosine + response.sine * drive.sine) / drivePower
    const imag = (response.cosine * drive.sine - response.sine * drive.cosine) / drivePower
    const magnitude = Math.hypot(real, imag)
    if (!(magnitude > 0)) {
      rejected.push({ frequencyHz: frequency, reason: 'Estimated gain is exactly zero — the response carried no component at the excitation frequency.' })
      continue
    }

    // Fraction of the window's *varying* output power that the fitted harmonic
    // explains (1 − SSE/SST). Inside a window of pure noise this lands at ≈2/N,
    // the two degrees of freedom the fit spent; for a clean tone it is 1. This is
    // not a statistical coherence — that needs several averages — but it does say
    // whether the point rests on a tone or on noise.
    const meanOutput = outSum / samplesUsed
    const totalPower = outSquareSum - samplesUsed * meanOutput * meanOutput
    let residualPower = 0
    for (const index of window) {
      const t = times[index]
      const phase = 2 * Math.PI * frequency * t
      const predicted = response.cosine * Math.cos(phase) + response.sine * Math.sin(phase)
      residualPower += (output[index] - predicted) ** 2
    }
    const explainedPowerRatio = totalPower > 1e-30 ? Math.min(1, Math.max(0, 1 - residualPower / totalPower)) : Number.NaN

    const flags: string[] = []
    if (Number.isNaN(explainedPowerRatio)) {
      flags.push(`The output was constant across this window, so no share of its (zero) varying power can be attributed to ${frequency} Hz.`)
    } else if (explainedPowerRatio < 0.2) {
      flags.push(
        `Only ${(explainedPowerRatio * 100).toFixed(1)} % of the output energy in this window is at ${frequency} Hz, so the gain and phase are read through noise or another tone.`,
      )
    }

    points.push({
      frequencyHz: frequency,
      cycles,
      samplesUsed,
      magnitudeDb: 20 * Math.log10(magnitude),
      phaseDeg: Math.atan2(imag, real) * (180 / Math.PI),
      explainedPowerRatio,
      flags,
    })
  }

  return { points, sampleIntervalSeconds: interval, rejected }
}
