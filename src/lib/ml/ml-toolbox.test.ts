/**
 * Analytic-anchor tests for the ML/heuristic toolbox.
 *
 * Every assertion is against a value that can be derived independently of the
 * code under test: a known linear relation, a Rosenbrock minimum, a Parseval
 * identity, an exact difference equation. Tolerance-free "it runs" tests would
 * not catch a sign error, and a sign error in a controller tuner is the failure
 * mode that matters.
 */

import { describe, expect, it } from 'vitest'

import { cluster, evaluateClusterCounts, silhouetteWidth } from './clustering'
import {
  cholesky,
  dot,
  leastSquares,
  multiplyMatrices,
  solveLinearSystem,
  standardDeviation,
  symmetricEigen,
  transpose,
} from './linalg'
import { correlationMatrix, fitPca, reconstructionResidual } from './dimensionality'
import { trainNeuralNetwork } from './neural'
import { differentialEvolution, nelderMead, safeEvaluate, simulatedAnnealing } from './optimizers'
import { createRandomSource, shuffleInPlace } from './random'
import { fitLinearRegression, fitPolynomial, evaluateFit } from './regression'
import { GaussianProcessRegressor } from './gaussianProcess'
import {
  estimateFrequencyResponse,
  fitArx,
  fitFopdt,
} from './systemIdentification'

describe('ml/linalg', () => {
  it('recovers an exact line from noiseless samples', () => {
    const design = [[1, 0], [1, 1], [1, 2], [1, 3]]
    const solution = leastSquares(design, [1, 3, 5, 7])
    expect(solution[0]).toBeCloseTo(1, 9)
    expect(solution[1]).toBeCloseTo(2, 9)
  })

  it('does not lose the fit when the design matrix is a high-order Vandermonde', () => {
    // Normal equations would square this conditioning and fail; QR does not.
    const xs = Array.from({ length: 12 }, (_, i) => i)
    const design = xs.map((x) => [1, x, x * x, x ** 3])
    const truth = [5, -2, 0.5, 0.25]
    const target = design.map((row) => dot(row, truth))
    const fitted = leastSquares(design, target)
    for (let i = 0; i < truth.length; i += 1) expect(fitted[i]).toBeCloseTo(truth[i], 6)
  })

  it('refuses a rank-deficient design instead of returning a plausible-looking vector', () => {
    const design = [[1, 2], [2, 4], [3, 6]]
    expect(() => leastSquares(design, [1, 2, 3])).toThrow(/rank-deficient/)
  })

  it('solves a square system exactly', () => {
    const solution = solveLinearSystem([[2, 1], [1, 3]], [9, 10])
    expect(solution[0]).toBeCloseTo(3.4, 9)
    expect(solution[1]).toBeCloseTo(2.2, 9)
  })

  it('builds a Cholesky factor whose product reproduces the matrix', () => {
    const symmetric = [[4, 12, -16], [12, 37, -43], [-16, -43, 98]]
    const factor = cholesky(symmetric, 1e-12)
    const product = multiplyMatrices(factor, transpose(factor))
    for (let r = 0; r < 3; r += 1) {
      for (let c = 0; c < 3; c += 1) expect(product[r][c]).toBeCloseTo(symmetric[r][c], 8)
    }
  })

  it('resolves a known symmetric spectrum in descending order', () => {
    // Diagonal input: eigenvalues are the diagonal, sorted descending.
    const { values, vectors } = symmetricEigen([[1, 0, 0], [0, 3, 0], [0, 0, 2]])
    expect(values[0]).toBeCloseTo(3, 9)
    expect(values[1]).toBeCloseTo(2, 9)
    expect(values[2]).toBeCloseTo(1, 9)
    // Orthonormal columns.
    for (let i = 0; i < 3; i += 1) {
      for (let j = 0; j < 3; j += 1) {
        const overlap = vectors[0][i] * vectors[0][j] + vectors[1][i] * vectors[1][j] + vectors[2][i] * vectors[2][j]
        expect(overlap).toBeCloseTo(i === j ? 1 : 0, 9)
      }
    }
  })

  it('rejects a non-symmetric matrix rather than silently symmetrising it', () => {
    expect(() => symmetricEigen([[1, 5], [0, 1]])).toThrow(/symmetric/)
  })
})

describe('ml/random', () => {
  it('is reproducible from the same seed and different across seeds', () => {
    const a = [createRandomSource(7).next(), createRandomSource(7).next()]
    const first = createRandomSource(7)
    const second = createRandomSource(7)
    expect(first.next()).toBe(second.next())
    expect(first.next()).toBe(second.next())
    expect(a[0]).not.toBe(createRandomSource(8).next())
  })

  it('draws uniforms inside [0, 1)', () => {
    const random = createRandomSource(3)
    for (let i = 0; i < 2000; i += 1) {
      const value = random.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('draws standard normals with the right first two moments', () => {
    const random = createRandomSource(101)
    const draws = Array.from({ length: 20000 }, () => random.normal())
    const mean = draws.reduce((sum, v) => sum + v, 0) / draws.length
    const variance = draws.reduce((sum, v) => sum + (v - mean) ** 2, 0) / draws.length
    expect(Math.abs(mean)).toBeLessThan(0.03)
    expect(variance).toBeGreaterThan(0.9)
    expect(variance).toBeLessThan(1.1)
    expect(draws.every(Number.isFinite)).toBe(true)
  })

  it('shuffles deterministically and keeps every element', () => {
    const order = [0, 1, 2, 3, 4, 5, 6, 7]
    const shuffled = shuffleInPlace([...order], createRandomSource(5))
    expect([...shuffled].sort((x, y) => x - y)).toEqual(order)
    expect(shuffleInPlace([...order], createRandomSource(5))).toEqual(shuffled)
  })

  it('validates bounds instead of returning garbage', () => {
    const random = createRandomSource(1)
    expect(() => random.integer(0)).toThrow(/positive integer/)
    expect(() => random.range(2, 1)).toThrow(/high > low/)
  })
})

describe('ml/optimizers', () => {
  const rosenbrock = (p: readonly number[]): number =>
    (1 - p[0]) ** 2 + 100 * (p[1] - p[0] * p[0]) ** 2

  it('brings Nelder-Mead to the Rosenbrock valley from a corner start', () => {
    const result = nelderMead(rosenbrock, [-1, 1], {
      bounds: [{ low: -2, high: 2 }, { low: -2, high: 2 }],
      maxEvaluations: 800,
    })
    expect(result.objective).toBeLessThan(1e-6)
    expect(result.parameters[0]).toBeCloseTo(1, 3)
    expect(result.parameters[1]).toBeCloseTo(1, 3)
    expect(result.evaluations).toBeLessThanOrEqual(800)
  })

  it('finds the global basin of Rastrigin with differential evolution', () => {
    // 10·d + Σ (x² − A cos(2πx)) has its unique global minimum 0 at the origin
    // and dozens of local minima, so only a global search should reach it.
    const dimension = 2
    const rastrigin = (p: readonly number[]): number =>
      10 * dimension + p.reduce((sum, value) => sum + value * value - 10 * Math.cos(2 * Math.PI * value), 0)
    const result = differentialEvolution(rastrigin, {
      bounds: Array.from({ length: dimension }, () => ({ low: -5.12, high: 5.12 })),
      maxEvaluations: 4000,
      seed: 42,
    })
    expect(result.objective).toBeLessThan(1e-6)
    expect(Math.max(...result.parameters.map(Math.abs))).toBeLessThan(1e-3)
    expect(result.termination).toBe('converged')
    expect(result.evaluations).toBeLessThanOrEqual(4000)
  })

  it('separates a local method from a global one on two wells of different depth', () => {
    // Nelder-Mead is a local method: from any start in the shallow well it
    // refines that well and never crosses the ridge, so its best value is the
    // 0.2 floor. DE explores the whole box and reaches the deep well's floor.
    // The 0.2 offset is the claim being tested, not a tuned tolerance.
    const shallow = (p: readonly number[]): number => 0.2 + (p[0] + 1.5) ** 2 + (p[1] - 1.5) ** 2
    const deep = (p: readonly number[]): number => (p[0] - 1.5) ** 2 + (p[1] + 1.5) ** 2
    const wells = (p: readonly number[]): number => Math.min(shallow(p), deep(p))
    const bounds = [
      { low: -4, high: 4 },
      { low: -4, high: 4 },
    ]

    for (const start of [[-1.5, 1.5], [-3.5, 3.5], [-1, 1]]) {
      const local = nelderMead(wells, start, { bounds, maxEvaluations: 600 })
      expect(local.objective).toBeGreaterThanOrEqual(0.199999)
      expect(local.parameters[0]).toBeLessThan(0)
    }

    const global = differentialEvolution(wells, { bounds, maxEvaluations: 2000, seed: 42 })
    expect(global.objective).toBeLessThan(0.2)
    expect(global.parameters[0]).toBeGreaterThan(0)
    expect(global.parameters[1]).toBeLessThan(0)
  })

  it('respects the evaluation budget exactly', () => {
    let calls = 0
    const counted = (p: readonly number[]): number => {
      calls += 1
      return p[0] ** 2
    }
    const de = differentialEvolution(counted, { bounds: [{ low: -1, high: 1 }], maxEvaluations: 40, seed: 1 })
    expect(calls).toBe(de.evaluations)
    expect(calls).toBeLessThanOrEqual(40)
    const nm = nelderMead(counted, [0.5], { bounds: [{ low: -1, high: 1 }], maxEvaluations: 25 })
    expect(nm.evaluations).toBeLessThanOrEqual(25)
  })

  it('clips the search to the supplied bounds', () => {
    const optimumOutside = (p: readonly number[]): number => (p[0] - 100) ** 2
    const result = nelderMead(optimumOutside, [0], {
      bounds: [{ low: -1, high: 1 }],
      maxEvaluations: 100,
    })
    expect(result.parameters[0]).toBeLessThanOrEqual(1)
    expect(result.parameters[0]).toBeGreaterThanOrEqual(-1)
  })

  it('refuses to rank a crashed simulation: a non-finite objective throws', () => {
    expect(() => safeEvaluate(() => Number.NaN, [0])).toThrow(/non-finite|NaN/)
    expect(() =>
      differentialEvolution((p) => (p[0] > 0.5 ? Number.POSITIVE_INFINITY : p[0]), {
        bounds: [{ low: 0, high: 1 }],
        maxEvaluations: 500,
        seed: 3,
      }),
    ).toThrow()
  })

  it('reports convergence or budget truthfully', () => {
    const flat = (): number => 1
    const converged = nelderMead(flat, [0], { bounds: [{ low: -1, high: 1 }], maxEvaluations: 200 })
    expect(converged.termination).toBe('converged')
    const limited = differentialEvolution((p) => p[0], {
      bounds: [{ low: 0, high: 1 }],
      maxEvaluations: 60,
      seed: 9,
    })
    expect(['budget', 'converged']).toContain(limited.termination)
  })

  it('anneals toward a one-dimensional minimum', () => {
    const result = simulatedAnnealing((p) => (p[0] - 3) ** 2 + (p[1] + 1) ** 2, [0, 0], {
      bounds: [{ low: -5, high: 5 }, { low: -5, high: 5 }],
      maxEvaluations: 1500,
      seed: 12,
    })
    expect(result.objective).toBeLessThan(0.1)
    expect(result.evaluations).toBeLessThanOrEqual(1500)
  })

  it('rejects an impossible problem definition', () => {
    expect(() => nelderMead((p) => p[0], [0], { bounds: [], maxEvaluations: 100 })).toThrow(/at least one parameter/)
    expect(() => nelderMead((p) => p[0], [0], { bounds: [{ low: 1, high: 1 }], maxEvaluations: 100 })).toThrow(/high > low/)
    expect(() => nelderMead((p) => p[0], [0, 0], { bounds: [{ low: 0, high: 1 }], maxEvaluations: 100 })).toThrow(/Start point/)
  })
})

describe('ml/regression', () => {
  it('fits an exact plane and reports a perfect in-sample score', () => {
    const rows = [[1, 0], [0, 1], [1, 1], [2, 1], [0, 2], [3, 3], [1, 2], [2, 0], [0, 3], [4, 1], [1, 4], [2, 2]]
    const targets = rows.map(([a, b]) => 3 * a - 2 * b + 5)
    const model = fitLinearRegression(rows, targets)
    expect(model.intercept).toBeCloseTo(5, 8)
    expect(model.weights[0]).toBeCloseTo(3, 8)
    expect(model.weights[1]).toBeCloseTo(-2, 8)
    expect(model.metrics.r2).toBeCloseTo(1, 10)
    expect(model.crossValidatedRmse).toBeLessThan(1e-6)
  })

  it('recovers a known cubic through a polynomial fit', () => {
    const xs = Array.from({ length: 25 }, (_, i) => -3 + i * 0.25)
    const ys = xs.map((x) => 0.3 * x ** 3 - 1.2 * x ** 2 + 0.4 * x + 2.5)
    const fit = fitPolynomial(xs, ys, 3)
    for (let x = -3; x <= 3; x += 0.5) {
      expect(fit.predict(x)).toBeCloseTo(0.3 * x ** 3 - 1.2 * x ** 2 + 0.4 * x + 2.5, 6)
    }
    expect(fit.crossValidatedRmse).toBeLessThan(1e-6)
  })

  it('states that R² is undefined for a constant target rather than claiming 1', () => {
    const metrics = evaluateFit([2, 2, 2, 2], [2, 2, 2, 2])
    expect(Number.isNaN(metrics.r2)).toBe(true)
    expect(metrics.rmse).toBe(0)
  })

  it('throws when a feature carries no information', () => {
    const rows = [[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]]
    expect(() => fitLinearRegression(rows, rows.map((r) => r[0]))).toThrow(/constant across all samples/)
  })
})

describe('ml/gaussianProcess', () => {
  it('interpolates noiseless training data and shrinks the error bar there', () => {
    const gp = new GaussianProcessRegressor()
    const inputs = [[0], [1], [2], [3], [4]]
    const targets = [0, 1, 2, 3, 4]
    gp.fit(inputs, targets)
    for (let i = 0; i < inputs.length; i += 1) {
      expect(gp.predict(inputs[i]).mean).toBeCloseTo(targets[i], 2)
    }
    // The selected noise must be far below the signal spread, or the surrogate
    // is smoothing away the data it was given.
    expect(gp.selectedNoiseStdDev).toBeLessThan(0.1)
  })

  it('grows predictive uncertainty away from the data instead of pretending to know', () => {
    const gp = new GaussianProcessRegressor({ lengthScaleCandidates: [1] })
    gp.fit([[0], [1]], [0, 1])
    const near = gp.predict([0.5]).standardDeviation
    const far = gp.predict([12]).standardDeviation
    expect(far).toBeGreaterThan(near)
    // Prior-dominated: the mean relaxes toward the training mean.
    expect(Math.abs(gp.predict([12]).mean - 0.5)).toBeLessThan(0.5)
  })

  it('selects a smoother length scale for a slowly varying function by marginal likelihood', () => {
    const xs = Array.from({ length: 9 }, (_, i) => [i])
    const smooth = xs.map(([x]) => Math.sin(x / 6))
    const wiggly = xs.map(([x]) => Math.sin(x * 2.2))
    const gpSmooth = new GaussianProcessRegressor({ lengthScaleCandidates: [0.5, 1, 2, 4, 8] }).fit(xs, smooth)
    const gpWiggly = new GaussianProcessRegressor({ lengthScaleCandidates: [0.5, 1, 2, 4, 8] }).fit(xs, wiggly)
    expect(gpSmooth.selectedLengthScale).toBeGreaterThan(gpWiggly.selectedLengthScale)
  })

  it('predicts a held-out point better than the training mean does', () => {
    const xs = Array.from({ length: 12 }, (_, i) => [i * 0.5])
    const ys = xs.map(([x]) => (x - 3) ** 2 / 9)
    // Leave-one-out is the honest surrogate test: every point is predicted by a
    // process that never saw it.
    let error = 0
    for (let i = 0; i < xs.length; i += 1) {
      const held = new GaussianProcessRegressor().fit(
        xs.filter((_, index) => index !== i),
        ys.filter((_, index) => index !== i),
      )
      error += (held.predict(xs[i]).mean - ys[i]) ** 2
    }
    const looRmse = Math.sqrt(error / xs.length)
    const priorSd = standardDeviation(ys)
    expect(looRmse).toBeLessThan(priorSd / 4)
  })

  it('rejects degenerate training sets', () => {
    expect(() => new GaussianProcessRegressor().fit([[0]], [1])).toThrow(/at least two/)
    expect(() => new GaussianProcessRegressor().fit([[0], [1]], [1])).toThrow(/counts disagree/)
    expect(() => new GaussianProcessRegressor().fit([[0], [1]], [Number.NaN, 2])).toThrow(/finite/)
    const gp = new GaussianProcessRegressor().fit([[0], [1]], [0, 1])
    expect(() => gp.predict([0, 1])).toThrow(/expects 1 features/)
  })
})

describe('ml/clustering', () => {
  const blobs = (): number[][] => {
    const random = createRandomSource(19)
    const out: number[][] = []
    for (let i = 0; i < 30; i += 1) out.push([random.normal(0, 0.1), random.normal(0, 0.1)])
    for (let i = 0; i < 30; i += 1) out.push([random.normal(6, 0.1), random.normal(4, 0.1)])
    for (let i = 0; i < 30; i += 1) out.push([random.normal(-5, 0.1), random.normal(7, 0.1)])
    return out
  }

  it('separates three well-spaced blobs and says so with a high silhouette', () => {
    const points = blobs()
    const result = cluster(points, { clusters: 3, seed: 5 })
    expect(result.centroids).toHaveLength(3)
    expect(result.silhouette).toBeGreaterThan(0.8)
    expect(result.termination).toBe('converged')

    // Every member of a blob shares a label, and the three blobs get distinct labels.
    const labelOf = (offset: number): number => result.assignments[offset]
    const groups = [0, 30, 60].map((offset) => new Set(result.assignments.slice(offset, offset + 30)))
    expect(groups.every((group) => group.size === 1)).toBe(true)
    expect(new Set(groups.map((group) => [...group][0])).size).toBe(3)
    expect(labelOf(0)).not.toBe(labelOf(30))
  })

  it('inertia does not grow with more clusters and shows an elbow at the true count', () => {
    const curve = evaluateClusterCounts(blobs(), [1, 2, 3, 4, 5], { seed: 2 })
    for (let i = 1; i < curve.length; i += 1) {
      expect(curve[i].inertia).toBeLessThanOrEqual(curve[i - 1].inertia + 1e-9)
    }
    // Two clusters must merge two blobs, so inertia is enormous; the third
    // removes it, and a fourth buys only a marginal split of one tight blob.
    expect(curve[1].inertia).toBeGreaterThan(100)
    expect(curve[2].inertia).toBeLessThan(curve[1].inertia / 50)
    expect(curve[3].inertia).toBeGreaterThan(curve[2].inertia * 0.5)
  })

  it('reproduces the hand-computed inertia of a trivial four-point partition', () => {
    const points = [[0, 0], [0, 1], [10, 10], [10, 11]]
    const result = cluster(points, { clusters: 2, seed: 1 })
    // Centroids [0, 0.5] and [10, 10.5]; every point is 0.5 away → 4 × 0.25 = 1.
    expect(result.inertia).toBeCloseTo(1, 9)
    expect(new Set(result.assignments.slice(0, 2)).size).toBe(1)
    expect(new Set(result.assignments.slice(2)).size).toBe(1)
  })

  it('computes the silhouette of a hand-checkable configuration', () => {
    // Two points each at unit distance from their own centroid and 2 apart:
    // a = 1 (to the partner), b = distance to the other cluster's members.
    const points = [[0, 0], [1, 0], [10, 0], [11, 0]]
    const width = silhouetteWidth(points, [0, 0, 1, 1], 2)
    expect(width).toBeGreaterThan(0.5)
    expect(width).toBeLessThanOrEqual(1)
    expect(silhouetteWidth(points, [0, 0, 0, 0], 1)).toBeNaN()
  })

  it('refuses impossible cluster counts', () => {
    expect(() => cluster([[0]], { clusters: 2 })).toThrow(/each cluster needs at least one member/)
    expect(() => cluster([], { clusters: 1 })).toThrow(/at least one point/)
    expect(() => cluster([[0], [1, 2]], { clusters: 2 })).toThrow(/Ragged/)
    expect(() => cluster([[0], [Number.NaN]], { clusters: 1 })).toThrow(/finite/)
  })
})

describe('ml/dimensionality', () => {
  it('recovers the variance ordering of a known two-feature covariance', () => {
    // y = 2x exactly: one direction carries all the variance, the other none.
    const rows = Array.from({ length: 40 }, (_, i) => [i - 20, 2 * (i - 20) + 1e-9 * i])
    const pca = fitPca(rows, { standardise: false })
    expect(pca.eigenvalues[0]).toBeGreaterThan(pca.eigenvalues[1])
    expect(pca.explainedVarianceRatio[0]).toBeGreaterThan(0.999)
    expect(pca.cumulativeExplainedVariance[1]).toBeCloseTo(1, 9)
  })

  it('round-trips through all components and loses variance when it is truncated', () => {
    const rows = Array.from({ length: 30 }, (_, i) => [i, i * 2, Math.sin(i)])
    const full = fitPca(rows)
    expect(full.retainedVarianceFraction).toBeCloseTo(1, 9)
    const residual = reconstructionResidual(full, rows)
    expect(residual.rmse).toBeLessThan(1e-8)

    const one = fitPca(rows, { components: 1 })
    expect(one.retainedVarianceFraction).toBeLessThan(1)
    expect(reconstructionResidual(one, rows).rmse).toBeGreaterThan(0)
  })

  it('produces a correlation matrix with unit diagonal and the right sign', () => {
    const x = Array.from({ length: 20 }, (_, i) => i)
    const rows = x.map((value) => [value, -2 * value + 3, 0.5])
    const correlation = correlationMatrix(rows)
    expect(correlation[0][0]).toBeCloseTo(1, 8)
    expect(correlation[1][1]).toBeCloseTo(1, 8)
    expect(correlation[0][1]).toBeCloseTo(-1, 6)
    expect(correlation[1][0]).toBeCloseTo(-1, 6)
    // A constant column has no defined correlation, and saying 0 there would
    // read as "independent" instead of "no information".
    expect(Number.isNaN(correlation[0][2])).toBe(true)
  })

  it('standardises so a column in milliunits is not swamped by a column in megauunits', () => {
    const rows = Array.from({ length: 25 }, (_, i) => [i * 1e6, (i % 5) * 1e-3])
    const standardised = fitPca(rows, { standardise: true })
    // Either direction can lead once scaled; the point is that both contribute.
    expect(standardised.explainedVarianceRatio[1]).toBeGreaterThan(0.2)
    const raw = fitPca(rows, { standardise: false })
    expect(raw.explainedVarianceRatio[0]).toBeGreaterThan(0.9999)
  })

  it('refuses degenerate inputs', () => {
    expect(() => fitPca([[1, 2]])).toThrow(/at least two samples/)
    expect(() => fitPca([[1, 1], [2, 2], [3, 3]], { components: 4 })).toThrow(/integer in 1\.\.2/)
    expect(() => correlationMatrix([[1]])).toThrow(/at least two samples/)
  })
})

describe('ml/neural', () => {
  it('learns XOR, the standard check that backprop is wired correctly', () => {
    const inputs = [[0, 0], [0, 1], [1, 0], [1, 1]]
    const targets = [0, 1, 1, 0]
    // Oversample the four patterns so a 4-sample split still leaves training data.
    const repeated = Array.from({ length: 8 }, () => inputs).flat()
    const labels = Array.from({ length: 8 }, () => targets).flat()
    const network = trainNeuralNetwork(repeated, labels, {
      hiddenLayers: [6],
      outputs: 2,
      activation: 'tanh',
      learningRate: 0.3,
      epochs: 400,
      validationSplit: 0,
      seed: 7,
    })
    for (let i = 0; i < inputs.length; i += 1) {
      expect(network.classify(inputs[i])).toBe(targets[i])
    }
    expect(network.report.finalTrainLoss).toBeLessThan(0.05)
  })

  it('fits a smooth scalar function as regression', () => {
    const xs = Array.from({ length: 60 }, (_, i) => i / 59)
    const inputs = xs.map((x) => [x])
    const targets = xs.map((x) => Math.sin(2 * Math.PI * x))
    const network = trainNeuralNetwork(inputs, targets, {
      hiddenLayers: [12, 8],
      outputs: 1,
      learningRate: 0.05,
      epochs: 600,
      validationSplit: 0.2,
      miniBatchSize: 8,
      seed: 3,
    })
    const report = network.report
    expect(report.finalValidationLoss).not.toBeNull()
    expect(report.finalValidationLoss!).toBeLessThan(0.02)
    expect(report.lossHistory).toHaveLength(600)
    expect(report.parameterCount).toBe(1 * 12 + 12 + 12 * 8 + 8 + 8 + 1)
  })

  it('reports held-out accuracy for a separable classification task', () => {
    const random = createRandomSource(21)
    const inputs: number[][] = []
    const targets: number[] = []
    for (let i = 0; i < 40; i += 1) {
      inputs.push([random.normal(0, 0.4), random.normal(0, 0.4)])
      targets.push(0)
      inputs.push([random.normal(3, 0.4), random.normal(3, 0.4)])
      targets.push(1)
    }
    const network = trainNeuralNetwork(inputs, targets, {
      hiddenLayers: [8],
      outputs: 2,
      learningRate: 0.05,
      epochs: 200,
      validationSplit: 0.3,
      seed: 5,
    })
    const accuracy = network.report.validationAccuracy
    expect(accuracy).not.toBeNull()
    expect(accuracy ?? 0).toBeGreaterThan(0.9)
    expect(network.report.validationSize).toBeGreaterThan(0)
  })

  it('validates its dataset and hyper-parameters instead of diverging silently', () => {
    expect(() => trainNeuralNetwork([[0]], [0], { hiddenLayers: [], outputs: 1 })).toThrow(/hidden layer/)
    expect(() => trainNeuralNetwork([[0]], [0], { hiddenLayers: [2], outputs: 0 })).toThrow(/positive integer/)
    expect(() => trainNeuralNetwork([[0]], [5], { hiddenLayers: [2], outputs: 2 })).toThrow(/integers in 0/)
    expect(() => trainNeuralNetwork([[0]], [0], { hiddenLayers: [2], outputs: 1, learningRate: 0 })).toThrow(/Learning rate/)
    expect(() => trainNeuralNetwork([[0], [1]], [0, Number.NaN], { hiddenLayers: [2], outputs: 1 })).toThrow(/finite/)
  })

  it('throws rather than training a network into non-finite weights', () => {
    // Adam cannot overflow on its own — its step is bounded by the learning rate
    // however large the gradient — so the anchor has to be a magnitude the
    // forward pass itself cannot survive: relu carries 1e200 through and the
    // squared loss on top of it is Infinity. A trainer that carried on would
    // plot an Infinity loss as if it were a converged training curve.
    expect(() =>
      trainNeuralNetwork([[1e200], [2e200]], [1, 2], {
        hiddenLayers: [4],
        outputs: 1,
        activation: 'relu',
        epochs: 5,
        validationSplit: 0,
        seed: 1,
      }),
    ).toThrow(/non-finite/)
  })
})

describe('ml/systemIdentification', () => {
  it('recovers a known ARX difference equation exactly from noiseless data', () => {
    // y(k) = 0.6·y(k−1) + 0.3·u(k−1), simulated from rest. Both series are the
    // same length: y[k] is produced from the *previous* input sample, which is
    // exactly what delay = 1, nb = 0 means.
    const na = 1
    const nb = 0
    const y: number[] = []
    const u: number[] = []
    const random = createRandomSource(4)
    for (let k = 0; k < 200; k += 1) {
      const input = random.normal(0, 1)
      y.push(k === 0 ? 0 : 0.6 * y[k - 1] + 0.3 * u[k - 1])
      u.push(input)
    }
    const model = fitArx(y, u, { na, nb, delay: 1 })
    expect(model.coefficients[0]).toBeCloseTo(0.6, 8)
    expect(model.coefficients[1]).toBeCloseTo(0.3, 8)
    expect(model.oneStep.rmse).toBeLessThan(1e-8)
    expect(model.freeRun.rmse).toBeLessThan(1e-6)
    expect(model.aPolynomial[0]).toBe(1)
    expect(model.aPolynomial[1]).toBeCloseTo(-0.6, 8)
    expect(model.bPolynomial).toHaveLength(1)
    expect(model.bPolynomial[0]).toBeCloseTo(0.3, 8)
    // predict() must agree with the free-running simulation it is the one-step form of.
    expect(model.predict(y.slice(0, 20), u.slice(0, 20))).toBeCloseTo(y[20], 8)
  })

  it('separates one-step prediction from free-run quality on an over-fitted structure', () => {
    const y: number[] = []
    const u: number[] = []
    const random = createRandomSource(9)
    for (let k = 0; k < 300; k += 1) {
      const input = random.normal(0, 1)
      // True plant is first order; measurement noise is added only to y.
      y.push(k === 0 ? 0 : 0.8 * y[k - 1] + 0.2 * u[k - 1] + random.normal(0, 0.05))
      u.push(input)
    }
    const model = fitArx(y, u, { na: 1, nb: 0, delay: 1 })
    // Both scores are finite, and a free run cannot beat a one-step prediction
    // when the measurement itself is noisy: the errors compound through the
    // pole instead of being reset by the measured past.
    expect(Number.isFinite(model.oneStep.rmse)).toBe(true)
    expect(Number.isFinite(model.freeRun.rmse)).toBe(true)
    expect(model.freeRun.rmse).toBeGreaterThanOrEqual(model.oneStep.rmse)
    expect(model.coefficients[0]).toBeCloseTo(0.8, 1)
    expect(model.coefficients[1]).toBeCloseTo(0.2, 1)
  })

  it('refuses a structure the record cannot support', () => {
    expect(() => fitArx([0, 1], [0, 1], { na: 4, nb: 4 })).toThrow(/needs more than/)
    expect(() => fitArx([0, 1, 2], [0, 1], { na: 1, nb: 1 })).toThrow(/same length/)
    expect(() => fitArx([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 1, 2, 3, 4, 5, 6, 7, 8, Number.NaN], { na: 1, nb: 1 })).toThrow(/non-finite/)
  })

  it('identifies a synthetic FOPDT curve to its own parameters', () => {
    const trueGain = 2.5
    const trueTau = 0.8
    const trueTheta = 0.3
    const stepSize = 4
    // Eight time constants long, so the tail really is the plateau.
    const times = Array.from({ length: 800 }, (_, i) => i * 0.01)
    const response = times.map((t) =>
      t <= trueTheta ? 1 : 1 + trueGain * stepSize * (1 - Math.exp(-(t - trueTheta) / trueTau)),
    )
    const fit = fitFopdt(times, response, { stepSize, fromValue: 1 })
    expect(fit.gain).toBeCloseTo(trueGain, 2)
    expect(fit.timeConstant).toBeCloseTo(trueTau, 2)
    expect(fit.deadTime).toBeCloseTo(trueTheta, 2)
    expect(fit.baseline).toBe(1)
    // The fitted curve must sit inside 1 % of the achieved excursion everywhere.
    expect(fit.fit.rmse / (trueGain * stepSize)).toBeLessThan(0.01)
    expect(fit.fit.maxAbsoluteError / (trueGain * stepSize)).toBeLessThan(0.02)
    expect(fit.validityNotes.join(' ')).not.toMatch(/still moved/)
  })

  it('handles a falling (negative-gain) step test', () => {
    const times = Array.from({ length: 600 }, (_, i) => i * 0.01)
    const response = times.map((t) => 10 - 3 * (1 - Math.exp(-t / 0.5)))
    const fit = fitFopdt(times, response, { stepSize: 1, fromValue: 10 })
    expect(fit.gain).toBeCloseTo(-3, 2)
    expect(fit.timeConstant).toBeCloseTo(0.5, 2)
    expect(fit.deadTime).toBeCloseTo(0, 1)
  })

  it('refuses a step test with no response', () => {
    const times = Array.from({ length: 100 }, (_, i) => i * 0.01)
    expect(() => fitFopdt(times, times.map(() => 5), { stepSize: 1 })).toThrow(/did not move measurably/)
    expect(() => fitFopdt(times, times.map((t) => Math.sin(t)), { stepSize: 0 })).toThrow(/non-zero/)
  })

  it('measures a known first-order frequency response: gain and phase sign', () => {
    // Analytic reference for H(jω) = K/(1 + jωτ).
    const K = 2
    const tau = 0.1
    const interval = 0.0005
    const duration = 4
    const times = Array.from({ length: Math.round(duration / interval) }, (_, i) => i * interval)
    const frequency = 1.5
    const omega = 2 * Math.PI * frequency
    const input = times.map((t) => Math.sin(omega * t))
    const gain = K / Math.sqrt(1 + (omega * tau) ** 2)
    const phase = -Math.atan(omega * tau)
    const steady = times.map((t) => {
      // Exact steady-state response of H(jω) = K/(1 + jωτ) to sin(ωt):
      // y(t) = K·[sin(ωt) − ωτ·cos(ωt)] / (1 + (ωτ)²). No transient is included,
      // so any disagreement is the estimator's own error, not the plant's.
      const angle = omega * t
      return (K / (1 + (omega * tau) ** 2)) * (Math.sin(angle) - omega * tau * Math.cos(angle))
    })
    const estimate = estimateFrequencyResponse(times, input, steady, [frequency, 1e6])
    expect(estimate.points).toHaveLength(1)
    const point = estimate.points[0]
    expect(point.frequencyHz).toBe(frequency)
    expect(point.magnitudeDb).toBeCloseTo(20 * Math.log10(gain), 9)
    expect(point.phaseDeg).toBeCloseTo(phase * (180 / Math.PI), 9)
    expect(point.flags).toHaveLength(0)
    expect(point.explainedPowerRatio).toBeGreaterThan(0.9999)
    // The over-Nyquist request must be refused, not alienced into a reading.
    expect(estimate.rejected.some((entry) => entry.reason.includes('Nyquist'))).toBe(true)
  })

  it('flags a frequency point that is mostly noise', () => {
    const interval = 0.001
    const times = Array.from({ length: 2000 }, (_, i) => i * interval)
    const frequency = 5
    const omega = 2 * Math.PI * frequency
    const input = times.map((t) => Math.sin(omega * t))
    const random = createRandomSource(2)
    const output = times.map(() => random.normal(0, 1))
    const estimate = estimateFrequencyResponse(times, input, output, [frequency])
    // The point is still reported — hiding it would lose the information that a
    // reading exists — but it carries the reason it cannot be trusted.
    expect(estimate.points).toHaveLength(1)
    expect(estimate.points[0].flags.join(' ')).toContain('% of the output energy')
    expect(estimate.points[0].explainedPowerRatio).toBeLessThan(0.2)
  })

  it('refuses records that cannot support a quadrature estimate', () => {
    const times = Array.from({ length: 100 }, (_, i) => i)
    const flat = times.map(() => 0)
    const estimate = estimateFrequencyResponse(times, flat, flat, [0.001])
    expect(estimate.points).toHaveLength(0)
    expect(estimate.rejected[0].reason).toMatch(/too short|No excitation/)
    expect(() => estimateFrequencyResponse(times, flat, flat, [0.1], {})).not.toThrow()
  })
})
