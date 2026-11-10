import { describe, expect, it } from 'vitest'

import { symmetricEigen } from '../ml/linalg'
import { characteristicPolynomial, linearStability, matrixDeterminant, matrixEigenvalues } from './matrixEigen'

/** Sort a spectrum by real part, then |imaginary|, so comparisons are order-free. */
function sorted(values: { re: number; im: number }[]): { re: number; im: number }[] {
  return [...values].sort((a, b) => (Math.abs(a.re - b.re) > 1e-12 ? b.re - a.re : Math.abs(b.im) - Math.abs(a.im)))
}

function expectSpectrum(
  matrix: number[][],
  expected: { re: number; im: number }[],
): void {
  const got = sorted(matrixEigenvalues(matrix).values)
  const want = sorted(expected)
  expect(got.length).toBe(want.length)
  for (let i = 0; i < want.length; i += 1) {
    expect(got[i].re).toBeCloseTo(want[i].re, 8)
    expect(Math.abs(got[i].im)).toBeCloseTo(Math.abs(want[i].im), 8)
  }
}

describe('characteristic polynomial and determinant', () => {
  it('reproduces the 2x2 invariants by hand', () => {
    const a = [[2, 1], [4, -3]]
    // tr = -1, det = -10  =>  p(λ) = λ² + λ − 10
    expect(characteristicPolynomial(a)).toEqual([1, 1, -10])
    expect(matrixDeterminant(a)).toBeCloseTo(-10, 12)
  })

  it('builds the cubic of a triangular matrix from its diagonal', () => {
    const a = [[1, 7, 2], [0, 4, 9], [0, 0, 6]]
    // (λ−1)(λ−4)(λ−6) = λ³ − 11λ² + 34λ − 24
    const coefficients = characteristicPolynomial(a)
    expect(coefficients[0]).toBe(1)
    expect(coefficients[1]).toBeCloseTo(-11, 12)
    expect(coefficients[2]).toBeCloseTo(34, 12)
    expect(coefficients[3]).toBeCloseTo(-24, 12)
    expect(matrixDeterminant(a)).toBeCloseTo(24, 12)
  })

  it('signs the determinant after a row swap', () => {
    expect(matrixDeterminant([[0, 1], [1, 0]])).toBeCloseTo(-1, 12)
    expect(matrixDeterminant([[1, 2, 3], [4, 5, 6], [7, 8, 10]])).toBeCloseTo(-3, 12)
    expect(matrixDeterminant([[1, 2], [2, 4]])).toBe(0)
  })
})

describe('matrixEigenvalues', () => {
  it('solves a 2x2 with two real roots', () => {
    expectSpectrum([[0, 1], [-2, -3]], [{ re: -1, im: 0 }, { re: -2, im: 0 }])
  })

  it('solves a 2x2 complex-conjugate pair', () => {
    expectSpectrum([[-0.5, -2], [2, -0.5]], [{ re: -0.5, im: 2 }, { re: -0.5, im: -2 }])
  })

  it('reads the diagonal of a triangular matrix', () => {
    expectSpectrum([[1, 7, 2], [0, 4, 9], [0, 0, 6]], [
      { re: 1, im: 0 },
      { re: 4, im: 0 },
      { re: 6, im: 0 },
    ])
  })

  it('handles a block-diagonal matrix with three different spectra', () => {
    // A spectrum a caller constructs on purpose so the expected answer is known:
    // diag([-1, −4], rotation block giving ±i√5, [7, −0.5]).
    const assembled = [
      [-1, 0, 0, 0, 0, 0],
      [2, -4, 0, 0, 0, 0],
      [0, 0, 0, -5, 0, 0],
      [0, 0, 1, 0, 0, 0],
      [0, 0, 0, 0, 7, 0],
      [0, 0, 0, 0, 0.25, -0.5],
    ]
    expectSpectrum(assembled, [
      { re: -1, im: 0 },
      { re: -4, im: 0 },
      { re: 0, im: Math.sqrt(5) },
      { re: 0, im: -Math.sqrt(5) },
      { re: 7, im: 0 },
      { re: -0.5, im: 0 },
    ])
  })

  it('recovers the roots of a polynomial from its companion matrix', () => {
    // p(λ) = (λ−1)(λ−2)(λ−3)(λ+4) = λ⁴ − 2λ³ − 13λ² + 38λ − 24
    const coefficients = [1, -2, -13, 38, -24]
    // Frobenius companion: ones on the subdiagonal, last column −[a₄ a₃ a₂ a₁]ᵗ.
    const companion = [
      [0, 0, 0, 24],
      [1, 0, 0, -38],
      [0, 1, 0, 13],
      [0, 0, 1, 2],
    ]
    const built = characteristicPolynomial(companion)
    for (let i = 0; i < coefficients.length; i += 1) {
      expect(built[i]).toBeCloseTo(coefficients[i], 8)
    }
    expectSpectrum(companion, [
      { re: 1, im: 0 },
      { re: 2, im: 0 },
      { re: 3, im: 0 },
      { re: -4, im: 0 },
    ])
  })

  it('agrees with the symmetric Jacobi solver on a symmetric input', () => {
    const symmetric = [
      [4, 1, 0, 2],
      [1, 3, 0.5, 0],
      [0, 0.5, -2, 1],
      [2, 0, 1, 5],
    ]
    const jacobi = [...symmetricEigen(symmetric).values].sort((a, b) => a - b)
    const general = matrixEigenvalues(symmetric)
    expect(general.values.every((value) => Math.abs(value.im) < 1e-9)).toBe(true)
    const ascending = general.values.map((value) => value.re).sort((a, b) => a - b)
    for (let i = 0; i < jacobi.length; i += 1) {
      expect(ascending[i]).toBeCloseTo(jacobi[i], 8)
    }
  })

  it('fails the invariant check rather than returning an unvalidated spectrum', () => {
    // Five distinct roots spread over 1…5 costs the polynomial route about 1e-14
    // of relative accuracy. The default tolerance accepts that; a demand for
    // better-than-round-off refuses it instead of reporting a clean verdict.
    const diagonal = [
      [1, 0, 0, 0, 0],
      [0, 2, 0, 0, 0],
      [0, 0, 3, 0, 0],
      [0, 0, 0, 4, 0],
      [0, 0, 0, 0, 5],
    ]
    const achieved = matrixEigenvalues(diagonal).checkTolerance
    expect(achieved).toBeGreaterThan(0)
    expect(achieved).toBeLessThan(1e-6)
    expect(() => matrixEigenvalues(diagonal, achieved / 10)).toThrow(/trace\/determinant check/)
    expect(() => matrixEigenvalues(diagonal, 0)).toThrow(/positive and finite/)
  })

  it('refuses a matrix larger than the polynomial route can be trusted with', () => {
    const thirteen = Array.from({ length: 13 }, (_, r) =>
      Array.from({ length: 13 }, (_, c) => (r === c ? -(r + 1) : 0)),
    )
    expect(() => matrixEigenvalues(thirteen)).toThrow(/limited to 12 states/)
  })

  it('rejects ragged, empty and non-finite input', () => {
    expect(() => matrixEigenvalues([[1, 2], [3]])).toThrow(/row 1 has 1 entries/)
    expect(() => matrixEigenvalues([])).toThrow(/at least one row/)
    expect(() => matrixEigenvalues([[1, Number.NaN], [0, 1]])).toThrow(/not a finite number/)
    expect(() => matrixDeterminant([[1, 2, 3], [4, 5, 6]])).toThrow(/rows/)
  })
})

describe('linearStability', () => {
  it('classifies decaying, growing and borderline systems', () => {
    expect(linearStability([[0, 1], [-2, -3]]).kind).toBe('stable')
    expect(linearStability([[0, 1], [2, -1]]).kind).toBe('unstable')
    // Pure rotation: ±i, so neither side of the marginal band.
    const rotation = linearStability([[0, -1], [1, 0]])
    expect(rotation.kind).toBe('marginal')
    expect(Math.abs(rotation.margin)).toBeLessThan(1e-9)
    expect(rotation.spectrum.values.length).toBe(2)
  })

  it('reports the margin as the largest real part', () => {
    const verdict = linearStability([[-1, 0, 0], [0, 3, 0], [0, 0, -5]])
    expect(verdict.margin).toBeCloseTo(3, 10)
    expect(verdict.kind).toBe('unstable')
  })
})
