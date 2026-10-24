import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advancedRobotics, type Joint, type Link, type Trajectory } from './advancedRobotics';

function joint(
  name: string,
  position: [number, number, number],
  limits: { min: number; max: number } = { min: -Math.PI, max: Math.PI },
): Omit<Joint, 'id'> {
  return {
    name,
    type: 'revolute',
    position: new THREE.Vector3(...position),
    axis: new THREE.Vector3(0, 0, 1),
    limits,
    velocity: 2,
    acceleration: 4,
    torque: 0,
    angle: 0,
  };
}

function link(name: string, geometry: THREE.BufferGeometry, mass = 1): Omit<Link, 'id'> {
  return {
    name,
    geometry,
    material: new THREE.MeshBasicMaterial(),
    mass,
    centerOfMass: new THREE.Vector3(),
    inertiaTensor: new THREE.Matrix3(),
    childJoints: [],
  };
}

const build = (
  joints: Omit<Joint, 'id'>[],
  links: Omit<Link, 'id'>[],
  base = new THREE.Vector3(),
  endEffector = new THREE.Vector3(),
) => advancedRobotics.createMechanism({
  name: 'geometry fixture',
  type: 'serial',
  joints,
  links,
  basePosition: base,
  endEffectorOffset: endEffector,
});

function stlVertices(stl: string): THREE.Vector3[] {
  return Array.from(stl.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/g))
    .map(match => new THREE.Vector3(Number(match[1]), Number(match[2]), Number(match[3])));
}

function facets(stl: string): THREE.Vector3[][] {
  const vertices = stlVertices(stl);
  return Array.from({ length: vertices.length / 3 }, (_, index) =>
    vertices.slice(index * 3, index * 3 + 3));
}

function signedVolume(triangles: THREE.Vector3[][]): number {
  return triangles.reduce((sum, [a, b, c]) =>
    sum + a.dot(b.clone().cross(c)) / 6, 0);
}

describe('STL export', () => {
  it('writes every mesh triangle in millimetres with outward winding', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0])],
      [link('box', new THREE.BoxGeometry(0.1, 0.2, 0.3))],
    );
    const stl = advancedRobotics.exportMechanismSTL(mechanism, [0]);

    expect(stl.startsWith('solid mechanism_mm\n')).toBe(true);
    expect(stl.trimEnd().endsWith('endsolid mechanism_mm')).toBe(true);

    const triangles = facets(stl);
    expect(triangles).toHaveLength(12); // BoxGeometry: 6 quads = 12 facets.

    const vertices = triangles.flat();
    // Geometry attributes are float32, so compare at 0.1 µm resolution.
    expect(Math.min(...vertices.map(v => v.x))).toBeCloseTo(-50, 4);
    expect(Math.max(...vertices.map(v => v.x))).toBeCloseTo(50, 4);
    expect(Math.min(...vertices.map(v => v.y))).toBeCloseTo(-100, 4);
    expect(Math.max(...vertices.map(v => v.y))).toBeCloseTo(100, 4);
    expect(Math.min(...vertices.map(v => v.z))).toBeCloseTo(-150, 4);
    expect(Math.max(...vertices.map(v => v.z))).toBeCloseTo(150, 4);

    // 0.1 × 0.2 × 0.3 m = 6,000,000 mm³; a negative volume would mean
    // inward-facing normals.
    expect(signedVolume(triangles)).toBeCloseTo(6_000_000, 0);
  });

  it('rotates link geometry with the joint and translates by the base', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0])],
      [link('box', new THREE.BoxGeometry(0.1, 0.2, 0.3))],
      new THREE.Vector3(0.5, 0, 0),
    );
    const stl = advancedRobotics.exportMechanismSTL(mechanism, [Math.PI / 2]);
    const vertices = stlVertices(stl);

    // A 90° turn about Z swaps the x and y extents; the base adds 500 mm in x.
    expect(Math.min(...vertices.map(v => v.x))).toBeCloseTo(400, 4);
    expect(Math.max(...vertices.map(v => v.x))).toBeCloseTo(600, 4);
    expect(Math.min(...vertices.map(v => v.y))).toBeCloseTo(-50, 4);
    expect(Math.max(...vertices.map(v => v.y))).toBeCloseTo(50, 4);
    expect(Math.min(...vertices.map(v => v.z))).toBeCloseTo(-150, 4);
    expect(Math.max(...vertices.map(v => v.z))).toBeCloseTo(150, 4);
  });

  it('supports an explicit metre unit override', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0])],
      [link('box', new THREE.BoxGeometry(0.1, 0.2, 0.3))],
    );
    const stl = advancedRobotics.exportMechanismSTL(mechanism, [0], { units: 'm' });
    expect(stl.startsWith('solid mechanism_m\n')).toBe(true);
    const vertices = stlVertices(stl);
    expect(Math.max(...vertices.map(v => v.x))).toBeCloseTo(0.05, 6);
  });

  it('refuses a link with no triangle geometry instead of dropping it', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0])],
      [link('empty', new THREE.BufferGeometry())],
    );
    expect(() => advancedRobotics.exportMechanismSTL(mechanism, [0]))
      .toThrow(/no position geometry/);
  });

  it('rejects partial, out-of-range and non-finite link geometry', () => {
    const partial = new THREE.BufferGeometry();
    partial.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0], 3));
    const partialMechanism = build([joint('j0', [0, 0, 0])], [link('partial', partial)]);
    expect(() => advancedRobotics.exportMechanismSTL(partialMechanism, [0]))
      .toThrow(/whole triangles/);

    const outOfRange = new THREE.BufferGeometry();
    outOfRange.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
    );
    outOfRange.setIndex([0, 1, 9]);
    const outOfRangeMechanism = build([joint('j0', [0, 0, 0])], [link('bad-index', outOfRange)]);
    expect(() => advancedRobotics.exportMechanismSTL(outOfRangeMechanism, [0]))
      .toThrow(/index outside/);

    const nonFinite = new THREE.BufferGeometry();
    nonFinite.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, Number.NaN, 0, 1, 0], 3),
    );
    const nonFiniteMechanism = build([joint('j0', [0, 0, 0])], [link('nan', nonFinite)]);
    expect(() => advancedRobotics.exportMechanismSTL(nonFiniteMechanism, [0]))
      .toThrow(/non-finite vertex/);
  });
});

describe('tool frame', () => {
  it('solves IK for the tool point, not the last joint origin', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0])],
      [],
      new THREE.Vector3(),
      new THREE.Vector3(1, 0, 0),
    );
    const result = advancedRobotics.inverseKinematics(
      mechanism, new THREE.Vector3(0, 1, 0), undefined, 200, 1e-9,
    );
    expect(result.success).toBe(true);
    expect(result.jointAngles[0]).toBeCloseTo(Math.PI / 2, 6);

    const fk = advancedRobotics.forwardKinematics(
      Array.from(mechanism.joints.values()), result.jointAngles,
    );
    const tip = fk.positions[0].clone().add(
      mechanism.endEffector.position.clone().applyQuaternion(fk.orientations[0]),
    );
    expect(tip.distanceTo(new THREE.Vector3(0, 1, 0))).toBeLessThan(1e-3);
  });

  it('reports the tool point in simulation and includes the base offset', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0])],
      [],
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(1, 0, 0),
    );
    const frames = advancedRobotics.simulateMechanism(mechanism.id, 0.5, 0.25, { target: [0] });
    // Held at zero, the tool is one metre along +X from the base at (0, 2, 0).
    expect(frames[0].endEffectorPosition.distanceTo(new THREE.Vector3(1, 2, 0)))
      .toBeCloseTo(0, 9);

    const pose = advancedRobotics.endEffectorPose(mechanism, [0]);
    expect(pose?.position.distanceTo(new THREE.Vector3(1, 2, 0))).toBeCloseTo(0, 9);
    expect(advancedRobotics.endEffectorPose(mechanism, [])).toBeNull();
  });

  it('includes the base and tool offset in the reachable workspace', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0], { min: 0, max: Math.PI / 2 })],
      [],
      new THREE.Vector3(0, 2, 0),
      new THREE.Vector3(1, 0, 0),
    );
    expect(mechanism.workspace.reachable.min.x).toBeCloseTo(0, 9);
    expect(mechanism.workspace.reachable.max.x).toBeCloseTo(1, 9);
    expect(mechanism.workspace.reachable.min.y).toBeCloseTo(2, 9);
    expect(mechanism.workspace.reachable.max.y).toBeCloseTo(3, 9);
  });
});

describe('link collision', () => {
  it('reports overlapping non-adjacent links with a normal and penetration', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0]), joint('j1', [0, 0, 0]), joint('j2', [0, 0, 0])],
      [
        link('a', new THREE.BoxGeometry(1, 1, 1)),
        link('b', new THREE.BoxGeometry(1, 1, 1)),
        link('c', new THREE.BoxGeometry(1, 1, 1)),
      ],
    );
    const collisions = advancedRobotics.checkCollisions(mechanism, [0, 0, 0]);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].link1).toBe('link-0');
    expect(collisions[0].link2).toBe('link-2');
    expect(collisions[0].penetration).toBeCloseTo(1, 9);
    expect(collisions[0].normal.length()).toBeCloseTo(1, 9);
    expect(collisions[0].contactPoint.toArray().every(Number.isFinite)).toBe(true);
  });

  it('does not flag links that are connected by a shared joint', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0]), joint('j1', [0, 0, 0])],
      [
        link('a', new THREE.BoxGeometry(1, 1, 1)),
        link('b', new THREE.BoxGeometry(1, 1, 1)),
      ],
    );
    expect(advancedRobotics.checkCollisions(mechanism, [0, 0])).toEqual([]);
  });

  it('is pose-aware and finds contact only when the boxes actually overlap', () => {
    const mechanism = build(
      [joint('j0', [0, 0, 0]), joint('j1', [2, 0, 0]), joint('j2', [2, 0, 0])],
      [
        link('a', new THREE.BoxGeometry(1, 1, 1)),
        link('b', new THREE.BoxGeometry(1, 1, 1)),
        link('c', new THREE.BoxGeometry(1, 1, 1)),
      ],
    );
    expect(advancedRobotics.checkCollisions(mechanism, [0, 0, 0])).toEqual([]);
    // Turning the shoulder by π folds the distal link back onto the base link.
    const folded = advancedRobotics.checkCollisions(mechanism, [0, Math.PI, 0]);
    expect(folded.some(contact =>
      contact.link1 === 'link-0' && contact.link2 === 'link-2')).toBe(true);
  });
});

describe('mechanism validation', () => {
  it('rejects a mechanism with no joints or broken limits', () => {
    expect(() => build([], [])).toThrow(/at least one joint/);
    expect(() => build([joint('bad', [0, 0, 0], { min: 2, max: 1 })], []))
      .toThrow(/greater than max/);
  });

  it('rejects an unknown runtime trajectory profile', () => {
    const mechanism = build([joint('j0', [0, 0, 0])], []);
    expect(() => advancedRobotics.planTrajectory(
      mechanism, [0], [1], 1, 'not-a-profile' as Trajectory['profile'],
    )).toThrow(/Unknown trajectory profile/);
  });

  it('reports a non-finite or mis-sized forward-kinematics input instead of NaN poses', () => {
    const joints = [{ ...joint('j0', [0, 0, 0]), id: 'joint-0' }];
    expect(advancedRobotics.forwardKinematics(joints, [Number.NaN]).success).toBe(false);
    expect(advancedRobotics.forwardKinematics(joints, []).success).toBe(false);
  });
});
