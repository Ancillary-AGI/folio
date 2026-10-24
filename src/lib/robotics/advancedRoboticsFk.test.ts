import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advancedRobotics } from './advancedRobotics';
import type { Joint } from './advancedRobotics';

function rev(pos: [number, number, number]): Joint {
  return {
    id: '', name: '', type: 'revolute', position: new THREE.Vector3(...pos),
    axis: new THREE.Vector3(0, 0, 1), limits: { min: -Math.PI, max: Math.PI },
    velocity: 0, acceleration: 0, torque: 0, angle: 0,
  };
}

describe('FK chain semantics probe', () => {
  it('reports joint locations: joints at x=0 and x=1 give last joint x=1', () => {
    const r = advancedRobotics.forwardKinematics([rev([0, 0, 0]), rev([1, 0, 0])], [0, 0]);
    expect(r.success).toBe(true);
    const tip = r.positions[r.positions.length - 1];
    expect([tip.x, tip.y, tip.z]).toEqual([1, 0, 0]);
  });
  it('rotates the elbow offset by the shoulder angle', () => {
    const r = advancedRobotics.forwardKinematics([rev([0, 0, 0]), rev([1, 0, 0])], [Math.PI / 2, 0]);
    expect(r.success).toBe(true);
    const tip = r.positions[r.positions.length - 1];
    expect(tip.x).toBeCloseTo(0, 6);
    expect(tip.y).toBeCloseTo(1, 6);
  });
  it('does not move a joint by its own rotation (R*T, not T*R)', () => {
    // Elbow at (1,0,0): its own 90-degree Z rotation must not move it.
    // A T*R implementation would swing it to (0,1,0).
    const r = advancedRobotics.forwardKinematics([rev([0, 0, 0]), rev([1, 0, 0])], [0, Math.PI / 2]);
    expect(r.success).toBe(true);
    const tip = r.positions[r.positions.length - 1];
    expect(tip.x).toBeCloseTo(1, 6);
    expect(tip.y).toBeCloseTo(0, 6);
  });

describe('IK convergence probe', () => {
  it('reaches a target the FK chain can actually produce', () => {
    const mech = advancedRobotics.createMechanism({
      name: 'probe', type: 'serial',
      joints: [
        { name: 'j0', type: 'revolute', position: new THREE.Vector3(0, 0, 0), axis: new THREE.Vector3(0, 0, 1), limits: { min: -Math.PI, max: Math.PI }, velocity: 0, acceleration: 0, torque: 0, angle: 0 },
        { name: 'j1', type: 'revolute', position: new THREE.Vector3(1, 0, 0), axis: new THREE.Vector3(0, 0, 1), limits: { min: -Math.PI, max: Math.PI }, velocity: 0, acceleration: 0, torque: 0, angle: 0 },
      ],
      links: [],
      basePosition: new THREE.Vector3(0, 0, 0),
      endEffectorOffset: new THREE.Vector3(0, 0, 0),
    });
    const r = advancedRobotics.inverseKinematics(mech, new THREE.Vector3(0, 1, 0));
    expect(r.success).toBe(true);
  });

  it('solves a redundant chain for position and orientation together', () => {
    const mech = advancedRobotics.createMechanism({
      name: 'redundant', type: 'serial',
      joints: [
        { name: 'j0', type: 'revolute', position: new THREE.Vector3(0, 0, 0), axis: new THREE.Vector3(0, 0, 1), limits: { min: -Math.PI, max: Math.PI }, velocity: 0, acceleration: 0, torque: 0, angle: 0 },
        { name: 'j1', type: 'revolute', position: new THREE.Vector3(1, 0, 0), axis: new THREE.Vector3(0, 0, 1), limits: { min: -Math.PI, max: Math.PI }, velocity: 0, acceleration: 0, torque: 0, angle: 0 },
        { name: 'j2', type: 'revolute', position: new THREE.Vector3(2, 0, 0), axis: new THREE.Vector3(0, 0, 1), limits: { min: -Math.PI, max: Math.PI }, velocity: 0, acceleration: 0, torque: 0, angle: 0 },
      ],
      links: [],
      basePosition: new THREE.Vector3(0, 0, 0),
      endEffectorOffset: new THREE.Vector3(0, 0, 0),
    });

    const reach = Math.cos(Math.PI / 4) * 3;
    const target = new THREE.Vector3(reach, reach, 0);
    const orientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 4);
    const result = advancedRobotics.inverseKinematics(mech, target, orientation, 200, 1e-4);

    expect(result.success).toBe(true);
    const verification = advancedRobotics.forwardKinematics(
      Array.from(mech.joints.values()),
      result.jointAngles,
    );
    const tip = verification.positions[verification.positions.length - 1];
    expect(tip.distanceTo(target)).toBeLessThan(1e-3);
    expect(verification.orientations[verification.orientations.length - 1].angleTo(orientation))
      .toBeLessThan(1e-3);
  });

  it('reports non-convergence for an unreachable target', () => {
    const mech = advancedRobotics.createMechanism({
      name: 'short', type: 'serial',
      joints: [
        { name: 'j0', type: 'revolute', position: new THREE.Vector3(0, 0, 0), axis: new THREE.Vector3(0, 0, 1), limits: { min: -Math.PI, max: Math.PI }, velocity: 0, acceleration: 0, torque: 0, angle: 0 },
        { name: 'j1', type: 'revolute', position: new THREE.Vector3(1, 0, 0), axis: new THREE.Vector3(0, 0, 1), limits: { min: -Math.PI, max: Math.PI }, velocity: 0, acceleration: 0, torque: 0, angle: 0 },
      ],
      links: [],
      basePosition: new THREE.Vector3(0, 0, 0),
      endEffectorOffset: new THREE.Vector3(0, 0, 0),
    });

    const result = advancedRobotics.inverseKinematics(mech, new THREE.Vector3(100, 0, 0), undefined, 60);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/did not converge/);
  });
});
});
