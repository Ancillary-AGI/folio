/**
 * Rank and null space of a real matrix, by Gauss–Jordan elimination.
 *
 * The consumers are structural, not statistical: a chemical reaction network's
 * conservation laws are the left null space of its stoichiometry matrix, and the
 * cycles that can carry a perpetual flux are its right null space. Both are
 * questions about *exact* integer matrices, where the coefficients are small and
 * the answer is a whole number or it is wrong. That is what this file is for.
 *
 * It is not a substitute for an SVD. Pivoting is by magnitude within a column
 * only, so the rank it reports is the rank the elimination can see: for a matrix
 * whose entries span many orders of magnitude, or one that is genuinely
 * near-degenerate, the honest answer depends on where the tolerance is put, and a
 * caller with such data should use `symmetricEigen` from the ML toolbox (which is
 * at least pivoting-robust for symmetric inputs) or read the degeneracy from the
 * simulation instead.
 *
 * Every basis vector is returned *applied* rather than as a parametric form: the
 * caller gets `k` vectors spanning the space, each normalised to unit length, and
 * `matrix × vector` is zero to within the tolerance.
 */

export interface RowReduction {
  /** Reduced row echelon form of the input. */
  reduced: number[][]
  /** Indices of the pivot (basic) columns, in order. */
  pivots: number[]
  /** Number of pivots, i.e. the rank found at this tolerance. */
  rank: number
}

/**
 * Reduce to row echelon form. `tolerance` is relative to the largest entry of the
 * matrix, so a scaled matrix reports the same rank at the same tolerance.
 */
export function rowReduce(matrix: readonly (readonly number[])[], tolerance = 1e-9): RowReduction {
  if (matrix.length === 0) return { reduced: [], pivots: [], rank: 0 }
  const columns = matrix[0].length
  if (matrix.some((row) => row.length !== columns)) throw new Error('Row reduction needs a rectangular matrix.')
  if (!Number.isFinite(tolerance) || tolerance <= 0) throw new Error('Row-reduction tolerance must be positive and finite.')
  for (const row of matrix) {
    for (const value of row) {
      if (!Number.isFinite(value)) throw new Error(`Row reduction cannot process a non-finite entry (${value}).`)
    }
  }

  const scale = Math.max(...matrix.map((row) => row.reduce((max, value) => Math.max(max, Math.abs(value)), 0)))
  const floor = scale * tolerance
  const work = matrix.map((row) => [...row])
  const pivots: number[] = []

  let pivotRow = 0
  for (let column = 0; column < columns && pivotRow < work.length; column += 1) {
    let best = pivotRow
    for (let r = pivotRow + 1; r < work.length; r += 1) {
      if (Math.abs(work[r][column]) > Math.abs(work[best][column])) best = r
    }
    if (Math.abs(work[best][column]) <= floor) continue
    if (best !== pivotRow) {
      const swap = work[pivotRow]
      work[pivotRow] = work[best]
      work[best] = swap
    }
    const pivot = work[pivotRow][column]
    for (let c = column; c < columns; c += 1) work[pivotRow][c] /= pivot
    for (let r = 0; r < work.length; r += 1) {
      if (r === pivotRow) continue
      const factor = work[r][column]
      if (factor === 0) continue
      for (let c = column; c < columns; c += 1) work[r][c] -= factor * work[pivotRow][c]
    }
    pivots.push(column)
    pivotRow += 1
  }

  // Clean up the round-off the elimination leaves in the pivot columns, so the
  // result is a real reduced form rather than something close to one.
  for (let r = 0; r < work.length; r += 1) {
    for (let c = 0; c < columns; c += 1) {
      if (Math.abs(work[r][c]) < floor) work[r][c] = 0
    }
  }
  return { reduced: work, pivots, rank: pivots.length }
}

export function matrixRank(matrix: readonly (readonly number[])[], tolerance?: number): number {
  return rowReduce(matrix, tolerance).rank
}

/** Transpose, kept local so this module does not depend on the ML toolbox. */
export function transposeMatrix(matrix: readonly (readonly number[])[]): number[][] {
  if (matrix.length === 0) return []
  const columns = matrix[0].length
  return Array.from({ length: columns }, (_, c) => matrix.map((row) => row[c]))
}

/**
 * Basis for `{ x : A·x = 0 }`, as unit-length rows.
 *
 * The free columns each produce one vector with a 1 in their own position and the
 * negated reduced-form entry elsewhere — the textbook construction, which is exact
 * for an integer matrix and gives a vector that can be checked by multiplying.
 */
export function nullSpace(matrix: readonly (readonly number[])[], tolerance = 1e-9): number[][] {
  if (matrix.length === 0) return []
  const columns = matrix[0].length
  const { reduced, pivots, rank } = rowReduce(matrix, tolerance)
  const free = Array.from({ length: columns }, (_, index) => index).filter((index) => !pivots.includes(index))
  return free.map((column) => {
    const vector = new Array<number>(columns).fill(0)
    vector[column] = 1
    for (let row = 0; row < rank; row += 1) vector[pivots[row]] = -reduced[row][column]
    const length = Math.hypot(...vector)
    return vector.map((value) => value / length)
  })
}

/**
 * Basis for `{ y : yᵀ·A = 0 }` — the linear combinations of rows that cancel.
 *
 * For a stoichiometry matrix these are the conserved quantities of the network,
 * which is why this is the one callers of `kinetics.ts` reach for.
 */
export function leftNullSpace(matrix: readonly (readonly number[])[], tolerance = 1e-9): number[][] {
  return nullSpace(transposeMatrix(matrix), tolerance)
}

/** Dot product with a length check, so an A·x = 0 assertion cannot pass by accident. */
export function multiplyByVector(matrix: readonly (readonly number[])[], vector: readonly number[]): number[] {
  if (matrix.some((row) => row.length !== vector.length)) {
    throw new Error(`Cannot multiply a ${matrix.length}×${matrix[0]?.length ?? 0} matrix by a vector of ${vector.length}.`)
  }
  return matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index], 0))
}
