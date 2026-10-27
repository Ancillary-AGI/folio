/**
 * Principal component analysis — the linear dimension reduction used to look at
 * a high-dimensional simulation sweep, and the whitening step in front of a
 * surrogate when raw engineering units span orders of magnitude.
 *
 * Eigenvectors come from `symmetricEigen` (Jacobi) applied to the covariance
 * matrix. Signs of eigenvectors are arbitrary, so this module normalises them
 * to a deterministic convention (largest-magnitude component positive); without
 * that, re-running the same sweep would print mirrored axes and look like a bug.
 */

import { mean, standardDeviation, symmetricEigen, transpose, multiplyMatrices, type Matrix } from './linalg'

export interface PcaOptions {
  /** Standardise each column to unit variance before decomposing. Default true. */
  standardise?: boolean
  /** Components retained by `project`/`inverseProject`. Default: all. */
  components?: number
}

export interface PcaModel {
  /** Explained variance per component, largest first. */
  eigenvalues: number[]
  /** Fraction of total variance per component; sums to 1. */
  explainedVarianceRatio: number[]
  /** Cumulative explained variance — read off where it flattens. */
  cumulativeExplainedVariance: number[]
  /** Column i is the i-th eigenvector, in original (or standardised) feature space. */
  loadings: Matrix
  center: number[]
  scales: number[]
  /** Feature-space dimensionality. */
  features: number
  /** Retained component count. */
  retained: number
  project(row: readonly number[]): number[]
  projectAll(rows: readonly (readonly number[])[]): number[][]
  /** Reconstruct from retained components; the residual is the lost variance. */
  inverseProject(coordinates: readonly number[]): number[]
  /**
   * Variance fraction captured by the retained components. Anything below ~0.9
   * means the 2-D view is hiding real structure and must not be read as complete.
   */
  retainedVarianceFraction: number
}

export function fitPca(rows: readonly (readonly number[])[], options: PcaOptions = {}): PcaModel {
  if (rows.length < 2) throw new Error('PCA needs at least two samples to estimate a covariance.')
  const features = rows[0].length
  if (features === 0) throw new Error('PCA needs at least one feature column.')
  if (rows.some((row) => row.length !== features)) throw new Error('Ragged sample matrix.')
  if (rows.some((row) => row.some((value) => !Number.isFinite(value)))) throw new Error('PCA samples must all be finite.')

  const standardise = options.standardise ?? true
  const center = Array.from({ length: features }, (_, c) => mean(rows.map((row) => row[c])))
  const rawScales = Array.from({ length: features }, (_, c) => standardDeviation(rows.map((row) => row[c])))
  if (rawScales.every((scale) => scale <= 1e-15)) {
    throw new Error('Every feature column is constant; there is no variance for PCA to decompose.')
  }
  // A constant column carries no variance; keeping a scale of 1 stops a
  // zero-divide turning a harmless column into NaN everywhere.
  const scales = rawScales.map((scale) => (standardise && scale > 1e-15 ? scale : 1))

  const prepared = rows.map((row) => row.map((value, c) => (value - center[c]) / scales[c]))
  const degreesOfFreedom = rows.length - 1

  const covariance: Matrix = Array.from({ length: features }, (_, r) =>
    Array.from({ length: features }, (_, c) => {
      let sum = 0
      for (const row of prepared) sum += row[r] * row[c]
      return sum / degreesOfFreedom
    }),
  )

  const { values, vectors } = symmetricEigen(covariance)
  const totalVariance = values.reduce((sum, value) => sum + Math.max(0, value), 0)
  // Jacobi on a covariance matrix is PSD in theory; a tiny negative eigenvalue
  // is round-off, so ratios are built from clamped values and the noise is
  // disclosed by refusing to claim the clamp never happened.
  const clamped = values.map((value) => Math.max(0, value))
  const explainedVarianceRatio = totalVariance > 0
    ? clamped.map((value) => value / totalVariance)
    : clamped.map(() => Number.NaN)

  let cumulative = 0
  const cumulativeExplainedVariance = explainedVarianceRatio.map((ratio) => {
    cumulative += ratio
    return cumulative
  })

  const requested = options.components ?? features
  if (!Number.isInteger(requested) || requested < 1 || requested > features) {
    throw new Error(`Retained components must be an integer in 1..${features}, got ${requested}.`)
  }

  // Deterministic sign convention: the component with the largest magnitude is positive.
  const loadings: Matrix = Array.from({ length: features }, (_, feature) =>
    Array.from({ length: requested }, (__, component) => {
      let dominantIndex = 0
      let dominantMagnitude = 0
      for (let f = 0; f < features; f += 1) {
        if (Math.abs(vectors[f][component]) > dominantMagnitude) {
          dominantMagnitude = Math.abs(vectors[f][component])
          dominantIndex = f
        }
      }
      const sign = vectors[dominantIndex][component] >= 0 ? 1 : -1
      return sign * vectors[feature][component]
    }),
  )

  const model = {
    eigenvalues: clamped.slice(0, requested),
    explainedVarianceRatio,
    cumulativeExplainedVariance,
    loadings,
    center,
    scales,
    features,
    retained: requested,
  }

  const projectRow = (row: readonly number[]): number[] => {
    if (row.length !== features) throw new Error(`PCA expects ${features} features, got ${row.length}.`)
    const preparedRow = row.map((value, c) => (value - center[c]) / scales[c])
    return Array.from({ length: requested }, (__, component) =>
      preparedRow.reduce((sum, value, feature) => sum + value * loadings[feature][component], 0),
    )
  }

  return {
    ...model,
    project: projectRow,
    projectAll: (rowsIn: readonly (readonly number[])[]): number[][] => rowsIn.map(projectRow),
    inverseProject(coordinates: readonly number[]): number[] {
      if (coordinates.length !== requested) throw new Error(`Reconstruction expects ${requested} coordinates, got ${coordinates.length}.`)
      return Array.from({ length: features }, (__, feature) => {
        let value = 0
        for (let component = 0; component < requested; component += 1) value += coordinates[component] * loadings[feature][component]
        return value * scales[feature] + center[feature]
      })
    },
    retainedVarianceFraction: totalVariance > 0
      ? clamped.slice(0, requested).reduce((sum, value) => sum + value, 0) / totalVariance
      : Number.NaN,
  }
}

/**
 * Variance of the reconstruction residual for the retained components.
 * Kept separate from `retainedVarianceFraction` because an engineer reading a
 * scatter plot wants the absolute lost variance in the data's own units.
 */
export function reconstructionResidual(
  model: PcaModel,
  rows: readonly (readonly number[])[],
): { rmse: number; maxAbsoluteError: number } {
  let sum = 0
  let max = 0
  let count = 0
  for (const row of rows) {
    const reconstructed = model.inverseProject(model.project(row))
    for (let c = 0; c < row.length; c += 1) {
      const error = row[c] - reconstructed[c]
      sum += error * error
      max = Math.max(max, Math.abs(error))
      count += 1
    }
  }
  if (count === 0) throw new Error('Residual needs at least one value.')
  return { rmse: Math.sqrt(sum / count), maxAbsoluteError: max }
}

/**
 * Pearson correlation matrix between feature columns.
 *
 * Returned next to a PCA plot because loadings alone make the reader work out
 * which raw quantities move together; this states it directly, in [-1, 1].
 * A constant column has undefined correlation and is reported as NaN rather
 * than as 0, which would read as "independent" when it means "no information".
 */
export function correlationMatrix(rows: readonly (readonly number[])[]): number[][] {
  if (rows.length < 2) throw new Error('Correlation needs at least two samples.')
  const features = rows[0].length
  if (features === 0) throw new Error('Correlation needs at least one feature column.')
  if (rows.some((row) => row.length !== features)) throw new Error('Ragged sample matrix.')
  if (rows.some((row) => row.some((value) => !Number.isFinite(value)))) throw new Error('Correlation samples must all be finite.')

  const center = Array.from({ length: features }, (_, c) => mean(rows.map((row) => row[c])))
  const scales = Array.from({ length: features }, (_, c) => standardDeviation(rows.map((row) => row[c])))
  const standardised: Matrix = rows.map((row) => row.map((value, c) => value - center[c]))

  const covariance = multiplyMatrices(transpose(standardised), standardised)
  return covariance.map((row, r) =>
    row.map((value, c) => {
      const denominator = scales[r] * scales[c]
      return denominator > 1e-30 ? value / (rows.length - 1) / denominator : Number.NaN
    }),
  )
}
