/**
 * Regression models for surrogate fitting and measurement reduction.
 *
 * Reported accuracy is always a *held-out* number (k-fold cross-validation) or
 * the residual of the fit itself — never an in-sample R² presented as a
 * prediction claim, which would flatter the model on the exact points it was
 * fitted to.
 */

import { leastSquares, type Matrix, type Vector } from './linalg'
import { createRandomSource, shuffleInPlace } from './random'

export interface FitMetrics {
  r2: number
  rmse: number
  /** Maximum absolute residual — the number an engineer should see before trusting a fit. */
  maxAbsoluteError: number
}

export function evaluateFit(predicted: readonly number[], actual: readonly number[]): FitMetrics {
  if (predicted.length !== actual.length || predicted.length === 0) {
    throw new Error('Fit metrics need equal, non-empty prediction and actual arrays.')
  }
  const meanActual = actual.reduce((sum, value) => sum + value, 0) / actual.length
  let residualSum = 0
  let spreadSum = 0
  let maxAbsoluteError = 0
  for (let i = 0; i < actual.length; i += 1) {
    const residual = actual[i] - predicted[i]
    residualSum += residual * residual
    spreadSum += (actual[i] - meanActual) ** 2
    maxAbsoluteError = Math.max(maxAbsoluteError, Math.abs(residual))
  }
  // A constant target has zero spread: R² is undefined, not 1 or 0.
  return {
    r2: spreadSum > 0 ? 1 - residualSum / spreadSum : Number.NaN,
    rmse: Math.sqrt(residualSum / actual.length),
    maxAbsoluteError,
  }
}

/** Polynomial basis, ascending powers: [1, x, x², …]. */
export function polynomialFeatures(x: number, degree: number): number[] {
  if (!Number.isInteger(degree) || degree < 0 || degree > 20) {
    throw new Error(`Polynomial degree must be an integer in 0..20, got ${degree}.`)
  }
  const features = new Array<number>(degree + 1)
  let power = 1
  for (let d = 0; d <= degree; d += 1) {
    features[d] = power
    power *= x
  }
  return features
}

export interface PolynomialFit {
  /**
   * Coefficients in ascending powers of the *standardised* basis variable
   * `z = (x - centre) / spread`, so `index 0` is the constant term of that
   * basis. They are deliberately not raw powers of `x`: degree-12 on engineering
   * units would be a singular Vandermonde and the reported numbers would be
   * round-off, not physics. Use `predict` (or `centre`/`spread`) to evaluate.
   */
  coefficients: number[]
  /** Mean of the training `x` values used for centring. */
  centre: number
  /** RMS spread of the training `x` values used for scaling (never 0). */
  spread: number
  degree: number
  /** In-sample residuals only — `crossValidatedRmse` is the prediction claim. */
  metrics: FitMetrics
  /** Held-out RMSE, or `null` when the data is too small to hold anything out. */
  crossValidatedRmse: number | null
  ridgeLambda: number
  /** Lowest `x` in the training span — predictions outside it are extrapolation. */
  domainMin: number
  domainMax: number
  predict(x: number): number
}

/**
 * Least-squares polynomial fit.
 *
 * Inputs are centred and scaled internally before building the Vandermonde
 * basis: degree-12 on raw engineering units (1e3, 1e6) is numerically singular
 * and the fit would be dominated by round-off, not by the data.
 *
 * The returned `crossValidatedRmse` is the held-out number; `metrics` is
 * in-sample and will look flattering on high degrees by construction.
 */
export function fitPolynomial(
  xs: readonly number[],
  ys: readonly number[],
  degree: number,
  ridgeLambda = 0,
): PolynomialFit {
  const core = fitPolynomialCore(xs, ys, degree, ridgeLambda)
  return {
    ...core,
    crossValidatedRmse: heldOutRmse(xs, ys, (trainX, trainY, testX) => {
      const fold = fitPolynomialCore(trainX, trainY, degree, ridgeLambda)
      return testX.map((x) => fold.predict(x))
    }),
    // The warning an engineer needs, attached to the model the engineer actually
    // holds: outside the fitted span this is extrapolation, and a high-degree
    // polynomial leaves the data badly. Cross-validation folds use the silent
    // core predictor — their held-out points are outside the *fold* span by
    // design, and warning about that would be noise, not information.
    predict(x: number): number {
      if (!Number.isFinite(x)) throw new Error(`Polynomial prediction needs a finite x, got ${x}.`)
      if (degree >= 3 && (x < core.domainMin - 1e-12 || x > core.domainMax + 1e-12)) {
        console.warn(
          `fitPolynomial: evaluating a degree-${degree} fit outside its data span (${core.domainMin}..${core.domainMax}). ` +
            'Treat this as extrapolation, not a prediction.',
        )
      }
      return core.predict(x)
    },
  }
}

/**
 * Fitting core shared by the full model and every cross-validation fold.
 *
 * It deliberately does *not* compute CV itself: a fold that called
 * `fitPolynomial` would start another five folds inside itself and recurse
 * until a fold had too few points to fit anything.
 */
function fitPolynomialCore(
  xs: readonly number[],
  ys: readonly number[],
  degree: number,
  ridgeLambda: number,
): Omit<PolynomialFit, 'crossValidatedRmse'> {
  const n = xs.length
  if (n !== ys.length) throw new Error('Polynomial fit needs equally long x and y arrays.')
  if (n < degree + 1) throw new Error(`Cannot fit ${degree + 1} coefficients from ${n} observations.`)
  if (xs.some((value) => !Number.isFinite(value)) || ys.some((value) => !Number.isFinite(value))) {
    throw new Error('Polynomial fit inputs must all be finite.')
  }

  const centre = xs.reduce((sum, value) => sum + value, 0) / n
  const spread = Math.sqrt(xs.reduce((sum, value) => sum + (value - centre) ** 2, 0) / n) || 1
  const scaled = xs.map((value) => (value - centre) / spread)
  const design = scaled.map((x) => polynomialFeatures(x, degree))
  // Column 0 is the constant term of the standardised basis: leave it out of the
  // ridge penalty so λ shrinks the *shape* of the curve, not its level.
  const coefficients = leastSquares(design as Matrix, ys as Vector, ridgeLambda, interceptMask(degree + 1))

  const predicted = scaled.map((x) => dotFeature(coefficients, polynomialFeatures(x, degree)))
  const metrics = evaluateFit(predicted, [...ys])
  const domainMin = Math.min(...xs)
  const domainMax = Math.max(...xs)

  return {
    coefficients,
    centre,
    spread,
    degree,
    metrics,
    ridgeLambda,
    domainMin,
    domainMax,
    predict(x: number): number {
      if (!Number.isFinite(x)) throw new Error(`Polynomial prediction needs a finite x, got ${x}.`)
      return dotFeature(coefficients, polynomialFeatures((x - centre) / spread, degree))
    },
  }
}

function dotFeature(coefficients: readonly number[], features: readonly number[]): number {
  let sum = 0
  for (let i = 0; i < features.length; i += 1) sum += coefficients[i] * features[i]
  return sum
}

/** Penalty mask that spares column 0, used where column 0 is a true intercept. */
function interceptMask(columns: number): boolean[] {
  const mask = new Array<boolean>(columns).fill(true)
  mask[0] = false
  return mask
}

/**
 * Held-out RMSE, or `null` when there is not enough data to both fit a fold and
 * score one. Returning `null` — rather than a number borrowed from a
 * leave-two-out split of five points — keeps a "prediction claim" tied to a
 * sample size an engineer can actually judge.
 */
function heldOutRmse(
  xs: readonly number[],
  ys: readonly number[],
  trainAndPredict: (trainX: number[], trainY: number[], testX: number[]) => number[],
  folds = 5,
  seed = 11,
): number | null {
  if (xs.length < folds * 2) return null
  return crossValidatedRmse(xs, ys, trainAndPredict, folds, seed)
}

/**
 * Generic k-fold (5 by default) cross-validation of a training rule.
 * Returns the held-out RMSE; a model that cannot beat its own in-sample error
 * by this measure is not ready to be called a surrogate.
 */
export function crossValidatedRmse(
  xs: readonly number[],
  ys: readonly number[],
  trainAndPredict: (trainX: number[], trainY: number[], testX: number[]) => number[],
  folds = 5,
  seed = 11,
): number {
  const n = xs.length
  if (n !== ys.length) throw new Error('Cross validation needs equally long x and y arrays.')
  if (!Number.isInteger(folds) || folds < 2) throw new Error('Fold count must be an integer ≥ 2.')
  if (n < folds * 2) {
    throw new Error(`Cross validation with ${folds} folds needs at least ${folds * 2} observations, got ${n}.`)
  }

  const indices = Array.from({ length: n }, (_, i) => i)
  shuffleInPlace(indices, createRandomSource(seed))
  let residualSum = 0
  let counted = 0

  for (let fold = 0; fold < folds; fold += 1) {
    const testIndices = new Set(indices.filter((_, position) => position % folds === fold))
    const trainX: number[] = []
    const trainY: number[] = []
    const testX: number[] = []
    const testY: number[] = []
    for (let i = 0; i < n; i += 1) {
      if (testIndices.has(i)) {
        testX.push(xs[i])
        testY.push(ys[i])
      } else {
        trainX.push(xs[i])
        trainY.push(ys[i])
      }
    }
    if (trainX.length === 0 || testX.length === 0) continue
    const predicted = trainAndPredict(trainX, trainY, testX)
    if (predicted.length !== testX.length) throw new Error('Cross validation rule returned the wrong number of predictions.')
    for (let i = 0; i < testX.length; i += 1) {
      residualSum += (testY[i] - predicted[i]) ** 2
      counted += 1
    }
  }
  if (counted === 0) throw new Error('Cross validation scored no held-out points.')
  return Math.sqrt(residualSum / counted)
}

export interface LinearModel {
  /** Slope per unit of each *raw* feature — the number an engineer quotes. */
  weights: number[]
  /** Model value when every raw feature is zero (not the mean of the targets). */
  intercept: number
  metrics: FitMetrics
  /** Held-out RMSE, or `null` when the sample is too small to hold anything out. */
  crossValidatedRmse: number | null
  /** Per-feature centre used by the standardisation the fit worked in. */
  featureCentres: number[]
  /** Per-feature sample standard deviation used for the same standardisation. */
  featureScales: number[]
  /**
   * Coefficients in standardised space (effect per one standard deviation of the
   * column). Kept because comparing raw slopes across columns of different units
   * misleads; this is the version that is fair to compare.
   */
  standardisedWeights: number[]
  predict(features: readonly number[]): number
}

/**
 * Multiple linear regression with optional ridge penalty.
 * Columns are standardised before fitting so the ridge λ means the same thing
 * for a temperature column as for a parts-per-billion column; the reported
 * `weights` and `intercept` are then converted back to raw units.
 */
export function fitLinearRegression(
  rows: readonly (readonly number[])[],
  targets: readonly number[],
  ridgeLambda = 0,
): LinearModel {
  if (rows.length === 0) throw new Error('Linear regression needs at least one sample row.')
  const features = rows[0].length
  if (features === 0) throw new Error('Linear regression needs at least one feature column.')
  if (targets.length !== rows.length) throw new Error('Sample and target counts disagree.')
  if (rows.some((row) => row.length !== features)) throw new Error('Ragged feature matrix.')
  if (rows.length < features + 1 && ridgeLambda === 0) {
    throw new Error(`${rows.length} samples cannot identify ${features + 1} coefficients; use ridge or add data.`)
  }

  const core = fitLinearCore(rows, targets, ridgeLambda)
  // A fold needs at least two rows to train on and one to score, so below
  // 2 × folds samples there is no honest held-out number to report.
  const folds = 5
  return {
    ...core,
    crossValidatedRmse:
      rows.length < folds * 2
        ? null
        : crossValidatedRows(rows, targets, (trainRows, trainTargets, testRowsList) => {
            // The fold refits from scratch (its own standardisation), so held-out
            // points never see statistics computed on themselves.
            const fold = fitLinearCore(trainRows, trainTargets, ridgeLambda)
            return testRowsList.map((row) => fold.predict(row))
          }, folds),
  }
}

/**
 * Fitting core shared by the full model and every cross-validation fold.
 * Deliberately does not compute CV itself — a recursive CV would refit the
 * whole tree of folds for each fold.
 */
function fitLinearCore(
  rows: readonly (readonly number[])[],
  targets: readonly number[],
  ridgeLambda: number,
): Omit<LinearModel, 'crossValidatedRmse'> {
  const features = rows[0].length
  const means = new Array<number>(features).fill(0)
  const scales = new Array<number>(features).fill(1)
  for (let c = 0; c < features; c += 1) {
    let sum = 0
    for (const row of rows) sum += row[c]
    const mean = sum / rows.length
    let variance = 0
    for (const row of rows) variance += (row[c] - mean) ** 2
    if (variance <= 1e-14) {
      throw new Error(`Feature ${c} is constant across all samples; drop it rather than fit it.`)
    }
    means[c] = mean
    scales[c] = Math.sqrt(variance / (rows.length - 1))
  }

  const design: Matrix = rows.map((row) => [1, ...row.map((value, c) => (value - means[c]) / scales[c])])
  const coefficients = leastSquares(design, [...targets] as Vector, ridgeLambda, interceptMask(features + 1))
  const predicted = design.map((row) => dotFeature(coefficients, row))

  // Convert the standardised-space solution back to raw units:
  //   y = c₀ + Σ cᵢ (xᵢ − μᵢ)/sᵢ = Σ (cᵢ/sᵢ) xᵢ + (c₀ − Σ cᵢμᵢ/sᵢ)
  // Ridge shrinks the standardised slopes, so the raw slopes it produces depend
  // on `scales` — which is why the scales are reported alongside them.
  const rawWeights = coefficients.slice(1).map((value, c) => value / scales[c])
  const rawIntercept = coefficients[0] - coefficients
    .slice(1)
    .reduce((sum, value, c) => sum + (value * means[c]) / scales[c], 0)

  return {
    weights: rawWeights,
    intercept: rawIntercept,
    standardisedWeights: coefficients.slice(1),
    featureCentres: means,
    featureScales: scales,
    metrics: evaluateFit(predicted, [...targets]),
    predict(featuresIn: readonly number[]): number {
      if (featuresIn.length !== coefficients.length - 1) {
        throw new Error(`Model expects ${coefficients.length - 1} features, got ${featuresIn.length}.`)
      }
      let sum = coefficients[0]
      for (let c = 0; c < featuresIn.length; c += 1) {
        sum += coefficients[c + 1] * ((featuresIn[c] - means[c]) / scales[c])
      }
      return sum
    },
  }
}

/**
 * k-fold CV over whole sample rows (the 1-D driver above only handles a scalar
 * predictor). Folds are dealt by a seeded shuffle so the split is reproducible.
 */
export function crossValidatedRows(
  rows: readonly (readonly number[])[],
  targets: readonly number[],
  trainAndPredict: (trainRows: number[][], trainTargets: number[], testRows: number[][]) => number[],
  folds = 5,
  seed = 11,
): number {
  const n = rows.length
  if (targets.length !== n) throw new Error('Sample and target counts disagree.')
  if (!Number.isInteger(folds) || folds < 2) throw new Error('Fold count must be an integer ≥ 2.')
  if (n < folds * 2) throw new Error(`Cross validation with ${folds} folds needs at least ${folds * 2} rows, got ${n}.`)

  const indices = Array.from({ length: n }, (_, i) => i)
  shuffleInPlace(indices, createRandomSource(seed))

  let residualSum = 0
  let counted = 0
  for (let fold = 0; fold < folds; fold += 1) {
    const testMask = new Set(indices.filter((_, position) => position % folds === fold))
    const trainRows: number[][] = []
    const trainTargets: number[] = []
    const testRows: number[][] = []
    const testTargets: number[] = []
    for (let i = 0; i < n; i += 1) {
      if (testMask.has(i)) {
        testRows.push([...rows[i]])
        testTargets.push(targets[i])
      } else {
        trainRows.push([...rows[i]])
        trainTargets.push(targets[i])
      }
    }
    if (trainRows.length === 0 || testRows.length === 0) continue
    const predicted = trainAndPredict(trainRows, trainTargets, testRows)
    if (predicted.length !== testRows.length) throw new Error('Cross validation rule returned the wrong prediction count.')
    for (let i = 0; i < testRows.length; i += 1) {
      residualSum += (testTargets[i] - predicted[i]) ** 2
      counted += 1
    }
  }
  if (counted === 0) throw new Error('Cross validation scored no held-out points.')
  return Math.sqrt(residualSum / counted)
}
