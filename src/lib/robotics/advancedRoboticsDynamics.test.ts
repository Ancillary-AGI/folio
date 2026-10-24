import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { advancedRobotics, type Joint, type Link } from './advancedRobotics';

const joint = (
  name: string,
  position: [number, number, number],
  type: Joint['type'] = 'revolute',
): Omit<Joint, 'id'> => ({
  name,
  type,
  position: new THREE.Vector3(...position),
  axis: new THREE.Vector3(0, 0, 1),
  limits: { min: -Math.PI, max: Math.PI },
  velocity: 0,
  acceleration: 0,
  torque: 0,
  angle: 0,
});

const link = (
  name: string,
  mass: number,
  centerOfMass: [number, number, number],
): Omit<Link, 'id'> => ({
  name,
  geometry: new THREE.BufferGeometry(),
  material: new THREE.MeshBasicMaterial(),
  mass,
  centerOfMass: new THREE.Vector3(...centerOfMass),
  inertiaTensor: new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0),
  childJoints: [],
});

const build = (joints: Omit<Joint, 'id'>[], links: Omit<Link, 'id'>[]) =>
  advancedRobotics.createMechanism({
    name: 'dynamics fixture',
    type: 'serial',
    joints,
    links,
    basePosition: new THREE.Vector3(0, 0, 0),
    endEffectorOffset: new THREE.Vector3(0, 0, 0),
  });

describe('AdvancedRobotics dynamics', () => {
  it('computes the gravity-hold torque and potential energy of a pendulum', () => {
    const mechanism = build([joint('shoulder', [0, 0, 0])], [link('arm', 2, [1, 0, 0])]);

    const horizontal = advancedRobotics.computeDynamics(mechanism, [0], [0]);
    expect(horizontal.jointTorques[0]).toBeCloseTo(2 * 9.81, 6);
    expect(horizontal.totalEnergy).toBeCloseTo(0, 9);
    expect(horizontal.massMatrixCondition).toBeCloseTo(1, 9);

    const vertical = advancedRobotics.computeDynamics(mechanism, [Math.PI / 2], [0]);
    expect(vertical.jointTorques[0]).toBeCloseTo(0, 6);
    expect(vertical.totalEnergy).toBeCloseTo(2 * 9.81, 6);
  });

  it('adds the inertial term M·q̈ through the mass matrix', () => {
    const mechanism = build([joint('shoulder', [0, 0, 0])], [link('arm', 2, [1, 0, 0])]);
    const accelerated = advancedRobotics.computeDynamics(mechanism, [0], [0], [1]);
    expect(accelerated.jointTorques[0]).toBeCloseTo(2 * 9.81 + 2, 6);
    expect(accelerated.jointAccelerations).toEqual([1]);
  });

  it('supports vertical prismatic joints', () => {
    const prismatic = joint('lift', [0, 0, 0], 'prismatic');
    prismatic.axis = new THREE.Vector3(0, 1, 0);
    const mechanism = build([prismatic], [link('carriage', 3, [0, 0, 0])]);

    const held = advancedRobotics.computeDynamics(mechanism, [0], [0]);
    expect(held.jointTorques[0]).toBeCloseTo(3 * 9.81, 6);

    const lifted = advancedRobotics.computeDynamics(mechanism, [0], [0], [1]);
    expect(lifted.jointTorques[0]).toBeCloseTo(3 * 9.81 + 3, 6);
  });

  it('matches the planar two-link gravity and velocity-product terms', () => {
    const mechanism = build(
      [joint('shoulder', [0, 0, 0]), joint('elbow', [1, 0, 0])],
      [link('upper', 1, [1, 0, 0]), link('fore', 1, [1, 0, 0])],
    );

    expect(advancedRobotics.computeDynamics(mechanism, [0, 0], [0, 0]).jointTorques)
      .toEqual([expect.closeTo(29.43, 6), expect.closeTo(9.81, 6)]);

    const moving = advancedRobotics.computeDynamics(mechanism, [0, Math.PI / 2], [0, 1]);
    // The forearm is vertical, so the elbow carries no gravity torque; the shoulder
    // holds both links 1 m to the right (19.62 N·m) minus Γ₁₂₂ q̇₂² = 1 N·m.
    expect(moving.jointTorques[0]).toBeCloseTo(19.62 - 1, 4);
    expect(moving.jointTorques[1]).toBeCloseTo(0, 4);
    // T = ½ M₂₂ q̇₂² = 0.5 J, V = m₂ g h₂ = 9.81 J.
    expect(moving.totalEnergy).toBeCloseTo(0.5 + 9.81, 4);
  });

  it('rejects malformed vectors and unsupported joint types instead of guessing', () => {
    const mechanism = build(
      [joint('shoulder', [0, 0, 0]), joint('elbow', [1, 0, 0])],
      [link('upper', 1, [1, 0, 0]), link('fore', 1, [1, 0, 0])],
    );
    expect(() => advancedRobotics.computeDynamics(mechanism, [0], [0])).toThrow(/joint count/);
    expect(() => advancedRobotics.computeDynamics(mechanism, [0, 0], [0, 0], [0])).toThrow(/joint count/);

    const spherical = build([joint('ball', [0, 0, 0], 'spherical')], [link('mass', 1, [0, 0, 0])]);
    expect(() => advancedRobotics.computeDynamics(spherical, [0], [0])).toThrow(/revolute and prismatic/);
  });
});
