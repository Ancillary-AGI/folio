/**
 * MNA stamping.
 *
 * Translates devices into matrix contributions. Three domains are supported and
 * each is stamped by its own function so the physics stays explicit:
 *
 *  • `stampDc`        — resistors, sources, shorted inductors, open capacitors.
 *  • `stampTransient` — resistors and sources plus backward-Euler companion
 *                       models for capacitors and inductors, which carry the
 *                       previous time-step state held in `TransientState`.
 *  • `stampAc`        — the complex small-signal network at one angular
 *                       frequency, with diodes linearised at the DC operating
 *                       point supplied by the caller.
 *
 * Diode linearisation is shared by DC and transient: `stampNonlinearDiodes`
 * adds the Newton companion (conductance + equivalent current source) and is
 * called once per Newton iteration.
 */

import { cAdd, cSub, complex, type Complex } from './numeric'
import { sourceTransientValue, type DiodeDevice, type TransmissionLineDevice } from './devices'
import type { CircuitModel } from './circuitModel'
import { computeTLineSources, createTLineState, type TLineState } from './transmissionLine'
import { stampMutualInductanceAc, stampMutualInductanceTransient } from './transformerMutual'

export interface RealSystem {
  matrix: number[][]
  rhs: number[]
}

export interface ComplexSystem {
  matrix: Complex[][]
  rhs: Complex[]
}

/** Time-integration rule for the reactive companions. */
export type TransientIntegration = 'backward-euler' | 'trapezoidal' | 'bdf2'

/** Companion conductance/source multiplier for an integration rule. */
export function integrationFactor(method: TransientIntegration): number {
  if (method === 'trapezoidal') return 2
  if (method === 'bdf2') return 1.5
  return 1
}

/**
 * Effective prior value entering a companion source.
 *
 * Backward Euler and trapezoidal use `y_{n-1}`. Gear/BDF2 uses the
 * constant-step combination `(4·y_{n-1} − y_{n-2})/3`. The runner takes two
 * backward-Euler steps after every step-size change, so both samples always
 * belong to the current step size.
 */
export function companionHistory(
  method: TransientIntegration,
  previous: number,
  previous2: number,
): number {
  return method === 'bdf2' ? (4 * previous - previous2) / 3 : previous
}

/** BJT junction bias and junction-capacitance values at one time step. */
export interface BjtJunctionState {
  /** Forward-positive junction voltages (mirror-corrected for a PNP). */
  vbe: number
  vbc: number
  /** Junction voltages two accepted steps back (BDF2 history). */
  vbe2?: number
  vbc2?: number
  /** Base-emitter and base-collector capacitances at that bias, F. */
  cPi: number
  cMu: number
  /** Junction capacitor currents from the previous accepted step, A. */
  cPiCurrent: number
  cMuCurrent: number
}

/** MOSFET terminal bias and gate capacitances at one time step. */
export interface MosfetTerminalState {
  /** Forward-positive terminal voltages (mirror-corrected for a P-channel part). */
  vgs: number
  vds: number
  vbs: number
  /** Terminal voltages two accepted steps back (BDF2 history). */
  vgs2?: number
  vds2?: number
  /** Gate–source and gate–drain capacitances at that bias, F. */
  cgs: number
  cgd: number
  /** Gate-capacitor currents from the previous accepted step, A. */
  cgsCurrent: number
  cgdCurrent: number
}

/** JFET terminal bias and gate capacitances at one time step. */
export interface JfetTerminalState {
  /** Forward-positive voltages (mirror-corrected for a P-channel part). */
  vgs: number
  vds: number
  /** Terminal voltages two accepted steps back (BDF2 history). */
  vgs2?: number
  vds2?: number
  /** Gate–source and gate–drain capacitances at that bias, F. */
  cgs: number
  cgd: number
  /** Gate-capacitor currents from the previous accepted step, A. */
  cgsCurrent: number
  cgdCurrent: number
}

/** State carried between transient time steps. Keyed by device name. */
export interface TransientState {
  capacitorVoltages: Map<string, number>
  /** Capacitor voltage two accepted steps back (BDF2 history). */
  capacitorVoltages2: Map<string, number>
  /** Capacitor current p→n from the previous accepted step, A. */
  capacitorCurrents: Map<string, number>
  inductorCurrents: Map<string, number>
  /** Inductor current two accepted steps back (BDF2 history). */
  inductorCurrents2: Map<string, number>
  /** Inductor terminal voltage p−n from the previous accepted step, V. */
  inductorVoltages: Map<string, number>
  /** BJT junction bias from the previous time step. */
  bjtJunctions: Map<string, BjtJunctionState>
  /** MOSFET terminal bias from the previous time step. */
  mosfetBias: Map<string, MosfetTerminalState>
  /** JFET terminal bias from the previous time step. */
  jfetBias: Map<string, JfetTerminalState>
  /** Op-amp first-stage voltage from the previous time step. */
  opAmpStages: Map<string, number>
  /** Op-amp first-stage voltage two steps back (BDF2 history). */
  opAmpStages2: Map<string, number>
  /** Op-amp internal-capacitor current from the previous step, A. */
  opAmpCurrents: Map<string, number>
  /** Transmission-line delay histories, keyed by device name. */
  transmissionLines: Map<string, TLineState>
}

export const createTransientState = (): TransientState => ({
  capacitorVoltages: new Map(),
  capacitorVoltages2: new Map(),
  capacitorCurrents: new Map(),
  inductorCurrents: new Map(),
  inductorCurrents2: new Map(),
  inductorVoltages: new Map(),
  bjtJunctions: new Map(),
  mosfetBias: new Map(),
  jfetBias: new Map(),
  opAmpStages: new Map(),
  opAmpStages2: new Map(),
  opAmpCurrents: new Map(),
  transmissionLines: new Map(),
})

const zeros = (size: number): number[][] =>
  Array.from({ length: size }, () => new Array<number>(size).fill(0))

const complexZeros = (size: number): Complex[][] =>
  Array.from({ length: size }, () => Array.from({ length: size }, () => complex(0)))

export const createRealSystem = (model: CircuitModel): RealSystem => ({
  matrix: zeros(model.size),
  rhs: new Array<number>(model.size).fill(0),
})

export const createComplexSystem = (model: CircuitModel): ComplexSystem => ({
  matrix: complexZeros(model.size),
  rhs: Array.from({ length: model.size }, () => complex(0)),
})

/* ────────────────────────────────────────────────────────────────────────────
 * Real-domain primitives
 * ──────────────────────────────────────────────────────────────────────────── */

/** Add a conductance between two nodes (ground-safe). */
export function addConductance(system: RealSystem, model: CircuitModel, p: string, n: string, g: number): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  if (a !== undefined) system.matrix[a][a] += g
  if (b !== undefined) system.matrix[b][b] += g
  if (a !== undefined && b !== undefined) {
    system.matrix[a][b] -= g
    system.matrix[b][a] -= g
  }
}

/** True when two terminals resolve to the same row (all ground aliases included). */
function sameNode(model: CircuitModel, a: string, b: string): boolean {
  return model.nodeIndex.get(a) === model.nodeIndex.get(b)
}

/** Inject `value` amperes flowing from `p` through the source to `n`. */
export function addCurrentInjection(system: RealSystem, model: CircuitModel, p: string, n: string, value: number): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  // KCL: current leaving a node is positive, so an injected current is negative.
  if (a !== undefined) system.rhs[a] -= value
  if (b !== undefined) system.rhs[b] += value
}

/**
 * Stamp a voltage-controlled current source: `i = gm·(v(ip) − v(inn))` flowing
 * from `p` through the source to `n`.
 *
 * Sign convention, checked against SPICE: a positive controlling voltage drives
 * a positive current `i` from output node `p` through the source to node `n`.
 * MNA rows are KCL sums of currents LEAVING the node, so the current leaving
 * `p` (and symmetrically the current entering `n`) appears as `+gm·v` in row
 * `p` and `−gm·v` in row `n`.
 *
 * The controlling voltages stay on the left-hand side because they are
 * unknowns: that is what makes this a genuine four-terminal element instead of a
 * fixed current.
 */
function addControlledCurrent(
  system: RealSystem,
  model: CircuitModel,
  p: string,
  n: string,
  ip: string,
  inn: string,
  gm: number,
): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  const controlP = model.nodeIndex.get(ip)
  const controlN = model.nodeIndex.get(inn)
  // MNA rows are KCL sums of currents LEAVING the node: the controlled current
  // leaves `p` toward `n`, so row `p` gains +gm at the control columns and row
  // `n` gains −gm — the same leaving-positive convention the hand-derived
  // resistor stamp in `addConductance` uses.
  if (a !== undefined) {
    if (controlP !== undefined) system.matrix[a][controlP] += gm
    if (controlN !== undefined) system.matrix[a][controlN] -= gm
  }
  if (b !== undefined) {
    if (controlP !== undefined) system.matrix[b][controlP] -= gm
    if (controlN !== undefined) system.matrix[b][controlN] += gm
  }
}

/**
 * Stamp a voltage constraint `v(p) - v(n) = value` using the device's branch
 * row. Used for voltage sources (their DC value) and inductors (0 V in DC).
 */
export function addVoltageConstraint(
  system: RealSystem,
  model: CircuitModel,
  branch: number,
  p: string,
  n: string,
  value: number,
): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  if (a !== undefined) {
    system.matrix[a][branch] += 1
    system.matrix[branch][a] += 1
  }
  if (b !== undefined) {
    system.matrix[b][branch] -= 1
    system.matrix[branch][b] -= 1
  }
  system.rhs[branch] = value
}

/* ────────────────────────────────────────────────────────────────────────────
 * DC
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Override one device's DC value for this stamp pass.
 *
 * Used by the DC sweep, which re-solves the same network once per value. Going
 * through `stampDc` rather than a parallel code path is what guarantees a sweep
 * point and a standalone operating point of the same circuit are the same
 * equations — and therefore the same numbers.
 */
/**
 * What one pass of the DC sweep substitutes into an otherwise unchanged system.
 *
 * A sweep re-solves the same network once per value, so the substitution is
 * expressed as data rather than as a second stamping path: that is what makes a
 * sweep point and a standalone operating point of the same circuit the same
 * equations, and therefore the same numbers.
 */
export type SweepOverride =
  /** Replace one device's DC value: volts, amperes or ohms, per its kind. */
  | { kind: 'device'; name: string; value: number }
  /** Run this point at another junction temperature, °C (SPICE's `temp`). */
  | { kind: 'temperature'; value: number }

/**
 * Stamp the linear part of the DC system.
 *
 * Capacitors become open circuits and inductors become shorts, which is what
 * "operating point" means for energy-storage elements.
 *
 * @param override optional per-device value substitution (DC sweep only).
 */
export function stampDc(system: RealSystem, model: CircuitModel, override?: SweepOverride): void {
  for (const device of model.devices) {
    const swept = override?.kind === 'device' && override.name === device.name ? override.value : undefined
    switch (device.kind) {
      case 'resistor':
        addConductance(system, model, device.p, device.n, 1 / (swept ?? device.resistance))
        break
      case 'capacitor':
        break
      case 'inductor': {
        const branch = model.branchRows.get(device.name)
        if (branch !== undefined) addVoltageConstraint(system, model, branch, device.p, device.n, 0)
        break
      }
      case 'transmission-line': {
        const rows = model.lineRows.get(device.name)
        if (!rows) break
        /*
         * At DC a lossless line is two ideal wires. The first row shorts the
         * signal conductors; the second shorts the returns when they are
         * distinct. When both ports share a return there is no second wire to
         * constrain, so the row instead defines the auxiliary port current as
         * i2 = −i1 with no node KCL — it must not invent a parallel path.
         */
        addVoltageConstraint(system, model, rows.port1, device.p, device.p2, 0)
        if (sameNode(model, device.n, device.n2)) {
          system.matrix[rows.port2][rows.port1] += 1
          system.matrix[rows.port2][rows.port2] += 1
        } else {
          addVoltageConstraint(system, model, rows.port2, device.n, device.n2, 0)
        }
        break
      }
      case 'voltage-source': {
        const branch = model.branchRows.get(device.name)
        if (branch !== undefined) {
          addVoltageConstraint(system, model, branch, device.p, device.n, swept ?? device.dcVoltage)
        }
        break
      }
      case 'current-source':
        addCurrentInjection(system, model, device.p, device.n, swept ?? device.dcCurrent)
        break
      case 'diode':
        // Contributes through the Newton iteration, not here.
        break
      case 'bjt':
      case 'mosfet':
      case 'jfet':
      case 'op-amp':
      case 'voltage-switch':
      case 'current-switch':
      case 'behavioral-source':
        /*
         * Nonlinear, or split across a linear and a bias-dependent part:
         * `semiconductors.ts` owns all of them. The solver adds their
         * bias-independent pieces with `stampSemiconductorLinear` and their
         * companions with `stampSemiconductorNonlinear` on every Newton
         * iteration, mirroring how diodes are handled here.
         */
        break
      case 'vcvs': {
        const branch = model.branchRows.get(device.name)
        if (branch === undefined) break
        // Branch constraint: v(p) − v(n) − gain·(v(ip) − v(inn)) = 0.
        addVoltageConstraint(system, model, branch, device.p, device.n, 0)
        const controlP = model.nodeIndex.get(device.ip)
        const controlN = model.nodeIndex.get(device.inn)
        if (controlP !== undefined) system.matrix[branch][controlP] -= device.gain
        if (controlN !== undefined) system.matrix[branch][controlN] += device.gain
        break
      }
      case 'vccs': {
        // Current i = gain·(v(ip) − v(inn)) flows from p through the source to n.
        addControlledCurrent(system, model, device.p, device.n, device.ip, device.inn, device.gain)
        break
      }
    }
  }

  /*
   * Coupled inductors need no DC stamp: each winding is already shorted by its
   * own `v = 0` branch constraint, and coupling only shapes how the currents
   * divide — a division that is fixed by the surrounding circuit at DC.
   */
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transient (backward Euler)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Stamp the transient system for time step `dt`.
 *
 * Backward Euler: `i ≈ (C/dt)(v − v_prev)`, unconditionally stable and
 * non-ringing, but first-order. Trapezoidal: `i ≈ (2C/dt)(v − v_prev) − i_prev`,
 * second-order but capable of ringing on a stiff step. Gear/BDF2:
 * `i ≈ (C/dt)(1.5·v − 2·v_prev + 0.5·v_prev2)`, second-order with mild damping.
 * The caller picks the rule; startup is always backward Euler so no initial
 * derivative is needed. All rules use the same companion topology, which is why
 * switching methods does not change the matrix structure.
 *
 * Inductor: `v = L·di/dt`, stamped as the branch constraint
 * `v(p) − v(n) − factor·(L/dt)·i = −factor·(L/dt)·history − (trapezoidal ? v_prev : 0)`,
 * where `history` is `i_prev` except for BDF2, which uses
 * `(4·i_prev − i_prev2)/3`. This keeps the inductor current available as a
 * state variable.
 */
export function stampTransient(
  system: RealSystem,
  model: CircuitModel,
  dt: number,
  state: TransientState,
  time: number,
  method: TransientIntegration = 'backward-euler',
): void {
  const factor = integrationFactor(method)
  const trapezoidal = method === 'trapezoidal'
  for (const device of model.devices) {
    switch (device.kind) {
      case 'resistor':
        addConductance(system, model, device.p, device.n, 1 / device.resistance)
        break
      case 'capacitor': {
        const conductance = (factor * device.capacitance) / dt
        const history = companionHistory(
          method,
          state.capacitorVoltages.get(device.name) ?? 0,
          state.capacitorVoltages2.get(device.name) ?? 0,
        )
        const previousCurrent = trapezoidal ? (state.capacitorCurrents.get(device.name) ?? 0) : 0
        addConductance(system, model, device.p, device.n, conductance)
        // The companion source pushes charge into p and pulls it from n.
        addCurrentInjection(system, model, device.n, device.p, conductance * history + previousCurrent)
        break
      }
      case 'inductor': {
        const branch = model.branchRows.get(device.name)
        if (branch === undefined) break
        addVoltageConstraint(system, model, branch, device.p, device.n, 0)
        const ratio = (factor * device.inductance) / dt
        const history = companionHistory(
          method,
          state.inductorCurrents.get(device.name) ?? 0,
          state.inductorCurrents2.get(device.name) ?? 0,
        )
        const previousVoltage = trapezoidal ? (state.inductorVoltages.get(device.name) ?? 0) : 0
        system.rhs[branch] = -ratio * history - previousVoltage
        system.matrix[branch][branch] -= ratio
        break
      }
      case 'transmission-line': {
        const rows = model.lineRows.get(device.name)
        if (!rows) break
        let lineState = state.transmissionLines.get(device.name)
        if (!lineState) {
          lineState = createTLineState()
          state.transmissionLines.set(device.name, lineState)
        }
        /*
         * Branin companion: each port is Z0 in series with the wave arriving
         * from the far end, v = Z0·i + e. Both e values come from the history
         * one delay in the past, so the two rows are linear in this step.
         */
        const { e1, e2 } = computeTLineSources(device, lineState, time)
        addVoltageConstraint(system, model, rows.port1, device.p, device.n, e1)
        system.matrix[rows.port1][rows.port1] -= device.z0
        addVoltageConstraint(system, model, rows.port2, device.p2, device.n2, e2)
        system.matrix[rows.port2][rows.port2] -= device.z0
        break
      }
      case 'voltage-source': {
        const branch = model.branchRows.get(device.name)
        if (branch !== undefined) {
          // A PULSE or SINE source contributes its instantaneous level, which is
          // the only difference between it and a DC source at a given time step.
          const value = sourceTransientValue(device.dcVoltage, device.waveform, time)
          addVoltageConstraint(system, model, branch, device.p, device.n, value)
        }
        break
      }
      case 'current-source':
        addCurrentInjection(
          system,
          model,
          device.p,
          device.n,
          sourceTransientValue(device.dcCurrent, device.waveform, time),
        )
        break
      case 'diode':
        break
      case 'bjt':
      case 'mosfet':
      case 'jfet':
      case 'op-amp':
      case 'voltage-switch':
      case 'current-switch':
      case 'behavioral-source':
        // Companion models live in `semiconductors.ts` (stamped per iteration),
        // because their junction and gate charges are bias dependent.
        break
      case 'vcvs': {
        const branch = model.branchRows.get(device.name)
        if (branch === undefined) break
        addVoltageConstraint(system, model, branch, device.p, device.n, 0)
        const controlP = model.nodeIndex.get(device.ip)
        const controlN = model.nodeIndex.get(device.inn)
        if (controlP !== undefined) system.matrix[branch][controlP] -= device.gain
        if (controlN !== undefined) system.matrix[branch][controlN] += device.gain
        break
      }
      case 'vccs':
        addControlledCurrent(system, model, device.p, device.n, device.ip, device.inn, device.gain)
        break
    }
  }

  for (const pair of model.couplings) {
    stampMutualInductanceTransient(system, pair, model, state, dt, method)
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Nonlinear diodes (Newton companion)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DiodeOperatingPoint {
  voltage: number
  current: number
}

/** Maximum junction-voltage argument fed to `exp`, to keep it finite. */
const MAX_EXPONENT = 40

/**
 * Diode current and conductance at a junction voltage.
 *
 * Shockley equation `Id = Is·(exp(Vd/(n·Vt)) − 1)`, with the exponential
 * argument capped at 40 (≈2.4e17). The cap is not a fudge: real diodes are
 * dominated by series resistance long before that, and it is the standard way
 * to stop a Newton iteration overflowing to `Infinity`.
 */
export function diodeCurrentAndConductance(
  device: DiodeDevice,
  junctionVoltage: number,
  thermal: number,
): { current: number; conductance: number } {
  const denominator = device.emissionCoefficient * thermal
  const exponent = Math.min(junctionVoltage / denominator, MAX_EXPONENT)
  const exponential = Math.exp(exponent)
  return {
    current: device.saturationCurrent * (exponential - 1),
    conductance: (device.saturationCurrent / denominator) * exponential,
  }
}

/**
 * Newton companion stamp for every diode in the model.
 *
 * Linearising `Id(Vd) ≈ Id0 + Gd·(Vd − Vd0)` and moving the constant term to the
 * right-hand side gives conductance `Gd` in the matrix and
 * `Ieq = Gd·Vd0 − Id0` as an injected current. `gmin` is added to the junction
 * conductance so a reverse-biased diode does not leave a floating node.
 */
export function stampNonlinearDiodes(
  system: RealSystem,
  model: CircuitModel,
  operatingPoints: Map<string, DiodeOperatingPoint>,
  thermal: number,
  gmin: number,
): void {
  for (const device of model.devices) {
    if (device.kind !== 'diode') continue
    const previous = operatingPoints.get(device.name) ?? { voltage: 0, current: 0 }
    const { current, conductance } = diodeCurrentAndConductance(device, previous.voltage, thermal)
    const effective = conductance + gmin
    addConductance(system, model, device.p, device.n, effective)
    const equivalent = effective * previous.voltage - current
    // The linearisation constant enters KCL with the opposite sign.
    addCurrentInjection(system, model, device.p, device.n, -equivalent)
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * AC (complex small-signal)
 * ──────────────────────────────────────────────────────────────────────────── */

function addComplexAdmittance(system: ComplexSystem, model: CircuitModel, p: string, n: string, y: Complex): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  if (a !== undefined) system.matrix[a][a] = cAdd(system.matrix[a][a], y)
  if (b !== undefined) system.matrix[b][b] = cAdd(system.matrix[b][b], y)
  if (a !== undefined && b !== undefined) {
    system.matrix[a][b] = cSub(system.matrix[a][b], y)
    system.matrix[b][a] = cSub(system.matrix[b][a], y)
  }
}

function addComplexCurrent(system: ComplexSystem, model: CircuitModel, p: string, n: string, value: Complex): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  if (a !== undefined) system.rhs[a] = cSub(system.rhs[a], value)
  if (b !== undefined) system.rhs[b] = cAdd(system.rhs[b], value)
}

/** KCL stamp for a branch current entering at `p` and leaving at `n`. */
function addComplexBranchKcl(system: ComplexSystem, model: CircuitModel, row: number, p: string, n: string): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  if (a !== undefined) system.matrix[a][row] = cAdd(system.matrix[a][row], complex(1))
  if (b !== undefined) system.matrix[b][row] = cSub(system.matrix[b][row], complex(1))
}

/** Voltage constraint v(p) − v(n) = 0 on a complex branch row. */
function addComplexVoltageConstraint(
  system: ComplexSystem,
  model: CircuitModel,
  row: number,
  p: string,
  n: string,
): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  if (a !== undefined) {
    system.matrix[a][row] = cAdd(system.matrix[a][row], complex(1))
    system.matrix[row][a] = cAdd(system.matrix[row][a], complex(1))
  }
  if (b !== undefined) {
    system.matrix[b][row] = cSub(system.matrix[b][row], complex(1))
    system.matrix[row][b] = cSub(system.matrix[row][b], complex(1))
  }
}

/** Constraint-row coefficients for v(p) − sigma·v(n) = 0, with no KCL stamp. */
function addComplexRowVoltage(
  system: ComplexSystem,
  model: CircuitModel,
  row: number,
  p: string,
  n: string,
  sigma: number,
): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  if (a !== undefined) system.matrix[row][a] = cAdd(system.matrix[row][a], complex(1))
  if (b !== undefined) system.matrix[row][b] = cSub(system.matrix[row][b], complex(sigma))
}

/** Add −y·(v(p) − v(n)) to a branch equation row. */
function addComplexPortTerm(
  system: ComplexSystem,
  model: CircuitModel,
  row: number,
  p: string,
  n: string,
  y: Complex,
): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  if (a !== undefined) system.matrix[row][a] = cSub(system.matrix[row][a], y)
  if (b !== undefined) system.matrix[row][b] = cAdd(system.matrix[row][b], y)
}

/**
 * AC stamp of a lossless line.
 *
 * Away from θ = kπ, the exact two-port admittance is stamped on the two port
 * rows: `i1 = Y11·v1 + Y12·v2`, `i2 = Y21·v1 + Y22·v2`. At θ = kπ the Y
 * parameters are infinite and the line is an ideal through connection: a
 * wire at even multiples, an inverting wire at odd ones. Those cases are
 * stamped as voltage constraints, never as a huge admittance.
 */
function stampTransmissionLineAc(
  system: ComplexSystem,
  model: CircuitModel,
  device: TransmissionLineDevice,
  omega: number,
): void {
  const rows = model.lineRows.get(device.name)
  if (!rows) return
  const theta = omega * device.td
  const sin = Math.sin(theta)

  if (Math.abs(sin) < 1e-9) {
    /*
     * Exact half-wave multiples make the Y parameters infinite. The line is
     * an ideal connection:
     *
     *   even multiple:  v1 = v2,  i1 = −i2   (a wire)
     *   odd multiple:   v1 = −v2, i1 = i2    (an inverting transformer)
     *
     * Stamp those relations directly rather than a 1e-9-clamped admittance,
     * whose enormity would swamp the rest of the circuit numerically. The
     * even case mirrors the DC stamp; the odd case needs an independent KCL
     * entry for each port because the two port currents are equal, not
     * opposite.
     */
    const even = Math.abs(Math.round(theta / Math.PI)) % 2 === 0
    if (even) {
      addComplexVoltageConstraint(system, model, rows.port1, device.p, device.p2)
      if (sameNode(model, device.n, device.n2)) {
        // Shared return: i1 + i2 = 0 with no second KCL path.
        system.matrix[rows.port2][rows.port1] = cAdd(system.matrix[rows.port2][rows.port1], complex(1))
        system.matrix[rows.port2][rows.port2] = cAdd(system.matrix[rows.port2][rows.port2], complex(1))
      } else {
        addComplexVoltageConstraint(system, model, rows.port2, device.n, device.n2)
      }
    } else {
      addComplexBranchKcl(system, model, rows.port1, device.p, device.n)
      addComplexBranchKcl(system, model, rows.port2, device.p2, device.n2)
      addComplexRowVoltage(system, model, rows.port1, device.p, device.p2, -1)
      if (sameNode(model, device.n, device.n2)) {
        // Shared return: i1 − i2 = 0.
        system.matrix[rows.port2][rows.port1] = cAdd(system.matrix[rows.port2][rows.port1], complex(1))
        system.matrix[rows.port2][rows.port2] = cSub(system.matrix[rows.port2][rows.port2], complex(1))
      } else {
        addComplexRowVoltage(system, model, rows.port2, device.n, device.n2, -1)
      }
    }
    return
  }

  const y11 = complex(0, -Math.cos(theta) / (sin * device.z0))
  const y12 = complex(0, 1 / (sin * device.z0))

  addComplexBranchKcl(system, model, rows.port1, device.p, device.n)
  system.matrix[rows.port1][rows.port1] = cAdd(system.matrix[rows.port1][rows.port1], complex(1))
  addComplexPortTerm(system, model, rows.port1, device.p, device.n, y11)
  addComplexPortTerm(system, model, rows.port1, device.p2, device.n2, y12)

  addComplexBranchKcl(system, model, rows.port2, device.p2, device.n2)
  system.matrix[rows.port2][rows.port2] = cAdd(system.matrix[rows.port2][rows.port2], complex(1))
  addComplexPortTerm(system, model, rows.port2, device.p, device.n, y12)
  addComplexPortTerm(system, model, rows.port2, device.p2, device.n2, y11)
}

/**
 * Stamp the complex small-signal system at angular frequency `omega`.
 *
 * Independent sources contribute their AC phasor. Diodes are replaced by the
 * conductance they present at the DC operating point — the standard
 * small-signal linearisation — which the caller must compute first with a DC
 * solve. An empty `diodeConductances` map therefore means "fully linear".
 */
export function stampAc(
  system: ComplexSystem,
  model: CircuitModel,
  omega: number,
  diodeConductances: ReadonlyMap<string, number>,
  gmin: number,
): void {
  for (const device of model.devices) {
    switch (device.kind) {
      case 'resistor':
        addComplexAdmittance(system, model, device.p, device.n, complex(1 / device.resistance + gmin))
        break
      case 'capacitor':
        // Admittance of a capacitor is jωC.
        addComplexAdmittance(system, model, device.p, device.n, complex(gmin, omega * device.capacitance))
        break
      case 'inductor': {
        const branch = model.branchRows.get(device.name)
        const a = model.nodeIndex.get(device.p)
        const b = model.nodeIndex.get(device.n)
        if (branch === undefined) break
        // Branch constraint: v(p) − v(n) − jωL·i = 0
        if (a !== undefined) {
          system.matrix[a][branch] = cAdd(system.matrix[a][branch], complex(1))
          system.matrix[branch][a] = cAdd(system.matrix[branch][a], complex(1))
        }
        if (b !== undefined) {
          system.matrix[b][branch] = cSub(system.matrix[b][branch], complex(1))
          system.matrix[branch][b] = cSub(system.matrix[branch][b], complex(1))
        }
        system.matrix[branch][branch] = cSub(system.matrix[branch][branch], complex(0, omega * device.inductance))
        break
      }
      case 'transmission-line':
        stampTransmissionLineAc(system, model, device, omega)
        break
      case 'voltage-source': {
        const branch = model.branchRows.get(device.name)
        const a = model.nodeIndex.get(device.p)
        const b = model.nodeIndex.get(device.n)
        if (branch === undefined) break
        if (a !== undefined) {
          system.matrix[a][branch] = cAdd(system.matrix[a][branch], complex(1))
          system.matrix[branch][a] = cAdd(system.matrix[branch][a], complex(1))
        }
        if (b !== undefined) {
          system.matrix[b][branch] = cSub(system.matrix[b][branch], complex(1))
          system.matrix[branch][b] = cSub(system.matrix[branch][b], complex(1))
        }
        const phase = (device.acPhaseDegrees * Math.PI) / 180
        system.rhs[branch] = complex(device.acMagnitude * Math.cos(phase), device.acMagnitude * Math.sin(phase))
        break
      }
      case 'current-source': {
        const phase = (device.acPhaseDegrees * Math.PI) / 180
        addComplexCurrent(
          system,
          model,
          device.p,
          device.n,
          complex(device.acMagnitude * Math.cos(phase), device.acMagnitude * Math.sin(phase)),
        )
        break
      }
      case 'diode': {
        const conductance = (diodeConductances.get(device.name) ?? 0) + gmin
        addComplexAdmittance(system, model, device.p, device.n, complex(conductance))
        break
      }
      case 'bjt':
      case 'mosfet':
      case 'jfet':
      case 'op-amp':
      case 'voltage-switch':
      case 'current-switch':
      case 'behavioral-source':
        /*
         * Linearised at the DC operating point by
         * `stampSemiconductorSmallSignal`, which the solver calls immediately
         * after this function — the same split the diodes already use, where
         * `stampAc` needs conductances the caller computed from a DC solve.
         */
        break
      case 'vcvs': {
        const branch = model.branchRows.get(device.name)
        if (branch === undefined) break
        const a = model.nodeIndex.get(device.p)
        const b = model.nodeIndex.get(device.n)
        if (a !== undefined) {
          system.matrix[a][branch] = cAdd(system.matrix[a][branch], complex(1))
          system.matrix[branch][a] = cAdd(system.matrix[branch][a], complex(1))
        }
        if (b !== undefined) {
          system.matrix[b][branch] = cSub(system.matrix[b][branch], complex(1))
          system.matrix[branch][b] = cSub(system.matrix[branch][b], complex(1))
        }
        const controlP = model.nodeIndex.get(device.ip)
        const controlN = model.nodeIndex.get(device.inn)
        if (controlP !== undefined) {
          system.matrix[branch][controlP] = cSub(system.matrix[branch][controlP], complex(device.gain))
        }
        if (controlN !== undefined) {
          system.matrix[branch][controlN] = cAdd(system.matrix[branch][controlN], complex(device.gain))
        }
        break
      }
      case 'vccs': {
        const a = model.nodeIndex.get(device.p)
        const b = model.nodeIndex.get(device.n)
        const controlP = model.nodeIndex.get(device.ip)
        const controlN = model.nodeIndex.get(device.inn)
        if (a !== undefined) {
          if (controlP !== undefined) system.matrix[a][controlP] = cAdd(system.matrix[a][controlP], complex(device.gain))
          if (controlN !== undefined) system.matrix[a][controlN] = cSub(system.matrix[a][controlN], complex(device.gain))
        }
        if (b !== undefined) {
          if (controlP !== undefined) system.matrix[b][controlP] = cSub(system.matrix[b][controlP], complex(device.gain))
          if (controlN !== undefined) system.matrix[b][controlN] = cAdd(system.matrix[b][controlN], complex(device.gain))
        }
        break
      }
    }
  }

  for (const pair of model.couplings) stampMutualInductanceAc(system, pair, model, omega)
}
