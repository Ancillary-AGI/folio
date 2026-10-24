import { describe, expect, it } from 'vitest';
import { MechanicalDesignEngine } from './mechanicalDesign';

function buildAssembly() {
  const engine = new MechanicalDesignEngine();
  const assembly = engine.createAssembly('test-assembly');
  const beam = engine.createComponent('structural', { width: 2, height: 0.1 }, 'aluminum', 0.1);
  beam.position = { x: 1, y: 2 };
  beam.rotation = Math.PI / 2;
  const plate = engine.createComponent('enclosure', { width: 0.5, height: 0.5 }, 'abs', 0.02);
  plate.position = { x: -1, y: 0 };
  engine.addComponentToAssembly(assembly.id, beam);
  engine.addComponentToAssembly(assembly.id, plate);
  return { engine, assembly, beam, plate };
}

describe('MechanicalDesignEngine', () => {
  it('weighs components from the shared material catalogue and real thickness', () => {
    const { beam, plate } = buildAssembly();
    // 2 m × 0.1 m × 0.1 m aluminium at 2700 kg/m³
    expect(beam.weight).toBeCloseTo(54, 6);
    // 0.5 m × 0.5 m × 0.02 m ABS at 1050 kg/m³
    expect(plate.weight).toBeCloseTo(5.25, 6);
  });

  it('rejects an unknown material instead of silently weighing it as steel', () => {
    const engine = new MechanicalDesignEngine();
    expect(() => engine.createComponent('structural', { width: 1, height: 1 }, 'unobtainium', 0.01))
      .toThrow(/Unknown material/);
  });

  it('rejects non-positive or non-finite plate dimensions', () => {
    const engine = new MechanicalDesignEngine();
    expect(() => engine.createComponent('structural', { width: 0, height: 1 }, 'aluminum', 0.01))
      .toThrow(/dimensions must be positive/);
    expect(() => engine.createComponent('structural', { width: Number.NaN, height: 1 }, 'aluminum', 0.01))
      .toThrow(/dimensions must be positive/);
  });

  it('measures the assembly bounds of rotated parts', () => {
    const engine = new MechanicalDesignEngine();
    const assembly = engine.createAssembly('rotated');
    const beam = engine.createComponent('structural', { width: 2, height: 0.5 }, 'aluminum', 0.1);
    beam.rotation = Math.PI / 2;
    engine.addComponentToAssembly(assembly.id, beam);

    expect(assembly.metadata.boundingBox.min.x).toBeCloseTo(-0.25, 9);
    expect(assembly.metadata.boundingBox.max.x).toBeCloseTo(0.25, 9);
    expect(assembly.metadata.boundingBox.min.y).toBeCloseTo(-1, 9);
    expect(assembly.metadata.boundingBox.max.y).toBeCloseTo(1, 9);
  });

  it('defaults structural analysis to the part thickness, not a fixed 10 mm', () => {
    const { engine, plate } = buildAssembly();
    const implicit = engine.analyzeStructuralIntegrity(plate, { moment: 10 });
    const explicit = engine.analyzeStructuralIntegrity(plate, { moment: 10 }, plate.thickness);
    const wrongThickness = engine.analyzeStructuralIntegrity(plate, { moment: 10 }, 0.01);

    expect(implicit).toEqual(explicit);
    expect(implicit.deflection).not.toBeCloseTo(wrongThickness.deflection, 12);
  });

  it('writes a STEP assembly as one closed shell per component at the stored size', () => {
    const { engine, assembly } = buildAssembly();
    const step = engine.exportToSTEP(assembly.id);
    expect(step.startsWith('ISO-10303-21;')).toBe(true);
    expect(step).toContain("FILE_SCHEMA(('AUTOMOTIVE_DESIGN'))");
    expect(step.match(/=CLOSED_SHELL\(/g)).toHaveLength(2);
    expect(step.match(/=MANIFOLD_SOLID_BREP\(/g)).toHaveLength(2);
    expect(step).toContain("MANIFOLD_SOLID_BREP('structural_1'");
    expect(step).toContain("MANIFOLD_SOLID_BREP('enclosure_2'");

    const points = [...step.matchAll(/CARTESIAN_POINT\('',\(([^)]*)\)\)/g)]
      .map(match => match[1].split(',').map(Number));
    const ys = points.map(point => point[1]);
    const zs = points.map(point => point[2]);
    // Rotated 2 m × 0.1 m beam at (1, 2) spans y ∈ [1, 3].
    expect(Math.max(...ys)).toBeCloseTo(3, 4);
    // Plate spans y ∈ [-0.25, 0.25].
    expect(Math.min(...ys)).toBeCloseTo(-0.25, 4);
    // Extrusion thickness ±0.05 m.
    expect(Math.min(...zs)).toBeCloseTo(-0.05, 4);
    expect(Math.max(...zs)).toBeCloseTo(0.05, 4);
  });

  it('exports STL geometry at the real position, rotation and thickness', () => {
    const { engine, assembly } = buildAssembly();
    const stl = engine.exportToSTL(assembly.id);
    const vertices = [...stl.matchAll(/vertex\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)\s+(-?[\d.eE+]+)/g)]
      .map((match) => [Number(match[1]), Number(match[2]), Number(match[3])] as const);
    expect(vertices).toHaveLength(72); // 2 boxes × 12 triangles × 3 vertices
    const xs = vertices.map((v) => v[0]);
    const ys = vertices.map((v) => v[1]);
    const zs = vertices.map((v) => v[2]);
    // Plate spans x ∈ [-1.25, -0.75], y ∈ [-0.25, 0.25].
    expect(Math.min(...xs)).toBeCloseTo(-1.25, 6);
    // Rotated 2 m beam spans y ∈ [1, 3]; its thickness sets the z extent.
    expect(Math.max(...ys)).toBeCloseTo(3, 6);
    expect(Math.min(...ys)).toBeCloseTo(-0.25, 6);
    expect(Math.min(...zs)).toBeCloseTo(-0.05, 6);
    expect(Math.max(...zs)).toBeCloseTo(0.05, 6);
  });

  it('winds every STL facet so its normal points out of the solid', () => {
    const { engine, assembly } = buildAssembly();
    const stl = engine.exportToSTL(assembly.id);
    const facets = stl.split('facet normal ').slice(1);
    expect(facets).toHaveLength(24);
    const centers = [
      [1, 2, 0],
      [-1, 0, 0],
    ];

    for (const facet of facets) {
      const values = [...facet.matchAll(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi)].map((match) => Number(match[0]));
      const [nx, ny, nz, ...coords] = values;
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 5);

      const centroid = [0, 1, 2].map((axis) =>
        (coords[axis] + coords[axis + 3] + coords[axis + 6]) / 3,
      );
      const center = centers.reduce((best, candidate) => {
        const distance = (axis: number) => (centroid[axis] - candidate[axis]) ** 2;
        const bestDistance = (axis: number) => (centroid[axis] - best[axis]) ** 2;
        return distance(0) + distance(1) + distance(2) < bestDistance(0) + bestDistance(1) + bestDistance(2)
          ? candidate
          : best;
      });
      const outward =
        nx * (centroid[0] - center[0]) + ny * (centroid[1] - center[1]) + nz * (centroid[2] - center[2]);
      expect(outward).toBeGreaterThan(0);
    }
  });

  it('reports skin depth only when the part declares a conductivity', () => {
    const engine = new MechanicalDesignEngine();
    const component = engine.createComponent('enclosure', { width: 0.2, height: 0.2 }, 'copper', 0.002);
    const bare = engine.analyzeElectromagneticCompatibility(component, 1e6);
    expect(bare.skinDepth).toBeNull();
    expect(bare.shieldingEffectiveness).toBeNull();
    expect(bare.powerLoss).toBeGreaterThan(0);

    component.electricalProperties = {
      resistance: 0.01,
      capacitance: 1e-9,
      inductance: 1e-7,
      conductivity: 5.8e7,
    };
    const shielded = engine.analyzeElectromagneticCompatibility(component, 1e6);
    expect(shielded.skinDepth).toBeCloseTo(0.0000661, 6);
    expect(shielded.shieldingEffectiveness).toBeGreaterThan(0);
  });
});
