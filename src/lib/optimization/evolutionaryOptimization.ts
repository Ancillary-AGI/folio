/**
 * Evolutionary Optimization and Reinforcement Learning for Design Automation
 * Provides genetic algorithms, particle swarm optimization, and RL-based design optimization
 */

import { Component } from '../../types';

export interface DesignGenome {
  id: string;
  genes: Record<string, unknown>;
  fitness: number;
  generation: number;
  parentIds?: string[];
}

export interface OptimizationObjective {
  name: string;
  type: 'minimize' | 'maximize';
  weight: number;
  target?: number;
}

export interface EvolutionaryConfig {
  populationSize: number;
  generations: number;
  mutationRate: number;
  crossoverRate: number;
  selectionMethod: 'tournament' | 'roulette' | 'rank';
  elitism: number; // Number of best individuals to keep
}

export interface ReinforcementLearningConfig {
  algorithm: 'q_learning' | 'dqn' | 'ppo' | 'sac';
  learningRate: number;
  discountFactor: number;
  explorationRate: number;
  explorationDecay: number;
  batchSize: number;
  memorySize: number;
}

export interface RLState {
  design: Component[];
  parameters: Record<string, number>;
  constraints: Record<string, unknown>;
}

export interface RLAction {
  type: 'modify_component' | 'add_component' | 'remove_component' | 'adjust_parameter';
  parameters: Record<string, unknown>;
}

export interface RLReward {
  value: number;
  factors: {
    performance: number;
    cost: number;
    reliability: number;
    manufacturability: number;
  };
}

export class EvolutionaryOptimizer {
  private population: DesignGenome[] = [];
  private generation: number = 0;
  private bestGenome: DesignGenome | null = null;
  private fitnessHistory: number[] = [];

  constructor(private config: EvolutionaryConfig) {}

  initializePopulation(initialDesign: Component[], createGenome: (design: Component[]) => DesignGenome): void {
    this.population = [];
    
    // Create initial population
    for (let i = 0; i < this.config.populationSize; i++) {
      const genome = createGenome(initialDesign);
      genome.generation = 0;
      this.population.push(genome);
    }
  }

  async evolve(
    evaluateFitness: (genome: DesignGenome) => Promise<number>
  ): Promise<DesignGenome> {
    // Evaluate initial population
    for (const genome of this.population) {
      genome.fitness = await evaluateFitness(genome);
    }

    this.sortPopulation();

    for (let gen = 0; gen < this.config.generations; gen++) {
      this.generation = gen + 1;
      
      // Create new generation
      const newPopulation: DesignGenome[] = [];

      // Elitism: Keep best individuals
      for (let i = 0; i < this.config.elitism; i++) {
        if (this.population[i]) {
          newPopulation.push({ ...this.population[i] });
        }
      }

      // Generate offspring
      while (newPopulation.length < this.config.populationSize) {
        const parent1 = this.selectParent();
        const parent2 = this.selectParent();

        let offspring: DesignGenome[];

        if (Math.random() < this.config.crossoverRate) {
          offspring = this.crossover(parent1, parent2);
        } else {
          offspring = [
            { ...parent1 },
            { ...parent2 }
          ];
        }

        // Mutate offspring
        offspring.forEach(child => {
          if (Math.random() < this.config.mutationRate) {
            this.mutate(child);
          }
          child.generation = this.generation;
          child.parentIds = [parent1.id, parent2.id];
          newPopulation.push(child);
        });
      }

      // Evaluate new population
      for (const genome of newPopulation) {
        if (!genome.fitness || genome.fitness === 0) {
          genome.fitness = await evaluateFitness(genome);
        }
      }

      // Trim to population size
      this.population = newPopulation.slice(0, this.config.populationSize);
      this.sortPopulation();

      this.bestGenome = this.population[0];
      this.fitnessHistory.push(this.bestGenome.fitness);

      console.log(`Generation ${this.generation}: Best fitness = ${this.bestGenome.fitness.toFixed(4)}`);
    }

    return this.bestGenome!;
  }

  private selectParent(): DesignGenome {
    switch (this.config.selectionMethod) {
      case 'tournament':
        return this.tournamentSelection();
      case 'roulette':
        return this.rouletteSelection();
      case 'rank':
        return this.rankSelection();
      default:
        return this.tournamentSelection();
    }
  }

  private tournamentSelection(tournamentSize: number = 3): DesignGenome {
    const tournament: DesignGenome[] = [];
    for (let i = 0; i < tournamentSize; i++) {
      tournament.push(this.population[Math.floor(Math.random() * this.population.length)]);
    }
    tournament.sort((a, b) => b.fitness - a.fitness);
    return tournament[0];
  }

  private rouletteSelection(): DesignGenome {
    const totalFitness = this.population.reduce((sum, g) => sum + Math.max(0, g.fitness), 0);
    let random = Math.random() * totalFitness;
    
    for (const genome of this.population) {
      random -= Math.max(0, genome.fitness);
      if (random <= 0) {
        return genome;
      }
    }

    return this.population[0];
  }

  private rankSelection(): DesignGenome {
    const ranks = this.population.map((_, index) => this.population.length - index);
    const totalRank = ranks.reduce((sum, r) => sum + r, 0);
    let random = Math.random() * totalRank;
    
    for (let i = 0; i < this.population.length; i++) {
      random -= ranks[i];
      if (random <= 0) {
        return this.population[i];
      }
    }

    return this.population[0];
  }

  private crossover(parent1: DesignGenome, parent2: DesignGenome): DesignGenome[] {
    // Single-point crossover
    const genes1 = Object.keys(parent1.genes);
    const crossoverPoint = Math.floor(Math.random() * genes1.length);

    const child1Genes: Record<string, unknown> = {};
    const child2Genes: Record<string, unknown> = {};

    genes1.forEach((key, index) => {
      if (index < crossoverPoint) {
        child1Genes[key] = parent1.genes[key];
        child2Genes[key] = parent2.genes[key];
      } else {
        child1Genes[key] = parent2.genes[key];
        child2Genes[key] = parent1.genes[key];
      }
    });

    // Create child genomes (simplified - would need proper design reconstruction)
    const child1: DesignGenome = {
      id: `genome_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      genes: child1Genes,
      fitness: 0,
      generation: this.generation,
      parentIds: [parent1.id, parent2.id]
    };

    const child2: DesignGenome = {
      id: `genome_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      genes: child2Genes,
      fitness: 0,
      generation: this.generation,
      parentIds: [parent1.id, parent2.id]
    };

    return [child1, child2];
  }

  private mutate(genome: DesignGenome): void {
    const keys = Object.keys(genome.genes);
    const keyToMutate = keys[Math.floor(Math.random() * keys.length)];
    const value = genome.genes[keyToMutate];

    // Mutate based on value type
    if (typeof value === 'number') {
      // Gaussian mutation
      const mutationAmount = (Math.random() - 0.5) * 0.1;
      genome.genes[keyToMutate] = value * (1 + mutationAmount);
    } else if (typeof value === 'boolean') {
      genome.genes[keyToMutate] = !value;
    } else if (Array.isArray(value)) {
      // Mutate array element
      if (value.length > 0) {
        const index = Math.floor(Math.random() * value.length);
        if (typeof value[index] === 'number') {
          value[index] = value[index] * (1 + (Math.random() - 0.5) * 0.1);
        }
      }
    }
  }

  private sortPopulation(): void {
    this.population.sort((a, b) => b.fitness - a.fitness);
  }

  getBestGenome(): DesignGenome | null {
    return this.bestGenome;
  }

  getFitnessHistory(): number[] {
    return [...this.fitnessHistory];
  }

  getPopulation(): DesignGenome[] {
    return [...this.population];
  }
}

export class ReinforcementLearningOptimizer {
  private qTable: Map<string, Map<string, number>> = new Map();
  private experienceReplay: Array<{
    state: RLState;
    action: RLAction;
    reward: RLReward;
    nextState: RLState;
    done: boolean;
  }> = [];
  private currentState: RLState | null = null;
  private episode: number = 0;
  private explorationRate: number;

  constructor(private config: ReinforcementLearningConfig) {
    this.explorationRate = config.explorationRate;
  }

  async train(
    initialState: RLState,
    getActions: (state: RLState) => RLAction[],
    step: (state: RLState, action: RLAction) => Promise<{ nextState: RLState; reward: RLReward; done: boolean }>,
    episodes: number
  ): Promise<void> {
    for (let ep = 0; ep < episodes; ep++) {
      this.episode = ep;
      this.currentState = { ...initialState };
      let totalReward = 0;
      let steps = 0;
      const maxSteps = 100;

      while (steps < maxSteps) {
        const actions = getActions(this.currentState);
        const action = this.selectAction(this.currentState, actions);

        const { nextState, reward, done } = await step(this.currentState, action);

        // Store experience
        this.experienceReplay.push({
          state: { ...this.currentState },
          action,
          reward,
          nextState: { ...nextState },
          done
        });

        // Trim experience replay
        if (this.experienceReplay.length > this.config.memorySize) {
          this.experienceReplay.shift();
        }

        // Update Q-table
        this.updateQValue(this.currentState, action, reward, nextState, done);

        totalReward += reward.value;
        this.currentState = nextState;
        steps++;

        if (done) break;
      }

      // Decay exploration rate
      this.explorationRate = Math.max(
        0.01,
        this.explorationRate * this.config.explorationDecay
      );

      // Train on experience replay
      if (this.experienceReplay.length >= this.config.batchSize) {
        await this.trainOnBatch();
      }

      console.log(`Episode ${ep}: Total reward = ${totalReward.toFixed(2)}, Steps = ${steps}, Exploration = ${this.explorationRate.toFixed(3)}`);
    }
  }

  private selectAction(state: RLState, actions: RLAction[]): RLAction {
    // Epsilon-greedy action selection
    if (Math.random() < this.explorationRate) {
      // Explore: random action
      return actions[Math.floor(Math.random() * actions.length)];
    } else {
      // Exploit: best action
      return this.getBestAction(state, actions);
    }
  }

  private getBestAction(state: RLState, actions: RLAction[]): RLAction {
    const stateKey = this.stateToKey(state);
    const qValues = this.qTable.get(stateKey) || new Map();

    let bestAction = actions[0];
    let bestQValue = qValues.get(this.actionToKey(actions[0])) || 0;

    for (const action of actions) {
      const actionKey = this.actionToKey(action);
      const qValue = qValues.get(actionKey) || 0;
      if (qValue > bestQValue) {
        bestQValue = qValue;
        bestAction = action;
      }
    }

    return bestAction;
  }

  private updateQValue(state: RLState, action: RLAction, reward: RLReward, nextState: RLState, done: boolean): void {
    const stateKey = this.stateToKey(state);
    const actionKey = this.actionToKey(action);
    const nextStateKey = this.stateToKey(nextState);

    if (!this.qTable.has(stateKey)) {
      this.qTable.set(stateKey, new Map());
    }

    const qValues = this.qTable.get(stateKey)!;
    const currentQ = qValues.get(actionKey) || 0;

    // Q-learning update
    const nextQValues = this.qTable.get(nextStateKey) || new Map();
    const maxNextQ = done ? 0 : Math.max(
      ...Array.from(nextQValues.values()),
      ...Array.from(nextQValues.keys()).map(() => 0)
    );

    const newQ = currentQ + this.config.learningRate * (
      reward.value + this.config.discountFactor * maxNextQ - currentQ
    );

    qValues.set(actionKey, newQ);
  }

  private async trainOnBatch(): Promise<void> {
    // Sample batch from experience replay
    const batchSize = Math.min(this.config.batchSize, this.experienceReplay.length);
    const batch: typeof this.experienceReplay = [];

    for (let i = 0; i < batchSize; i++) {
      const index = Math.floor(Math.random() * this.experienceReplay.length);
      batch.push(this.experienceReplay[index]);
    }

    // Update Q-values for batch
    for (const experience of batch) {
      this.updateQValue(
        experience.state,
        experience.action,
        experience.reward,
        experience.nextState,
        experience.done
      );
    }
  }

  private stateToKey(state: RLState): string {
    // Convert state to string key for Q-table
    return JSON.stringify({
      components: state.design.length,
      parameters: Object.keys(state.parameters).sort().join(',')
    });
  }

  private actionToKey(action: RLAction): string {
    return JSON.stringify(action);
  }

  async optimize(initialState: RLState, getActions: (state: RLState) => RLAction[], step: (state: RLState, action: RLAction) => Promise<{ nextState: RLState; reward: RLReward; done: boolean }>): Promise<RLState> {
    let state = { ...initialState };
    let done = false;
    const maxSteps = 50;

    for (let stepCount = 0; stepCount < maxSteps && !done; stepCount++) {
      const actions = getActions(state);
      const action = this.getBestAction(state, actions);
      
      const result = await step(state, action);
      state = result.nextState;
      done = result.done;

      if (done) break;
    }

    return state;
  }

  getQTable(): Map<string, Map<string, number>> {
    return this.qTable;
  }

  getExplorationRate(): number {
    return this.explorationRate;
  }
}

export class ParticleSwarmOptimizer {
  private particles: Array<{
    position: Record<string, number>;
    velocity: Record<string, number>;
    bestPosition: Record<string, number>;
    bestFitness: number;
    fitness: number;
  }> = [];
  private globalBest: { position: Record<string, number>; fitness: number } | null = null;

  constructor(
    private config: {
      populationSize: number;
      iterations: number;
      inertia: number;
      cognitiveWeight: number;
      socialWeight: number;
    }
  ) {}

  async optimize(
    initialPosition: Record<string, number>,
    evaluateFitness: (position: Record<string, number>) => Promise<number>,
    bounds: Record<string, { min: number; max: number }>
  ): Promise<Record<string, number>> {
    // Initialize particles
    this.particles = [];
    for (let i = 0; i < this.config.populationSize; i++) {
      const position: Record<string, number> = {};
      const velocity: Record<string, number> = {};

      Object.keys(initialPosition).forEach(key => {
        const bound = bounds[key];
        position[key] = bound.min + Math.random() * (bound.max - bound.min);
        velocity[key] = (Math.random() - 0.5) * (bound.max - bound.min) * 0.1;
      });

      const fitness = await evaluateFitness(position);

      this.particles.push({
        position,
        velocity,
        bestPosition: { ...position },
        bestFitness: fitness,
        fitness
      });

      if (!this.globalBest || fitness > this.globalBest.fitness) {
        this.globalBest = { position: { ...position }, fitness };
      }
    }

    // Iterate
    for (let iter = 0; iter < this.config.iterations; iter++) {
      for (const particle of this.particles) {
        // Update velocity
        Object.keys(particle.position).forEach(key => {
          const r1 = Math.random();
          const r2 = Math.random();
          const bound = bounds[key];

          particle.velocity[key] =
            this.config.inertia * particle.velocity[key] +
            this.config.cognitiveWeight * r1 * (particle.bestPosition[key] - particle.position[key]) +
            this.config.socialWeight * r2 * (this.globalBest!.position[key] - particle.position[key]);

          // Update position
          particle.position[key] += particle.velocity[key];

          // Apply bounds
          particle.position[key] = Math.max(bound.min, Math.min(bound.max, particle.position[key]));
        });

        // Evaluate fitness
        particle.fitness = await evaluateFitness(particle.position);

        // Update personal best
        if (particle.fitness > particle.bestFitness) {
          particle.bestFitness = particle.fitness;
          particle.bestPosition = { ...particle.position };
        }

        // Update global best
        if (particle.fitness > this.globalBest!.fitness) {
          this.globalBest = { position: { ...particle.position }, fitness: particle.fitness };
        }
      }

      console.log(`Iteration ${iter}: Best fitness = ${this.globalBest!.fitness.toFixed(4)}`);
    }

    return this.globalBest!.position;
  }
}

export const evolutionaryOptimizer = new EvolutionaryOptimizer({
  populationSize: 50,
  generations: 100,
  mutationRate: 0.1,
  crossoverRate: 0.8,
  selectionMethod: 'tournament',
  elitism: 5
});

export const reinforcementLearningOptimizer = new ReinforcementLearningOptimizer({
  algorithm: 'q_learning',
  learningRate: 0.1,
  discountFactor: 0.95,
  explorationRate: 1.0,
  explorationDecay: 0.995,
  batchSize: 32,
  memorySize: 10000
});

