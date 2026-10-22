/**
 * Transformer / Mutual Inductance (SPICE K element).
 *
 * A transformer is two coupled inductors. SPICE encodes it as:
 *   L1 <n1+> <n1-> <L1_henry>
 *   L2 <n2+> <n2-> <L2_henry>
 *   K1 L1 L2 <k>        ; coupling coefficient 0 < k ≤ 1
 *
 * Mutual inductance M = k · sqrt(L1 · L2).
 *
 * MNA adds the coupled-inductor voltage equations.  In backward-Euler
 * transient the discretised stamp is:
 *
 *   [iL1]   [L1/dt   M/dt ] [iL1 − iL1_prev]   [v_L1]
 *   [iL2] = [M/dt    L2/dt] [iL2 − iL2_prev] + [v_L2]   (dt > 0)
 *
 * which, after inversion of the 2×2 impedance matrix, gives the two
 * voltage-constraint rows added to the system.
 *
 * For a DC operating point both inductors are shorted (v = 0), identical
 * to uncoupled inductors — coupling only matters in transient and AC.
 *
 * For AC the branch admittance is jω times the inverse of the inductance
 * matrix, stamped as complex entries.
 */

import type { CircuitModel } from './circuitModel'
import type { RealSystem, ComplexSystem, TransientState } from './stamping'
import { complex, cAdd, cSub, type Complex } from './numeric'

export interface CoupledInductorPair {
  name: string            // K reference (K1, K2 …)
  l1Name: string          // reference designator of inductor 1
  l2Name: string          // reference designator of inductor 2
  k: number               // coupling coefficient [0, 1]
  l1Value: number         // inductance 1, henries
  l2Value: number         // inductance 2, henries
  // Node names resolved by the model builder
  l1p: string; l1n: string  // positive/negative nodes of L1
  l2p: string; l2n: string  // positive/negative nodes of L2
}

// ─── helpers ────────────────────────────────────────────────────────────────

function vRow(model: CircuitModel, node: string): number | undefined {
  return model.nodeIndex.get(node)
}

function branchRow(model: CircuitModel, name: string): number | undefined {
  const idx = model.branchRows.get(name)
  return idx
}

function addM(sys: RealSystem, i: number, j: number, v: number) {
  if (i !== undefined && j !== undefined) sys.matrix[i][j] += v
}

function addRhs(sys: RealSystem, i: number, v: number) {
  if (i !== undefined) sys.rhs[i] += v
}

function addComplexM(sys: ComplexSystem, i: number, j: number, v: Complex) {
  if (i !== undefined && j !== undefined)
    sys.matrix[i][j] = cAdd(sys.matrix[i][j], v)
}

// ─── DC stamp ────────────────────────────────────────────────────────────────
/**
 * At DC both inductors are shorted — nothing to add for coupling.
 * This function exists so the circuit model builder can call it without
 * branching.
 */
export function stampMutualInductanceDc(_sys: RealSystem, _pair: CoupledInductorPair, _model: CircuitModel): void {
  // inductors already stamp their v=0 constraint on their own branch rows
}

// ─── Transient stamp ─────────────────────────────────────────────────────────
/**
 * Backward-Euler stamp for coupled inductors.
 *
 * The inductance matrix is
 *   Z = [[L1, M], [M, L2]]  with M = k·sqrt(L1·L2)
 *
 * Inverted:
 *   Z^-1 = 1/(L1·L2 - M²) · [[L2, -M], [-M, L1]]
 *
 * The voltage equations in MNA are:
 *   v_L1 = L1 · d(iL1)/dt + M · d(iL2)/dt
 *   v_L2 = M  · d(iL1)/dt + L2 · d(iL2)/dt
 *
 * Discretised with backward-Euler (dt = h):
 *   v_L1 = (L1/h)·(iL1 − iL1_prev) + (M/h)·(iL2 − iL2_prev)
 *   v_L2 = (M/h) ·(iL1 − iL1_prev) + (L2/h)·(iL2 − iL2_prev)
 *
 * These are added to the two existing inductor branch rows by subtracting
 * the M/h cross-coupling terms (the L/h self terms are already stamped by
 * the uncoupled inductor stamp in stamping.ts).
 */
export function stampMutualInductanceTransient(
  sys: RealSystem,
  pair: CoupledInductorPair,
  model: CircuitModel,
  state: TransientState,
  dt: number,
): void {
  const M = pair.k * Math.sqrt(pair.l1Value * pair.l2Value)
  if (M === 0) return

  const row1 = branchRow(model, pair.l1Name)
  const row2 = branchRow(model, pair.l2Name)
  if (row1 === undefined || row2 === undefined) return

  const MH = M / dt

  // Cross-coupling in the branch rows
  // L1 row: + (M/h)·iL2 term → add M/h to [row1, row2] and subtract M/h · iL2_prev from rhs
  addM(sys, row1, row2, MH)
  const iL2Prev = state.inductorCurrents.get(pair.l2Name) ?? 0
  addRhs(sys, row1, MH * iL2Prev)

  // L2 row: + (M/h)·iL1 term
  addM(sys, row2, row1, MH)
  const iL1Prev = state.inductorCurrents.get(pair.l1Name) ?? 0
  addRhs(sys, row2, MH * iL1Prev)
}

// ─── AC stamp ────────────────────────────────────────────────────────────────
/**
 * AC small-signal stamp for coupled inductors.
 *
 * The cross-coupling impedance is jωM.  At frequency ω the coupled inductor
 * branch equations include cross terms that the uncoupled stamp omits.
 * We add +jωM to the off-diagonal branch/branch entries.
 */
export function stampMutualInductanceAc(
  sys: ComplexSystem,
  pair: CoupledInductorPair,
  model: CircuitModel,
  omega: number,
): void {
  const M = pair.k * Math.sqrt(pair.l1Value * pair.l2Value)
  if (M === 0) return

  const row1 = branchRow(model, pair.l1Name)
  const row2 = branchRow(model, pair.l2Name)
  if (row1 === undefined || row2 === undefined) return

  // jωM cross entries in both branch rows
  const jwM = complex(0, omega * M)
  addComplexM(sys, row1, row2, jwM)
  addComplexM(sys, row2, row1, jwM)
}

// ─── Ideal transformer helper ─────────────────────────────────────────────────
/**
 * Compute turns ratio and check sanity.  Returns null when either inductance
 * is zero (prevents NaN in sqrt).
 */
export function turnsRatio(pair: CoupledInductorPair): number | null {
  if (pair.l1Value <= 0 || pair.l2Value <= 0) return null
  return Math.sqrt(pair.l2Value / pair.l1Value)
}
