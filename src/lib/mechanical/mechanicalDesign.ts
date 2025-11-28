import { Point, Size } from '../../types';

export interface MechanicalComponent {
  id: string;
  name: string;
  type: 'structural' | 'fastener' | 'bearing' | 'motor' | 'gear' | 'shaft' | 'enclosure' | 'sensor' | 'actuator' | 'connector';
  dimensions: Size;
  material: string;
  weight: number;
  position: Point;
  rotation: number;
  constraints: MechanicalConstraint[];
  thermalProperties?: {
    thermalConductivity: number;
    specificHeat: number;
    emissivity: number;
  };
  electricalProperties?: {
    resistance: number;
    capacitance: number;
    inductance: number;
  };
}

export interface MechanicalConstraint {
  type: 'distance' | 'angle' | 'coincident' | 'parallel' | 'perpendicular';
  components: string[];
  parameters: Record<string, number>;
}

export interface MechanicalAssembly {
  id: string;
  name: string;
  components: MechanicalComponent[];
  constraints: MechanicalConstraint[];
  metadata: {
    totalWeight: number;
    centerOfMass: Point;
    boundingBox: { min: Point; max: Point };
  };
}

export class MechanicalDesignEngine {
  private assemblies: Map<string, MechanicalAssembly> = new Map();

  createComponent(type: MechanicalComponent['type'], dimensions: Size, material: string): MechanicalComponent {
    return {
      id: `mech_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      name: `${type}_${Date.now()}`,
      type,
      dimensions,
      material,
      weight: this.calculateWeight(dimensions, material),
      position: { x: 0, y: 0 },
      rotation: 0,
      constraints: []
    };
  }

  private calculateWeight(dimensions: Size, material: string): number {
    const densities: Record<string, number> = {
      'steel': 7850,
      'aluminum': 2700,
      'plastic': 1200,
      'titanium': 4500,
      'copper': 8960,
      'brass': 8500,
      'ABS': 1050,
      'PLA': 1240,
      'nylon': 1150
    };
    const density = densities[material] || 1000;
    // More accurate volume calculation assuming thickness of 10mm for 2D components
    const volume = dimensions.width * dimensions.height * 0.01; // Convert to m³
    return volume * density; // Weight in kg
  }

  // Multi-physics analysis methods
  analyzeThermalBehavior(component: MechanicalComponent, ambientTemp: number, powerDissipation: number): {
    steadyStateTemp: number;
    thermalResistance: number;
    heatFlux: number;
    timeConstant: number;
  } {
    const thermalProps = component.thermalProperties || {
      thermalConductivity: 50, // W/m·K for aluminum
      specificHeat: 900, // J/kg·K
      emissivity: 0.9
    };

    const surfaceArea = 2 * (component.dimensions.width * component.dimensions.height +
                           component.dimensions.width * 0.01 +
                           component.dimensions.height * 0.01); // m²

    // Simplified thermal analysis
    const thermalResistance = 1 / (thermalProps.thermalConductivity * surfaceArea);
    const temperatureRise = powerDissipation * thermalResistance;

    return {
      steadyStateTemp: ambientTemp + temperatureRise,
      thermalResistance,
      heatFlux: powerDissipation / surfaceArea,
      timeConstant: (component.weight * thermalProps.specificHeat) / (thermalProps.thermalConductivity * surfaceArea)
    };
  }

  analyzeStructuralIntegrity(component: MechanicalComponent, loads: { force?: number; moment?: number }): {
    normalStress: number;
    bendingStress: number;
    totalStress: number;
    safetyFactor: number;
    deflection: number;
  } {
    const materialProps = this.getMaterialProperties(component.material);

    // Simplified stress analysis
    const area = component.dimensions.width * 0.01; // Cross-sectional area (m²)
    const momentOfInertia = (component.dimensions.width * Math.pow(0.01, 3)) / 12;

    const normalStress = loads.force ? loads.force / area : 0;
    const bendingStress = loads.moment ? (loads.moment * 0.005) / momentOfInertia : 0; // Max at edge

    const totalStress = normalStress + bendingStress;
    const yieldStrength = materialProps.yieldStrength || 250e6; // Default for steel
    const safetyFactor = yieldStrength / Math.abs(totalStress);

    return {
      normalStress,
      bendingStress,
      totalStress,
      safetyFactor,
      deflection: loads.force ? (loads.force * Math.pow(0.1, 3)) / (3 * materialProps.youngsModulus * momentOfInertia) : 0
    };
  }

  analyzeElectromagneticCompatibility(component: MechanicalComponent, frequency: number): {
    impedance: number;
    resonanceFrequency: number;
    skinDepth: number;
    shieldingEffectiveness: number;
    powerLoss: number;
  } {
    const electricalProps = component.electricalProperties || {
      resistance: 0.1,
      capacitance: 1e-9,
      inductance: 1e-6
    };

    // Calculate impedance at given frequency
    const angularFreq = 2 * Math.PI * frequency;
    const capacitiveReactance = 1 / (angularFreq * electricalProps.capacitance);
    const inductiveReactance = angularFreq * electricalProps.inductance;

    const totalImpedance = Math.sqrt(
      Math.pow(electricalProps.resistance, 2) +
      Math.pow(inductiveReactance - capacitiveReactance, 2)
    );

    // EMI analysis
    const skinDepth = Math.sqrt(2 * electricalProps.resistance / (angularFreq * 4 * Math.PI * 1e-7)); // Copper permeability
    const shieldingEffectiveness = 20 * Math.log10(component.dimensions.width / skinDepth);

    return {
      impedance: totalImpedance,
      resonanceFrequency: 1 / (2 * Math.PI * Math.sqrt(electricalProps.inductance * electricalProps.capacitance)),
      skinDepth,
      shieldingEffectiveness,
      powerLoss: Math.pow(electricalProps.resistance, 2) / totalImpedance
    };
  }

  private getMaterialProperties(material: string): {
    youngsModulus: number;
    yieldStrength: number;
    density: number;
  } {
    const properties: Record<string, { youngsModulus: number; yieldStrength: number; density: number }> = {
      'steel': { youngsModulus: 200e9, yieldStrength: 250e6, density: 7850 },
      'aluminum': { youngsModulus: 70e9, yieldStrength: 100e6, density: 2700 },
      'plastic': { youngsModulus: 2e9, yieldStrength: 50e6, density: 1200 },
      'titanium': { youngsModulus: 110e9, yieldStrength: 400e6, density: 4500 },
      'copper': { youngsModulus: 120e9, yieldStrength: 70e6, density: 8960 }
    };
    return properties[material] || properties['steel'];
  }

  createAssembly(name: string): MechanicalAssembly {
    const assembly: MechanicalAssembly = {
      id: `assembly_${Date.now()}`,
      name,
      components: [],
      constraints: [],
      metadata: {
        totalWeight: 0,
        centerOfMass: { x: 0, y: 0 },
        boundingBox: { min: { x: 0, y: 0 }, max: { x: 0, y: 0 } }
      }
    };
    this.assemblies.set(assembly.id, assembly);
    return assembly;
  }

  addComponentToAssembly(assemblyId: string, component: MechanicalComponent): void {
    const assembly = this.assemblies.get(assemblyId);
    if (assembly) {
      assembly.components.push(component);
      this.updateAssemblyMetadata(assembly);
    }
  }

  addConstraint(assemblyId: string, constraint: MechanicalConstraint): void {
    const assembly = this.assemblies.get(assemblyId);
    if (assembly) {
      assembly.constraints.push(constraint);
      this.validateConstraints(assembly);
    }
  }

  private updateAssemblyMetadata(assembly: MechanicalAssembly): void {
    let totalWeight = 0;
    let centerX = 0, centerY = 0;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    assembly.components.forEach(comp => {
      totalWeight += comp.weight;
      centerX += comp.position.x * comp.weight;
      centerY += comp.position.y * comp.weight;

      minX = Math.min(minX, comp.position.x - comp.dimensions.width / 2);
      minY = Math.min(minY, comp.position.y - comp.dimensions.height / 2);
      maxX = Math.max(maxX, comp.position.x + comp.dimensions.width / 2);
      maxY = Math.max(maxY, comp.position.y + comp.dimensions.height / 2);
    });

    assembly.metadata.totalWeight = totalWeight;
    assembly.metadata.centerOfMass = {
      x: totalWeight > 0 ? centerX / totalWeight : 0,
      y: totalWeight > 0 ? centerY / totalWeight : 0
    };
    assembly.metadata.boundingBox = {
      min: { x: minX, y: minY },
      max: { x: maxX, y: maxY }
    };
  }

  private validateConstraints(assembly: MechanicalAssembly): boolean {
    // Basic constraint validation
    for (const constraint of assembly.constraints) {
      if (constraint.type === 'distance') {
        // Check if components are at specified distance
        const comp1 = assembly.components.find(c => c.id === constraint.components[0]);
        const comp2 = assembly.components.find(c => c.id === constraint.components[1]);
        if (comp1 && comp2) {
          const dx = comp1.position.x - comp2.position.x;
          const dy = comp1.position.y - comp2.position.y;
          const distance = Math.sqrt(dx * dx + dy * dy);
          const targetDistance = constraint.parameters.distance || 0;
          if (Math.abs(distance - targetDistance) > 1) {
            console.warn(`Constraint violation: distance between ${comp1.name} and ${comp2.name}`);
            return false;
          }
        }
      }
    }
    return true;
  }

  exportToSTEP(assemblyId: string): string {
    const assembly = this.assemblies.get(assemblyId);
    if (!assembly) return '';

    let stepContent = 'ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION((\'Mechanical Assembly\'), \'2;1\');\nENDSEC;\nDATA;\n';

    assembly.components.forEach((comp, index) => {
      stepContent += `#${index + 1}=PRODUCT('${comp.name}','${comp.name}','',(#${index + 2}));\n`;
      stepContent += `#${index + 2}=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('design','',#${index + 1},.NOT_KNOWN.);\n`;
      // Add geometric representation (simplified)
      stepContent += `#${index + 3}=CARTESIAN_POINT('origin',(${comp.position.x},${comp.position.y},0));\n`;
      stepContent += `#${index + 4}=DIRECTION('z_dir',(0,0,1));\n`;
      stepContent += `#${index + 5}=AXIS2_PLACEMENT_3D('placement',#${index + 3},#${index + 4},$);\n`;
      stepContent += `#${index + 6}=BLOCK('block',#${index + 5},${comp.dimensions.width},${comp.dimensions.height},10);\n`;
    });

    stepContent += 'ENDSEC;\nEND-ISO-10303-21;\n';
    return stepContent;
  }

  exportToSTL(assemblyId: string): string {
    const assembly = this.assemblies.get(assemblyId);
    if (!assembly) return '';

    let stlContent = 'solid mechanical_assembly\n';

    assembly.components.forEach((comp) => {
      // Generate triangular mesh for each component (simplified box)
      const triangles = this.generateBoxTriangles(comp);
      stlContent += triangles;
    });

    stlContent += 'endsolid mechanical_assembly\n';
    return stlContent;
  }

  private generateBoxTriangles(comp: MechanicalComponent): string {
    const w = comp.dimensions.width / 2;
    const h = comp.dimensions.height / 2;
    const d = 5; // Default depth

    const vertices = [
      [-w, -h, -d], [w, -h, -d], [w, h, -d], [-w, h, -d], // Bottom
      [-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]     // Top
    ];

    const faces = [
      [0, 1, 2], [0, 2, 3], // Bottom
      [4, 5, 6], [4, 6, 7], // Top
      [0, 1, 5], [0, 5, 4], // Front
      [1, 2, 6], [1, 6, 5], // Right
      [2, 3, 7], [2, 7, 6], // Back
      [3, 0, 4], [3, 4, 7]  // Left
    ];

    let triangles = '';
    faces.forEach(face => {
      const normal = this.calculateNormal(vertices[face[0]], vertices[face[1]], vertices[face[2]]);
      triangles += `  facet normal ${normal[0]} ${normal[1]} ${normal[2]}\n`;
      triangles += '    outer loop\n';
      face.forEach(vertexIndex => {
        const v = vertices[vertexIndex];
        triangles += `      vertex ${v[0]} ${v[1]} ${v[2]}\n`;
      });
      triangles += '    endloop\n';
      triangles += '  endfacet\n';
    });

    return triangles;
  }

  private calculateNormal(v1: number[], v2: number[], v3: number[]): number[] {
    const u = [v2[0] - v1[0], v2[1] - v1[1], v2[2] - v1[2]];
    const v = [v3[0] - v1[0], v3[1] - v1[1], v3[2] - v1[2]];
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ];
    const length = Math.sqrt(normal[0] * normal[0] + normal[1] * normal[1] + normal[2] * normal[2]);
    return [normal[0] / length, normal[1] / length, normal[2] / length];
  }

  getAssembly(assemblyId: string): MechanicalAssembly | undefined {
    return this.assemblies.get(assemblyId);
  }

  getAllAssemblies(): MechanicalAssembly[] {
    return Array.from(this.assemblies.values());
  }
}

export const mechanicalDesignEngine = new MechanicalDesignEngine();