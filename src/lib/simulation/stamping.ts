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
import type { DiodeDevice } from './devices'
import type { CircuitModel } from './circuitModel'

export interface RealSystem {
  matrix: number[][]
  rhs: number[]
}

export interface ComplexSystem {
  matrix: Complex[][]
  rhs: Complex[]
}

/** State carried between transient time steps. Keyed by device name. */
export interface TransientState {
  capacitorVoltages: Map<string, number>
  inductorCurrents: Map<string, number>
}

export const createTransientState = (): TransientState => ({
  capacitorVoltages: new Map(),
  inductorCurrents: new Map(),
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
function addConductance(system: RealSystem, model: CircuitModel, p: string, n: string, g: number): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  if (a !== undefined) system.matrix[a][a] += g
  if (b !== undefined) system.matrix[b][b] += g
  if (a !== undefined && b !== undefined) {
    system.matrix[a][b] -= g
    system.matrix[b][a] -= g
  }
}

/** Inject `value` amperes flowing from `p` through the source to `n`. */
function addCurrentInjection(system: RealSystem, model: CircuitModel, p: string, n: string, value: number): void {
  const a = model.nodeIndex.get(p)
  const b = model.nodeIndex.get(n)
  // KCL: current leaving a node is positive, so an injected current is negative.
  if (a !== undefined) system.rhs[a] -= value
  if (b !== undefined) system.rhs[b] += value
}

/**
 * Stamp a voltage constraint `v(p) - v(n) = value` using the device's branch
 * row. Used for voltage sources (their DC value) and inductors (0 V in DC).
 */
function addVoltageConstraint(
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
 * Stamp the linear part of the DC system.
 * Capacitors become open circuits and inductors become shorts, which is what
 * "operating point" means for energy-storage elements.
 */
export function stampDc(system: RealSystem, model: CircuitModel): void {
  for (const device of model.devices) {
    switch (device.kind) {
      case 'resistor':
        addConductance(system, model, device.p, device.n, 1 / device.resistance)
        break
      case 'capacitor':
        break
      case 'inductor': {
        const branch = model.branchRows.get(device.name)
        if (branch !== undefined) addVoltageConstraint(system, model, branch, device.p, device.n, 0)
        break
      }
      case 'voltage-source': {
        const branch = model.branchRows.get(device.name)
        if (branch !== undefined) {
          addVoltageConstraint(system, model, branch, device.p, device.n, device.dcVoltage)
        }
        break
      }
      case 'current-source':
        addCurrentInjection(system, model, device.p, device.n, device.dcCurrent)
        break
      case 'diode':
        // Contributes through the Newton iteration, not here.
        break
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Transient (backward Euler)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Stamp the transient system for time step `dt` using backward Euler.
 *
 * Backward Euler is chosen over trapezoidal because it is unconditionally
 * stable and never rings on an ideal step — the failure mode a user is least
 * able to diagnose from a plot. First-order accuracy is the honest trade.
 *
 * Capacitor: `i = C·dv/dt`  →  `i ≈ (C/dt)(v − v_prev)`
 *   stamped as conductance `C/dt` plus an equivalent current source
 *   `(C/dt)·v_prev` feeding node `p`.
 * Inductor: `v = L·di/dt`  →  `v ≈ (L/dt)(i − i_prev)`
 *   stamped as the branch constraint `v(p) − v(n) − (L/dt)·i = −(L/dt)·i_prev`,
 *   which keeps the inductor current available as a state variable.
 */
export function stampTransient(system: RealSystem, model: CircuitModel, dt: number, state: TransientState): void {
  for (const device of model.devices) {
    switch (device.kind) {
      case 'resistor':
        addConductance(system, model, device.p, device.n, 1 / device.resistance)
        break
      case 'capacitor': {
        const conductance = device.capacitance / dt
        const previous = state.capacitorVoltages.get(device.name) ?? 0
        addConductance(system, model, device.p, device.n, conductance)
        // The companion source pushes charge into p and pulls it from n.
        addCurrentInjection(system, model, device.n, device.p, conductance * previous)
        break
      }
      case 'inductor': {
        const branch = model.branchRows.get(device.name)
        if (branch === undefined) break
        addVoltageConstraint(system, model, branch, device.p, device.n, 0)
        const ratio = device.inductance / dt
        system.rhs[branch] = -ratio * (state.inductorCurrents.get(device.name) ?? 0)
        system.matrix[branch][branch] -= ratio
        break
      }
      case 'voltage-source': {
        const branch = model.branchRows.get(device.name)
        if (branch !== undefined) {
          addVoltageConstraint(system, model, branch, device.p, device.n, device.dcVoltage)
        }
        break
      }
      case 'current-source':
        addCurrentInjection(system, model, device.p, device.n, device.dcCurrent)
        break
      case 'diode':
        break
    }
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
    }
  }
}
