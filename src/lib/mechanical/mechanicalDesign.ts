import { Point, Size } from '../../types';

export interface MechanicalComponent {
  id: string;
  name: string;
  type: 'structural' | 'fastener' | 'bearing' | 'motor' | 'gear' | 'shaft' | 'enclosure';
  dimensions: Size;
  material: string;
  weight: number;
  position: Point;
  rotation: number;
  constraints: MechanicalConstraint[];
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
      'titanium': 4500
    };
    const density = densities[material] || 1000;
    return (dimensions.width * dimensions.height * 10) * density / 1000000; // Rough calculation
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
      stepContent += `#${index + 1}=PRODUCT(\'${comp.name}\',\'${comp.name}\',\'\',(#${index + 2}));\n`;
      stepContent += `#${index + 2}=PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE(\'design\',\'\',#${index + 1},.NOT_KNOWN.);\n`;
      // Add geometric representation (simplified)
      stepContent += `#${index + 3}=CARTESIAN_POINT(\'origin\',(${comp.position.x},${comp.position.y},0));\n`;
      stepContent += `#${index + 4}=DIRECTION(\'z_dir\',(0,0,1));\n`;
      stepContent += `#${index + 5}=AXIS2_PLACEMENT_3D(\'placement\',#${index + 3},#${index + 4},$);\n`;
      stepContent += `#${index + 6}=BLOCK(\'block\',#${index + 5},${comp.dimensions.width},${comp.dimensions.height},10);\n`;
    });

    stepContent += 'ENDSEC;\nEND-ISO-10303-21;\n';
    return stepContent;
  }

  getAssembly(assemblyId: string): MechanicalAssembly | undefined {
    return this.assemblies.get(assemblyId);
  }

  getAllAssemblies(): MechanicalAssembly[] {
    return Array.from(this.assemblies.values());
  }
}

export const mechanicalDesignEngine = new MechanicalDesignEngine();