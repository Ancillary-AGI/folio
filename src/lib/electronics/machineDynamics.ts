/**
 * Dynamic models for the electrical machines in `machines.ts`.
 *
 * The parts catalogue describes machines by their datasheet envelopes. This
 * module answers the next question — what happens in time when the machine is
 * connected to a supply and a load — with lumped-parameter ODEs integrated by
 * the same RK4 solver used by the robotics domain.
 *
 * Models and honesty limits
 * -------------------------
 * - **Brushed DC machine**: two states, armature current and rotor speed, with
 *   winding R/L, back-EMF, torque constant, inertia and viscous friction. This
 *   is the standard textbook model; it does not model brush drop, armature
 *   reaction, saturation or thermal drift.
 * - **BLDC/PMSM**: dq-axis model with surface-magnet assumptions (Ld = Lq),
 *   ideal continuous voltage-source inverter, and no switching ripple. It is
 *   not a finite-element or drive-signal-level model.
 * - **Stepper**: inertial load pulled toward a command angle by a sinusoidal
 *   holding torque, with a first-order phase-current lag (L/R). Magnetic
 *   saturation, detent harmonics and mid-band resonance are not modelled.
 *
 * Every parameter is validated; a non-physical model throws instead of
 * returning a stable-looking trace. Simulation uses RK4 with a caller-chosen
 * step; the UI picks 1 ms unless the user changes it.
 */

import { integrate } from '../robotics/timeIntegration'

export interface MachineSimulationOptions {
  tEndSeconds: number
  dtSeconds: number
}

export interface DcMachineParameters {
  resistanceOhm: number
  inductanceH: number
  torqueConstantNmPerA: number
  backEmfVPerRadPerS: number
  inertiaKgm2: number
  viscousFrictionNmsPerRad: number
}

export interface DcMachineOperatingPoint {
  supplyVoltageV: number
  loadTorqueNm: number
  /** External load resistance for generator operation; 0 for a driven motor. */
  loadResistanceOhm?: number
  initialCurrentA?: number
  initialSpeedRadPerS?: number
}

export interface DcMachineSample {
  timeSeconds: number
  currentA: number
  speedRadPerS: number
  speedRpm: number
  electromagneticTorqueNm: number
  shaftTorqueNm: number
  terminalVoltageV: number
  /** Positive into the machine. A generator reports negative. */
  electricalPowerW: number
  /** Positive delivered to the load. A generator reports negative (absorbed). */
  mechanicalPowerW: number
  /** |mechanical| / |electrical|; NaN when the electrical power is zero. */
  efficiency: number
}

export interface DcMachineSteadyState {
  currentA: number
  speedRadPerS: number
  speedRpm: number
  electromagneticTorqueNm: number
  shaftTorqueNm: number
  terminalVoltageV: number
  electricalPowerW: number
  mechanicalPowerW: number
  efficiency: number
}

export interface BldcParameters {
  phaseResistanceOhm: number
  phaseInductanceH: number
  /** Permanent-magnet flux linkage per phase, Wb. */
  fluxLinkageWb: number
  polePairs: number
  inertiaKgm2: number
  viscousFrictionNmsPerRad: number
}

export interface BldcOperatingPoint {
  dcBusVoltageV: number
  /** Inverter modulation index, 0 … 1 (space-vector linear range). */
  modulationIndex: number
  loadTorqueNm: number
  initialCurrentDdA?: number
  initialCurrentQA?: number
  initialSpeedRadPerS?: number
}

export interface BldcSample {
  timeSeconds: number
  currentDA: number
  currentQA: number
  phaseCurrentAmplitudeA: number
  speedRadPerS: number
  speedRpm: number
  electricalFrequencyHz: number
  torqueNm: number
  shaftTorqueNm: number
  electricalPowerW: number
  mechanicalPowerW: number
  efficiency: number
}

export interface StepperParameters {
  holdingTorqueNm: number
  phaseResistanceOhm: number
  phaseInductanceH: number
  /** Mechanical angle per full step, rad. 1.8° = π/100. */
  stepAngleRad: number
  inertiaKgm2: number
  viscousFrictionNmsPerRad: number
  detentTorqueNm?: number
}

export interface StepperOperatingPoint {
  stepRateStepsPerSecond: number
  loadTorqueNm: number
  initialAngleRad?: number
  initialSpeedRadPerS?: number
  initialCurrentFraction?: number
}

export interface StepperSample {
  timeSeconds: number
  angleRad: number
  commandAngleRad: number
  positionErrorRad: number
  speedRadPerS: number
  speedStepsPerSecond: number
  currentFraction: number
  torqueNm: number
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite (got ${value}).`);
}

function requirePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be positive and finite (got ${value}).`);
  }
}

function requireNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be non-negative and finite (got ${value}).`);
  }
}

const MAX_INTERNAL_STEPS = 400_000

function validateOptions(options: MachineSimulationOptions): void {
  requirePositive(options.tEndSeconds, 'Simulation end time')
  requirePositive(options.dtSeconds, 'Simulation step')
  const steps = Math.ceil(options.tEndSeconds / options.dtSeconds)
  if (steps > MAX_INTERNAL_STEPS) {
    throw new Error(
      `Simulation would take ${steps} output steps (limit ${MAX_INTERNAL_STEPS}); increase the step size or shorten the run.`,
    )
  }
}

/**
 * Pick a stable internal step for RK4 from the fastest time constant. The
 * user's step remains the output cadence; intermediate samples are dropped so
 * a chart is not swamped by electrical transients.
 */
function rk4Plan(options: MachineSimulationOptions, fastestTau: number): { dt: number; stride: number } {
  const target = Number.isFinite(fastestTau) && fastestTau > 0 ? fastestTau / 20 : options.dtSeconds
  const stride = Math.max(1, Math.ceil(options.dtSeconds / target))
  const dt = options.dtSeconds / stride
  const steps = Math.ceil(options.tEndSeconds / dt)
  if (steps > MAX_INTERNAL_STEPS) {
    throw new Error(
      `A stable step of ${dt.toExponential(2)} s needs ${steps} internal steps (limit ${MAX_INTERNAL_STEPS}); shorten the run or use a machine with slower dynamics.`,
    )
  }
  return { dt, stride }
}

function decimate<T extends { time: number }>(samples: T[], stride: number): T[] {
  if (stride === 1) return samples
  const out = samples.filter((_, index) => index % stride === 0)
  const last = samples[samples.length - 1]
  if (out[out.length - 1] !== last) out.push(last)
  return out
}

/* ------------------------------------------------------------------ *
 * Exact stepping for the linear two-state DC machine
 * ------------------------------------------------------------------ */

function matrixExponential2(
  a: number, b: number, c: number, d: number, h: number,
): [number, number, number, number] {
  const norm = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d)) * Math.abs(h)
  let squarings = 0
  while (norm * 2 ** -squarings > 0.25) squarings += 1
  const scale = 2 ** -squarings
  const ha = a * h * scale
  const hb = b * h * scale
  const hc = c * h * scale
  const hd = d * h * scale

  let r00 = 1, r01 = 0, r10 = 0, r11 = 1
  let t00 = 1, t01 = 0, t10 = 0, t11 = 1
  for (let term = 1; term <= 16; term += 1) {
    const n00 = t00 * ha + t01 * hc
    const n01 = t00 * hb + t01 * hd
    const n10 = t10 * ha + t11 * hc
    const n11 = t10 * hb + t11 * hd
    t00 = n00 / term
    t01 = n01 / term
    t10 = n10 / term
    t11 = n11 / term
    r00 += t00
    r01 += t01
    r10 += t10
    r11 += t11
  }
  for (let i = 0; i < squarings; i += 1) {
    const n00 = r00 * r00 + r01 * r10
    const n01 = r00 * r01 + r01 * r11
    const n10 = r10 * r00 + r11 * r10
    const n11 = r10 * r01 + r11 * r11
    r00 = n00
    r01 = n01
    r10 = n10
    r11 = n11
  }
  return [r00, r01, r10, r11]
}

/**
 * Exact zero-order-hold response of `ẋ = Ax + Bu` with constant `u`:
 * `x(h) = Φx + A⁻¹(Φ−I)Bu`. The DC machine is linear, so an exact step keeps
 * the fast electrical pole from being integrated badly at a mechanical time
 * scale.
 */
function simulateLinearTwoState(
  a: number, b: number, c: number, d: number,
  input: readonly [number, number],
  initial: readonly [number, number],
  options: MachineSimulationOptions,
): Array<{ time: number; state: [number, number] }> {
  const determinant = a * d - b * c
  if (determinant === 0) throw new Error('DC machine state matrix is singular; check the model parameters.')
  const bu0 = input[0]
  const bu1 = input[1]
  // The equilibrium solves `0 = Ax + Bu`, i.e. `x = −A⁻¹Bu`.
  const steady0 = (-d * bu0 + b * bu1) / determinant
  const steady1 = (c * bu0 - a * bu1) / determinant

  const samples: Array<{ time: number; state: [number, number] }> = []
  let state: [number, number] = [initial[0], initial[1]]
  let time = 0
  const steps = Math.ceil(options.tEndSeconds / options.dtSeconds)
  for (let step = 0; step <= steps; step += 1) {
    samples.push({ time, state: [state[0], state[1]] })
    if (step === steps) break
    const h = Math.min(options.dtSeconds, options.tEndSeconds - time)
    const [p00, p01, p10, p11] = matrixExponential2(a, b, c, d, h)
    const x0 = state[0] - steady0
    const x1 = state[1] - steady1
    state = [p00 * x0 + p01 * x1 + steady0, p10 * x0 + p11 * x1 + steady1]
    time = Math.min(time + h, options.tEndSeconds)
  }
  return samples
}

function validateDc(parameters: DcMachineParameters, operating: DcMachineOperatingPoint): number {
  requirePositive(parameters.resistanceOhm, 'Winding resistance')
  requirePositive(parameters.inductanceH, 'Winding inductance')
  requirePositive(parameters.torqueConstantNmPerA, 'Torque constant')
  requirePositive(parameters.backEmfVPerRadPerS, 'Back-EMF constant')
  requirePositive(parameters.inertiaKgm2, 'Rotor inertia')
  requireNonNegative(parameters.viscousFrictionNmsPerRad, 'Viscous friction')
  requireFinite(operating.supplyVoltageV, 'Supply voltage')
  requireFinite(operating.loadTorqueNm, 'Load torque')
  const loadResistance = operating.loadResistanceOhm ?? 0
  requireNonNegative(loadResistance, 'Load resistance')
  if (operating.initialCurrentA !== undefined) requireFinite(operating.initialCurrentA, 'Initial current')
  if (operating.initialSpeedRadPerS !== undefined) requireFinite(operating.initialSpeedRadPerS, 'Initial speed')
  return loadResistance
}

/** Closed-form operating point of the linear DC model. */
export function dcMachineSteadyState(
  parameters: DcMachineParameters,
  operating: DcMachineOperatingPoint,
): DcMachineSteadyState {
  const loadResistance = validateDc(parameters, operating)
  const { torqueConstantNmPerA: kt, backEmfVPerRadPerS: ke, viscousFrictionNmsPerRad: b } = parameters
  const totalResistance = parameters.resistanceOhm + loadResistance
  const denominator = kt * ke + b * totalResistance
  if (!(denominator > 0)) {
    throw new Error('DC machine has no finite steady state: torque/back-EMF constants and friction are all zero.');
  }
  const speedRadPerS =
    (kt * operating.supplyVoltageV - operating.loadTorqueNm * totalResistance) / denominator
  const currentA = (operating.supplyVoltageV - ke * speedRadPerS) / totalResistance
  const electromagneticTorqueNm = kt * currentA
  const shaftTorqueNm = electromagneticTorqueNm - b * speedRadPerS
  const terminalVoltageV = ke * speedRadPerS + parameters.resistanceOhm * currentA
  const electricalPowerW = terminalVoltageV * currentA
  const mechanicalPowerW = shaftTorqueNm * speedRadPerS
  return {
    currentA,
    speedRadPerS,
    speedRpm: (speedRadPerS * 60) / (2 * Math.PI),
    electromagneticTorqueNm,
    shaftTorqueNm,
    terminalVoltageV,
    electricalPowerW,
    mechanicalPowerW,
    efficiency: electricalPowerW === 0 ? Number.NaN : Math.abs(mechanicalPowerW / electricalPowerW),
  }
}

function dcSample(
  timeSeconds: number,
  state: readonly number[],
  parameters: DcMachineParameters,
): DcMachineSample {
  const [currentA, speedRadPerS] = state
  const electromagneticTorqueNm = parameters.torqueConstantNmPerA * currentA
  const shaftTorqueNm = electromagneticTorqueNm - parameters.viscousFrictionNmsPerRad * speedRadPerS
  const terminalVoltageV =
    parameters.backEmfVPerRadPerS * speedRadPerS + parameters.resistanceOhm * currentA
  const electricalPowerW = terminalVoltageV * currentA
  const mechanicalPowerW = shaftTorqueNm * speedRadPerS
  return {
    timeSeconds,
    currentA,
    speedRadPerS,
    speedRpm: (speedRadPerS * 60) / (2 * Math.PI),
    electromagneticTorqueNm,
    shaftTorqueNm,
    terminalVoltageV,
    electricalPowerW,
    mechanicalPowerW,
    efficiency: electricalPowerW === 0 ? Number.NaN : Math.abs(mechanicalPowerW / electricalPowerW),
  }
}

/**
 * Motor: `supplyVoltageV > 0`, `loadTorqueNm ≥ 0`, `loadResistanceOhm = 0`.
 * Generator: `supplyVoltageV = 0`, a positive `loadResistanceOhm`, and a
 * negative `loadTorqueNm` representing the prime mover.
 */
export function simulateDcMachine(
  parameters: DcMachineParameters,
  operating: DcMachineOperatingPoint,
  options: MachineSimulationOptions,
): DcMachineSample[] {
  validateOptions(options)
  const loadResistance = validateDc(parameters, operating)
  const totalResistance = parameters.resistanceOhm + loadResistance

  const samples = simulateLinearTwoState(
    -totalResistance / parameters.inductanceH,
    -parameters.backEmfVPerRadPerS / parameters.inductanceH,
    parameters.torqueConstantNmPerA / parameters.inertiaKgm2,
    -parameters.viscousFrictionNmsPerRad / parameters.inertiaKgm2,
    [operating.supplyVoltageV / parameters.inductanceH, -operating.loadTorqueNm / parameters.inertiaKgm2],
    [operating.initialCurrentA ?? 0, operating.initialSpeedRadPerS ?? 0],
    options,
  )

  return samples.map((sample) => dcSample(sample.time, sample.state, parameters))
}

function validateBldc(parameters: BldcParameters, operating: BldcOperatingPoint): number {
  requirePositive(parameters.phaseResistanceOhm, 'Phase resistance')
  requirePositive(parameters.phaseInductanceH, 'Phase inductance')
  requirePositive(parameters.fluxLinkageWb, 'Flux linkage')
  requirePositive(parameters.polePairs, 'Pole pairs')
  if (!Number.isInteger(parameters.polePairs)) throw new Error('Pole pairs must be an integer.')
  requirePositive(parameters.inertiaKgm2, 'Rotor inertia')
  requireNonNegative(parameters.viscousFrictionNmsPerRad, 'Viscous friction')
  requirePositive(operating.dcBusVoltageV, 'DC bus voltage')
  if (!Number.isFinite(operating.modulationIndex) || operating.modulationIndex < 0 || operating.modulationIndex > 1) {
    throw new Error(`Modulation index must be between 0 and 1 (got ${operating.modulationIndex}).`)
  }
  requireFinite(operating.loadTorqueNm, 'Load torque')
  return (operating.modulationIndex * operating.dcBusVoltageV) / Math.sqrt(3)
}

/** Steady state of the dq model with `id = 0`, which is the surface-PM optimum. */
export function bldcSteadyState(
  parameters: BldcParameters,
  operating: BldcOperatingPoint,
): { speedRadPerS: number; speedRpm: number; currentQA: number; torqueNm: number } {
  const vq = validateBldc(parameters, operating)
  const { polePairs: p, fluxLinkageWb: lambda, phaseResistanceOhm: r, viscousFrictionNmsPerRad: b } = parameters
  const denominator = 1.5 * p * p * lambda * lambda + r * b
  const speedRadPerS = (1.5 * p * lambda * vq - r * operating.loadTorqueNm) / denominator
  const currentQA = (vq - p * lambda * speedRadPerS) / r
  return {
    speedRadPerS,
    speedRpm: (speedRadPerS * 60) / (2 * Math.PI),
    currentQA,
    torqueNm: 1.5 * p * lambda * currentQA,
  }
}

export function simulateBldc(
  parameters: BldcParameters,
  operating: BldcOperatingPoint,
  options: MachineSimulationOptions,
): BldcSample[] {
  validateOptions(options)
  const vq = validateBldc(parameters, operating)
  const { phaseResistanceOhm: r, phaseInductanceH: l, polePairs: p, fluxLinkageWb: lambda } = parameters

  // Ideal field-oriented control: the d-axis voltage cancels the speed
  // cross-coupling term, holding id at zero so torque is 1.5·p·λ·iq.
  const derivative = (_time: number, state: readonly number[]): number[] => {
    const [id, iq, speed] = state
    const electricalSpeed = p * speed
    const vd = -electricalSpeed * l * iq
    return [
      (vd - r * id + electricalSpeed * l * iq) / l,
      (vq - r * iq - electricalSpeed * (l * id + lambda)) / l,
      (1.5 * p * lambda * iq - parameters.viscousFrictionNmsPerRad * speed - operating.loadTorqueNm) /
        parameters.inertiaKgm2,
    ]
  }

  const electricalTau = l / r
  const mechanicalTau = parameters.viscousFrictionNmsPerRad > 0
    ? parameters.inertiaKgm2 / parameters.viscousFrictionNmsPerRad
    : Infinity
  const electromechanicalTau =
    (parameters.inertiaKgm2 * r) / (1.5 * p * p * lambda * lambda + r * parameters.viscousFrictionNmsPerRad)
  const plan = rk4Plan(options, Math.min(electricalTau, mechanicalTau, electromechanicalTau))

  const samples = decimate(
    integrate(
      derivative,
      [
        operating.initialCurrentDdA ?? 0,
        operating.initialCurrentQA ?? 0,
        operating.initialSpeedRadPerS ?? 0,
      ],
      0,
      options.tEndSeconds,
      { dt: plan.dt, method: 'rk4' },
    ),
    plan.stride,
  )

  return samples.map((sample) => {
    const [currentDA, currentQA, speedRadPerS] = sample.state
    const torqueNm = 1.5 * p * lambda * currentQA
    const shaftTorqueNm = torqueNm - parameters.viscousFrictionNmsPerRad * speedRadPerS
    const electricalPowerW = 1.5 * vq * currentQA
    const mechanicalPowerW = shaftTorqueNm * speedRadPerS
    return {
      timeSeconds: sample.time,
      currentDA,
      currentQA,
      phaseCurrentAmplitudeA: Math.hypot(currentDA, currentQA),
      speedRadPerS,
      speedRpm: (speedRadPerS * 60) / (2 * Math.PI),
      electricalFrequencyHz: (Math.abs(p * speedRadPerS)) / (2 * Math.PI),
      torqueNm,
      shaftTorqueNm,
      electricalPowerW,
      mechanicalPowerW,
      efficiency: electricalPowerW === 0 ? Number.NaN : Math.abs(mechanicalPowerW / electricalPowerW),
    }
  })
}

function validateStepper(parameters: StepperParameters, operating: StepperOperatingPoint): void {
  requireNonNegative(parameters.holdingTorqueNm, 'Holding torque')
  requirePositive(parameters.phaseResistanceOhm, 'Phase resistance')
  requirePositive(parameters.phaseInductanceH, 'Phase inductance')
  requirePositive(parameters.stepAngleRad, 'Step angle')
  requirePositive(parameters.inertiaKgm2, 'Rotor inertia')
  requireNonNegative(parameters.viscousFrictionNmsPerRad, 'Viscous friction')
  if (parameters.detentTorqueNm !== undefined) {
    requireNonNegative(parameters.detentTorqueNm, 'Detent torque')
  }
  requireNonNegative(operating.stepRateStepsPerSecond, 'Step rate')
  requireFinite(operating.loadTorqueNm, 'Load torque')
  if (operating.initialAngleRad !== undefined) requireFinite(operating.initialAngleRad, 'Initial angle')
  if (operating.initialSpeedRadPerS !== undefined) requireFinite(operating.initialSpeedRadPerS, 'Initial speed')
  if (operating.initialCurrentFraction !== undefined) {
    requireFinite(operating.initialCurrentFraction, 'Initial current fraction')
  }
}

/**
 * Commanded angle advances by one full step per interval. With a zero step
 * rate the command is held at the initial angle.
 */
export function stepperCommandAngle(
  timeSeconds: number,
  stepRateStepsPerSecond: number,
  stepAngleRad: number,
  initialAngleRad = 0,
): number {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) {
    throw new Error(`Time must be non-negative and finite (got ${timeSeconds}).`)
  }
  requireNonNegative(stepRateStepsPerSecond, 'Step rate')
  requirePositive(stepAngleRad, 'Step angle')
  if (!Number.isFinite(initialAngleRad)) throw new Error(`Initial angle must be finite (got ${initialAngleRad}).`)
  return initialAngleRad + stepAngleRad * Math.floor(timeSeconds * stepRateStepsPerSecond)
}

export function simulateStepper(
  parameters: StepperParameters,
  operating: StepperOperatingPoint,
  options: MachineSimulationOptions,
): StepperSample[] {
  validateOptions(options)
  validateStepper(parameters, operating)
  const electricalAngleGain = Math.PI / (2 * parameters.stepAngleRad)
  const electricalTimeConstant = parameters.phaseInductanceH / parameters.phaseResistanceOhm
  const initialAngle = operating.initialAngleRad ?? 0

  const derivative = (time: number, state: readonly number[]): number[] => {
    const [speed, angle, currentFraction] = state
    const command = stepperCommandAngle(
      time,
      operating.stepRateStepsPerSecond,
      parameters.stepAngleRad,
      initialAngle,
    )
    const detent = parameters.detentTorqueNm ?? 0
    const torque =
      parameters.holdingTorqueNm * currentFraction * Math.sin(electricalAngleGain * (command - angle)) -
      detent * Math.sin(electricalAngleGain * angle)
    return [
      (torque - parameters.viscousFrictionNmsPerRad * speed - operating.loadTorqueNm) /
        parameters.inertiaKgm2,
      speed,
      (1 - currentFraction) / electricalTimeConstant,
    ]
  }

  const electricalTau = parameters.phaseInductanceH / parameters.phaseResistanceOhm
  const dampingTau = parameters.viscousFrictionNmsPerRad > 0
    ? parameters.inertiaKgm2 / parameters.viscousFrictionNmsPerRad
    : Infinity
  const stiffness = parameters.holdingTorqueNm * electricalAngleGain
  const oscillationTau = stiffness > 0 ? Math.sqrt(parameters.inertiaKgm2 / stiffness) : Infinity
  const plan = rk4Plan(options, Math.min(electricalTau, dampingTau, oscillationTau))

  const samples = decimate(
    integrate(
      derivative,
      [operating.initialSpeedRadPerS ?? 0, initialAngle, operating.initialCurrentFraction ?? 0],
      0,
      options.tEndSeconds,
      { dt: plan.dt, method: 'rk4' },
    ),
    plan.stride,
  )

  return samples.map((sample) => {
    const [speed, angle, currentFraction] = sample.state
    const command = stepperCommandAngle(
      sample.time,
      operating.stepRateStepsPerSecond,
      parameters.stepAngleRad,
      initialAngle,
    )
    const torque =
      parameters.holdingTorqueNm * currentFraction * Math.sin(electricalAngleGain * (command - angle)) -
      (parameters.detentTorqueNm ?? 0) * Math.sin(electricalAngleGain * angle)
    return {
      timeSeconds: sample.time,
      angleRad: angle,
      commandAngleRad: command,
      positionErrorRad: command - angle,
      speedRadPerS: speed,
      speedStepsPerSecond: speed / parameters.stepAngleRad,
      currentFraction,
      torqueNm: torque,
    }
  })
}

/* ------------------------------------------------------------------ *
 * Presets for the UI
 * ------------------------------------------------------------------ */

export interface DcMachinePreset {
  id: string
  name: string
  parameters: DcMachineParameters
  note: string
}

/**
 * R and the constants come from the catalogue's stall/no-load envelope;
 * inductance and inertia are representative values for this frame size, not
 * datasheet sign-off data.
 */
export const DC_MACHINE_PRESETS: readonly DcMachinePreset[] = [
  {
    id: 'rs550',
    name: 'RS-550 brushed DC (12 V)',
    parameters: {
      resistanceOhm: 1.2,
      inductanceH: 0.0012,
      torqueConstantNmPerA: 0.011,
      backEmfVPerRadPerS: 0.00955,
      inertiaKgm2: 1.2e-5,
      viscousFrictionNmsPerRad: 2e-6,
    },
    note: 'Stall torque ≈ 0.11 N·m, no-load speed ≈ 11 700 rpm at 12 V.',
  },
  {
    id: 'small-24v',
    name: '24 V gearmotor (brushed)',
    parameters: {
      resistanceOhm: 4.5,
      inductanceH: 0.003,
      torqueConstantNmPerA: 0.032,
      backEmfVPerRadPerS: 0.0316,
      inertiaKgm2: 4e-5,
      viscousFrictionNmsPerRad: 6e-6,
    },
    note: 'Representative 24 V, 0.5 A no-load, 0.2 N·m continuous machine.',
  },
]

export interface BldcPreset {
  id: string
  name: string
  parameters: BldcParameters
  note: string
}

export const BLDC_PRESETS: readonly BldcPreset[] = [
  {
    id: '42blf',
    name: '42 mm BLDC, 4 pole pairs (24 V)',
    parameters: {
      phaseResistanceOhm: 0.9,
      phaseInductanceH: 0.0008,
      fluxLinkageWb: 0.0085,
      polePairs: 4,
      inertiaKgm2: 2e-5,
      viscousFrictionNmsPerRad: 2e-6,
    },
    note: 'Representative gimbal-class outrunner; ≈ 3 500 rpm at 24 V and 0.9 modulation.',
  },
]

export interface StepperPreset {
  id: string
  name: string
  parameters: StepperParameters
  note: string
}

export const STEPPER_PRESETS: readonly StepperPreset[] = [
  {
    id: 'nema17',
    name: 'NEMA-17 bipolar (1.8°/step)',
    parameters: {
      holdingTorqueNm: 0.4,
      phaseResistanceOhm: 30,
      phaseInductanceH: 0.01,
      stepAngleRad: Math.PI / 100,
      inertiaKgm2: 5e-6,
      // Lumped damping: bearing friction plus the back-EMF/eddy-current
      // damping that keeps a real stepper from ringing indefinitely.
      viscousFrictionNmsPerRad: 0.02,
    },
    note: 'Holding torque from the catalogue; 30 Ω / 10 mH phase, 1.8° full step.',
  },
]
