/**
 * Dense linear algebra for the ML toolbox.
 *
 * Scope is deliberately small — the toolbox solves regression, GP and PCA
 * problems whose matrices fit in memory — and every routine validates its
 * inputs instead of returning NaN silently. A solver that quietly produced a
 * non-finite coefficient vector would poison every downstream design number.
 */

export type Matrix = number[][]
export type Vector = number[]

export function zeros(rows: number, columns: number): Matrix {
  return Array.from({ length: rows }, () => new Array<number>(columns).fill(0))
}

export function vectorOf(length: number, fill = 0): Vector {
  return new Array<number>(length).fill(fill)
}

export function assertFiniteMatrix(matrix: Matrix, label: string): void {
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (!Number.isFinite(matrix[r][c])) {
        throw new Error(`${label}[${r}][${c}] is ${matrix[r][c]}, not a finite number.`)
      }
    }
  }
}

export function transpose(matrix: Matrix): Matrix {
  if (matrix.length === 0) return []
  const columns = matrix[0].length
  const result = zeros(columns, matrix.length)
  for (let r = 0; r < matrix.length; r += 1) {
    if (matrix[r].length !== columns) {
      throw new Error(`Cannot transpose a ragged matrix (row ${r} has ${matrix[r].length} entries, expected ${columns}).`)
    }
    for (let c = 0; c < columns; c += 1) result[c][r] = matrix[r][c]
  }
  return result
}

export function multiplyMatrices(a: Matrix, b: Matrix): Matrix {
  const inner = b.length
  for (let r = 0; r < a.length; r += 1) {
    if (a[r].length !== inner) {
      throw new Error(`Matrix inner dimensions disagree: row ${r} of A has ${a[r].length}, B has ${inner} rows.`)
    }
  }
  const columns = inner > 0 ? b[0].length : 0
  const result = zeros(a.length, columns)
  for (let r = 0; r < a.length; r += 1) {
    for (let k = 0; k < inner; k += 1) {
      const aRk = a[r][k]
      if (aRk === 0) continue
      for (let c = 0; c < columns; c += 1) result[r][c] += aRk * b[k][c]
    }
  }
  return result
}

/**
 * Square solve by Gaussian elimination with partial pivoting.
 * Throws on a singular (or numerically degenerate) matrix rather than returning
 * the garbage a divide-by-pivot-zero would produce.
 */
export function solveLinearSystem(coefficients: Matrix, rhs: Vector): Vector {
  const n = coefficients.length
  if (n === 0) return []
  if (coefficients.some((row) => row.length !== n)) throw new Error('solveLinearSystem needs a square matrix.')
  if (rhs.length !== n) throw new Error(`Right-hand side has ${rhs.length} entries, matrix has ${n} rows.`)

  const augmented = coefficients.map((row, r) => [...row, rhs[r]])
  assertFiniteMatrix(augmented, 'solveLinearSystem input')

  for (let pivotColumn = 0; pivotColumn < n; pivotColumn += 1) {
    let pivotRow = pivotColumn
    let pivotMagnitude = Math.abs(augmented[pivotRow][pivotColumn])
    for (let r = pivotColumn + 1; r < n; r += 1) {
      const magnitude = Math.abs(augmented[r][pivotColumn])
      if (magnitude > pivotMagnitude) {
        pivotMagnitude = magnitude
        pivotRow = r
      }
    }
    // Relative to the scale of the matrix, not to an absolute floor: a well-scaled
    // problem with tiny entries is still solvable.
    const rowScale = Math.max(...augmented.map((row) => Math.max(...row.map(Math.abs))), 1)
    if (pivotMagnitude < 1e-14 * rowScale) {
      throw new Error(`Matrix is singular or numerically degenerate at column ${pivotColumn}.`)
    }
    if (pivotRow !== pivotColumn) {
      const swap = augmented[pivotColumn]
      augmented[pivotColumn] = augmented[pivotRow]
      augmented[pivotRow] = swap
    }
    const pivot = augmented[pivotColumn][pivotColumn]
    for (let r = pivotColumn + 1; r < n; r += 1) {
      const factor = augmented[r][pivotColumn] / pivot
      if (factor === 0) continue
      for (let c = pivotColumn; c <= n; c += 1) augmented[r][c] -= factor * augmented[pivotColumn][c]
    }
  }

  const solution = vectorOf(n)
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = augmented[r][n]
    for (let c = r + 1; c < n; c += 1) sum -= augmented[r][c] * solution[c]
    solution[r] = sum / augmented[r][r]
  }
  if (solution.some((value) => !Number.isFinite(value))) throw new Error('Linear solve produced a non-finite value.')
  return solution
}

/**
 * Least squares by modified Gram-Schmidt orthogonalisation (with a second
 * re-orthogonalisation pass for stability), then back substitution on R.
 *
 * QR is used rather than the normal equations because a Vandermonde design
 * matrix — exactly what polynomial fits build — loses half its precision when
 * squared. Plain Gaussian elimination on [A | b] is *not* a least-squares
 * solver (it only reproduces the exact solution when the system is consistent),
 * so the orthonormal basis is formed explicitly here.
 *
 * `ridgeLambda` enters as an augmented √λ·I block. `penalisedColumns` says which
 * columns that block touches; it defaults to all of them, and callers with an
 * intercept column pass it as `false` — penalising an intercept shrinks the fit
 * toward zero rather than toward the mean, which is never what was meant.
 */
export function leastSquares(
  design: Matrix,
  target: Vector,
  ridgeLambda = 0,
  penalisedColumns?: readonly boolean[],
): Vector {
  if (design.length === 0) throw new Error('Least squares needs at least one observation.')
  if (target.length !== design.length) throw new Error('Observation and target counts disagree.')
  const parameters = design[0].length
  if (parameters === 0) throw new Error('Least squares needs at least one predictor column.')
  if (design.some((row) => row.length !== parameters)) throw new Error('Ragged design matrix.')
  if (ridgeLambda < 0 || !Number.isFinite(ridgeLambda)) {
    throw new Error(`Ridge lambda must be a finite non-negative number, got ${ridgeLambda}.`)
  }
  if (penalisedColumns !== undefined && penalisedColumns.length !== parameters) {
    throw new Error(`Penalty mask has ${penalisedColumns.length} entries for ${parameters} predictor columns.`)
  }
  assertFiniteMatrix(design, 'leastSquares design')
  if (target.some((value) => !Number.isFinite(value))) throw new Error('leastSquares target has a non-finite value.')

  const isPenalised = (j: number): boolean => ridgeLambda > 0 && (penalisedColumns?.[j] ?? true)
  const ridgeRows = ridgeLambda > 0 ? parameters : 0
  const rows = design.length + ridgeRows
  const rhs: Vector = [...target, ...vectorOf(ridgeRows, 0)]

  // Column j of the (possibly augmented) design matrix.
  const columnOf = (j: number): Vector => {
    const column = vectorOf(rows)
    for (let r = 0; r < design.length; r += 1) column[r] = design[r][j]
    if (isPenalised(j)) column[design.length + j] = Math.sqrt(ridgeLambda)
    return column
  }

  const scale = Math.max(
    1,
    ...Array.from({ length: parameters }, (_, j) => Math.sqrt(dot(columnOf(j), columnOf(j)))),
  )

  const basis: Vector[] = []
  const upper: Matrix = zeros(parameters, parameters)
  for (let j = 0; j < parameters; j += 1) {
    const working = columnOf(j)
    // Two passes: the first removes the projections, the second cleans up the
    // round-off the first leaves behind, which is what keeps RᵗR ≈ AᵗA honest.
    for (let pass = 0; pass < 2; pass += 1) {
      for (let k = 0; k < j; k += 1) {
        const overlap = dot(basis[k], working)
        upper[k][j] += overlap
        for (let r = 0; r < rows; r += 1) working[r] -= overlap * basis[k][r]
      }
    }
    const length = Math.sqrt(dot(working, working))
    if (length < 1e-13 * scale) {
      throw new Error(
        `Design matrix is rank-deficient at column ${j}: the predictors are collinear ` +
          'or an unused basis scale is degenerate. Add ridge regularisation or drop columns.',
      )
    }
    for (let r = 0; r < rows; r += 1) working[r] /= length
    upper[j][j] = length
    basis.push(working)
  }

  const projected = basis.map((q) => dot(q, rhs))
  const solution = vectorOf(parameters)
  for (let r = parameters - 1; r >= 0; r -= 1) {
    let sum = projected[r]
    for (let c = r + 1; c < parameters; c += 1) sum -= upper[r][c] * solution[c]
    solution[r] = sum / upper[r][r]
  }
  if (solution.some((value) => !Number.isFinite(value))) throw new Error('Least squares produced a non-finite coefficient.')
  return solution
}

/**
 * Cholesky factorisation (lower triangle) of a symmetric positive-definite
 * matrix. `jitter` is added to the diagonal on the first attempt and raised
 * geometrically, which is how a Gram matrix made of nearly-coincident training
 * points is kept invertible without pretending it was well conditioned.
 */
export function cholesky(matrix: Matrix, jitter = 1e-10): Matrix {
  const n = matrix.length
  if (n === 0) return []
  if (matrix.some((row) => row.length !== n)) throw new Error('Cholesky needs a square matrix.')
  assertFiniteMatrix(matrix, 'cholesky input')

  let attempt = jitter
  for (let retry = 0; retry < 8; retry += 1) {
    const factor = zeros(n, n)
    let positive = true
    for (let r = 0; r < n && positive; r += 1) {
      for (let c = 0; c <= r; c += 1) {
        let sum = matrix[r][c] + (r === c ? attempt : 0)
        for (let k = 0; k < c; k += 1) sum -= factor[r][k] * factor[c][k]
        if (r === c) {
          if (sum <= 0) {
            positive = false
            break
          }
          factor[r][c] = Math.sqrt(sum)
        } else {
          factor[r][c] = sum / factor[c][c]
        }
      }
    }
    if (positive) return factor
    attempt *= 10
  }
  throw new Error(
    'Kernel matrix is not positive definite even after 8 orders of diagonal jitter; ' +
      'the training points are numerically coincident or the amplitude/length-scale is invalid.',
  )
}

/** Forward substitution L·x = b. */
export function forwardSubstitute(lower: Matrix, rhs: Vector): Vector {
  const n = lower.length
  const solution = vectorOf(n)
  for (let r = 0; r < n; r += 1) {
    let sum = rhs[r]
    for (let c = 0; c < r; c += 1) sum -= lower[r][c] * solution[c]
    solution[r] = sum / lower[r][r]
  }
  return solution
}

/** Back substitution Lᵗ·x = b. */
export function backSubstituteTranspose(lower: Matrix, rhs: Vector): Vector {
  const n = lower.length
  const solution = vectorOf(n)
  for (let r = n - 1; r >= 0; r -= 1) {
    let sum = rhs[r]
    for (let c = r + 1; c < n; c += 1) sum -= lower[c][r] * solution[c]
    solution[r] = sum / lower[r][r]
  }
  return solution
}

export interface EigenDecomposition {
  /** Eigenvalues in descending order. */
  values: number[]
  /** Columns are the matching orthonormal eigenvectors. */
  vectors: Matrix
}

/**
 * Cyclic Jacobi eigen-solve for a real symmetric matrix.
 * Slow versus QR iteration but short, branch-light, and it returns exact
 * eigenvectors, which is what PCA needs.
 */
export function symmetricEigen(input: Matrix, sweepLimit = 100): EigenDecomposition {
  const n = input.length
  if (n === 0) return { values: [], vectors: [] }
  if (input.some((row) => row.length !== n)) throw new Error('Jacobi eigen needs a square matrix.')
  assertFiniteMatrix(input, 'jacobi input')
  for (let r = 0; r < n; r += 1) {
    for (let c = r + 1; c < n; c += 1) {
      if (Math.abs(input[r][c] - input[c][r]) > 1e-9 * Math.max(1, Math.abs(input[r][c]))) {
        throw new Error(`Jacobi eigen needs a symmetric matrix; [${r}][${c}]=${input[r][c]} vs [${c}][${r}]=${input[c][r]}.`)
      }
    }
  }

  const working = input.map((row) => [...row])
  const vectors = zeros(n, n)
  for (let i = 0; i < n; i += 1) vectors[i][i] = 1

  for (let sweep = 0; sweep < sweepLimit; sweep += 1) {
    let offDiagonal = 0
    for (let r = 0; r < n; r += 1) {
      for (let c = r + 1; c < n; c += 1) offDiagonal += working[r][c] * working[r][c]
    }
    if (offDiagonal < 1e-24) break

    for (let p = 0; p < n - 1; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        const apq = working[p][q]
        if (Math.abs(apq) < 1e-18) continue
        const app = working[p][p]
        const aqq = working[q][q]
        const theta = (aqq - app) / (2 * apq)
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1))
        const cosine = 1 / Math.sqrt(t * t + 1)
        const sine = t * cosine

        for (let k = 0; k < n; k += 1) {
          const akp = working[k][p]
          const akq = working[k][q]
          working[k][p] = cosine * akp - sine * akq
          working[k][q] = sine * akp + cosine * akq
        }
        for (let k = 0; k < n; k += 1) {
          const apk = working[p][k]
          const aqk = working[q][k]
          working[p][k] = cosine * apk - sine * aqk
          working[q][k] = sine * apk + cosine * aqk
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = vectors[k][p]
          const vkq = vectors[k][q]
          vectors[k][p] = cosine * vkp - sine * vkq
          vectors[k][q] = sine * vkp + cosine * vkq
        }
      }
    }
  }

  const pairs = Array.from({ length: n }, (_, i) => ({ value: working[i][i], index: i }))
  pairs.sort((a, b) => b.value - a.value)
  return {
    values: pairs.map((pair) => pair.value),
    vectors: Array.from({ length: n }, (_, row) => pairs.map((pair) => vectors[row][pair.index])),
  }
}

export function dot(a: Vector, b: Vector): number {
  if (a.length !== b.length) throw new Error(`Dot product length mismatch: ${a.length} vs ${b.length}.`)
  let sum = 0
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i]
  return sum
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error('Mean of an empty sample set is undefined.')
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0
  const average = mean(values)
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1))
}
