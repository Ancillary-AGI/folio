import { Point, Component } from '../../types';

export interface ThermalMaterial {
  name: string;
  thermalConductivity: number; // W/m·K
  specificHeat: number; // J/kg·K
  density: number; // kg/m³
  emissivity?: number;
  absorptivity?: number;
}

export interface ThermalBoundaryCondition {
  type: 'temperature' | 'heat_flux' | 'convection' | 'radiation';
  location: Point | { x: number; y: number; width: number; height: number }; // Point or area
  value: number; // Temperature in K, heat flux in W/m², etc.
  heatTransferCoefficient?: number; // For convection (W/m²·K)
  ambientTemperature?: number; // For convection and radiation (K)
}

export interface ThermalLoad {
  type: 'power' | 'current' | 'voltage';
  componentId: string;
  value: number; // Watts for power, Amps for current, Volts for voltage
  location?: Point;
}

export interface ThermalNode {
  id: string;
  position: Point;
  temperature: number;
  material: string;
  boundaryCondition?: ThermalBoundaryCondition;
}

export interface ThermalElement {
  id: string;
  type: 'conduction' | 'convection' | 'radiation';
  nodes: string[]; // Node IDs
  properties: {
    area?: number; // m²
    thickness?: number; // m
    heatTransferCoefficient?: number; // W/m²·K
    emissivity?: number;
    viewFactor?: number;
  };
}

export interface ThermalAnalysisResult {
  id: string;
  timestamp: number;
  nodes: Array<{
    id: string;
    temperature: number;
    heatFlux: Point; // Heat flux vector
  }>;
  elements: Array<{
    id: string;
    heatFlux: number;
    thermalResistance: number;
  }>;
  summary: {
    maxTemperature: number;
    minTemperature: number;
    averageTemperature: number;
    totalHeatDissipation: number;
    thermalGradient: number;
  };
  convergence: {
    iterations: number;
    converged: boolean;
    residual: number;
  };
}

export class ThermalAnalysisEngine {
  private materials: Map<string, ThermalMaterial> = new Map();
  private nodes: Map<string, ThermalNode> = new Map();
  private elements: Map<string, ThermalElement> = new Map();
  private boundaryConditions: ThermalBoundaryCondition[] = [];
  private loads: ThermalLoad[] = [];

  constructor() {
    this.initializeStandardMaterials();
  }

  private initializeStandardMaterials(): void {
    const materials: ThermalMaterial[] = [
      {
        name: 'copper',
        thermalConductivity: 401,
        specificHeat: 385,
        density: 8960,
        emissivity: 0.03
      },
      {
        name: 'aluminum',
        thermalConductivity: 237,
        specificHeat: 903,
        density: 2700,
        emissivity: 0.09
      },
      {
        name: 'silicon',
        thermalConductivity: 148,
        specificHeat: 700,
        density: 2330,
        emissivity: 0.7
      },
      {
        name: 'fr4',
        thermalConductivity: 0.25,
        specificHeat: 600,
        density: 1850,
        emissivity: 0.9
      },
      {
        name: 'solder_mask',
        thermalConductivity: 0.2,
        specificHeat: 1000,
        density: 1200,
        emissivity: 0.9
      },
      {
        name: 'air',
        thermalConductivity: 0.026,
        specificHeat: 1005,
        density: 1.225,
        emissivity: 0.0
      }
    ];

    materials.forEach(material => {
      this.materials.set(material.name, material);
    });
  }

  addMaterial(material: ThermalMaterial): void {
    this.materials.set(material.name, material);
  }

  createThermalModel(components: Component[]): void {
    // Create thermal nodes for components
    components.forEach(component => {
      const node: ThermalNode = {
        id: `thermal_${component.id}`,
        position: { x: 0, y: 0 }, // Would be set from component position
        temperature: 298.15, // Room temperature in Kelvin
        material: this.inferMaterialFromComponent(component)
      };
      this.nodes.set(node.id, node);
    });

    // Create thermal elements between adjacent components
    this.createThermalElements(components);
  }

  private inferMaterialFromComponent(component: Component): string {
    const category = component.category.toLowerCase();
    const name = component.name.toLowerCase();

    if (category.includes('resistor') || name.includes('resistor')) return 'copper';
    if (category.includes('capacitor') || name.includes('capacitor')) return 'silicon';
    if (category.includes('ic') || category.includes('chip')) return 'silicon';
    if (category.includes('diode') || name.includes('diode')) return 'silicon';
    if (category.includes('transistor') || name.includes('transistor')) return 'silicon';

    return 'copper'; // Default
  }

  private createThermalElements(components: Component[]): void {
    const nodeIds = Array.from(this.nodes.keys());

    // Create conduction elements between nearby components
    for (let i = 0; i < nodeIds.length; i++) {
      for (let j = i + 1; j < nodeIds.length; j++) {
        const node1 = this.nodes.get(nodeIds[i])!;
        const node2 = this.nodes.get(nodeIds[j])!;

        const distance = Math.sqrt(
          Math.pow(node1.position.x - node2.position.x, 2) +
          Math.pow(node1.position.y - node2.position.y, 2)
        );

        if (distance < 0.01) { // 10mm threshold
          const element: ThermalElement = {
            id: `element_${i}_${j}`,
            type: 'conduction',
            nodes: [nodeIds[i], nodeIds[j]],
            properties: {
              area: 1e-6, // 1mm²
              thickness: 0.001 // 1mm
            }
          };
          this.elements.set(element.id, element);
        }
      }
    }

    // Add convection elements to ambient
    nodeIds.forEach(nodeId => {
      const element: ThermalElement = {
        id: `conv_${nodeId}`,
        type: 'convection',
        nodes: [nodeId],
        properties: {
          area: 1e-4, // 10mm²
          heatTransferCoefficient: 5.0 // Natural convection
        }
      };
      this.elements.set(element.id, element);
    });
  }

  addBoundaryCondition(bc: ThermalBoundaryCondition): void {
    this.boundaryConditions.push(bc);

    // Apply boundary condition to nearest node
    const nearestNode = this.findNearestNode(bc.location);
    if (nearestNode) {
      nearestNode.boundaryCondition = bc;
    }
  }

  addThermalLoad(load: ThermalLoad): void {
    this.loads.push(load);

    // Convert electrical power to thermal load
    if (load.type === 'power') {
      // Power is already in Watts
    } else if (load.type === 'current' && load.value) {
      // Estimate power dissipation (simplified)
      load.value = load.value * load.value * 10; // I²R approximation
    }
  }

  private findNearestNode(location: Point | { x: number; y: number; width: number; height: number }): ThermalNode | null {
    let targetPoint: Point;

    if ('width' in location) {
      // It's an area, use center
      targetPoint = {
        x: location.x + location.width / 2,
        y: location.y + location.height / 2
      };
    } else {
      targetPoint = location;
    }

    let nearestNode: ThermalNode | null = null;
    let minDistance = Infinity;

    this.nodes.forEach(node => {
      const distance = Math.sqrt(
        Math.pow(node.position.x - targetPoint.x, 2) +
        Math.pow(node.position.y - targetPoint.y, 2)
      );

      if (distance < minDistance) {
        minDistance = distance;
        nearestNode = node;
      }
    });

    return nearestNode;
  }

  async solveSteadyState(): Promise<ThermalAnalysisResult> {
    const startTime = Date.now();

    // Build thermal conductivity matrix
    const nodeList = Array.from(this.nodes.values());
    const n = nodeList.length;
    const K = Array(n).fill(0).map(() => Array(n).fill(0)); // Conductivity matrix
    const Q = Array(n).fill(0); // Heat generation vector

    // Build conductivity matrix from elements
    this.elements.forEach(element => {
      if (element.type === 'conduction' && element.nodes.length === 2) {
        const i = nodeList.findIndex(node => node.id === element.nodes[0]);
        const j = nodeList.findIndex(node => node.id === element.nodes[1]);

        if (i !== -1 && j !== -1) {
          const mat1 = this.materials.get(nodeList[i].material);
          const mat2 = this.materials.get(nodeList[j].material);
          const k_avg = (mat1?.thermalConductivity || 1) + (mat2?.thermalConductivity || 1) / 2;
          const A = element.properties.area || 1e-6;
          const L = element.properties.thickness || 0.001;
          const conductance = k_avg * A / L;

          K[i][i] += conductance;
          K[j][j] += conductance;
          K[i][j] -= conductance;
          K[j][i] -= conductance;
        }
      }
    });

    // Add convection terms
    this.elements.forEach(element => {
      if (element.type === 'convection' && element.nodes.length === 1) {
        const i = nodeList.findIndex(node => node.id === element.nodes[0]);
        if (i !== -1) {
          const h = element.properties.heatTransferCoefficient || 5.0;
          const A = element.properties.area || 1e-4;
          K[i][i] += h * A;
          Q[i] += h * A * 298.15; // Ambient temperature
        }
      }
    });

    // Apply boundary conditions
    this.boundaryConditions.forEach(bc => {
      const node = this.findNearestNode(bc.location);
      if (node) {
        const i = nodeList.findIndex(n => n.id === node.id);
        if (i !== -1) {
          if (bc.type === 'temperature') {
            // Set temperature directly
            for (let j = 0; j < n; j++) {
              K[i][j] = (j === i) ? 1 : 0;
            }
            Q[i] = bc.value;
          }
        }
      }
    });

    // Add thermal loads
    this.loads.forEach(load => {
      const node = this.nodes.get(`thermal_${load.componentId}`);
      if (node) {
        const i = nodeList.findIndex(n => n.id === node.id);
        if (i !== -1) {
          Q[i] += load.value;
        }
      }
    });

    // Solve KT = Q for T
    const temperatures = this.solveLinearSystem(K, Q);

    // Calculate results
    const result: ThermalAnalysisResult = {
      id: `thermal_${Date.now()}`,
      timestamp: Date.now(),
      nodes: nodeList.map((node, i) => ({
        id: node.id,
        temperature: temperatures[i],
        heatFlux: { x: 0, y: 0 } // Simplified
      })),
      elements: Array.from(this.elements.values()).map(element => ({
        id: element.id,
        heatFlux: 0, // Simplified
        thermalResistance: 0 // Simplified
      })),
      summary: {
        maxTemperature: Math.max(...temperatures),
        minTemperature: Math.min(...temperatures),
        averageTemperature: temperatures.reduce((a, b) => a + b, 0) / temperatures.length,
        totalHeatDissipation: Q.reduce((a, b) => a + b, 0),
        thermalGradient: Math.max(...temperatures) - Math.min(...temperatures)
      },
      convergence: {
        iterations: 1,
        converged: true,
        residual: 0
      }
    };

    return result;
  }

  private solveLinearSystem(A: number[][], b: number[]): number[] {
    // Gaussian elimination (simplified implementation)
    const n = b.length;
    const x = [...b];

    for (let i = 0; i < n; i++) {
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
          maxRow = k;
        }
      }

      [A[i], A[maxRow]] = [A[maxRow], A[i]];
      [x[i], x[maxRow]] = [x[maxRow], x[i]];

      for (let k = i + 1; k < n; k++) {
        const factor = A[k][i] / A[i][i];
        for (let j = i; j < n; j++) {
          A[k][j] -= factor * A[i][j];
        }
        x[k] -= factor * x[i];
      }
    }

    for (let i = n - 1; i >= 0; i--) {
      x[i] /= A[i][i];
      for (let k = i - 1; k >= 0; k--) {
        x[k] -= A[k][i] * x[i];
      }
    }

    return x;
  }

  getMaterial(name: string): ThermalMaterial | undefined {
    return this.materials.get(name);
  }

  getAllMaterials(): ThermalMaterial[] {
    return Array.from(this.materials.values());
  }

  clear(): void {
    this.nodes.clear();
    this.elements.clear();
    this.boundaryConditions = [];
    this.loads = [];
  }
}

export const thermalAnalysisEngine = new ThermalAnalysisEngine();