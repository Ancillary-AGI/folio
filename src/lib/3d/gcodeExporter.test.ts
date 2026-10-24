import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { GCodeExporter, type GCodeConfig, type GCodeMeshData } from './gcodeExporter';
import type { ThreeDModel } from './threeManager';

/** Watertight axis-aligned box in printer coordinates. */
function boxMesh(minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): GCodeMeshData {
  const vertices = [
    [minX, minY, minZ], [maxX, minY, minZ], [maxX, maxY, minZ], [minX, maxY, minZ],
    [minX, minY, maxZ], [maxX, minY, maxZ], [maxX, maxY, maxZ], [minX, maxY, maxZ],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],
    [4, 5, 6], [4, 6, 7],
    [0, 1, 5], [0, 5, 4],
    [1, 2, 6], [1, 6, 5],
    [2, 3, 7], [2, 7, 6],
    [3, 0, 4], [3, 4, 7],
  ];
  return { vertices, faces };
}

/** Watertight rectangular tube: outer wall, inner wall and two ring caps. */
function tubeMesh(size = 20, hole = 10, height = 5): GCodeMeshData {
  const outer = size / 2;
  const inner = hole / 2;
  const vertices = [
    [-outer, -outer, 0], [outer, -outer, 0], [outer, outer, 0], [-outer, outer, 0],
    [-outer, -outer, height], [outer, -outer, height], [outer, outer, height], [-outer, outer, height],
    [-inner, -inner, 0], [inner, -inner, 0], [inner, inner, 0], [-inner, inner, 0],
    [-inner, -inner, height], [inner, -inner, height], [inner, inner, height], [-inner, inner, height],
  ];
  const faces: number[][] = [];
  for (let i = 0; i < 4; i += 1) {
    const j = (i + 1) % 4;
    faces.push([i, j, j + 4], [i, j + 4, i + 4]); // outer wall
    faces.push([i + 8, i + 12, j + 12], [i + 8, j + 12, j + 8]); // inner wall
    faces.push([i + 4, j + 4, j + 12], [i + 4, j + 12, i + 12]); // top ring
    faces.push([i, i + 8, j + 8], [i, j + 8, j]); // bottom ring
  }
  return { vertices, faces };
}

function contourArea(points: Array<{ x: number; y: number }>): number {
  let area = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

const printerBox = (overrides: Partial<GCodeConfig> = {}) =>
  new GCodeExporter({
    upAxis: 'z',
    raft: false,
    skirt: false,
    brim: 0,
    infill: 20,
    retractionDistance: 0,
    ...overrides,
  });

describe('GCodeExporter slicing', () => {
  it('cuts a solid cube into closed layer contours at the requested pitch', () => {
    const exporter = printerBox();
    const layers = exporter.sliceMesh(boxMesh(0, 0, 0, 20, 20, 10));

    expect(layers).toHaveLength(50);
    expect(layers[0].z).toBeCloseTo(0.1, 9);
    expect(layers[49].z).toBeCloseTo(9.9, 9);
    layers.forEach((layer) => {
      expect(layer.contours).toHaveLength(1);
      expect(layer.contours[0]).toHaveLength(4);
      expect(contourArea(layer.contours[0])).toBeCloseTo(400, 6);
    });
  });

  it('generates infill inside the section and prints shell layers solid', () => {
    const exporter = printerBox();
    const layers = exporter.sliceMesh(boxMesh(0, 0, 0, 20, 20, 10));

    const shell = layers[0];
    const sparse = layers[30];
    expect(shell.infill.length).toBeGreaterThan(sparse.infill.length * 3);

    sparse.infill.forEach((line) => {
      line.forEach((point) => {
        expect(point.x).toBeGreaterThanOrEqual(-1e-9);
        expect(point.x).toBeLessThanOrEqual(20 + 1e-9);
        expect(point.y).toBeGreaterThanOrEqual(-1e-9);
        expect(point.y).toBeLessThanOrEqual(20 + 1e-9);
      });
    });
  });

  it('uses the even-odd rule to leave holes empty and orient them opposite the shell', () => {
    const exporter = printerBox({ infill: 40 });
    const layers = exporter.sliceMesh(tubeMesh());
    const mid = layers[Math.floor(layers.length / 2)];

    expect(mid.contours).toHaveLength(2);
    const areas = mid.contours.map(contourArea);
    expect(Math.max(...areas)).toBeCloseTo(400, 6);
    expect(Math.min(...areas)).toBeCloseTo(-100, 6);

    expect(mid.infill.length).toBeGreaterThan(0);
    mid.infill.forEach((line) => {
      const midpoint = { x: (line[0].x + line[1].x) / 2, y: (line[0].y + line[1].y) / 2 };
      const insideHole = Math.abs(midpoint.x) < 5 && Math.abs(midpoint.y) < 5;
      expect(insideHole).toBe(false);
    });
  });

  it('emits relative extrusion at the correct filament rate', () => {
    const exporter = printerBox({ upAxis: 'y', infill: 0, solidLayers: 0 });
    const gcode = exporter.exportToGCode({ models: [] });
    expect(gcode).toContain('M83');

    // Slice a cube and generate through a single-mesh scene.
    const geometry = new THREE.BoxGeometry(20, 10, 20);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const model: ThreeDModel = {
      id: 'cube',
      name: 'cube',
      geometry,
      material,
      mesh,
      position: { x: 10, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const sliced = exporter.sliceScene({ models: [model] });
    expect(sliced).toHaveLength(50);
    const output = exporter.exportToGCode({ models: [model] });

    expect(output).toContain('M83');
    expect(output).not.toContain('M82');
    expect(output).toContain('; Layer 0 at Z=0.100 mm');

    let lastTravel = { x: 0, y: 0 };
    let firstMove: { x: number; y: number; e: number } | null = null;
    for (const line of output.split('\n')) {
      const travel = line.match(/^G0 X([\d.-]+) Y([\d.-]+)/);
      if (travel) {
        lastTravel = { x: Number(travel[1]), y: Number(travel[2]) };
        continue;
      }
      const extrusion = line.match(/^G1 X([\d.-]+) Y([\d.-]+) E([\d.]+)/);
      if (extrusion) {
        firstMove = { x: Number(extrusion[1]), y: Number(extrusion[2]), e: Number(extrusion[3]) };
        break;
      }
    }
    expect(firstMove).not.toBeNull();
    const length = Math.hypot(lastTravel.x - firstMove!.x, lastTravel.y - firstMove!.y);
    expect(length).toBeGreaterThan(0);
    const expected = (0.45 * 0.2) / (Math.PI * (1.75 / 2) ** 2);
    expect(firstMove!.e / length).toBeCloseTo(expected, 4);
  });

  it('builds raft, brim and skirt from the model footprint', () => {
    const exporter = printerBox({
      upAxis: 'y',
      raft: true,
      raftLayers: 2,
      brim: 2,
      skirt: true,
      skirtLoops: 1,
      skirtGap: 5,
    });
    const gcode = exporter.exportToGCode({ models: [] });
    const zUp = new GCodeExporter({ upAxis: 'z', raft: false, retractionDistance: 0 });
    expect(zUp.sliceMesh(boxMesh(100, 50, 0, 110, 60, 4))).toHaveLength(20);

    // Single-mesh path keeps the same scene code path.
    const geometry = new THREE.BoxGeometry(10, 4, 10);
    const material = new THREE.MeshBasicMaterial();
    const mesh = new THREE.Mesh(geometry, material);
    const model: ThreeDModel = {
      id: 'offset',
      name: 'offset',
      geometry,
      material,
      mesh,
      position: { x: 105, y: 2, z: 55 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    };
    const output = exporter.exportToGCode({ models: [model] });

    // Footprint: X 100..110, Y 50..60. Raft adds 3 mm, brim 0.45 mm,
    // skirt gap 5 mm. None of the old hard-coded 10/90 coordinates.
    expect(output).toContain('G0 X97.000 Y47.000');
    expect(output).toContain('G0 X99.550 Y49.550');
    expect(output).toContain('G0 X95.000 Y45.000');
    expect(output).not.toContain('G0 X10 Y10');
    expect(gcode).toContain('No closed contours');
  });

  it('maps Y-up Three.js models to the printer Z axis', () => {
    const yUp = new GCodeExporter({ upAxis: 'y', layerHeight: 0.2, raft: false, retractionDistance: 0 });
    const cube: GCodeMeshData = {
      vertices: [
        [0, 0, 0], [20, 0, 0], [20, 0, 20], [0, 0, 20],
        [0, 10, 0], [20, 10, 0], [20, 10, 20], [0, 10, 20],
      ],
      faces: [
        [0, 2, 1], [0, 3, 2],
        [4, 5, 6], [4, 6, 7],
        [0, 1, 5], [0, 5, 4],
        [1, 2, 6], [1, 6, 5],
        [2, 3, 7], [2, 7, 6],
        [3, 0, 4], [3, 4, 7],
      ],
    };
    const layers = yUp.sliceMesh(cube);
    expect(layers).toHaveLength(50);
    expect(layers[0].contours[0]).toHaveLength(4);
    expect(contourArea(layers[0].contours[0])).toBeCloseTo(400, 6);
  });

  it('warns instead of inventing contours for an open mesh', () => {
    const exporter = printerBox();
    const triangle: GCodeMeshData = {
      vertices: [[0, 0, 0], [10, 0, 5], [0, 10, 10]],
      faces: [[0, 1, 2]],
    };
    const gcode = exporter.exportToGCode({ models: [] });
    expect(gcode).toContain('No closed contours');

    const layers = exporter.sliceMesh(triangle);
    expect(layers.every((layer) => layer.contours.length === 0)).toBe(true);
  });

  it('rejects malformed meshes and unsupported machine modes', () => {
    const exporter = printerBox();
    expect(() =>
      exporter.sliceMesh({ vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 4]] }),
    ).toThrow(/valid vertex indices/);
    expect(() =>
      exporter.sliceMesh({ vertices: [[0, 0, 0], [1, Number.NaN, 0], [0, 1, 0]], faces: [[0, 1, 2]] }),
    ).toThrow(/finite coordinates/);

    const mesh = boxMesh(0, 0, 0, 10, 10, 10);
    expect(() =>
      exporter.generateGCode(mesh, {
        printerType: 'SLA',
        layerHeight: 0.05,
        nozzleTemp: 0,
        bedTemp: 0,
        printSpeed: 50,
        infillDensity: 0,
      }),
    ).toThrow(/FDM only/);

    const withSupport = printerBox({ support: true });
    expect(() => withSupport.sliceMesh(mesh)).not.toThrow();
    expect(() => withSupport.exportToGCode({ models: [] })).toThrow(/Support generation/);
  });

  it('slices deterministically', () => {
    const exporter = printerBox();
    const mesh = boxMesh(0, 0, 0, 12, 9, 6);
    expect(exporter.sliceMesh(mesh)).toEqual(exporter.sliceMesh(mesh));
  });
});
