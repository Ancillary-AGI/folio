import { describe, expect, it } from 'vitest'

import {
  leftNullSpace,
  matrixRank,
  multiplyByVector,
  nullSpace,
  rowReduce,
  transposeMatrix,
} from './matrixKernel'

/** The defining property of a kernel vector, checked rather than trusted. */
const residual = (matrix: number[][], vector: number[]): number =>
  Math.max(...multiplyByVector(matrix, vector).map((value) => Math.abs(value)))

describe('rowReduce', () => {
  it('turns an invertible matrix into the identity', () => {
    const { reduced, pivots, rank } = rowReduce([[2, 1, 0], [0, 1, 1], [1, 0, 1]])
    expect(rank).toBe(3)
    expect(pivots).toEqual([0, 1, 2])
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) expect(reduced[r][c]).toBeCloseTo(r === c ? 1 : 0, 12)
    }
  })

  it('pivots instead of dividing by a zero on the diagonal', () => {
    // A leading zero would be a divide-by-zero for elimination without pivoting.
    const { rank, reduced } = rowReduce([[0, 1], [1, 0]])
    expect(rank).toBe(2)
    expect(reduced[0][0]).toBeCloseTo(1, 12)
  })

  it('drops a row that is a multiple of another', () => {
    expect(matrixRank([[1, 2], [2, 4]])).toBe(1)
    expect(matrixRank([[1, 2], [2, 4.0000000001]])).toBe(1)
    expect(matrixRank([[1, 2], [2, 4.0000000001]], 1e-12)).toBe(2)
  })

  it('reports rank against the scale of the matrix, not against an absolute floor', () => {
    // Multiplying every entry by a million must not change the answer.
    const small = [[1e-6, 2e-6], [2e-6, 4e-6]]
    expect(matrixRank(small)).toBe(1)
    expect(matrixRank([[1, 2], [2, 4]])).toBe(1)
  })

  it('refuses input it cannot reason about', () => {
    expect(() => rowReduce([[1, 2], [3]])).toThrow(/rectangular/)
    expect(() => rowReduce([[1, Number.NaN]])).toThrow(/non-finite/)
    expect(() => rowReduce([[1]], 0)).toThrow(/tolerance/)
    expect(rowReduce([])).toEqual({ reduced: [], pivots: [], rank: 0 })
  })
})

describe('nullSpace', () => {
  it('spans the solutions of a one-row system', () => {
    const basis = nullSpace([[1, -1]])
    expect(basis).toHaveLength(1)
    expect(residual([[1, -1]], basis[0])).toBeLessThan(1e-12)
    expect(basis[0][0]).toBeCloseTo(Math.SQRT1_2, 12)
    expect(basis[0][1]).toBeCloseTo(Math.SQRT1_2, 12)
  })

  it('is empty for a full-rank matrix and every vector is unit length', () => {
    expect(nullSpace([[1, 0], [0, 1]])).toEqual([])
    for (const vector of nullSpace([[1, 2, 3], [4, 5, 6], [7, 8, 9]])) {
      expect(Math.hypot(...vector)).toBeCloseTo(1, 12)
    }
  })

  it('gives the dimension the rank–nullity theorem promises', () => {
    for (const matrix of [
      [[1, 2, 3, 4]],
      [[1, 2, 3, 4], [2, 4, 6, 8]],
      [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0]],
      [[1, 2, 3], [4, 5, 6], [7, 8, 9], [1, 1, 1]],
    ]) {
      const columns = matrix[0].length
      expect(nullSpace(matrix).length + matrixRank(matrix)).toBe(columns)
    }
  })

  it('finds the cycle of a reaction loop as a whole-number flux', () => {
    // Stoichiometry of A→B, B→C, C→A. The cycle (1,1,1) runs all three reactions
    // at the same rate and changes nothing.
    const stoichiometry = [[-1, 0, 1], [1, -1, 0], [0, 1, -1]]
    const basis = nullSpace(stoichiometry)
    expect(basis).toHaveLength(1)
    expect(residual(stoichiometry, basis[0])).toBeLessThan(1e-12)
    // Normalised, but the ratios must be 1:1:1 with one sign flip from the pivot.
    const ratios = basis[0].map((value) => Math.abs(value) / Math.min(...basis[0].map(Math.abs)))
    for (const ratio of ratios) expect(ratio).toBeCloseTo(1, 10)
  })
})

describe('leftNullSpace', () => {
  it('produces the conserved quantity of a reversible dimer', () => {
    // A⇌B: the total A + B never changes, and that is the left kernel (1, 1).
    const stoichiometry = [[-1, 1], [1, -1]]
    const laws = leftNullSpace(stoichiometry)
    expect(laws).toHaveLength(1)
    expect(Math.abs(laws[0][0] - laws[0][1])).toBeLessThan(1e-12)
    // A conserved quantity has to be conserved by every reaction, not just netted.
    for (const reaction of transposeMatrix(stoichiometry)) {
      expect(Math.abs(laws[0].reduce((sum, value, index) => sum + value * reaction[index], 0))).toBeLessThan(1e-12)
    }
  })

  it('counts the independent conservation laws of an enzyme mechanism', () => {
    // E + S ⇌ ES then ES → E + P. Rows are species (E, S, ES, P), columns are the
    // two reactions. Two moieties survive: total enzyme and total substrate.
    const network = [
      [-1, 1], // E: consumed by binding, released by catalysis
      [-1, 0], // S: consumed by binding
      [1, -1], // ES: formed, then consumed
      [0, 1], // P: formed by catalysis
    ]
    expect(matrixRank(network)).toBe(2)
    const laws = leftNullSpace(network)
    expect(laws).toHaveLength(2)
    // A left-kernel vector annihilates the *rows*, so it is checked against the
    // transpose — multiplying it by the matrix itself would be a shape error.
    for (const law of laws) expect(residual(transposeMatrix(network), law)).toBeLessThan(1e-12)

    // The two moieties are conserved in the physical sense (their dot with every
    // reaction is zero) and independent, so with a two-dimensional law space they
    // span exactly what the basis spans.
    for (const moiety of [[1, 0, 1, 0], [0, 1, 1, 1]]) {
      for (let reaction = 0; reaction < 2; reaction += 1) {
        const flux = moiety.reduce((sum, value, species) => sum + value * network[species][reaction], 0)
        expect(flux).toBe(0)
      }
    }
  })

  it('transposes without losing entries', () => {
    const matrix = [[1, 2, 3], [4, 5, 6]]
    expect(transposeMatrix(matrix)).toEqual([[1, 4], [2, 5], [3, 6]])
    expect(transposeMatrix([])).toEqual([])
  })
})

describe('multiplyByVector', () => {
  it('refuses a mismatched length instead of padding with undefined', () => {
    expect(() => multiplyByVector([[1, 2]], [1])).toThrow(/Cannot multiply/)
    expect(multiplyByVector([[1, 2], [3, 4]], [1, 0])).toEqual([1, 3])
  })
})
