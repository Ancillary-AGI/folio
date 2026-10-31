/**
 * One contiguous batch of a Monte Carlo sweep, executed off the main thread.
 *
 * The batch is deliberately pure and self-contained: given the model, the
 * analysis and the run indices, it produces exactly the samples the in-thread
 * loop would produce for those indices. Per-run seeds make that true regardless
 * of how the sweep is split, and the main thread re-accumulates the samples in
 * run order, so the pooled statistics are identical rather than approximate.
 */

import { runCircuitAnalysis } from '../simulation/analysisRunner'
import type { CircuitModel } from '../simulation/circuitModel'
import {
  deriveMonteCarloRunSeed,
  perturbCircuitModel,
  sampleRun,
  type MonteCarloRunSample,
} from '../simulation/monteCarlo'
import { createSeededRandom } from '../simulation/numeric'
import type { SimulationParameters } from '../simulation/spiceEngine'

export interface MonteCarloBatchRequest {
  model: CircuitModel
  /** The per-run analysis, usually a DC operating point. */
  analysis: SimulationParameters
  /** Run indices assigned to this batch, in ascending order. */
  runIndices: number[]
  tolerance: number
  distribution: 'gaussian' | 'uniform'
  seed: number
}

export function executeMonteCarloBatch(request: MonteCarloBatchRequest): MonteCarloRunSample[] {
  return request.runIndices.map((runIndex) => {
    const random = createSeededRandom(deriveMonteCarloRunSeed(request.seed, runIndex))
    const perturbed = perturbCircuitModel(request.model, random, request.tolerance, request.distribution)
    return sampleRun(runCircuitAnalysis(perturbed, request.analysis))
  })
}
