/**
 * Export-path tests for ThreeManager.
 *
 * These pin the behaviours the old inline writers got wrong: world transforms
 * (rotation included) are baked into exported vertices, indexed geometry keeps
 * its real topology, and per-object face offsets stay correct across models.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { ThreeManager, type ThreeDModel, type ThreeDScene } from './threeManager';

interface Transform {
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: { x: number; y: number; z: number };
}

function makeModel(
  manager: ThreeManager,
  name: string,
  geometry: THREE.BufferGeometry,
  transform: Transform = {},
): ThreeDModel {
  const material = new THREE.MeshBasicMaterial();
  const mesh = new THREE.Mesh(geometry, material);
  const model: ThreeDModel = {
    id: `model_${name}`,
    name,
    geometry,
    material,
    mesh,
    position: transform.position ?? { x: 0, y: 0, z: 0 },
    rotation: transform.rotation ?? { x: 0, y: 0, z: 0 },
    scale: transform.scale ?? { x: 1, y: 1, z: 1 },
  };
  manager.updateModelTransform(model);
  return model;
}

/** Register a scene without a WebGL context; exports only read geometry. */
function attachScene(manager: ThreeManager, models: ThreeDModel[]): string {
  const scene: ThreeDScene = {
    id: 'scene_test',
    name: 'test',
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(),
    renderer: null as unknown as THREE.WebGLRenderer,
    models: [],
    lights: [],
  };
  for (const model of models) {
    scene.scene.add(model.mesh);
    scene.models.push(model);
  }
  const scenes = (manager as unknown as { scenes: Map<string, ThreeDScene> }).scenes;
  scenes.set(scene.id, scene);
  return scene.id;
}

function quad(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  return geometry;
}

function stlVertices(stl: string): Array<[number, number, number]> {
  return [...stl.matchAll(/vertex (\S+) (\S+) (\S+)/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
  ]);
}

function bounds(vertices: Array<[number, number, number]>): {
  min: [number, number, number];
  max: [number, number, number];
} {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const vertex of vertices) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return { min, max };
}

describe('ThreeManager export world transforms', () => {
  it('bakes rotation, scale and translation into STL vertices', () => {
    const manager = new ThreeManager();
    const model = manager.createModel('plate', 'box', { width: 2, height: 4 }, { depth: 6 });
    manager.updateModelTransform(model);
    model.position = { x: 10, y: 20, z: 30 };
    model.rotation = { x: 0, y: 0, z: Math.PI / 2 };
    manager.updateModelTransform(model);
    const sceneId = attachScene(manager, [model]);

    const vertices = stlVertices(manager.exportToSTL(sceneId));
    expect(vertices).toHaveLength(36);
    const { min, max } = bounds(vertices);

    // 90° about z swaps the 2-wide x extent and 4-high y extent.
    expect(min[0]).toBeCloseTo(8, 5);
    expect(max[0]).toBeCloseTo(12, 5);
    expect(min[1]).toBeCloseTo(19, 5);
    expect(max[1]).toBeCloseTo(21, 5);
    expect(min[2]).toBeCloseTo(27, 5);
    expect(max[2]).toBeCloseTo(33, 5);
  });

  it('bakes the same transform into OBJ vertices', () => {
    const manager = new ThreeManager();
    const model = makeModel(manager, 'plate', quad(), {
      position: { x: 5, y: -2, z: 1 },
      scale: { x: 2, y: 3, z: 1 },
    });
    const sceneId = attachScene(manager, [model]);

    const obj = manager.exportToOBJ(sceneId);
    const vertices = [...obj.matchAll(/^v (\S+) (\S+) (\S+)$/gm)].map((match) => [
      Number(match[1]),
      Number(match[2]),
      Number(match[3]),
    ]);

    expect(vertices).toEqual([
      [5, -2, 1],
      [7, -2, 1],
      [7, 1, 1],
      [5, 1, 1],
    ]);
    // Normals were previously written with a shared index space and are gone.
    expect(obj).not.toMatch(/^vn /m);
  });
});

describe('ThreeManager export topology', () => {
  it('writes indexed triangles with the real indices', () => {
    const manager = new ThreeManager();
    const sceneId = attachScene(manager, [makeModel(manager, 'tile', quad())]);

    const obj = manager.exportToOBJ(sceneId);
    expect(obj.match(/^v /gm)).toHaveLength(4);
    expect(obj).toContain('f 1 2 3');
    expect(obj).toContain('f 1 3 4');
  });

  it('offsets face indices correctly for each model in a multi-model scene', () => {
    const manager = new ThreeManager();
    const first = makeModel(manager, 'first', quad());
    const second = makeModel(manager, 'second', quad(), { position: { x: 2, y: 0, z: 0 } });
    const sceneId = attachScene(manager, [first, second]);

    const obj = manager.exportToOBJ(sceneId);
    expect(obj).toContain('o first');
    expect(obj).toContain('o second');
    expect(obj).toContain('f 1 2 3');
    expect(obj).toContain('f 5 6 7');
    expect(obj).toContain('f 5 7 8');
    expect(obj).not.toContain('f 9 ');
  });

  it('exports every model into one STL solid', () => {
    const manager = new ThreeManager();
    const first = makeModel(manager, 'first', quad());
    const second = makeModel(manager, 'second', quad());
    const sceneId = attachScene(manager, [first, second]);

    const stl = manager.exportToSTL(sceneId);
    expect(stl.match(/facet normal/g)).toHaveLength(4);
    expect(stl.trim().startsWith('solid ')).toBe(true);
    expect(stl.trim().endsWith('endsolid Folio_Model')).toBe(true);
  });
});

describe('ThreeManager export guards', () => {
  it('returns an empty string for an unknown scene', () => {
    const manager = new ThreeManager();
    expect(manager.exportToSTL('missing')).toBe('');
    expect(manager.exportToOBJ('missing')).toBe('');
  });

  it('refuses to export an empty scene', () => {
    const manager = new ThreeManager();
    const sceneId = attachScene(manager, []);
    expect(() => manager.exportToSTL(sceneId)).toThrow(/no models/);
    expect(() => manager.exportToOBJ(sceneId)).toThrow(/no models/);
  });

  it('rejects non-indexed geometry that is not whole triangles', () => {
    const manager = new ThreeManager();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0], 3),
    );
    const sceneId = attachScene(manager, [makeModel(manager, 'broken', geometry)]);
    expect(() => manager.exportToSTL(sceneId)).toThrow(/whole triangles/);
  });
});
