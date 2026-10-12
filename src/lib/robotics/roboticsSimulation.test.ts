import { beforeEach, describe, expect, it } from 'vitest';
import { RoboticsSimulationService, roboticsSimulationService } from './roboticsSimulation';
import type { RobotConfiguration } from './roboticsSimulation';

/** A two-link planar arm: 1 m then 0.8 m, both revolute about +Z. */
function twoLinkArm(): Omit<RobotConfiguration, 'id'> {
  return {
    name: 'Two-link arm',
    type: 'manipulator',
    baseFrame: { position: { x: 0, y: 0, z: 0 }, orientation: { roll: 0, pitch: 0, yaw: 0 } },
    kinematics: 'forward',
    dynamics: false,
    joints: [
      {
        id: 'j1',
        name: 'Shoulder',
        type: 'revolute',
        position: { x: 0, y: 0, z: 0 },
        orientation: { roll: 0, pitch: 0, yaw: 0 },
        limits: { min: -180, max: 180 },
        velocity: 1,
        acceleration: 1,
      },
      {
        id: 'j2',
        name: 'Elbow',
        type: 'revolute',
        position: { x: 1, y: 0, z: 0 },
        orientation: { roll: 0, pitch: 0, yaw: 0 },
        limits: { min: -180, max: 180 },
        velocity: 1,
        acceleration: 1,
      },
    ],
    links: [
      {
        id: 'l1',
        name: 'Upper arm',
        parentJoint: 'j1',
        childJoint: 'j2',
        length: 1,
        mass: 1,
        centerOfMass: { x: 0.5, y: 0, z: 0 },
        inertia: { xx: 1, yy: 1, zz: 1 },
      },
      {
        id: 'l2',
        name: 'Forearm',
        parentJoint: 'j2',
        childJoint: null,
        length: 0.8,
        mass: 1,
        centerOfMass: { x: 0.4, y: 0, z: 0 },
        inertia: { xx: 1, yy: 1, zz: 1 },
      },
    ],
    endEffector: {
      id: 'ee',
      name: 'Gripper',
      type: 'gripper',
      position: { x: 0, y: 0, z: 0 },
      orientation: { roll: 0, pitch: 0, yaw: 0 },
      maxPayload: 1,
      reach: 1.8,
    },
  };
}

/** Textbook forward kinematics, written out independently of the service. */
function expectedTip(shoulderDeg: number, elbowDeg: number): { x: number; y: number } {
  const t1 = (shoulderDeg * Math.PI) / 180;
  const t2 = (elbowDeg * Math.PI) / 180;
  return {
    x: Math.cos(t1) + 0.8 * Math.cos(t1 + t2),
    y: Math.sin(t1) + 0.8 * Math.sin(t1 + t2),
  };
}

describe('service lifecycle', () => {
  it('creates, retrieves and updates a robot', () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    expect(service.getRobot(robotId)?.name).toBe('Two-link arm');
    expect(service.getAllRobots()).toHaveLength(1);

    service.updateRobot(robotId, { name: 'Renamed' });
    expect(service.getRobot(robotId)?.name).toBe('Renamed');
    expect(service.getAllRobots()).toHaveLength(1);
  });

  it('throws for an unknown robot rather than inventing a pose', () => {
    const service = new RoboticsSimulationService();
    expect(() => service.computeForwardKinematics('nope', {})).toThrow(/not found/i);
    expect(() =>
      service.computeInverseKinematics('nope', {
        position: { x: 0, y: 0, z: 0 },
        orientation: { roll: 0, pitch: 0, yaw: 0 },
      }),
    ).toThrow(/not found/i);
  });

  it('exposes a shared singleton for the app', () => {
    expect(roboticsSimulationService).toBeInstanceOf(RoboticsSimulationService);
  });
});

describe('forward kinematics through the service', () => {
  let service: RoboticsSimulationService;
  let robotId: string;

  beforeEach(() => {
    service = new RoboticsSimulationService();
    robotId = service.createRobot(twoLinkArm()).id;
  });

  it('places the tip where the planar two-link formula says', () => {
    const cases: [number, number][] = [
      [0, 0],
      [30, 0],
      [0, 45],
      [60, -40],
      [-120, 90],
    ];
    for (const [shoulder, elbow] of cases) {
      const pose = service.computeForwardKinematics(robotId, { j1: shoulder, j2: elbow });
      const expected = expectedTip(shoulder, elbow);
      expect(pose.position.x).toBeCloseTo(expected.x, 10);
      expect(pose.position.y).toBeCloseTo(expected.y, 10);
      expect(pose.position.z).toBeCloseTo(0, 10);
    }
  });

  it('earns a real yaw instead of hard-coding roll and pitch to zero', () => {
    const pose = service.computeForwardKinematics(robotId, { j1: 30, j2: 45 });
    expect(pose.orientation.roll).toBeCloseTo(0, 12);
    expect(pose.orientation.pitch).toBeCloseTo(0, 12);
    expect(pose.orientation.yaw).toBeCloseTo((75 * Math.PI) / 180, 10);
  });

  it('treats an absent joint angle as zero rather than NaN', () => {
    const pose = service.computeForwardKinematics(robotId, {});
    const expected = expectedTip(0, 0);
    expect(pose.position.x).toBeCloseTo(expected.x, 12);
    expect(pose.position.y).toBeCloseTo(expected.y, 12);
  });

  it('falls back to the base frame when no joint drives a link', () => {
    const orphaned = twoLinkArm();
    orphaned.links = [];
    const id = service.createRobot(orphaned).id;
    const pose = service.computeForwardKinematics(id, { j1: 90 });
    expect(pose.position).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('rejects a non-finite joint angle instead of propagating NaN', () => {
    expect(() => service.computeForwardKinematics(robotId, { j1: Number.NaN })).toThrow(
      /not finite/,
    );
  });
});

describe('inverse kinematics through the service', () => {
  let service: RoboticsSimulationService;
  let robotId: string;

  beforeEach(() => {
    service = new RoboticsSimulationService();
    robotId = service.createRobot(twoLinkArm()).id;
  });

  it('round-trips a reachable pose back to angles that reproduce it', () => {
    const target = service.computeForwardKinematics(robotId, { j1: 35, j2: -25 });
    const solved = service.computeInverseKinematics(robotId, target);
    expect(solved).not.toBeNull();
    const reproduced = service.computeForwardKinematics(robotId, solved!);
    expect(reproduced.position.x).toBeCloseTo(target.position.x, 6);
    expect(reproduced.position.y).toBeCloseTo(target.position.y, 6);
  });

  it('gives the joints genuinely different angles, unlike the old implementation', () => {
    const target = service.computeForwardKinematics(robotId, { j1: 40, j2: 30 });
    const solved = service.computeInverseKinematics(robotId, target);
    expect(solved).not.toBeNull();
    // The previous code assigned every joint the same value, which cannot reproduce a pose.
    expect(solved!.j1).not.toBeCloseTo(solved!.j2, 3);
  });

  it('returns null for an unreachable target instead of a fake answer', () => {
    const solved = service.computeInverseKinematics(robotId, {
      position: { x: 50, y: 0, z: 0 },
      orientation: { roll: 0, pitch: 0, yaw: 0 },
    });
    expect(solved).toBeNull();
  });

  it('accounts for a translated base frame', () => {
    const shifted = twoLinkArm();
    shifted.baseFrame = {
      position: { x: 10, y: -4, z: 0 },
      orientation: { roll: 0, pitch: 0, yaw: 0 },
    };
    const id = service.createRobot(shifted).id;
    const posed = service.computeForwardKinematics(id, { j1: 20, j2: 10 });
    expect(posed.position.x).toBeCloseTo(10 + expectedTip(20, 10).x, 10);
    expect(posed.position.y).toBeCloseTo(-4 + expectedTip(20, 10).y, 10);

    const solved = service.computeInverseKinematics(id, posed);
    expect(solved).not.toBeNull();
    const reproduced = service.computeForwardKinematics(id, solved!);
    expect(reproduced.position.x).toBeCloseTo(posed.position.x, 6);
    expect(reproduced.position.y).toBeCloseTo(posed.position.y, 6);
  });

  it('keeps the legacy forwardKinematics alias pointed at the real solver', () => {
    const direct = service.computeForwardKinematics(robotId, { j1: 15, j2: 5 });
    const alias = service.forwardKinematics(robotId, { j1: 15, j2: 5 });
    expect(alias.position).toEqual(direct.position);
    expect(alias.orientation).toEqual(direct.orientation);
  });
});

describe('trajectory planning', () => {
  it('interpolates between the two poses and lands on the end pose', () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const trajectory = service.planTrajectory(
      robotId,
      { timestamp: 0, jointAngles: { j1: 0, j2: 0 } },
      { timestamp: 4, jointAngles: { j1: 90, j2: -45 } },
    );
    expect(trajectory.length).toBeGreaterThan(1);
    expect(trajectory[0].jointAngles.j1).toBeCloseTo(0, 9);
    const last = trajectory[trajectory.length - 1];
    expect(last.jointAngles.j1).toBeCloseTo(90, 9);
    expect(last.jointAngles.j2).toBeCloseTo(-45, 9);
    expect(last.timestamp).toBeCloseTo(4, 9);
  });

  it('advances the timestamps monotonically', () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const trajectory = service.planTrajectory(
      robotId,
      { timestamp: 1, jointAngles: { j1: 0, j2: 0 } },
      { timestamp: 3, jointAngles: { j1: 10, j2: 10 } },
    );
    for (let i = 1; i < trajectory.length; i += 1) {
      expect(trajectory[i].timestamp).toBeGreaterThan(trajectory[i - 1].timestamp);
    }
  });
});
