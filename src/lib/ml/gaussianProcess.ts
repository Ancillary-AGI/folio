/**
 * Gaussian-process regression — the surrogate used when a simulation is
 * expensive and the search needs an uncertainty estimate, not just a value.
 *
 * Implementation is exact GP: RBF kernel, observation noise on the diagonal,
 * Cholesky solve, and a marginal-likelihood grid for the hyper-parameters
 * rather than guessed lengths. `predict` returns a standard deviation, and the
 * caller is expected to use it: a surrogate with no error bar is a guess.
 */

import { backSubstituteTranspose, cholesky, forwardSubstitute } from './linalg'

export interface GaussianProcessOptions {
  /** Signal standard deviation. Default: spread of the training targets. */
  amplitude?: number
  /** Candidate correlation lengths searched by marginal likelihood. */
  lengthScaleCandidates?: number[]
  /** Candidate noise standard deviations (relative to target spread). */
  noiseCandidates?: number[]
  /** Jitter floor for the Cholesky of a near-singular Gram matrix. */
  jitter?: number
}

export interface GaussianProcessPrediction {
  mean: number
  /**
   * Predictive standard deviation, floored at zero. Far from the training
   * points this relaxes to the signal amplitude, which is the honest way for
   * the surrogate to say "this estimate is prior-dominated".
   */
  standardDeviation: number
}

interface FittedGp {
  alpha: number[]
  lengthScale: number
  amplitude: number
  noiseVariance: number
}

function rbf(a: readonly number[], b: readonly number[], lengthScale: number): number {
  let squared = 0
  for (let i = 0; i < a.length; i += 1) {
    const delta = a[i] - b[i]
    squared += delta * delta
  }
  return Math.exp(-0.5 * squared / (lengthScale * lengthScale))
}

export class GaussianProcessRegressor {
  private inputs: number[][] = []

  private targets: number[] = []

  private centred: number[] = []

  private meanTarget = 0

  private fitted: FittedGp | null = null

  private cachedFactor: number[][] | null = null

  private dimensionValue = 0

  constructor(private readonly options: GaussianProcessOptions = {}) {
    if (options.jitter !== undefined && !(options.jitter > 0)) throw new Error('GP jitter must be positive.')
  }

  /** Feature count the process was fitted on. */
  get dimension(): number {
    if (this.dimensionValue === 0) throw new Error('Gaussian process has not been fitted yet.')
    return this.dimensionValue
  }

  /** Train (or replace training data and re-fit) the process. */
  fit(inputs: readonly (readonly number[])[], targets: readonly number[]): this {
    if (inputs.length === 0) throw new Error('A Gaussian process needs at least one training point.')
    if (targets.length !== inputs.length) throw new Error('Training input and target counts disagree.')
    const dimension = inputs[0].length
    if (dimension === 0) throw new Error('Training inputs must have at least one feature.')
    if (inputs.some((row) => row.length !== dimension)) throw new Error('Ragged training inputs.')
    if (targets.length < 2) throw new Error('A Gaussian process needs at least two observations to estimate noise.')
    if (inputs.some((row) => row.some((value) => !Number.isFinite(value)))) {
      throw new Error('Training inputs must all be finite.')
    }
    if (targets.some((value) => !Number.isFinite(value))) throw new Error('Training targets must all be finite.')

    this.dimensionValue = dimension
    this.inputs = inputs.map((row) => [...row])
    this.targets = [...targets]
    this.meanTarget = this.targets.reduce((sum, value) => sum + value, 0) / this.targets.length
    this.centred = this.targets.map((value) => value - this.meanTarget)
    this.cachedFactor = null
    this.fitted = null

    const spread = Math.sqrt(
      this.centred.reduce((sum, value) => sum + value * value, 0) / (this.targets.length - 1),
    )
    // A constant training set still needs a scale; using 1 keeps the kernel
    // well-posed and lets the noise candidate collapse onto the data.
    const targetScale = spread > 1e-15 ? spread : 1

    const inputSpread = GaussianProcessRegressor.inputSpread(this.inputs)
    const lengthCandidates =
      this.options.lengthScaleCandidates
      ?? [0.25, 0.5, 1, 2, 4].map((factor) => Math.max(1e-9, factor * inputSpread))
    const noiseCandidates =
      this.options.noiseCandidates ?? [1e-6, 1e-4, 1e-3, 1e-2].map((factor) => factor * targetScale)
    const amplitude = this.options.amplitude ?? targetScale
    if (!(amplitude > 0)) throw new Error('GP amplitude must be positive.')

    let best: FittedGp | null = null
    let bestLogLikelihood = Number.NEGATIVE_INFINITY
    for (const lengthScale of lengthCandidates) {
      for (const noiseStdDev of noiseCandidates) {
        const candidate = this.solve(amplitude, lengthScale, noiseStdDev * noiseStdDev)
        if (candidate.logLikelihood > bestLogLikelihood) {
          bestLogLikelihood = candidate.logLikelihood
          best = candidate.fitted
        }
      }
    }
    if (!best) throw new Error('Gaussian-process hyper-parameter search produced no feasible solution.')
    this.fitted = best
    return this
  }

  private static inputSpread(inputs: readonly (readonly number[])[]): number {
    const dimension = inputs[0].length
    let total = 0
    for (let c = 0; c < dimension; c += 1) {
      let mean = 0
      for (const row of inputs) mean += row[c]
      mean /= inputs.length
      let variance = 0
      for (const row of inputs) variance += (row[c] - mean) ** 2
      total += Math.sqrt(variance / Math.max(1, inputs.length - 1))
    }
    return total / dimension
  }

  /**
   * Log marginal likelihood for one hyper-parameter candidate:
   * −0.5·ỹᵗK⁻¹ỹ − Σ log L_ii − n/2·log 2π. Maximising it over the grid is what
   * keeps the surrogate honest instead of arbitrarily smooth.
   */
  private solve(
    amplitude: number,
    lengthScale: number,
    noiseVariance: number,
  ): { fitted: FittedGp; logLikelihood: number } {
    const n = this.inputs.length
    const zero = { alpha: new Array<number>(n).fill(0), lengthScale, amplitude, noiseVariance }
    let factor: number[][]
    try {
      // cholesky() escalates jitter internally; a failure means this candidate
      // is infeasible and the grid simply moves on rather than throwing.
      factor = cholesky(this.gram(amplitude, lengthScale, noiseVariance), this.options.jitter ?? 1e-10)
    } catch {
      return { fitted: zero, logLikelihood: Number.NEGATIVE_INFINITY }
    }

    const alpha = backSubstituteTranspose(factor, forwardSubstitute(factor, this.centred))
    let diagonalLog = 0
    for (let i = 0; i < n; i += 1) diagonalLog += Math.log(factor[i][i])
    let quadratic = 0
    for (let i = 0; i < n; i += 1) quadratic += this.centred[i] * alpha[i]
    return {
      fitted: { alpha, lengthScale, amplitude, noiseVariance },
      logLikelihood: -0.5 * quadratic - diagonalLog - 0.5 * n * Math.log(2 * Math.PI),
    }
  }

  private gram(amplitude: number, lengthScale: number, noiseVariance: number): number[][] {
    const n = this.inputs.length
    return Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) =>
        amplitude * amplitude * rbf(this.inputs[i], this.inputs[j], lengthScale)
        + (i === j ? noiseVariance : 0)),
    )
  }

  private requireFitted(): FittedGp {
    if (!this.fitted) throw new Error('Gaussian process has not been fitted yet.')
    return this.fitted
  }

  get trainingSize(): number {
    return this.inputs.length
  }

  /** Selected correlation length — the surrogate's smoothing scale, worth showing to a user. */
  get selectedLengthScale(): number {
    return this.requireFitted().lengthScale
  }

  /** Selected observation-noise standard deviation. Zero means the fit interpolates. */
  get selectedNoiseStdDev(): number {
    return Math.sqrt(this.requireFitted().noiseVariance)
  }

  get logMarginalLikelihood(): number {
    const fitted = this.requireFitted()
    const factor = this.factorCache()
    let diagonalLog = 0
    for (let i = 0; i < factor.length; i += 1) diagonalLog += Math.log(factor[i][i])
    let quadratic = 0
    for (let i = 0; i < this.centred.length; i += 1) quadratic += this.centred[i] * fitted.alpha[i]
    return -0.5 * quadratic - diagonalLog - 0.5 * this.centred.length * Math.log(2 * Math.PI)
  }

  predict(input: readonly number[]): GaussianProcessPrediction {
    const fitted = this.requireFitted()
    if (input.length !== this.dimension) {
      throw new Error(`Process expects ${this.dimension} features, got ${input.length}.`)
    }
    if (input.some((value) => !Number.isFinite(value))) throw new Error('Prediction input must be finite.')

    const kStar = this.inputs.map((row) => fitted.amplitude ** 2 * rbf(row, input, fitted.lengthScale))
    let mean = this.meanTarget
    for (let i = 0; i < kStar.length; i += 1) mean += kStar[i] * fitted.alpha[i]

    // Posterior variance via the Cholesky factor: v = L⁻¹k*, var = k(0,0) − v·v.
    const factor = this.factorCache()
    const solution = forwardSubstitute(factor, kStar)
    let projected = 0
    for (let i = 0; i < solution.length; i += 1) projected += solution[i] * solution[i]
    return { mean, standardDeviation: Math.sqrt(Math.max(0, fitted.amplitude ** 2 - projected)) }
  }

  private factorCache(): number[][] {
    if (this.cachedFactor) return this.cachedFactor
    const fitted = this.requireFitted()
    this.cachedFactor = cholesky(
      this.gram(fitted.amplitude, fitted.lengthScale, fitted.noiseVariance),
      this.options.jitter ?? 1e-10,
    )
    return this.cachedFactor
  }
}
