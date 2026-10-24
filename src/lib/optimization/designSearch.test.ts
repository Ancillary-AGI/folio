import { describe, expect, it } from 'vitest';
import {
  searchCantileverSection,
  type CantileverSizingRequest,
} from './designSearch';
import {
  EvolutionaryOptimizer,
  ReinforcementLearningOptimizer,
  type RLAction,
  type RLState,
} from './evolutionaryOptimization';

const STEEL = {
  densityKgM3: 7850,
  youngsModulusPa: 200e9,
  yieldStrengthPa: 250e6,
};

function steelRequest(overrides: Partial<CantileverSizingRequest> = {}): CantileverSizingRequest {
  return {
    spanM: 0.6,
    loadN: 500,
    material: STEEL,
    safetyFactor: 1.5,
    deflectionLimitM: 0.003,
    width: { minM: 0.002, maxM: 0.06 },
    height: { minM: 0.01, maxM: 0.12 },
    maxAspectRatio: 20,
    populationSize: 24,
    iterations: 80,
    seed: 1234,
    ...overrides,
  };
}

/**
 * Independent reference for the mass-minimising section. With a rectangular
 * solid the mass is monotone in width, so the optimum is either (a) the
 * narrowest allowed width with the height that just satisfies a limit, or
 * (b) on the slenderness limit. Candidates are checked explicitly.
 */
function referenceLeastMass(request: CantileverSizingRequest): number {
  const { spanM, loadN, material, safetyFactor, deflectionLimitM } = request;
  const allowable = material.yieldStrengthPa / safetyFactor;
  const maxAspect = request.maxAspectRatio ?? 20;
  const aStrength = Math.cbrt((6 * loadN * spanM) / allowable);
  const aDeflection = Math.pow((4 * loadN * spanM ** 3) / (material.youngsModulusPa * deflectionLimitM), 0.25);
  const minHeight = (width: number) =>
    Math.max(
      request.height.minM,
      Math.sqrt((6 * loadN * spanM) / (allowable * width)),
      Math.pow((4 * loadN * spanM ** 3) / (material.youngsModulusPa * deflectionLimitM * width), 1 / 3),
    );

  const candidates: Array<{ width: number; height: number }> = [];
  const atMinWidth = { width: request.width.minM, height: minHeight(request.width.minM) };
  candidates.push(atMinWidth);
  const aspectWidth = Math.max(
    request.width.minM,
    aStrength * Math.pow(maxAspect, -2 / 3),
    aDeflection * Math.pow(maxAspect, -3 / 4),
  );
  candidates.push({ width: aspectWidth, height: aspectWidth * maxAspect });
  const atMaxHeightWidth = Math.max(
    request.width.minM,
    request.height.maxM / maxAspect,
    (6 * loadN * spanM) / (allowable * request.height.maxM ** 2),
    (4 * loadN * spanM ** 3) / (material.youngsModulusPa * deflectionLimitM * request.height.maxM ** 3),
  );
  candidates.push({ width: atMaxHeightWidth, height: request.height.maxM });

  let best = Number.POSITIVE_INFINITY;
  for (const { width, height } of candidates) {
    if (width > request.width.maxM || height > request.height.maxM) continue;
    if (height / width > maxAspect * (1 + 1e-12)) continue;
    const stress = (6 * loadN * spanM) / (width * height ** 2);
    const inertia = (width * height ** 3) / 12;
    const deflection = (loadN * spanM ** 3) / (3 * material.youngsModulusPa * inertia);
    if (stress > allowable * (1 + 1e-9) || deflection > deflectionLimitM * (1 + 1e-9)) continue;
    best = Math.min(best, material.densityKgM3 * spanM * width * height);
  }
  return best;
}

describe('searchCantileverSection', () => {
  it('reaches the least-mass section and satisfies every limit', async () => {
    const request = steelRequest();
    const referenceMass = referenceLeastMass(request);
    expect(Number.isFinite(referenceMass)).toBe(true);
    const result = await searchCantileverSection(request);

    expect(result.feasible).toBe(true);
    expect(result.stressUtilization).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.deflectionUtilization).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.aspectUtilization).toBeLessThanOrEqual(1 + 1e-9);
    // The swarm is stochastic; require it to be within 1 % of the reference.
    expect(result.massKg).toBeLessThanOrEqual(referenceMass * 1.01);
    expect(result.massKg).toBeGreaterThanOrEqual(referenceMass * 0.999);
    expect(result.convergence.length).toBe(80);
  });

  it('is deterministic for the same seed', async () => {
    const first = await searchCantileverSection(steelRequest());
    const second = await searchCantileverSection(steelRequest());
    expect(second.widthM).toBe(first.widthM);
    expect(second.heightM).toBe(first.heightM);
  });

  it('reports infeasible bounds instead of returning an oversized section', async () => {
    const request = steelRequest({
      width: { minM: 0.001, maxM: 0.0015 },
      height: { minM: 0.001, maxM: 0.002 },
    });
    const result = await searchCantileverSection(request);
    expect(result.feasible).toBe(false);
    expect(result.widthM).toBeLessThanOrEqual(0.0015 + 1e-12);
    expect(result.heightM).toBeLessThanOrEqual(0.002 + 1e-12);
  });

  it('fails loudly on malformed input', async () => {
    await expect(searchCantileverSection(steelRequest({ spanM: 0 }))).rejects.toThrow(/Span/);
    await expect(
      searchCantileverSection(steelRequest({ height: { minM: 0.05, maxM: 0.01 } })),
    ).rejects.toThrow(/Height maximum/);
    await expect(searchCantileverSection(steelRequest({ safetyFactor: 0.8 }))).rejects.toThrow(
      /Safety factor/,
    );
    await expect(searchCantileverSection(steelRequest({ iterations: 0 }))).rejects.toThrow(
      /Iterations/,
    );
  });
});

describe('ReinforcementLearningOptimizer state keys', () => {
  it('distinguishes states that differ only in parameter values', async () => {
    const learner = new ReinforcementLearningOptimizer({
      algorithm: 'q_learning',
      learningRate: 0.5,
      discountFactor: 0.9,
      explorationRate: 1,
      explorationDecay: 1,
      batchSize: 1,
      memorySize: 100,
    });
    learner.setRandomSource(() => 0.5);

    const action: RLAction = { type: 'adjust_parameter', parameters: { delta: 10 } };
    const initialState: RLState = { design: [], parameters: { resistance: 100 }, constraints: {} };

    await learner.train(
      initialState,
      () => [action],
      async (state) => ({
        nextState: {
          ...state,
          parameters: { ...state.parameters, resistance: state.parameters.resistance + 10 },
        },
        reward: { value: 1, factors: { performance: 1, cost: 0, reliability: 0, manufacturability: 0 } },
        done: state.parameters.resistance >= 130,
      }),
      1,
    );

    // 100 Ω, 110 Ω, 120 Ω and 130 Ω must not collapse into one key.
    expect(learner.getQTable().size).toBeGreaterThan(1);
  });
});

describe('EvolutionaryOptimizer', () => {
  const config = {
    populationSize: 20,
    generations: 30,
    mutationRate: 0.4,
    crossoverRate: 0.8,
    selectionMethod: 'rank' as const,
    elitism: 2,
  };

  function seededOptimizer() {
    const optimizer = new EvolutionaryOptimizer(config);
    let seed = 42;
    optimizer.setRandomSource(() => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    });
    return optimizer;
  }

  function initialize(optimizer: EvolutionaryOptimizer) {
    let counter = 0;
    optimizer.initializePopulation([], () => ({
      id: `g${counter++}`,
      genes: { x: (counter * 37) % 100 },
      fitness: 0,
      generation: 0,
    }));
  }

  it('improves fitness under rank selection', async () => {
    const optimizer = seededOptimizer();
    initialize(optimizer);
    const target = 61.7;
    const initialBest = Math.max(
      ...optimizer.getPopulation().map(genome => -Math.abs((genome.genes.x as number) - target)),
    );
    const best = await optimizer.evolve(async genome => {
      const x = genome.genes.x as number;
      return -Math.abs(x - target);
    });

    expect(Number.isFinite(best.fitness)).toBe(true);
    expect(best.fitness).toBeGreaterThanOrEqual(initialBest);
    expect(optimizer.getBestGenome()?.id).toBe(best.id);
  });

  it('keeps array genes isolated between parents and offspring', async () => {
    const optimizer = new EvolutionaryOptimizer({
      ...config, populationSize: 6, generations: 6, mutationRate: 1, crossoverRate: 1, elitism: 1,
    });
    let counter = 0;
    optimizer.initializePopulation([], () => ({
      id: `g${counter++}`,
      genes: { weights: [10, 20, 30] },
      fitness: 0,
      generation: 0,
    }));

    await optimizer.evolve(async () => 1);

    const arrays = optimizer.getPopulation().map(genome => genome.genes.weights);
    // Every survivor owns a distinct array; in-place mutation of one genome
    // must never be visible in another (or in the seed arrays).
    expect(new Set(arrays).size).toBe(arrays.length);
    expect(arrays).toContainEqual([10, 20, 30]);
  });

  it('returns the best individual when zero generations are requested', async () => {    const optimizer = new EvolutionaryOptimizer({ ...config, generations: 0 });
    initialize(optimizer);
    const best = await optimizer.evolve(async genome => {
      const x = genome.genes.x as number;
      return x;
    });

    expect(best).toBeDefined();
    expect(best.fitness).toBe(optimizer.getPopulation()[0].fitness);
  });

  it('rejects an empty population instead of returning a hollow result', async () => {
    const optimizer = seededOptimizer();
    await expect(optimizer.evolve(async () => 0)).rejects.toThrow(/No population/);
  });
});
