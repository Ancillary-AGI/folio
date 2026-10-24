/**
 * Thermal Analysis for PCB Design
 *
 * Lumped-capacitance transient solver. Each node carries a heat capacity and
 * loses heat through convection/radiation while exchanging heat with nearby
 * nodes through conduction. The explicit Euler step is subdivided to stay
 * below the stability limit, and convergence is reported from the actual
 * maximum temperature change per step — never assumed.
 */

const STEFAN_BOLTZMANN = 5.67e-8; // W/(m²·K⁴)
const KELVIN_OFFSET = 273.15;
const CONTACT_RANGE_M = 0.01;
const MIN_CONTACT_DISTANCE_M = 1e-4;
const CONVERGENCE_TOLERANCE_K = 1e-3;
const MAX_SUBSTEPS = 1000;

export interface ThermalNode {
  id: string;
  position: { x: number; y: number; z: number };
  temperature: number;
  powerDissipation: number;
  material: string;
}

export interface ThermalBoundary {
  /** Lumped boundary mechanisms this solver actually applies to every node. */
  type: 'convection' | 'radiation';
  temperature?: number;
  heatTransferCoefficient?: number; // W/(m²·K)
  emissivity?: number;
  area: number;
}

export interface ThermalAnalysisResult {
  nodes: ThermalNode[];
  hotspots: Array<{
    nodeId: string;
    temperature: number;
    severity: 'low' | 'medium' | 'high' | 'critical';
  }>;
  thermalGradient: Array<{
    from: string;
    to: string;
    gradient: number; // K/m
  }>;
  maxTemperature: number;
  converged: boolean;
  simulatedTime: number;
  timeToSteadyState: number | null;
  recommendations: string[];
}

export interface ThermalSimulationConfig {
  ambientTemperature: number;
  convectionCoefficient: number;
  boardMaterial: string;
  copperThickness: number;
  layerCount: number;
  simulationTime: number;
  timeStep: number;
}

interface ThermalMaterial {
  thermalConductivity: number; // W/(m·K)
  specificHeat: number; // J/(kg·K)
  density: number; // kg/m³
  emissivity: number;
}

interface NodeEnvironment {
  powerW: number;
  heatCapacityJPerK: number;
  convectionAreaM2: number;
  radiationAreaM2: number;
  convectionCoefficientWPerM2K: number;
  emissivity: number;
  /** Sink temperature of each mechanism, honouring a boundary override. */
  convectionAmbientC: number;
  radiationAmbientC: number;
}

interface ThermalLink {
  a: number;
  b: number;
  conductanceWPerK: number;
}

export class ThermalAnalysisEngine {
  private thermalProperties: Record<string, ThermalMaterial> = {
    'FR4': {
      thermalConductivity: 0.3,
      specificHeat: 1200,
      density: 1850,
      emissivity: 0.9
    },
    'copper': {
      thermalConductivity: 400,
      specificHeat: 385,
      density: 8960,
      emissivity: 0.04
    },
    'aluminum': {
      thermalConductivity: 205,
      specificHeat: 900,
      density: 2700,
      emissivity: 0.1
    },
    'silicon': {
      thermalConductivity: 148,
      specificHeat: 700,
      density: 2329,
      emissivity: 0.7
    }
  };

  async simulateThermal(
    nodes: ThermalNode[],
    boundaries: ThermalBoundary[],
    config: ThermalSimulationConfig
  ): Promise<{
    nodes: ThermalNode[];
    hotspots: ThermalAnalysisResult['hotspots'];
    maxTemperature: number;
    steadyStateReached: boolean;
  }> {
    const result = await this.analyzeThermal(nodes, boundaries, config);
    return {
      nodes: result.nodes,
      hotspots: result.hotspots,
      maxTemperature: result.maxTemperature,
      steadyStateReached: result.converged
    };
  }

  async analyzeThermal(
    nodes: ThermalNode[],
    boundaries: ThermalBoundary[],
    config: ThermalSimulationConfig
  ): Promise<ThermalAnalysisResult> {
    this.validateInputs(nodes, boundaries, config);
    if (nodes.length === 0) {
      return {
        nodes: [],
        hotspots: [],
        thermalGradient: [],
        maxTemperature: config.ambientTemperature,
        converged: true,
        simulatedTime: 0,
        timeToSteadyState: 0,
        recommendations: []
      };
    }

    const environments = this.buildEnvironments(nodes, boundaries, config);
    const links = this.buildLinks(nodes);
    let temperatures = nodes.map(node =>
      Number.isFinite(node.temperature) ? node.temperature : config.ambientTemperature
    );

    const substepsPerStep = this.substepCount(environments, links, temperatures, config.timeStep);
    const substep = config.timeStep / substepsPerStep;
    const totalSteps = Math.ceil(config.simulationTime / config.timeStep);

    let converged = false;
    let simulatedTime = 0;
    let timeToSteadyState: number | null = null;

    simulate: for (let step = 0; step < totalSteps; step++) {
      for (let sub = 0; sub < substepsPerStep; sub++) {
        const next = this.computeNextTemperatures(environments, links, temperatures, substep);
        if (next.some(temperature => !Number.isFinite(temperature))) break simulate;

        const maxDelta = next.reduce(
          (max, temperature, index) => Math.max(max, Math.abs(temperature - temperatures[index])),
          0
        );
        temperatures = next;
        simulatedTime += substep;

        if (maxDelta < CONVERGENCE_TOLERANCE_K) {
          converged = true;
          timeToSteadyState = simulatedTime;
          break simulate;
        }
      }
    }

    const resultNodes = nodes.map((node, index) => ({ ...node, temperature: temperatures[index] }));
    const hotspots = this.identifyHotspots(resultNodes, config.ambientTemperature);
    const thermalGradient = this.calculateThermalGradients(resultNodes);

    return {
      nodes: resultNodes,
      hotspots,
      thermalGradient,
      maxTemperature: Math.max(...temperatures),
      converged,
      simulatedTime,
      timeToSteadyState,
      recommendations: this.generateThermalRecommendations(resultNodes, hotspots)
    };
  }

  /**
   * Fail on non-physical input instead of substituting ambient values or
   * generating an infinite substep loop.
   */
  private validateInputs(
    nodes: ThermalNode[],
    boundaries: ThermalBoundary[],
    config: ThermalSimulationConfig
  ): void {
    const problems: string[] = [];
    if (!Number.isFinite(config.ambientTemperature)) problems.push('ambientTemperature must be finite');
    if (!Number.isFinite(config.simulationTime) || config.simulationTime <= 0) {
      problems.push('simulationTime must be positive and finite');
    }
    if (!Number.isFinite(config.timeStep) || config.timeStep <= 0) {
      problems.push('timeStep must be positive and finite');
    }
    if (!Number.isFinite(config.convectionCoefficient) || config.convectionCoefficient < 0) {
      problems.push('convectionCoefficient must be zero or positive and finite');
    }

    nodes.forEach((node, index) => {
      const label = node.id?.trim() || `node ${index + 1}`;
      if (!Number.isFinite(node.temperature)) problems.push(`${label}: temperature must be finite`);
      if (!Number.isFinite(node.powerDissipation)) problems.push(`${label}: powerDissipation must be finite`);
      for (const axis of ['x', 'y', 'z'] as const) {
        if (!Number.isFinite(node.position?.[axis])) problems.push(`${label}: position.${axis} must be finite`);
      }
    });

    boundaries.forEach((boundary, index) => {
      const label = `boundary ${index + 1}`;
      if (!Number.isFinite(boundary.area) || boundary.area < 0) {
        problems.push(`${label}: area must be zero or positive and finite`);
      }
      if (
        boundary.heatTransferCoefficient !== undefined &&
        (!Number.isFinite(boundary.heatTransferCoefficient) || boundary.heatTransferCoefficient < 0)
      ) {
        problems.push(`${label}: heatTransferCoefficient must be zero or positive and finite`);
      }
      if (
        boundary.emissivity !== undefined &&
        (!Number.isFinite(boundary.emissivity) || boundary.emissivity < 0 || boundary.emissivity > 1)
      ) {
        problems.push(`${label}: emissivity must lie in [0, 1]`);
      }
    });

    if (problems.length > 0) {
      throw new Error(`Thermal analysis rejected invalid input — ${problems.join('; ')}.`);
    }
  }

  private buildEnvironments(
    nodes: ThermalNode[],
    boundaries: ThermalBoundary[],
    config: ThermalSimulationConfig
  ): NodeEnvironment[] {
    const convectionBoundaries = boundaries.filter(boundary => boundary.type === 'convection');
    const radiationBoundaries = boundaries.filter(boundary => boundary.type === 'radiation');

    const convectionArea = this.areaPerNode(convectionBoundaries, nodes.length);
    const radiationArea = this.areaPerNode(radiationBoundaries, nodes.length);
    const convectionCoefficient = this.average(
      convectionBoundaries.map(boundary => boundary.heatTransferCoefficient ?? config.convectionCoefficient),
      config.convectionCoefficient
    );
    const convectionAmbientC = this.average(
      convectionBoundaries.map(boundary => boundary.temperature ?? config.ambientTemperature),
      config.ambientTemperature
    );
    const radiationAmbientC = this.average(
      radiationBoundaries.map(boundary => boundary.temperature ?? config.ambientTemperature),
      config.ambientTemperature
    );

    return nodes.map(node => {
      const material = this.materialOf(node);
      const emissivity = this.average(
        radiationBoundaries.map(boundary => boundary.emissivity ?? material.emissivity),
        material.emissivity
      );

      return {
        powerW: node.powerDissipation,
        heatCapacityJPerK: material.density * material.specificHeat * this.estimateVolume(),
        convectionAreaM2: convectionArea,
        radiationAreaM2: radiationArea,
        convectionCoefficientWPerM2K: convectionCoefficient,
        emissivity,
        convectionAmbientC,
        radiationAmbientC
      };
    });
  }

  private buildLinks(nodes: ThermalNode[]): ThermalLink[] {
    const links: ThermalLink[] = [];
    const contactArea = this.estimateContactArea();

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const distance = this.distance(nodes[i].position, nodes[j].position);
        if (distance < MIN_CONTACT_DISTANCE_M || distance >= CONTACT_RANGE_M) continue;

        const conductivityA = this.materialOf(nodes[i]).thermalConductivity;
        const conductivityB = this.materialOf(nodes[j]).thermalConductivity;
        // Series conduction through two half-distances: harmonic mean of k.
        const effectiveConductivity =
          (2 * conductivityA * conductivityB) / (conductivityA + conductivityB);

        links.push({
          a: i,
          b: j,
          conductanceWPerK: effectiveConductivity * contactArea / distance
        });
      }
    }

    return links;
  }

  private substepCount(
    environments: NodeEnvironment[],
    links: ThermalLink[],
    temperatures: number[],
    requestedStep: number
  ): number {
    const conductances = environments.map((environment, index) => {
      const absolute = Math.max(temperatures[index] + KELVIN_OFFSET, 1);
      return environment.convectionCoefficientWPerM2K * environment.convectionAreaM2
        + 4 * environment.emissivity * STEFAN_BOLTZMANN * environment.radiationAreaM2 * absolute ** 3;
    });

    for (const link of links) {
      conductances[link.a] += link.conductanceWPerK;
      conductances[link.b] += link.conductanceWPerK;
    }

    let stableStep = Infinity;
    environments.forEach((environment, index) => {
      if (conductances[index] > 0) {
        stableStep = Math.min(
          stableStep,
          0.5 * environment.heatCapacityJPerK / conductances[index]
        );
      }
    });

    if (!Number.isFinite(stableStep)) return 1;
    return Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(requestedStep / stableStep)));
  }

  private computeNextTemperatures(
    environments: NodeEnvironment[],
    links: ThermalLink[],
    temperatures: number[],
    dt: number
  ): number[] {
    const rates = environments.map((environment, index) => {
      const temperature = temperatures[index];
      const absolute = temperature + KELVIN_OFFSET;
      const radiationAmbientAbsolute = environment.radiationAmbientC + KELVIN_OFFSET;

      const convection = environment.convectionCoefficientWPerM2K
        * environment.convectionAreaM2
        * (temperature - environment.convectionAmbientC);
      const radiation = environment.emissivity
        * STEFAN_BOLTZMANN
        * environment.radiationAreaM2
        * (absolute ** 4 - radiationAmbientAbsolute ** 4);

      return (environment.powerW - convection - radiation) / environment.heatCapacityJPerK;
    });

    for (const link of links) {
      const heatFlow = link.conductanceWPerK * (temperatures[link.a] - temperatures[link.b]);
      rates[link.a] -= heatFlow / environments[link.a].heatCapacityJPerK;
      rates[link.b] += heatFlow / environments[link.b].heatCapacityJPerK;
    }

    return temperatures.map((temperature, index) => temperature + rates[index] * dt);
  }

  private identifyHotspots(
    nodes: ThermalNode[],
    ambientTemp: number
  ): ThermalAnalysisResult['hotspots'] {
    const hotspots: ThermalAnalysisResult['hotspots'] = [];

    nodes.forEach(node => {
      const deltaT = node.temperature - ambientTemp;
      let severity: 'low' | 'medium' | 'high' | 'critical';

      if (deltaT > 60) {
        severity = 'critical';
      } else if (deltaT > 40) {
        severity = 'high';
      } else if (deltaT > 20) {
        severity = 'medium';
      } else {
        severity = 'low';
      }

      if (severity !== 'low') {
        hotspots.push({
          nodeId: node.id,
          temperature: node.temperature,
          severity
        });
      }
    });

    return hotspots.sort((a, b) => b.temperature - a.temperature);
  }

  private calculateThermalGradients(nodes: ThermalNode[]): ThermalAnalysisResult['thermalGradient'] {
    const gradients: ThermalAnalysisResult['thermalGradient'] = [];

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const distance = this.distance(nodes[i].position, nodes[j].position);
        if (distance < MIN_CONTACT_DISTANCE_M || distance >= CONTACT_RANGE_M) continue;

        const deltaT = Math.abs(nodes[i].temperature - nodes[j].temperature);
        gradients.push({
          from: nodes[i].id,
          to: nodes[j].id,
          gradient: deltaT / distance
        });
      }
    }

    return gradients;
  }

  private generateThermalRecommendations(
    nodes: ThermalNode[],
    hotspots: ThermalAnalysisResult['hotspots']
  ): string[] {
    const recommendations: string[] = [];

    if (hotspots.length > 0) {
      recommendations.push(`${hotspots.length} hotspot(s) detected. Consider adding thermal vias or heat sinks.`);
    }

    const maxTemp = Math.max(...nodes.map(node => node.temperature));
    if (maxTemp > 85) {
      recommendations.push('Maximum temperature exceeds recommended operating temperature. Add cooling solution.');
    }

    const highPowerNodes = nodes.filter(node => node.powerDissipation > 1.0);
    if (highPowerNodes.length > 0) {
      recommendations.push('High-power components detected. Consider using thermal pads or increasing copper area.');
    }

    return recommendations;
  }

  private materialOf(node: ThermalNode): ThermalMaterial {
    return this.thermalProperties[node.material] ?? this.thermalProperties['FR4'];
  }

  private areaPerNode(boundaries: ThermalBoundary[], nodeCount: number): number {
    // No boundary of this type means the mechanism is absent, not a hidden
    // 1 cm² default: radiation must not cool a model that never declared it.
    const totalArea = boundaries.reduce((sum, boundary) => sum + boundary.area, 0);
    return totalArea / Math.max(nodeCount, 1);
  }

  private average(values: number[], fallback: number): number {
    if (values.length === 0) return fallback;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private estimateVolume(): number {
    return 0.000001; // m³ (1 cm³ per node)
  }

  private estimateContactArea(): number {
    return 0.0001; // m² (0.1 cm² per neighbouring pair)
  }

  private distance(p1: { x: number; y: number; z: number }, p2: { x: number; y: number; z: number }): number {
    return Math.sqrt(
      Math.pow(p2.x - p1.x, 2) +
      Math.pow(p2.y - p1.y, 2) +
      Math.pow(p2.z - p1.z, 2)
    );
  }
}

export const thermalAnalysisEngine = new ThermalAnalysisEngine();
