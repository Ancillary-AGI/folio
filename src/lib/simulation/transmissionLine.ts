/**
 * Lossless transmission line (SPICE `T` element) — Branin traveling-wave model.
 *
 * A lossless line is not a lumped element: its port current at time t depends
 * on what happened at the *other* port one delay earlier. The exact model is
 * Branin's method. With port voltages `v1`, `v2` and port currents `i1`, `i2`
 * (both currents defined as entering the line):
 *
 *   v1 = Z0·i1 + e1,   e1 = v2(t−τ) + Z0·i2(t−τ)
 *   v2 = Z0·i2 + e2,   e2 = v1(t−τ) + Z0·i1(t−τ)
 *
 * `e1`/`e2` are the waves arriving from the far end; each port therefore looks
 * like a resistor Z0 in series with a voltage source fixed by the history. The
 * solver stamps each equation on its own branch row, which keeps the port
 * currents as first-class MNA unknowns (no 1 kΩ approximations and no
 * conductance/capacitance ladder).
 *
 * At DC (and at frequencies that are exact multiples of a half wavelength)
 * the line degenerates to ideal wires, handled by the stamping code as voltage
 * constraints. In the frequency domain the exact two-port admittance is
 *
 *   Y11 = Y22 = −j·cot θ / Z0,   Y12 = Y21 = +j·csc θ / Z0,   θ = ωτ.
 *
 * References:
 *   Branin (1967), IEEE Trans. Circuit Theory.
 *   SPICE2 User Manual §3.5 (T element).
 */

import type { TransmissionLineDevice } from './devices'

/** One accepted time-step sample at both ports. */
export interface TLineHistorySample {
  time: number
  /** Port-1 voltage and current (current entering the line). */
  v1: number
  i1: number
  /** Port-2 voltage and current (current entering the line). */
  v2: number
  i2: number
}

/** Per-device state carried between transient time steps. */
export interface TLineState {
  history: TLineHistorySample[]
}

export function createTLineState(): TLineState {
  return { history: [] }
}

/** A sample as a (voltage, current) pair for one port. */
function sampleAt(sample: TLineHistorySample, port: 1 | 2): { v: number; i: number } {
  return port === 1 ? { v: sample.v1, i: sample.i1 } : { v: sample.v2, i: sample.i2 }
}

/**
 * Look up the (V, I) values one delay in the past, linearly interpolated
 * between accepted samples. Outside the recorded window the nearest endpoint
 * is used: the oldest sample is the initial (DC or zero-energy) state, and the
 * newest is the best available estimate when the step is longer than the delay.
 */
function interpolateHistory(
  history: readonly TLineHistorySample[],
  targetTime: number,
  port: 1 | 2,
): { v: number; i: number } {
  if (history.length === 0) return { v: 0, i: 0 }
  const first = history[0]
  const last = history[history.length - 1]
  if (targetTime <= first.time) return sampleAt(first, port)
  if (targetTime >= last.time) return sampleAt(last, port)

  // Binary search for the first sample at or after the target time.
  let low = 0
  let high = history.length - 1
  while (low < high) {
    const middle = (low + high) >> 1
    if (history[middle].time < targetTime) low = middle + 1
    else high = middle
  }
  const newer = history[low]
  const older = history[low - 1] ?? newer
  const span = newer.time - older.time
  const fraction = span > 0 ? (targetTime - older.time) / span : 0
  const a = sampleAt(older, port)
  const b = sampleAt(newer, port)
  return {
    v: a.v + fraction * (b.v - a.v),
    i: a.i + fraction * (b.i - a.i),
  }
}

/**
 * Compute the Branin incident waves for the current time step.
 *
 * This is idempotent within a time step: Newton may stamp the linear system
 * several times, and the history must not be advanced until the step has
 * converged.
 */
export function computeTLineSources(
  device: TransmissionLineDevice,
  state: TLineState,
  currentTime: number,
): { e1: number; e2: number } {
  const target = currentTime - device.td
  const port1 = interpolateHistory(state.history, target, 1)
  const port2 = interpolateHistory(state.history, target, 2)
  // The wave arriving at port 1 left port 2 τ seconds ago and vice versa.
  return {
    e1: port2.v + device.z0 * port2.i,
    e2: port1.v + device.z0 * port1.i,
  }
}

/**
 * Record an accepted solution at `time`. Must be called only after Newton has
 * converged: a rejected or subdivided attempt must not contaminate the delay
 * history.
 */
export function recordTLineSample(
  device: TransmissionLineDevice,
  state: TLineState,
  time: number,
  v1: number,
  i1: number,
  v2: number,
  i2: number,
): void {
  const last = state.history[state.history.length - 1]
  if (last && time <= last.time) return
  state.history.push({ time, v1, i1, v2, i2 })

  /*
   * Keep one sample at or before the delay horizon so the next lookup can
   * interpolate, and drop everything older. Without the bracketing sample a
   * lookup between the horizon and the first newer sample would clamp to a
   * stale value.
   */
  const horizon = time - device.td
  let drop = 0
  while (drop + 1 < state.history.length && state.history[drop + 1].time <= horizon) {
    drop += 1
  }
  if (drop > 0) state.history.splice(0, drop)
}

/**
 * Effective permittivity of a microstrip line (Hammerstad–Jensen).
 * `widthMm` and `heightMm` are conductor width and substrate height in mm.
 */
export function microstripEffectiveEr(widthMm: number, heightMm: number, epsilonR: number): number {
  if (!(widthMm > 0) || !(heightMm > 0)) {
    throw new Error('Microstrip width and substrate height must be > 0 mm.')
  }
  if (!(epsilonR >= 1)) throw new Error('Relative permittivity must be >= 1.')
  const ratio = widthMm / heightMm
  const base = (epsilonR + 1) / 2 + ((epsilonR - 1) / 2) * Math.pow(1 + 12 / ratio, -0.5)
  return ratio < 1
    ? base + ((epsilonR - 1) / 2) * 0.04 * Math.pow(1 - ratio, 2)
    : base
}

/**
 * Characteristic impedance of a microstrip line, Ω.
 *
 * Uses the effective permittivity in both branches (the common zero-thickness
 * Hammerstad expressions). This is a design aid; a field solver is still the
 * authority for tightly coupled or very wide traces.
 */
export function z0FromGeometry(widthMm: number, heightMm: number, epsilonR: number): number {
  const effective = microstripEffectiveEr(widthMm, heightMm, epsilonR)
  const ratio = widthMm / heightMm
  if (ratio < 1) {
    return ((60 / Math.sqrt(effective)) * Math.log(8 / ratio + ratio / 4))
  }
  return (120 * Math.PI) / (Math.sqrt(effective) * (ratio + 1.393 + 0.667 * Math.log(ratio + 1.444)))
}

/**
 * One-way propagation delay (seconds) for a physical length and effective
 * relative permittivity: `td = length·√εr_eff / c`.
 */
export function tdFromGeometry(lengthMm: number, epsilonReff: number): number {
  if (!(lengthMm >= 0)) throw new Error('Trace length must be >= 0 mm.')
  if (!(epsilonReff >= 1)) throw new Error('Effective relative permittivity must be >= 1.')
  const c = 299792458
  return (lengthMm * 1e-3 * Math.sqrt(epsilonReff)) / c
}
