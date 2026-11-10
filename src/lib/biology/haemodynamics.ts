/**
 * Haemodynamics: the circulation as a lumped fluid circuit.
 *
 * The organ scale of the biology domain is where Folio's electrical vocabulary
 * stops being an analogy. A Windkessel artery *is* an RC low-pass: compliance
 * stores volume the way a capacitor stores charge, systemic resistance dissipates
 * the way a resistor does, and the pressure–flow relation is Ohm's law with the
 * units changed. So this module is written against the same first-order machinery
 * the control and electronics domains use, and its results are auditable by
 * `stepResponseMetrics` and by an input-impedance curve rather than only by
 * whether the plot "looks like a pulse".
 *
 * Models
 * ------
 * - 2- and 3-element Windkessel: `C·dP/dt = Q − P/R`, with an optional series
 *   characteristic impedance `Zc` so the measured aortic pressure is
 *   `P + Zc·Q`. The diastolic decay is exactly `e^(−t/RC)`; the flow-to-pressure
 *   transfer function is `R/(1 + jωRC)` (`Zc` in series on top), and
 *   `arterialInputImpedance` gives it in closed form.
 * - Time-varying elastance ventricle driving that artery through two diode
 *   valves: `P_lv = E(t)·max(V − V0, 0)` with `E` a smooth periodic pulse, mitral
 *   inflow from a fixed atrial pressure, aortic outflow into the Windkessel.
 * - Starling capillary exchange: filtration driven by the hydrostatic–oncotic
 *   balance `NFP = (Pc − Pi) − σ(πc − πi)`.
 *
 * Units: mmHg, mL, seconds, mL/s, mL/mmHg, mmHg·s/mL. One call stays inside them.
 *
 * Honest limits
 * -------------
 * This is a *lumped* model: four chambers become one elastance and one resistor,
 * so there is no septum, no pericardium, no regional wall motion, no valve anatomy
 * and no murmurs. A ventricular assist device or a prosthetic valve cannot be
 * designed against it. The atrium is a pressure source, so the pulmonary
 * circulation, right heart and venous return are absent — preload is an input, not
 * a result. Veins are not compliant, so nothing here can model a Valsalva
 * manoeuvre, haemorrhage compensation or baroreflex; those need the venous compartment
 * this model hands you a fixed `leftAtrialPressure` instead of. Valves are ideal
 * diodes with a large reverse resistance: a kink in the vector field at every open
 * and close, which is why the reverse leak is reported rather than hidden, and why
 * a leaky valve is modelled by lowering the reverse resistance, not by adding
 * regurgitant orifice physics. The elastance shape is a sinusoid-squared, not a
 * measured human E(t). And the whole thing is a left heart driving one resistor:
 * it gives flow, pressure and work — never tissue perfusion distribution, which is
 * the pipe-network solver's job in the mechanical domain. Two consequences are worth
 * knowing before reading a plot: the preload relation this elastance gives is a
 * straight line with no length-dependent saturation (the tests measure its slope and
 * its zero curvature), so this heart dilates for as long as the atrial pressure is
 * raised; and the stroke volume in `BeatMetrics` is the *gross* ventricular output,
 * which overstates what reaches the body when a valve regurgitates — hence the
 * `forwardVolume` and `regurgitantVolume` reported next to it.
 */

import { integrateModel, requireFraction, requireNonNegative, requirePositive, type BiologyWindow } from './modelSupport'

/* ------------------------------------------------------------------ *
 * Windkessel arteries
 * ------------------------------------------------------------------ */

export interface WindkesselParameters {
  /** Peripheral (systemic) resistance, mmHg·s/mL. */
  resistance: number
  /** Arterial compliance, mL/mmHg. */
  compliance: number
  /** Series characteristic impedance, mmHg·s/mL. Zero gives the 2-element model. */
  characteristicImpedance?: number
  /** Downstream (venous) pressure the resistor drains into, mmHg. */
  venousPressure?: number
}

export function windkesselTimeConstant(parameters: WindkesselParameters): number {
  requirePositive(parameters.resistance, 'Vascular resistance')
  requirePositive(parameters.compliance, 'Arterial compliance')
  requireNonNegative(parameters.characteristicImpedance ?? 0, 'Characteristic impedance')
  return parameters.resistance * parameters.compliance
}

/**
 * Free decay of an artery that stops being fed: `P(t) = Pv + (P0 − Pv)·e^(−t/RC)`.
 * Kept analytic so the integrator has something exact to be measured against.
 */
export function windkesselDecayPressure(
  parameters: WindkesselParameters,
  initialPressure: number,
  timeSeconds: number,
): number {
  const pv = parameters.venousPressure ?? 0
  const tau = windkesselTimeConstant(parameters)
  requireNonNegative(timeSeconds, 'Time')
  return pv + (initialPressure - pv) * Math.exp(-timeSeconds / tau)
}

/** Pressure and flow through a Windkessel fed by a prescribed inflow. */
export interface WindkesselSample {
  time: number
  /** Distential (compliant-chamber) pressure, mmHg. */
  arterialPressure: number
  /** Pressure at the inlet, i.e. what a catheter in the aortic root reads. */
  inputPressure: number
  /** Prescribed inflow, mL/s. */
  inflow: number
}

export function simulateWindkessel(
  parameters: WindkesselParameters,
  initialPressure: number,
  inflow: (timeSeconds: number) => number,
  window: BiologyWindow,
): WindkesselSample[] {
  const zc = parameters.characteristicImpedance ?? 0
  const pv = parameters.venousPressure ?? 0
  const tau = windkesselTimeConstant(parameters)
  requireNonNegative(initialPressure, 'Initial pressure')
  const samples = integrateModel(
    (time, state) => [(inflow(time) - (state[0] - pv) / parameters.resistance) / parameters.compliance],
    [initialPressure],
    window,
    // The resistor–capacitor decay is the only relaxation the state has.
    tau,
  )
  return samples.map((sample) => ({
    time: sample.time,
    arterialPressure: sample.state[0],
    inputPressure: sample.state[0] + zc * inflow(sample.time),
    inflow: inflow(sample.time),
  }))
}

export interface ImpedancePoint {
  frequencyHz: number
  /** |Z|, mmHg·s/mL — pressure amplitude per unit flow amplitude. */
  magnitude: number
  /** Phase of pressure over flow, degrees; positive means pressure leads. */
  phaseDegrees: number
}

/**
 * Input impedance of the arterial load, `Z(ω) = Zc + R/(1 + jωRC)`.
 *
 * Two limits worth reading off a plot: at DC the capacitor is open and every bit
 * of resistance shows (`|Z| = R + Zc`); well above `1/(2πRC)` the capacitor shorts
 * the resistor out and the resistor's own contribution falls off as `1/(ωRC)`. With
 * `Zc = 0` that is the whole story, and pressure lags flow by 90°. With `Zc` in
 * series the magnitude floors at `Zc` instead of falling, and the phase comes back
 * towards 0° — the resistor's lag is shunted by a real part that has none. So a
 * pulse-pressure claim has to name both the heart rate and the `Zc` it was made with.
 */
export function arterialInputImpedance(parameters: WindkesselParameters, frequencyHz: number): ImpedancePoint {
  requirePositive(frequencyHz, 'Frequency')
  const zc = parameters.characteristicImpedance ?? 0
  const omega = 2 * Math.PI * frequencyHz
  const rc = windkesselTimeConstant(parameters)
  // Zc + R/(1 + jωRC), written as real and imaginary parts.
  const denominator = 1 + (omega * rc) ** 2
  const real = zc + parameters.resistance / denominator
  const imaginary = -parameters.resistance * (omega * rc) / denominator
  return {
    frequencyHz,
    magnitude: Math.hypot(real, imaginary),
    phaseDegrees: (Math.atan2(imaginary, real) * 180) / Math.PI,
  }
}

/* ------------------------------------------------------------------ *
 * The ventricle, its valves and the load they see
 * ------------------------------------------------------------------ */

export interface CirculationParameters extends WindkesselParameters {
  /** Beat period, s. Heart rate in bpm is `60 / beatPeriod`. */
  beatPeriod: number
  /** Fraction of the beat spent in systole, 0…1. */
  systoleFraction: number
  /** End-diastolic elastance, mmHg/mL — the relaxed ventricle's stiffness. */
  elastanceMin: number
  /** Peak systolic elastance, mmHg/mL — the contractility knob. */
  elastanceMax: number
  /** Volume at which the chamber develops no pressure, mL. */
  unstressedVolume: number
  /** Left atrial pressure, mmHg — this model's preload. */
  leftAtrialPressure: number
  /** Mitral valve resistance, mmHg·s/mL. */
  mitralResistance: number
  /** Aortic valve resistance, mmHg·s/mL. */
  aorticResistance: number
  /**
   * Reverse-gradient resistance as a multiple of the forward one. Finite, because
   * an ideal diode is a discontinuity; a real regurgitant valve is modelled by
   * lowering this, not by adding orifice physics.
   */
  reverseLeakFactor?: number
}

/** Smooth, C¹, periodic elastance: sin² rise and fall inside systole, flat in diastole. */
export function ventricularElastance(parameters: Pick<CirculationParameters, 'beatPeriod' | 'systoleFraction' | 'elastanceMin' | 'elastanceMax'>, timeSeconds: number): number {
  requirePositive(parameters.beatPeriod, 'Beat period')
  if (parameters.systoleFraction <= 0 || parameters.systoleFraction >= 1) throw new Error('Systole fraction must lie strictly between 0 and 1.')
  const phase = ((timeSeconds % parameters.beatPeriod) + parameters.beatPeriod) % parameters.beatPeriod
  if (phase >= parameters.systoleFraction * parameters.beatPeriod) return parameters.elastanceMin
  const within = phase / (parameters.systoleFraction * parameters.beatPeriod)
  const rise = Math.sin(Math.PI * within) ** 2
  return parameters.elastanceMin + (parameters.elastanceMax - parameters.elastanceMin) * rise
}

export interface CirculationSample {
  time: number
  leftVentricularVolume: number
  leftVentricularPressure: number
  /** Windkessel (distential) pressure, mmHg. */
  arterialPressure: number
  /** Aortic-root pressure: distential pressure plus the `Zc·Q` step. */
  aorticRootPressure: number
  aorticFlow: number
  mitralFlow: number
  elastance: number
}

function validateCirculation(parameters: CirculationParameters): void {
  windkesselTimeConstant(parameters)
  requirePositive(parameters.beatPeriod, 'Beat period')
  requirePositive(parameters.elastanceMin, 'End-diastolic elastance')
  requirePositive(parameters.elastanceMax, 'Peak elastance')
  if (parameters.elastanceMax <= parameters.elastanceMin) throw new Error('Peak elastance must exceed end-diastolic elastance.')
  if (parameters.systoleFraction <= 0 || parameters.systoleFraction >= 1) throw new Error('Systole fraction must lie strictly between 0 and 1.')
  requireNonNegative(parameters.unstressedVolume, 'Unstressed volume')
  requirePositive(parameters.leftAtrialPressure, 'Left atrial pressure')
  requirePositive(parameters.mitralResistance, 'Mitral resistance')
  requirePositive(parameters.aorticResistance, 'Aortic resistance')
  const leak = parameters.reverseLeakFactor ?? 1e4
  if (leak < 1) throw new Error('Reverse leak factor must be at least 1; a lower number means the valve opens backwards too easily.')
}

/** One-way valve: forward gradient flows against `R`, reverse gradient against `R·leak`. */
function valveFlow(pressureDifference: number, resistance: number, leak: number): number {
  return pressureDifference >= 0 ? pressureDifference / resistance : pressureDifference / (resistance * leak)
}

/**
 * Beat the left ventricle against its load.
 *
 * State is `[volume, distential arterial pressure]`. The ventricle is an
 * elastance, not a capacitor, so its pressure comes algebraically from volume and
 * the phase of the beat; the valves decide which way volume moves.
 *
 * `initialVolume` should be near the end-diastolic volume the run will settle to;
 * the first beat is a transient and `pressureVolumeMetrics` reports which cycle it
 * measured, so an unsettled start cannot be mistaken for physiology.
 */
export function simulateCirculation(parameters: CirculationParameters, initialVolume: number, window: BiologyWindow): CirculationSample[] {
  validateCirculation(parameters)
  requirePositive(initialVolume, 'Initial ventricular volume')
  const zc = parameters.characteristicImpedance ?? 0
  const leak = parameters.reverseLeakFactor ?? 1e4
  const pressureOf = (elastance: number, volume: number): number =>
    elastance * Math.max(volume - parameters.unstressedVolume, 0)

  const derivative = (time: number, state: readonly number[]): number[] => {
    const volume = state[0]
    const ventricularPressure = pressureOf(ventricularElastance(parameters, time), volume)
    const mitral = valveFlow(parameters.leftAtrialPressure - ventricularPressure, parameters.mitralResistance, leak)
    const aortic = valveFlow(ventricularPressure - state[1], parameters.aorticResistance + zc, leak)
    return [mitral - aortic, (aortic - (state[1] - (parameters.venousPressure ?? 0)) / parameters.resistance) / parameters.compliance]
  }

  // Ejection loads the arterial capacitor through the open aortic valve, and
  // filling relaxes the ventricle against its diastolic elastance; the faster of
  // those two sets the step.
  const fastestTau = Math.min((parameters.aorticResistance + zc) * parameters.compliance, parameters.mitralResistance / parameters.elastanceMin)
  const samples = integrateModel(derivative, [initialVolume, parameters.leftAtrialPressure + 5], window, fastestTau)
  return samples.map((sample) => {
    const volume = sample.state[0]
    const arterial = sample.state[1]
    const elastance = ventricularElastance(parameters, sample.time)
    const ventricularPressure = pressureOf(elastance, volume)
    const mitral = valveFlow(parameters.leftAtrialPressure - ventricularPressure, parameters.mitralResistance, leak)
    const aortic = valveFlow(ventricularPressure - arterial, parameters.aorticResistance + zc, leak)
    return {
      time: sample.time,
      leftVentricularVolume: volume,
      leftVentricularPressure: ventricularPressure,
      arterialPressure: arterial,
      aorticRootPressure: arterial + zc * aortic,
      aorticFlow: aortic,
      mitralFlow: mitral,
      elastance,
    }
  })
}

export interface BeatMetrics {
  /** Cycle index that was measured, and the window it covers. */
  fromTime: number
  toTime: number
  endDiastolicVolume: number
  endSystolicVolume: number
  /** EDV − ESV: the volume the ventricle ejects, whether or not it leaves the body. */
  strokeVolume: number
  ejectionFraction: number
  heartRateBpm: number
  /** `strokeVolume / beatPeriod`. Gross ventricular output; see `forwardVolume` for what reaches the artery. */
  cardiacOutputMlPerS: number
  peakVentricularPressure: number
  /** Maximum `dP/dt` in the cycle, mmHg/s — the classic contractility index. */
  peakDpDt: number
  /** Time-mean arterial pressure over the cycle, mmHg. */
  meanArterialPressure: number
  pulsePressure: number
  /**
   * Area of the pressure–volume loop, mmHg·mL (1 mmHg·mL = 0.133 mJ). The beat is
   * traced counter-clockwise in the (V, P) plane by time order, so the raw loop
   * integral `∮P dV` is negated to report the work the ventricle performs: a
   * ventricle that does work gives a positive number, and a run that has not
   * settled gives a suspicious one instead of being hidden by an absolute value.
   */
  strokeWork: number
  peakArterialPressure: number
  minimumArterialPressure: number
  /** Peak forward flow out of the ventricle, mL/s. */
  peakAorticFlow: number
  /** Volumetric flow leaking backwards through the closed valves, mL/s peak. */
  peakReverseFlow: number
  /**
   * Net volume that actually left the ventricle into the artery over the cycle,
   * `∫Q_ao dt`, mL. With competent valves this is the stroke volume to within the
   * valve leak and the reporting grid; with a regurgitant aortic valve it is
   * smaller, because the blood that came back is pumped again in the same beat.
   */
  forwardVolume: number
  /** Total backflow through the aortic valve over the cycle, mL. Near zero for a competent valve. */
  regurgitantVolume: number
  /** Net volume change across the cycle; a settled beat returns it to ~0. */
  cycleVolumeDrift: number
}

/** Trapezoidal integral of a trace over its own span. */
function traceIntegral(times: readonly number[], values: readonly number[]): number {
  let area = 0
  for (let index = 1; index < values.length; index += 1) {
    area += (times[index] - times[index - 1]) * (values[index] + values[index - 1]) / 2
  }
  return area
}

/** Trapezoidal mean of a trace over a window. */
function traceMean(times: readonly number[], values: readonly number[]): number {
  return traceIntegral(times, values) / (times[times.length - 1] - times[0])
}

/**
 * Read one beat off the simulation.
 *
 * `beatPeriod` is taken from the parameters, and the window is the last whole
 * cycle that fits before `toTime` (default: the end of the run). Stroke work is the
 * closed-loop integral `∮P dV`, computed on the loop as traced, so a run that has
 * not settled shows up as a loop that does not close — which is reported honestly
 * as `cycleVolumeDrift` rather than smoothed away.
 *
 * The window is cut at reported samples, so it can be up to one reporting step
 * shorter than a beat, and `cycleVolumeDrift` then carries that sliver of ventricular
 * flow rather than zero. On a 3 ms grid the resting beat closes to 8e-4 mL, and the
 * flow balance `∫(Q_mitral − Q_aortic) − drift` leaves 1.8e-2 mL of trapezoid error
 * that falls to 2.6e-3 when the step is quartered — the reporting grid bounds it, not
 * the model. A run that has not settled at all measures tens of mL (22 mL when the
 * first beat is started from 20 mL). `peakDpDt` is a finite difference of the trace
 * and likewise under-reads the true maximum as the reporting step grows: 2189 mmHg/s
 * at 10 ms against 2318 mmHg/s at 1 ms.
 */
export function pressureVolumeMetrics(
  parameters: CirculationParameters,
  profile: readonly CirculationSample[],
  options: { fromTime?: number; toTime?: number } = {},
): BeatMetrics {
  const to = options.toTime ?? profile[profile.length - 1]?.time ?? 0
  const from = options.fromTime ?? to - parameters.beatPeriod
  const cycle = profile.filter((sample) => sample.time >= from - 1e-9 && sample.time <= to + 1e-9)
  if (cycle.length < 8) throw new Error(`A beat needs at least 8 samples inside the window, got ${cycle.length}. Shorten the reporting step.`)
  const volumes = cycle.map((sample) => sample.leftVentricularVolume)
  const endDiastolicVolume = Math.max(...volumes)
  const endSystolicVolume = Math.min(...volumes)
  const strokeVolume = endDiastolicVolume - endSystolicVolume
  const arterial = cycle.map((sample) => sample.arterialPressure)
  // ∮P dV around the loop in the direction the trace went, so a clockwise
  // (work-producing) beat comes out positive.
  let work = 0
  for (let index = 1; index < cycle.length; index += 1) {
    work += (cycle[index].leftVentricularPressure + cycle[index - 1].leftVentricularPressure) / 2 * (volumes[index] - volumes[index - 1])
  }
  const dp = cycle.map((sample, index) =>
    index === 0 ? 0 : (sample.leftVentricularPressure - cycle[index - 1].leftVentricularPressure) / (sample.time - cycle[index - 1].time),
  )
  const times = cycle.map((sample) => sample.time)
  const aorticFlows = cycle.map((sample) => sample.aorticFlow)
  const forwardVolume = traceIntegral(times, aorticFlows)
  return {
    fromTime: cycle[0].time,
    toTime: cycle[cycle.length - 1].time,
    endDiastolicVolume,
    endSystolicVolume,
    strokeVolume,
    ejectionFraction: strokeVolume / endDiastolicVolume,
    heartRateBpm: 60 / parameters.beatPeriod,
    cardiacOutputMlPerS: strokeVolume / parameters.beatPeriod,
    peakVentricularPressure: Math.max(...cycle.map((sample) => sample.leftVentricularPressure)),
    peakDpDt: Math.max(...dp.slice(1)),
    meanArterialPressure: traceMean(times, arterial),
    pulsePressure: Math.max(...arterial) - Math.min(...arterial),
    strokeWork: -work,
    peakArterialPressure: Math.max(...arterial),
    minimumArterialPressure: Math.min(...arterial),
    peakAorticFlow: Math.max(...aorticFlows),
    peakReverseFlow: Math.max(0, ...aorticFlows.map((flow) => -flow), ...cycle.map((sample) => -sample.mitralFlow)),
    forwardVolume,
    regurgitantVolume: traceIntegral(times, aorticFlows.map((flow) => Math.max(0, -flow))),
    cycleVolumeDrift: volumes[volumes.length - 1] - volumes[0],
  }
}

/**
 * `MAP = CO × SVR`, the identity every clinician quotes.
 *
 * Here it is a check on the simulation rather than a prescription: the model was
 * not told the mean pressure, so the product of the measured output and the set
 * resistance has to agree with the measured mean. It does, because averaging
 * `C·dP/dt` over a closed cycle is zero — but only for the flow that actually
 * crosses the resistor. Two measured caveats ride on that: the finite reverse valve
 * leak makes the reported (gross) stroke volume larger than the resistor's flow,
 * which costs 0.38 % of the product at the default `reverseLeakFactor` of 1e4 and
 * 0.006 % at 1e9; and a deliberately leaky valve (factor 30) puts the residual at
 * 56 %, because the ventricle is re-pumping the same blood. A run that has not
 * settled adds a third. All three show up here rather than being smoothed away.
 */
export function arterialPressureBalance(parameters: WindkesselParameters, metrics: BeatMetrics): {
  predicted: number
  measured: number
  relativeResidual: number
} {
  const predicted = metrics.cardiacOutputMlPerS * parameters.resistance + (parameters.venousPressure ?? 0)
  const measured = metrics.meanArterialPressure
  return { predicted, measured, relativeResidual: Math.abs(measured - predicted) / Math.abs(predicted) }
}

/* ------------------------------------------------------------------ *
 * Capillary exchange
 * ------------------------------------------------------------------ */

export interface StarlingForces {
  /** Capillary hydrostatic pressure, mmHg. */
  capillaryPressure: number
  /** Interstitial hydrostatic pressure, mmHg. */
  interstitialPressure: number
  /** Plasma effective oncotic pressure, mmHg. */
  plasmaOncoticPressure: number
  /** Interstitial oncotic pressure, mmHg. */
  interstitialOncoticPressure: number
  /** Reflection coefficient, 0…1 — how completely the membrane holds protein back. */
  reflectionCoefficient: number
}

export interface FiltrationReport {
  /** `(Pc − Pi) − σ(πc − πi)`; positive means fluid leaves the capillary. */
  netFiltrationPressure: number
  hydrostaticDifference: number
  /** The whole oncotic term, `σ(πc − πi)`, already signed as a retaining force. */
  oncoticDifference: number
  /** Volume flux per unit ` filtrationCoefficient` (give `LpS` in mL/(s·mmHg)). */
  flowPerUnitConductance: number
}

/**
 * Starling forces across a capillary wall.
 *
 * With `σ = 1` the membrane is protein-tight and the full oncotic difference acts;
 * with `σ = 0` plasma and interstitium pull equally and only hydrostatics remain.
 * A leaky capillary therefore sits between the two, and the null point — filtration
 * exactly zero — is at `Pc = Pi + σ(πc − πi)`, which is the number worth putting on
 * a slider label.
 */
export function starlingFiltration(forces: StarlingForces, filtrationCoefficientArea = 1): FiltrationReport {
  requireFraction(forces.reflectionCoefficient, 'Reflection coefficient')
  for (const [name, value] of [
    ['Capillary pressure', forces.capillaryPressure],
    ['Interstitial pressure', forces.interstitialPressure],
    ['Plasma oncotic pressure', forces.plasmaOncoticPressure],
    ['Interstitial oncotic pressure', forces.interstitialOncoticPressure],
  ] as const) {
    requireNonNegative(value, name)
  }
  requirePositive(filtrationCoefficientArea, 'Filtration coefficient times surface area')
  const hydrostaticDifference = forces.capillaryPressure - forces.interstitialPressure
  const oncoticDifference = forces.reflectionCoefficient * (forces.plasmaOncoticPressure - forces.interstitialOncoticPressure)
  const netFiltrationPressure = hydrostaticDifference - oncoticDifference
  return {
    netFiltrationPressure,
    hydrostaticDifference,
    oncoticDifference,
    flowPerUnitConductance: netFiltrationPressure * filtrationCoefficientArea,
  }
}

/**
 * Filtration at the arteriolar and venular ends of one capillary, and the net the
 * lymphatics have to carry away.
 *
 * Reabsorption at the venular end is `min(0, Jv)` there, so the net is the sum —
 * and it is positive for a normal bed. That is not a rounding accident: the
 * classic picture of a capillary filtering at one end and sucking back at the other
 * is incomplete, and the residual is why lymph exists.
 */
export function capillarySegmentExchange(
  arterialEnd: StarlingForces,
  venularEnd: StarlingForces,
  filtrationCoefficientArea = 1,
): { arteriolar: FiltrationReport; venular: FiltrationReport; netFiltration: number; reabsorbed: number } {
  const arteriolar = starlingFiltration(arterialEnd, filtrationCoefficientArea)
  const venular = starlingFiltration(venularEnd, filtrationCoefficientArea)
  return {
    arteriolar,
    venular,
    netFiltration: arteriolar.flowPerUnitConductance + venular.flowPerUnitConductance,
    reabsorbed: Math.min(0, arteriolar.flowPerUnitConductance) + Math.min(0, venular.flowPerUnitConductance),
  }
}

/**
 * A settled left heart at rest.
 *
 * These are not literature values and should not be read as one person's
 * haemodynamics. They are what this parameter set produces when run for 14 s (16
 * beats) at a 3 ms step: end-diastolic volume 125 mL, end-systolic volume 61 mL,
 * stroke volume 65 mL, ejection fraction 0.52, mean arterial pressure 90 mmHg,
 * systolic aortic pressure 108 mmHg, diastolic 73 mmHg, cardiac output 4.5 L/min.
 * The number was tuned until the loop closed and the ventricle emptied like a
 * ventricle does; the test suite pins the relations (Starling, afterload, inotropy,
 * mass and pressure balance) rather than the pressures, because the relations are
 * what a design decision rests on.
 */
export const RESTING_CIRCULATION: CirculationParameters = {
  resistance: 1.2,
  compliance: 1.6,
  characteristicImpedance: 0.03,
  venousPressure: 0,
  beatPeriod: 0.86,
  systoleFraction: 0.33,
  elastanceMin: 0.06,
  elastanceMax: 2,
  unstressedVolume: 5,
  leftAtrialPressure: 8,
  mitralResistance: 0.02,
  aorticResistance: 0.004,
}
