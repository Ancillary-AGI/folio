import { Component } from '../../types';

export interface BioInspiredAlgorithm {
  id: string;
  name: string;
  type: 'evolutionary' | 'swarm' | 'neural' | 'immune' | 'ecological' | 'cellular';
  inspiration: string; // Biological system that inspired the algorithm
  description: string;
  algorithm: string; // Specific algorithm name
  parameters: Record<string, unknown>;
  objective: {
    function: string;
    constraints: string[];
    dimensions: number;
    bounds: Array<{
      min: number;
      max: number;
    }>;
  };
  performance: {
    convergence: number;
    scalability: number;
    robustness: number;
    computationalComplexity: string;
  };
  applications: string[];
  variants: string[];
}

export interface EvolutionaryAlgorithm {
  id: string;
  name: string;
  type: 'genetic' | 'evolution_strategy' | 'evolutionary_programming' | 'genetic_programming' | 'differential_evolution';
  population: Array<{
    id: string;
    chromosome: number[];
    fitness: number;
    age: number;
    parent1?: string;
    parent2?: string;
  }>;
  operators: {
    selection: {
      method: 'tournament' | 'roulette' | 'rank' | 'elitist';
      tournamentSize?: number;
      pressure?: number;
    };
    crossover: {
      method: 'single_point' | 'two_point' | 'uniform' | 'blend' | 'simulated_binary';
      probability: number;
      distributionIndex?: number;
    };
    mutation: {
      method: 'gaussian' | 'polynomial' | 'uniform' | 'bit_flip';
      probability: number;
      strength: number;
    };
  };
  convergence: {
    criteria: 'generations' | 'fitness' | 'stagnation' | 'diversity';
    threshold: number;
    maxGenerations: number;
  };
  elitism: {
    enabled: boolean;
    size: number;
  };
  diversity: {
    measure: 'genotypic' | 'phenotypic' | 'fitness';
    maintenance: 'crowding' | 'fitness_sharing' | 'niching' | 'none';
    threshold: number;
  };
}

export interface SwarmAlgorithm {
  id: string;
  name: string;
  inspiration: 'ants' | 'bees' | 'birds' | 'fish' | 'fireflies' | 'bats' | 'cuckoos' | 'wolves';
  agents: Array<{
    id: string;
    position: number[];
    velocity: number[];
    fitness: number;
    bestPosition: number[];
    bestFitness: number;
    neighbors: string[];
  }>;
  parameters: {
    populationSize: number;
    maxIterations: number;
    inertiaWeight: number;
    cognitiveComponent: number;
    socialComponent: number;
    neighborhoodRadius?: number;
    pheromoneDecay?: number;
    evaporationRate?: number;
    recruitmentProbability?: number;
  };
  topology: 'global' | 'ring' | 'von_neumann' | 'random';
  adaptation: {
    enabled: boolean;
    strategy: 'parameter_adaptation' | 'topology_adaptation' | 'hybrid';
  };
  constraints: {
    velocityClamping: boolean;
    maxVelocity: number[];
    boundaryHandling: 'absorbing' | 'reflecting' | 'random' | 'hypercube';
  };
}

export interface NeuralAlgorithm {
  id: string;
  name: string;
  type: 'spiking_neural_network' | 'artificial_neural_network' | 'neuromorphic' | 'reservoir_computing';
  architecture: {
    layers: Array<{
      type: 'input' | 'hidden' | 'output';
      neurons: number;
      activation: string;
      connections: number;
    }>;
    connections: Array<{
      from: number;
      to: number;
      weight: number;
      delay?: number;
    }>;
  };
  learning: {
    rule: 'hebbian' | 'spike_timing_dependent' | 'backpropagation' | 'reinforcement';
    parameters: Record<string, unknown>;
    plasticity: boolean;
  };
  dynamics: {
    membrane: {
      threshold: number;
      reset: number;
      refractory: number;
    };
    synapses: {
      excitatory: number;
      inhibitory: number;
      plasticity: string;
    };
  };
  performance: {
    accuracy: number;
    latency: number;
    energyEfficiency: number;
    robustness: number;
  };
}

export interface ImmuneAlgorithm {
  id: string;
  name: string;
  type: 'clonal_selection' | 'negative_selection' | 'artificial_immune_system' | 'danger_theory';
  antibodies: Array<{
    id: string;
    pattern: number[];
    affinity: number;
    concentration: number;
    age: number;
  }>;
  antigens: Array<{
    id: string;
    pattern: number[];
    type: 'self' | 'non_self';
  }>;
  processes: {
    clonal: {
      enabled: boolean;
      rate: number;
      mutation: number;
    };
    selection: {
      method: 'affinity' | 'concentration' | 'combined';
      threshold: number;
    };
    suppression: {
      enabled: boolean;
      threshold: number;
    };
  };
  memory: {
    size: number;
    retention: number;
    recall: number;
  };
  detection: {
    sensitivity: number;
    specificity: number;
    falsePositiveRate: number;
  };
}

export interface EcologicalAlgorithm {
  id: string;
  name: string;
  type: 'predator_prey' | 'symbiosis' | 'parasitism' | 'commensalism' | 'competition' | 'mutualism';
  ecosystem: {
    species: Array<{
      id: string;
      name: string;
      population: number;
      fitness: number;
      traits: Record<string, unknown>;
    }>;
    interactions: Array<{
      species1: string;
      species2: string;
      type: string;
      strength: number;
      direction: 'unidirectional' | 'bidirectional';
    }>;
  };
  dynamics: {
    birthRate: number;
    deathRate: number;
    migrationRate: number;
    carryingCapacity: number;
  };
  evolution: {
    mutationRate: number;
    selectionPressure: number;
    adaptation: boolean;
  };
  stability: {
    equilibrium: boolean;
    resilience: number;
    biodiversity: number;
  };
}

export interface CellularAlgorithm {
  id: string;
  name: string;
  type: 'cellular_automaton' | 'artificial_life' | 'morphogenesis' | 'self_organization';
  grid: {
    dimensions: number;
    size: number[];
    topology: 'von_neumann' | 'moore' | 'hexagonal' | 'triangular';
    boundary: 'periodic' | 'fixed' | 'absorbing';
  };
  cells: Array<{
    id: string;
    position: number[];
    state: unknown;
    age: number;
    energy: number;
  }>;
  rules: Array<{
    condition: string;
    action: string;
    probability: number;
  }>;
  evolution: {
    synchronous: boolean;
    generations: number;
    updateRule: string;
  };
  emergence: {
    patterns: string[];
    complexity: number;
    selfOrganization: boolean;
  };
}

export class BioInspiredAlgorithmsManager {
  private algorithms: Map<string, BioInspiredAlgorithm> = new Map();
  private evolutionary: Map<string, EvolutionaryAlgorithm> = new Map();
  private swarm: Map<string, SwarmAlgorithm> = new Map();
  private neural: Map<string, NeuralAlgorithm> = new Map();
  private immune: Map<string, ImmuneAlgorithm> = new Map();
  private ecological: Map<string, EcologicalAlgorithm> = new Map();
  private cellular: Map<string, CellularAlgorithm> = new Map();

  createBioInspiredAlgorithm(algorithm: Omit<BioInspiredAlgorithm, 'id'>): BioInspiredAlgorithm {
    const bioAlgorithm: BioInspiredAlgorithm = {
      ...algorithm,
      id: `bio_${Date.now()}`
    };

    this.algorithms.set(bioAlgorithm.id, bioAlgorithm);
    return bioAlgorithm;
  }

  createEvolutionaryAlgorithm(algorithm: Omit<EvolutionaryAlgorithm, 'id'>): EvolutionaryAlgorithm {
    const evoAlgorithm: EvolutionaryAlgorithm = {
      ...algorithm,
      id: `evo_${Date.now()}`
    };

    this.evolutionary.set(evoAlgorithm.id, evoAlgorithm);
    return evoAlgorithm;
  }

  createSwarmAlgorithm(algorithm: Omit<SwarmAlgorithm, 'id'>): SwarmAlgorithm {
    const swarmAlgorithm: SwarmAlgorithm = {
      ...algorithm,
      id: `swarm_${Date.now()}`
    };

    this.swarm.set(swarmAlgorithm.id, swarmAlgorithm);
    return swarmAlgorithm;
  }

  createNeuralAlgorithm(algorithm: Omit<NeuralAlgorithm, 'id'>): NeuralAlgorithm {
    const neuralAlgorithm: NeuralAlgorithm = {
      ...algorithm,
      id: `neural_${Date.now()}`
    };

    this.neural.set(neuralAlgorithm.id, neuralAlgorithm);
    return neuralAlgorithm;
  }

  createImmuneAlgorithm(algorithm: Omit<ImmuneAlgorithm, 'id'>): ImmuneAlgorithm {
    const immuneAlgorithm: ImmuneAlgorithm = {
      ...algorithm,
      id: `immune_${Date.now()}`
    };

    this.immune.set(immuneAlgorithm.id, immuneAlgorithm);
    return immuneAlgorithm;
  }

  createEcologicalAlgorithm(algorithm: Omit<EcologicalAlgorithm, 'id'>): EcologicalAlgorithm {
    const ecoAlgorithm: EcologicalAlgorithm = {
      ...algorithm,
      id: `eco_${Date.now()}`
    };

    this.ecological.set(ecoAlgorithm.id, ecoAlgorithm);
    return ecoAlgorithm;
  }

  createCellularAlgorithm(algorithm: Omit<CellularAlgorithm, 'id'>): CellularAlgorithm {
    const cellAlgorithm: CellularAlgorithm = {
      ...algorithm,
      id: `cell_${Date.now()}`
    };

    this.cellular.set(cellAlgorithm.id, cellAlgorithm);
    return cellAlgorithm;
  }

  runEvolutionaryAlgorithm(algorithmId: string, maxGenerations?: number): Promise<OptimizationResult> {
    return new Promise((resolve) => {
      const algorithm = this.evolutionary.get(algorithmId);
      if (!algorithm) {
        resolve({ success: false, error: 'Algorithm not found' });
        return;
      }

      const generations = maxGenerations || algorithm.convergence.maxGenerations;

      // Simulate evolutionary algorithm execution
      setTimeout(() => {
        const result = this.simulateEvolutionaryAlgorithm(algorithm, generations);

        resolve({
          success: true,
          bestSolution: result.bestSolution,
          bestFitness: result.bestFitness,
          generations: generations,
          convergence: result.convergence,
          diversity: result.diversity,
          computationTime: result.computationTime
        });
      }, generations * 100); // 100ms per generation
    });
  }

  private simulateEvolutionaryAlgorithm(algorithm: EvolutionaryAlgorithm, generations: number): {
    bestSolution: number[];
    bestFitness: number;
    convergence: number[];
    diversity: number[];
    computationTime: number;
  } {
    const convergence: number[] = [];
    const diversity: number[] = [];
    let bestFitness = -Infinity;
    let bestSolution: number[] = [];

    // Initialize population if empty
    if (algorithm.population.length === 0) {
      for (let i = 0; i < 50; i++) { // Default population size
        const chromosome = this.generateRandomChromosome(algorithm);
        const fitness = this.evaluateFitness(chromosome);
        algorithm.population.push({
          id: `ind_${i}`,
          chromosome,
          fitness,
          age: 0
        });
      }
    }

    for (let gen = 0; gen < generations; gen++) {
      // Evaluate fitness
      algorithm.population.forEach(individual => {
        individual.fitness = this.evaluateFitness(individual.chromosome);
        individual.age++;

        if (individual.fitness > bestFitness) {
          bestFitness = individual.fitness;
          bestSolution = [...individual.chromosome];
        }
      });

      convergence.push(bestFitness);
      diversity.push(this.calculateDiversity(algorithm.population));

      // Selection
      const selected = this.performSelection(algorithm);

      // Crossover
      const offspring = this.performCrossover(algorithm, selected);

      // Mutation
      this.performMutation(algorithm, offspring);

      // Replacement (elitism)
      if (algorithm.elitism.enabled) {
        const elite = algorithm.population
          .sort((a, b) => b.fitness - a.fitness)
          .slice(0, algorithm.elitism.size);
        algorithm.population = [...elite, ...offspring.slice(0, algorithm.population.length - algorithm.elitism.size)];
      } else {
        algorithm.population = offspring;
      }
    }

    return {
      bestSolution,
      bestFitness,
      convergence,
      diversity,
      computationTime: generations * 100
    };
  }

  private generateRandomChromosome(algorithm: EvolutionaryAlgorithm): number[] {
    // Generate random chromosome based on objective bounds
    // This would be more sophisticated in a real implementation
    return Array.from({ length: 10 }, () => Math.random() * 20 - 10); // 10 dimensions, range [-10, 10]
  }

  private evaluateFitness(chromosome: number[]): number {
    // Simple fitness function (sphere function)
    return chromosome.reduce((sum, x) => sum - x * x, 0);
  }

  private calculateDiversity(population: EvolutionaryAlgorithm['population']): number {
    // Calculate population diversity
    const chromosomes = population.map(ind => ind.chromosome);
    let totalDistance = 0;
    let count = 0;

    for (let i = 0; i < chromosomes.length; i++) {
      for (let j = i + 1; j < chromosomes.length; j++) {
        const distance = Math.sqrt(
          chromosomes[i].reduce((sum, x, idx) => sum + Math.pow(x - chromosomes[j][idx], 2), 0)
        );
        totalDistance += distance;
        count++;
      }
    }

    return count > 0 ? totalDistance / count : 0;
  }

  private performSelection(algorithm: EvolutionaryAlgorithm): EvolutionaryAlgorithm['population'] {
    const selected: EvolutionaryAlgorithm['population'] = [];

    switch (algorithm.operators.selection.method) {
      case 'tournament':
        for (let i = 0; i < algorithm.population.length; i++) {
          const tournament = this.selectRandomIndividuals(algorithm.population, algorithm.operators.selection.tournamentSize || 2);
          const winner = tournament.reduce((best, current) => current.fitness > best.fitness ? current : best);
          selected.push(winner);
        }
        break;
      case 'roulette':
        const totalFitness = algorithm.population.reduce((sum, ind) => sum + Math.max(0, ind.fitness), 0);
        for (let i = 0; i < algorithm.population.length; i++) {
          const pick = Math.random() * totalFitness;
          let currentSum = 0;
          for (const individual of algorithm.population) {
            currentSum += Math.max(0, individual.fitness);
            if (currentSum >= pick) {
              selected.push(individual);
              break;
            }
          }
        }
        break;
      default:
        selected.push(...algorithm.population);
    }

    return selected;
  }

  private selectRandomIndividuals(population: EvolutionaryAlgorithm['population'], count: number): EvolutionaryAlgorithm['population'] {
    const shuffled = [...population].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  private performCrossover(algorithm: EvolutionaryAlgorithm, parents: EvolutionaryAlgorithm['population']): EvolutionaryAlgorithm['population'] {
    const offspring: EvolutionaryAlgorithm['population'] = [];

    for (let i = 0; i < parents.length; i += 2) {
      const parent1 = parents[i];
      const parent2 = parents[i + 1] || parents[0];

      if (Math.random() < algorithm.operators.crossover.probability) {
        const [child1, child2] = this.crossoverChromosomes(parent1.chromosome, parent2.chromosome, algorithm.operators.crossover.method);

        offspring.push({
          id: `off_${Date.now()}_${i}`,
          chromosome: child1,
          fitness: 0,
          age: 0,
          parent1: parent1.id,
          parent2: parent2.id
        });

        if (i + 1 < parents.length) {
          offspring.push({
            id: `off_${Date.now()}_${i + 1}`,
            chromosome: child2,
            fitness: 0,
            age: 0,
            parent1: parent1.id,
            parent2: parent2.id
          });
        }
      } else {
        offspring.push({ ...parent1, id: `off_${Date.now()}_${i}` });
        if (i + 1 < parents.length) {
          offspring.push({ ...parent2, id: `off_${Date.now()}_${i + 1}` });
        }
      }
    }

    return offspring;
  }

  private crossoverChromosomes(parent1: number[], parent2: number[], method: string): [number[], number[]] {
    const length = parent1.length;
    const child1: number[] = [];
    const child2: number[] = [];

    switch (method) {
      case 'single_point':
        const point = Math.floor(Math.random() * length);
        for (let i = 0; i < length; i++) {
          if (i < point) {
            child1.push(parent1[i]);
            child2.push(parent2[i]);
          } else {
            child1.push(parent2[i]);
            child2.push(parent1[i]);
          }
        }
        break;
      case 'uniform':
        for (let i = 0; i < length; i++) {
          if (Math.random() < 0.5) {
            child1.push(parent1[i]);
            child2.push(parent2[i]);
          } else {
            child1.push(parent2[i]);
            child2.push(parent1[i]);
          }
        }
        break;
      default:
        return [parent1, parent2];
    }

    return [child1, child2];
  }

  private performMutation(algorithm: EvolutionaryAlgorithm, population: EvolutionaryAlgorithm['population']): void {
    population.forEach(individual => {
      for (let i = 0; i < individual.chromosome.length; i++) {
        if (Math.random() < algorithm.operators.mutation.probability) {
          individual.chromosome[i] += (Math.random() - 0.5) * algorithm.operators.mutation.strength;
        }
      }
    });
  }

  runSwarmAlgorithm(algorithmId: string, maxIterations?: number): Promise<OptimizationResult> {
    return new Promise((resolve) => {
      const algorithm = this.swarm.get(algorithmId);
      if (!algorithm) {
        resolve({ success: false, error: 'Algorithm not found' });
        return;
      }

      const iterations = maxIterations || algorithm.parameters.maxIterations;

      // Simulate swarm algorithm execution
      setTimeout(() => {
        const result = this.simulateSwarmAlgorithm(algorithm, iterations);

        resolve({
          success: true,
          bestSolution: result.bestSolution,
          bestFitness: result.bestFitness,
          iterations: iterations,
          convergence: result.convergence,
          computationTime: result.computationTime,
          swarmBehavior: result.swarmBehavior
        });
      }, iterations * 50); // 50ms per iteration
    });
  }

  private simulateSwarmAlgorithm(algorithm: SwarmAlgorithm, iterations: number): {
    bestSolution: number[];
    bestFitness: number;
    convergence: number[];
    computationTime: number;
    swarmBehavior: Record<string, unknown>;
  } {
    const convergence: number[] = [];
    let globalBestFitness = -Infinity;
    let globalBestPosition: number[] = [];

    // Initialize agents if empty
    if (algorithm.agents.length === 0) {
      for (let i = 0; i < algorithm.parameters.populationSize; i++) {
        const position = Array.from({ length: 10 }, () => Math.random() * 20 - 10);
        const fitness = this.evaluateFitness(position);
        algorithm.agents.push({
          id: `agent_${i}`,
          position,
          velocity: Array.from({ length: 10 }, () => 0),
          fitness,
          bestPosition: [...position],
          bestFitness: fitness,
          neighbors: []
        });
      }
    }

    for (let iter = 0; iter < iterations; iter++) {
      // Update global best
      algorithm.agents.forEach(agent => {
        if (agent.fitness > globalBestFitness) {
          globalBestFitness = agent.fitness;
          globalBestPosition = [...agent.position];
        }
      });

      convergence.push(globalBestFitness);

      // Update each agent
      algorithm.agents.forEach(agent => {
        // Update personal best
        if (agent.fitness > agent.bestFitness) {
          agent.bestFitness = agent.fitness;
          agent.bestPosition = [...agent.position];
        }

        // Update velocity and position
        for (let d = 0; d < agent.position.length; d++) {
          const r1 = Math.random();
          const r2 = Math.random();

          const cognitive = algorithm.parameters.cognitiveComponent * r1 * (agent.bestPosition[d] - agent.position[d]);
          const social = algorithm.parameters.socialComponent * r2 * (globalBestPosition[d] - agent.position[d]);

          agent.velocity[d] = algorithm.parameters.inertiaWeight * agent.velocity[d] + cognitive + social;

          // Clamp velocity
          if (algorithm.constraints.velocityClamping) {
            agent.velocity[d] = Math.max(-algorithm.constraints.maxVelocity[d], Math.min(algorithm.constraints.maxVelocity[d], agent.velocity[d]));
          }

          // Update position
          agent.position[d] += agent.velocity[d];

          // Boundary handling
          this.handleBoundary(agent.position, d, algorithm.constraints.boundaryHandling);
        }

        // Update fitness
        agent.fitness = this.evaluateFitness(agent.position);
      });
    }

    return {
      bestSolution: globalBestPosition,
      bestFitness: globalBestFitness,
      convergence,
      computationTime: iterations * 50,
      swarmBehavior: {
        finalPositions: algorithm.agents.map(a => a.position),
        velocityDistribution: algorithm.agents.map(a => a.velocity),
        clustering: this.calculateClustering(algorithm.agents)
      }
    };
  }

  private handleBoundary(position: number[], dimension: number, method: string): void {
    const value = position[dimension];

    switch (method) {
      case 'absorbing':
        position[dimension] = Math.max(-10, Math.min(10, value));
        break;
      case 'reflecting':
        if (value < -10) position[dimension] = -10 - (value + 10);
        else if (value > 10) position[dimension] = 10 - (value - 10);
        break;
      case 'random':
        if (value < -10 || value > 10) {
          position[dimension] = Math.random() * 20 - 10;
        }
        break;
    }
  }

  private calculateClustering(agents: SwarmAlgorithm['agents']): number {
    // Calculate swarm clustering coefficient
    let totalDistance = 0;
    let count = 0;

    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const distance = Math.sqrt(
          agents[i].position.reduce((sum, x, idx) => sum + Math.pow(x - agents[j].position[idx], 2), 0)
        );
        totalDistance += distance;
        count++;
      }
    }

    return count > 0 ? totalDistance / count : 0;
  }

  getBioInspiredAlgorithm(id: string): BioInspiredAlgorithm | undefined {
    return this.algorithms.get(id);
  }

  getEvolutionaryAlgorithm(id: string): EvolutionaryAlgorithm | undefined {
    return this.evolutionary.get(id);
  }

  getSwarmAlgorithm(id: string): SwarmAlgorithm | undefined {
    return this.swarm.get(id);
  }

  getNeuralAlgorithm(id: string): NeuralAlgorithm | undefined {
    return this.neural.get(id);
  }

  getImmuneAlgorithm(id: string): ImmuneAlgorithm | undefined {
    return this.immune.get(id);
  }

  getEcologicalAlgorithm(id: string): EcologicalAlgorithm | undefined {
    return this.ecological.get(id);
  }

  getCellularAlgorithm(id: string): CellularAlgorithm | undefined {
    return this.cellular.get(id);
  }

  getAllBioInspiredAlgorithms(): BioInspiredAlgorithm[] {
    return Array.from(this.algorithms.values());
  }

  getAllEvolutionaryAlgorithms(): EvolutionaryAlgorithm[] {
    return Array.from(this.evolutionary.values());
  }

  getAllSwarmAlgorithms(): SwarmAlgorithm[] {
    return Array.from(this.swarm.values());
  }

  getAllNeuralAlgorithms(): NeuralAlgorithm[] {
    return Array.from(this.neural.values());
  }

  getAllImmuneAlgorithms(): ImmuneAlgorithm[] {
    return Array.from(this.immune.values());
  }

  getAllEcologicalAlgorithms(): EcologicalAlgorithm[] {
    return Array.from(this.ecological.values());
  }

  getAllCellularAlgorithms(): CellularAlgorithm[] {
    return Array.from(this.cellular.values());
  }

  updateBioInspiredAlgorithm(id: string, updates: Partial<BioInspiredAlgorithm>): boolean {
    const algorithm = this.algorithms.get(id);
    if (!algorithm) return false;

    Object.assign(algorithm, updates);
    return true;
  }

  deleteBioInspiredAlgorithm(id: string): boolean {
    return this.algorithms.delete(id);
  }

  exportBioInspiredConfiguration(): Record<string, unknown> {
    return {
      algorithms: Array.from(this.algorithms.values()),
      evolutionary: Array.from(this.evolutionary.values()),
      swarm: Array.from(this.swarm.values()),
      neural: Array.from(this.neural.values()),
      immune: Array.from(this.immune.values()),
      ecological: Array.from(this.ecological.values()),
      cellular: Array.from(this.cellular.values()),
      exportedAt: new Date()
    };
  }
}

// Supporting interfaces
interface OptimizationResult {
  success: boolean;
  error?: string;
  bestSolution?: number[];
  bestFitness?: number;
  generations?: number;
  iterations?: number;
  convergence?: number[];
  diversity?: number[];
  computationTime?: number;
  swarmBehavior?: Record<string, unknown>;
}

export const bioInspiredAlgorithmsManager = new BioInspiredAlgorithmsManager();