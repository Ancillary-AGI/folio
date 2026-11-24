import { describe, expect, it } from 'vitest'
import {
  EvolutionaryOptimizer,
  ParticleSwarmOptimizer,
  ReinforcementLearningOptimizer,
  type EvolutionaryConfig,
  type ReinforcementLearningConfig,
  type RLAction,
  type RLState,
} from './evolutionaryOptimization'
import { createSeededRandom } from '../simulation/numeric'

const swarmConfig = {
  populationSize: 20,
  iterations: 60,
  inertia: 0.7,
  cognitiveWeight: 1.5,
  socialWeight: 1.5,
}

const evolutionConfig: EvolutionaryConfig = {
  populationSize: 10,
  generations: 8,
  mutationRate: 0.2,
  crossoverRate: 0.8,
  selectionMethod: 'tournament',
  elitism: 1,
}

const rlConfig: ReinforcementLearningConfig = {
  algorithm: 'q_learning',
  learningRate: 0.5,
  discountFactor: 0.9,
  explorationRate: 0.3,
  explorationDecay: 0.98,
  batchSize: 1000,
  memorySize: 1000,
}

describe('ParticleSwarmOptimizer', () => {
  it('finds the minimum of a quadratic inside the box', async () => {
    const swarm = new ParticleSwarmOptimizer(swarmConfig)
    swarm.setRandomSource(createSeededRandom(7))
    const position = await swarm.optimize(
      { x: 0 },
      // The optimiser maximises fitness, so minimise the distance by negating it.
      async ({ x }) => -((x - 2.5) ** 2),
      { x: { min: -10, max: 10 } },
    )
    expect(position.x).toBeCloseTo(2.5, 1)
  })

  it('does not reuse the global best from a previous run', async () => {
    // The first run has a variable named x; the second has y. Carrying the old
    // best into the second run used to return a position without y at all.
    const swarm = new ParticleSwarmOptimizer(swarmConfig)
    swarm.setRandomSource(createSeededRandom(11))
    await swarm.optimize({ x: 0 }, async ({ x }) => -x * x, { x: { min: 0, max: 1 } })

    const second = await swarm.optimize(
      { y: 0 },
      async ({ y }) => -((y - 5.5) ** 2),
      { y: { min: 5, max: 6 } },
    )
    expect(second.x).toBeUndefined()
    expect(second.y).toBeGreaterThanOrEqual(5)
    expect(second.y).toBeLessThanOrEqual(6)
    expect(second.y).toBeCloseTo(5.5, 1)
  })

  it('rejects malformed settings and bounds instead of producing NaNs', async () => {
    expect(() => new ParticleSwarmOptimizer({ ...swarmConfig, populationSize: 0 })).toThrow(/population/)
    expect(() => new ParticleSwarmOptimizer({ ...swarmConfig, iterations: -1 })).toThrow(/iteration/)
    expect(() => new ParticleSwarmOptimizer({ ...swarmConfig, inertia: Number.NaN })).toThrow(/inertia/)

    const swarm = new ParticleSwarmOptimizer(swarmConfig)
    await expect(swarm.optimize({}, async () => 0, {})).rejects.toThrow(/at least one variable/)
    await expect(swarm.optimize({ x: 0 }, async () => 0, {})).rejects.toThrow(/bounds for "x"/)
    await expect(
      swarm.optimize({ x: 0 }, async () => 0, { x: { min: 1, max: 0 } }),
    ).rejects.toThrow(/max below min/)
  })
})

describe('EvolutionaryOptimizer.optimize', () => {
  it('returns the fitness of the genome it reports as best', async () => {
    const optimizer = new EvolutionaryOptimizer(evolutionConfig)
    optimizer.setRandomSource(createSeededRandom(3))
    const result = optimizer.optimize(
      evolutionConfig,
      [{ name: 'performance', type: 'maximize', weight: 1 }],
      ({ genes }) => ({ cost: 0, performance: Number(genes.performance) }),
    )
    expect(result.bestFitness.performance).toBe(Number(result.bestGenome.genes.performance))
    expect(result.bestFitness.performance).toBeGreaterThanOrEqual(0)
    expect(result.bestFitness.performance).toBeLessThanOrEqual(100)
    expect(result.generations).toBe(evolutionConfig.generations)
    expect(result.convergenceHistory).toHaveLength(evolutionConfig.generations + 1)
  })

  it('rejects objectives and rates that cannot be interpreted', () => {
    const optimizer = new EvolutionaryOptimizer(evolutionConfig)
    const fitness = () => ({ cost: 0, performance: 0 })
    expect(() => optimizer.optimize(evolutionConfig, [], fitness)).toThrow(/at least one objective/)
    expect(() =>
      optimizer.optimize(
        evolutionConfig,
        [{ name: 'p', type: 'maximize', weight: Number.NaN }],
        fitness,
      ),
    ).toThrow(/finite weight/)
    expect(() =>
      optimizer.optimize(
        { ...evolutionConfig, mutationRate: 2 },
        [{ name: 'p', type: 'maximize', weight: 1 }],
        fitness,
      ),
    ).toThrow(/mutation rate/)
  })
})

describe('ReinforcementLearningOptimizer', () => {
  const state: RLState = { design: [], parameters: { mode: 0 }, constraints: {} }
  const actions: RLAction[] = [
    { type: 'adjust_parameter', parameters: { choice: 'bad' } },
    { type: 'adjust_parameter', parameters: { choice: 'good' } },
  ]

  it('learns to prefer the action with the higher reward', async () => {
    const rl = new ReinforcementLearningOptimizer(rlConfig)
    rl.setRandomSource(createSeededRandom(5))

    await rl.train(
      state,
      () => actions,
      async (_state, action) => ({
        nextState: state,
        reward: {
          value: action.parameters.choice === 'good' ? 1 : 0,
          factors: { performance: 0, cost: 0, reliability: 0, manufacturability: 0 },
        },
        done: false,
      }),
      200,
    )

    const table = [...rl.getQTable().values()][0]
    const qOf = (choice: string): number =>
      table.get(JSON.stringify({ type: 'adjust_parameter', parameters: { choice } })) ?? 0
    expect(qOf('good')).toBeGreaterThan(qOf('bad'))
  })

  it('rejects impossible settings and episode counts', async () => {
    expect(() => new ReinforcementLearningOptimizer({ ...rlConfig, learningRate: 0 })).toThrow(/learning rate/)
    expect(() => new ReinforcementLearningOptimizer({ ...rlConfig, discountFactor: 2 })).toThrow(/discount/)
    expect(() => new ReinforcementLearningOptimizer({ ...rlConfig, memorySize: 0 })).toThrow(/memory/)
    const rl = new ReinforcementLearningOptimizer(rlConfig)
    await expect(
      rl.train(
        state,
        () => actions,
        async () => ({
          nextState: state,
          reward: { value: 0, factors: { performance: 0, cost: 0, reliability: 0, manufacturability: 0 } },
          done: true,
        }),
        -1,
      ),
    ).rejects.toThrow(/episode/)
  })
})
