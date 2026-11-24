/**
 * Tissue-scale electrophysiology: excitation that travels, and oscillators that
 * agree.
 *
 * Two things live here, and they are the two things the tissue scale claims.
 *
 * **The cable.** A line of excitable compartments, each one the FitzHugh–Nagumo
 * relaxation oscillator from `excitability.ts`, coupled by a diffusion term built
 * from the axial resistance and membrane capacitance of the strand. A front
 * launched at one end travels, and its speed is measured off the activation times
 * of the cells rather than assumed: `θ ∝ √(D·ε)` is a property of the run, not an
 * input to it. Refining the compartment size must not move the speed, which is
 * what the convergence test checks — a cable whose velocity depends on Δx is a
 * numerical artefact, not tissue. The stimulus is specified in millimetres for
 * exactly that reason, and as a *density*: it is the current per unit length that
 * enters `dv/dt` in every compartment it covers, so refining the mesh leaves both
 * the stimulated length and the total charge alone. A stimulus defined in *cells*
 * changes size when the mesh changes, and then a refinement study measures two
 * different cables. The velocity fit likewise uses only the compartments beyond the
 * stimulus window — the ones under the electrode activate when it charges them, and
 * fitting through them made the measured speed climb 17 % with stimulus amplitude.
 *
 * **The population.** A set of phase oscillators with a spread of natural
 * frequencies, coupled all-to-all. Synchronisation is reported as the order
 * parameter `R = |Σ e^{iθ}|/N`, and a sweep of the coupling is asked the same
 * question mean-field theory answers — where does `R` leave the uncoupled baseline —
 * which puts the onset between two swept values and compares that bracket with
 * `K_c = 2γ` for a Lorentzian spread of half-width γ.
 *
 * Units: the cable is in millimetres and milliseconds, with dimensionless voltage
 * because FitzHugh–Nagumo has no millivolt — `v` is a phase-plane variable. The
 * population is in seconds and hertz.
 *
 * Honest limits
 * -------------
 * - **The cable is a line.** Real myocardium is a sheet, and a sheet has
 *   transverse coupling, anisotropy from fibre rotation, and wavebreak. None of
 *   that is representable here: scroll waves and re-entrant circuits cannot
 *   appear, and a strand's velocity is not a heart's velocity.
 * - **Discrete compartments.** The cable is N cells, not a continuum. A front that
 *   spans only a couple of cells resolves poorly, so the convergence study bounds
 *   the error instead of pretending it is zero. The step ceiling
 *   (`MAX_BIOLOGY_STEPS`) is what caps how fine a strand can be.
 * - **The front has to form.** After the electrode switches off there is an
 *   establishment of a millimetre or two before the wave settles, so the
 *   strand-average speed sits below the terminal speed and still moves a little with
 *   stimulus strength — 0.60 mm/ms at the lowest amplitude that launches here and
 *   0.69 at ten times that. It does not move with the mesh, which is the claim the
 *   convergence test makes; to ask about the settled front, fit a slice of the
 *   activation times with `activationWaveSpeed`.
 * - **No fibrosis, no vessels, no gap-junction dynamics.** Coupling is one
 *   diffusivity, constant in space and time. Real junctions rectify and uncouple
 *   ischaemically.
 * - **FitzHugh–Nagumo kinetics.** The upstroke shape, the ion currents and the
 *   restitution curves of a real cell are not here; refractoriness is topological,
 *   not ionic. Velocity in these units cannot be converted to a clinical conduction
 *   velocity without a calibration this model does not have.
 * - **Spike height is not constant along the strand.** A FitzHugh–Nagumo upstroke
 *   carries whatever recovery variable it finds, and a front that crosses in a time
 *   comparable to the recovery time constant finds a different one in every
 *   compartment: 1.60 in this model's voltage units near the electrode and 1.79 at the
 *   sealed far end, of which about one percent is owed to the launch strength.
 *   Excitation is still all-or-none in the sense that matters — a compartment either
 *   reaches that band or stays under the threshold — but this is not a model to ask
 *   about action-potential *shapes*.
 * - **The population is phase-reduced.** Kuramoto assumes weak coupling and
 *   ignores each oscillator's waveform, so it describes locking and desync, not
 *   spike-timing precision or pacemaker suppression.
 * - **Sealed ends.** Both ends of the strand carry zero axial flux, so a wave
 *   reaching the far end stops there instead of re-entering.
 */

import { EXCITABLE_FITZHUGH_NAGUMO, fitzhughNagumoReactionInto, type FitzHughNagumoParameters } from './excitability'
import {
  integrateModel,
  requireFinite,
  requireNonNegative,
  requirePositive,
  type BiologyWindow,
} from './modelSupport'

/* ------------------------------------------------------------------ *
 * Cable geometry and conduction
 * ------------------------------------------------------------------ */

/**
 * Axial diffusivity of a strand from its per-length cable constants.
 *
 * `D = 1/(r_a·c_m)` is in mm²/s when resistance is per millimetre and capacitance
 * is per millimetre (1/(Ω·F) = 1/s), and the /1000 moves it to the mm²/ms the run
 * is integrated in. This is the only place real units enter the cable: after it,
 * voltage is dimensionless and only length and time are physical.
 */
export function cableDiffusivity(
  axialResistanceOhmsPerMillimeter: number,
  membraneCapacitanceFaradsPerMillimeter: number,
): number {
  requirePositive(axialResistanceOhmsPerMillimeter, 'Axial resistance per unit length')
  requirePositive(membraneCapacitanceFaradsPerMillimeter, 'Membrane capacitance per unit length')
  return 1 / (axialResistanceOhmsPerMillimeter * membraneCapacitanceFaradsPerMillimeter) / 1000
}

export interface CableOptions {
  /** Strand length, mm. */
  lengthMm: number
  /** Compartment count. The compartment size is `lengthMm / cells`. */
  cells: number
  /** Diffusivity D, mm²/ms — see `cableDiffusivity`. */
  diffusivityMm2PerMs: number
  /** Local kinetics. Defaults to the classical excitable pair. */
  kinetics?: FitzHughNagumoParameters
  /**
   * Current density injected into every compartment inside the stimulus window.
   *
   * It is a per-length source, not a per-cell one: the compartment value enters
   * `dv/dt` directly, so refining the mesh adds the same density over more
   * compartments and the total charge stays `amplitude × stimulusLengthMm`. That is
   * what lets a mesh study hold the stimulus fixed instead of quietly changing it.
   */
  stimulusAmplitude: number
  /** Physical stimulus length from the near end, mm — not a cell count. */
  stimulusLengthMm: number
  stimulusDurationMs: number
  /** Voltage above which a compartment counts as activated. */
  activationThreshold?: number
}

export interface CableActivation {
  cellIndex: number
  positionMm: number
  /** First upward crossing of the activation threshold, ms. */
  activationTimeMs: number
  /** The highest voltage this compartment reaches in the whole run, not its crossing. */
  peakVoltage: number
}

export interface CableCellTrace {
  timeMs: number
  /** Voltage of every compartment at this instant. */
  voltages: number[]
}

export interface CableResult {
  compartmentSizeMm: number
  /** Resting voltage the initial condition was built from. */
  restingVoltage: number
  /** Compartments the stimulus window covered, which a finer mesh resolves better. */
  stimulatedCells: number
  activations: CableActivation[]
  traces: CableCellTrace[]
  /**
   * Least-squares fit of activation time against position, mm/ms, over the
   * compartments the wave conducted to. Null if fewer than three of them fired.
   */
  velocityMmPerMs: number | null
  /** Millimetres the front reached before stopping, or null if it crossed the strand. */
  blockedAfterMm: number | null
  activatedCells: number
}

/**
 * The stable rest of the relaxation oscillator, found from its own parameters.
 *
 * The nullclines cross where `b·(v − v³/3) = v + a`, a cubic with one or three
 * real roots. Only a root on an outer branch is stable — the middle branch is the
 * threshold — so candidates are bracketed on a scan and bisected, and the stable
 * negative one is the resting state. A parameter set with no stable root is
 * self-oscillating, and this says so instead of handing back a point that would
 * drift and calling it rest.
 */
export function fitzhughNagumoRest(parameters: FitzHughNagumoParameters): { v: number; w: number } {
  const { epsilon, a, b } = parameters
  requirePositive(epsilon, 'FitzHugh–Nagumo timescale ratio')
  requirePositive(b, 'FitzHugh–Nagumo recovery coefficient')
  const cubic = (v: number): number => b * (v - v ** 3 / 3) - (v + a)
  const roots: number[] = []
  const span = 6
  const brackets = 4000
  let previous = -span
  let previousValue = cubic(previous)
  for (let i = 1; i <= brackets; i += 1) {
    const current = -span + (2 * span * i) / brackets
    const value = cubic(current)
    if (previousValue === 0) roots.push(previous)
    else if (Math.sign(value) !== Math.sign(previousValue)) {
      let low = previous
      let high = current
      for (let step = 0; step < 60; step += 1) {
        const middle = (low + high) / 2
        if (Math.sign(cubic(middle)) === Math.sign(cubic(low))) low = middle
        else high = middle
      }
      roots.push((low + high) / 2)
    }
    previous = current
    previousValue = value
  }
  // The Jacobian is `[[1−v², −1], [ε, −εb]]`, so the crossing is a stable node or
  // spiral only where the trace is negative, `v² > 1 − εb`, AND the determinant is
  // positive, `v² > (b−1)/b`. With `b > 1` and a small `ε` the determinant wins, and
  // the middle-branch crossing satisfies the trace alone; taking that as rest hands
  // the cable a saddle, which runs away from instead of sitting in.
  const stabilityFloor = Math.max(1 - epsilon * b, (b - 1) / b)
  const stable = roots.filter((v) => v * v > stabilityFloor)
  const rest = stable.filter((v) => v < 0).sort((x, y) => y - x)[0] ?? stable.sort((x, y) => x - y)[0]
  if (rest === undefined || !Number.isFinite(rest)) {
    throw new Error(
      'These FitzHugh–Nagumo parameters have no stable resting point, so a cable built from them ' +
        'oscillates everywhere instead of conducting. Change a, b or epsilon.',
    )
  }
  return { v: rest, w: (rest + a) / b }
}

/**
 * Stimulate one end of a cable and measure what the front does.
 *
 * State layout is `[v₀, w₀, v₁, w₁, …]`. The internal step is sized from
 * `Δx²/(2D)`, the diffusion relaxation of the fastest spatial mode, which is why
 * a fine strand costs so many steps: halving the compartment size quarters the
 * time constant, and `MAX_BIOLOGY_STEPS` then refuses the run rather than letting
 * it integrate unstably.
 */
export function simulateCable(options: CableOptions, window: BiologyWindow): CableResult {
  const { lengthMm, cells, diffusivityMm2PerMs, stimulusAmplitude, stimulusLengthMm, stimulusDurationMs } = options
  requirePositive(lengthMm, 'Cable length')
  if (!Number.isInteger(cells) || cells < 3) {
    throw new Error(`A cable needs at least three compartments to conduct (got ${cells}).`)
  }
  requirePositive(diffusivityMm2PerMs, 'Cable diffusivity')
  requireFinite(stimulusAmplitude, 'Stimulus amplitude')
  requirePositive(stimulusLengthMm, 'Stimulus length')
  requirePositive(stimulusDurationMs, 'Stimulus duration')
  const kinetics = options.kinetics ?? EXCITABLE_FITZHUGH_NAGUMO
  const threshold = options.activationThreshold ?? 0
  requireFinite(threshold, 'Activation threshold')

  const dx = lengthMm / cells
  const rest = fitzhughNagumoRest(kinetics)
  const stimulatedCells = Math.min(cells, Math.max(1, Math.round(stimulusLengthMm / dx)))
  const initial: number[] = []
  for (let i = 0; i < cells; i += 1) initial.push(rest.v, rest.w)

  // The reaction is written straight into the flat state vector. Going through
  // `fitzhughNagumoDerivative` per compartment would build two arrays per
  // compartment per stage — 160 allocations per derivative call on a 40-cell
  // strand, times the tens of thousands of calls in a run. The stimulus stays a
  // property of the compartment, so it is applied where the compartment is.
  const dx2 = dx * dx
  const derivative = (time: number, state: readonly number[]): number[] => {
    const out = new Array<number>(state.length)
    const stimulusOn = time < stimulusDurationMs ? stimulusAmplitude : 0
    // Clamping the neighbour index into range is the zero-flux (sealed) end: the
    // ghost compartment takes the boundary cell's own voltage. Reading the two
    // neighbours inline keeps that clamp without a closure per call.
    for (let i = 0; i < cells; i += 1) {
      const v = state[2 * i]!
      const w = state[2 * i + 1]!
      const left = i === 0 ? v : state[2 * i - 2]!
      const right = i === cells - 1 ? v : state[2 * i + 2]!
      fitzhughNagumoReactionInto(kinetics, v, w, i < stimulatedCells ? stimulusOn : 0, out, 2 * i)
      out[2 * i] = out[2 * i]! + diffusivityMm2PerMs * ((left - 2 * v + right) / dx2)
    }
    return out
  }

  const diffusionTau = (dx * dx) / (2 * diffusivityMm2PerMs)
  const kineticTau = Math.min(1, kinetics.epsilon)
  const samples = integrateModel(derivative, initial, window, Math.min(diffusionTau, kineticTau))

  const traces: CableCellTrace[] = samples.map((sample) => ({
    timeMs: sample.time,
    voltages: sample.state.filter((_, index) => index % 2 === 0),
  }))

  // The two passes are separate because the peak an activated cell reaches comes
  // after its crossing: reading it at the crossing would report the threshold
  // value and call it the upstroke.
  const crossingTimeMs = new Array<number>(cells).fill(Number.POSITIVE_INFINITY)
  for (const trace of traces) {
    for (let i = 0; i < cells; i += 1) {
      if (trace.voltages[i]! > threshold && crossingTimeMs[i]! === Number.POSITIVE_INFINITY) {
        crossingTimeMs[i] = trace.timeMs
      }
    }
  }

  const peakVoltage = new Array<number>(cells)
  for (let i = 0; i < cells; i += 1) {
    let highest = rest.v
    for (const trace of traces) if (trace.voltages[i]! > highest) highest = trace.voltages[i]!
    peakVoltage[i] = highest
  }

  const activations: CableActivation[] = []
  for (let i = 0; i < cells; i += 1) {
    const crossed = crossingTimeMs[i]!
    if (!Number.isFinite(crossed)) continue
    activations.push({
      cellIndex: i,
      positionMm: i * dx,
      activationTimeMs: crossed,
      peakVoltage: peakVoltage[i]!,
    })
  }

  // Only cells the wave *reached* time the front. The compartments under the
  // electrode cross when the stimulus charges them, which is a property of the
  // stimulus, so fitting through them makes the reported velocity rise with
  // stimulus amplitude — up to 17 % over the range that launches here. Fitting the
  // rest of the strand is what makes the speed a property of the cable.
  const conducted = activations.filter((activation) => activation.cellIndex >= stimulatedCells)
  const velocity = conducted.length >= 3 ? activationWaveSpeed(conducted) : null
  const last = activations[activations.length - 1]
  const reached = last ? last.positionMm : 0
  const crossedStrand = last ? last.cellIndex === cells - 1 : false
  return {
    compartmentSizeMm: dx,
    restingVoltage: rest.v,
    stimulatedCells,
    activations,
    traces,
    velocityMmPerMs: velocity,
    blockedAfterMm: crossedStrand ? null : reached,
    activatedCells: activations.length,
  }
}

/**
 * Conduction velocity from activation times: the least-squares slope of time
 * against position, inverted.
 *
 * A fit is used rather than (last − first)/(first − last) because a front entering
 * a region of different coupling accelerates, and a two-point speed would report
 * one number for two different cables. Cells that never activate are absent from
 * `activations`, so the fit cannot be drawn through them.
 *
 * Which cells belong in the fit is the caller's decision, and it is not a small
 * one: `simulateCable` hands over only the compartments beyond the stimulus window,
 * because the ones under an electrode activate when it charges them.
 */
export function activationWaveSpeed(activations: readonly CableActivation[]): number | null {
  const usable = activations.filter((activation) => Number.isFinite(activation.activationTimeMs))
  if (usable.length < 2) return null
  const n = usable.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (const activation of usable) {
    sumX += activation.positionMm
    sumY += activation.activationTimeMs
    sumXY += activation.positionMm * activation.activationTimeMs
    sumXX += activation.positionMm * activation.positionMm
  }
  const denominator = n * sumXX - sumX * sumX
  if (Math.abs(denominator) < 1e-12) return null
  const slopeMsPerMm = (n * sumXY - sumX * sumY) / denominator
  if (!(slopeMsPerMm > 0)) {
    throw new Error(
      `Activation times do not increase along the cable (slope ${slopeMsPerMm} ms/mm): the front is ` +
        'travelling backwards, or the run never launched it and there is no wave to time.',
    )
  }
  return 1 / slopeMsPerMm
}

/* ------------------------------------------------------------------ *
 * Coupled oscillators
 * ------------------------------------------------------------------ */

/**
 * Evenly spaced quantile sample of a Lorentzian frequency spread.
 *
 * Quantiles rather than a random draw: `ω_i = ω₀ + γ·tan(π((i+½)/N) − π/2)` is
 * reproducible, and the critical coupling is found by sweeping this population and
 * comparing against `K_c = 2γ`. A fresh random draw per call would make the
 * measured and predicted numbers disagree for reasons that are sampling, not
 * model.
 */
export function lorentzianFrequencies(centerHertz: number, halfWidthHertz: number, count: number): number[] {
  requirePositive(centerHertz, 'Central frequency')
  requirePositive(halfWidthHertz, 'Frequency half-width')
  if (!Number.isInteger(count) || count < 2) {
    throw new Error(`A population needs at least two oscillators (got ${count}).`)
  }
  const out: number[] = []
  for (let i = 0; i < count; i += 1) {
    out.push(centerHertz + halfWidthHertz * Math.tan(Math.PI * ((i + 0.5) / count - 0.5)))
  }
  return out.sort((a, b) => a - b)
}

export interface OscillatorSample {
  timeSecond: number
  /** Kuramoto order parameter: 0 is incoherent, 1 is fully locked. */
  orderParameter: number
  /** Mean phase of the population, radians. */
  meanPhaseRadians: number
  phasesRadians: number[]
}

export interface OscillatorResult {
  samples: OscillatorSample[]
  naturalFrequenciesHz: number[]
  couplingHertz: number
  /** `2γ` for the spread actually integrated — the mean-field onset of locking. */
  predictedCriticalCouplingHz: number
  /** Order parameter averaged over the last third of the run. */
  steadyStateOrder: number
  /** Oscillators still more than a quarter-turn from the mean at the end. */
  unlockedFrequenciesHz: number[]
}

function meanField(phases: readonly number[]): { r: number; meanPhaseRadians: number } {
  let real = 0
  let imaginary = 0
  for (const phase of phases) {
    real += Math.cos(phase)
    imaginary += Math.sin(phase)
  }
  return {
    r: Math.hypot(real, imaginary) / phases.length,
    meanPhaseRadians: Math.atan2(imaginary, real),
  }
}

/** `R = |Σ e^{iθ}|/N` and the mean phase it is measured against. */
export function orderParameter(phases: readonly number[]): { r: number; meanPhaseRadians: number } {
  if (phases.length === 0) throw new Error('Order parameter needs at least one phase.')
  for (const phase of phases) requireFinite(phase, 'Oscillator phase')
  return meanField(phases)
}

/**
 * Half-width at half-maximum of a sampled frequency set, read off the sample.
 *
 * For a Lorentzian the density halves at ±γ from the centre, and the share of the
 * population inside ±γ is exactly `(2/π)·atan(1) = ½`. So γ is the radius of the
 * window around the median that holds half the oscillators, which is what the
 * sorted absolute deviations give directly. Estimating it from the frequencies
 * actually integrated keeps the `K_c = 2γ` prediction honest for a truncated
 * quantile sample instead of quoting the γ that was asked for.
 */
export function empiricalHalfWidthHertz(frequencies: readonly number[]): number {
  if (frequencies.length < 2) throw new Error('Need at least two frequencies to estimate a spread.')
  const sorted = [...frequencies].sort((a, b) => a - b)
  const center = sorted[Math.floor((sorted.length - 1) / 2)]!
  const deviations = sorted.map((frequency) => Math.abs(frequency - center)).sort((a, b) => a - b)
  const half = Math.max(0, Math.floor(deviations.length / 2) - 1)
  return Math.max(deviations[half] ?? deviations[0]!, 1e-9)
}

/**
 * Integrate a phase-coupled population.
 *
 * All-to-all coupling collapses onto the mean field exactly —
 * `(K/N)·Σ sin(θ_j − θ_i) = K·R·sin(ψ − θ_i)` — so the derivative costs O(N)
 * instead of O(N²) and computes the same thing. The internal step is sized from
 * the fastest of the two rates present: the pull toward the mean (`1/K`) and the
 * frequency spread itself (`1/spread`).
 *
 * The default start — one phase every `2π/N` — is an *exact* unstable equilibrium
 * when every oscillator shares a frequency: at perfectly equal spacing the pull on
 * each oscillator is zero, so `R` sits at 0 until round-off grows large enough to
 * break the symmetry, which here takes about twenty-five seconds of a forty-second
 * run. Anything that wants an incoherent start on identical clocks should pass
 * `initialPhasesRadians` with the spacing broken; a spread of natural frequencies
 * breaks it by itself.
 */
export function simulateOscillatorPopulation(
  options: {
    naturalFrequenciesHz: readonly number[]
    initialPhasesRadians?: readonly number[]
    couplingHertz: number
  },
  window: BiologyWindow,
): OscillatorResult {
  const frequencies = [...options.naturalFrequenciesHz]
  if (frequencies.length < 2) throw new Error('A population needs at least two oscillators.')
  for (const frequency of frequencies) requireFinite(frequency, 'Natural frequency')
  requireNonNegative(options.couplingHertz, 'Coupling strength')
  const phases =
    options.initialPhasesRadians ?? frequencies.map((_, index) => (2 * Math.PI * index) / frequencies.length)
  if (phases.length !== frequencies.length) {
    throw new Error('Every oscillator needs one phase; the arrays are different lengths.')
  }
  for (const phase of phases) requireFinite(phase, 'Oscillator phase')

  const coupling = options.couplingHertz * 2 * Math.PI
  const omega = frequencies.map((frequency) => frequency * 2 * Math.PI)

  const derivative = (_time: number, state: readonly number[]): number[] => {
    const { r, meanPhaseRadians } = meanField(state)
    return state.map((phase, index) => omega[index]! + coupling * r * Math.sin(meanPhaseRadians - phase))
  }

  const relaxationTau =
    options.couplingHertz > 0 ? 1 / (2 * Math.PI * options.couplingHertz) : Number.POSITIVE_INFINITY
  const spread = Math.max(...frequencies) - Math.min(...frequencies)
  const frequencyTau = spread > 0 ? 1 / spread : Number.POSITIVE_INFINITY
  const samples = integrateModel(derivative, phases, window, Math.min(relaxationTau, frequencyTau))

  const reported = samples.map<OscillatorSample>((sample) => {
    const { r, meanPhaseRadians } = meanField(sample.state)
    return { timeSecond: sample.time, orderParameter: r, meanPhaseRadians, phasesRadians: [...sample.state] }
  })

  // The last third, not the last two thirds: an average over the second half of a
  // run that only settled in its final seconds would report a lock that the
  // population spent most of its steady state without.
  const tail = reported.slice(Math.ceil((reported.length * 2) / 3))
  let orderTotal = 0
  for (const sample of tail) orderTotal += sample.orderParameter
  const final = reported[reported.length - 1]!
  const unlocked = frequencies.filter((_, index) => {
    const delta = final.phasesRadians[index]! - final.meanPhaseRadians
    return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) > Math.PI / 2
  })

  return {
    samples: reported,
    naturalFrequenciesHz: frequencies,
    couplingHertz: options.couplingHertz,
    predictedCriticalCouplingHz: 2 * empiricalHalfWidthHertz(frequencies),
    steadyStateOrder: tail.length > 0 ? orderTotal / tail.length : final.orderParameter,
    unlockedFrequenciesHz: unlocked,
  }
}

/**
 * Order parameter against coupling, for finding where the population locks.
 *
 * Each coupling is a fresh integration from the same initial phases, so the curve
 * is a property of the coupling alone. The reported number is the coupling at which
 * the settled order first reaches `lockLevel`, linearly interpolated across the
 * bracketing pair — a level crossing limited by the sweep spacing, which is why the
 * spacing comes back with it. It is deliberately not called the critical coupling:
 * mean-field theory puts the *onset* of locking at `K_c = 2γ`, and just above an
 * onset of that kind the order parameter grows as `√(K − K_c)`, so any level far
 * above zero is crossed well past it. Measured here at `lockLevel` 0.5 that lands at
 * 0.33–0.36 Hz against an onset of 0.197 Hz — the same physics, two different
 * questions. The bracketed test asks the right one.
 */
export function synchronisationCurve(options: {
  naturalFrequenciesHz: readonly number[]
  initialPhasesRadians?: readonly number[]
  couplingsHertz: readonly number[]
  window: BiologyWindow
  lockLevel?: number
}): {
  points: { couplingHertz: number; orderParameter: number }[]
  /** Coupling where the settled order first reaches `lockLevel`, interpolated. */
  couplingAtLockLevelHertz: number | null
  sweepSpacingHertz: number | null
} {
  const couplings = [...options.couplingsHertz]
  if (couplings.length < 2) throw new Error('A synchronisation curve needs at least two coupling values.')
  const lockLevel = options.lockLevel ?? 0.5
  if (!(lockLevel > 0 && lockLevel < 1)) throw new Error('Lock level must lie between 0 and 1.')
  const points = couplings.map((coupling) => ({
    couplingHertz: coupling,
    orderParameter: simulateOscillatorPopulation(
      {
        naturalFrequenciesHz: options.naturalFrequenciesHz,
        initialPhasesRadians: options.initialPhasesRadians,
        couplingHertz: coupling,
      },
      options.window,
    ).steadyStateOrder,
  }))
  let reached: number | null = null
  for (let i = 1; i < points.length; i += 1) {
    const before = points[i - 1]!
    const after = points[i]!
    if (before.orderParameter < lockLevel && after.orderParameter >= lockLevel) {
      const fraction = (lockLevel - before.orderParameter) / (after.orderParameter - before.orderParameter)
      reached = before.couplingHertz + fraction * (after.couplingHertz - before.couplingHertz)
      break
    }
  }
  const spacing = points[1]!.couplingHertz - points[0]!.couplingHertz
  return { points, couplingAtLockLevelHertz: reached, sweepSpacingHertz: Number.isFinite(spacing) ? spacing : null }
}

export interface CablePreset {
  id: string
  name: string
  note: string
  cable: CableOptions
  window: BiologyWindow
}

/**
 * A 5 mm strand, 40 compartments, coupled at D = 0.5 mm²/ms.
 *
 * The front in these units is `D/θ` wide — about 0.8 mm at the measured 0.63 mm/ms
 * — so 40 compartments give it roughly six cells per front, which is enough for the
 * speed to be a property of the cable and not of the mesh: the same stimulus on 20,
 * 40 and 80 compartments measures 0.637, 0.635 and 0.639 mm/ms.
 *
 * The stimulus is 4 units of current density over 0.25 mm for 2 ms. That is not a
 * round number, it is a calibration: on this strand a 2 ms pulse launches a crossing
 * wave somewhere between 2.5 and 3, and nothing at 2 or below, so 4 carries a safety
 * factor of about 1.4 over the lowest amplitude that conducts.
 */
export const FAST_STRAND_CABLE: CableOptions = {
  lengthMm: 5,
  cells: 40,
  diffusivityMm2PerMs: 0.5,
  kinetics: EXCITABLE_FITZHUGH_NAGUMO,
  stimulusAmplitude: 4,
  stimulusLengthMm: 0.25,
  stimulusDurationMs: 2,
}

export const TISSUE_PRESETS: readonly CablePreset[] = [
  {
    id: 'conducting-strand',
    name: 'Conducting strand',
    note: '5 mm of excitable cable in 40 compartments, coupled at 0.5 mm²/ms and stimulated at one '
      + 'end. Every compartment fires and the front crosses in about 8 ms; the velocity is the '
      + 'least-squares fit of the activation times of the compartments it conducted to, 0.64 mm/ms.',
    cable: FAST_STRAND_CABLE,
    window: { tEnd: 12, dt: 0.05 },
  },
  {
    id: 'slow-strand',
    name: 'Weakly coupled strand',
    note: 'The same strand with the axial diffusivity cut to 0.125 mm²/ms, four times less coupling. '
      + 'Speed tracks the coupling as θ ∝ √D: the fit gives 0.30 mm/ms against the 0.32 that the law '
      + 'predicts, and the far end fires at 15 ms instead of 8.',
    cable: { ...FAST_STRAND_CABLE, diffusivityMm2PerMs: 0.125, cells: 80 },
    window: { tEnd: 30, dt: 0.1 },
  },
  {
    id: 'subthreshold-block',
    name: 'Sub-threshold stimulus: block',
    note: 'The same strand with the same 2 ms pulse at half the amplitude — 2 instead of 4, which is '
      + 'below what this mesh needs to launch. The stimulus charges the first compartments and the '
      + 'axial load of the resting strand drains it: no compartment reaches the knee of its own fast '
      + 'nullcline, nothing beyond the 0.25 mm window fires, and there is no wave to time.',
    cable: { ...FAST_STRAND_CABLE, stimulusAmplitude: 2 },
    window: { tEnd: 12, dt: 0.05 },
  },
]

/**
 * A hundred pacemakers spread ±0.1 Hz about 1 Hz, coupled at twice the measured
 * locking threshold.
 */
export const PACEMAKER_POPULATION = {
  naturalFrequenciesHz: lorentzianFrequencies(1, 0.1, 100),
  couplingHertz: 0.4,
}

/** The same population with coupling under the threshold: it never agrees on a phase. */
export const INCOHERENT_POPULATION = {
  naturalFrequenciesHz: PACEMAKER_POPULATION.naturalFrequenciesHz,
  couplingHertz: 0.05,
}
