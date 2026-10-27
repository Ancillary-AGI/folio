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
 *  - Coupling measurement from the routed polylines themselves, so `gap` and
 *    `coupledLength` are measured off the copper instead of typed in.
 *  - Meander compensation: trombone length needed to kill a measured
 *    skew, with amplitude/period geometry that fits a keep-out height.
 *  - USB2 high-speed reference numbers (90 Ω differential, 150 ps intra-pair).
 *
 * Lengths in millimetres, skew in picoseconds, impedance in ohms.
 * Skew is converted to time through `pairSkewPs`, which needs the effective
 * permittivity the pair actually rides over — there is no dielectric constant
 * hidden in this file. `targetZ` is the declared intent of the pair: this
 * module checks the geometry that delivers it, and does not field-solve it.
 */
import { pairSkewPs } from './stackup'
import { pointSegmentDistance, segmentDistance } from '../geometry/distance'
import type { Point } from '../../types'

export interface DiffPair {
  name: string
  netP: string
  netN: string
  /** Target differential impedance, Ω. Declared intent — not solved here. */
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
  /** Effective permittivity of the dielectric the pair rides over. */
  erEff: number
}

/**
 * USB2 high-speed reference numbers: 90 Ω differential impedance and a 150 ps
 * intra-pair skew budget. The 150 µm spacing quoted in layout guides is a fab
 * recommendation tied to a specific stackup, so it is not carried here —
 * measure the routed gap instead (`measureCoupling`).
 */
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

/** One routed conductor: centre-line polyline and copper width, both in mm. */
export interface RoutedTrace {
  points: readonly Point[]
  widthMm: number
}

export interface CouplingMeasurement {
  /** Closest edge-to-edge approach of the two runs, mm (negative = overlap). */
  minGapMm: number
  /** Length of the P run whose closest approach is within `maxGapMm`, mm. */
  coupledLengthMm: number
  /** Routed length of the longer of the two runs, mm. */
  longerLegMm: number
  /** `coupledLengthMm / longerLegMm`; 0 when nothing is routed. */
  parallelRatio: number
}

interface TraceSegment {
  a: Point
  b: Point
  widthMm: number
  length: number
}

function segmentsOf(traces: readonly RoutedTrace[], side: string): TraceSegment[] {
  const segments: TraceSegment[] = []
  for (const trace of traces) {
    if (!(Number.isFinite(trace.widthMm) && trace.widthMm > 0)) {
      throw new Error(`${side}: trace width must be positive and finite.`)
    }
    for (let i = 1; i < trace.points.length; i += 1) {
      const a = trace.points[i - 1]
      const b = trace.points[i]
      segments.push({ a, b, widthMm: trace.widthMm, length: Math.hypot(b.x - a.x, b.y - a.y) })
    }
  }
  if (segments.length === 0) {
    throw new Error(`${side}: needs at least one routed segment to measure coupling.`)
  }
  return segments
}

/** Sample pitch for coupled-length accounting, mm. */
const COUPLING_SAMPLE_MM = 0.25

/**
 * Length of one P segment that stays within `maxGapMm` of the N run, measured
 * by walking the segment in `COUPLING_SAMPLE_MM` steps and counting the sub-steps
 * whose midpoint separation clears the threshold.
 */
function coupledRunOfSegment(
  segment: TraceSegment,
  opposite: readonly TraceSegment[],
  maxGapMm: number,
): number {
  const steps = Math.max(1, Math.ceil(segment.length / COUPLING_SAMPLE_MM))
  const stepLength = segment.length / steps
  const dx = segment.b.x - segment.a.x
  const dy = segment.b.y - segment.a.y
  let coupled = 0
  for (let i = 0; i < steps; i += 1) {
    const t = (i + 0.5) / steps
    const at: Point = { x: segment.a.x + dx * t, y: segment.a.y + dy * t }
    let nearest = Number.POSITIVE_INFINITY
    let nearestWidth = 0
    for (const other of opposite) {
      const centre = pointSegmentDistance(at, other.a, other.b)
      if (centre < nearest) {
        nearest = centre
        nearestWidth = other.widthMm
      }
      if (nearest === 0) break
    }
    if (nearest - segment.widthMm / 2 - nearestWidth / 2 <= maxGapMm) coupled += stepLength
  }
  return coupled
}

/**
 * Measure how two routed runs actually sit alongside each other.
 *
 * Distances are centre-line; the reported gap subtracts half of each
 * conductor's width, because a rule quoted edge-to-edge is not the same number
 * as one quoted centre-to-centre. `maxGapMm` is the designer's own coupling
 * threshold — the separation at and below which a section counts as coupled —
 * so `parallelRatio` means what `checkPair`'s coupling rule means.
 *
 * The closest approach uses exact segment-to-segment distance. Coupled length
 * is sampled along the P run every ~0.25 mm, because a segment's *nearest*
 * point says nothing about how much of it stays close: one whole diagonal leg
 * that leaves the pair would otherwise count as fully coupled.
 */
export function measureCoupling(
  tracesP: readonly RoutedTrace[],
  tracesN: readonly RoutedTrace[],
  maxGapMm: number,
): CouplingMeasurement {
  if (!Number.isFinite(maxGapMm) || maxGapMm <= 0) {
    throw new Error('coupling gap threshold must be positive and finite.')
  }
  const p = segmentsOf(tracesP, 'P side')
  const n = segmentsOf(tracesN, 'N side')
  let minGapMm = Number.POSITIVE_INFINITY
  let coupledLengthMm = 0
  let lengthP = 0
  let lengthN = 0
  for (const segment of p) {
    lengthP += segment.length
    let nearest = Number.POSITIVE_INFINITY
    let nearestWidth = 0
    for (const other of n) {
      const centre = segmentDistance(segment.a, segment.b, other.a, other.b)
      if (centre < nearest) {
        nearest = centre
        nearestWidth = other.widthMm
      }
      if (nearest === 0) break
    }
    const edgeGap = nearest - segment.widthMm / 2 - nearestWidth / 2
    if (edgeGap < minGapMm) minGapMm = edgeGap
    coupledLengthMm += coupledRunOfSegment(segment, n, maxGapMm)
  }
  for (const segment of n) lengthN += segment.length
  const longerLegMm = Math.max(lengthP, lengthN)
  return {
    minGapMm,
    coupledLengthMm,
    longerLegMm,
    parallelRatio: longerLegMm > 0 ? coupledLengthMm / longerLegMm : 0,
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
  if (!(Number.isFinite(pair.erEff) && pair.erEff >= 1)) {
    throw new Error(`${pair.name}: erEff must be finite and at least 1 — skew needs the dielectric the pair rides over.`)
  }
  const skewPs = pairSkewPs(pair.lengthP, pair.lengthN, pair.erEff)
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
  /** Routed run the lobes occupy — `lobes × period`, mm. */
  runMm: number
  /** Clear space needed perpendicular to the run, mm. */
  keepoutMm: number
}

/**
 * Trombone meander to kill `skewMm` of mismatch: lobes of the given
 * amplitude/period, each adding 2×amplitude beyond the straight run.
 * Returns the lobe count that covers the skew without overshooting more
 * than one lobe — the router places them, this sizes them.
 *
 * `runMm` and `keepoutMm` are what decides whether the compensation fits:
 * the lobes eat that much straight run and need that much room to the side.
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
  return {
    lobeLength,
    lobes,
    total: lobes * lobeLength,
    amplitude,
    period,
    runMm: lobes * period,
    keepoutMm: amplitude,
  }
}
