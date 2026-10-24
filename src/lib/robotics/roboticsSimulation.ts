/**
 * Robotics Simulation and Agentic Control Service
 * Provides simulation, digital twin visualization, and AI-driven robotics control
 */

import {
  forwardKinematics,
  translationOf,
  type DhJoint,
  type IkLimits,
  type Vec3,
} from '../mechanical/kinematics';
import { manipulatorPose, solveManipulatorIk } from './serialManipulator';

export interface RobotJoint {
  id: string;
  name: string;
  type: 'revolute' | 'prismatic' | 'spherical' | 'fixed';
  position: { x: number; y: number; z: number };
  orientation: { roll: number; pitch: number; yaw: number };
  limits: { min: number; max: number };
  velocity: number;
  acceleration: number;
  torque?: number;
  force?: number;
}

export interface RobotLink {
  id: string;
  name: string;
  parentJoint: string;
  childJoint: string;
  length: number;
  mass: number;
  inertia: { xx: number; yy: number; zz: number };
  visualMesh?: string;
  collisionMesh?: string;
}

export interface RobotEndEffector {
  id: string;
  name: string;
  type: 'gripper' | 'tool' | 'sensor';
  position: { x: number; y: number; z: number };
  orientation: { roll: number; pitch: number; yaw: number };
  status: 'open' | 'closed' | 'active' | 'inactive';
  payload: number;
}

export interface RobotConfiguration {
  id: string;
  name: string;
  type: 'manipulator' | 'mobile' | 'humanoid' | 'custom';
  joints: RobotJoint[];
  links: RobotLink[];
  endEffector?: RobotEndEffector;
  baseFrame: { position: { x: number; y: number; z: number }; orientation: { roll: number; pitch: number; yaw: number } };
  kinematics: 'forward' | 'inverse';
  dynamics: boolean;
}

export interface TrajectoryPoint {
  timestamp: number;
  jointAngles: Record<string, number>;
  endEffectorPose?: {
    position: { x: number; y: number; z: number };
    orientation: { roll: number; pitch: number; yaw: number };
  };
  velocities?: Record<string, number>;
  accelerations?: Record<string, number>;
}

export interface RobotTask {
  id: string;
  name: string;
  description: string;
  waypoints: TrajectoryPoint[];
  constraints?: {
    maxVelocity: number;
    maxAcceleration: number;
    maxJerk: number;
  };
  priority: 'low' | 'medium' | 'high';
}

export interface AgenticControlPolicy {
  id: string;
  name: string;
  type: 'reinforcement_learning' | 'model_predictive' | 'adaptive' | 'rule_based';
  parameters: Record<string, unknown>;
  trained: boolean;
  performance: {
    successRate: number;
    averageTime: number;
    energyEfficiency: number;
  };
}

export interface SimulationEnvironment {
  id: string;
  name: string;
  gravity: { x: number; y: number; z: number };
  obstacles: Array<{
    id: string;
    type: 'box' | 'sphere' | 'cylinder' | 'mesh';
    position: { x: number; y: number; z: number };
    size: { x: number; y: number; z: number };
  }>;
  targets: Array<{
    id: string;
    position: { x: number; y: number; z: number };
    orientation: { roll: number; pitch: number; yaw: number };
  }>;
}

export interface SimulationResult {
  id: string;
  robotId: string;
  taskId: string;
  success: boolean;
  executionTime: number;
  trajectory: TrajectoryPoint[];
  collisions: number;
  energyConsumption: number;
  errors: string[];
  performanceMetrics: Record<string, number>;
}

/**
 * Builds the Denavit-Hartenberg chain implied by a robot configuration.
 *
 * The service stores joints and links as separate records with a link pointing at its
 * driving joint, so the chain is assembled by walking joints in declaration order and
 * taking the length of the link each one drives. Returns `null` when no joint drives a
 * link, because an empty chain has no meaningful end-effector pose and the caller
 * should say so rather than report the origin as a solution.
 *
 * Angles arrive in **degrees** on the service boundary and are converted to radians
 * here, once, so nothing downstream has to remember which unit it is holding.
 */
function buildDhChain(
  robot: {
    joints: readonly { id: string; type: string }[];
    links: readonly { parentJoint: string; length: number }[];
  },
  jointValues: Record<string, number>,
): DhJoint[] | null {
  const chain: DhJoint[] = [];
  for (const joint of robot.joints) {
    const link = robot.links.find((candidate) => candidate.parentJoint === joint.id);
    if (!link) continue;
    if (!Number.isFinite(link.length) || link.length < 0) {
      throw new Error(`Link driven by ${joint.id} has an invalid length: ${link.length}`);
    }
    if (joint.type !== 'revolute' && joint.type !== 'prismatic') {
      throw new Error(
        `Joint ${joint.id} has unsupported type "${joint.type}" for this kinematic chain.`,
      );
    }
    const value = jointValues[joint.id] ?? 0;
    if (!Number.isFinite(value)) {
      throw new Error(`Value for joint ${joint.id} is not finite: ${value}`);
    }
    // Revolute joint values arrive in degrees and vary `theta` about the previous
    // Z. Prismatic values arrive in metres and vary `d` along it; converting a
    // displacement through degrees would make a 100 mm slide travel 1.7 mm.
    chain.push(
      joint.type === 'prismatic'
        ? { a: link.length, alpha: 0, d: value, theta: 0, kind: 'prismatic' as const }
        : { a: link.length, alpha: 0, d: 0, theta: (value * Math.PI) / 180, kind: 'revolute' as const },
    );
  }
  return chain.length === 0 ? null : chain;
}

/**
 * Limits for the joints that drive a link, in the same order as `buildDhChain`
 * and in solver units: radians for revolute joints, metres for prismatic ones.
 */
function buildIkLimits(robot: {
  joints: readonly { id: string; type: string; limits: { min: number; max: number } }[];
  links: readonly { parentJoint: string }[];
}): IkLimits[] {
  const limits: IkLimits[] = [];
  for (const joint of robot.joints) {
    if (!robot.links.some((link) => link.parentJoint === joint.id)) continue;
    if (joint.type !== 'revolute' && joint.type !== 'prismatic') continue;
    const { min, max } = joint.limits;
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
      throw new Error(`Joint ${joint.id} has invalid limits [${min}, ${max}]`);
    }
    limits.push(
      joint.type === 'prismatic'
        ? { min, max }
        : { min: (min * Math.PI) / 180, max: (max * Math.PI) / 180 },
    );
  }
  return limits;
}

export class RoboticsSimulationService {
  private robots: Map<string, RobotConfiguration> = new Map();
  private tasks: Map<string, RobotTask> = new Map();
  private environments: Map<string, SimulationEnvironment> = new Map();
  private policies: Map<string, AgenticControlPolicy> = new Map();
  private idCounter = 0;

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${Date.now()}_${this.idCounter}`;
  }
  private simulations: Map<string, SimulationResult> = new Map();

  // Robot Management
  createRobot(config: Omit<RobotConfiguration, 'id'>): RobotConfiguration {
    const robot: RobotConfiguration = {
      ...config,
      id: this.nextId('robot')
    };

    this.robots.set(robot.id, robot);
    return robot;
  }

  getRobot(robotId: string): RobotConfiguration | undefined {
    return this.robots.get(robotId);
  }

  updateRobot(robotId: string, updates: Partial<RobotConfiguration>): void {
    const robot = this.robots.get(robotId);
    if (robot) {
      Object.assign(robot, updates);
    }
  }

  /**
   * Tool pose for the serial chain. Revolute joint values are degrees and
   * prismatic values are metres; other joint types are rejected rather than
   * silently treated as revolute.
   */
  computeForwardKinematics(robotId: string, jointAngles: Record<string, number>): {
    position: { x: number; y: number; z: number };
    orientation: { roll: number; pitch: number; yaw: number };
  } {
    const robot = this.robots.get(robotId);
    if (!robot) throw new Error('Robot not found');

    // Delegates to the verified Denavit-Hartenberg chain in `serialManipulator`, so a
    // revolute link with a twist and an offset is positioned correctly instead of being
    // folded into a planar two-link approximation. The chain solves in base-frame
    // coordinates, so the base frame's own translation is added back here. Revolute
    // values arrive in degrees; prismatic values arrive in metres.
    const chain = buildDhChain(robot, jointAngles);
    if (chain === null) {
      // No link follows any joint, so there is no mechanism to solve: the pose is the
      // base frame itself rather than a fabricated position.
      return {
        position: { ...robot.baseFrame.position },
        orientation: { ...robot.baseFrame.orientation },
      };
    }
    const pose = manipulatorPose(chain);
    return {
      position: {
        x: robot.baseFrame.position.x + pose.position[0],
        y: robot.baseFrame.position.y + pose.position[1],
        z: robot.baseFrame.position.z + pose.position[2],
      },
      orientation: { roll: pose.roll, pitch: pose.pitch, yaw: pose.yaw },
    };
  }

  /**
   * Joint values placing the tool at `targetPose.position` (orientation is not
   * solved). Revolute results are degrees, prismatic results are metres.
   */
  computeInverseKinematics(robotId: string, targetPose: {
    position: { x: number; y: number; z: number };
    orientation: { roll: number; pitch: number; yaw: number };
  }): Record<string, number> | null {
    const robot = this.robots.get(robotId);
    if (!robot) throw new Error('Robot not found');

    // Delegates to the damped-least-squares solver. Orientation is deliberately not
    // solved: a position-only iteration cannot pin a six-degree-of-freedom pose, and
    // the previous implementation pretended it could by handing every joint the same
    // angle. `null` now genuinely means "no solution was found".
    const chain = buildDhChain(robot, {});
    if (chain === null) return null;
    const target: Vec3 = [
      targetPose.position.x - robot.baseFrame.position.x,
      targetPose.position.y - robot.baseFrame.position.y,
      targetPose.position.z - robot.baseFrame.position.z,
    ];
    const limits = buildIkLimits(robot);

    // Deterministic multi-start: the chain's own pose plus the quarter points of
    // each joint's range. Damped least squares is local, so a single seed from
    // home leaves some reachable targets unsolved. Seeds are ordered, and the
    // first converged solution wins, so repeated calls are reproducible.
    const seeds: Array<Record<string, number>> = [{}];
    for (const joint of robot.joints) {
      if (!robot.links.some((link) => link.parentJoint === joint.id)) continue;
      const { min, max } = joint.limits;
      if (!(max > min)) continue;
      seeds.push(
        { [joint.id]: min + (max - min) * 0.25 },
        { [joint.id]: min + (max - min) * 0.75 },
      );
    }

    let best: { values: number[]; error: number } | null = null;
    for (const seed of seeds) {
      const seededChain = Object.keys(seed).length === 0 ? chain : buildDhChain(robot, seed);
      if (seededChain === null) continue;
      const result = solveManipulatorIk(seededChain, target, { limits });
      if (!result.converged) continue;
      if (!best || result.error < best.error) {
        best = { values: result.values, error: result.error };
      }
    }
    if (!best) return null;
    const solvedValues = best.values;

    // `buildDhChain` skips joints that drive no link, so pair values with the
    // chain-driving joints rather than with every robot joint by index.
    const chainJoints = robot.joints.filter((joint) =>
      robot.links.some((link) => link.parentJoint === joint.id),
    );
    const jointAngles: Record<string, number> = {};
    chainJoints.forEach((joint, index) => {
      const value = solvedValues[index];
      // Revolute variables go back to degrees; prismatic variables stay in metres.
      jointAngles[joint.id] =
        joint.type === 'prismatic' ? value : (value * 180) / Math.PI;
    });
    return jointAngles;
  }

  /**
   * Cubic smoothstep joint-space move from `startPose` to `endPose`.
   *
   * Timestamps must be finite and strictly increasing; without a positive
   * duration the motion, velocity and acceleration records would all be
   * meaningless. Joint values omitted from one pose hold their value from the
   * other pose, and a joint missing from both is rejected for the joints that
   * drive a link rather than silently starting at zero. Velocities are reported
   * in rad/s (revolute) or m/s (prismatic), accelerations in rad/s² or m/s²;
   * `jointAngles` themselves stay in degrees or metres, matching the service
   * boundary.
   */
  planTrajectory(robotId: string, startPose: TrajectoryPoint, endPose: TrajectoryPoint): TrajectoryPoint[] {
    const robot = this.robots.get(robotId);
    if (!robot) throw new Error('Robot not found');

    const startTime = startPose.timestamp;
    const endTime = endPose.timestamp;
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      throw new Error('Trajectory timestamps must be finite');
    }
    if (!(endTime > startTime)) {
      throw new Error('Trajectory end timestamp must be strictly after the start timestamp');
    }
    const duration = endTime - startTime;

    // Resolve every joint once; this also rejects non-finite poses instead of
    // letting `|| 0` turn NaN into a fabricated home position.
    const startValues = new Map<string, number>();
    const endValues = new Map<string, number>();
    for (const joint of robot.joints) {
      if (joint.type !== 'revolute' && joint.type !== 'prismatic') {
        throw new Error(
          `Joint ${joint.id} has unsupported type "${joint.type}" for trajectory planning.`,
        );
      }
      const drivesLink = robot.links.some(link => link.parentJoint === joint.id);
      const rawStart = startPose.jointAngles[joint.id];
      const rawEnd = endPose.jointAngles[joint.id];
      if (rawStart !== undefined && !Number.isFinite(rawStart)) {
        throw new Error(`Joint ${joint.id} has a non-finite start value: ${rawStart}`);
      }
      if (rawEnd !== undefined && !Number.isFinite(rawEnd)) {
        throw new Error(`Joint ${joint.id} has a non-finite end value: ${rawEnd}`);
      }
      if (rawStart === undefined && rawEnd === undefined && drivesLink) {
        throw new Error(`Joint ${joint.id} is missing from both trajectory poses`);
      }
      const start = rawStart ?? rawEnd ?? 0;
      const end = rawEnd ?? rawStart ?? 0;
      const { min, max } = joint.limits;
      if (!Number.isFinite(min) || !Number.isFinite(max) || !(max >= min)) {
        throw new Error(`Joint ${joint.id} has invalid limits [${min}, ${max}]`);
      }
      if (start < min || start > max || end < min || end > max) {
        throw new Error(
          `Trajectory for joint ${joint.id} exceeds its limits [${min}, ${max}] ` +
            `(start ${start}, end ${end})`,
        );
      }
      startValues.set(joint.id, start);
      endValues.set(joint.id, end);
    }

    const trajectory: TrajectoryPoint[] = [];
    const steps = 50;
    const radiansPerDegree = Math.PI / 180;

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const timestamp = startTime + duration * t;
      // Smoothstep and its analytic derivatives. Dividing the angle derivative
      // by the duration (rather than normalised time) keeps it in deg/s, which
      // is then converted to rad/s for revolute joints.
      const blend = t * t * (3 - 2 * t);
      const blendVelocity = (6 * t * (1 - t)) / duration;
      const blendAcceleration = (6 - 12 * t) / (duration * duration);

      const jointAngles: Record<string, number> = {};
      const velocities: Record<string, number> = {};
      const accelerations: Record<string, number> = {};
      for (const joint of robot.joints) {
        const startAngle = startValues.get(joint.id) ?? 0;
        const endAngle = endValues.get(joint.id) ?? 0;
        const delta = endAngle - startAngle;
        const scale = joint.type === 'revolute' ? radiansPerDegree : 1;
        jointAngles[joint.id] = startAngle + delta * blend;
        velocities[joint.id] = delta * blendVelocity * scale;
        accelerations[joint.id] = delta * blendAcceleration * scale;
      }

      trajectory.push({
        timestamp,
        jointAngles,
        velocities,
        accelerations,
        endEffectorPose: this.computeForwardKinematics(robotId, jointAngles),
      });
    }

    return trajectory;
  }

  // Task Management
  createTask(task: Omit<RobotTask, 'id'>): RobotTask {
    const newTask: RobotTask = {
      ...task,
      id: this.nextId('task')
    };

    this.tasks.set(newTask.id, newTask);
    return newTask;
  }

  getTask(taskId: string): RobotTask | undefined {
    return this.tasks.get(taskId);
  }

  // Simulation Environment
  createEnvironment(env: Omit<SimulationEnvironment, 'id'>): SimulationEnvironment {
    const environment: SimulationEnvironment = {
      ...env,
      id: this.nextId('env')
    };

    this.environments.set(environment.id, environment);
    return environment;
  }

  // Agentic Control Policies
  createControlPolicy(policy: Omit<AgenticControlPolicy, 'id'>): AgenticControlPolicy {
    const newPolicy: AgenticControlPolicy = {
      ...policy,
      id: this.nextId('policy')
    };

    this.policies.set(newPolicy.id, newPolicy);
    return newPolicy;
  }

  async trainPolicy(policyId: string, trainingData: Array<{
    state: Record<string, number>;
    action: Record<string, number>;
    reward: number;
    nextState: Record<string, number>;
  }>): Promise<void> {
    const policy = this.policies.get(policyId);
    if (!policy) throw new Error('Policy not found');
    if (trainingData.length === 0) throw new Error(`No training samples for policy '${policyId}'`);

    // No RL backend is bundled: mark the policy so the simulator can gate on
    // it, and report the honest baseline (mean batch reward) instead of an
    // invented success rate.
    const meanReward =
      trainingData.reduce((sum, sample) => sum + sample.reward, 0) / trainingData.length;

    policy.trained = true;
    policy.performance = {
      successRate: 0,
      averageTime: 0,
      energyEfficiency: Math.max(0, Math.min(1, meanReward))
    };
  }

  async executeTask(robotId: string, taskId: string, environmentId: string, policyId?: string): Promise<SimulationResult> {
    const robot = this.robots.get(robotId);
    const task = this.tasks.get(taskId);
    const environment = this.environments.get(environmentId);
    const policy = policyId ? this.policies.get(policyId) : undefined;

    if (!robot || !task || !environment) {
      throw new Error('Robot, task, or environment not found');
    }
    if (task.waypoints.length === 0) {
      throw new Error('Task has no waypoints to execute');
    }

    const startTime = Date.now();
    const trajectory: TrajectoryPoint[] = [];
    let collisions = 0;
    let energyConsumption = 0;
    let previousWaypoint: TrajectoryPoint | null = null;

    // Execute trajectory waypoints
    for (let i = 0; i < task.waypoints.length; i++) {
      const waypoint = task.waypoints[i];
      if (!Number.isFinite(waypoint.timestamp)) {
        throw new Error(`Waypoint ${i} has a non-finite timestamp`);
      }
      this.validateWaypoint(robot, waypoint, i);

      // The recorded pose is the pose the collision layer judged, even when the
      // caller omitted it and it had to be solved from the joint values.
      const endEffectorPose = this.resolveEndEffectorPose(robot, waypoint, i);
      const judgedWaypoint: TrajectoryPoint = { ...waypoint, endEffectorPose };

      // Check for collisions
      const collision = this.checkCollision(endEffectorPose, environment);
      if (collision) {
        collisions++;
      }

      // Mechanical work over the interval that ends at this waypoint. Without a
      // strictly increasing timestamp there is no interval to integrate over,
      // so the task is rejected instead of reporting invented energy.
      if (previousWaypoint) {
        const dt = waypoint.timestamp - previousWaypoint.timestamp;
        if (!(dt > 0)) {
          throw new Error('Waypoint timestamps must increase monotonically (seconds)');
        }
        energyConsumption += this.calculateEnergyConsumption(robot, waypoint, dt);
      }
      previousWaypoint = waypoint;

      trajectory.push(judgedWaypoint);

      // Apply control policy if available
      if (policy && policy.trained) {
        await this.applyControlPolicy(policy, robot);
      }
    }

    const executionTime = Date.now() - startTime;
    const success = collisions === 0 && trajectory.length === task.waypoints.length;

    const result: SimulationResult = {
      id: this.nextId('sim'),
      robotId,
      taskId,
      success,
      executionTime,
      trajectory,
      collisions,
      energyConsumption,
      errors: collisions > 0 ? ['Collision detected'] : [],
      performanceMetrics: {
        pathLength: this.calculatePathLength(trajectory),
        smoothness: this.calculateTrajectorySmoothness(trajectory),
        efficiency: success ? 1.0 - (collisions / task.waypoints.length) : 0
      }
    };

    this.simulations.set(result.id, result);
    return result;
  }

  /**
   * Rejects declared joint values that are non-finite or outside the joint's
   * limits. A simulation that silently drives a joint past its stop reports
   * poses the mechanism cannot reach.
   */
  private validateWaypoint(robot: RobotConfiguration, waypoint: TrajectoryPoint, index: number): void {
    for (const joint of robot.joints) {
      const drivesLink = robot.links.some((link) => link.parentJoint === joint.id);
      if (drivesLink && joint.type !== 'revolute' && joint.type !== 'prismatic') {
        throw new Error(
          `Joint ${joint.id} has unsupported type "${joint.type}" for this kinematic chain.`,
        );
      }
      const value = waypoint.jointAngles[joint.id];
      if (value === undefined) continue;
      if (!Number.isFinite(value)) {
        throw new Error(`Waypoint ${index} joint ${joint.id} has a non-finite value: ${value}`);
      }
      if (joint.type !== 'revolute' && joint.type !== 'prismatic') continue;
      const { min, max } = joint.limits;
      if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) {
        throw new Error(`Joint ${joint.id} has invalid limits [${min}, ${max}]`);
      }
      if (value < min || value > max) {
        throw new Error(
          `Waypoint ${index} joint ${joint.id} value ${value} is outside [${min}, ${max}]`,
        );
      }
    }
  }

  /**
   * The caller's end-effector pose when it supplied one (validated component by
   * component), otherwise the pose solved from the joint values. Trusting a
   * stale pose without checking it would let NaN reach the collision and path
   * metrics, where it silently reports "no collision" and zero distance.
   */
  private resolveEndEffectorPose(
    robot: RobotConfiguration,
    waypoint: TrajectoryPoint,
    index: number,
  ): NonNullable<TrajectoryPoint['endEffectorPose']> {
    const pose = waypoint.endEffectorPose;
    if (!pose) return this.computeForwardKinematics(robot.id, waypoint.jointAngles);
    const { position, orientation } = pose;
    const components = [
      position.x, position.y, position.z,
      orientation.roll, orientation.pitch, orientation.yaw,
    ];
    if (!components.every(Number.isFinite)) {
      throw new Error(`Waypoint ${index} has a non-finite end-effector pose`);
    }
    return pose;
  }

  /**
   * End-effector point test against each obstacle's declared shape. The arm's
   * links are not swept, so this answers "is the tool inside an obstacle at
   * this sample", not "is the swept volume clear".
   */
  private checkCollision(
    pose: NonNullable<TrajectoryPoint['endEffectorPose']>,
    environment: SimulationEnvironment,
  ): boolean {
    for (const obstacle of environment.obstacles) {
      if (this.obstacleContains(obstacle, pose.position)) return true;
    }
    return false;
  }

  private obstacleContains(
    obstacle: SimulationEnvironment['obstacles'][number],
    point: { x: number; y: number; z: number },
  ): boolean {
    const { position, size } = obstacle;
    if (![position.x, position.y, position.z, size.x, size.y, size.z].every(Number.isFinite)) {
      throw new Error(`Obstacle ${obstacle.id} has a non-finite position or size`);
    }
    if (size.x < 0 || size.y < 0 || size.z < 0) {
      throw new Error(`Obstacle ${obstacle.id} has a negative extent`);
    }
    const dx = point.x - position.x;
    const dy = point.y - position.y;
    const dz = point.z - position.z;

    if (obstacle.type === 'sphere') {
      const radius = Math.max(size.x, size.y, size.z) / 2;
      return dx * dx + dy * dy + dz * dz <= radius * radius;
    }
    if (obstacle.type === 'cylinder') {
      const radius = Math.max(size.x, size.y) / 2;
      return dx * dx + dy * dy <= radius * radius && Math.abs(dz) <= size.z / 2;
    }
    // Box, and mesh without loaded geometry: its axis-aligned bounding box is
    // the only shape the environment actually describes.
    return (
      Math.abs(dx) <= size.x / 2 &&
      Math.abs(dy) <= size.y / 2 &&
      Math.abs(dz) <= size.z / 2
    );
  }

  /**
   * Mechanical work |τ·q̇|·Δt for the interval ending at this waypoint. Torque
   * (revolute) or force (prismatic) must be declared on the joint; an undeclared
   * effort contributes nothing rather than a made-up default.
   */
  private calculateEnergyConsumption(
    robot: RobotConfiguration,
    waypoint: TrajectoryPoint,
    durationSeconds: number,
  ): number {
    let power = 0;

    for (const joint of robot.joints) {
      const velocity = waypoint.velocities?.[joint.id] ?? 0;
      const effort = joint.type === 'prismatic' ? joint.force : joint.torque;
      if (!Number.isFinite(velocity)) {
        throw new Error(`Joint '${joint.id}' has a non-finite velocity`);
      }
      if (effort === undefined) continue;
      if (!Number.isFinite(effort)) {
        throw new Error(`Joint '${joint.id}' has a non-finite effort`);
      }
      power += Math.abs(effort * velocity);
    }

    return power * durationSeconds;
  }

  private async applyControlPolicy(policy: AgenticControlPolicy, robot: RobotConfiguration): Promise<void> {
    // Gating layer: an untrained policy has no authority, so it must not mutate
    // the robot. A trained policy contributes a documented velocity override map
    // (joint id → target velocity), which executeTask can merge into waypoints.
    if (!policy.trained) return;
    const override = policy.parameters?.velocityOverride;
    if (override === null || typeof override !== 'object' || Array.isArray(override)) return;
    for (const [jointId, value] of Object.entries(override as Record<string, unknown>)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const joint = robot.joints.find(candidate => candidate.id === jointId);
      if (joint) joint.velocity = value;
    }
  }

  private calculatePathLength(trajectory: TrajectoryPoint[]): number {
    let length = 0;
    for (let i = 1; i < trajectory.length; i++) {
      const prev = trajectory[i - 1].endEffectorPose?.position;
      const curr = trajectory[i].endEffectorPose?.position;
      if (prev && curr) {
        length += Math.sqrt(
          Math.pow(curr.x - prev.x, 2) +
          Math.pow(curr.y - prev.y, 2) +
          Math.pow(curr.z - prev.z, 2)
        );
      }
    }
    return length;
  }

  /**
   * Smoothness score in (0, 1] from the dimensionless squared jerk of each
   * moving joint.
   *
   * Jerk is estimated with a third divided difference over four consecutive
   * samples using their real timestamps, which is exact for cubic segments and
   * does not assume uniform sampling. Integrating jerk² over time and scaling
   * by `T⁵ / Δq²` makes the measure independent of sample count, duration and
   * joint units. A cubic smoothstep move has a value of 144 and scores 0.5;
   * jerkier motions score lower, and a motionless path scores 1.
   *
   * Sampled data cannot see a discontinuity between samples, so a linear ramp
   * whose velocity jumps only at the endpoints reads as perfectly smooth; this
   * is a roughness comparison inside the recorded motion, not a certified
   * acceleration or jerk bound.
   */
  private calculateTrajectorySmoothness(trajectory: TrajectoryPoint[]): number {
    if (trajectory.length < 4) return 1.0;
    const duration = trajectory[trajectory.length - 1].timestamp - trajectory[0].timestamp;
    if (!(duration > 0)) return 1.0;

    const jointIds = new Set<string>();
    for (const point of trajectory) {
      for (const id of Object.keys(point.jointAngles)) jointIds.add(id);
    }
    if (jointIds.size === 0) return 1.0;

    let totalDimensionlessJerk = 0;
    let movingJoints = 0;

    for (const id of jointIds) {
      const angles = trajectory.map(point => point.jointAngles[id]);
      if (angles.some(value => value === undefined || !Number.isFinite(value))) continue;
      const values = angles as number[];
      const travel = Math.max(...values) - Math.min(...values);
      if (!(travel > 0)) continue;

      let jerkIntegral = 0;
      let weightTotal = 0;
      for (let i = 3; i < values.length; i += 1) {
        const times = [
          trajectory[i - 3].timestamp,
          trajectory[i - 2].timestamp,
          trajectory[i - 1].timestamp,
          trajectory[i].timestamp,
        ];
        if (!(times[3] > times[0])) continue;
        let thirdDividedDifference = 0;
        for (let k = 0; k < 4; k += 1) {
          let denominator = 1;
          for (let j = 0; j < 4; j += 1) {
            if (j !== k) denominator *= times[k] - times[j];
          }
          thirdDividedDifference += values[i - 3 + k] / denominator;
        }
        // A cubic's third derivative is six times its third divided difference.
        const jerk = 6 * thirdDividedDifference;
        const weight = (times[3] - times[0]) / 3;
        jerkIntegral += jerk * jerk * weight;
        weightTotal += weight;
      }
      if (!(weightTotal > 0)) continue;

      // Each window covers only part of the duration (the first three intervals
      // have no preceding sample), so rescale the weighted sum to the full
      // duration; otherwise the score would drift with sample density.
      const integratedJerk = (jerkIntegral * duration) / weightTotal;
      totalDimensionlessJerk += (duration ** 5 / travel ** 2) * integratedJerk;
      movingJoints += 1;
    }

    if (movingJoints === 0) return 1.0;
    const dimensionlessJerk = totalDimensionlessJerk / movingJoints;
    // 144 is the dimensionless squared jerk of a cubic smoothstep move, so the
    // familiar profile scores 0.5 and the score stays bounded as jerk grows.
    return 1 / (1 + dimensionlessJerk / 144);
  }

  /**
   * Per-joint and per-link positions for a digital-twin render, derived from the
   * same DH frames as `computeForwardKinematics`. Joint values are degrees for
   * revolute joints and metres for prismatic joints; `angle` echoes the joint's
   * native value. Unsupported joint types are rejected.
   */
  getRobotState(robotId: string, jointAngles: Record<string, number>): {
    joints: Array<{ id: string; position: { x: number; y: number; z: number }; angle: number }>;
    links: Array<{ id: string; start: { x: number; y: number; z: number }; end: { x: number; y: number; z: number } }>;
    endEffector: { position: { x: number; y: number; z: number }; orientation: { roll: number; pitch: number; yaw: number } };
  } {
    const robot = this.robots.get(robotId);
    if (!robot) throw new Error('Robot not found');

    const entries: Array<{ joint: RobotJoint; link: RobotLink; dh: DhJoint; value: number }> = [];
    for (const joint of robot.joints) {
      const link = robot.links.find(candidate => candidate.parentJoint === joint.id);
      if (!link) continue;
      if (joint.type !== 'revolute' && joint.type !== 'prismatic') {
        throw new Error(
          `Joint ${joint.id} has unsupported type "${joint.type}" for this kinematic chain.`,
        );
      }
      const value = jointAngles[joint.id] ?? 0;
      if (!Number.isFinite(value)) {
        throw new Error(`Value for joint ${joint.id} is not finite: ${value}`);
      }
      entries.push({
        joint,
        link,
        value,
        dh:
          joint.type === 'prismatic'
            ? { a: link.length, alpha: 0, d: value, theta: 0, kind: 'prismatic' }
            : { a: link.length, alpha: 0, d: 0, theta: (value * Math.PI) / 180, kind: 'revolute' },
      });
    }

    if (entries.length === 0) {
      return {
        joints: [],
        links: [],
        endEffector: {
          position: { ...robot.baseFrame.position },
          orientation: { ...robot.baseFrame.orientation },
        },
      };
    }

    const frames = forwardKinematics(entries.map(entry => entry.dh));
    const base = robot.baseFrame.position;
    const pointAt = (frameIndex: number) => {
      if (frameIndex < 0) return { x: base.x, y: base.y, z: base.z };
      const offset = translationOf(frames[frameIndex]);
      return { x: base.x + offset[0], y: base.y + offset[1], z: base.z + offset[2] };
    };

    return {
      joints: entries.map((entry, index) => ({
        id: entry.joint.id,
        position: pointAt(index - 1),
        angle: entry.value,
      })),
      links: entries.map((entry, index) => ({
        id: entry.link.id,
        start: pointAt(index - 1),
        end: pointAt(index),
      })),
      endEffector: this.computeForwardKinematics(robotId, jointAngles),
    };
  }

  getAllRobots(): RobotConfiguration[] {
    return Array.from(this.robots.values());
  }

  getAllTasks(): RobotTask[] {
    return Array.from(this.tasks.values());
  }

  getAllEnvironments(): SimulationEnvironment[] {
    return Array.from(this.environments.values());
  }

  getSimulationResult(simulationId: string): SimulationResult | undefined {
    return this.simulations.get(simulationId);
  }

  /** Alias kept for older call sites; delegates to computeForwardKinematics. */
  forwardKinematics(robotId: string, jointAngles: Record<string, number>): ReturnType<RoboticsSimulationService['computeForwardKinematics']> {
    return this.computeForwardKinematics(robotId, jointAngles);
  }
  /** Alias kept for older call sites; delegates to planTrajectory. */
  simulateTrajectory(robotId: string, startPose: TrajectoryPoint, endPose: TrajectoryPoint): TrajectoryPoint[] {
    return this.planTrajectory(robotId, startPose, endPose);
  }
}

export const roboticsSimulationService = new RoboticsSimulationService();

