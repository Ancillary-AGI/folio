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
    // A quintic has peak |s'| = 1.875 and peak |s''| = 5.773502691896258.
    // With D = π/2, v = 2, a = 4 the acceleration bound binds:
    // T = sqrt(D · 5.7735… / 4) = 1.5057387573 s.
    expect(traj.duration).toBeCloseTo(Math.sqrt((Math.PI / 2) * 5.773502691896258 / 4), 9);
    // And the last waypoint time agrees with the reported duration.
    const last = traj.waypoints[traj.waypoints.length - 1];
    expect(last.time).toBeCloseTo(traj.duration, 9);
  });

  it('uses the time-optimal trapezoid duration when the profile is trapezoidal', () => {
    const mech = oneJointMech();
    // Fixed 25/50/25 normalized trapezoid: peak |s'| = 4/3, peak |s''| = 16/3.
    const traj = advancedRobotics.planTrajectory(mech, [0], [Math.PI / 2], 0.5, 'trapezoidal');
    const velocityBound = (Math.PI / 2) * (4 / 3) / 2;
    const accelerationBound = Math.sqrt((Math.PI / 2) * (16 / 3) / 4);
    expect(traj.duration).toBeCloseTo(Math.max(velocityBound, accelerationBound), 9);
  });

  it('samples every waypoint inside the joint velocity and acceleration limits', () => {
    const mech = oneJointMech();
    for (const profile of ['cubic', 'quintic', 'trapezoidal'] as const) {
      const traj = advancedRobotics.planTrajectory(mech, [0], [Math.PI / 2], 0.1, profile);
      const points = traj.waypoints;
      const limitV = 2;
      const limitA = 4;
      for (let i = 1; i < points.length; i += 1) {
        const dt = points[i].time - points[i - 1].time;
        const velocity = Math.abs(points[i].jointAngles[0] - points[i - 1].jointAngles[0]) / dt;
        expect(velocity).toBeLessThanOrEqual(limitV + 1e-6);
      }
      // Centered second difference at interior samples. A one-sided difference
      // across a quintic's changing acceleration is only first-order accurate
      // and reports up to ~8% above the true peak.
      for (let i = 1; i < points.length - 1; i += 1) {
        const dt = points[i].time - points[i - 1].time;
        const acceleration = Math.abs(
          points[i + 1].jointAngles[0] - 2 * points[i].jointAngles[0] + points[i - 1].jointAngles[0],
        ) / (dt * dt);
        expect(acceleration).toBeLessThanOrEqual(limitA * 1.01);
      }
      expect(points[0].jointAngles[0]).toBe(0);
      expect(points[points.length - 1].jointAngles[0]).toBeCloseTo(Math.PI / 2, 12);
    }
  });

  it('keeps a generous duration unchanged', () => {
    const mech = oneJointMech();
    const traj = advancedRobotics.planTrajectory(mech, [0], [Math.PI / 2], 5.0, 'quintic');
    expect(traj.duration).toBeCloseTo(5.0, 9);
  });

  it('replays exactly the joint values the planner sampled', () => {
    const mech = oneJointMech();
    const traj = advancedRobotics.planTrajectory(mech, [0], [1], 1, 'quintic');
    const frames = advancedRobotics.simulateMechanism(
      mech.id, traj.duration, traj.duration / 100, { target: [1], profile: 'quintic' },
    );
    expect(frames).toHaveLength(100);
    frames.forEach((frame, index) => {
      expect(frame.jointAngles[0]).toBeCloseTo(traj.waypoints[index + 1].jointAngles[0], 9);
    });
  });
});

describe('simulateMechanism', () => {
  it('replays a planned move and finishes exactly on the target', () => {
    const mech = oneJointMech();
    // 2 s is above the 1.5057 s limit-derived minimum for a quintic π/2 move.
    const frames = advancedRobotics.simulateMechanism(mech.id, 2, 0.25, { target: [Math.PI / 2] });
    expect(frames).toHaveLength(8);
    expect(frames[0].jointAngles[0]).toBeGreaterThan(0);
    expect(frames[frames.length - 1].jointAngles[0]).toBeCloseTo(Math.PI / 2, 9);
    for (let i = 1; i < frames.length; i += 1) {
      expect(frames[i].jointAngles[0]).toBeGreaterThanOrEqual(frames[i - 1].jointAngles[0]);
    }
  });

  it('always returns the exact final instant when the step does not divide the duration', () => {
    const mech = oneJointMech();
    const frames = advancedRobotics.simulateMechanism(mech.id, 1, 0.3);
    expect(frames).toHaveLength(4);
    frames.forEach((frame, index) => {
      expect(frame.time).toBeCloseTo([0.3, 0.6, 0.9, 1][index], 9);
    });
  });

  it('rejects a move that cannot meet the joint limits in the requested time', () => {
    const mech = oneJointMech();
    expect(() => advancedRobotics.simulateMechanism(mech.id, 1, 0.25, { target: [Math.PI / 2] }))
      .toThrow(/shorter than/);
  });

  it('rejects an unknown mechanism instead of silently returning nothing', () => {
    expect(() => advancedRobotics.simulateMechanism('missing', 1, 0.25)).toThrow(/not found/);
  });

  it('integrates declared joint velocity when no move is planned', () => {
    const mech = oneJointMech(); // 2 rad/s
    const frames = advancedRobotics.simulateMechanism(mech.id, 1, 0.25);
    expect(frames.map(frame => frame.jointAngles[0])).toEqual([0.5, 1, 1.5, 2]);
  });

  it('rejects a target outside the joint limits', () => {
    const mech = oneJointMech();
    expect(() => advancedRobotics.simulateMechanism(mech.id, 1, 0.1, { target: [10] }))
      .toThrow(/outside its limits/);
  });

  it('replays from an explicit start pose without mutating the mechanism', () => {
    const mech = oneJointMech();
    const frames = advancedRobotics.simulateMechanism(
      mech.id, 2, 0.5, { start: [0.5], target: [1], profile: 'quintic' },
    );
    expect(frames[0].jointAngles[0]).toBeGreaterThan(0.5);
    expect(frames[frames.length - 1].jointAngles[0]).toBeCloseTo(1, 9);
    expect(Array.from(mech.joints.values())[0].angle).toBe(0);
  });

  it('holds the pose when start and target are the same', () => {
    const mech = oneJointMech();
    const frames = advancedRobotics.simulateMechanism(
      mech.id, 1, 0.25, { start: [0.75], target: [0.75], profile: 'quintic' },
    );
    expect(frames).toHaveLength(4);
    frames.forEach(frame => expect(frame.jointAngles[0]).toBeCloseTo(0.75, 12));
  });

  it('rejects a start pose outside the joint limits', () => {
    const mech = oneJointMech();
    expect(() => advancedRobotics.simulateMechanism(mech.id, 1, 0.1, { start: [10], target: [0] }))
      .toThrow(/outside its limits/);
  });

  it('rejects non-positive duration and time step', () => {
    const mech = oneJointMech();
    expect(() => advancedRobotics.simulateMechanism(mech.id, 0, 0.1)).toThrow(/positive finite/);
    expect(() => advancedRobotics.simulateMechanism(mech.id, 1, 0)).toThrow(/positive finite/);
  });
});
