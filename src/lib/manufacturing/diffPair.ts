/**
 * Differential pairs + length tuning (Pi-class leg 2).
 *
 * USB, HDMI, DDR, Ethernet — every fast interface on a Pi-class board is
 * a length-matched differential pair, and nothing in the codebase modelled
 * one. This module is the routing-rule core:
 *
 *  - Pair definition: two nets with target differential impedance,
 *    intra-pair skew budget, and inter-pair (group) match window.
 *  - Pair checks against routed lengths: skew in ps, group mismatch,
 *    gap consistency (coupling needs parallel sections, not promises).
 *  - Meander compensation: trombone length needed to kill a measured
 *    skew, with amplitude/period geometry that fits a keep-out height.
 *  - USB2 reference rule (90 Ω, 150 µm gap, 150 ps intra-pair) built in.
 *
 * Lengths in millimetres, skew in picoseconds, impedance in ohms.
 * Propagation at 6 ps/mm (FR4 stripline); meanders add π/2 per lobe.
 */
import { pairSkewPs } from './stackup'

export interface DiffPair {
  name: string
  netP: string
  netN: string
  /** Target differential impedance, Ω. */
  targetZ: number
  /** Intra-pair skew budget, ps. */
  skewBudgetPs: number
}

export interface RoutedPair extends DiffPair {
  lengthP: number
  lengthN: number
  /** Edge-to-edge gap along the coupled section, mm. */
  gap: number
  /** Length actually routed parallel at that gap, mm. */
  coupledLength: number
}

/** USB2 high-speed rule: 90 Ω, 150 ps intra-pair budget. */
export const USB2_HS: Omit<DiffPair, 'name' | 'netP' | 'netN'> = {
  targetZ: 90,
  skewBudgetPs: 150,
}

export interface PairViolation {
  rule: 'intra-skew' | 'gap' | 'coupling' | 'group-skew'
  severity: 'error'
  message: string
  pair: string
}

const MIN_COUPLING_RATIO = 0.7

function assertRoutedLengths(pair: RoutedPair): void {
  for (const [label, value] of [
    ['lengthP', pair.lengthP],
    ['lengthN', pair.lengthN],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${pair.name}: ${label} must be zero or positive and finite.`)
    }
  }
}

/** Intra-pair skew, gap sanity, and coupling coverage for one pair. */
export function checkPair(pair: RoutedPair): { skewPs: number; violations: PairViolation[] } {
  const violations: PairViolation[] = []
  assertRoutedLengths(pair)
  if (!Number.isFinite(pair.gap)) {
    throw new Error(`${pair.name}: gap must be finite.`)
  }
  if (!Number.isFinite(pair.coupledLength) || pair.coupledLength < 0) {
    throw new Error(`${pair.name}: coupled length must be zero or positive and finite.`)
  }
  if (!Number.isFinite(pair.skewBudgetPs) || pair.skewBudgetPs < 0) {
    throw new Error(`${pair.name}: skew budget must be zero or positive and finite.`)
  }
  const skewPs = pairSkewPs(pair.lengthP, pair.lengthN)
  if (Math.abs(skewPs) > pair.skewBudgetPs) {
    violations.push({
      rule: 'intra-skew',
      severity: 'error',
      message: `${pair.name}: skew ${skewPs.toFixed(1)} ps exceeds ${pair.skewBudgetPs} ps.`,
      pair: pair.name,
    })
  }
  if (!(pair.gap > 0)) {
    violations.push({ rule: 'gap', severity: 'error', message: `${pair.name}: gap must be > 0.`, pair: pair.name })
  }
  const routed = Math.max(pair.lengthP, pair.lengthN)
  if (routed > 0 && pair.coupledLength / routed < MIN_COUPLING_RATIO) {
    violations.push({
      rule: 'coupling',
      severity: 'error',
      message: `${pair.name}: coupled ${(100 * pair.coupledLength / routed).toFixed(0)} % below 70 % minimum.`,
      pair: pair.name,
    })
  }
  return { skewPs, violations }
}

/** Group match: every pair's mean length inside the window, or violations. */
export function checkGroup(pairs: RoutedPair[], windowMm: number): PairViolation[] {
  if (!Number.isFinite(windowMm) || windowMm < 0) {
    throw new Error('group match window must be zero or positive and finite.')
  }
  const violations: PairViolation[] = []
  for (const pair of pairs) assertRoutedLengths(pair)
  if (pairs.length < 2) return violations
  const means = pairs.map((pair) => (pair.lengthP + pair.lengthN) / 2)
  const longest = Math.max(...means)
  pairs.forEach((pair, index) => {
    if (longest - means[index] > windowMm) {
      violations.push({
        rule: 'group-skew',
        severity: 'error',
        message: `${pair.name}: ${(longest - means[index]).toFixed(2)} mm behind longest, window ${windowMm} mm.`,
        pair: pair.name,
      })
    }
  })
  return violations
}

export interface Meander {
  /** Extra length one trombone lobe adds, mm. */
  lobeLength: number
  lobes: number
  /** Total compensation, mm. */
  total: number
  amplitude: number
  period: number
}

/**
 * Trombone meander to kill `skewMm` of mismatch: lobes of the given
 * amplitude/period, each adding ≈ 2×amplitude beyond the straight run.
 * Returns the lobe count that covers the skew without overshooting more
 * than one lobe — the router places them, this sizes them.
 */
export function meanderForSkew(skewMm: number, amplitude: number, period: number): Meander {
  if (!Number.isFinite(skewMm)) throw new Error('skew must be finite')
  if (!Number.isFinite(amplitude) || amplitude <= 0) throw new Error('meander amplitude must be positive and finite')
  if (!Number.isFinite(period) || period <= 0) throw new Error('meander period must be positive and finite')
  const target = Math.abs(skewMm)
  // A rectangular trombone replaces a straight run with two legs of `amplitude`,
  // so each lobe adds 2×amplitude regardless of the horizontal period.
  const lobeLength = 2 * amplitude
  const lobes = target <= 0 ? 0 : Math.max(1, Math.ceil(target / lobeLength))
  return { lobeLength, lobes, total: lobes * lobeLength, amplitude, period }
}
