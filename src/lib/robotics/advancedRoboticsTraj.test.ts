import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { advancedRobotics, type Mechanism } from './advancedRobotics';

function oneJointMech(): Mechanism {
  return advancedRobotics.createMechanism({
    name: 'probe1', type: 'serial',
    joints: [{
      name: 'j0', type: 'revolute', position: new THREE.Vector3(0, 0, 0),
      axis: new THREE.Vector3(0, 0, 1), limits: { min: -Math.PI, max: Math.PI },
      velocity: 2, acceleration: 4, torque: 0, angle: 0,
    }],
    links: [],
    basePosition: new THREE.Vector3(0, 0, 0),
    endEffectorOffset: new THREE.Vector3(0, 0, 0),
  });
}

describe('trajectory limit probe', () => {
  it('stretches a too-short request to the limit-honoring duration', () => {
    const mech = oneJointMech();
    const traj = advancedRobotics.planTrajectory(mech, [0], [Math.PI / 2], 0.5, 'quintic');
    // Trapezoidal answer for D=pi/2, v=2, a=4: D/v + v/a = pi/4 + 1/2.
    expect(traj.duration).toBeCloseTo(Math.PI / 4 + 0.5, 9);
    // And the last waypoint time agrees with the reported duration.
    const last = traj.waypoints[traj.waypoints.length - 1];
    expect(last.time).toBeCloseTo(traj.duration, 9);
  });
  it('keeps a generous duration unchanged', () => {
    const mech = oneJointMech();
    const traj = advancedRobotics.planTrajectory(mech, [0], [Math.PI / 2], 5.0, 'quintic');
    expect(traj.duration).toBeCloseTo(5.0, 9);
  });
});
