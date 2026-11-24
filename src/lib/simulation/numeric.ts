/**
 * Numeric core for the circuit simulator.
 *
 * Contains exactly three things, each independently testable:
 *   1. a minimal complex type with the operations MNA stamping needs;
 *   2. dense LU solvers with scaled partial pivoting for real and complex
 *      systems, both of which return `null` instead of throwing so callers can
 *      report a singular matrix as a *circuit* problem ("floating node"), not a
 *      programming error;
 *   3. a seeded PRNG, so Monte Carlo sweeps are reproducible run to run. A
 *      simulator that returns different numbers for the same input is not a
 *      simulator.
 *
 * No external maths dependency: the matrices here are at most a few hundred
 * unknowns, and a hand-rolled LU keeps the bundle small and the behaviour
 * auditable.
 */

export interface Complex {
  re: number
  im: number
}

export const complex = (re: number, im = 0): Complex => ({ re, im })

export const cAdd = (a: Complex, b: Complex): Complex => ({ re: a.re + b.re, im: a.im + b.im })

export const cSub = (a: Complex, b: Complex): Complex => ({ re: a.re - b.re, im: a.im - b.im })

export const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})

export const cDiv = (a: Complex, b: Complex): Complex => {
  const denominator = b.re * b.re + b.im * b.im
  if (denominator === 0) return { re: Number.NaN, im: Number.NaN }
  return {
    re: (a.re * b.re + a.im * b.im) / denominator,
    im: (a.im * b.re - a.re * b.im) / denominator,
  }
}

export const cScale = (a: Complex, factor: number): Complex => ({ re: a.re * factor, im: a.im * factor })

/** Magnitude (modulus) of a complex value. sqrt is ~3x faster than Math.hypot here. */
export const cAbs = (a: Complex): number => Math.sqrt(a.re * a.re + a.im * a.im)

/** Convert a magnitude and phase (radians) into a complex value. */
export const fromPolar = (magnitude: number, phaseRadians: number): Complex => ({
  re: magnitude * Math.cos(phaseRadians),
  im: magnitude * Math.sin(phaseRadians),
})

export const degreesToRadians = (degrees: number): number => (degrees * Math.PI) / 180

/* ────────────────────────────────────────────────────────────────────────────
 * Dense linear solvers
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Solve `A x = b` for a real dense system using LU with scaled partial pivoting.
 *
 * Scaling before pivoting is what makes this usable for circuits: MNA matrices
 * routinely mix 1e-3 S conductances with 1e6 Ω derivatives, and raw partial
 * pivoting picks the largest magnitude entry rather than the most reliable one.
 *
 * @returns the solution vector, or `null` when the system is singular.
 */
export function solveRealSystem(matrix: number[][], rightHandSide: readonly number[]): number[] | null {
  const size = rightHandSide.length
  if (size === 0) return []

  const a = matrix.map((row) => [...row])
  const b = [...rightHandSide]
  const scales = a.map((row) => row.reduce((max, value) => Math.max(max, Math.abs(value)), 0))

  if (scales.some((scale) => scale === 0)) return null

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column
    let bestRatio = 0
    for (let row = column; row < size; row += 1) {
      const ratio = Math.abs(a[row][column]) / scales[row]
      if (ratio > bestRatio) {
        bestRatio = ratio
        pivotRow = row
      }
    }
    if (bestRatio <= 1e-14) return null

    if (pivotRow !== column) {
      ;[a[column], a[pivotRow]] = [a[pivotRow], a[column]]
      ;[b[column], b[pivotRow]] = [b[pivotRow], b[column]]
      ;[scales[column], scales[pivotRow]] = [scales[pivotRow], scales[column]]
    }

    const pivot = a[column][column]
    for (let row = column + 1; row < size; row += 1) {
      const factor = a[row][column] / pivot
      if (factor === 0) continue
      a[row][column] = 0
      for (let entry = column + 1; entry < size; entry += 1) {
        a[row][entry] -= factor * a[column][entry]
      }
      b[row] -= factor * b[column]
    }
  }

  // Back substitution.
  const solution = new Array<number>(size).fill(0)
  for (let row = size - 1; row >= 0; row -= 1) {
    let sum = b[row]
    for (let column = row + 1; column < size; column += 1) {
      sum -= a[row][column] * solution[column]
    }
    const diagonal = a[row][row]
    if (diagonal === 0) return null
    solution[row] = sum / diagonal
  }

  return solution.every(Number.isFinite) ? solution : null
}

/**
 * Solve `A x = b` for a complex dense system (AC, noise).
 * Same pivoting strategy; magnitude is used to choose the pivot.
 *
 * @returns the solution vector, or `null` when the system is singular.
 */
export function solveComplexSystem(
  matrix: Complex[][],
  rightHandSide: readonly Complex[],
): Complex[] | null {
  const size = rightHandSide.length
  if (size === 0) return []

  const a = matrix.map((row) => row.map((value) => ({ ...value })))
  const b = rightHandSide.map((value) => ({ ...value }))
  const scales = a.map((row) => row.reduce((max, value) => Math.max(max, cAbs(value)), 0))

  if (scales.some((scale) => scale === 0)) return null

  for (let column = 0; column < size; column += 1) {
    let pivotRow = column
    let bestRatio = 0
    for (let row = column; row < size; row += 1) {
      // Inline magnitude: |a+bi| without object allocation.
      const re = a[row][column].re
      const im = a[row][column].im
      const ratio = Math.sqrt(re * re + im * im) / scales[row]
      if (ratio > bestRatio) {
        bestRatio = ratio
        pivotRow = row
      }
    }
    if (bestRatio <= 1e-14) return null

    if (pivotRow !== column) {
      ;[a[column], a[pivotRow]] = [a[pivotRow], a[column]]
      ;[b[column], b[pivotRow]] = [b[pivotRow], b[column]]
      ;[scales[column], scales[pivotRow]] = [scales[pivotRow], scales[column]]
    }

    const pivot = a[column][column]
    // Inline complex division + rank-1 update: zero per-entry allocation.
    // factor = a[row][column] / pivot
    const pr = pivot.re
    const pi = pivot.im
    const denom = pr * pr + pi * pi
    if (denom === 0) return null
    for (let row = column + 1; row < size; row += 1) {
      const nr = a[row][column].re
      const ni = a[row][column].im
      if (nr === 0 && ni === 0) continue
      const fr = (nr * pr + ni * pi) / denom
      const fi = (ni * pr - nr * pi) / denom
      if (!Number.isFinite(fr) || !Number.isFinite(fi)) return null
      a[row][column].re = 0
      a[row][column].im = 0
      const pivotRowArr = a[column]
      const targetRow = a[row]
      for (let entry = column + 1; entry < size; entry += 1) {
        const er = pivotRowArr[entry].re
        const ei = pivotRowArr[entry].im
        // target -= factor * pivotEntry (inlined cMul + cSub)
        targetRow[entry].re -= fr * er - fi * ei
        targetRow[entry].im -= fr * ei + fi * er
      }
      // b[row] -= factor * b[column] (inlined)
      const br = b[column].re
      const bi = b[column].im
      b[row].re -= fr * br - fi * bi
      b[row].im -= fr * bi + fi * br
    }
  }

  const solution = Array.from({ length: size }, () => complex(0))
  for (let row = size - 1; row >= 0; row -= 1) {
    let sr = b[row].re
    let si = b[row].im
    for (let column = row + 1; column < size; column += 1) {
      const er = a[row][column].re
      const ei = a[row][column].im
      const xr = solution[column].re
      const xi = solution[column].im
      sr -= er * xr - ei * xi
      si -= er * xi + ei * xr
    }
    const dr = a[row][row].re
    const di = a[row][row].im
    if (dr === 0 && di === 0) return null
    const dd = dr * dr + di * di
    solution[row].re = (sr * dr + si * di) / dd
    solution[row].im = (si * dr - sr * di) / dd
  }

  return solution.every((value) => Number.isFinite(value.re) && Number.isFinite(value.im))
    ? solution
    : null
}

/* ────────────────────────────────────────────────────────────────────────────
 * Deterministic randomness
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The only random source a simulator may use.
 *
 * Monte Carlo tolerance sweeps must be reproducible: the same netlist and the
 * same seed have to produce the same distribution, or a result cannot be
 * reviewed, regression-tested, or defended in a design review.
 *
 * mulberry32 — 32-bit state, excellent distribution for this purpose, and
 * trivially portable.
 */
export function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard-normal sample from a seeded uniform source (Box–Muller). */
export function gaussianFrom(random: () => number): number {
  // Guard against log(0) when the uniform source returns exactly zero.
  const u1 = Math.max(random(), Number.EPSILON)
  const u2 = random()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}
