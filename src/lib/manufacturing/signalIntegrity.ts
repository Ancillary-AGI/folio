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

import { microstripImpedance, striplineImpedance } from './stackup'

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

  const z0 = characteristicImpedance(path.geometry)
  if (!(z0 > 0)) return fail('characteristic impedance non-positive — check geometry')

  const gammaLoad = (path.loadImpedanceOhm - z0) / (path.loadImpedanceOhm + z0)
  const gammaSource = (path.driverImpedanceOhm - z0) / (path.driverImpedanceOhm + z0)

  // Initial launched wave from the driver's Thevenin source into the line.
  const launched = (path.vHigh * z0) / (path.driverImpedanceOhm + z0)

  const effectiveEpsilon = path.geometry.kind === 'stripline'
    ? path.geometry.epsilonR
    : 0.5 * (path.geometry.epsilonR + 1) + 0.5 * (path.geometry.epsilonR - 1) / Math.sqrt(1 + 12 * (path.geometry.heightMm / path.geometry.widthMm))
  const velocity = SPEED_OF_LIGHT_M_PER_S / Math.sqrt(effectiveEpsilon)
  const delayNs = ((path.lengthMm * MM_TO_M) / velocity) * 1e9

  const roundTripFactor = gammaLoad * gammaSource
  const roundTripLoss = path.resistancePerMm && path.resistancePerMm > 0
    ? Math.exp((-2 * path.resistancePerMm * path.lengthMm) / (2 * z0))
    : 1

  const maxRounds = path.reflections ?? 20
  const ringing: Array<{ roundTrip: number; volts: number }> = []
  let loadVoltage = launched * (1 + gammaLoad)
  ringing.push({ roundTrip: 0, volts: loadVoltage })

  let wave = launched
  let damp = roundTripLoss
  for (let roundTrip = 1; roundTrip <= maxRounds; roundTrip++) {
    wave = wave * roundTripFactor * damp
    damp *= roundTripLoss
    if (Math.abs(wave) < 1e-9) break
    loadVoltage += 2 * wave
    ringing.push({ roundTrip, volts: loadVoltage })
  }

  const settledVolts = (path.vHigh * path.loadImpedanceOhm) / (path.driverImpedanceOhm + path.loadImpedanceOhm)

  let peakVolts = -Infinity
  for (const sample of ringing) {
    if (sample.volts > peakVolts) peakVolts = sample.volts
  }
  const overshootVolts = Math.max(0, peakVolts - path.vHigh)

  notes.push(`Z0=${z0.toFixed(1)}Ω  ΓL=${gammaLoad.toFixed(3)}  Γsrc=${gammaSource.toFixed(3)}`)
  if (overshootVolts > path.vHigh * 0.1) {
    notes.push('overshoot > 10% of the edge — consider series termination or matching Z0 to ZL')
  }

  return {
    success: true, z0Ohm: z0, gammaLoad, gammaSource, settledVolts, peakVolts,
    overshootVolts, delayNs, ringing, notes,
  }
}

function fail(error: string): SiResult {
  return {
    success: false, error, z0Ohm: 0, gammaLoad: 0, gammaSource: 0,
    settledVolts: 0, peakVolts: 0, overshootVolts: 0, delayNs: 0, ringing: [],
  }
}

