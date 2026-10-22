/**
 * Lossless Transmission Line (SPICE T element).
 *
 * A transmission line is modelled using Branin's method: each end is replaced
 * by a dependent current source whose value is computed from the delayed
 * terminal voltage and current at the opposite end.  This gives an exact
 * (not lumped) model for a lossless line with characteristic impedance Z0 and
 * one-way delay TD = len/v_p.
 *
 * The voltage/current relationship:
 *   E1 = V(port1) + Z0·I(port1) (forward wave at port 1)
 *   E2 = V(port2) + Z0·I(port2) (forward wave at port 2)
 *
 * At time t+dt the Norton sources at each end are:
 *   I_src_port1 = (E2_delayed − V(port1_prev)·Z0_inv·E2_delayed) / Z0
 *               = 2·E2_delayed / Z0  − I(port1_prev)   [Branin]
 *
 * In practice we keep a circular history of (V, I) at each port and look up
 * the value one TD in the past.  For the DC operating point a lossless line
 * is treated as a direct wire (TD = 0 equivalent).
 *
 * References:
 *   Branin (1967), IEEE Trans. Circuit Theory.
 *   SPICE2 User Manual §3.5 (T element).
 */

export interface TransmissionLineDevice {
  name: string
  /** Port-1 positive node. */
  p1: string
  /** Port-1 negative node. */
  n1: string
  /** Port-2 positive node. */
  p2: string
  /** Port-2 negative node. */
  n2: string
  /** Characteristic impedance, Ω. */
  z0: number
  /** One-way propagation delay, seconds. */
  td: number
  /** Optional: lossy series resistance per unit length, Ω/m. */
  r?: number
  /** Length in metres (only needed when r > 0). */
  len?: number
}

/** One sample in the history ring buffer. */
export interface TLineHistorySample {
  time: number
  v1: number; i1: number
  v2: number; i2: number
}

/** Per-device simulation state. */
export interface TLineState {
  history: TLineHistorySample[]
  /** Equivalent current source values injected at each port during the last step. */
  e1: number  // Branin source at port 1
  e2: number  // Branin source at port 2
}

export function createTLineState(): TLineState {
  return { history: [], e1: 0, e2: 0 }
}

/**
 * Look up the delayed (V, I) at the given port by walking back `td` seconds
 * from `currentTime` in the history.  Returns the initial condition (0, 0)
 * when the history does not reach that far back.
 */
function interpolateHistory(
  history: TLineHistorySample[],
  currentTime: number,
  td: number,
  port: 1 | 2,
): { v: number; i: number } {
  const targetTime = currentTime - td
  if (targetTime < 0 || history.length === 0) return { v: 0, i: 0 }

  // Find the two samples that bracket targetTime (newest first)
  let lo = -1, hi = -1
  for (let k = history.length - 1; k >= 0; k--) {
    if (history[k].time <= targetTime) { lo = k; break }
    hi = k
  }
  if (lo < 0) return { v: 0, i: 0 }          // all samples are in the future
  if (hi < 0) {
    // targetTime is beyond the oldest sample — use the oldest
    const s = history[lo]
    return port === 1 ? { v: s.v1, i: s.i1 } : { v: s.v2, i: s.i2 }
  }

  // Linear interpolation between history[lo] and history[hi]
  const s0 = history[lo], s1 = history[hi]
  const span = s1.time - s0.time
  const f = span > 0 ? (targetTime - s0.time) / span : 0
  if (port === 1) return { v: s0.v1 + f * (s1.v1 - s0.v1), i: s0.i1 + f * (s1.i1 - s0.i1) }
  return { v: s0.v2 + f * (s1.v2 - s0.v2), i: s0.i2 + f * (s1.i2 - s0.i2) }
}

/**
 * Compute the Branin Norton equivalent sources for the current time step.
 *
 * Each port sees a resistor Z0 in parallel with a current source.
 * The current source is:  I_src = (2·E_delayed) / Z0
 * where E_delayed = V_far_delayed + Z0·I_far_delayed
 *
 * This is stamped by:
 *   1. Adding a conductance 1/Z0 at each port (resistive Z0 match).
 *   2. Injecting the Norton current source at each port.
 */
export function computeTLineSources(
  device: TransmissionLineDevice,
  state: TLineState,
  currentTime: number,
  v1: number, i1: number,
  v2: number, i2: number,
): { g: number; i_src_p1: number; i_src_p2: number } {
  const z0 = device.z0 > 0 ? device.z0 : 50  // default 50 Ω
  const g = 1 / z0

  // Forward waves at the delayed time
  const { v: v1d, i: i1d } = interpolateHistory(state.history, currentTime, device.td, 1)
  const { v: v2d, i: i2d } = interpolateHistory(state.history, currentTime, device.td, 2)

  // Branin sources (Equation from Branin 1967)
  const e1 = v2d + z0 * i2d   // forward wave arriving at port 1 from port 2
  const e2 = v1d + z0 * i1d   // forward wave arriving at port 2 from port 1

  state.e1 = e1
  state.e2 = e2

  // Record the current state
  state.history.push({ time: currentTime, v1, i1, v2, i2 })
  // Trim old entries (keep only what covers the delay window)
  while (state.history.length > 2 && state.history[0].time < currentTime - device.td * 2) {
    state.history.shift()
  }

  return {
    g,
    i_src_p1: 2 * e1 * g - i1,  // Norton source at port 1
    i_src_p2: 2 * e2 * g - i2,  // Norton source at port 2
  }
}

/**
 * Characteristic impedance from physical geometry using the microstrip formula.
 * Useful when the T element is built from a routed PCB trace.
 */
export function z0FromGeometry(widthMm: number, heightMm: number, epsilonR: number): number {
  const w = widthMm, h = heightMm, er = epsilonR
  const ratio = w / h
  if (ratio < 1) {
    const a = (60 / Math.sqrt(er)) * Math.log(8 / ratio + ratio / 4)
    return a
  }
  const eEff = (er + 1) / 2 + (er - 1) / 2 * Math.pow(1 + 12 / ratio, -0.5)
  return (120 * Math.PI) / (Math.sqrt(eEff) * (ratio + 1.393 + 0.667 * Math.log(ratio + 1.444)))
}

/**
 * Propagation delay (seconds) from physical trace length and dielectric constant.
 *   td = len / v_p  where  v_p = c / sqrt(εr_eff)
 */
export function tdFromGeometry(lengthMm: number, epsilonReff: number): number {
  const c = 299792458  // m/s
  const vp = c / Math.sqrt(epsilonReff)
  return (lengthMm * 1e-3) / vp
}
