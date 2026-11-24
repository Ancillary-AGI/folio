/**
 * Derivative-free optimisers for design search and controller tuning.
 *
 * These are the workhorses behind "let a heuristic find the gains":
 *   • Nelder-Mead — fast local refinement, no gradients (our simulations give
 *     an objective value, not a derivative).
 *   • Differential evolution — global, population-based, robust on multimodal
 *     control objectives.
 *   • Simulated annealing — good when the objective is noisy.
 *
 * Every routine is bounded by an explicit evaluation budget, is reproducible
 * from a seed, and reports why it stopped. No run claims to have found "the"
 * optimum: these are search heuristics, so the result carries the best value
 * seen plus the budget consumed, and the caller decides whether that is enough.
 */

import { createRandomSource, type RandomSource } from './random'

export interface Bounds {
  low: number
  high: number
}

export interface OptimizerResult {
  parameters: number[]
  objective: number
  evaluations: number
  /** Best objective seen after each iteration, for a convergence plot. */
  history: number[]
  termination: 'budget' | 'converged'
}

export interface OptimizerOptions {
  bounds: Bounds[]
  /** Hard cap on objective evaluations — the only stopping rule that is always honest. */
  maxEvaluations: number
  seed?: number
}

function validateProblem(objective: (parameters: readonly number[]) => number, bounds: Bounds[]): number {
  if (typeof objective !== 'function') throw new Error('Optimizer needs an objective function.')
  if (bounds.length === 0) throw new Error('Optimizer needs at least one parameter.')
  for (const bound of bounds) {
    if (!Number.isFinite(bound.low) || !Number.isFinite(bound.high) || !(bound.high > bound.low)) {
      throw new Error(`Each parameter needs finite bounds with high > low, got [${bound.low}, ${bound.high}].`)
    }
  }
  if (!Number.isInteger(bounds.length)) throw new Error('Bounds list length must be an integer.')
  return bounds.length
}

function clampToBounds(parameters: readonly number[], bounds: Bounds[]): number[] {
  return parameters.map((value, index) => Math.min(bounds[index].high, Math.max(bounds[index].low, value)))
}

/**
 * Evaluates the objective, rejecting NaN/Infinity outright: a solver that
 * quietly accepted a non-finite cost would rank a crashed simulation as
 * "worse than everything" and carry on, hiding the crash from the engineer.
 */
export function safeEvaluate(
  objective: (parameters: readonly number[]) => number,
  parameters: readonly number[],
): number {
  const value = objective(parameters)
  if (!Number.isFinite(value)) {
    throw new Error(`Objective returned ${value} for parameters [${parameters.join(', ')}]; fix the objective, not the search.`)
  }
  return value
}

class EvaluationCounter {
  used = 0

  constructor(readonly limit: number) {}

  get exhausted(): boolean {
    return this.used >= this.limit
  }

  /**
   * Returns `null` once the cap is reached instead of throwing. A solver that
   * threw here would turn a perfectly ordinary "the budget ran out mid-
   * iteration" outcome into a crash, and a solver that returned a fake number
   * would rank a never-evaluated point as if it had been measured. Callers
   * treat `null` as "stop now, keep what you have".
   */
  evaluate(objective: (parameters: readonly number[]) => number, parameters: readonly number[]): number | null {
    if (this.exhausted) return null
    this.used += 1
    return safeEvaluate(objective, parameters)
  }

  /** For setup calls that the pre-flight budget validation guarantees will fit. */
  evaluateWithinBudget(objective: (parameters: readonly number[]) => number, parameters: readonly number[]): number {
    const value = this.evaluate(objective, parameters)
    if (value === null) throw new Error('Internal: setup evaluation requested past the budget cap.')
    return value
  }
}

/** Nelder-Mead simplex. Local, deterministic, no gradients. */
export function nelderMead(
  objective: (parameters: readonly number[]) => number,
  start: readonly number[],
  options: OptimizerOptions,
): OptimizerResult {
  const dimension = validateProblem(objective, options.bounds)
  if (start.length !== dimension) throw new Error(`Start point has ${start.length} entries, bounds describe ${dimension}.`)
  if (!Number.isInteger(options.maxEvaluations) || options.maxEvaluations < dimension * 10) {
    throw new Error(`Budget must be at least 10× the dimension for Nelder-Mead, got ${options.maxEvaluations}.`)
  }

  const budget = new EvaluationCounter(options.maxEvaluations)
  const origin = clampToBounds(start, options.bounds)
  // The initial simplex: one vertex at the start point, the others displaced by
  // 25 % of each parameter's span (a fixed 0.05 step collapses on wide bounds).
  const simplex: Array<{ point: number[]; value: number }> = [
    { point: origin, value: budget.evaluateWithinBudget(objective, origin) },
  ]
  for (let d = 0; d < dimension; d += 1) {
    const span = options.bounds[d].high - options.bounds[d].low
    const point = [...origin]
    point[d] = Math.min(options.bounds[d].high, Math.max(options.bounds[d].low, point[d] + 0.25 * span))
    simplex.push({ point, value: budget.evaluateWithinBudget(objective, point) })
  }

  const history: number[] = [Math.min(...simplex.map((vertex) => vertex.value))]
  const reflect = 1
  const expand = 2
  const contract = 0.5
  const shrink = 0.5

  while (!budget.exhausted) {
    simplex.sort((a, b) => a.value - b.value)
    const best = simplex[0]
    const worst = simplex[simplex.length - 1]
    const secondWorst = simplex[simplex.length - 2]
    history.push(best.value)
    if (Math.abs(worst.value - best.value) < 1e-12 * Math.max(1, Math.abs(best.value))) {
      return finish(best, budget, history, 'converged')
    }

    const centroid = new Array<number>(dimension).fill(0)
    for (let i = 0; i < simplex.length - 1; i += 1) {
      for (let d = 0; d < dimension; d += 1) centroid[d] += simplex[i].point[d] / (simplex.length - 1)
    }

    const mirrored = clampToBounds(
      centroid.map((value, d) => value + reflect * (value - worst.point[d])),
      options.bounds,
    )
    const mirrorValue = budget.evaluate(objective, mirrored)
    if (mirrorValue === null) break

    if (mirrorValue < best.value) {
      const expanded = clampToBounds(
        centroid.map((value, d) => value + expand * (mirrored[d] - value)),
        options.bounds,
      )
      const expandValue = budget.evaluate(objective, expanded)
      if (expandValue === null) {
        // The mirror step was already paid for; keep it rather than discard it,
        // then let the outer loop report the budget as the stopping reason.
        simplex[simplex.length - 1] = { point: mirrored, value: mirrorValue }
        break
      }
      if (expandValue < mirrorValue) simplex[simplex.length - 1] = { point: expanded, value: expandValue }
      else simplex[simplex.length - 1] = { point: mirrored, value: mirrorValue }
      continue
    }

    if (mirrorValue < secondWorst.value) {
      simplex[simplex.length - 1] = { point: mirrored, value: mirrorValue }
      continue
    }

    const contracted = clampToBounds(
      centroid.map((value, d) => value + contract * (worst.point[d] - value)),
      options.bounds,
    )
    const contractValue = budget.evaluate(objective, contracted)
    if (contractValue === null) break
    if (contractValue < worst.value) {
      simplex[simplex.length - 1] = { point: contracted, value: contractValue }
      continue
    }

    // Shrink toward the best vertex, re-clamping so the simplex stays in bounds.
    for (let i = 1; i < simplex.length && !budget.exhausted; i += 1) {
      const point = clampToBounds(
        simplex[i].point.map((value, d) => best.point[d] + shrink * (value - best.point[d])),
        options.bounds,
      )
      const value = budget.evaluate(objective, point)
      if (value === null) break
      simplex[i] = { point, value }
    }
  }

  simplex.sort((a, b) => a.value - b.value)
  return finish(simplex[0], budget, history, 'budget')
}

/**
 * Differential evolution (rand/1/bin). Global search over the bounded box;
 * population size and the F/CR pair are the classic literature defaults
 * (F = 0.5–1.0, CR = 0.9) rather than tuned for any particular plant.
 *
 * Stopping rule: `stagnationGenerations` generations with no improvement of the
 * best cost. It is deliberately measured against the value that many
 * generations ago, not as "three identical generations", because a multimodal
 * objective can sit on a local terrace for a handful of generations and then
 * walk off it — quitting there would report a local minimum as converged.
 */
export function differentialEvolution(
  objective: (parameters: readonly number[]) => number,
  options: OptimizerOptions & {
    populationSize?: number
    crossoverRate?: number
    scaleFactor?: number
    stagnationGenerations?: number
  },
): OptimizerResult {
  const dimension = validateProblem(objective, options.bounds)
  const populationSize = options.populationSize ?? Math.max(20, 12 * dimension)
  if (!Number.isInteger(populationSize) || populationSize < 4) {
    throw new Error(`Population size must be an integer ≥ 4, got ${populationSize}.`)
  }
  const crossoverRate = options.crossoverRate ?? 0.9
  const scaleFactor = options.scaleFactor ?? 0.7
  const stagnationGenerations = options.stagnationGenerations ?? 30
  if (!Number.isInteger(stagnationGenerations) || stagnationGenerations < 1) {
    throw new Error(`Stagnation patience must be a positive integer, got ${stagnationGenerations}.`)
  }
  if (!(crossoverRate >= 0 && crossoverRate <= 1)) throw new Error('Crossover rate must be in [0, 1].')
  if (!(scaleFactor > 0 && scaleFactor <= 2)) throw new Error('Scale factor must be in (0, 2].')
  if (!Number.isInteger(options.maxEvaluations) || options.maxEvaluations < 1) {
    throw new Error(`Evaluation budget must be a positive integer, got ${options.maxEvaluations}.`)
  }
  if (options.maxEvaluations < populationSize) {
    throw new Error(`Budget (${options.maxEvaluations}) cannot even afford one population of ${populationSize}.`)
  }

  const random = createRandomSource(options.seed ?? 42)
  const budget = new EvaluationCounter(options.maxEvaluations)

  const randomMember = (): number[] =>
    options.bounds.map((bound) => bound.low + random.next() * (bound.high - bound.low))

  const population = Array.from({ length: populationSize }, () => {
    const point = randomMember()
    return { point, value: budget.evaluateWithinBudget(objective, point) }
  })

  const history: number[] = []
  let generation = 0
  let lastImprovementGeneration = 0
  while (!budget.exhausted) {
    let improved = false
    for (let i = 0; i < populationSize && !budget.exhausted; i += 1) {
      const base = pickDistinct(population, i, random)
      const other = pickDistinct(population, i, random, base)
      const third = pickDistinct(population, i, random, base, other)
      const donor = population[base].point.map((value, d) =>
        clampBetween(value + scaleFactor * (population[other].point[d] - population[third].point[d]), options.bounds[d]),
      )

      const forced = random.integer(dimension)
      const trial = population[i].point.map((value, d) =>
        random.next() < crossoverRate || d === forced ? donor[d] : value,
      )
      const trialValue = budget.evaluate(objective, trial)
      if (trialValue === null) break
      if (trialValue < population[i].value) {
        population[i] = { point: trial, value: trialValue }
        improved = true
      }
    }
    generation += 1
    const best = Math.min(...population.map((member) => member.value))
    history.push(best)
    if (improved) lastImprovementGeneration = generation
    else if (generation - lastImprovementGeneration >= stagnationGenerations) {
      // Only a long run of wholly unaccepted generations counts as converged.
      // A handful of them is DE sitting on a local terrace and walking off it.
      return finish(bestMember(population), budget, history, 'converged')
    }
  }

  return finish(bestMember(population), budget, history, 'budget')
}

function pickDistinct(
  population: Array<{ point: number[]; value: number }>,
  exclude: number,
  random: RandomSource,
  ...alsoExclude: number[]
): number {
  for (let attempt = 0; attempt < 64; attempt += 1) {
    const index = random.integer(population.length)
    if (index !== exclude && !alsoExclude.includes(index)) return index
  }
  throw new Error('Differential evolution needs a population larger than the number of excluded members.')
}

function bestMember(population: Array<{ point: number[]; value: number }>): { point: number[]; value: number } {
  return population.reduce((best, member) => (member.value < best.value ? member : best), population[0])
}

function clampBetween(value: number, bound: Bounds): number {
  return Math.min(bound.high, Math.max(bound.low, value))
}

/** Simulated annealing with a geometric cooling schedule and bounds-clamped moves. */
export function simulatedAnnealing(
  objective: (parameters: readonly number[]) => number,
  start: readonly number[],
  options: OptimizerOptions & { initialTemperature?: number; coolingRate?: number; stepScale?: number },
): OptimizerResult {
  const dimension = validateProblem(objective, options.bounds)
  if (start.length !== dimension) throw new Error(`Start point has ${start.length} entries, bounds describe ${dimension}.`)
  const coolingRate = options.coolingRate ?? 0.97
  if (!(coolingRate > 0 && coolingRate < 1)) throw new Error('Cooling rate must be in (0, 1).')
  const stepScale = options.stepScale ?? 0.2

  const random = createRandomSource(options.seed ?? 7)
  const budget = new EvaluationCounter(options.maxEvaluations)
  if (!Number.isInteger(options.maxEvaluations) || options.maxEvaluations < 1) {
    throw new Error(`Evaluation budget must be a positive integer, got ${options.maxEvaluations}.`)
  }
  let current = clampToBounds(start, options.bounds)
  let currentValue = budget.evaluateWithinBudget(objective, current)
  // Temperature is scaled to the objective's own magnitude so the acceptance
  // curve behaves the same whether the cost is 0.001 or 1e6.
  const startTemperature = options.initialTemperature ?? Math.max(1e-9, Math.abs(currentValue) * 0.1)
  let temperature = startTemperature

  const history: number[] = [currentValue]
  let best = { point: current, value: currentValue }

  while (!budget.exhausted) {
    const candidate = clampToBounds(
      current.map((value, d) => {
        const span = options.bounds[d].high - options.bounds[d].low
        // The move shrinks as the chain cools, normalised against the *actual*
        // starting temperature so `stepScale` means "fraction of the span at the
        // first move" whether the caller set T₀ or it was derived from the cost.
        return value + random.normal(0, stepScale * span) * Math.sqrt(temperature / startTemperature)
      }),
      options.bounds,
    )
    const candidateValue = budget.evaluate(objective, candidate)
    if (candidateValue === null) break
    const delta = candidateValue - currentValue
    if (delta < 0 || random.next() < Math.exp(-delta / Math.max(temperature, Number.MIN_VALUE))) {
      current = candidate
      currentValue = candidateValue
      if (candidateValue < best.value) best = { point: candidate, value: candidateValue }
    }
    temperature *= coolingRate
    history.push(best.value)
  }

  return finish(best, budget, history, 'budget')
}

function finish(
  best: { point: number[]; value: number },
  budget: EvaluationCounter,
  history: number[],
  termination: OptimizerResult['termination'],
): OptimizerResult {
  return {
    parameters: best.point,
    objective: best.value,
    evaluations: budget.used,
    history,
    termination,
  }
}
