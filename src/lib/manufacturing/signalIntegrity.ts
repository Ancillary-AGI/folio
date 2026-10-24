/**
 * Signal-integrity physics for PCB traces.
 *
 * Post-layout traces are transmission lines, not ideal wires. When a driver
 * launches an edge down a line whose characteristic impedance Z0 differs from
 * the load ZL, part of the wave reflects and rings — the root cause of
 * overshoot, ringing, and bit errors on real boards. This module computes that
 * physics from first principles so a layout can be judged before it is
 * fabricated:
 *
 *   - Characteristic impedance from geometry (microstrip/stripline) — this
 *     reuses the impedance math already in stackup.ts, which was validated
 *     against the closed-form formulas.
 *   - Reflection coefficient Γ = (ZL − Z0) / (ZL + Z0), the exact transmission
 *     line result. The initial reflection at the driver is Γ_src; the final
 *     settled voltage follows the resistive divider rule.
 *   - Ringing / overshoot from the multiple reflections between source and
 *     load, damped by the trace's resistive and dielectric loss.
 *   - IBIS-lite I-V: given a driver's output impedance and the terminated
 *     line, the steady-state logic level and settling time.
 *
 * Every number here is a closed-form physical result or a lattice diagram
 * (reflection) computation — never a fitted curve. If an input is missing or
 * the line is undefined, the result carries `success: false` and a reason.
 */

import { microstripImpedance, striplineImpedance, widthForImpedance } from './stackup'

export type Geometry = 'microstrip' | 'stripline'

export interface TraceGeometry {
  kind: Geometry
  /** Trace width in millimetres. */
  widthMm: number
  /** Height from trace to its reference plane in millimetres. */
  heightMm: number
  /** Dielectric constant of the material between trace and plane. */
  epsilonR: number
  /** Copper weight, millimetres. Defaults to 0.035 mm (1 oz). */
  copperThicknessMm?: number
  /** For stripline only: total dielectric thickness between the two planes. */
  thicknessMm?: number
}

export interface SignalPath {
  geometry: TraceGeometry
  /** Trace length in millimetres. */
  lengthMm: number
  /** Driver output impedance in ohms. */
  driverImpedanceOhm: number
  /** Receiver input impedance in ohms (far-end load). */
  loadImpedanceOhm: number
  /** Edge amplitude at the driver, volts (logic high level). */
  vHigh: number
  /** Resistive loss per unit length, ohms per mm (copper). */
  resistancePerMm?: number
  /** Number of reflection round-trips to simulate. */
  reflections?: number
}

export interface SiResult {
  success: boolean
  error?: string
  /** Characteristic impedance of the trace, ohms. */
  z0Ohm: number
  /** Reflection coefficient seen at the load. */
  gammaLoad: number
  /** Reflection coefficient seen at the source. */
  gammaSource: number
  /** Final settled logic level at the load, volts. */
  settledVolts: number
  /** Peak voltage at the load including ringing, volts (overshoot magnitude). */
  peakVolts: number
  /** Peak overshoot beyond vHigh, volts. */
  overshootVolts: number
  /** One-way propagation delay, nanoseconds. */
  delayNs: number
  /** Reflected voltage samples at the load over the reflection lattice. */
  ringing: Array<{ roundTrip: number; volts: number }>
  notes?: string[]
}

const SPEED_OF_LIGHT_M_PER_S = 299_792_458
const MM_TO_M = 1e-3

function characteristicImpedance(geometry: TraceGeometry): number {
  const copper = geometry.copperThicknessMm ?? 0.035
  if (geometry.kind === 'microstrip') {
    return microstripImpedance(geometry.widthMm, geometry.heightMm, copper, geometry.epsilonR)
  }
  const thickness = geometry.thicknessMm ?? geometry.heightMm
  return striplineImpedance(geometry.widthMm, thickness, copper, geometry.epsilonR)
}

interface LatticeArrival {
  roundTrip: number
  /** Time of arrival at the load, ns. */
  timeNs: number
  /** Load-voltage step contribution for the actual vHigh source, V. */
  gainVolts: number
  /** Cumulative load voltage after this arrival, V. */
  loadVolts: number
}

interface Lattice {
  z0Ohm: number
  gammaLoad: number
  gammaSource: number
  launchedVolts: number
  settledVolts: number
  delayNs: number
  arrivals: LatticeArrival[]
  /** True when the last round trip was still above the numerical floor. */
  truncated: boolean
}

/**
 * Build the reflection lattice once so the time-domain analysis and the eye
 * diagram cannot disagree about the line.
 *
 * Each round trip multiplies the wave by ΓL·Γs and by the line's round-trip
 * attenuation. The previous implementation multiplied the attenuation again
 * on every iteration, so the n-th echo was damped by loss^(n(n+1)/2) instead
 * of loss^n — a 4th echo with 1 dB/round-trip loss was reported 10 dB down
 * instead of 4 dB down.
 */
function buildLattice(
  path: SignalPath,
  z0: number,
  options: { maxRounds: number; minAmplitudeVolts?: number } ,
): Lattice {
  const gammaLoad = (path.loadImpedanceOhm - z0) / (path.loadImpedanceOhm + z0)
  const gammaSource = (path.driverImpedanceOhm - z0) / (path.driverImpedanceOhm + z0)
  const launchedVolts = (path.vHigh * z0) / (path.driverImpedanceOhm + z0)
  const effectiveEpsilon = path.geometry.kind === 'stripline'
    ? path.geometry.epsilonR
    : 0.5 * (path.geometry.epsilonR + 1) + 0.5 * (path.geometry.epsilonR - 1) / Math.sqrt(1 + 12 * (path.geometry.heightMm / path.geometry.widthMm))
  const velocity = SPEED_OF_LIGHT_M_PER_S / Math.sqrt(effectiveEpsilon)
  const delayNs = ((path.lengthMm * MM_TO_M) / velocity) * 1e9
  const roundTripLoss = path.resistancePerMm && path.resistancePerMm > 0
    ? Math.exp((-path.resistancePerMm * path.lengthMm) / z0)
    : 1
  const floor = options.minAmplitudeVolts ?? 1e-9

  const arrivals: LatticeArrival[] = []
  let wave = launchedVolts
  let loadVolts = 0
  let truncated = false
  for (let roundTrip = 0; roundTrip <= options.maxRounds; roundTrip += 1) {
    if (roundTrip > 0) wave *= gammaLoad * gammaSource * roundTripLoss
    if (roundTrip > 0 && Math.abs(wave) < floor) break
    const gainVolts = wave * (1 + gammaLoad)
    loadVolts += gainVolts
    arrivals.push({
      roundTrip,
      timeNs: (2 * roundTrip + 1) * delayNs,
      gainVolts,
      loadVolts,
    })
    if (roundTrip === options.maxRounds && Math.abs(wave) >= floor) truncated = true
  }

  return {
    z0Ohm: z0,
    gammaLoad,
    gammaSource,
    launchedVolts,
    settledVolts: (path.vHigh * path.loadImpedanceOhm) / (path.driverImpedanceOhm + path.loadImpedanceOhm),
    delayNs,
    arrivals,
    truncated,
  }
}

/**
 * Analyse one signal path with a reflection (bounce) diagram.
 *
 * The model is the textbook transmission-line lattice: the driver injects a
 * step; each time it reaches an impedance discontinuity it splits into a
 * transmitted wave and a reflected wave of Γ = (ZL − Z0)/(ZL + Z0). The load
 * voltage is the superposition of every wave that has arrived so far. This is
 * exact for a lossless line and remains the standard first-order model with a
 * per-round-trip loss applied for resistive damping.
 */
export function analyzeSignalPath(path: SignalPath): SiResult {
  const notes: string[] = []
  if (!(path.lengthMm > 0)) return fail('trace length must be positive')
  if (!(path.driverImpedanceOhm > 0) || !(path.loadImpedanceOhm > 0)) {
    return fail('driver and load impedance must be positive')
  }
  if (!(path.vHigh > 0)) return fail('vHigh must be positive')
  if (!(path.geometry.widthMm > 0) || !(path.geometry.heightMm > 0)) {
    return fail('trace width and dielectric height must be positive')
  }
  if (!(Number.isFinite(path.geometry.epsilonR) && path.geometry.epsilonR >= 1)) {
    return fail('relative permittivity must be finite and at least 1')
  }
  if (path.geometry.kind === 'stripline') {
    const spacing = path.geometry.thicknessMm ?? path.geometry.heightMm
    if (!(Number.isFinite(spacing) && spacing > 0)) {
      return fail('stripline plane spacing must be positive and finite')
    }
  }
  if (
    path.geometry.copperThicknessMm !== undefined &&
    !(Number.isFinite(path.geometry.copperThicknessMm) && path.geometry.copperThicknessMm >= 0)
  ) {
    return fail('copper thickness must be zero or positive and finite')
  }
  if (path.resistancePerMm !== undefined && !(Number.isFinite(path.resistancePerMm) && path.resistancePerMm >= 0)) {
    return fail('resistance per millimetre must be zero or positive and finite')
  }
  if (path.reflections !== undefined && !(Number.isInteger(path.reflections) && path.reflections >= 0)) {
    return fail('reflection count must be a whole number of zero or more')
  }

  const z0 = characteristicImpedance(path.geometry)
  if (!(z0 > 0)) return fail('characteristic impedance non-positive — check geometry')

  const maxRounds = path.reflections ?? 20
  const lattice = buildLattice(path, z0, { maxRounds })
  /*
   * The incident wave arriving at the load adds V⁺·(1 + ΓL), not 2·V⁺:
   * 2·V⁺ is the open-circuit special case and overstates every terminated
   * line. `buildLattice` applies that factor to every echo.
   */
  const ringing = lattice.arrivals.map((arrival) => ({
    roundTrip: arrival.roundTrip,
    volts: arrival.loadVolts,
  }))

  let peakVolts = -Infinity
  for (const sample of ringing) {
    if (sample.volts > peakVolts) peakVolts = sample.volts
  }
  const overshootVolts = Math.max(0, peakVolts - path.vHigh)

  notes.push(
    `Z0=${lattice.z0Ohm.toFixed(1)}Ω  ΓL=${lattice.gammaLoad.toFixed(3)}  Γsrc=${lattice.gammaSource.toFixed(3)}`,
  )
  if (overshootVolts > path.vHigh * 0.1) {
    notes.push('overshoot > 10% of the edge — consider series termination or matching Z0 to ZL')
  }

  return {
    success: true,
    z0Ohm: lattice.z0Ohm,
    gammaLoad: lattice.gammaLoad,
    gammaSource: lattice.gammaSource,
    settledVolts: lattice.settledVolts,
    peakVolts,
    overshootVolts,
    delayNs: lattice.delayNs,
    ringing,
    notes,
  }
}

function fail(error: string): SiResult {
  return {
    success: false, error, z0Ohm: 0, gammaLoad: 0, gammaSource: 0,
    settledVolts: 0, peakVolts: 0, overshootVolts: 0, delayNs: 0, ringing: [],
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Eye diagram
 * ──────────────────────────────────────────────────────────────────────────── */

export interface EyeOptions {
  /** Line rate in megabits per second; one bit is 1000/dataRate ns. */
  dataRateMbps: number
  /** Driver 10–90 % edge duration in nanoseconds. */
  riseTimeNs: number
  /** Horizontal samples per unit interval (default 64, even recommended). */
  samplesPerUi?: number
}

export interface EyeTrajectoryPoint {
  /** Position in the two-UI window, from 0 to 2. */
  phaseUi: number
  volts: number
}

export interface EyeTrajectory {
  bit: 0 | 1
  points: EyeTrajectoryPoint[]
}

export interface EyeResult {
  success: boolean
  error?: string
  bitPeriodNs: number
  /** Vertical opening at the sampling phase, V; zero means closed. */
  eyeHeightVolts: number
  /** Longest phase span inside one UI where every high/low window clears the threshold. */
  eyeWidthNs: number
  eyeWidthUi: number
  /** Lowest sampled high level and highest sampled low level, V. */
  minHighVolts: number
  maxLowVolts: number
  samplePhaseUi: number
  thresholdVolts: number
  trajectories: EyeTrajectory[]
  notes: string[]
}

/** PRBS-7: x⁷ + x⁶ + 1, seeded with ones; 127 bits per cycle. */
const PRBS7_BITS: readonly number[] = (() => {
  const bits = new Array<number>(127).fill(1)
  for (let index = 7; index < bits.length; index += 1) {
    bits[index] = bits[index - 7] ^ bits[index - 6]
  }
  return bits
})()

/**
 * Source NRZ level at time `tNs` for a pattern that starts at t = 0.
 *
 * The edge is linear from the previous bit to the current bit over the full
 * 0→100 % ramp. `riseTimeNs` is the 10–90 % duration, so the full ramp is
 * riseTime/0.8. A rise time longer than one UI is rejected by the caller
 * because this simple edge would then overlap more than one bit boundary.
 */
function sourceLevelAt(
  tNs: number,
  bits: readonly number[],
  bitPeriodNs: number,
  fullRampNs: number,
): number {
  if (tNs <= 0) return 0
  const index = Math.floor(tNs / bitPeriodNs)
  if (index >= bits.length) return bits[bits.length - 1]
  const current = bits[index]
  const previous = index === 0 ? 0 : bits[index - 1]
  if (previous === current) return current
  const intoBit = tNs - index * bitPeriodNs
  if (intoBit >= fullRampNs) return current
  return previous + (current - previous) * (intoBit / fullRampNs)
}

function failEye(error: string, bitPeriodNs = 0): EyeResult {
  return {
    success: false,
    error,
    bitPeriodNs,
    eyeHeightVolts: 0,
    eyeWidthNs: 0,
    eyeWidthUi: 0,
    minHighVolts: 0,
    maxLowVolts: 0,
    samplePhaseUi: 0.5,
    thresholdVolts: 0,
    trajectories: [],
    notes: [],
  }
}

/**
 * Compute an NRZ eye diagram from the same reflection lattice used by
 * `analyzeSignalPath`.
 *
 * The line is linear, so its impulse response is the train of lattice echoes
 * `b_k·δ(t − t_k)`. The load waveform for an arbitrary source pattern is the
 * convolution `Σ b_k·x(t − t_k)`; that makes the eye an exact time-domain
 * result for this model, not a fitted shape. It deliberately excludes
 * crosstalk, random jitter, duty-cycle distortion, driver non-linearity and
 * IBIS V–T behaviour, all of which need an electromagnetic or transistor-level
 * model this module does not have.
 */
export function analyzeEyeDiagram(path: SignalPath, options: EyeOptions): EyeResult {
  const si = analyzeSignalPath(path)
  if (!si.success) return failEye(si.error ?? 'signal path is not valid')

  const { dataRateMbps, riseTimeNs } = options
  const samplesPerUi = options.samplesPerUi ?? 64
  if (!(Number.isFinite(dataRateMbps) && dataRateMbps > 0)) {
    return failEye('data rate must be positive and finite')
  }
  if (!(Number.isFinite(riseTimeNs) && riseTimeNs > 0)) {
    return failEye('rise time must be positive and finite')
  }
  if (!Number.isInteger(samplesPerUi) || samplesPerUi < 8 || samplesPerUi > 512) {
    return failEye('samples per UI must be an integer between 8 and 512')
  }

  const bitPeriodNs = 1000 / dataRateMbps
  const fullRampNs = riseTimeNs / 0.8
  if (fullRampNs > bitPeriodNs) {
    return failEye(
      `the ${riseTimeNs} ns 10–90 % edge is longer than one ${bitPeriodNs.toFixed(3)} ns UI; ` +
        'this eye model requires the edge to finish inside a single bit',
      bitPeriodNs,
    )
  }

  /*
   * Two PRBS-7 cycles plus a leading zero give the pattern enough history for
   * the line delay and the initial 0→1 launch. The leading zero also makes the
   * very first source value well defined.
   */
  const bits = [0, ...PRBS7_BITS, ...PRBS7_BITS]
  const totalTimeNs = (bits.length + 1) * bitPeriodNs
  const maxRounds = Math.min(
    512,
    Math.max(8, Math.ceil(totalTimeNs / Math.max(2 * si.delayNs, 1e-9)) + 4),
  )
  const lattice = buildLattice(path, si.z0Ohm, {
    maxRounds,
    minAmplitudeVolts: Math.max(1e-12, path.vHigh * 1e-12),
  })

  const waveformAt = (tNs: number): number => {
    let volts = 0
    for (const arrival of lattice.arrivals) {
      if (arrival.timeNs > tNs) break
      volts += arrival.gainVolts * sourceLevelAt(tNs - arrival.timeNs, bits, bitPeriodNs, fullRampNs)
    }
    return volts
  }

  /*
   * Skip the first windows until the earliest echo has arrived and the launch
   * has settled; otherwise a long line's eye contains the zero-filled start-up
   * rather than the driven pattern.
   */
  const firstWindow = Math.max(
    1,
    Math.ceil((si.delayNs + fullRampNs) / bitPeriodNs) + 1,
  )
  const windowCount = Math.min(96, bits.length - 2 - firstWindow)
  if (windowCount < 8) {
    return failEye(
      `the ${si.delayNs.toFixed(3)} ns line delay leaves fewer than eight complete bit windows in the ` +
        'simulated PRBS pattern; shorten the line or lower the data rate',
      bitPeriodNs,
    )
  }

  const sampleCount = 2 * samplesPerUi + 1
  const trajectories: EyeTrajectory[] = []
  for (let window = 0; window < windowCount; window += 1) {
    const bitIndex = firstWindow + window
    const points: EyeTrajectoryPoint[] = []
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const phaseUi = sample / samplesPerUi
      const timeNs = (bitIndex + phaseUi) * bitPeriodNs
      points.push({ phaseUi, volts: waveformAt(timeNs) })
    }
    trajectories.push({ bit: bits[bitIndex] as 0 | 1, points })
  }

  const sampleIndex = Math.min(samplesPerUi, Math.floor(samplesPerUi / 2))
  const samplePhaseUi = sampleIndex / samplesPerUi
  let minHigh = Number.POSITIVE_INFINITY
  let maxLow = Number.NEGATIVE_INFINITY
  for (const trajectory of trajectories) {
    const value = trajectory.points[sampleIndex]?.volts ?? 0
    if (trajectory.bit === 1) minHigh = Math.min(minHigh, value)
    else maxLow = Math.max(maxLow, value)
  }
  if (!Number.isFinite(minHigh) || !Number.isFinite(maxLow)) {
    return failEye('the PRBS pattern produced no high/low pair to measure', bitPeriodNs)
  }
  const eyeHeightVolts = Math.max(0, minHigh - maxLow)
  const thresholdVolts = si.settledVolts > 0 ? si.settledVolts / 2 : path.vHigh / 2

  let longestRun = 0
  let currentRun = 0
  for (let phase = 0; phase < samplesPerUi; phase += 1) {
    let high = Number.POSITIVE_INFINITY
    let low = Number.NEGATIVE_INFINITY
    for (const trajectory of trajectories) {
      const value = trajectory.points[phase]?.volts ?? 0
      if (trajectory.bit === 1) high = Math.min(high, value)
      else low = Math.max(low, value)
    }
    const open = high > thresholdVolts && low < thresholdVolts
    currentRun = open ? currentRun + 1 : 0
    if (currentRun > longestRun) longestRun = currentRun
  }
  const eyeWidthNs = (longestRun / samplesPerUi) * bitPeriodNs
  const eyeWidthUi = eyeWidthNs / bitPeriodNs

  const notes: string[] = [
    `NRZ eye from ${lattice.arrivals.length} reflection-lattice arrivals, PRBS-7, ` +
      `${samplesPerUi} samples/UI, ${trajectories.length} two-UI windows.`,
    'Eye width is the longest phase span where every high window stays above and every low window ' +
      'stays below the mid-level threshold. No crosstalk, jitter, duty-cycle distortion, driver ' +
      'non-linearity, or IBIS transient data are included.',
  ]
  if (lattice.truncated) {
    notes.push(
      'Reflections were truncated at the round-trip limit; the line has not fully settled in this eye model.',
    )
  }
  if (eyeHeightVolts <= 0 || eyeWidthNs <= 0) {
    notes.push('The eye is closed at the mid-level threshold for these assumptions.')
  }

  return {
    success: true,
    bitPeriodNs,
    eyeHeightVolts,
    eyeWidthNs,
    eyeWidthUi,
    minHighVolts: minHigh,
    maxLowVolts: maxLow,
    samplePhaseUi,
    thresholdVolts,
    trajectories,
    notes,
  }
}

export interface TraceWidthOptimisation {
  /** Suggested width in millimetres; the original width when unreachable. */
  widthMm: number
  /** Impedance at the suggested width, ohms. */
  z0Ohm: number
  achieved: boolean
  note: string
}

/**
 * Solve for the trace width that hits a target impedance at the existing
 * stackup height. Bisection on the same closed-form impedance used by
 * `analyzeSignalPath`, so the recommendation and the analysis cannot disagree.
 */
export function optimiseTraceWidth(
  path: SignalPath,
  targetOhm: number = 50,
  minWidthMm: number = 0.05,
  maxWidthMm: number = 1,
): TraceWidthOptimisation {
  let currentZ0: number
  try {
    currentZ0 = characteristicImpedance(path.geometry)
  } catch (error) {
    return {
      widthMm: path.geometry.widthMm,
      z0Ohm: Number.NaN,
      achieved: false,
      note: error instanceof Error ? error.message : 'The trace geometry is not physically valid.',
    }
  }
  if (!(Number.isFinite(targetOhm) && targetOhm > 0) || !(minWidthMm > 0) || !(maxWidthMm > minWidthMm)) {
    return {
      widthMm: path.geometry.widthMm,
      z0Ohm: currentZ0,
      achieved: false,
      note: 'Trace-width optimisation needs a positive target impedance and a valid 0 < minWidth < maxWidth range.',
    }
  }
  const copperMm = path.geometry.copperThicknessMm ?? 0.035
  const widthMm = widthForImpedance(
    targetOhm,
    {
      height: path.geometry.heightMm,
      thickness: copperMm,
      er: path.geometry.epsilonR,
      mode: path.geometry.kind,
      spacing: path.geometry.kind === 'stripline'
        ? path.geometry.thicknessMm ?? path.geometry.heightMm
        : undefined,
    },
    minWidthMm,
    maxWidthMm,
  )

  if (widthMm === undefined) {
    return {
      widthMm: path.geometry.widthMm,
      z0Ohm: currentZ0,
      achieved: false,
      note: `A ${targetOhm} Ω target is outside the reachable range at this stackup height (${minWidthMm}–${maxWidthMm} mm width).`,
    }
  }

  const candidate: TraceGeometry = { ...path.geometry, widthMm }
  return {
    widthMm,
    z0Ohm: characteristicImpedance(candidate),
    achieved: true,
    note: `Set the trace to ${widthMm.toFixed(3)} mm for ${targetOhm} Ω at ${path.geometry.heightMm} mm dielectric height.`,
  }
}

