/**
 * Eigenvalues of a real, general (non-symmetric) square matrix.
 *
 * The ML toolbox already ships a cyclic Jacobi solver, but Jacobi needs a
 * symmetric matrix and throws otherwise. The models that need stability answers
 * — linearised biological circuits, excitable membranes, the ventricle — have
 * non-symmetric Jacobians, because feedback goes one way: repression of A by B
 * says nothing about how A acts on B. So this module solves the general case.
 *
 * Method
 * ------
 * 1. Faddeev–LeVerrier builds the characteristic polynomial (a matrix-recurrence
 *    route, so no symbolic determinant expansion).
 * 2. `polynomialRoots` from the control toolbox finds the roots (closed-form
 *    quadratic for degree 2, Durand–Kerner with Newton polishing above that).
 * 3. The spectrum is *checked*, not trusted: the sum of the roots must reproduce
 *    the trace, and their product must reproduce a determinant computed
 *    independently by LU with partial pivoting.
 *
 * Step 3 is the reason this file exists rather than a bare root-find. A
 * characteristic-polynomial spectrum is only as good as the conditioning of the
 * coefficient vector, and that conditioning degrades with matrix size and with
 * widely scaled entries (a 4-state model whose entries span 1e-3 … 1e6 is normal
 * for physiology). The invariant check catches the cases where the polynomial
 * route has lost the roots, and throws instead of returning a plausible-looking
 * stability verdict.
 *
 * Honest limits: this is not a QR/Schur iteration, and the invariant check is
 * necessary but not sufficient — a scrambled spectrum that still sums to the
 * trace and multiplies to the determinant would pass it. What the check does
 * catch is a lost root, a dropped half of a conjugate pair (the root finder
 * snaps a tiny imaginary part to zero), an overflowed coefficient vector, and a
 * matrix so badly scaled that the polynomial route stops being trustworthy. For
 * matrices larger than about 12 states, or with a condition number near 1e12,
 * expect a throw rather than a spectrum; the caller is told to read stability
 * from the time-domain simulation instead. Eigenvectors are not computed —
 * stability needs the real parts, and mode shapes would need a null-space solve
 * per root.
 */

import { polynomialRoots, type Complex } from '../control/transferFunction'

export interface EigenSpectrum {
  /** One entry per root; complex-conjugate pairs both appear. */
  values: Complex[]
  /** Largest real part over the spectrum — the stability margin. */
  maxRealPart: number
  /**
   * Residual of the invariant checks: `max(|Σλ − tr A|, |Πλ − det A|)`, each
   * normalised by the magnitude of the quantity it reproduces.
   */
  checkTolerance: number
}

function assertSquare(matrix: readonly (readonly number[])[], label: string): number {
  const n = matrix.length
  if (n === 0) throw new Error(`${label}: expected a square matrix with at least one row.`)
  for (let r = 0; r < n; r += 1) {
    if (matrix[r].length !== n) {
      throw new Error(`${label}: row ${r} has ${matrix[r].length} entries, matrix has ${n} rows.`)
    }
    for (let c = 0; c < n; c += 1) {
      if (!Number.isFinite(matrix[r][c])) {
        throw new Error(`${label}[${r}][${c}] is ${matrix[r][c]}, not a finite number.`)
      }
    }
  }
  return n
}

function multiply(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): number[][] {
  const rows = a.length
  const inner = b.length
  const columns = b[0].length
  const out: number[][] = Array.from({ length: rows }, () => new Array<number>(columns).fill(0))
  for (let r = 0; r < rows; r += 1) {
    for (let k = 0; k < inner; k += 1) {
      const ark = a[r][k]
      if (ark === 0) continue
      for (let c = 0; c < columns; c += 1) out[r][c] += ark * b[k][c]
    }
  }
  return out
}

function trace(a: readonly (readonly number[])[]): number {
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i][i]
  return sum
}

/**
 * Characteristic polynomial coefficients in **descending** powers, so the result
 * feeds `polynomialRoots` directly: `p(λ) = λⁿ + c₁λⁿ⁻¹ + … + cₙ`.
 *
 * `pI − A` would be the other convention; descending order with a leading 1 is
 * what the rest of the codebase's polynomial code expects.
 */
export function characteristicPolynomial(matrix: readonly (readonly number[])[]): number[] {
  const n = assertSquare(matrix, 'characteristicPolynomial')
  const coefficients = new Array<number>(n + 1).fill(0)
  coefficients[0] = 1

  // M₁ = I; cₖ = −tr(A·Mₖ)/k; Mₖ₊₁ = A·Mₖ + cₖ·I
  let m: number[][] = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => (r === c ? 1 : 0)),
  )
  for (let k = 1; k <= n; k += 1) {
    const am = multiply(matrix, m)
    const cK = -trace(am) / k
    coefficients[k] = cK
    for (let i = 0; i < n; i += 1) am[i][i] += cK
    m = am
  }
  return coefficients
}

/**
 * Determinant by LU with partial pivoting — an implementation independent of the
 * Faddeev–LeVerrier recurrence, which is what makes it usable as a check.
 */
export function matrixDeterminant(matrix: readonly (readonly number[])[]): number {
  const n = assertSquare(matrix, 'matrixDeterminant')
  const work = matrix.map((row) => [...row])
  let product = 1
  let sign = 1

  for (let column = 0; column < n; column += 1) {
    let pivotRow = column
    let pivotMagnitude = Math.abs(work[pivotRow][column])
    for (let r = column + 1; r < n; r += 1) {
      const magnitude = Math.abs(work[r][column])
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude
        pivotRow = r
      }
    }
    if (pivotRow !== column) {
      const swap = work[column]
      work[column] = work[pivotRow]
      work[pivotRow] = swap
      sign = -sign
    }
    const pivot = work[column][column]
    product *= pivot
    if (pivot === 0) return 0
    for (let r = column + 1; r < n; r += 1) {
      const factor = work[r][column] / pivot
      if (factor === 0) continue
      for (let c = column + 1; c < n; c += 1) work[r][c] -= factor * work[column][c]
    }
  }
  return sign * product
}

/** Horner evaluation of a descending-power polynomial at a complex point. */
function evaluateComplex(coefficients: readonly number[], z: Complex): Complex {
  let value: Complex = { re: 0, im: 0 }
  for (const coefficient of coefficients) {
    value = {
      re: value.re * z.re - value.im * z.im + coefficient,
      im: value.re * z.im + value.im * z.re,
    }
  }
  return value
}

/**
 * Two Newton steps on the characteristic polynomial. Durand–Kerner is already
 * self-polishing, but a root sitting next to a cluster of nearby roots (which is
 * what a Hopf point looks like) benefits from the extra digits, and the cost is
 * two Horner evaluations.
 */
function polishRoot(coefficients: readonly number[], root: Complex): Complex {
  let current = { ...root }
  for (let step = 0; step < 2; step += 1) {
    const value = evaluateComplex(coefficients, current)
    // Derivative coefficients of a descending-power polynomial.
    const derivative: number[] = []
    for (let i = 0; i < coefficients.length - 1; i += 1) {
      derivative.push(coefficients[i] * (coefficients.length - 1 - i))
    }
    if (derivative.length === 0) break
    const slope = evaluateComplex(derivative, current)
    const magnitude = slope.re * slope.re + slope.im * slope.im
    if (!(magnitude > 0)) break
    const correction: Complex = {
      re: (value.re * slope.re + value.im * slope.im) / magnitude,
      im: (value.im * slope.re - value.re * slope.im) / magnitude,
    }
    if (!Number.isFinite(correction.re) || !Number.isFinite(correction.im)) break
    current = { re: current.re - correction.re, im: current.im - correction.im }
  }
  return current
}

/**
 * Eigenvalues of a real square matrix, validated against the trace and
 * determinant invariants before being returned.
 *
 * @param tolerance relative slack allowed in the invariant checks; a matrix whose
 *   entries span many orders of magnitude needs a looser one than a well-scaled
 *   Jacobian.
 */
export function matrixEigenvalues(
  matrix: readonly (readonly number[])[],
  tolerance = 1e-6,
): EigenSpectrum {
  const n = assertSquare(matrix, 'matrixEigenvalues')
  if (!Number.isFinite(tolerance) || tolerance <= 0) {
    throw new Error(`Eigen check tolerance must be positive and finite (got ${tolerance}).`)
  }
  // Documented ceiling, enforced: beyond this the coefficient vector of the
  // characteristic polynomial is a worse bet than watching the simulated trace.
  if (n > 12) {
    throw new Error(
      `matrixEigenvalues is limited to 12 states (got ${n}). The characteristic-polynomial route ` +
        'loses the roots on larger systems; judge stability from the simulated response instead.',
    )
  }

  const coefficients = characteristicPolynomial(matrix)
  const raw = polynomialRoots(coefficients)
  const values = raw.map((root) => polishRoot(coefficients, root))

  const scale = Math.max(1, ...matrix.map((row) => row.reduce((max, v) => Math.max(max, Math.abs(v)), 0)))
  let worst = 0

  /*
   * Σλ = tr A. The imaginary sum is normalised by the size of the roots rather
   * than by the trace, because the trace says nothing about it: a spectrum whose
   * real parts all cancel (a pure rotation) has trace 0, and dividing by that
   * would turn ordinary round-off in the imaginary parts into an infinite
   * residual. A leftover imaginary sum means a conjugate partner was lost.
   */
  const trueTrace = trace(matrix)
  let sumRe = 0
  let sumIm = 0
  for (const value of values) {
    sumRe += value.re
    sumIm += value.im
  }
  const rootScale = Math.max(scale, ...values.map((value) => Math.hypot(value.re, value.im)))
  worst = Math.max(worst, Math.abs(sumIm) / (rootScale * 1e-9))
  worst = Math.max(worst, Math.abs(sumRe - trueTrace) / Math.max(Math.abs(trueTrace), rootScale * 1e-9))

  // Πλ = (−1)ⁿ cₙ = det A.
  const trueDeterminant = matrixDeterminant(matrix)
  let productRe = 1
  let productIm = 0
  for (const value of values) {
    const nextRe = productRe * value.re - productIm * value.im
    productIm = productRe * value.im + productIm * value.re
    productRe = nextRe
  }
  const determinantScale = Math.max(Math.abs(trueDeterminant), scale ** n * Number.EPSILON)
  worst = Math.max(worst, Math.hypot(productRe - trueDeterminant, productIm) / determinantScale)

  if (!Number.isFinite(worst) || worst > tolerance) {
    throw new Error(
      `Eigenvalues of this ${n}×${n} matrix failed the trace/determinant check ` +
        `(relative residual ${worst.toExponential(2)} > ${tolerance}). The characteristic-polynomial ` +
        `route is ill-conditioned here — matrix entries span roughly ${scale.toExponential(1)}. ` +
        'Read stability from the simulated trace instead of a spectrum.',
    )
  }

  const maxRealPart = values.reduce((max, value) => Math.max(max, value.re), Number.NEGATIVE_INFINITY)
  return { values, maxRealPart, checkTolerance: worst }
}

/**
 * Linearised stability verdict.
 *
 * `margin` is the largest real part: negative means every perturbation decays,
 * positive means at least one grows. Exactly zero is the borderline (a pair on
 * the imaginary axis is the Hopf case) and is reported as `'marginal'` rather
 * than being rounded into one of the other two — a design sitting on a Hopf
 * point is not stable, however convenient that would be.
 */
export function linearStability(
  matrix: readonly (readonly number[])[],
  options: { tolerance?: number; marginalBand?: number } = {},
): { kind: 'stable' | 'unstable' | 'marginal'; margin: number; spectrum: EigenSpectrum } {
  const spectrum = matrixEigenvalues(matrix, options.tolerance ?? 1e-6)
  const band = options.marginalBand ?? 1e-9
  if (!Number.isFinite(band) || band < 0) throw new Error('Marginal band must be a non-negative number.')
  const kind = spectrum.maxRealPart > band ? 'unstable' : spectrum.maxRealPart < -band ? 'stable' : 'marginal'
  return { kind, margin: spectrum.maxRealPart, spectrum }
}
