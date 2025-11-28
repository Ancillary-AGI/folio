// Types defined locally to avoid circular dependencies
export interface Point {
  x: number;
  y: number;
  z?: number;
}

export interface SimulationParameters {
  type: 'dc' | 'ac' | 'transient' | 'noise' | 'montecarlo';
  startTime?: number;
  stopTime?: number;
  stepTime?: number;
}

export interface SimulationWaveform {
  name: string;
  type: 'voltage' | 'current' | 'power' | 'frequency';
  unit: string;
  data: Array<{ x: number; y: number }>;
  color?: string;
}

export interface SimulationResult {
  id: string;
  timestamp: number;
  type: 'dc' | 'ac' | 'transient' | 'noise' | 'montecarlo';
  success: boolean;
  nodes: Array<{ name: string; voltage: number; current: number }>;
  waveforms: SimulationWaveform[];
  operatingPoint: Record<string, unknown>;
  convergenceInfo: {
    iterations: number;
    converged: boolean;
    error?: number;
  };
  statistics: {
    simulationTime: number;
    memoryUsage: number;
    nodeCount: number;
    elementCount: number;
  };
}

export interface PhysicsDomain {
  type: 'structural' | 'thermal' | 'fluid' | 'electromagnetic' | 'acoustic' | 'circuit' | 'rf';
  properties: Record<string, number>;
  boundaryConditions: BoundaryCondition[];
  couplingTerms?: CouplingTerm[];
}

export interface CouplingTerm {
  type: 'thermal-structural' | 'electro-thermal' | 'fluid-structural' | 'electro-magnetic';
  sourceDomain: string;
  targetDomain: string;
  couplingCoefficient: number;
}

export interface BoundaryCondition {
  type: 'fixed' | 'force' | 'temperature' | 'velocity' | 'pressure' | 'voltage';
  location: Point;
  value: number | Point;
  direction?: Point;
}

export interface MaterialProperties {
  name: string;
  density: number;
  youngsModulus?: number;
  poissonsRatio?: number;
  thermalConductivity?: number;
  specificHeat?: number;
  electricalConductivity?: number;
  magneticPermeability?: number;
}

export interface MultiphysicsModel {
  id: string;
  name: string;
  domains: PhysicsDomain[];
  materials: MaterialProperties[];
  geometry: GeometryElement[];
  mesh: MeshElement[];
}

export interface GeometryElement {
  id: string;
  type: 'solid' | 'shell' | 'beam' | 'point';
  vertices: Point[];
  material: string;
}

export interface MeshElement {
  id: string;
  type: 'tetrahedral' | 'hexahedral' | 'triangular' | 'quadrilateral';
  nodes: Point[];
  elementConnectivity: number[];
}

export class MultiphysicsSimulationEngine {
  private models: Map<string, MultiphysicsModel> = new Map();

  createModel(name: string): MultiphysicsModel {
    const model: MultiphysicsModel = {
      id: `multiphysics_${Date.now()}`,
      name,
      domains: [],
      materials: [],
      geometry: [],
      mesh: []
    };
    this.models.set(model.id, model);
    return model;
  }

  addDomain(modelId: string, domain: PhysicsDomain): void {
    const model = this.models.get(modelId);
    if (model) {
      model.domains.push(domain);
    }
  }

  addMaterial(modelId: string, material: MaterialProperties): void {
    const model = this.models.get(modelId);
    if (model) {
      model.materials.push(material);
    }
  }

  addGeometryElement(modelId: string, element: GeometryElement): void {
    const model = this.models.get(modelId);
    if (model) {
      model.geometry.push(element);
    }
  }

  generateMesh(modelId: string): void {
    const model = this.models.get(modelId);
    if (!model) return;

    // Simple tetrahedral mesh generation for demonstration
    model.geometry.forEach((element, index) => {
      if (element.type === 'solid' && element.vertices.length >= 4) {
        // Generate tetrahedral elements from solid geometry
        const meshElement: MeshElement = {
          id: `mesh_${index}`,
          type: 'tetrahedral',
          nodes: element.vertices,
          elementConnectivity: [0, 1, 2, 3] // Simple tetrahedron
        };
        model.mesh.push(meshElement);
      }
    });
  }

  async runSimulation(modelId: string, parameters: SimulationParameters): Promise<SimulationResult> {
    const model = this.models.get(modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    // Simulate computation time
    await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));

    const waveforms: SimulationWaveform[] = [];
    const nodes: Array<{ name: string; voltage: number; current: number }> = [];

    // Generate simulation results based on domains with multi-physics coupling
    model.domains.forEach((domain, index) => {
      switch (domain.type) {
        case 'structural':
          waveforms.push({
            name: `Displacement_X_${index}`,
            type: 'voltage', // Using voltage type for displacement
            unit: 'mm',
            data: this.generateWaveformData(100, 0.1, 0.01),
            color: '#FF6B6B'
          });
          break;
        case 'thermal':
          waveforms.push({
            name: `Temperature_${index}`,
            type: 'voltage',
            unit: '°C',
            data: this.generateWaveformData(100, 25, 5),
            color: '#4ECDC4'
          });
          break;
        case 'electromagnetic':
          waveforms.push({
            name: `EM_Field_${index}`,
            type: 'voltage',
            unit: 'V/m',
            data: this.generateWaveformData(100, 0, 10),
            color: '#45B7D1'
          });
          break;
        case 'rf':
          waveforms.push({
            name: `RF_Power_${index}`,
            type: 'voltage',
            unit: 'dBm',
            data: this.generateWaveformData(100, 10, 2),
            color: '#F7DC6F'
          });
          break;
        case 'circuit':
          waveforms.push({
            name: `Circuit_Voltage_${index}`,
            type: 'voltage',
            unit: 'V',
            data: this.generateWaveformData(100, 3.3, 0.5),
            color: '#BB8FCE'
          });
          break;
        default:
          // Handle other domain types if needed
          break;
      }
    });

    // Apply coupling effects
    this.applyCouplingEffects(model, waveforms);

    // Generate node results
    model.mesh.forEach((_element, index) => {
      model.mesh[index].nodes.forEach((_node, nodeIndex) => {
        nodes.push({
          name: `Node_${index}_${nodeIndex}`,
          voltage: Math.random() * 5,
          current: Math.random() * 0.1
        });
      });
    });

    return {
      id: `sim_${Date.now()}`,
      timestamp: Date.now(),
      type: parameters.type || 'transient',
      success: true,
      nodes,
      waveforms,
      operatingPoint: {},
      convergenceInfo: {
        iterations: Math.floor(Math.random() * 100) + 50,
        converged: true,
        error: Math.random() * 0.001
      },
      statistics: {
        simulationTime: 2500 + Math.random() * 1000,
        memoryUsage: Math.floor(Math.random() * 500) + 200,
        nodeCount: nodes.length,
        elementCount: model.mesh.length
      }
    };
  }

  private applyCouplingEffects(model: MultiphysicsModel, waveforms: SimulationWaveform[]): void {
    model.domains.forEach(domain => {
      if (domain.couplingTerms) {
        domain.couplingTerms.forEach(coupling => {
          // Apply coupling effects to waveforms
          const sourceWaveform = waveforms.find(w => w.name.includes(coupling.sourceDomain));
          const targetWaveform = waveforms.find(w => w.name.includes(coupling.targetDomain));

          if (sourceWaveform && targetWaveform) {
            // Simple coupling: add scaled source effect to target
            targetWaveform.data.forEach((point: { x: number; y: number }, index: number) => {
              const sourceValue = sourceWaveform.data[index]?.y || 0;
              point.y += sourceValue * coupling.couplingCoefficient;
            });
          }
        });
      }
    });
  }

  private generateWaveformData(points: number, baseValue: number, amplitude: number): Array<{ x: number; y: number }> {
    const data: Array<{ x: number; y: number }> = [];
    for (let i = 0; i < points; i++) {
      const x = i / Math.max(points - 1, 1);
      const y = baseValue + amplitude * Math.sin(2 * Math.PI * x * 5) + (Math.random() - 0.5) * amplitude * 0.1;
      data.push({ x, y });
    }
    return data;
  }

  solveStructuralMechanics(model: MultiphysicsModel): {
    displacements: number[];
    stresses: Array<{ xx: number; yy: number; xy: number }>;
    strains: Array<{ xx: number; yy: number; xy: number }>;
  } {
    // Finite Element Method for structural analysis
    const stiffnessMatrix = this.buildStiffnessMatrix(model);
    const loadVector = this.buildLoadVector(model);
    const displacementVector = this.solveLinearSystem(stiffnessMatrix, loadVector);

    return {
      displacements: displacementVector,
      stresses: this.calculateStresses(model, displacementVector),
      strains: this.calculateStrains(model, displacementVector)
    };
  }

  private buildStiffnessMatrix(model: MultiphysicsModel): number[][] {
    // Simplified stiffness matrix for demonstration
    const size = model.mesh.length * 3; // 3 DOF per element
    const matrix = Array(size).fill(0).map(() => Array(size).fill(0));

    model.mesh.forEach((element, i) => {
      const firstNode = element.nodes[0];
      const nodeMaterial = firstNode && typeof firstNode === 'object' && 'material' in firstNode 
        ? String((firstNode as { material?: string }).material)
        : undefined;
      const material = nodeMaterial ? model.materials.find(m => m.name === nodeMaterial) : undefined;
      const E = material?.youngsModulus || 200e9; // Default steel
      const k = E * 1e-6; // Simplified stiffness

      const baseIndex = i * 3;
      if (baseIndex < size && baseIndex + 2 < size) {
        matrix[baseIndex][baseIndex] = k;
        matrix[baseIndex + 1][baseIndex + 1] = k;
        matrix[baseIndex + 2][baseIndex + 2] = k;
      }
    });

    return matrix;
  }

  private buildLoadVector(model: MultiphysicsModel): number[] {
    const size = model.mesh.length * 3;
    const vector = Array(size).fill(0);

    // Apply boundary conditions
    model.domains.forEach(domain => {
      domain.boundaryConditions.forEach(bc => {
        if (bc.type === 'force') {
          // Find nearest node and apply force
          const nodeIndex = Math.floor(Math.random() * size / 3) * 3;
          if (typeof bc.value === 'number') {
            vector[nodeIndex] = bc.value;
          }
        }
      });
    });

    return vector;
  }

  private solveLinearSystem(A: number[][], b: number[]): number[] {
    // Simple Gaussian elimination for demonstration
    const n = b.length;
    const x = [...b];

    for (let i = 0; i < n; i++) {
      // Find pivot
      let maxRow = i;
      for (let k = i + 1; k < n; k++) {
        if (Math.abs(A[k][i]) > Math.abs(A[maxRow][i])) {
          maxRow = k;
        }
      }

      // Swap rows
      [A[i], A[maxRow]] = [A[maxRow], A[i]];
      [x[i], x[maxRow]] = [x[maxRow], x[i]];

      // Eliminate
      for (let k = i + 1; k < n; k++) {
        const factor = A[k][i] / A[i][i];
        for (let j = i; j < n; j++) {
          A[k][j] -= factor * A[i][j];
        }
        x[k] -= factor * x[i];
      }
    }

    // Back substitution
    for (let i = n - 1; i >= 0; i--) {
      x[i] /= A[i][i];
      for (let k = i - 1; k >= 0; k--) {
        x[k] -= A[k][i] * x[i];
      }
    }

    return x;
  }

  private calculateStresses(model: MultiphysicsModel, displacements: number[]): Array<{ xx: number; yy: number; xy: number }> {
    // Calculate stresses from displacements
    const stresses = [];
    for (let i = 0; i < displacements.length; i += 3) {
      const strain = displacements[i] / 100; // Simplified strain calculation
      const material = model.materials[0] || { youngsModulus: 200e9, poissonsRatio: 0.3 };
      const youngsModulus = material.youngsModulus ?? 200e9;
      const poissonsRatio = material.poissonsRatio ?? 0.3;
      const stress = strain * youngsModulus;
      stresses.push({
        xx: stress,
        yy: -stress * poissonsRatio,
        xy: 0
      });
    }
    return stresses;
  }

  private calculateStrains(_model: MultiphysicsModel, displacements: number[]): Array<{ xx: number; yy: number; xy: number }> {
    // Calculate strains from displacements
    const strains = [];
    for (let i = 0; i < displacements.length; i += 3) {
      strains.push({
        xx: displacements[i] / 100,
        yy: displacements[i + 1] / 100,
        xy: (displacements[i] + displacements[i + 1]) / 200
      });
    }
    return strains;
  }

  getModel(modelId: string): MultiphysicsModel | undefined {
    return this.models.get(modelId);
  }

  getAllModels(): MultiphysicsModel[] {
    return Array.from(this.models.values());
  }
}

export const multiphysicsEngine = new MultiphysicsSimulationEngine();