/**
 * Optimise several disciplines simultaneously over one shared design point.
 *
 * Each discipline returns a normalised cost, constraint utilisations (`value/limit`,
 * so `≤ 1` means satisfied in any unit) and free-form metrics. The search
 * maximises `−(weighted cost) − 100·Σ max(0, u−1)²` — a squared hinge, because it
 * is smooth at the boundary and gives the swarm a gradient rather than a kink.
 *
 * The returned point is always re-checked; an infeasible result is reported, and
 * `binding` names the disciplines that actually limit the design.
 */
import { ParticleSwarmOptimizer } from './evolutionaryOptimization';
import { createSeededRandom } from '../simulation/numeric';

export interface DesignVariable {
  name: string;
  min: number;
  max: number;
  /** Unit label, for reporting only. */
  unit?: string;
  description?: string;
}

export interface ConstraintUtilisation {
  /** Which discipline produced this constraint. */
  discipline: string;
  name: string;
  /** `value / limit`; ≤ 1 is satisfied, > 1 is violated. */
  utilisation: number;
  unit?: string;
}

export interface DisciplineOutcome {
  /** Normalised and lower-is-better. */
  cost: number;
  constraints: ConstraintUtilisation[];
  metrics: Record<string, number>;
}

export interface Discipline {
  name: string;
  /** Relative weight in the summed objective. Defaults to 1. */
  weight?: number;
  evaluate: (
    point: Readonly<Record<string, number>>,
  ) => DisciplineOutcome | Promise<DisciplineOutcome>;
}

export interface CoupledDesignRequest {
  variables: DesignVariable[];
  disciplines: Discipline[];
  populationSize?: number;
  iterations?: number;
  seed?: number;
}

export interface CoupledDisciplineResult {
  name: string;
  cost: number;
  metrics: Record<string, number>;
}

export interface CoupledDesignResult {
  point: Record<string, number>;
  /** True when every constraint of every discipline is satisfied. */
  feasible: boolean;
  /** Weighted sum of the discipline costs at the returned point. */
  cost: number;
  disciplines: CoupledDisciplineResult[];
  constraints: ConstraintUtilisation[];
  /** Constraints sitting at their limit (within `BINDING_TOLERANCE`). */
  binding: ConstraintUtilisation[];
  /** The largest utilisation across all constraints; ≤ 1 means feasible. */
  worstUtilisation: number;
  convergence: number[];
  iterations: number;
  evaluations: number;
}

const DEFAULT_POPULATION = 24;
const DEFAULT_ITERATIONS = 60;
const DEFAULT_SEED = 0xc0d3;
/** A constraint within this relative distance of its limit is called binding. */
export const BINDING_TOLERANCE = 0.02;
/** Cap on a single constraint's excess, so an infinite violation stays finite. */
const MAX_CONSTRAINT_EXCESS = 1e6;
/** Weight applied to constraint violation in the fitness. */
const PENALTY_WEIGHT = 100;
/** How much stiffer the repair pass is than the main search. */
const POLISH_PENALTY_FACTOR = 1000;

function assertVariable(variable: DesignVariable): void {
  if (!variable.name.trim()) throw new Error('Every design variable needs a name.');
  if (!Number.isFinite(variable.min) || !Number.isFinite(variable.max)) {
    throw new Error(`Variable "${variable.name}" needs finite bounds.`);
  }
  if (variable.max <= variable.min) {
    throw new Error(`Variable "${variable.name}" maximum must exceed its minimum.`);
  }
}

/**
 * Optimise a design point against several coupled disciplines.
 *
 * Deterministic for a given seed. Throws on malformed input rather than
 * guessing; reports infeasibility rather than returning a design that violates
 * a limit.
 */
export async function optimizeCoupledDesign(
  request: CoupledDesignRequest,
): Promise<CoupledDesignResult> {
  if (!Array.isArray(request.variables) || request.variables.length === 0) {
    throw new Error('Coupled design needs at least one variable.');
  }
  if (!Array.isArray(request.disciplines) || request.disciplines.length === 0) {
    throw new Error('Coupled design needs at least one discipline.');
  }
  request.variables.forEach(assertVariable);

  const names = new Set<string>();
  for (const variable of request.variables) {
    if (names.has(variable.name)) throw new Error(`Duplicate variable "${variable.name}".`);
    names.add(variable.name);
  }
  for (const discipline of request.disciplines) {
    if (!discipline.name.trim()) throw new Error('Every discipline needs a name.');
    if (typeof discipline.evaluate !== 'function') {
      throw new Error(`Discipline "${discipline.name}" needs an evaluate function.`);
    }
  }

  const population = request.populationSize ?? DEFAULT_POPULATION;
  const iterations = request.iterations ?? DEFAULT_ITERATIONS;
  if (!Number.isInteger(population) || population < 2) {
    throw new Error('Population size must be an integer ≥ 2.');
  }
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('Iterations must be an integer ≥ 1.');
  }

  const weights = new Map<string, number>();
  for (const discipline of request.disciplines) {
    const weight = discipline.weight ?? 1;
    if (!Number.isFinite(weight) || weight < 0) {
      throw new Error(`Discipline "${discipline.name}" needs a finite weight ≥ 0.`);
    }
    weights.set(discipline.name, weight);
  }

  let evaluations = 0;

  /** Run every discipline at a point and fold the results into one fitness. */
  const assess = async (
    point: Record<string, number>,
    penaltyWeight: number,
  ): Promise<{
    fitness: number;
    cost: number;
    disciplines: CoupledDisciplineResult[];
    constraints: ConstraintUtilisation[];
  }> => {
    evaluations += 1;
    let cost = 0;
    const disciplines: CoupledDisciplineResult[] = [];
    const constraints: ConstraintUtilisation[] = [];

    for (const discipline of request.disciplines) {
      const outcome = await discipline.evaluate(point);
      for (const constraint of outcome.constraints) {
        /* NaN is a defect: a constraint that computes to "not a number" cannot
         * be interpreted. Infinity is *not* — a floor of the form `limit / x`
         * is genuinely infinite at x = 0, which is a legitimate point on a
         * search bound and must be reported as a violation rather than treated
         * as a broken evaluator. */
        if (Number.isNaN(constraint.utilisation)) {
          throw new Error(
            `Discipline "${discipline.name}" produced NaN for "${constraint.name}".`,
          );
        }
        constraints.push({ ...constraint, discipline: constraint.discipline || discipline.name });
      }
      const weight = weights.get(discipline.name) ?? 1;
      cost += weight * outcome.cost;
      disciplines.push({ name: discipline.name, cost: outcome.cost, metrics: outcome.metrics });
    }

    /* Squared hinge: smooth at the boundary, so the swarm gets a gradient. The
     * excess is capped so an infinite violation at a bound yields a large but
     * finite penalty instead of poisoning the whole fitness. */
    let penalty = 0;
    for (const constraint of constraints) {
      const excess = constraint.utilisation - 1;
      if (excess > 0) penalty += Math.min(excess, MAX_CONSTRAINT_EXCESS) ** 2;
    }
    return { fitness: -cost - penaltyWeight * penalty, cost, disciplines, constraints };
  };

  const initial = Object.fromEntries(request.variables.map((variable) => [variable.name, variable.max]));
  const bounds = Object.fromEntries(
    request.variables.map((variable) => [variable.name, { min: variable.min, max: variable.max }]),
  );

  const search = async (
    start: Record<string, number>,
    penaltyWeight: number,
    iterationBudget: number,
    seed: number,
    convergence: number[],
  ): Promise<Record<string, number>> => {
    const swarm = new ParticleSwarmOptimizer({
      populationSize: population,
      iterations: iterationBudget,
      inertia: 0.72,
      cognitiveWeight: 1.5,
      socialWeight: 1.5,
      onProgress: ({ bestFitness }) => convergence.push(bestFitness),
    });
    swarm.setRandomSource(createSeededRandom(seed));
    return swarm.optimize(
      start,
      async (candidate) => (await assess(candidate, penaltyWeight)).fitness,
      bounds,
    );
  };

  const convergence: number[] = [];
  let iterationsRun = 0;

  let position = await search(initial, PENALTY_WEIGHT, iterations, request.seed ?? DEFAULT_SEED, convergence);
  iterationsRun += iterations;

  let final = await assess(position, PENALTY_WEIGHT);
  let worst = final.constraints.reduce((max, c) => Math.max(max, c.utilisation), 0);

  /* A penalty search approaches the feasible boundary from outside: the last
   * few percent of objective are cheaper than the penalty for crossing, so the
   * returned point sits just over the line. A second, stiffer pass started from
   * that point pushes it inside, the same repair `designSearch.ts` performs for
   * its beam section. Without it a coupled study reports a design that violates
   * its own limit by a fraction of a percent. */
  if (worst > 1) {
    const polishIterations = Math.max(1, Math.round(iterations / 2));
    position = await search(
      position,
      PENALTY_WEIGHT * POLISH_PENALTY_FACTOR,
      polishIterations,
      (request.seed ?? DEFAULT_SEED) + 1,
      convergence,
    );
    iterationsRun += polishIterations;
    final = await assess(position, PENALTY_WEIGHT);
    worst = final.constraints.reduce((max, c) => Math.max(max, c.utilisation), 0);
  }

  const binding = final.constraints.filter(
    (constraint) => Math.abs(constraint.utilisation - 1) <= BINDING_TOLERANCE,
  );

  return {
    point: position,
    feasible: worst <= 1 + 1e-9,
    cost: final.cost,
    disciplines: final.disciplines,
    constraints: final.constraints,
    binding,
    worstUtilisation: worst,
    convergence,
    iterations: iterationsRun,
    evaluations,
  };
}