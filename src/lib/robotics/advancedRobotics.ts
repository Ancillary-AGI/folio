import * as THREE from 'three';

export interface Joint {
  id: string;
  name: string;
  type: 'revolute' | 'prismatic' | 'spherical' | 'planar';
  position: THREE.Vector3;
  axis: THREE.Vector3;
  limits: {
    min: number;
    max: number;
  };
  /** Maximum joint rate (rad/s or m/s). Also the commanded rate for open-loop replay. */
  velocity: number;
  /** Maximum joint acceleration (rad/s² or m/s²) used to size trajectories. */
  acceleration: number;
  /** Rated torque/force. Informational; dynamics computes the required value. */
  torque: number;
  angle: number; // current angle in radians
}

export interface Link {
  id: string;
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  mass: number;
  centerOfMass: THREE.Vector3;
  inertiaTensor: THREE.Matrix3;
  parentJoint?: string;
  childJoints: string[];
}

export interface Mechanism {
  id: string;
  name: string;
  type: 'serial' | 'parallel' | 'hybrid';
  base: THREE.Object3D;
  joints: Map<string, Joint>;
  links: Map<string, Link>;
  endEffector: THREE.Object3D;
  dof: number; // degrees of freedom
  workspace: {
    reachable: THREE.Box3;
    dexterous: THREE.Box3;
  };
}

export interface KinematicsResult {
  success: boolean;
  positions: THREE.Vector3[];
  orientations: THREE.Quaternion[];
  jointAngles: number[];
  error?: string;
}

/** One link-link contact reported by the oriented-bounding-box broad phase. */
export interface CollisionContact {
  link1: string;
  link2: string;
  contactPoint: THREE.Vector3;
  /** Unit normal pointing from link1 towards link2. */
  normal: THREE.Vector3;
  /** Depth of the bounding-box overlap, in scene units. */
  penetration: number;
}

/** Oriented bounding box used by the conservative link-collision test. */
interface OrientedBox {
  center: THREE.Vector3;
  axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3];
  halfExtents: [number, number, number];
}

export interface DynamicsResult {  jointTorques: number[];
  jointVelocities: number[];
  jointAccelerations: number[];
  totalEnergy: number;
  /** Ratio λmin/λmax of the joint-space mass matrix (1 = perfectly conditioned). */
  massMatrixCondition: number;
}

export interface TrajectoryWaypoint {
  position: THREE.Vector3;
  orientation: THREE.Quaternion;
  time: number;
  /** Joint values at this instant, in mechanism joint order. */
  jointAngles: number[];
}

export interface Trajectory {
  id: string;
  name: string;
  waypoints: TrajectoryWaypoint[];
  duration: number;
  profile: 'linear' | 'cubic' | 'quintic' | 'trapezoidal';
  constraints: {
    maxVelocity: number;
    maxAcceleration: number;
    maxJerk: number;
  };
}

export class AdvancedRobotics {
  private mechanisms: Map<string, Mechanism> = new Map();
  private trajectories: Map<string, Trajectory> = new Map();
  /** Monotonic suffix so designs created in the same millisecond stay distinct. */
  private nextId = 0;

  private makeId(prefix: string): string {
    this.nextId += 1;
    return `${prefix}-${Date.now()}-${this.nextId}`;
  }

  // Mechanism Design and Creation
  createMechanism(config: {
    name: string;
    type: Mechanism['type'];
    joints: Omit<Joint, 'id'>[];
    links: Omit<Link, 'id'>[];
    basePosition: THREE.Vector3;
    endEffectorOffset: THREE.Vector3;
  }): Mechanism {
    if (!config.name.trim()) throw new Error('A mechanism needs a name.');
    if (config.joints.length === 0) throw new Error('A mechanism needs at least one joint.');
    config.joints.forEach((joint) => {
      if (!Number.isFinite(joint.limits.min) || !Number.isFinite(joint.limits.max)) {
        throw new Error(`Joint ${joint.name} has non-finite position limits.`);
      }
      if (joint.limits.min > joint.limits.max) {
        throw new Error(`Joint ${joint.name} has min limit ${joint.limits.min} greater than max ${joint.limits.max}.`);
      }
      if (!joint.position.toArray().every(Number.isFinite)) {
        throw new Error(`Joint ${joint.name} has a non-finite position.`);
      }
      const axisFinite = joint.axis.toArray().every(Number.isFinite);
      if (!axisFinite) throw new Error(`Joint ${joint.name} has a non-finite axis.`);
      if ((joint.type === 'revolute' || joint.type === 'prismatic') && joint.axis.lengthSq() === 0) {
        throw new Error(`Joint ${joint.name} has a zero-length axis.`);
      }
      if (!Number.isFinite(joint.velocity) || joint.velocity < 0) {
        throw new Error(`Joint ${joint.name} has an invalid velocity limit.`);
      }
      if (!Number.isFinite(joint.acceleration) || joint.acceleration < 0) {
        throw new Error(`Joint ${joint.name} has an invalid acceleration limit.`);
      }
    });
    if (!config.basePosition.toArray().every(Number.isFinite)) {
      throw new Error('The base position must be finite.');
    }
    if (!config.endEffectorOffset.toArray().every(Number.isFinite)) {
      throw new Error('The end-effector offset must be finite.');
    }

    const mechanismId = this.makeId('mechanism');

    // Create base
    const base = new THREE.Object3D();
    base.position.copy(config.basePosition);

    // Create joints
    const joints = new Map<string, Joint>();
    config.joints.forEach((jointConfig, index) => {
      const joint: Joint = {
        ...jointConfig,
        id: `joint-${index}`,
        angle: 0
      };
      joints.set(joint.id, joint);
    });

    // Create links
    const links = new Map<string, Link>();
    config.links.forEach((linkConfig, index) => {
      const link: Link = {
        ...linkConfig,
        id: `link-${index}`,
        childJoints: []
      };
      links.set(link.id, link);
    });

    // Create end effector
    const endEffector = new THREE.Object3D();
    endEffector.position.copy(config.endEffectorOffset);

    // Build kinematic chain
    this.buildKinematicChain(joints, links);

    const mechanism: Mechanism = {
      id: mechanismId,
      name: config.name,
      type: config.type,
      base,
      joints,
      links,
      endEffector,
      dof: joints.size,
      workspace: this.calculateWorkspace(joints, config.basePosition, config.endEffectorOffset)
    };

    this.mechanisms.set(mechanismId, mechanism);
    return mechanism;
  }

  private buildKinematicChain(joints: Map<string, Joint>, links: Map<string, Link>): void {
    // Serial chain by declaration order: joint i drives link i and the next
    // joint attaches at that link's end. FK composes each joint's origin
    // translation and axis rotation in turn; there is no separate DH table.
    const jointArray = Array.from(joints.values());
    const linkArray = Array.from(links.values());

    for (let i = 0; i < jointArray.length; i++) {
      const joint = jointArray[i];
      const link = linkArray[i];

      if (link) {
        link.parentJoint = joint.id;
        if (i < jointArray.length - 1) {
          link.childJoints.push(jointArray[i + 1].id);
        }
      }
    }
  }

  private calculateWorkspace(
    joints: Map<string, Joint>,
    basePosition: THREE.Vector3,
    endEffectorOffset: THREE.Vector3,
  ): Mechanism['workspace'] {
    // Deterministic position grid: samples each joint at its min, mid, and max
    // and forwards the configurations through FK at the tool point. Exhaustive
    // sampling is exponential, so cap the joint count and say so.
    const jointList = Array.from(joints.values()).slice(0, 6);
    const samplesPerJoint = 3;
    const positions: THREE.Vector3[] = [];

    const total = Math.pow(samplesPerJoint, Math.max(1, jointList.length));
    for (let i = 0; i < total; i++) {
      let remainder = i;
      const config = jointList.map((joint) => {
        const slot = remainder % samplesPerJoint;
        remainder = Math.floor(remainder / samplesPerJoint);
        const fraction = slot / (samplesPerJoint - 1);
        return joint.limits.min + fraction * (joint.limits.max - joint.limits.min);
      });

      const fkResult = this.forwardKinematics(jointList, config);
      if (fkResult.success && fkResult.positions.length > 0) {
        positions.push(this.toolPosition(fkResult, endEffectorOffset).add(basePosition));
      }
    }

    const reachable = new THREE.Box3().setFromPoints(positions);

    // Inner box centred on the reachable box, scaled to 70%. This is a coarse
    // display region, not a certified dexterous workspace: true dexterity needs
    // a manipulability sweep over the joint space.
    const center = reachable.getCenter(new THREE.Vector3());
    const halfSize = reachable.getSize(new THREE.Vector3()).multiplyScalar(0.35);
    const dexterous = new THREE.Box3(center.clone().sub(halfSize), center.clone().add(halfSize));

    return { reachable, dexterous };
  }

  // Forward Kinematics
  forwardKinematics(joints: Joint[], jointAngles: number[]): KinematicsResult {
    if (jointAngles.length !== joints.length) {
      return {
        success: false,
        positions: [],
        orientations: [],
        jointAngles,
        error: `Forward kinematics received ${jointAngles.length} angles for ${joints.length} joints.`,
      };
    }
    if (!jointAngles.every(Number.isFinite)) {
      return {
        success: false,
        positions: [],
        orientations: [],
        jointAngles,
        error: 'Forward kinematics received a non-finite joint angle.',
      };
    }
    try {
      const positions: THREE.Vector3[] = [];
      const orientations: THREE.Quaternion[] = [];
      const currentTransform = new THREE.Matrix4();

      for (let i = 0; i < joints.length; i++) {
        const joint = joints[i];
        const angle = jointAngles[i];

        // Apply joint transformation
        const jointTransform = this.getJointTransform(joint, angle);
        currentTransform.multiply(jointTransform);

        // Extract position and orientation
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        currentTransform.decompose(position, quaternion, scale);

        positions.push(position);
        orientations.push(quaternion);
      }

      return {
        success: true,
        positions,
        orientations,
        jointAngles
      };
    } catch (error) {
      return {
        success: false,
        positions: [],
        orientations: [],
        jointAngles,
        error: `Forward kinematics failed: ${error}`
      };
    }
  }

  /** Tool-point position in the last joint frame: the joint origin plus the
   * end-effector offset rotated by the final orientation. FK itself reports
   * joint frames, so every mechanism-level consumer must go through here.
   */
  private toolPosition(fk: KinematicsResult, offset: THREE.Vector3): THREE.Vector3 {
    const last = fk.positions.length - 1;
    if (last < 0) return offset.clone();
    return fk.positions[last].clone()
      .add(offset.clone().applyQuaternion(fk.orientations[last]));
  }

  /**
   * World pose of the tool point (base offset + end-effector offset included).
   * Returns null when the joint vector is malformed rather than a replacement
   * pose that would look plausible but be wrong.
   */
  endEffectorPose(
    mechanism: Mechanism,
    jointAngles: number[],
  ): { position: THREE.Vector3; orientation: THREE.Quaternion } | null {
    const joints = Array.from(mechanism.joints.values());
    if (jointAngles.length !== joints.length) return null;
    const fkResult = this.forwardKinematics(joints, jointAngles);
    if (!fkResult.success || fkResult.positions.length === 0) return null;
    return {
      position: this.toolPosition(fkResult, mechanism.endEffector.position)
        .add(mechanism.base.position),
      orientation: fkResult.orientations[fkResult.orientations.length - 1].clone(),
    };
  }

  private getJointTransform(joint: Joint, angle: number): THREE.Matrix4 {
    // Joint frame: translate to the joint's position in its parent frame,
    // then rotate about the joint axis (R*T_local composed under T_parent).
    // The old code multiplied in the wrong order, rotating the joint's own
    // offset about itself: a straight arm reported the elbow at (0,1,0)
    // when only the elbow joint turned.
    const rotation = new THREE.Matrix4();
    if (joint.type === 'revolute') {
      rotation.makeRotationAxis(joint.axis, angle);
    } else if (joint.type === 'prismatic') {
      const slide = joint.axis.clone().normalize().multiplyScalar(angle);
      rotation.setPosition(slide);
    }
    const translation = new THREE.Matrix4().setPosition(joint.position);
    // Parent frame first, then the joint's own frame: T_parent * (R * T_local).
    return translation.multiply(rotation);
  }

  // Inverse Kinematics
  /**
   * Damped-least-squares IK for the tool point (and orientation when given).
   *
   * A single seed converges for only part of the reachable workspace: the
   * damped step can stall against a joint limit or a singular stretch. The
   * solver therefore retries from deterministic joint-space seeds and returns
   * the first pose that meets the tolerance. Seeds are ordered by distance to
   * the supplied/current pose, so a fallback stays as short as possible.
   */
  inverseKinematics(
    mechanism: Mechanism,
    targetPosition: THREE.Vector3,
    targetOrientation?: THREE.Quaternion,
    maxIterations: number = 100,
    tolerance: number = 0.001,
    initialAngles?: number[]
  ): KinematicsResult {
    const joints = Array.from(mechanism.joints.values());
    const jointAngles = initialAngles ? [...initialAngles] : joints.map(j => j.angle); // Initial guess
    const failure = (error: string): KinematicsResult => ({
      success: false,
      positions: [],
      orientations: [],
      jointAngles: [...jointAngles],
      error,
    });

    if (joints.length === 0) return failure('Inverse kinematics requires at least one joint.');
    if (jointAngles.length !== joints.length) {
      return failure(`Inverse kinematics received ${jointAngles.length} seed values for ${joints.length} joints.`);
    }
    if (!jointAngles.every(Number.isFinite)) return failure('IK seed values must be finite.');
    if (!targetPosition.toArray().every(Number.isFinite)) return failure('IK target must be finite.');
    if (targetOrientation && !targetOrientation.toArray().every(Number.isFinite)) {
      return failure('IK target orientation must be finite.');
    }
    if (!Number.isFinite(maxIterations) || maxIterations < 1) return failure('IK iteration limit must be positive.');
    if (!Number.isFinite(tolerance) || tolerance <= 0) return failure('IK tolerance must be positive.');

    // IK targets are world coordinates; the FK chain lives in the base frame.
    const target = targetPosition.clone().sub(mechanism.base.position);
    const toolOffset = mechanism.endEffector.position;
    const solve = (seed: number[], iterationLimit: number): KinematicsResult =>
      this.solveIkFrom(joints, target, toolOffset, seed, targetOrientation, iterationLimit, tolerance);

    const primary = solve(jointAngles, maxIterations);
    if (primary.success) return primary;

    // Fallback seeds run only after the primary fails, so they get a deeper
    // budget: a narrow or near-singular target can need many iterations.
    const restartIterations = Math.max(maxIterations, 200);
    for (const seed of this.ikRestartSeeds(joints, jointAngles)) {
      const attempt = solve(seed, restartIterations);
      if (attempt.success) return attempt;
    }

    return primary;
  }

  /** One damped-least-squares descent from a given joint seed. */
  private solveIkFrom(
    joints: Joint[],
    target: THREE.Vector3,
    toolOffset: THREE.Vector3,
    initialAngles: number[],
    targetOrientation: THREE.Quaternion | undefined,
    maxIterations: number,
    tolerance: number,
  ): KinematicsResult {
    const jointAngles = [...initialAngles];
    const failure = (error: string): KinematicsResult => ({
      success: false,
      positions: [],
      orientations: [],
      jointAngles: [...jointAngles],
      error,
    });
    let damping = 1e-3;
    let previousError = Infinity;

    for (let iteration = 0; iteration < maxIterations; iteration++) {
      // Forward kinematics
      const fkResult = this.forwardKinematics(joints, jointAngles);
      if (!fkResult.success) {
        return failure(fkResult.error ?? 'Forward kinematics failed during IK');
      }

      const currentPosition = this.toolPosition(fkResult, toolOffset);
      const positionError = target.clone().sub(currentPosition);
      const currentOrientation = fkResult.orientations[fkResult.orientations.length - 1];
      const orientationError = targetOrientation && currentOrientation
        ? currentOrientation.angleTo(targetOrientation)
        : 0;

      // Check convergence
      if (positionError.length() < tolerance && orientationError < tolerance) {
        return {
          success: true,
          positions: fkResult.positions,
          orientations: fkResult.orientations,
          jointAngles
        };
      }

      const errorVector = [
        ...positionError.toArray(),
        ...(targetOrientation
          ? this.orientationErrorVector(targetOrientation, currentOrientation).toArray()
          : []),
      ];
      const jacobian = this.geometricJacobian(joints, jointAngles, toolOffset);
      const deltaAngles = this.solveDampedLeastSquares(
        targetOrientation ? jacobian : jacobian.slice(0, 3),
        errorVector,
        damping,
      );

      // Limit the step so a singular or near-singular pose cannot fling the arm
      // across its workspace, then clamp every joint to its physical limits.
      const stepNorm = Math.hypot(...deltaAngles);
      const maxStep = 0.25;
      const scale = stepNorm > maxStep ? maxStep / stepNorm : 1;
      for (let i = 0; i < jointAngles.length; i++) {
        const joint = joints[i];
        jointAngles[i] = Math.max(
          joint.limits.min,
          Math.min(joint.limits.max, jointAngles[i] + deltaAngles[i] * scale),
        );
      }

      damping = errorVector.length > previousError ? Math.min(1, damping * 5) : Math.max(1e-6, damping * 0.7);
      previousError = errorVector.length;
    }

    return failure('Inverse kinematics did not converge');
  }

  /**
   * Deterministic restart seeds for IK: the limit midpoint plus a golden-ratio
   * lattice across the joint box, ordered by normalised distance from the
   * primary seed and de-duplicated. No randomness, so results are reproducible.
   */
  private ikRestartSeeds(joints: Joint[], primary: number[]): number[][] {
    const golden = 0.6180339887498949;
    const candidates: number[][] = [
      joints.map(joint => (joint.limits.min + joint.limits.max) / 2),
    ];
    for (let s = 0; s < 12; s++) {
      candidates.push(joints.map((joint, index) => {
        const span = joint.limits.max - joint.limits.min;
        if (!(span > 0)) return joint.limits.min;
        const fraction = (0.5 + (s + 1) * (index + 1) * golden) % 1;
        return joint.limits.min + fraction * span;
      }));
    }

    const normalisedDistance = (seed: number[]): number =>
      seed.reduce((sum, value, index) => {
        const span = joints[index].limits.max - joints[index].limits.min;
        const delta = span > 0 ? (value - primary[index]) / span : 0;
        return sum + delta * delta;
      }, 0);

    const unique = candidates.filter((seed, index) =>
      candidates.findIndex(other => other.every((value, i) => Math.abs(value - seed[i]) < 1e-9)) === index
      && seed.some((value, i) => Math.abs(value - primary[i]) > 1e-9),
    );
    return unique.sort((a, b) => normalisedDistance(a) - normalisedDistance(b));
  }

  /**
   * Geometric Jacobian of the tool point (rows: world vx, vy, vz, ωx, ωy, ωz)
   * by central differences on the actual FK chain and tool offset. No DH
   * assumptions are introduced.
   */
  private geometricJacobian(joints: Joint[], jointAngles: number[], toolOffset: THREE.Vector3): number[][] {
    const rows = 6;
    const columns = joints.length;
    const jacobian: number[][] = Array.from({ length: rows }, () => new Array(columns).fill(0));
    const step = 1e-5;

    for (let index = 0; index < columns; index += 1) {
      const anglesPlus = [...jointAngles];
      const anglesMinus = [...jointAngles];
      anglesPlus[index] += step;
      anglesMinus[index] -= step;

      const plus = this.forwardKinematics(joints, anglesPlus);
      const minus = this.forwardKinematics(joints, anglesMinus);
      if (!plus.success || !minus.success) continue;

      const positionPlus = this.toolPosition(plus, toolOffset);
      const positionMinus = this.toolPosition(minus, toolOffset);
      const linear = positionPlus.clone().sub(positionMinus).divideScalar(2 * step);
      jacobian[0][index] = linear.x;
      jacobian[1][index] = linear.y;
      jacobian[2][index] = linear.z;

      const orientationPlus = plus.orientations[plus.orientations.length - 1];
      const orientationMinus = minus.orientations[minus.orientations.length - 1];
      const angular = this.orientationErrorVector(orientationPlus, orientationMinus).divideScalar(2 * step);
      jacobian[3][index] = angular.x;
      jacobian[4][index] = angular.y;
      jacobian[5][index] = angular.z;
    }

    return jacobian;
  }

  /** Shortest rotation vector (axis·angle, world frame) taking `from` to `to`. */
  private orientationErrorVector(to: THREE.Quaternion, from: THREE.Quaternion): THREE.Vector3 {
    const delta = to.clone().multiply(from.clone().invert());
    if (delta.w < 0) {
      delta.set(-delta.x, -delta.y, -delta.z, -delta.w);
    }
    const w = Math.max(-1, Math.min(1, delta.w));
    const sinHalf = Math.sqrt(Math.max(0, 1 - w * w));
    if (sinHalf < 1e-12) return new THREE.Vector3();
    const angle = 2 * Math.acos(w);
    return new THREE.Vector3(delta.x, delta.y, delta.z).multiplyScalar(angle / sinHalf);
  }

  /**
   * Damped least squares: Δq = (JᵀJ + λ²I)⁻¹ Jᵀe. The n×n system is solved by
   * Gaussian elimination with partial pivoting.
   */
  private solveDampedLeastSquares(jacobian: number[][], error: number[], damping: number): number[] {
    const columns = jacobian[0]?.length ?? 0;
    const dampingSquared = damping * damping;
    const matrix: number[][] = Array.from({ length: columns }, (_, i) =>
      Array.from({ length: columns }, (_, j) => {
        let value = 0;
        for (const row of jacobian) value += row[i] * row[j];
        return value + (i === j ? dampingSquared : 0);
      }),
    );
    const rhs = new Array(columns).fill(0);
    for (let i = 0; i < columns; i += 1) {
      for (let row = 0; row < jacobian.length; row += 1) {
        rhs[i] += jacobian[row][i] * error[row];
      }
    }

    for (let column = 0; column < columns; column += 1) {
      let pivotRow = column;
      for (let row = column + 1; row < columns; row += 1) {
        if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivotRow][column])) pivotRow = row;
      }
      if (Math.abs(matrix[pivotRow][column]) < 1e-14) return new Array(columns).fill(0);
      if (pivotRow !== column) {
        [matrix[column], matrix[pivotRow]] = [matrix[pivotRow], matrix[column]];
        [rhs[column], rhs[pivotRow]] = [rhs[pivotRow], rhs[column]];
      }
      for (let row = column + 1; row < columns; row += 1) {
        const factor = matrix[row][column] / matrix[column][column];
        if (factor === 0) continue;
        for (let k = column; k < columns; k += 1) matrix[row][k] -= factor * matrix[column][k];
        rhs[row] -= factor * rhs[column];
      }
    }

    const solution = new Array(columns).fill(0);
    for (let row = columns - 1; row >= 0; row -= 1) {
      let sum = rhs[row];
      for (let k = row + 1; k < columns; k += 1) sum -= matrix[row][k] * solution[k];
      solution[row] = sum / matrix[row][row];
    }
    return solution;
  }

  /**
   * Numerical rigid-body dynamics for revolute/prismatic serial chains.
   *
   * Torque follows τ = M(q)·q̈ + C(q,q̇)q̇ + G(q), with the mass matrix and
   * gravity vector assembled from each link's mass, centre of mass, and inertia
   * tensor through the kinematic Jacobian. No heuristic lever arms are used.
   * `jointAccelerations` defaults to zero (gravity/velocity hold torque).
   */
  computeDynamics(
    mechanism: Mechanism,
    jointAngles: number[],
    jointVelocities: number[],
    jointAccelerations: number[] = []
  ): DynamicsResult {
    const joints = Array.from(mechanism.joints.values());
    const links = Array.from(mechanism.links.values());
    const n = joints.length;

    if (n === 0) {
      throw new Error('Dynamics requires at least one joint.');
    }
    if (jointAngles.length !== n || jointVelocities.length !== n) {
      throw new Error('Joint angle and velocity vectors must match the mechanism joint count.');
    }
    if (jointAccelerations.length !== 0 && jointAccelerations.length !== n) {
      throw new Error('Joint acceleration vector must match the mechanism joint count.');
    }
    if (!jointAngles.every(Number.isFinite) || !jointVelocities.every(Number.isFinite)) {
      throw new Error('Joint angles and velocities must be finite numbers.');
    }
    const unsupported = joints.find(joint => joint.type !== 'revolute' && joint.type !== 'prismatic');
    if (unsupported) {
      throw new Error(`Dynamics supports revolute and prismatic joints only (got "${unsupported.type}").`);
    }

    const fk = this.forwardKinematics(joints, jointAngles);
    if (!fk.success) {
      throw new Error(fk.error ?? 'Forward kinematics failed during dynamics.');
    }

    const axes = this.worldAxes(joints, fk.orientations);

    const accelerations = jointAccelerations.length === n
      ? [...jointAccelerations]
      : new Array<number>(n).fill(0);
    if (!accelerations.every(Number.isFinite)) {
      throw new Error('Joint accelerations must be finite numbers.');
    }

    const massMatrix = this.computeMassMatrix(joints, links, fk.positions, fk.orientations, axes);
    const gravity = this.computeGravityVector(joints, links, fk.positions, fk.orientations, axes);
    const velocityTorques = this.computeVelocityProductTorques(
      joints, links, jointAngles, jointVelocities,
    );

    const jointTorques = new Array<number>(n).fill(0);
    for (let j = 0; j < n; j += 1) {
      let torque = gravity[j] + velocityTorques[j];
      for (let k = 0; k < n; k += 1) {
        torque += massMatrix[j][k] * accelerations[k];
      }
      jointTorques[j] = torque;
    }

    const kinetic = 0.5 * jointVelocities.reduce(
      (sum, velocity, j) => sum + velocity * massMatrix[j].reduce(
        (rowSum, entry, k) => rowSum + entry * jointVelocities[k], 0,
      ), 0,
    );
    const potential = links.slice(0, n).reduce((sum, link, index) => {
      const com = fk.positions[index].clone()
        .add(link.centerOfMass.clone().applyQuaternion(fk.orientations[index]));
      return sum + link.mass * 9.81 * (com.y - mechanism.base.position.y);
    }, 0);

    return {
      jointTorques,
      jointVelocities: [...jointVelocities],
      jointAccelerations: accelerations,
      totalEnergy: kinetic + potential,
      massMatrixCondition: this.massMatrixCondition(massMatrix),
    };
  }

  private worldAxes(joints: Joint[], orientations: THREE.Quaternion[]): THREE.Vector3[] {
    return joints.map((joint, index) => {
      const parent = index === 0 ? new THREE.Quaternion() : orientations[index - 1];
      return joint.axis.clone().normalize().applyQuaternion(parent);
    });
  }

  private linkJacobian(
    jointIndex: number,
    com: THREE.Vector3,
    positions: THREE.Vector3[],
    axes: THREE.Vector3[],
    joints: Joint[],
  ): { linear: THREE.Vector3; angular: THREE.Vector3 } {
    if (joints[jointIndex].type === 'prismatic') {
      return { linear: axes[jointIndex].clone(), angular: new THREE.Vector3() };
    }
    return {
      linear: axes[jointIndex].clone().cross(com.clone().sub(positions[jointIndex])),
      angular: axes[jointIndex].clone(),
    };
  }

  private computeMassMatrix(
    joints: Joint[],
    links: Link[],
    positions: THREE.Vector3[],
    orientations: THREE.Quaternion[],
    axes: THREE.Vector3[],
  ): number[][] {
    const n = joints.length;
    const matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));

    for (let i = 0; i < Math.min(links.length, n); i += 1) {
      const link = links[i];
      if (!(link.mass > 0)) continue;
      const com = positions[i].clone().add(link.centerOfMass.clone().applyQuaternion(orientations[i]));
      const rotation = new THREE.Matrix3().setFromMatrix4(
        new THREE.Matrix4().makeRotationFromQuaternion(orientations[i]),
      );
      const inertiaWorld = rotation.clone().multiply(link.inertiaTensor).multiply(rotation.clone().transpose());

      const columns = [];
      for (let j = 0; j <= i; j += 1) {
        columns.push(this.linkJacobian(j, com, positions, axes, joints));
      }

      for (let j = 0; j <= i; j += 1) {
        for (let k = 0; k <= i; k += 1) {
          const rotational = columns[j].angular.clone().applyMatrix3(inertiaWorld).dot(columns[k].angular);
          matrix[j][k] += link.mass * columns[j].linear.dot(columns[k].linear) + rotational;
        }
      }
    }

    return matrix;
  }

  private computeGravityVector(
    joints: Joint[],
    links: Link[],
    positions: THREE.Vector3[],
    orientations: THREE.Quaternion[],
    axes: THREE.Vector3[],
  ): number[] {
    const gravity = new THREE.Vector3(0, -9.81, 0);
    const vector = new Array<number>(joints.length).fill(0);

    for (let i = 0; i < Math.min(links.length, joints.length); i += 1) {
      const link = links[i];
      const com = positions[i].clone().add(link.centerOfMass.clone().applyQuaternion(orientations[i]));
      for (let j = 0; j <= i; j += 1) {
        const jacobian = this.linkJacobian(j, com, positions, axes, joints);
        vector[j] -= link.mass * jacobian.linear.dot(gravity);
      }
    }

    return vector;
  }

  /**
   * C(q,q̇)q̇ via the numerical identity
   * C q̇ = Ṁ q̇ − ½ ∇(q̇ᵀ M q̇), with central differences of M.
   */
  private computeVelocityProductTorques(
    joints: Joint[],
    links: Link[],
    angles: number[],
    velocities: number[],
  ): number[] {
    const n = joints.length;
    const eps = 1e-6;
    const result = new Array<number>(n).fill(0);
    const mDot = Array.from({ length: n }, () => new Array<number>(n).fill(0));
    const gradient = new Array<number>(n).fill(0);

    for (let k = 0; k < n; k += 1) {
      if (velocities[k] === 0) continue;
      const plus = [...angles];
      const minus = [...angles];
      plus[k] += eps;
      minus[k] -= eps;

      const fkPlus = this.forwardKinematics(joints, plus);
      const fkMinus = this.forwardKinematics(joints, minus);
      if (!fkPlus.success || !fkMinus.success) {
        throw new Error('Forward kinematics failed while differentiating the mass matrix.');
      }

      const mPlus = this.computeMassMatrix(
        joints, links, fkPlus.positions, fkPlus.orientations, this.worldAxes(joints, fkPlus.orientations),
      );
      const mMinus = this.computeMassMatrix(
        joints, links, fkMinus.positions, fkMinus.orientations, this.worldAxes(joints, fkMinus.orientations),
      );
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) {
          mDot[i][j] += ((mPlus[i][j] - mMinus[i][j]) / (2 * eps)) * velocities[k];
        }
      }

      const kinetic = (matrix: number[][]) => 0.5 * velocities.reduce(
        (sum, velocity, i) => sum + velocity * matrix[i].reduce(
          (rowSum, entry, j) => rowSum + entry * velocities[j], 0,
        ), 0,
      );
      gradient[k] = (kinetic(mPlus) - kinetic(mMinus)) / (2 * eps);
    }

    for (let i = 0; i < n; i += 1) {
      let mDotTimesVelocity = 0;
      for (let j = 0; j < n; j += 1) {
        mDotTimesVelocity += mDot[i][j] * velocities[j];
      }
      result[i] = mDotTimesVelocity - gradient[i];
    }

    return result;
  }

  /** λmin/λmax of a symmetric positive-semidefinite matrix via Jacobi rotations. */
  private massMatrixCondition(matrix: number[][]): number {
    const n = matrix.length;
    if (n === 0) return 1;
    const a = matrix.map(row => [...row]);

    for (let sweep = 0; sweep < 60; sweep += 1) {
      let offDiagonal = 0;
      for (let p = 0; p < n - 1; p += 1) {
        for (let q = p + 1; q < n; q += 1) offDiagonal += a[p][q] ** 2;
      }
      if (offDiagonal < 1e-20) break;

      for (let p = 0; p < n - 1; p += 1) {
        for (let q = p + 1; q < n; q += 1) {
          if (Math.abs(a[p][q]) < 1e-15) continue;
          const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
          const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
          const c = 1 / Math.sqrt(t * t + 1);
          const s = t * c;

          for (let k = 0; k < n; k += 1) {
            const akp = a[k][p];
            const akq = a[k][q];
            a[k][p] = c * akp - s * akq;
            a[k][q] = s * akp + c * akq;
          }
          for (let k = 0; k < n; k += 1) {
            const apk = a[p][k];
            const aqk = a[q][k];
            a[p][k] = c * apk - s * aqk;
            a[q][k] = s * apk + c * aqk;
          }
        }
      }
    }

    const diagonal = a.map((row, index) => row[index]);
    const max = Math.max(...diagonal);
    const min = Math.min(...diagonal);
    if (!(max > 0) || !Number.isFinite(max) || !Number.isFinite(min)) return 0;
    return Math.max(0, Math.min(1, min / max));
  }

  // Trajectory Planning

  /**
   * Normalized position profile s(u), u ∈ [0,1]. Peak derivatives are used to
   * size a duration that respects every joint's velocity and acceleration
   * limit. The trapezoid uses 25% acceleration, 50% cruise, 25% deceleration.
   */
  private profileValue(profile: Trajectory['profile'], u: number): number {
    const t = Math.max(0, Math.min(1, u));
    switch (profile) {
      case 'linear':
        return t;
      case 'cubic':
        return 3 * t * t - 2 * t * t * t;
      case 'quintic':
        return 10 * t * t * t - 15 * t * t * t * t + 6 * t * t * t * t * t;
      case 'trapezoidal': {
        const ta = 0.25;
        const td = 0.25;
        const peakVelocity = 1 / (1 - ta / 2 - td / 2);
        if (t <= ta) return 0.5 * (peakVelocity / ta) * t * t;
        if (t <= 1 - td) return 0.5 * peakVelocity * ta + peakVelocity * (t - ta);
        const remaining = 1 - t;
        return 1 - 0.5 * (peakVelocity / td) * remaining * remaining;
      }
      default:
        return t;
    }
  }

  /** Peak |s'| and |s''| for each profile; `linear` has no acceleration bound. */
  private static readonly PROFILE_PEAKS: Record<Trajectory['profile'], { velocity: number; acceleration: number }> = {
    linear: { velocity: 1, acceleration: 0 },
    cubic: { velocity: 1.5, acceleration: 6 },
    quintic: { velocity: 1.875, acceleration: 5.773502691896258 },
    trapezoidal: { velocity: 4 / 3, acceleration: 16 / 3 },
  };

  /**
   * Shortest duration at which the profile stays inside every joint's declared
   * velocity/acceleration limit. Throws when a moving joint has no positive
   * limit, because the trajectory could not then be certified as feasible.
   */
  private minimumDuration(
    start: number[],
    end: number[],
    joints: Joint[],
    profile: Trajectory['profile'],
  ): number {
    const peaks = AdvancedRobotics.PROFILE_PEAKS[profile] ?? AdvancedRobotics.PROFILE_PEAKS.linear;
    let duration = 0;
    for (let index = 0; index < joints.length; index += 1) {
      const distance = Math.abs(end[index] - start[index]);
      if (distance === 0) continue;
      const joint = joints[index];
      if (!(joint.velocity > 0) || !Number.isFinite(joint.velocity)) {
        throw new Error(`Joint ${joint.name} has no positive velocity limit; cannot certify the trajectory.`);
      }
      if (peaks.acceleration > 0 && (!(joint.acceleration > 0) || !Number.isFinite(joint.acceleration))) {
        throw new Error(`Joint ${joint.name} has no positive acceleration limit; cannot certify the trajectory.`);
      }
      duration = Math.max(duration, (distance * peaks.velocity) / joint.velocity);
      if (peaks.acceleration > 0) {
        duration = Math.max(duration, Math.sqrt((distance * peaks.acceleration) / joint.acceleration));
      }
    }
    return duration;
  }

  /**
   * Plan a synchronized joint-space move. The requested duration is treated as
   * a lower bound: if any joint's velocity or acceleration limit would be
   * exceeded, the move is stretched to the shortest feasible duration. Every
   * joint follows the same normalized profile, so they start and finish
   * together. `linear` bounds velocity only; its acceleration is impulsive.
   */
  planTrajectory(
    mechanism: Mechanism,
    startConfig: number[],
    endConfig: number[],
    duration: number,
    profile: Trajectory['profile'] = 'quintic'
  ): Trajectory {
    const joints = Array.from(mechanism.joints.values());
    if (joints.length === 0) throw new Error('A trajectory needs at least one joint.');
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Trajectory duration must be a positive finite number');
    this.assertProfile(profile);
    if (startConfig.length !== joints.length || endConfig.length !== joints.length) {
      throw new Error(`Trajectory configurations must contain ${joints.length} joint values`);
    }
    for (let index = 0; index < joints.length; index += 1) {
      const joint = joints[index];
      if (![startConfig[index], endConfig[index]].every(value =>
        Number.isFinite(value) && value >= joint.limits.min && value <= joint.limits.max
      )) {
        throw new Error(`Trajectory joint ${joint.name} exceeds its position limits`);
      }
    }

    const trajectoryId = this.makeId('trajectory');
    const actualDuration = Math.max(duration, this.minimumDuration(startConfig, endConfig, joints, profile));
    const waypoints = this.generateTrajectoryWaypoints(
      mechanism, startConfig, endConfig, actualDuration, profile,
    );

    // Limits only constrain joints that actually move; a stationary joint's
    // zero limit must not make an otherwise feasible move look impossible.
    const moving = joints.filter((_, index) => startConfig[index] !== endConfig[index]);
    const maxVelocity = moving.length > 0
      ? Math.min(...moving.map((joint) => joint.velocity))
      : Number.POSITIVE_INFINITY;
    const maxAcceleration = moving.length > 0
      ? Math.min(...moving.map((joint) => joint.acceleration))
      : Number.POSITIVE_INFINITY;

    const trajectory: Trajectory = {
      id: trajectoryId,
      name: `Trajectory ${trajectoryId}`,
      waypoints,
      duration: actualDuration,
      profile,
      constraints: {
        maxVelocity,
        maxAcceleration,
        // No joint-level jerk limit exists in the model; the value is not
        // enforced and must not be presented as a certified bound.
        maxJerk: Number.POSITIVE_INFINITY,
      }
    };

    this.trajectories.set(trajectoryId, trajectory);
    return trajectory;
  }

  /** Reject an unrecognised runtime profile instead of silently falling back to linear. */
  private assertProfile(profile: Trajectory['profile']): void {
    if (!Object.prototype.hasOwnProperty.call(AdvancedRobotics.PROFILE_PEAKS, profile)) {
      throw new Error(`Unknown trajectory profile "${String(profile)}".`);
    }
  }

  private generateTrajectoryWaypoints(
    mechanism: Mechanism,
    start: number[],
    end: number[],
    duration: number,
    profile: Trajectory['profile']
  ): TrajectoryWaypoint[] {
    const joints = Array.from(mechanism.joints.values());
    const sampleCount = 101;
    const waypoints: TrajectoryWaypoint[] = [];

    for (let i = 0; i < sampleCount; i += 1) {
      const normalized = i / (sampleCount - 1);
      const time = duration * normalized;
      // interpolateJointAngle applies the profile; pass normalized time, not
      // the already-eased fraction, or the profile would be applied twice and
      // the sampled peak velocity would exceed the limit.
      const jointAngles = start.map((startAngle, index) =>
        this.interpolateJointAngle(startAngle, end[index], normalized, profile),
      );

      const fkResult = this.forwardKinematics(joints, jointAngles);
      if (!fkResult.success || fkResult.positions.length === 0) {
        throw new Error(fkResult.error ?? 'Forward kinematics failed while sampling the trajectory.');
      }
      waypoints.push({
        position: this.toolPosition(fkResult, mechanism.endEffector.position)
          .add(mechanism.base.position),
        orientation: fkResult.orientations[fkResult.orientations.length - 1].clone(),
        time,
        jointAngles,
      });
    }

    return waypoints;
  }

  private interpolateJointAngle(start: number, end: number, t: number, profile: Trajectory['profile']): number {
    return start + this.profileValue(profile, t) * (end - start);
  }

  // Collision Detection

  /**
   * Link-link collision test using each link's oriented bounding box. Pairs
   * joined by the same joint are skipped because they are connected by design.
   *
   * This is a conservative box test: it can report contact between concave
   * meshes whose boxes overlap, and it never reports more than box precision.
   * It is deliberately not presented as mesh-level contact detection.
   */
  checkCollisions(
    mechanism: Mechanism,
    jointAngles?: number[],
  ): CollisionContact[] {
    const joints = Array.from(mechanism.joints.values());
    const angles = jointAngles ?? joints.map(joint => joint.angle);
    if (angles.length !== joints.length) {
      throw new Error(`Collision check needs ${joints.length} joint values, got ${angles.length}.`);
    }
    const fkResult = this.forwardKinematics(joints, angles);
    if (!fkResult.success) {
      throw new Error(fkResult.error ?? 'Forward kinematics failed during collision checking.');
    }

    const links = Array.from(mechanism.links.values());
    const bounds = links.map((link, index) => {
      const position = (fkResult.positions[index] ?? new THREE.Vector3())
        .clone()
        .add(mechanism.base.position);
      const orientation = fkResult.orientations[index] ?? new THREE.Quaternion();
      return this.orientedBounds(link, position, orientation);
    });

    const collisions: CollisionContact[] = [];
    for (let i = 0; i < links.length; i += 1) {
      for (let j = i + 1; j < links.length; j += 1) {
        const first = bounds[i];
        const second = bounds[j];
        if (!first || !second || this.linksShareJoint(links[i], links[j])) continue;
        const contact = this.intersectOrientedBoxes(first, second);
        if (contact) {
          collisions.push({
            link1: links[i].id,
            link2: links[j].id,
            contactPoint: contact.contactPoint,
            normal: contact.normal,
            penetration: contact.penetration,
          });
        }
      }
    }

    return collisions;
  }

  /** True when the two links meet at a shared joint and may touch legitimately. */
  private linksShareJoint(first: Link, second: Link): boolean {
    return (first.parentJoint !== undefined && second.childJoints.includes(first.parentJoint))
      || (second.parentJoint !== undefined && first.childJoints.includes(second.parentJoint));
  }

  private orientedBounds(
    link: Link,
    position: THREE.Vector3,
    orientation: THREE.Quaternion,
  ): OrientedBox | null {
    const geometry = link.geometry;
    if (!geometry.getAttribute('position')) return null;
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    const box = geometry.boundingBox;
    if (!box || box.isEmpty()) return null;

    const center = box.getCenter(new THREE.Vector3())
      .applyQuaternion(orientation)
      .add(position);
    const size = box.getSize(new THREE.Vector3()).multiplyScalar(0.5);
    const axes: [THREE.Vector3, THREE.Vector3, THREE.Vector3] = [
      new THREE.Vector3(1, 0, 0).applyQuaternion(orientation),
      new THREE.Vector3(0, 1, 0).applyQuaternion(orientation),
      new THREE.Vector3(0, 0, 1).applyQuaternion(orientation),
    ];
    return {
      center,
      axes,
      halfExtents: [size.x, size.y, size.z],
    };
  }

  /**
   * Separating-axis test for two oriented boxes. Returns the minimum-overlap
   * axis, oriented from the first box towards the second, plus the overlap
   * depth and a point on the second box's contacting face.
   */
  private intersectOrientedBoxes(
    first: OrientedBox,
    second: OrientedBox,
  ): { normal: THREE.Vector3; penetration: number; contactPoint: THREE.Vector3 } | null {
    const axes: THREE.Vector3[] = [...first.axes, ...second.axes];
    for (const axisA of first.axes) {
      for (const axisB of second.axes) {
        const cross = axisA.clone().cross(axisB);
        if (cross.lengthSq() > 1e-12) axes.push(cross.normalize());
      }
    }

    const delta = second.center.clone().sub(first.center);
    let bestOverlap = Number.POSITIVE_INFINITY;
    let bestAxis: THREE.Vector3 | null = null;

    for (const raw of axes) {
      const axis = raw.clone().normalize();
      const firstRadius = this.projectionRadius(first, axis);
      const secondRadius = this.projectionRadius(second, axis);
      const distance = Math.abs(axis.dot(delta));
      const overlap = firstRadius + secondRadius - distance;
      if (overlap <= 0) return null;
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestAxis = axis;
      }
    }
    if (!bestAxis) return null;
    if (bestAxis.dot(delta) < 0) bestAxis.negate();

    const contactPoint = second.center.clone()
      .addScaledVector(bestAxis, -this.projectionRadius(second, bestAxis));
    return { normal: bestAxis, penetration: bestOverlap, contactPoint };
  }

  private projectionRadius(box: OrientedBox, axis: THREE.Vector3): number {
    return Math.abs(axis.dot(box.axes[0])) * box.halfExtents[0]
      + Math.abs(axis.dot(box.axes[1])) * box.halfExtents[1]
      + Math.abs(axis.dot(box.axes[2])) * box.halfExtents[2];
  }

  // Export for 3D Printing/Manufacturing

  /**
   * Binary-safe ASCII STL of the assembled mechanism at the given joint values.
   *
   * Two details matter for a file that a slicer can actually use:
   * - coordinates are written in **millimetres** (scene units are metres), and
   * - each link carries its world rotation, not just its joint position, so the
   *   exported solid matches the pose on screen.
   *
   * Geometry is emitted triangle-by-triangle from the mesh, so non-box links
   * keep their true shape. Degenerate triangles are dropped; a link with no
   * position attribute is an error rather than a silently missing part.
   */
  exportMechanismSTL(
    mechanism: Mechanism,
    jointAngles: number[],
    options: { units?: 'mm' | 'm' } = {},
  ): string {
    const joints = Array.from(mechanism.joints.values());
    if (jointAngles.length !== joints.length) {
      throw new Error(`STL export needs ${joints.length} joint values, got ${jointAngles.length}.`);
    }
    const fkResult = this.forwardKinematics(joints, jointAngles);
    if (!fkResult.success) {
      throw new Error(fkResult.error ?? 'Forward kinematics failed during STL export.');
    }

    const units = options.units ?? 'mm';
    const scale = units === 'mm' ? 1000 : 1;
    const solidName = `mechanism_${units}`;
    let stl = `solid ${solidName}\n`;

    Array.from(mechanism.links.values()).forEach((link, index) => {
      const position = (fkResult.positions[index] ?? new THREE.Vector3())
        .clone()
        .add(mechanism.base.position);
      const orientation = fkResult.orientations[index] ?? new THREE.Quaternion();
      stl += this.generateLinkSTL(link, position, orientation, scale);
    });

    stl += `endsolid ${solidName}\n`;
    return stl;
  }

  private generateLinkSTL(
    link: Link,
    position: THREE.Vector3,
    orientation: THREE.Quaternion,
    scale: number,
  ): string {
    const geometry = link.geometry;
    const attribute = geometry.getAttribute('position');
    if (!attribute) {
      throw new Error(`Link ${link.name} has no position geometry to export.`);
    }
    const index = geometry.getIndex();
    const vertexCount = index ? index.count : attribute.count;
    if (vertexCount % 3 !== 0) {
      throw new Error(`Link ${link.name} geometry does not contain whole triangles.`);
    }
    if (index) {
      for (let i = 0; i < index.count; i += 1) {
        const vertex = index.getX(i);
        if (!Number.isInteger(vertex) || vertex < 0 || vertex >= attribute.count) {
          throw new Error(`Link ${link.name} has a triangle index outside its vertex buffer.`);
        }
      }
    }
    for (let i = 0; i < attribute.count; i += 1) {
      if (!Number.isFinite(attribute.getX(i)) || !Number.isFinite(attribute.getY(i)) || !Number.isFinite(attribute.getZ(i))) {
        throw new Error(`Link ${link.name} has a non-finite vertex coordinate.`);
      }
    }

    // compose() scales the basis but writes the translation verbatim, so the
    // base position must be converted to the output unit explicitly.
    const world = new THREE.Matrix4().compose(
      position.clone().multiplyScalar(scale),
      orientation,
      new THREE.Vector3(scale, scale, scale),
    );
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const ab = new THREE.Vector3();
    const ac = new THREE.Vector3();
    const normal = new THREE.Vector3();
    let stl = '';

    for (let triangle = 0; triangle < vertexCount / 3; triangle += 1) {
      const offset = triangle * 3;
      a.fromBufferAttribute(attribute, index ? index.getX(offset) : offset).applyMatrix4(world);
      b.fromBufferAttribute(attribute, index ? index.getX(offset + 1) : offset + 1).applyMatrix4(world);
      c.fromBufferAttribute(attribute, index ? index.getX(offset + 2) : offset + 2).applyMatrix4(world);

      normal.crossVectors(ab.subVectors(b, a), ac.subVectors(c, a));
      if (normal.lengthSq() < 1e-20) continue; // Degenerate facet.
      normal.normalize();

      stl += `  facet normal ${AdvancedRobotics.stlNumber(normal.x)} ${AdvancedRobotics.stlNumber(normal.y)} ${AdvancedRobotics.stlNumber(normal.z)}\n`;
      stl += '    outer loop\n';
      stl += `      vertex ${AdvancedRobotics.stlNumber(a.x)} ${AdvancedRobotics.stlNumber(a.y)} ${AdvancedRobotics.stlNumber(a.z)}\n`;
      stl += `      vertex ${AdvancedRobotics.stlNumber(b.x)} ${AdvancedRobotics.stlNumber(b.y)} ${AdvancedRobotics.stlNumber(b.z)}\n`;
      stl += `      vertex ${AdvancedRobotics.stlNumber(c.x)} ${AdvancedRobotics.stlNumber(c.y)} ${AdvancedRobotics.stlNumber(c.z)}\n`;
      stl += '    endloop\n';
      stl += '  endfacet\n';
    }

    return stl;
  }

  /** Fixed-point formatting keeps very small coordinates readable to slicers. */
  private static stlNumber(value: number): string {
    if (!Number.isFinite(value)) {
      throw new Error('STL export produced a non-finite coordinate.');
    }
    return value.toFixed(9);
  }

  // Getters
  getMechanism(id: string): Mechanism | undefined {
    return this.mechanisms.get(id);
  }

  getAllMechanisms(): Mechanism[] {
    return Array.from(this.mechanisms.values());
  }

  getTrajectory(id: string): Trajectory | undefined {
    return this.trajectories.get(id);
  }

  getAllTrajectories(): Trajectory[] {
    return Array.from(this.trajectories.values());
  }

  /**
   * Replay a joint-space motion at the given sample interval.
   *
   * With a `target`, the joints follow the same profile used by the planner and
   * the requested duration must be long enough to respect every joint's limits;
   * a shorter request is rejected rather than silently violating them. `start`
   * defaults to the mechanism's stored joint angles. Without a target, the
   * declared joint rates are integrated from rest. Angles are clamped to the
   * joint limits in both cases, which models hitting a hard stop.
   *
   * The returned series always ends exactly at `duration`, and each frame runs
   * the oriented-box collision check at that frame's pose.
   */
  simulateMechanism(
    mechanismId: string,
    duration: number,
    timeStep: number,
    options?: { target: number[]; profile?: Trajectory['profile']; start?: number[] },
  ): Array<{
    time: number;
    jointAngles: number[];
    endEffectorPosition: THREE.Vector3;
    collisions: CollisionContact[];
  }> {
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Simulation duration must be a positive finite number');
    }
    if (!Number.isFinite(timeStep) || timeStep <= 0) {
      throw new Error('Simulation time step must be a positive finite number');
    }

    const mechanism = this.mechanisms.get(mechanismId);
    if (!mechanism) throw new Error(`Mechanism "${mechanismId}" not found.`);

    const joints = Array.from(mechanism.joints.values());
    // `start` lets a caller replay a move from the pose it was planned at
    // without mutating the stored mechanism; otherwise use the stored pose.
    const startAngles = options?.start ? [...options.start] : joints.map(joint => joint.angle);
    if (startAngles.length !== joints.length) {
      throw new Error(`Simulation start must contain ${joints.length} joint values`);
    }
    const profile = options?.profile ?? 'quintic';
    this.assertProfile(profile);

    if (options) {
      if (options.target.length !== joints.length) {
        throw new Error(`Simulation target must contain ${joints.length} joint values`);
      }
      joints.forEach((joint, index) => {
        const target = options.target[index];
        const start = startAngles[index];
        if (!Number.isFinite(target) || target < joint.limits.min || target > joint.limits.max) {
          throw new Error(`Simulation target for joint ${joint.name} is outside its limits`);
        }
        if (!Number.isFinite(start) || start < joint.limits.min || start > joint.limits.max) {
          throw new Error(`Simulation start for joint ${joint.name} is outside its limits`);
        }
      });
      const minimum = this.minimumDuration(startAngles, options.target, joints, profile);
      if (duration + 1e-9 < minimum) {
        throw new Error(
          `Simulation duration ${duration}s is shorter than the ${minimum.toFixed(6)}s needed to respect the joint limits.`,
        );
      }
    }

    const clamp = (value: number, index: number): number =>
      Math.max(joints[index].limits.min, Math.min(joints[index].limits.max, value));

    const anglesAt = (time: number): number[] => startAngles.map((start, index) => {
      const next = options
        ? this.interpolateJointAngle(start, options.target[index], time / duration, profile)
        : start + joints[index].velocity * time;
      return clamp(next, index);
    });

    const buildFrame = (time: number, jointAngles: number[]) => {
      const fkResult = this.forwardKinematics(joints, jointAngles);
      if (!fkResult.success) {
        throw new Error(fkResult.error ?? 'Forward kinematics failed during simulation.');
      }
      return {
        time,
        jointAngles,
        endEffectorPosition: this.toolPosition(fkResult, mechanism.endEffector.position)
          .add(mechanism.base.position),
        collisions: this.checkCollisions(mechanism, jointAngles),
      };
    };

    // Sample strictly before the end, then always emit the exact final instant
    // so the last frame is the commanded endpoint even when the step does not
    // divide the duration.
    const times: number[] = [];
    const wholeSteps = Math.floor(duration / timeStep + 1e-12);
    for (let step = 1; step <= wholeSteps; step += 1) {
      const time = step * timeStep;
      if (time < duration - 1e-12) times.push(time);
    }
    times.push(duration);

    return times.map(time => buildFrame(time, anglesAt(time)));
  }
}

export const advancedRobotics = new AdvancedRobotics();