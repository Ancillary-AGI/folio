import { beforeEach, describe, expect, it } from 'vitest';
import { RoboticsSimulationService, roboticsSimulationService } from './roboticsSimulation';
import type { RobotConfiguration, TrajectoryPoint } from './roboticsSimulation';

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
        inertia: { xx: 0.1, yy: 0.1, zz: 0.05 },
      },
      {
        id: 'l2',
        name: 'Forearm',
        parentJoint: 'j2',
        childJoint: '',
        length: 0.8,
        mass: 1,
        inertia: { xx: 0.08, yy: 0.08, zz: 0.04 },
      },
    ],
    endEffector: {
      id: 'ee',
      name: 'Gripper',
      type: 'gripper',
      position: { x: 1.8, y: 0, z: 0 },
      orientation: { roll: 0, pitch: 0, yaw: 0 },
      status: 'open',
      payload: 1,
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

/** A 0.2 m link driven by a prismatic joint along the base Z axis. */
function prismaticArm(): Omit<RobotConfiguration, 'id'> {
  return {
    name: 'Lift arm',
    type: 'manipulator',
    baseFrame: { position: { x: 0, y: 0, z: 0 }, orientation: { roll: 0, pitch: 0, yaw: 0 } },
    kinematics: 'forward',
    dynamics: false,
    joints: [
      {
        id: 'lift',
        name: 'Lift',
        type: 'prismatic',
        position: { x: 0, y: 0, z: 0 },
        orientation: { roll: 0, pitch: 0, yaw: 0 },
        limits: { min: 0, max: 0.5 },
        velocity: 0.1,
        acceleration: 0.2,
      },
    ],
    links: [
      {
        id: 'l1',
        name: 'Carriage',
        parentJoint: 'lift',
        childJoint: '',
        length: 0.2,
        mass: 1,
        inertia: { xx: 0.1, yy: 0.1, zz: 0.05 },
      },
    ],
  };
}

describe('prismatic joints', () => {
  it('reads a prismatic value as metres, not as a degree angle', () => {
    const service = new RoboticsSimulationService();
    const id = service.createRobot(prismaticArm()).id;
    const pose = service.computeForwardKinematics(id, { lift: 0.1 });
    expect(pose.position.x).toBeCloseTo(0.2, 12);
    expect(pose.position.y).toBeCloseTo(0, 12);
    expect(pose.position.z).toBeCloseTo(0.1, 12);
  });

  it('solves IK in metres and round-trips the pose', () => {
    const service = new RoboticsSimulationService();
    const id = service.createRobot(prismaticArm()).id;
    const target = service.computeForwardKinematics(id, { lift: 0.25 });
    const solved = service.computeInverseKinematics(id, target);
    expect(solved).not.toBeNull();
    expect(solved!.lift).toBeCloseTo(0.25, 6);
    const reproduced = service.computeForwardKinematics(id, solved!);
    expect(reproduced.position.z).toBeCloseTo(0.25, 6);
  });

  it('rejects a spherical joint instead of treating it as revolute', () => {
    const service = new RoboticsSimulationService();
    const spherical = prismaticArm();
    spherical.joints = [{ ...spherical.joints[0], type: 'spherical' as never }];
    const id = service.createRobot(spherical).id;
    expect(() => service.computeForwardKinematics(id, { lift: 0 })).toThrow(
      /unsupported type "spherical"/,
    );
  });
});

describe('digital-twin robot state', () => {
  it('places both links of the two-link arm through the DH frames', () => {
    const service = new RoboticsSimulationService();
    const id = service.createRobot(twoLinkArm()).id;
    const state = service.getRobotState(id, { j1: 30, j2: 45 });

    const tip = expectedTip(30, 45);
    expect(state.joints[0].position).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.joints[1].position.x).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    expect(state.joints[1].position.y).toBeCloseTo(Math.sin(Math.PI / 6), 12);
    expect(state.links[0].end.x).toBeCloseTo(Math.cos(Math.PI / 6), 12);
    expect(state.links[0].end.y).toBeCloseTo(Math.sin(Math.PI / 6), 12);
    expect(state.links[1].end.x).toBeCloseTo(tip.x, 12);
    expect(state.links[1].end.y).toBeCloseTo(tip.y, 12);
    expect(state.endEffector.position.x).toBeCloseTo(tip.x, 12);
    expect(state.joints.map(joint => joint.angle)).toEqual([30, 45]);
  });

  it('extends a prismatic link in metres rather than drawing a rotation', () => {
    const service = new RoboticsSimulationService();
    const id = service.createRobot(prismaticArm()).id;
    const state = service.getRobotState(id, { lift: 0.1 });
    expect(state.links).toHaveLength(1);
    expect(state.links[0].start).toEqual({ x: 0, y: 0, z: 0 });
    expect(state.links[0].end.x).toBeCloseTo(0.2, 12);
    expect(state.links[0].end.z).toBeCloseTo(0.1, 12);
    expect(state.joints[0].angle).toBeCloseTo(0.1, 12);
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

  it('returns joint values inside the declared limits', () => {
    const limited = twoLinkArm();
    limited.joints[0].limits = { min: 0, max: 90 };
    limited.joints[1].limits = { min: -90, max: 0 };
    const id = service.createRobot(limited).id;

    const target = service.computeForwardKinematics(id, { j1: 40, j2: -30 });
    const solved = service.computeInverseKinematics(id, target);
    expect(solved).not.toBeNull();
    expect(solved!.j1).toBeGreaterThanOrEqual(0);
    expect(solved!.j1).toBeLessThanOrEqual(90);
    expect(solved!.j2).toBeGreaterThanOrEqual(-90);
    expect(solved!.j2).toBeLessThanOrEqual(0);
    const reproduced = service.computeForwardKinematics(id, solved!);
    expect(reproduced.position.x).toBeCloseTo(target.position.x, 6);
    expect(reproduced.position.y).toBeCloseTo(target.position.y, 6);
  });

  it('aligns results with the joints that drive links', () => {
    const arm = twoLinkArm();
    // A sensor joint that drives no link sits between the two chain joints; it
    // must not shift the returned values onto the wrong joint.
    arm.joints.splice(1, 0, {
      id: 'sensor',
      name: 'Wrist sensor',
      type: 'revolute',
      position: { x: 1, y: 0, z: 0 },
      orientation: { roll: 0, pitch: 0, yaw: 0 },
      limits: { min: -180, max: 180 },
      velocity: 1,
      acceleration: 1,
    });
    const id = service.createRobot(arm).id;

    const target = service.computeForwardKinematics(id, { j1: 30, j2: -20 });
    const solved = service.computeInverseKinematics(id, target);
    expect(solved).not.toBeNull();
    expect(solved!.sensor).toBeUndefined();
    const reproduced = service.computeForwardKinematics(id, solved!);
    expect(reproduced.position.x).toBeCloseTo(target.position.x, 6);
    expect(reproduced.position.y).toBeCloseTo(target.position.y, 6);
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

  it('rejects a non-positive duration instead of emitting duplicate timestamps', () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    expect(() =>
      service.planTrajectory(
        robotId,
        { timestamp: 2, jointAngles: { j1: 0, j2: 0 } },
        { timestamp: 2, jointAngles: { j1: 10, j2: 0 } },
      ),
    ).toThrow(/strictly after/);
  });

  it('rejects a non-finite joint value rather than treating it as zero', () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    expect(() =>
      service.planTrajectory(
        robotId,
        { timestamp: 0, jointAngles: { j1: Number.NaN, j2: 0 } },
        { timestamp: 1, jointAngles: { j1: 10, j2: 0 } },
      ),
    ).toThrow(/non-finite start value/);
  });

  it('rejects a pose outside the joint limits', () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    expect(() =>
      service.planTrajectory(
        robotId,
        { timestamp: 0, jointAngles: { j1: 0, j2: 0 } },
        { timestamp: 1, jointAngles: { j1: 270, j2: 0 } },
      ),
    ).toThrow(/exceeds its limits/);
  });

  it('fills a joint omitted from one pose from the other pose', () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const trajectory = service.planTrajectory(
      robotId,
      { timestamp: 0, jointAngles: { j1: 0, j2: 30 } },
      { timestamp: 1, jointAngles: { j1: 10 } },
    );
    expect(trajectory[0].jointAngles.j2).toBeCloseTo(30, 9);
    expect(trajectory[trajectory.length - 1].jointAngles.j2).toBeCloseTo(30, 9);
  });

  it('reports velocities in rad/s and accelerations in rad/s² for revolute joints', () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const trajectory = service.planTrajectory(
      robotId,
      { timestamp: 0, jointAngles: { j1: 0, j2: 0 } },
      { timestamp: 4, jointAngles: { j1: 90, j2: 0 } },
    );
    const rad = Math.PI / 180;
    expect(trajectory[0].velocities?.j1).toBeCloseTo(0, 12);
    expect(trajectory[25].velocities?.j1).toBeCloseTo(1.5 * (90 / 4) * rad, 12);
    expect(trajectory[50].velocities?.j1).toBeCloseTo(0, 12);
    expect(trajectory[0].accelerations?.j1).toBeCloseTo(6 * (90 / 16) * rad, 12);
    expect(trajectory[50].accelerations?.j1).toBeCloseTo(-6 * (90 / 16) * rad, 12);
  });
});

describe('task execution energy', () => {
  const waypoint = (timestamp: number, j1: number, j2: number) => ({
    timestamp,
    jointAngles: { j1: 0, j2: 0 },
    velocities: { j1, j2 },
  });

  const scene = (service: RoboticsSimulationService) =>
    service.createEnvironment({ name: 'empty', gravity: { x: 0, y: -9.81, z: 0 }, obstacles: [], targets: [] });

  it('integrates declared effort over the waypoint interval', async () => {
    const service = new RoboticsSimulationService();
    const arm = twoLinkArm();
    arm.joints[0].torque = 4;
    arm.joints[1].torque = 0;
    const robotId = service.createRobot(arm).id;
    const task = service.createTask({
      name: 'hold',
      description: 'two samples',
      priority: 'medium',
      waypoints: [waypoint(0, 1, 1), waypoint(0.5, 1, 1)],
    });

    const result = await service.executeTask(robotId, task.id, scene(service).id);
    expect(result.energyConsumption).toBeCloseTo(2, 12);
  });

  it('contributes nothing for joints without a declared torque', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const task = service.createTask({
      name: 'unactuated',
      description: 'no effort declared',
      priority: 'medium',
      waypoints: [waypoint(0, 2, 2), waypoint(0.5, 2, 2)],
    });

    const result = await service.executeTask(robotId, task.id, scene(service).id);
    expect(result.energyConsumption).toBe(0);
  });

  it('rejects non-monotonic timestamps instead of guessing a duration', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const task = service.createTask({
      name: 'bad clock',
      description: 'timestamps repeat',
      priority: 'medium',
      waypoints: [waypoint(0, 1, 1), waypoint(0, 1, 1)],
    });

    await expect(service.executeTask(robotId, task.id, scene(service).id)).rejects.toThrow(
      /monotonically/,
    );
  });
});

describe('task execution validation and metrics', () => {
  const scene = (service: RoboticsSimulationService) =>
    service.createEnvironment({ name: 'empty', gravity: { x: 0, y: -9.81, z: 0 }, obstacles: [], targets: [] });

  const taskWith = (service: RoboticsSimulationService, waypoints: TrajectoryPoint[]) =>
    service.createTask({
      name: 'metric task',
      description: 'generated in test',
      priority: 'medium',
      waypoints,
    });

  it('rejects a task with no waypoints instead of returning NaN efficiency', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const task = service.createTask({
      name: 'empty',
      description: 'nothing to do',
      priority: 'medium',
      waypoints: [],
    });

    await expect(service.executeTask(robotId, task.id, scene(service).id)).rejects.toThrow(
      /no waypoints/,
    );
  });

  it('rejects a non-finite end-effector pose instead of reporting a clear path', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const task = taskWith(service, [
      {
        timestamp: 0,
        jointAngles: { j1: 0, j2: 0 },
        endEffectorPose: {
          position: { x: Number.NaN, y: 0, z: 0 },
          orientation: { roll: 0, pitch: 0, yaw: 0 },
        },
      },
    ]);

    await expect(service.executeTask(robotId, task.id, scene(service).id)).rejects.toThrow(
      /non-finite end-effector pose/,
    );
  });

  it('rejects a joint value outside the joint limits', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const task = taskWith(service, [{ timestamp: 0, jointAngles: { j1: 200, j2: 0 } }]);

    await expect(service.executeTask(robotId, task.id, scene(service).id)).rejects.toThrow(
      /outside \[-180, 180\]/,
    );
  });

  it('detects the tool inside a box obstacle and misses it beside the box', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    // Straight arm: the tool sits at (1.8, 0, 0).
    const waypoint = { timestamp: 0, jointAngles: { j1: 0, j2: 0 } };

    const inside = service.createEnvironment({
      name: 'hit',
      gravity: { x: 0, y: -9.81, z: 0 },
      targets: [],
      obstacles: [
        { id: 'box', type: 'box', position: { x: 1.8, y: 0, z: 0 }, size: { x: 0.4, y: 0.4, z: 0.4 } },
      ],
    });
    const hit = await service.executeTask(robotId, taskWith(service, [waypoint]).id, inside.id);
    expect(hit.collisions).toBe(1);
    expect(hit.success).toBe(false);

    // A box whose bounding sphere would have covered the tool, but whose body
    // stops at y = 0.2, must not be reported as a hit.
    const beside = service.createEnvironment({
      name: 'miss',
      gravity: { x: 0, y: -9.81, z: 0 },
      targets: [],
      obstacles: [
        { id: 'long', type: 'box', position: { x: 1.8, y: 0.45, z: 0 }, size: { x: 2, y: 0.4, z: 0.4 } },
      ],
    });
    const miss = await service.executeTask(robotId, taskWith(service, [waypoint]).id, beside.id);
    expect(miss.collisions).toBe(0);
    expect(miss.success).toBe(true);
  });

  it('scores a smoothstep move independently of sample density and duration', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const dense = service.planTrajectory(
      robotId,
      { timestamp: 0, jointAngles: { j1: 0, j2: 0 } },
      { timestamp: 4, jointAngles: { j1: 90, j2: -45 } },
    );
    const sparse = dense.filter((_, index) => index % 5 === 0);
    const stretched = dense.map(point => ({ ...point, timestamp: point.timestamp * 2 }));

    const score = async (waypoints: typeof dense) => {
      const result = await service.executeTask(
        robotId,
        taskWith(service, waypoints).id,
        scene(service).id,
      );
      return result.performanceMetrics.smoothness;
    };

    const denseScore = await score(dense)
    expect(denseScore).not.toBeNull()
    expect(denseScore!).toBeCloseTo(0.5, 6);
    expect(await score(sparse)).toBeCloseTo(denseScore!, 6);
    expect(await score(stretched)).toBeCloseTo(denseScore!, 6);
  });

  it('gives no smoothness score to a recording too short to estimate jerk', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    // Three samples cannot carry a third divided difference. Scoring that as 1
    // would read "perfectly smooth" straight off the lack of data.
    const threeSamples = [
      { timestamp: 0, jointAngles: { j1: 0, j2: 0 } },
      { timestamp: 1, jointAngles: { j1: 45, j2: -20 } },
      { timestamp: 2, jointAngles: { j1: 90, j2: -45 } },
    ];

    const result = await service.executeTask(
      robotId,
      taskWith(service, threeSamples).id,
      scene(service).id,
    );
    expect(result.performanceMetrics.smoothness).toBeNull();
  });

  it('scores a held pose as smooth, because no joint travelled', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const still = Array.from({ length: 6 }, (_, index) => ({
      timestamp: index * 0.1,
      jointAngles: { j1: 30, j2: -10 },
    }));

    const result = await service.executeTask(
      robotId,
      taskWith(service, still).id,
      scene(service).id,
    );
    expect(result.performanceMetrics.smoothness).toBe(1);
  });

  it('scores an oscillating path below a smooth move', async () => {
    const service = new RoboticsSimulationService();
    const robotId = service.createRobot(twoLinkArm()).id;
    const jerky = Array.from({ length: 11 }, (_, index) => ({
      timestamp: index * 0.1,
      jointAngles: { j1: index % 2 === 0 ? 0 : 30, j2: 0 },
    }));

    const result = await service.executeTask(
      robotId,
      taskWith(service, jerky).id,
      scene(service).id,
    );
    expect(result.performanceMetrics.smoothness).toBeLessThan(0.5);
  });
});
