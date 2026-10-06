/**
 * Semiconductor physics: Gummel–Poon BJT, level-1 MOSFET and an op-amp
 * macromodel.
 *
 * The equations here are the ones SPICE itself uses, transcribed from the
 * reference implementation (ngspice `bjtload.c` / `bjttemp.c` and
 * `mos1load.c`), so a model card that came from a manufacturer library behaves
 * the same way in Folio as it does in reference SPICE:
 *
 *  • BJT — full Gummel–Poon: base charge `qb` from the Early voltages and the
 *    high-current rolloff corners, leakage diodes (ISE/ISC), ideal and
 *    non-ideal junction currents, series RB/RC/RE and the SPICE depletion
 *    capacitance law including the `fc` blend above the built-in potential.
 *  • MOSFET — level-1 Shichman–Hodges with body effect, channel-length
 *    modulation, the bulk diode and the gate overlap capacitances.
 *  • Op-amp — three-stage macromodel: differential input resistance, a
 *    transconductance first stage with a slew-rate current limit, a dominant
 *    pole set by the GBW product, and an output stage that saturates at
 *    `dropout` from each rail and carries the open-loop output resistance.
 *
 * Every function is pure: bias points are handed in, and only the stamping
 * helpers touch the matrix. The Jacobians are analytic (not finite
 * differences), which is what makes Newton converge in a handful of iterations
 * on a stiff bias point.
 */

import {
  type BehavioralSourceDevice,
  type BjtDevice,
  type CurrentSwitchDevice,
  type JfetDevice,
  type MosfetDevice,
  type OpAmpDevice,
  type VoltageSwitchDevice,
} from './devices'
import type { BehavioralExpression, CircuitModel } from './circuitModel'
import { behavioralCompiled, BEHAVIORAL_FUNCTIONS, type BehavioralNode } from './circuitModel'
import { cAdd, cSub, complex, type Complex } from './numeric'
import {
  addConductance,
  addCurrentInjection,
  addVoltageConstraint,
  type ComplexSystem,
  type RealSystem,
  type TransientState,
} from './stamping'

/* ────────────────────────────────────────────────────────────────────────────
 * Numeric helpers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Guarded exponential. SPICE caps the junction exponent (`MAX_EXP_ARG = 40` in
 * the reference code) because the true exponential is already dominated by
 * series resistance long before that; the cap only stops `Infinity` appearing in
 * the matrix and poisoning the whole solve.
 */
const MAX_EXP_ARG = 40

const safeExp = (argument: number): number => Math.exp(Math.min(argument, MAX_EXP_ARG))

/**
 * Junction depletion capacitance, exactly as SPICE computes it.
 *
 * Below `fc·VJ` it is the textbook `CJ·(1 − v/VJ)^(−MJ)`. Above it SPICE
 * switches to a straight line chosen so the value is continuous at `fc·VJ` and
 * stays positive, which is what stops an over-driven junction from producing a
 * negative or unbounded capacitance (and an unstable time step).
 */
function junctionCapacitance(cj: number, vj: number, mj: number, fc: number, voltage: number): number {
  if (!(cj > 0) || !(vj > 0)) return 0
  if (voltage < fc * vj) return cj * Math.pow(1 - voltage / vj, -mj)
  return cj * Math.pow(1 - fc, -(1 + mj)) * (1 - fc * (1 + mj) + (mj * voltage) / vj)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Matrix plumbing (real + complex)
 * ──────────────────────────────────────────────────────────────────────────── */

function addEntry(system: RealSystem, model: CircuitModel, row: string, column: string, value: number): void {
  const i = model.nodeIndex.get(row)
  const j = model.nodeIndex.get(column)
  if (i !== undefined && j !== undefined) system.matrix[i][j] += value
}

/** Inject `value` amperes into a node (MNA right-hand side). */
function addSource(system: RealSystem, model: CircuitModel, node: string, value: number): void {
  const i = model.nodeIndex.get(node)
  if (i !== undefined) system.rhs[i] += value
}

/**
 * Backward-Euler companion of a capacitance across (p, n).
 *
 * Identical discretisation to the linear capacitor stamp in `stamping.ts`, so a
 * BJT junction capacitance and a discrete capacitor of the same value produce
 * exactly the same discrete waveform.
 */
export function addCapacitorCompanion(
  system: RealSystem,
  model: CircuitModel,
  p: string,
  n: string,
  capacitance: number,
  dt: number,
  previousVoltage: number,
): void {
  const g = capacitance / dt
  if (!Number.isFinite(g) || g <= 0) return
  addConductance(system, model, p, n, g)
  addSource(system, model, p, g * previousVoltage)
  addSource(system, model, n, -g * previousVoltage)
}

/* ────────────────────────────────────────────────────────────────────────────
 * BJT: Gummel–Poon bias point
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BjtBias {
  /** Forward-positive junction voltages as solved: NPN `v(b) − v(e)`/`v(b) − v(c)`. */
  vbe: number
  vbc: number
  /** Terminal currents into the intrinsic device, A (NPN sense). */
  ic: number
  ib: number
  ie: number
  /** Jacobian entries of those currents, S. */
  dIcDVbe: number
  dIcDVbc: number
  dIbDVbe: number
  dIbDVbc: number
  /** Base-emitter and base-collector small-signal capacitances, F. */
  cPi: number
  cMu: number
}

/**
 * Evaluate the Gummel–Poon model at `(vbe, vbc)`.
 *
 * The base charge `qb` is what separates Gummel–Poon from the plain Ebers–Moll
 * model: the Early voltages make the collector current rise with `vce`, and the
 * IKF/IKR corners make beta fall at high current. Both are folded into `qb`,
 * whose derivatives are carried into the Jacobian (this is why Newton converges
 * on a saturated Power BJT instead of stalling).
 */
export function bjtBias(device: BjtDevice, vbe: number, vbc: number, thermal: number): BjtBias {
  const m = device.model
  const forwardArg = vbe / (m.nf * thermal)
  const reverseArg = vbc / (m.nr * thermal)
  const expForward = safeExp(forwardArg)
  const expReverse = safeExp(reverseArg)

  // Ideal transport currents and their conductances.
  const cbe = m.is * (expForward - 1)
  const cbc = m.is * (expReverse - 1)
  const gcbe = (m.is * expForward) / (m.nf * thermal)
  const gcbc = (m.is * expReverse) / (m.nr * thermal)

  // Non-ideal leakage diodes (recombination in the junctions).
  const leakForwardArg = vbe / (m.ne * thermal)
  const leakReverseArg = vbc / (m.nc * thermal)
  const expLeakForward = safeExp(leakForwardArg)
  const expLeakReverse = safeExp(leakReverseArg)
  const cbeLeak = m.ise * (expLeakForward - 1)
  const cbcLeak = m.isc * (expLeakReverse - 1)
  const gleakBe = (m.ise * expLeakForward) / (m.ne * thermal)
  const gleakBc = (m.isc * expLeakReverse) / (m.nc * thermal)

  /*
   * Base charge. `q1` is the Early term; `q2` is the high-current term.
   * Gummel–Poon divides the transfer current by `qb` but leaves the base
   * current's ideal components UNDIVIDED (SPICE: `ib = cbe/bf + cbc/br` with
   * no `/qb`): physically the stored base charge steals from the collector
   * transfer, not from the base recombination current. Dividing `ib` by `qb`
   * would compute beta·qb instead of beta — a 2N3904 with VAF=100 would read
   * BF=300 as ~247 in-circuit, which is exactly the failure this comment
   * guards against.
   */
  const denominator = 1 - vbc / m.vaf - vbe / m.var
  const clamped = denominator < 1e-4
  const q1 = 1 / (clamped ? 1e-4 : denominator)
  const dq1DVbe = clamped ? 0 : (q1 * q1) / m.var
  const dq1DVbc = clamped ? 0 : (q1 * q1) / m.vaf

  // 1/IKF and 1/IKR are exactly 0 for the default Infinity, so "off" needs no branch.
  const q2 = cbe / m.ikf + cbc / m.ikr
  const sq = Math.sqrt(Math.max(1 + 4 * q2, 1e-12))
  const qb = (q1 * (1 + sq)) / 2
  const dq2DVbe = gcbe / m.ikf
  const dq2DVbc = gcbc / m.ikr
  const dqbDVbe = (dq1DVbe * (1 + sq)) / 2 + (q1 * dq2DVbe) / sq
  const dqbDVbc = (dq1DVbc * (1 + sq)) / 2 + (q1 * dq2DVbc) / sq

  const transfer = cbe - cbc
  const it = transfer / qb
  const qbSquared = qb * qb
  const dItDVbe = (gcbe * qb - transfer * dqbDVbe) / qbSquared
  const dItDVbc = (-gcbc * qb - transfer * dqbDVbc) / qbSquared

  const ib = cbe / m.bf + cbeLeak + cbc / m.br + cbcLeak
  const ic = it - cbc / m.br - cbcLeak
  const dIbDVbe = gcbe / m.bf + gleakBe
  const dIbDVbc = gcbc / m.br + gleakBc
  const dIcDVbe = dItDVbe
  const dIcDVbc = dItDVbc - gcbc / m.br - gleakBc

  return {
    vbe,
    vbc,
    ic,
    ib,
    ie: -(ic + ib),
    dIcDVbe,
    dIcDVbc,
    dIbDVbe,
    dIbDVbc,
    // Cpi = CJE + TF·gm and Cmu = CJC + TR·gmr, the textbook charge model.
    cPi: junctionCapacitance(m.cje, m.vje, m.mje, m.fc, vbe) + m.tf * Math.max(dItDVbe, 0),
    cMu: junctionCapacitance(m.cjc, m.vjc, m.mjc, m.fc, vbc) + m.tr * Math.max(-dItDVbc, 0),
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Complex-domain plumbing
 * ──────────────────────────────────────────────────────────────────────────── */

function addComplexEntry(
  system: ComplexSystem,
  model: CircuitModel,
  row: string,
  column: string,
  value: Complex,
): void {
  const i = model.nodeIndex.get(row)
  const j = model.nodeIndex.get(column)
  if (i !== undefined && j !== undefined) system.matrix[i][j] = cAdd(system.matrix[i][j], value)
}

/** Add a complex admittance between two nodes (ground-safe). */
export function addComplexAdmittance(
  system: ComplexSystem,
  model: CircuitModel,
  p: string,
  n: string,
  y: Complex,
): void {
  addComplexEntry(system, model, p, p, y)
  addComplexEntry(system, model, n, n, y)
  addComplexEntry(system, model, p, n, cSub(complex(0), y))
  addComplexEntry(system, model, n, p, cSub(complex(0), y))
}

/* ────────────────────────────────────────────────────────────────────────────
 * BJT: companion stamping
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Terminal-current coefficients shared by the real (Newton) and complex
 * (small-signal) stamps.
 *
 * A PNP is stamped in physical node voltages while the bias point is mirrored:
 * each physical current is the negative of the model current, and each
 * physical voltage is the negative of the model voltage, so the two sign flips
 * cancel in every Jacobian entry (`d(−i)/d(−v) = di/dv`) and only the constant
 * terms carry the polarity factor `s`. Folding it here means the two domains
 * can never drift apart.
 *
 * Tuple layout per current: `[d/dVb, d/dVc, d/dVe, norton]`, where `norton`
 * is `i0 − g·v0` (the stamp adds `+g` entries and puts `-norton` on the row).
 */
function bjtPortCoefficients(
  device: BjtDevice,
  bias: BjtBias,
): { ic: [number, number, number, number]; ib: [number, number, number, number] } {
  const s = device.polarity === 'npn' ? 1 : -1
  // Entering-positive device rows: the Jacobian of the physical currents, then
  // the Norton constant `i0 − g·v0`. The stamps below put `-norton` on each
  // leaving-positive MNA row. The emitter row is the negative sum of the
  // other two, keeping ie + ic + ib = 0 to machine precision.
  return {
    ic: [
      bias.dIcDVbe + bias.dIcDVbc,
      -bias.dIcDVbc,
      -bias.dIcDVbe,
      s * (bias.ic - bias.dIcDVbe * bias.vbe - bias.dIcDVbc * bias.vbc),
    ],
    ib: [
      bias.dIbDVbe + bias.dIbDVbc,
      -bias.dIbDVbc,
      -bias.dIbDVbe,
      s * (bias.ib - bias.dIbDVbe * bias.vbe - bias.dIbDVbc * bias.vbc),
    ],
  }
}

/**
 * Newton companion stamp for one BJT.
 *
 * KCL is applied to the three intrinsic terminals: the collector and base rows
 * carry their own linearised currents, and the emitter row carries the negative
 * sum, which is what makes the device current-conserving to machine precision
 * (no artificial `ie = ic + ib` fudge). Series RB/RC/RE are stamped separately
 * in the linear pass, so the junctions always see the *internal* nodes.
 *
 * Sign bookkeeping (MNA rows are KCL sums of currents LEAVING the node):
 * linearising `ic(vb, vc, ve)` gives
 * `ic ≈ ic0 + gcb·(vb−vb0) + gcc·(vc−vc0) + gce·(ve−ve0)`, and the current
 * LEAVING the collector node is that `ic` — so the row gains `+g` entries and
 * the bias-point constant `-(ic0 − g·v0)` sits on the RHS, exactly like the
 * diode's `-Ieq` in `stampNonlinearDiodes`.
 */
export function stampBjt(
  system: RealSystem,
  model: CircuitModel,
  device: BjtDevice,
  bias: BjtBias,
  gmin: number,
): void {
  const { ic, ib } = bjtPortCoefficients(device, bias)
  const { cInt, bInt, eInt } = device
  const currents: Array<[string, [number, number, number, number]]> = [
    [cInt, ic],
    [bInt, ib],
  ]
  for (const [node, [dBase, dCollector, dEmitter, constant]] of currents) {
    addEntry(system, model, node, bInt, dBase)
    addEntry(system, model, node, cInt, dCollector)
    addEntry(system, model, node, eInt, dEmitter)
    // The bias-point constant enters KCL with the opposite sign.
    addSource(system, model, node, -constant)
  }
  addEntry(system, model, eInt, bInt, -(ic[0] + ib[0]))
  addEntry(system, model, eInt, cInt, -(ic[1] + ib[1]))
  addEntry(system, model, eInt, eInt, -(ic[2] + ib[2]))
  addSource(system, model, eInt, ic[3] + ib[3])

  // gmin across each junction, exactly as SPICE does: enough to keep an
  // unbiased junction (and an internal node) from being singular.
  addConductance(system, model, bInt, eInt, gmin)
  addConductance(system, model, bInt, cInt, gmin)
}

/**
 * Transient companions for the BJT junction capacitances.
 *
 * The capacitance *values* are frozen at the previous time step's bias (the
 * standard charge-control treatment) while the companion itself uses the
 * previous terminal voltages, so this stamp stays linear within a Newton
 * iteration and converges in one step.
 */
export function stampBjtCharges(
  system: RealSystem,
  model: CircuitModel,
  device: BjtDevice,
  state: TransientState,
  dt: number,
): void {
  const previous = state.bjtJunctions.get(device.name) ?? { vbe: 0, vbc: 0, cPi: 0, cMu: 0 }
  const s = device.polarity === 'npn' ? 1 : -1
  // The stored bias is forward-positive; the capacitor sees the physical node
  // difference, hence the `s`.
  addCapacitorCompanion(system, model, device.bInt, device.eInt, previous.cPi, dt, s * previous.vbe)
  addCapacitorCompanion(system, model, device.bInt, device.cInt, previous.cMu, dt, s * previous.vbc)
}

/**
 * Small-signal BJT: the same Jacobian as the Newton companion, evaluated at the
 * DC operating point, plus the junction capacitances as `jωC` admittances.
 */
export function stampBjtSmallSignal(
  system: ComplexSystem,
  model: CircuitModel,
  device: BjtDevice,
  bias: BjtBias,
  omega: number,
): void {
  const { ic, ib } = bjtPortCoefficients(device, bias)
  const { cInt, bInt, eInt } = device
  /*
   * Series RB/RC/RE belong to the small-signal network too: they are the same
   * ohmic elements the DC and transient passes stamp. Leaving them out makes an
   * AC sweep disagree with the operating point it was linearised about (a CE
   * stage would report an unloaded gain its DC bias cannot deliver).
   */
  const { rc, rb, re } = device.model
  if (cInt !== device.c) addComplexAdmittance(system, model, device.c, cInt, complex(1 / rc))
  if (bInt !== device.b) addComplexAdmittance(system, model, device.b, bInt, complex(1 / rb))
  if (eInt !== device.e) addComplexAdmittance(system, model, device.e, eInt, complex(1 / re))
  const rows: Array<[string, [number, number, number, number]]> = [
    [cInt, ic],
    [bInt, ib],
  ]
  for (const [node, [dBase, dCollector, dEmitter]] of rows) {
    addComplexEntry(system, model, node, bInt, complex(dBase))
    addComplexEntry(system, model, node, cInt, complex(dCollector))
    addComplexEntry(system, model, node, eInt, complex(dEmitter))
  }
  addComplexEntry(system, model, eInt, bInt, complex(-(ic[0] + ib[0])))
  addComplexEntry(system, model, eInt, cInt, complex(-(ic[1] + ib[1])))
  addComplexEntry(system, model, eInt, eInt, complex(-(ic[2] + ib[2])))
  addComplexAdmittance(system, model, bInt, eInt, complex(0, omega * bias.cPi))
  addComplexAdmittance(system, model, bInt, cInt, complex(0, omega * bias.cMu))
}

/* ────────────────────────────────────────────────────────────────────────────
 * JFET: SPICE level-1 (Shichman–Hodges for depletion devices)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface JfetBias {
  /** Forward-positive biases (mirror-corrected for a P-channel part). */
  vgs: number
  vds: number
  /** Drain current in the N-channel sense, A. */
  id: number
  /** Channel Jacobian, S: ∂id/∂vgs, ∂id/∂vds. */
  gm: number
  gds: number
  /** Effective pinch-off including nothing (no body effect on a JFET), V. */
  von: number
  /** Gate diode current into the gate, A, and its conductance, S. */
  ig: number
  gg: number
}

/** Region of operation, used in notes and tests. */
export type JfetRegion = 'cutoff' | 'triode' | 'saturation'

/**
 * Level-1 JFET bias point (the SPICE `jfet` model).
 *
 * Square law with threshold `VTO` (negative for N-channel): for
 * `vgs > vto`, `id = beta·(vgs−vto)²·(1+λ·vds)` in saturation and
 * `id = beta·vds·(2·(vgs−vto)−vds)·(1+λ·vds)` in triode. Below threshold the
 * channel is off. The gate junction is a diode that clamps a forward-biased
 * gate; the reverse gate current is the saturation current.
 */
export function jfetBias(device: JfetDevice, vgs: number, vds: number, thermal: number): JfetBias {
  const m = device.model
  const vto = device.polarity === 'n' ? -Math.abs(m.vto) : Math.abs(m.vto)
  const vgst = vgs - vto
  let id = 0
  let gm = 0
  let gds = 0
  if (vgst > 0) {
    if (vds < 0) {
      // Reverse Vds: source and drain swap roles, exactly as the MOSFET does
      // with its symmetric channel. Without this a self-biased stage whose
      // first iterate lands Vds < 0 reads Id = 0 and latches there.
      const vsd = -vds
      const factor = 1 + m.lambda * vsd
      if (vsd < vgst) {
        id = -m.beta * (2 * vgst * vsd - vsd * vsd) * factor
        gm = -2 * m.beta * vsd * factor
        gds = m.beta * (2 * (vgst - vsd) * factor + m.lambda * (2 * vgst * vsd - vsd * vsd))
      } else {
        id = -m.beta * vgst * vgst * factor
        gm = -2 * m.beta * vgst * factor
        gds = m.beta * vgst * vgst * m.lambda
      }
    } else {
      const factor = 1 + m.lambda * vds
      if (vds < vgst) {
        id = m.beta * (2 * vgst * vds - vds * vds) * factor
        gm = 2 * m.beta * vds * factor
        gds = m.beta * (2 * (vgst - vds) * factor + m.lambda * (2 * vgst * vds - vds * vds))
      } else {
        id = m.beta * vgst * vgst * factor
        gm = 2 * m.beta * vgst * factor
        gds = m.beta * vgst * vgst * m.lambda
      }
    }
  }
  const gateExp = safeExp(vgs / (m.n * thermal))
  const ig = m.is * (gateExp - 1)
  const gg = (m.is * gateExp) / (m.n * thermal)
  return { vgs, vds, id, gm, gds, von: vto, ig, gg }
}

/* ────────────────────────────────────────────────────────────────────────────
 * MOSFET: level-1 Shichman–Hodges
 * ──────────────────────────────────────────────────────────────────────────── */

export interface MosfetBias {
  /** Forward-positive biases, mirror-corrected for a P-channel part. */
  vgs: number
  vds: number
  vbs: number
  /** Drain current in the N-channel sense, A. */
  id: number
  /** Channel Jacobian, S: ∂id/∂vgs, ∂id/∂vds, ∂id/∂vbs. */
  gm: number
  gds: number
  gmb: number
  /** Effective threshold including the body effect, V. */
  von: number
  /** Body diode current into the bulk, A, and its conductance, S. */
  ibs: number
  gbs: number
  /** Gate overlap capacitances, F. */
  cgs: number
  cgd: number
}

/** Region of operation, used in notes and tests. */
export type MosfetRegion = 'cutoff' | 'triode' | 'saturation'

/**
 * Level-1 MOSFET bias point.
 *
 * SPICE evaluates the triode expression for `vds < vgs − von` and the
 * saturation expression beyond it, which is Schichman–Hodges verbatim. The bulk
 * threshold shift uses `sqrt(phi − vbs)` with the argument floored at a small
 * positive value: a strongly forward-biased bulk is clamped by the bulk diode,
 * which is stamped separately, so the square root is never asked for a negative
 * number.
 */
export function mosfetBias(
  device: MosfetDevice,
  vgs: number,
  vds: number,
  vbs: number,
  thermal: number,
): MosfetBias {
  const m = device.model
  /*
   * VTO is mirror-corrected like the voltages are: SPICE model cards quote a
   * P-channel threshold as a negative number (−2 V for an IRF9540), while this
   * function works in forward-positive variables where the same threshold is
   * +2 V. Everything else (KP, gamma, phi, lambda) is already polarity-neutral.
   */
  const vto = device.polarity === 'p' ? -m.vto : m.vto
  const arg = Math.max(m.phi - vbs, Math.abs(m.phi) * 1e-6 + 1e-12)
  const sarg = Math.sqrt(arg)
  const von = vto + m.gamma * (sarg - Math.sqrt(Math.max(m.phi, 0)))
  const dvonDVbs = -m.gamma / (2 * sarg)
  const vgst = vgs - von

  let id = 0
  let gm = 0
  let gds = 0
  if (vgst > 0) {
    const factor = 1 + m.lambda * vds
    if (vds < vgst) {
      id = m.kp * (vgst * vds - (vds * vds) / 2) * factor
      gm = m.kp * vds * factor
      gds = m.kp * ((vgst - vds) * factor + m.lambda * (vgst * vds - (vds * vds) / 2))
    } else {
      id = (m.kp / 2) * vgst * vgst * factor
      gm = m.kp * vgst * factor
      gds = (m.kp / 2) * vgst * vgst * m.lambda
    }
  }
  // ∂id/∂vbs = ∂id/∂vgst · (−∂von/∂vbs), which is positive when gamma > 0.
  const gmb = -gm * dvonDVbs

  const bodyExp = safeExp(vbs / (m.n * thermal))
  const ibs = m.is * (bodyExp - 1)
  const gbs = (m.is * bodyExp) / (m.n * thermal)

  return { vgs, vds, vbs, id, gm, gds, gmb, von, ibs, gbs, cgs: m.cgs, cgd: m.cgd }
}

/** Region of operation at a bias point (for notes, tests and reports). */
export function jfetRegion(bias: JfetBias): JfetRegion {
  const vgst = bias.vgs - bias.von
  if (vgst <= 0) return 'cutoff'
  return bias.vds < vgst ? 'triode' : 'saturation'
}

/** Forward-positive gate/source voltages of a JFET at a set of node voltages. */
export function jfetBiasAt(device: JfetDevice, voltages: ReadonlyMap<string, number>, thermal: number): JfetBias {
  const s = device.polarity === 'n' ? 1 : -1
  const source = voltages.get(device.s) ?? 0
  return jfetBias(device, s * ((voltages.get(device.g) ?? 0) - source), s * ((voltages.get(device.d) ?? 0) - source), thermal)
}

/**
 * Newton companion stamp for one JFET — the same Norton form as the MOSFET
 * (channel current plus gate diode), minus the bulk terminal.
 */
export function stampJfet(
  system: RealSystem,
  model: CircuitModel,
  device: JfetDevice,
  bias: JfetBias,
  gmin: number,
): void {
  const s = device.polarity === 'n' ? 1 : -1
  const constant = s * (bias.id - bias.gm * bias.vgs - bias.gds * bias.vds)
  const coefficients: Array<[string, number]> = [
    [device.g, bias.gm],
    [device.d, bias.gds],
    [device.s, -(bias.gm + bias.gds)],
  ]
  for (const [node, value] of coefficients) {
    addEntry(system, model, device.d, node, value)
    addEntry(system, model, device.s, node, -value)
  }
  addSource(system, model, device.d, -constant)
  addSource(system, model, device.s, constant)

  // Gate junction (forward diode; reverse leakage is the saturation current).
  const gateConstant = s * (bias.ig - bias.gg * bias.vgs)
  addEntry(system, model, device.g, device.g, bias.gg)
  addEntry(system, model, device.g, device.s, -bias.gg)
  addEntry(system, model, device.s, device.g, -bias.gg)
  addEntry(system, model, device.s, device.s, bias.gg)
  addSource(system, model, device.g, -gateConstant)
  addSource(system, model, device.s, gateConstant)

  addConductance(system, model, device.d, device.s, gmin)
}

/** Transient companions for the fixed gate capacitances. */
export function stampJfetCharges(
  system: RealSystem,
  model: CircuitModel,
  device: JfetDevice,
  state: TransientState,
  dt: number,
): void {
  const previous = state.jfetBias.get(device.name) ?? { vgs: 0, vds: 0, cgs: device.model.cgs, cgd: device.model.cgd }
  const s = device.polarity === 'n' ? 1 : -1
  addCapacitorCompanion(system, model, device.g, device.s, previous.cgs, dt, s * previous.vgs)
  addCapacitorCompanion(system, model, device.g, device.d, previous.cgd, dt, s * (previous.vgs - previous.vds))
}

/** Small-signal JFET at the DC bias point. */
export function stampJfetSmallSignal(
  system: ComplexSystem,
  model: CircuitModel,
  device: JfetDevice,
  bias: JfetBias,
  omega: number,
): void {
  const coefficients: Array<[string, number]> = [
    [device.g, bias.gm],
    [device.d, bias.gds],
    [device.s, -(bias.gm + bias.gds)],
  ]
  for (const [node, value] of coefficients) {
    addComplexEntry(system, model, device.d, node, complex(value))
    addComplexEntry(system, model, device.s, node, complex(-value))
  }
  addComplexAdmittance(system, model, device.g, device.s, complex(bias.gg, omega * device.model.cgs))
  addComplexAdmittance(system, model, device.g, device.d, complex(0, omega * device.model.cgd))
}

/** Region of operation at a bias point (for notes, tests and reports). */
export function mosfetRegion(bias: MosfetBias): MosfetRegion {
  const vgst = bias.vgs - bias.von
  if (vgst <= 0) return 'cutoff'
  return bias.vds < vgst ? 'triode' : 'saturation'
}

/**
 * Newton companion stamp for one MOSFET.
 *
 * The physical coefficients are polarity-independent (the mirror factor cancels
 * in the product `s·s`); only the bias-point constant flips sign, so one code
 * path serves N-channel and P-channel parts. The gate takes no DC current,
 * which leaves its row to the capacitances.
 */
export function stampMosfet(
  system: RealSystem,
  model: CircuitModel,
  device: MosfetDevice,
  bias: MosfetBias,
  gmin: number,
): void {
  const s = device.polarity === 'n' ? 1 : -1
  const d = device.d
  const source = device.s
  const constant = s * (bias.id - bias.gm * bias.vgs - bias.gds * bias.vds - bias.gmb * bias.vbs)
  const coefficients: Array<[string, number]> = [
    [device.g, bias.gm],
    [d, bias.gds],
    [device.b, bias.gmb],
    [source, -(bias.gm + bias.gds + bias.gmb)],
  ]
  for (const [node, value] of coefficients) {
    addEntry(system, model, d, node, value)
    addEntry(system, model, source, node, -value)
  }
  addSource(system, model, d, -constant)
  addSource(system, model, source, constant)

  // Bulk (source–bulk) diode.
  const bodyConstant = s * (bias.ibs - bias.gbs * bias.vbs)
  addEntry(system, model, device.b, device.b, bias.gbs)
  addEntry(system, model, device.b, source, -bias.gbs)
  addEntry(system, model, source, device.b, -bias.gbs)
  addEntry(system, model, source, source, bias.gbs)
  addSource(system, model, device.b, -bodyConstant)
  addSource(system, model, source, bodyConstant)

  // gmin from drain to source keeps an off transistor from isolating nodes.
  addConductance(system, model, d, source, gmin)
}

/** Transient companions for the fixed gate overlap capacitances. */
export function stampMosfetCharges(
  system: RealSystem,
  model: CircuitModel,
  device: MosfetDevice,
  state: TransientState,
  dt: number,
): void {
  const previous = state.mosfetBias.get(device.name) ?? {
    vgs: 0,
    vds: 0,
    vbs: 0,
    cgs: device.model.cgs,
    cgd: device.model.cgd,
  }
  const s = device.polarity === 'n' ? 1 : -1
  addCapacitorCompanion(system, model, device.g, device.s, previous.cgs, dt, s * previous.vgs)
  addCapacitorCompanion(system, model, device.g, device.d, previous.cgd, dt, s * previous.vds)
}

/**
 * Small-signal MOSFET: the channel Jacobian at the operating point plus the gate
 * capacitances as `jωC` admittances.
 */
export function stampMosfetSmallSignal(
  system: ComplexSystem,
  model: CircuitModel,
  device: MosfetDevice,
  bias: MosfetBias,
  omega: number,
): void {
  const d = device.d
  const source = device.s
  const coefficients: Array<[string, number]> = [
    [device.g, bias.gm],
    [d, bias.gds],
    [device.b, bias.gmb],
    [source, -(bias.gm + bias.gds + bias.gmb)],
  ]
  for (const [node, value] of coefficients) {
    addComplexEntry(system, model, d, node, complex(value))
    addComplexEntry(system, model, source, node, complex(-value))
  }
  addComplexEntry(system, model, device.b, device.b, complex(bias.gbs))
  addComplexEntry(system, model, device.b, source, complex(-bias.gbs))
  addComplexEntry(system, model, source, device.b, complex(-bias.gbs))
  addComplexEntry(system, model, source, source, complex(bias.gbs))
  addComplexAdmittance(system, model, device.g, source, complex(0, omega * bias.cgs))
  addComplexAdmittance(system, model, device.g, d, complex(0, omega * bias.cgd))
}

/* ────────────────────────────────────────────────────────────────────────────
 * Op-amp macromodel
 * ──────────────────────────────────────────────────────────────────────────── */

/** Ground is the reference node of the macromodel and is never an unknown. */
const GROUND_NODE = '0'

/**
 * Internal resistance that turns the open-loop gain into a stage
 * transconductance. Its absolute value is arbitrary — GBW and slew are set
 * afterwards from the part's data — but it must be fixed so `gain`, `gbw` and
 * `slew` stay independent knobs.
 */
export const OPAMP_STAGE_RESISTANCE = 1e6

export interface OpAmpParameters {
  /** First-stage transconductance, S. */
  stageGm: number
  /** Dominant-pole capacitance at the internal node, F. */
  internalCapacitance: number
  /** Stage current limit, A; `stageCurrent / internalCapacitance` is the slew rate. */
  stageCurrent: number
}

/** Derive the stage values from the part's gain, GBW and slew rate. */
export function opAmpParameters(device: OpAmpDevice): OpAmpParameters {
  const stageGm = device.gain / OPAMP_STAGE_RESISTANCE
  const internalCapacitance = stageGm / (2 * Math.PI * device.gbw)
  return { stageGm, internalCapacitance, stageCurrent: device.slew * internalCapacitance }
}

export interface OpAmpOutputRange {
  low: number
  high: number
}

/**
 * Output swing limits. A wired supply pin wins over the fixed fallback rail, so
 * the clamp follows a real 12 V supply (and prevents the classic "op-amp output
 * goes to 30 V because the model assumed ±15 V" mistake).
 */
export function opAmpOutputRange(
  device: OpAmpDevice,
  voltages: ReadonlyMap<string, number>,
): OpAmpOutputRange {
  const high = device.vPlusNode ? voltages.get(device.vPlusNode) ?? device.vPlusFixed : device.vPlusFixed
  const low = device.vMinusNode ? voltages.get(device.vMinusNode) ?? device.vMinusFixed : device.vMinusFixed
  return { low: low + device.dropout, high: high - device.dropout }
}

/**
 * Output-stage transfer: a unity-gain buffer that saturates smoothly at the
 * rails.
 *
 * A Hölder soft clip — `mid + halfSpan·u/(1 + |u|^10)^(1/10)` — keeps slope 1
 * to better than a percent out to half the rail distance and then bends to the
 * rail within a few percent, which is what a real output stage does: linear in
 * the middle, flat at the ends. It is monotonic with a strictly positive slope
 * (unlike a polynomial clip, which folds back), so Newton can always find the
 * clamped point, and the slope it reports is what small-signal analysis needs.
 */
export function opAmpLimiter(input: number, range: OpAmpOutputRange): { value: number; slope: number } {
  const mid = (range.high + range.low) / 2
  const halfSpan = Math.max((range.high - range.low) / 2, 5e-10)
  // |u| is capped so u^10 cannot overflow for absurd Newton iterates.
  const u = Math.max(-1e6, Math.min(1e6, (input - mid) / halfSpan))
  const u10 = Math.pow(Math.abs(u), 10)
  const root = Math.pow(1 + u10, 0.1)
  return { value: mid + halfSpan * (u / root), slope: Math.pow(1 + u10, -1.1) }
}

/**
 * Internal voltage at which the output stage sits at zero volts (its rest point).
 *
 * Inverts the Hölder clip: `value = 0` means `u/(1+|u|^10)^0.1 = target` with
 * `target = −mid/halfSpan`. The function is strictly increasing, so one guarded
 * Newton pass from the linear guess converges for every rail pair in practice
 * (25 iterations is generous; the usual case needs five). When the target is
 * outside the rails no rest point exists and the input is returned unchanged —
 * stamping then sees a railed stage, which is the truthful state.
 */
export function opAmpRestVoltage(range: OpAmpOutputRange): number {
  const mid = (range.high + range.low) / 2
  const halfSpan = Math.max((range.high - range.low) / 2, 5e-10)
  const target = -mid / halfSpan
  if (Math.abs(target) >= 1) return mid
  let u = target
  for (let iteration = 0; iteration < 25; iteration += 1) {
    const u10 = Math.pow(Math.abs(u), 10)
    const root = Math.pow(1 + u10, 0.1)
    const value = u / root - target
    const slope = Math.pow(1 + u10, -1.1)
    if (Math.abs(slope) < 1e-12) break
    const step = value / slope
    u -= step
    if (Math.abs(step) < 1e-13) break
  }
  return mid + halfSpan * u
}

/**
 * First-stage current injected into the internal node, with its
 * transconductance. The `tanh` shapes the current limit: the stage can never
 * deliver more than `stageCurrent`, which is exactly what limits the slew rate
 * to `stageCurrent / internalCapacitance`.
 */
export function opAmpStage(vid: number, parameters: OpAmpParameters): { current: number; gm: number } {
  const t = Math.tanh((parameters.stageGm * vid) / parameters.stageCurrent)
  return { current: parameters.stageCurrent * t, gm: parameters.stageGm * (1 - t * t) }
}

/** Bias point of the first stage, carried between Newton iterations. */
export interface OpAmpBiasPoint {
  /** Differential input voltage, V. */
  vid: number
  /** First-stage (internal) node voltage, V. */
  internal: number
}

/**
 * The bias-independent half of the op-amp: input resistance, the first-stage
 * load that turns gain into transconductance, and — in a transient run — the
 * dominant-pole capacitance.
 */
export function stampOpAmpLinear(
  system: RealSystem,
  model: CircuitModel,
  device: OpAmpDevice,
  companion?: { dt: number; state: TransientState },
): void {
  addConductance(system, model, device.inP, device.inN, 1 / device.rin)
  addConductance(system, model, device.internal, GROUND_NODE, 1 / OPAMP_STAGE_RESISTANCE)
  if (!companion) return
  const { internalCapacitance } = opAmpParameters(device)
  const previous = companion.state.opAmpStages.get(device.name) ?? 0
  addCapacitorCompanion(
    system,
    model,
    device.internal,
    GROUND_NODE,
    internalCapacitance,
    companion.dt,
    previous,
  )
}

/**
 * Newton stamp for the op-amp's two active stages.
 *
 * The first stage injects a limited current into the internal node; the second
 * is the saturating buffer, stamped as the branch constraint
 * `v(out) − slope·v(internal) + rout·i = bias constant`. Making the output
 * resistance part of the branch row (rather than a separate resistor) keeps the
 * node count the same while still loading the output and keeping the branch
 * current available for reporting.
 */
export function stampOpAmp(
  system: RealSystem,
  model: CircuitModel,
  device: OpAmpDevice,
  bias: OpAmpBiasPoint,
  range: OpAmpOutputRange,
): void {
  const parameters = opAmpParameters(device)
  const { current, gm } = opAmpStage(bias.vid, parameters)
  addEntry(system, model, device.internal, device.inP, gm)
  addEntry(system, model, device.internal, device.inN, -gm)
  addSource(system, model, device.internal, current - gm * bias.vid)

  const branch = model.branchRows.get(device.name)
  if (branch === undefined) return
  const { value, slope } = opAmpLimiter(bias.internal, range)
  const outIndex = model.nodeIndex.get(device.out)
  const internalIndex = model.nodeIndex.get(device.internal)
  if (outIndex !== undefined) {
    system.matrix[outIndex][branch] += 1
    system.matrix[branch][outIndex] += 1
  }
  if (internalIndex !== undefined) system.matrix[branch][internalIndex] -= slope
  system.matrix[branch][branch] += device.rout
  system.rhs[branch] = value - slope * bias.internal
}

/**
 * Small-signal op-amp: the stages linearised at the DC operating point, with the
 * dominant-pole capacitance as `jωC`.
 */
export function stampOpAmpSmallSignal(
  system: ComplexSystem,
  model: CircuitModel,
  device: OpAmpDevice,
  bias: OpAmpBiasPoint,
  range: OpAmpOutputRange,
  omega: number,
): void {
  const parameters = opAmpParameters(device)
  addComplexAdmittance(system, model, device.inP, device.inN, complex(1 / device.rin))
  addComplexAdmittance(
    system,
    model,
    device.internal,
    GROUND_NODE,
    cAdd(complex(1 / OPAMP_STAGE_RESISTANCE), complex(0, omega * parameters.internalCapacitance)),
  )
  const gm = opAmpStage(bias.vid, parameters).gm
  addComplexEntry(system, model, device.internal, device.inP, complex(gm))
  addComplexEntry(system, model, device.internal, device.inN, complex(-gm))

  const branch = model.branchRows.get(device.name)
  if (branch === undefined) return
  const slope = opAmpLimiter(bias.internal, range).slope
  const outIndex = model.nodeIndex.get(device.out)
  const internalIndex = model.nodeIndex.get(device.internal)
  if (outIndex !== undefined) {
    system.matrix[outIndex][branch] = cAdd(system.matrix[outIndex][branch], complex(1))
    system.matrix[branch][outIndex] = cAdd(system.matrix[branch][outIndex], complex(1))
  }
  if (internalIndex !== undefined) {
    system.matrix[branch][internalIndex] = cSub(system.matrix[branch][internalIndex], complex(slope))
  }
  system.matrix[branch][branch] = cAdd(system.matrix[branch][branch], complex(device.rout))
}

/* ────────────────────────────────────────────────────────────────────────────
 * Bias-point bookkeeping and domain entry points
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Every semiconductor bias point, keyed by device name.
 *
 * The solver carries this between Newton iterations exactly as it already
 * carries diode operating points: the companions are built from the previous
 * iterate, which is what makes the iteration a Newton step rather than a
 * (divergent) direct substitution.
 */
export interface SemiconductorState {
  bjt: Map<string, BjtBias>
  mosfet: Map<string, MosfetBias>
  jfet: Map<string, JfetBias>
  opAmp: Map<string, OpAmpBiasPoint>
  /** Switch on/off state from the previous Newton iteration (hysteresis). */
  switchOn: Map<string, boolean>
}

const EMPTY_VOLTAGES: ReadonlyMap<string, number> = new Map()

const voltageAt = (voltages: ReadonlyMap<string, number>, node: string): number => voltages.get(node) ?? 0

/**
 * Forward-positive junction voltages at a set of node voltages.
 *
 * The forward voltage is clamped to +1.0 V for companion evaluation: without a
 * clamp the first Newton iterate of a saturated stage can sit volts above the
 * junction, and `is·exp(5/Vt)` is a 10⁷⁰ A current source that makes the matrix
 * unsolvable. A real discrete BJT never needs more than ~0.9 V at sane
 * currents, so the clamp is inactive at every physical fixed point and only
 * steers the iteration path — the same job SPICE's `vlim` does.
 */
function bjtJunctionsAt(
  device: BjtDevice,
  voltages: ReadonlyMap<string, number>,
): { vbe: number; vbc: number } {
  const s = device.polarity === 'npn' ? 1 : -1
  const base = voltageAt(voltages, device.bInt)
  return {
    vbe: Math.min(s * (base - voltageAt(voltages, device.eInt)), 1.0),
    vbc: Math.min(s * (base - voltageAt(voltages, device.cInt)), 1.0),
  }
}

/** Forward-positive terminal voltages of a MOSFET at a set of node voltages. */
function mosfetBiasAt(
  device: MosfetDevice,
  voltages: ReadonlyMap<string, number>,
  thermal: number,
): MosfetBias {
  const s = device.polarity === 'n' ? 1 : -1
  const source = voltageAt(voltages, device.s)
  return mosfetBias(
    device,
    s * (voltageAt(voltages, device.g) - source),
    s * (voltageAt(voltages, device.d) - source),
    s * (voltageAt(voltages, device.b) - source),
    thermal,
  )
}

/**
 * Starting bias points.
 *
 * SPICE starts every junction at a modest forward bias, where the exponential is
 * well conditioned; the gates start just past threshold and the op-amp output
 * stage starts at its rest point, so the very first iteration already looks like
 * a powered-up circuit instead of an all-zero one.
 */
export function createSemiconductorState(model: CircuitModel, thermal: number): SemiconductorState {
  const bjt = new Map<string, BjtBias>()
  const mosfet = new Map<string, MosfetBias>()
  const jfet = new Map<string, JfetBias>()
  const opAmp = new Map<string, OpAmpBiasPoint>()
  const switchOn = new Map<string, boolean>()
  for (const device of model.devices) {
    if (device.kind === 'bjt') {
      bjt.set(device.name, bjtBias(device, 0.6, -0.6, thermal))
    } else if (device.kind === 'mosfet') {
      mosfet.set(device.name, mosfetBias(device, Math.abs(device.model.vto) + 0.5, 1, 0, thermal))
    } else if (device.kind === 'jfet') {
      jfet.set(device.name, jfetBias(device, 0, 1, thermal))
    } else if (device.kind === 'op-amp') {
      opAmp.set(device.name, {
        vid: 0,
        internal: opAmpRestVoltage(opAmpOutputRange(device, EMPTY_VOLTAGES)),
      })
    }
  }
  return { bjt, mosfet, jfet, opAmp, switchOn }
}

/** Bias points implied by a solved (or in-progress) solution vector. */
export function readSemiconductorState(
  model: CircuitModel,
  voltages: ReadonlyMap<string, number>,
  thermal: number,
  previous?: SemiconductorState,
): SemiconductorState {
  const state: SemiconductorState = {
    bjt: new Map(),
    mosfet: new Map(),
    jfet: new Map(),
    opAmp: new Map(),
    switchOn: previous ? new Map(previous.switchOn) : new Map(),
  }
  for (const device of model.devices) {
    if (device.kind === 'bjt') {
      const { vbe, vbc } = bjtJunctionsAt(device, voltages)
      state.bjt.set(device.name, bjtBias(device, vbe, vbc, thermal))
    } else if (device.kind === 'mosfet') {
      state.mosfet.set(device.name, mosfetBiasAt(device, voltages, thermal))
    } else if (device.kind === 'jfet') {
      state.jfet.set(device.name, jfetBiasAt(device, voltages, thermal))
    } else if (device.kind === 'op-amp') {
      state.opAmp.set(device.name, {
        vid: voltageAt(voltages, device.inP) - voltageAt(voltages, device.inN),
        internal: voltageAt(voltages, device.internal),
      })
    }
  }
  return state
}

/**
 * Bias-independent semiconductor parts.
 *
 * These belong to the linear pass because they never change with bias: the BJT
 * series resistances (RB/RC/RE) and the op-amp's input resistance, stage load
 * and — during a transient — its dominant-pole capacitance.
 */
export function stampSemiconductorLinear(
  system: RealSystem,
  model: CircuitModel,
  companion?: { dt: number; state: TransientState },
): void {
  for (const device of model.devices) {
    switch (device.kind) {
      case 'bjt': {
        const { rc, rb, re } = device.model
        if (device.cInt !== device.c) addConductance(system, model, device.c, device.cInt, 1 / rc)
        if (device.bInt !== device.b) addConductance(system, model, device.b, device.bInt, 1 / rb)
        if (device.eInt !== device.e) addConductance(system, model, device.e, device.eInt, 1 / re)
        break
      }
      case 'op-amp':
        stampOpAmpLinear(system, model, device, companion)
        break
      default:
        break
    }
  }
  // Junction and gate capacitances are charge companions, so they take the same
  // backward-Euler step as every other capacitor in the circuit.
  if (!companion) return
  for (const device of model.devices) {
    if (device.kind === 'bjt') stampBjtCharges(system, model, device, companion.state, companion.dt)
    if (device.kind === 'mosfet') stampMosfetCharges(system, model, device, companion.state, companion.dt)
    if (device.kind === 'jfet') stampJfetCharges(system, model, device, companion.state, companion.dt)
  }
}

/**
 * Refresh the previous-step state after a solved time step.
 *
 * The junction and gate capacitances are re-evaluated here — once per step,
 * which is the standard charge-control updating rule — so the companions stamped
 * during the next step are already correct without another Newton outer loop.
 */
export function updateTransientState(
  model: CircuitModel,
  state: TransientState,
  voltages: ReadonlyMap<string, number>,
  thermal: number,
): void {
  for (const device of model.devices) {
    if (device.kind === 'bjt') {
      const junctions = bjtJunctionsAt(device, voltages)
      const bias = bjtBias(device, junctions.vbe, junctions.vbc, thermal)
      state.bjtJunctions.set(device.name, {
        vbe: junctions.vbe,
        vbc: junctions.vbc,
        cPi: bias.cPi,
        cMu: bias.cMu,
      })
    } else if (device.kind === 'mosfet') {
      const bias = mosfetBiasAt(device, voltages, thermal)
      state.mosfetBias.set(device.name, {
        vgs: bias.vgs,
        vds: bias.vds,
        vbs: bias.vbs,
        cgs: bias.cgs,
        cgd: bias.cgd,
      })
    } else if (device.kind === 'jfet') {
      const bias = jfetBiasAt(device, voltages, thermal)
      state.jfetBias.set(device.name, { vgs: bias.vgs, vds: bias.vds, cgs: device.model.cgs, cgd: device.model.cgd })
    } else if (device.kind === 'op-amp') {
      state.opAmpStages.set(device.name, voltageAt(voltages, device.internal))
    }
  }
}

/**
 * Switch on/off state with hysteresis, SPICE S/W semantics.
 *
 * Above `vt + vh` the switch is on, below `vt − vh` it is off, and between the
 * two it keeps its previous state — which is why the previous state travels in
 * `SemiconductorState` rather than being recomputed from the control value.
 * With zero hysteresis the band collapses to a plain threshold.
 */
export function switchOnWithHysteresis(previous: boolean | undefined, control: number, vt: number, vh: number): boolean {
  if (control >= vt + vh) return true
  if (control <= vt - vh) return false
  return previous ?? control >= vt
}

/** Control value a switch decides on: a voltage difference or a source current. */
export function switchControlValue(
  device: VoltageSwitchDevice | CurrentSwitchDevice,
  voltages: ReadonlyMap<string, number>,
  currents: ReadonlyMap<string, number>,
): number {
  if (device.kind === 'voltage-switch') {
    return (voltages.get(device.ip) ?? 0) - (voltages.get(device.inn) ?? 0)
  }
  const wanted = device.controlSource.toUpperCase()
  for (const [name, current] of currents) {
    if (name.toUpperCase() === wanted) return current
  }
  return 0
}

/** Conductance of an open/closed switch: exactly ron or roff, never an ideal. */
export function switchConductance(device: VoltageSwitchDevice | CurrentSwitchDevice, on: boolean): number {
  return 1 / (on ? device.ron : device.roff)
}

/**
 * Newton stamp for a B source: evaluate at the iterate, linearise by finite
 * differences over the probed unknowns only.
 *
 * A closed-form Jacobian would need symbolic differentiation of the RPN; finite
 * differences over the handful of probed nodes give the same Newton step to
 * first order with a fraction of the code. The step is relative (1e-6 of the
 * probe magnitude, floored at 1e-9) so it scales from millivolts to kilovolts.
 * A voltage-output source becomes a branch constraint `v(p) − v(n) = value`;
 * a current-output source becomes a Norton injection with the same
 * linearisation. `gmin` across the output keeps an expression that momentarily
 * ignores its own terminals (e.g. `V = 5`) from isolating the nodes.
 */
export function stampBehavioralSource(
  system: RealSystem,
  model: CircuitModel,
  device: BehavioralSourceDevice,
  voltages: ReadonlyMap<string, number>,
  currents: ReadonlyMap<string, number>,
  time: number,
): void {
  const parsed = behavioralCompiled(device)
  if ('error' in parsed) return
  const compiled = parsed.expression
  const value = evaluateBehavioral(compiled, voltages, currents, time)
  // Finite-difference Jacobian over the probed unknowns.
  const derivatives = new Map<number, number>()
  for (const unknown of behavioralUnknowns(model, compiled)) {
    const probeValues = behavioralProbeMagnitudes(compiled, voltages, currents)
    const step = Math.max(1e-9, Math.abs(probeValues) * 1e-6)
    const perturbed = perturbBehavioralProbe(voltages, currents, compiled, unknown, model, step)
    if (!perturbed.changed) continue
    const moved = evaluateBehavioral(compiled, perturbed.voltages, perturbed.currents, time)
    derivatives.set(unknown.index, ((moved - value) / step) * unknown.sign)
  }
  if (device.output === 'v') {
    const branch = model.branchRows.get(device.name)
    if (branch === undefined) return
    addVoltageConstraint(system, model, branch, device.p, device.n, 0)
    let constant = value
    for (const [index, derivative] of derivatives) {
      system.matrix[branch][index] -= derivative
      constant -= derivative * solutionValueAt(model, voltages, currents, index)
    }
    system.rhs[branch] = constant
    addConductance(system, model, device.p, device.n, 1e-12)
    return
  }
  let constant = value
  for (const [index, derivative] of derivatives) {
    addBehavioralCurrentDerivative(system, model, device, index, derivative)
    constant -= derivative * solutionValueAt(model, voltages, currents, index)
  }
  addCurrentInjection(system, model, device.p, device.n, constant)
  addConductance(system, model, device.p, device.n, 1e-12)
}

/**
 * Evaluate a compiled B-source expression at node voltages / branch currents.
 *
 * Probes read the current Newton iterate, exactly like every other companion:
 * that is what makes the iteration a Newton step on the expression rather than
 * a fixed source. Non-finite results (division by zero, overflow) clamp to
 * ±1e12 — an unbounded source would otherwise poison the whole matrix.
 */
export function evaluateBehavioral(
  compiled: BehavioralExpression,
  voltages: ReadonlyMap<string, number>,
  currents: ReadonlyMap<string, number>,
  time: number,
): number {
  const stack: number[] = []
  const probeValue = (probe: BehavioralNode): number => {
    if (probe.kind === 'current') return currents.get(probe.source) ?? 0
    if (probe.kind === 'vdiff') return (voltages.get(probe.a) ?? 0) - (voltages.get(probe.b) ?? 0)
    return voltages.get(probe.node) ?? 0
  }
  for (const entry of compiled.rpn) {
    if (typeof entry === 'number') {
      stack.push(entry)
      continue
    }
    if (entry === 'T') {
      stack.push(time)
      continue
    }
    if (entry.startsWith('P')) {
      const probe = compiled.probes[Number(entry.slice(1))]
      stack.push(probe ? probeValue(probe) : 0)
      continue
    }
    if (entry.startsWith('F:')) {
      const [, name, countText] = entry.split(':')
      const count = Number(countText)
      const args: number[] = []
      for (let i = 0; i < count; i += 1) args.unshift(stack.pop() ?? 0)
      const fn = BEHAVIORAL_FUNCTIONS[name]
      stack.push(fn ? fn(...args) : NaN)
      continue
    }
    const b = stack.pop() ?? 0
    const a = stack.pop() ?? 0
    switch (entry) {
      case '+':
        stack.push(a + b)
        break
      case '-':
        stack.push(a - b)
        break
      case '*':
        stack.push(a * b)
        break
      case '/':
        stack.push(b !== 0 ? a / b : a >= 0 ? 1e12 : -1e12)
        break
      case '^':
        stack.push(Math.pow(a, b))
        break
      case '>':
        stack.push(a > b ? 1 : 0)
        break
      case '<':
        stack.push(a < b ? 1 : 0)
        break
      case '>=':
        stack.push(a >= b ? 1 : 0)
        break
      case '<=':
        stack.push(a <= b ? 1 : 0)
        break
      case '==':
        stack.push(a === b ? 1 : 0)
        break
      case '!=':
        stack.push(a !== b ? 1 : 0)
        break
      default:
        stack.push(NaN)
        break
    }
  }
  const value = stack.pop() ?? 0
  if (!Number.isFinite(value)) return value > 0 ? 1e12 : -1e12
  return Math.max(-1e12, Math.min(1e12, value))
}

/** A probed unknown the linearisation differentiates with respect to. */
interface BehavioralUnknown {
  /** Node index (voltage probe) or branch row (current probe). */
  index: number
  /** Sign of the probe in the expression (differential probes split in two). */
  sign: number
  /** True when the probe is a branch current rather than a node voltage. */
  isCurrent: boolean
}

/**
 * Map an expression's probes onto MNA unknowns.
 *
 * A voltage probe differentiates with respect to its node (ground probes drop
 * out — ground is not an unknown). A differential probe differentiates with
 * respect to both nodes with opposite signs. A current probe differentiates
 * with respect to the controlling source's branch row.
 */
function behavioralUnknowns(model: CircuitModel, compiled: BehavioralExpression): BehavioralUnknown[] {
  const unknowns: BehavioralUnknown[] = []
  for (const probe of compiled.probes) {
    if (probe.kind === 'voltage') {
      const index = model.nodeIndex.get(probe.node)
      if (index !== undefined) unknowns.push({ index, sign: 1, isCurrent: false })
    } else if (probe.kind === 'vdiff') {
      const a = model.nodeIndex.get(probe.a)
      const b = model.nodeIndex.get(probe.b)
      if (a !== undefined) unknowns.push({ index: a, sign: 1, isCurrent: false })
      if (b !== undefined) unknowns.push({ index: b, sign: -1, isCurrent: false })
    } else {
      const row = model.branchRows.get(probe.source)
      if (row !== undefined) unknowns.push({ index: row, sign: 1, isCurrent: true })
    }
  }
  return unknowns
}

/**
 * Perturb one probed unknown of the Newton iterate for a finite difference.
 *
 * Voltage probes shift a node voltage; current probes shift a branch current.
 * Ground has no row, so a grounded probe contributes nothing to perturb — the
 * caller skips it by the `changed` flag.
 */
function perturbBehavioralProbe(
  voltages: ReadonlyMap<string, number>,
  currents: ReadonlyMap<string, number>,
  compiled: BehavioralExpression,
  unknown: BehavioralUnknown,
  model: CircuitModel,
  step: number,
): { voltages: Map<string, number>; currents: Map<string, number>; changed: boolean } {
  const namesByIndex = new Map<number, string>()
  for (const [name, index] of model.nodeIndex) namesByIndex.set(index, name)
  if (!unknown.isCurrent) {
    const name = namesByIndex.get(unknown.index)
    if (name === undefined) return { voltages: new Map(voltages), currents: new Map(currents), changed: false }
    const next = new Map(voltages)
    next.set(name, (next.get(name) ?? 0) + unknown.sign * step)
    void compiled
    return { voltages: next, currents: new Map(currents), changed: true }
  }
  for (const [name, row] of model.branchRows) {
    if (row === unknown.index) {
      const next = new Map(currents)
      next.set(name.toUpperCase(), (next.get(name.toUpperCase()) ?? 0) + step)
      next.set(name, (next.get(name) ?? 0) + step)
      void compiled
      return { voltages: new Map(voltages), currents: next, changed: true }
    }
  }
  return { voltages: new Map(voltages), currents: new Map(currents), changed: false }
}

/**
 * Magnitude of the largest probed value: sets the finite-difference step.
 *
 * One shared step for the whole expression keeps the Jacobian consistent —
 * per-probe steps would mix scales when two probes of wildly different size
 * feed the same sum.
 */
function behavioralProbeMagnitudes(
  compiled: BehavioralExpression,
  voltages: ReadonlyMap<string, number>,
  currents: ReadonlyMap<string, number>,
): number {
  let peak = 0
  for (const probe of compiled.probes) {
    const value =
      probe.kind === 'current'
        ? (currents.get(probe.source) ?? 0)
        : probe.kind === 'vdiff'
          ? (voltages.get(probe.a) ?? 0) - (voltages.get(probe.b) ?? 0)
          : (voltages.get(probe.node) ?? 0)
    peak = Math.max(peak, Math.abs(value))
  }
  return peak
}

/** Value of unknown `index` in the current iterate (node voltage or branch current). */
function solutionValueAt(
  model: CircuitModel,
  voltages: ReadonlyMap<string, number>,
  currents: ReadonlyMap<string, number>,
  index: number,
): number {
  for (const [name, row] of model.branchRows) {
    if (row === index) return currents.get(name) ?? currents.get(name.toUpperCase()) ?? 0
  }
  for (const [name, node] of model.nodeIndex) {
    if (node === index) return voltages.get(name) ?? 0
  }
  return 0
}

/** Stamp one Jacobian entry of a current-output B source (leaving-positive). */
function addBehavioralCurrentDerivative(
  system: RealSystem,
  model: CircuitModel,
  device: BehavioralSourceDevice,
  index: number,
  derivative: number,
): void {
  const a = model.nodeIndex.get(device.p)
  const b = model.nodeIndex.get(device.n)
  if (a !== undefined) system.matrix[a][index] += derivative
  if (b !== undefined) system.matrix[b][index] -= derivative
}

/**
 * Small-signal B source: the expression linearised at the DC bias point.
 *
 * Only voltage probes contribute (a current probe needs the branch row, which
 * the complex stamp tracks separately); TIME freezes at 0, matching the DC
 * point the linearisation is taken at.
 */
export function stampBehavioralSmallSignal(
  system: ComplexSystem,
  model: CircuitModel,
  device: BehavioralSourceDevice,
  voltages: ReadonlyMap<string, number>,
  currents: ReadonlyMap<string, number>,
  omega: number,
  time: number,
): void {
  void omega
  const parsed = behavioralCompiled(device)
  if ('error' in parsed) return
  const compiled = parsed.expression
  const value = evaluateBehavioral(compiled, voltages, currents, time)
  const derivatives = new Map<number, number>()
  for (const unknown of behavioralUnknowns(model, compiled)) {
    if (unknown.isCurrent) continue
    const step = Math.max(1e-9, Math.abs(solutionValueAt(model, voltages, currents, unknown.index)) * 1e-6)
    const perturbed = perturbBehavioralProbe(voltages, currents, compiled, unknown, model, step)
    if (!perturbed.changed) continue
    const moved = evaluateBehavioral(compiled, perturbed.voltages, perturbed.currents, time)
    derivatives.set(unknown.index, ((moved - value) / step) * unknown.sign)
  }
  if (device.output === 'v') {
    const branch = model.branchRows.get(device.name)
    if (branch === undefined) return
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
    for (const [index, derivative] of derivatives) {
      system.matrix[branch][index] = cSub(system.matrix[branch][index], complex(derivative))
    }
    return
  }
  for (const [index, derivative] of derivatives) {
    const a = model.nodeIndex.get(device.p)
    const b = model.nodeIndex.get(device.n)
    if (a !== undefined) system.matrix[a][index] = cAdd(system.matrix[a][index], complex(derivative))
    if (b !== undefined) system.matrix[b][index] = cSub(system.matrix[b][index], complex(derivative))
  }
}

export function stampSemiconductorNonlinear(
  system: RealSystem,
  model: CircuitModel,
  state: SemiconductorState,
  thermal: number,
  voltages: ReadonlyMap<string, number>,
  gmin: number,
  context?: { currents?: ReadonlyMap<string, number>; time?: number },
): void {
  const branchCurrents = context?.currents ?? new Map<string, number>()
  const time = context?.time ?? 0
  for (const device of model.devices) {
    switch (device.kind) {
      case 'bjt': {
        const junctions = bjtJunctionsAt(device, voltages)
        const bias = state.bjt.get(device.name) ?? bjtBias(device, junctions.vbe, junctions.vbc, thermal)
        stampBjt(system, model, device, bias, gmin)
        break
      }
      case 'mosfet': {
        const bias = state.mosfet.get(device.name) ?? mosfetBiasAt(device, voltages, thermal)
        stampMosfet(system, model, device, bias, gmin)
        break
      }
      case 'jfet': {
        const bias = state.jfet.get(device.name) ?? jfetBiasAt(device, voltages, thermal)
        stampJfet(system, model, device, bias, gmin)
        break
      }
      case 'op-amp': {
        const bias = state.opAmp.get(device.name) ?? {
          vid: voltageAt(voltages, device.inP) - voltageAt(voltages, device.inN),
          internal: voltageAt(voltages, device.internal),
        }
        stampOpAmp(system, model, device, bias, opAmpOutputRange(device, voltages))
        break
      }
      case 'voltage-switch':
      case 'current-switch': {
        const control = switchControlValue(device, voltages, branchCurrents)
        const threshold = device.kind === 'voltage-switch' ? device.vt : device.it
        const hysteresis = device.kind === 'voltage-switch' ? device.vh : device.ih
        const on = switchOnWithHysteresis(state.switchOn.get(device.name), control, threshold, hysteresis)
        state.switchOn.set(device.name, on)
        addConductance(system, model, device.p, device.n, switchConductance(device, on))
        break
      }
      case 'behavioral-source': {
        stampBehavioralSource(system, model, device, voltages, branchCurrents, time)
        break
      }
      default:
        break
    }
  }
}

/** Small-signal stamps for every semiconductor device at the DC bias point. */
export function stampSemiconductorSmallSignal(
  system: ComplexSystem,
  model: CircuitModel,
  state: SemiconductorState,
  thermal: number,
  omega: number,
  voltages: ReadonlyMap<string, number>,
  context?: { currents?: ReadonlyMap<string, number>; time?: number },
): void {
  const branchCurrents = context?.currents ?? new Map<string, number>()
  const time = context?.time ?? 0
  for (const device of model.devices) {
    switch (device.kind) {
      case 'bjt': {
        const junctions = bjtJunctionsAt(device, voltages)
        const bias = state.bjt.get(device.name) ?? bjtBias(device, junctions.vbe, junctions.vbc, thermal)
        stampBjtSmallSignal(system, model, device, bias, omega)
        break
      }
      case 'mosfet': {
        const bias = state.mosfet.get(device.name) ?? mosfetBiasAt(device, voltages, thermal)
        stampMosfetSmallSignal(system, model, device, bias, omega)
        break
      }
      case 'jfet': {
        const bias = state.jfet.get(device.name) ?? jfetBiasAt(device, voltages, thermal)
        stampJfetSmallSignal(system, model, device, bias, omega)
        break
      }
      case 'voltage-switch':
      case 'current-switch': {
        const on = state.switchOn.get(device.name) ?? true
        addComplexAdmittance(system, model, device.p, device.n, complex(switchConductance(device, on)))
        break
      }
      case 'behavioral-source': {
        stampBehavioralSmallSignal(system, model, device, voltages, branchCurrents, omega, time)
        break
      }
      case 'op-amp': {
        const bias = state.opAmp.get(device.name) ?? {
          vid: voltageAt(voltages, device.inP) - voltageAt(voltages, device.inN),
          internal: voltageAt(voltages, device.internal),
        }
        stampOpAmpSmallSignal(system, model, device, bias, opAmpOutputRange(device, voltages), omega)
        break
      }
      default:
        break
    }
  }
}

