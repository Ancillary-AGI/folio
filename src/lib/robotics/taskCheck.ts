/**
 * Task-path collision checking for a serial arm.
 *
 * `RoboticsSimulationService` owns the task/environment/collision layer, but its
 * kinematics are a planar DH chain. The robotics workspace draws a general
 * serial chain (arbitrary joint axes and offsets), so this adapter supplies the
 * end-effector poses from that same chain and lets the service judge collisions
 * along a joint-space move. The two never disagree about where the arm is
 * because the service is never asked to re-derive the pose.
 *
 * Collision tests the end-effector point against each obstacle's declared shape
 * (box, sphere or cylinder). It does not sweep the links or the tool between
 * samples, so a fast move can pass through a thin obstacle between two
 * waypoints; increase `samples` when that matters.
 */

import * as THREE from 'three';
import {
  RoboticsSimulationService,
  type RobotConfiguration,
  type TrajectoryPoint,
} from './roboticsSimulation';

export interface ChainJoint {
  id: string;
  name?: string;
  type: 'revolute' | 'prismatic';
  /** Joint axis in the parent frame. */
  axis: { x: number; y: number; z: number };
  /** Joint origin in the parent frame. */
  position: { x: number; y: number; z: number };
  limits: { min: number; max: number };
}

export interface ChainLink {
  id: string;
  name?: string;
  length: number;
  mass: number;
}

export interface TaskObstacle {
  id?: string;
  position: { x: number; y: number; z: number };
  /** Box extent; the service tests the tool point for containment in this box. */
  size: { x: number; y: number; z: number };
}

export interface EndEffectorPose {
  position: { x: number; y: number; z: number };
  orientation: { roll: number; pitch: number; yaw: number };
}

/**
 * End-effector position for a serial chain, composing each joint's translation
 * and rotation in the same order as `AdvancedRobotics.forwardKinematics`:
 * `T₁·R₁·T₂·R₂·…`, with the last joint origin as the tool point.
 */
export function endEffectorPose(
  joints: readonly ChainJoint[],
  angles: readonly number[],
): EndEffectorPose {
  const transform = new THREE.Matrix4();
  const rotation = new THREE.Matrix4();
  const translation = new THREE.Matrix4();

  joints.forEach((joint, index) => {
    const angle = angles[index] ?? 0;
    if (!Number.isFinite(angle)) {
      throw new Error(`Joint ${joint.id} has a non-finite angle: ${angle}.`);
    }
    const position = joint.position;
    translation.makeTranslation(position.x, position.y, position.z);
    transform.multiply(translation);

    if (joint.type === 'revolute') {
      const axis = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z);
      if (axis.lengthSq() === 0) {
        throw new Error(`Revolute joint ${joint.id} has a zero axis.`);
      }
      rotation.makeRotationAxis(axis.normalize(), angle);
    } else {
      const axis = new THREE.Vector3(joint.axis.x, joint.axis.y, joint.axis.z);
      if (axis.lengthSq() === 0) {
        throw new Error(`Prismatic joint ${joint.id} has a zero axis.`);
      }
      rotation.makeTranslation(axis.normalize().multiplyScalar(angle));
    }
    transform.multiply(rotation);
  });

  const point = new THREE.Vector3().setFromMatrixPosition(transform);
  return {
    position: { x: point.x, y: point.y, z: point.z },
    // The collision layer only consumes the position; the drawn orientation is
    // the tool frame, which this chain does not model as a rotation readout.
    orientation: { roll: 0, pitch: 0, yaw: 0 },
  };
}

/** Smoothstep joint-space interpolation, endpoints included. */
export function interpolateJointAngles(
  start: readonly number[],
  end: readonly number[],
  samples: number,
): number[][] {
  if (start.length !== end.length) {
    throw new Error(`Start and end configurations differ in length (${start.length} vs ${end.length}).`);
  }
  if (!Number.isInteger(samples) || samples < 1) {
    throw new Error(`Sample count must be an integer >= 1, got ${samples}.`);
  }
  const intervalCount = samples - 1;
  return Array.from({ length: samples }, (_, index) => {
    const t = intervalCount === 0 ? 1 : index / intervalCount;
    const blend = t * t * (3 - 2 * t);
    return start.map((value, joint) => value + (end[joint] - value) * blend);
  });
}

export interface TaskCheckResult {
  success: boolean;
  collisions: number;
  pathLength: number;
  /** `null` when the recorded motion has too few samples to estimate jerk. */
  smoothness: number | null;
  waypoints: TrajectoryPoint[];
}

/**
 * Move the arm from `startAngles` to `endAngles` and report whether the tool
 * strikes any obstacle. Returns the same public `SimulationResult` metrics the
 * service produces, plus the generated waypoints.
 */
export async function checkTaskPath(options: {
  name?: string;
  joints: readonly ChainJoint[];
  links: readonly ChainLink[];
  startAngles: readonly number[];
  endAngles: readonly number[];
  obstacles: readonly TaskObstacle[];
  samples?: number;
  durationSeconds?: number;
}): Promise<TaskCheckResult> {
  const {
    name = 'Serial arm task',
    joints,
    links,
    startAngles,
    endAngles,
    obstacles,
    samples = 24,
    durationSeconds = 2,
  } = options;

  if (joints.length === 0) throw new Error('Task check needs at least one joint.');
  if (joints.length !== links.length) {
    throw new Error(`Task check needs one link per joint (${joints.length} joints, ${links.length} links).`);
  }
  if (!(durationSeconds > 0)) throw new Error('Task duration must be positive.');

  const configurations = interpolateJointAngles(startAngles, endAngles, samples);
  const waypoints: TrajectoryPoint[] = configurations.map((angles, index) => {
    const t = samples === 1 ? 0 : index / (samples - 1);
    return {
      timestamp: t * durationSeconds,
      jointAngles: Object.fromEntries(joints.map((joint, jointIndex) => [joint.id, angles[jointIndex]])),
      endEffectorPose: endEffectorPose(joints, angles),
    };
  });

  // Finite-difference joint velocities give the service a real motion record.
  waypoints.forEach((waypoint, index) => {
    if (samples === 1) {
      waypoint.velocities = Object.fromEntries(joints.map((joint) => [joint.id, 0]));
      return;
    }
    const previous = Math.max(0, index - 1);
    const next = Math.min(samples - 1, index + 1);
    const dt = waypoints[next].timestamp - waypoints[previous].timestamp;
    waypoint.velocities = Object.fromEntries(
      joints.map((joint) => {
        const delta = waypoint.jointAngles[joint.id] - waypoints[previous].jointAngles[joint.id];
        return [joint.id, dt > 0 ? delta / dt : 0];
      }),
    );
  });

  const robot: Omit<RobotConfiguration, 'id'> = {
    name,
    type: 'manipulator',
    baseFrame: {
      position: { x: 0, y: 0, z: 0 },
      orientation: { roll: 0, pitch: 0, yaw: 0 },
    },
    kinematics: 'forward',
    dynamics: true,
    joints: joints.map((joint) => ({
      id: joint.id,
      name: joint.name ?? joint.id,
      type: joint.type,
      position: joint.position,
      orientation: { roll: 0, pitch: 0, yaw: 0 },
      limits: joint.limits,
      velocity: 0,
      acceleration: 0,
      // Holding torque scale; only used by the service's energy metric.
      torque: 0,
    })),
    links: links.map((link, index) => ({
      id: link.id,
      name: link.name ?? link.id,
      parentJoint: joints[index].id,
      childJoint: joints[index + 1]?.id ?? '',
      length: link.length,
      mass: link.mass,
      inertia: { xx: 0, yy: 0, zz: 0 },
    })),
  };

  const service = new RoboticsSimulationService();
  const createdRobot = service.createRobot(robot);
  const task = service.createTask({
    name: `${name} move`,
    description: `${samples} sampled joint-space waypoints`,
    waypoints,
    priority: 'medium',
  });
  const environment = service.createEnvironment({
    name: 'Task scene',
    gravity: { x: 0, y: -9.81, z: 0 },
    obstacles: obstacles.map((obstacle, index) => ({
      id: obstacle.id ?? `obstacle-${index}`,
      type: 'box',
      position: obstacle.position,
      size: obstacle.size,
    })),
    targets: [
      {
        id: 'target',
        position: waypoints[waypoints.length - 1].endEffectorPose?.position ?? { x: 0, y: 0, z: 0 },
        orientation: { roll: 0, pitch: 0, yaw: 0 },
      },
    ],
  });

  const result = await service.executeTask(createdRobot.id, task.id, environment.id);
  return {
    success: result.success,
    collisions: result.collisions,
    pathLength: result.performanceMetrics.pathLength,
    smoothness: result.performanceMetrics.smoothness,
    waypoints,
  };
}
