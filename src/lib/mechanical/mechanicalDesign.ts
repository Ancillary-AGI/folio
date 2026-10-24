import { Point, Size } from '../../types';
import {
  analyseBeam,
  analyseConduction,
  analyseEmc,
  type ElectricalProperties,
} from './mechanicalAnalysis';
import { getMaterial, requireMaterial } from './materials';
import { boxFaces, stepAssemblyDocument } from '../manufacturing/stepGeometry';

export interface MechanicalComponent {
  id: string;
  name: string;
  type: 'structural' | 'fastener' | 'bearing' | 'motor' | 'gear' | 'shaft' | 'enclosure' | 'sensor' | 'actuator' | 'connector';
  dimensions: Size;
  /** Extrusion thickness, metres. Drives weight and every export solid. */
  thickness: number;
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
  electricalProperties?: ElectricalProperties;
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
  private idSeq = 0;

  createComponent(
    type: MechanicalComponent['type'],
    dimensions: Size,
    material: string,
    thickness: number,
  ): MechanicalComponent {
    if (!Number.isFinite(thickness) || thickness <= 0) {
      throw new Error(`thickness must be a positive finite number, got ${thickness}.`);
    }
    if (!Number.isFinite(dimensions.width) || dimensions.width <= 0 ||
      !Number.isFinite(dimensions.height) || dimensions.height <= 0) {
      throw new Error(
        `component dimensions must be positive and finite, got ${dimensions.width} × ${dimensions.height}.`,
      );
    }
    this.idSeq += 1;
    return {
      id: `mech_${Date.now()}_${this.idSeq}`,
      name: `${type}_${this.idSeq}`,
      type,
      dimensions,
      thickness,
      material,
      weight: this.calculateWeight(dimensions, thickness, material),
      position: { x: 0, y: 0 },
      rotation: 0,
      constraints: []
    };
  }

  private calculateWeight(dimensions: Size, thickness: number, material: string): number {
    // `Size` carries only width and height, so the extrusion thickness is an
    // explicit argument validated by `createComponent`. Guessing 10 mm here
    // silently mis-weighed every part whose real thickness differs.
    const density = requireMaterial(material).density;
    // Caller guarantees SI metres throughout; no unit conversion here.
    const volume = dimensions.width * dimensions.height * thickness;
    return volume * density; // Weight in kg
  }

  // Multi-physics analysis methods
  /**
   * Steady-state and transient thermal behaviour of a part.
   *
   * `Size` carries only width and height, so the thickness heat must cross is not part
   * of the stored geometry: it is an explicit argument, and when omitted a documented
   * 10 mm default is used. Everything else comes from the real dimensions, and the
   * maths is the `L/(kA)` conduction path in `mechanicalAnalysis` — the previous
   * `1/(kA)` form had no thickness term at all, so it could not respond to one.
   */
  analyzeThermalBehavior(
    component: MechanicalComponent,
    ambientTemp: number,
    powerDissipation: number,
    thickness: number,
  ): {
    steadyStateTemp: number;
    thermalResistance: number;
    heatFlux: number;
    timeConstant: number;
  } {
    const thermalProps = component.thermalProperties;
    if (!thermalProps) {
      throw new Error(
        `Component "${component.id}" has no thermalProperties. ` +
        `Provide { thermalConductivity, specificHeat, emissivity } — guessing aluminium values would silently mis-analyse every other material.`,
      );
    }

    return analyseConduction(
      {
        width: component.dimensions.width,
        height: component.dimensions.height,
        depth: thickness,
      },
      { thermalConductivity: thermalProps.thermalConductivity, specificHeat: thermalProps.specificHeat },
      component.weight,
      ambientTemp,
      powerDissipation,
    );
  }

  /**
   * Axial and bending integrity of a part under load.
   *
   * The bending axis is the part's height and the section is width × thickness, both
   * taken from the arguments rather than the fixed 10 mm and 5 mm the previous version
   * assumed. `force` is axial: it contributes stress but not transverse deflection.
   * `safetyFactor` is `null` when nothing is loaded instead of `Infinity`.
   */
  analyzeStructuralIntegrity(
    component: MechanicalComponent,
    loads: { force?: number; moment?: number },
    thickness = component.thickness,
  ): {
    normalStress: number;
    bendingStress: number;
    totalStress: number;
    safetyFactor: number | null;
    deflection: number;
  } {
    const materialProps = this.getMaterialProperties(component.material);
    const result = analyseBeam(
      {
        width: component.dimensions.width,
        height: component.dimensions.height,
        depth: thickness,
      },
      {
        youngsModulus: materialProps.youngsModulus,
        yieldStrength: materialProps.yieldStrength,
        density: materialProps.density,
      },
      loads,
    );

    return {
      // `normalStress` is the long-standing name for the axial term.
      normalStress: result.axialStress,
      bendingStress: result.bendingStress,
      totalStress: result.totalStress,
      safetyFactor: result.safetyFactor,
      deflection: result.deflection,
    };
  }

  /**
   * Lumped impedance and EMI metrics at one frequency.
   *
   * Delegates to the tested `analyseEmc`: `R + jωL − j/(ωC)`, resonance
   * `1/(2π√(LC))`, and skin depth from the material conductivity. `skinDepth`
   * and shielding are `null` when the part does not declare a conductivity —
   * a fabricated copper value for a plastic bracket would be meaningless.
   * Power loss assumes a 1 V excitation across the lumped model.
   */
  analyzeElectromagneticCompatibility(component: MechanicalComponent, frequency: number): {
    impedance: number;
    resonanceFrequency: number;
    skinDepth: number | null;
    shieldingEffectiveness: number | null;
    powerLoss: number;
  } {
    const electricalProps = component.electricalProperties ?? {
      resistance: 0.1,
      capacitance: 1e-9,
      inductance: 1e-6,
    };
    const emc = analyseEmc(electricalProps, frequency, component.thickness);
    return {
      impedance: emc.impedance,
      resonanceFrequency: emc.resonanceFrequency,
      skinDepth: emc.skinDepth,
      shieldingEffectiveness: emc.shieldingEffectiveness,
      powerLoss: (1 / emc.impedance ** 2) * electricalProps.resistance,
    };
  }

  private getMaterialProperties(material: string): {
    youngsModulus: number;
    yieldStrength: number;
    density: number;
  } {
    const { youngsModulus, yieldStrength, density } = getMaterial(material);
    return { youngsModulus, yieldStrength, density };
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

      // The assembly box must contain the rotated part, not the unrotated
      // footprint: a 2 m beam turned 90° reaches along y, not x.
      const halfWidth = Math.abs((comp.dimensions.width / 2) * Math.cos(comp.rotation)) +
        Math.abs((comp.dimensions.height / 2) * Math.sin(comp.rotation));
      const halfHeight = Math.abs((comp.dimensions.width / 2) * Math.sin(comp.rotation)) +
        Math.abs((comp.dimensions.height / 2) * Math.cos(comp.rotation));
      minX = Math.min(minX, comp.position.x - halfWidth);
      minY = Math.min(minY, comp.position.y - halfHeight);
      maxX = Math.max(maxX, comp.position.x + halfWidth);
      maxY = Math.max(maxY, comp.position.y + halfHeight);
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

  /**
   * AP214 STEP assembly: one faceted closed shell per component, positioned and
   * rotated in assembly coordinates. Emitted through the shared
   * `stepGeometry` writer so the dialect matches the enclosure and mechanism
   * exporters. Coordinates stay in this engine's metres; the writer emits no
   * unit context, so downstream tools must not assume millimetres.
   */
  exportToSTEP(assemblyId: string): string {
    const assembly = this.assemblies.get(assemblyId);
    if (!assembly) return '';

    const solids = assembly.components.map(comp => {
      const halfWidth = comp.dimensions.width / 2;
      const halfHeight = comp.dimensions.height / 2;
      const halfThickness = comp.thickness / 2;
      const cos = Math.cos(comp.rotation);
      const sin = Math.sin(comp.rotation);
      const faces = boxFaces(
        -halfWidth, -halfHeight, -halfThickness,
        halfWidth, halfHeight, halfThickness,
      ).map(face => face.map(([x, y, z]) => [
        comp.position.x + x * cos - y * sin,
        comp.position.y + x * sin + y * cos,
        z,
      ]));
      return { name: comp.name, faces };
    });

    return stepAssemblyDocument(solids, 'folio-mechanical-assembly');
  }

  exportToSTL(assemblyId: string): string {
    const assembly = this.assemblies.get(assemblyId);
    if (!assembly) return '';

    let stlContent = 'solid mechanical_assembly\n';

    assembly.components.forEach((comp) => {
      stlContent += this.generateBoxTriangles(comp);
    });

    stlContent += 'endsolid mechanical_assembly\n';
    return stlContent;
  }

  /** Box mesh in assembly coordinates: real thickness, rotation and position. */
  private generateBoxTriangles(comp: MechanicalComponent): string {
    const w = comp.dimensions.width / 2;
    const h = comp.dimensions.height / 2;
    const d = comp.thickness / 2;
    const cos = Math.cos(comp.rotation);
    const sin = Math.sin(comp.rotation);
    const place = (x: number, y: number, z: number): number[] => [
      comp.position.x + x * cos - y * sin,
      comp.position.y + x * sin + y * cos,
      z,
    ];

    const vertices = [
      [-w, -h, -d], [w, -h, -d], [w, h, -d], [-w, h, -d], // Bottom
      [-w, -h, d], [w, -h, d], [w, h, d], [-w, h, d]     // Top
    ].map(([x, y, z]) => place(x, y, z));

    const faces = [
      [0, 2, 1], [0, 3, 2], // Bottom (wound so the normal points −z)
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