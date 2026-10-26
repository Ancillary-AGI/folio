/**
 * Demo arm: planar 2-link pick arm (L1 = 120 mm, L2 = 100 mm).
 *
 * The mechanical demo proves enclosure thermal; this proves the robotics
 * loop on the SAME pattern: FK-verified reach via the tested DH engine,
 * a timed trapezoidal move under velocity/acceleration limits, and a STEP
 * export gated on manufacturability (bed fit + joint stops + buckling).
 * Hand-verifiable: at θ1 = 0, θ2 = 0 the tip sits at (220, 0) mm; folding
 * to θ1 = 90°, θ2 = 0 puts it at (0, 220) mm. Proven by `demoArm.test.ts`.
 */
import {
  manipulatorPose,
  planTimedTrajectory,
  type Pose,
} from '../robotics/serialManipulator';
import {
  describeMechanism,
  exportMechanismStep,
  type GatedExport,
  type LinkMeasurement,
} from '../robotics/mechanismExport';
import type { DhJoint } from '../mechanical/kinematics';
import * as THREE from 'three';
import {
  advancedRobotics,
  type Joint,
  type Link,
  type Mechanism,
} from '../robotics/advancedRobotics';

export const ARM_L1_MM = 120;
export const ARM_L2_MM = 100;

export interface DemoArm {
  home: Pose;
  folded: Pose;
  reachMm: number;
  durationS: number;
  peakVel: number;
  samples: number;
  export: GatedExport;
  verdict: string;
}

/** DH chain of the planar arm: two revolute joints about Z, links along X. */
export function armChain(theta1: number, theta2: number): DhJoint[] {
  return [
    { kind: 'revolute', a: ARM_L1_MM / 1000, alpha: 0, d: 0, theta: theta1 },
    { kind: 'revolute', a: ARM_L2_MM / 1000, alpha: 0, d: 0, theta: theta2 },
  ];
}

export function buildDemoArm(): DemoArm {
  const home = manipulatorPose(armChain(0, 0));
  const folded = manipulatorPose(armChain(Math.PI / 2, 0));
  const reachMm = (ARM_L1_MM + ARM_L2_MM);
  // Timed joint move: shoulder sweeps 90° in joint space under limits.
  const planned = planTimedTrajectory([0, 0], [Math.PI / 2, 0], { maxVelocity: 1.5, maxAcceleration: 4 });
  const durationS = planned.profile.duration;
  const peakVel = planned.profile.peakVelocity;
  const measurements: LinkMeasurement[] = [
    { id: 'link-1', length: ARM_L1_MM, depth: 12, mass: 0.15, angle: 0, jointMin: -Math.PI, jointMax: Math.PI },
    { id: 'link-2', length: ARM_L2_MM, depth: 10, mass: 0.1, angle: 0, jointMin: -Math.PI, jointMax: Math.PI },
  ];
  const { links, joints } = describeMechanism(measurements, 'rectangular');
  const exported = exportMechanismStep(
    links,
    {
      joints,
      material: { modulus: 2e9, yieldStrength: 50e6 },
      printer: { bedWidth: 220, bedDepth: 220, bedHeight: 250 },
      payload: 0.2 * 9.81,
    },
    { jointBore: 5, name: 'folio-demo-arm' },
  );
  const verdict = exported.ok
    ? `PASS: 2-link arm reaches ${reachMm} mm, move takes ${durationS.toFixed(2)} s, STEP exported.`
    : `FAIL: export refused — ${exported.findings.map((f) => `${f.subject}: ${f.reason}`).join('; ')}`;
  return { home, folded, reachMm, durationS, peakVel, samples: planned.samples.length, export: exported, verdict };
}

/** Solid-box inertia about its centre of mass, kg·m². */
function boxInertia(mass: number, size: THREE.Vector3): THREE.Matrix3 {
  const [x, y, z] = size.toArray();
  return new THREE.Matrix3().set(
    (mass * (y * y + z * z)) / 12, 0, 0,
    0, (mass * (x * x + z * z)) / 12, 0,
    0, 0, (mass * (x * x + y * y)) / 12,
  );
}

/** Solid cylinder inertia about its centre, with the axis along local Y. */
function cylinderInertia(mass: number, radius: number, height: number): THREE.Matrix3 {
  const axial = 0.5 * mass * radius * radius;
  const radial = (mass * (3 * radius * radius + height * height)) / 12;
  return new THREE.Matrix3().set(radial, 0, 0, 0, axial, 0, 0, 0, radial);
}

/** Solid sphere inertia about its centre. */
function sphereInertia(mass: number, radius: number): THREE.Matrix3 {
  const value = 0.4 * mass * radius * radius;
  return new THREE.Matrix3().set(value, 0, 0, 0, value, 0, 0, 0, value);
}

/**
 * Six-DOF serial arm for the Advanced Robotics panel, in a Y-up world: the
 * base yaws about +Y, then the shoulder/elbow/wrist pitch about +X. Pitching
 * about the links' own Y axis would only twist the chain, so the sliders would
 * appear inert. Link cylinders start at their joint and run to the next one.
 *
 * Geometry is shared with the solver tests so the FK/IK regression covers the
 * exact arm the UI draws.
 */
/** Planar two-link arm matching the kinematics used by `buildDemoArm`. */
export function buildTwoLinkDemoMechanism(): Mechanism {
  const l1 = ARM_L1_MM / 1000;
  const l2 = ARM_L2_MM / 1000;
  const joints: Omit<Joint, 'id'>[] = [
    {
      name: 'Shoulder',
      type: 'revolute',
      position: new THREE.Vector3(0, 0, 0),
      axis: new THREE.Vector3(0, 0, 1),
      limits: { min: -Math.PI, max: Math.PI },
      velocity: 1.5,
      acceleration: 3,
      torque: 0,
      angle: 0,
    },
    {
      name: 'Elbow',
      type: 'revolute',
      position: new THREE.Vector3(l1, 0, 0),
      axis: new THREE.Vector3(0, 0, 1),
      limits: { min: -Math.PI / 2, max: Math.PI / 2 },
      velocity: 1.5,
      acceleration: 3,
      torque: 0,
      angle: 0,
    },
  ];
  const links: Omit<Link, 'id'>[] = [
    {
      name: 'Upper Arm',
      geometry: new THREE.BoxGeometry(l1, 0.03, 0.03).translate(l1 / 2, 0, 0),
      material: new THREE.MeshPhongMaterial({ color: 0x888888 }),
      mass: 0.15,
      centerOfMass: new THREE.Vector3(l1 / 2, 0, 0),
      inertiaTensor: boxInertia(0.15, new THREE.Vector3(l1, 0.03, 0.03)),
      childJoints: [],
    },
    {
      name: 'Forearm',
      geometry: new THREE.BoxGeometry(l2, 0.025, 0.025).translate(l2 / 2, 0, 0),
      material: new THREE.MeshPhongMaterial({ color: 0xaaaaaa }),
      mass: 0.1,
      centerOfMass: new THREE.Vector3(l2 / 2, 0, 0),
      inertiaTensor: boxInertia(0.1, new THREE.Vector3(l2, 0.025, 0.025)),
      childJoints: [],
    },
  ];
  return advancedRobotics.createMechanism({
    name: '2-Link Planar Arm',
    type: 'serial',
    joints,
    links,
    basePosition: new THREE.Vector3(0, 0.05, 0),
    endEffectorOffset: new THREE.Vector3(l2, 0, 0),
  });
}

export function buildSixDofDemoMechanism(): Mechanism {
  const joints: Omit<Joint, 'id'>[] = [
    {
      name: 'Base Rotation',
      type: 'revolute',
      position: new THREE.Vector3(0, 0, 0),
      axis: new THREE.Vector3(0, 1, 0),
      limits: { min: -Math.PI, max: Math.PI },
      velocity: 1.5,
      acceleration: 3,
      torque: 0,
      angle: 0,
    },
    {
      name: 'Shoulder',
      type: 'revolute',
      position: new THREE.Vector3(0, 0.1, 0),
      axis: new THREE.Vector3(1, 0, 0),
      limits: { min: -Math.PI / 2, max: Math.PI / 2 },
      velocity: 1.5,
      acceleration: 3,
      torque: 0,
      angle: 0,
    },
    {
      name: 'Elbow',
      type: 'revolute',
      position: new THREE.Vector3(0, 0.3, 0),
      axis: new THREE.Vector3(1, 0, 0),
      limits: { min: -Math.PI, max: 0 },
      velocity: 1.5,
      acceleration: 3,
      torque: 0,
      angle: 0,
    },
    {
      name: 'Wrist Pitch',
      type: 'revolute',
      position: new THREE.Vector3(0, 0.25, 0),
      axis: new THREE.Vector3(1, 0, 0),
      limits: { min: -Math.PI / 2, max: Math.PI / 2 },
      velocity: 1.5,
      acceleration: 3,
      torque: 0,
      angle: 0,
    },
    {
      name: 'Wrist Roll',
      type: 'revolute',
      position: new THREE.Vector3(0, 0.08, 0),
      axis: new THREE.Vector3(0, 1, 0),
      limits: { min: -Math.PI, max: Math.PI },
      velocity: 1.5,
      acceleration: 3,
      torque: 0,
      angle: 0,
    },
    {
      name: 'Gripper',
      type: 'prismatic',
      // Offset along the arm axis: co-locating the gripper with the wrist
      // makes their (unrelated) bounding boxes overlap in every pose.
      position: new THREE.Vector3(0, 0.06, 0),
      axis: new THREE.Vector3(0, 1, 0),
      limits: { min: 0, max: 0.1 },
      velocity: 0.05,
      acceleration: 0.2,
      torque: 0,
      angle: 0,
    },
  ];

  const links: Omit<Link, 'id'>[] = [
    {
      name: 'Base Link',
      geometry: new THREE.BoxGeometry(0.1, 0.1, 0.1),
      material: new THREE.MeshPhongMaterial({ color: 0x666666 }),
      mass: 2.0,
      centerOfMass: new THREE.Vector3(0, 0, 0),
      inertiaTensor: boxInertia(2.0, new THREE.Vector3(0.1, 0.1, 0.1)),
      childJoints: [],
    },
    {
      name: 'Upper Arm',
      geometry: new THREE.CylinderGeometry(0.03, 0.03, 0.3).translate(0, 0.15, 0),
      material: new THREE.MeshPhongMaterial({ color: 0x888888 }),
      mass: 1.5,
      centerOfMass: new THREE.Vector3(0, 0.15, 0),
      inertiaTensor: cylinderInertia(1.5, 0.03, 0.3),
      childJoints: [],
    },
    {
      name: 'Forearm',
      geometry: new THREE.CylinderGeometry(0.025, 0.025, 0.25).translate(0, 0.125, 0),
      material: new THREE.MeshPhongMaterial({ color: 0xaaaaaa }),
      mass: 1.0,
      centerOfMass: new THREE.Vector3(0, 0.125, 0),
      inertiaTensor: cylinderInertia(1.0, 0.025, 0.25),
      childJoints: [],
    },
    {
      name: 'Wrist',
      geometry: new THREE.SphereGeometry(0.02),
      material: new THREE.MeshPhongMaterial({ color: 0xcccccc }),
      mass: 0.5,
      centerOfMass: new THREE.Vector3(0, 0, 0),
      inertiaTensor: sphereInertia(0.5, 0.02),
      childJoints: [],
    },
    {
      name: 'Gripper Base',
      geometry: new THREE.BoxGeometry(0.04, 0.04, 0.04),
      material: new THREE.MeshPhongMaterial({ color: 0xdddddd }),
      mass: 0.3,
      centerOfMass: new THREE.Vector3(0, 0, 0),
      inertiaTensor: boxInertia(0.3, new THREE.Vector3(0.04, 0.04, 0.04)),
      childJoints: [],
    },
    {
      name: 'Gripper Fingers',
      geometry: new THREE.BoxGeometry(0.02, 0.08, 0.02),
      material: new THREE.MeshPhongMaterial({ color: 0x444444 }),
      mass: 0.2,
      centerOfMass: new THREE.Vector3(0, 0, 0),
      inertiaTensor: boxInertia(0.2, new THREE.Vector3(0.02, 0.08, 0.02)),
      childJoints: [],
    },
  ];

  return advancedRobotics.createMechanism({
    name: '6-DOF Robotic Arm',
    type: 'serial',
    joints,
    links,
    basePosition: new THREE.Vector3(0, 0, 0),
    // Tool point extends past the gripper along the arm axis (+Y).
    endEffectorOffset: new THREE.Vector3(0, 0.05, 0),
  });
}
