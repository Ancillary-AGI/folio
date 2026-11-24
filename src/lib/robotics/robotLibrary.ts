/**
 * Robot architectures the robotics workspace can actually solve.
 *
 * The engine in `advancedRobotics.ts` forward-kinematics a *serial* chain:
 * joint i carries link i and the next joint rides at that link's end. Parallel
 * machines (delta, Stewart, SCARA-with-closed-loop-quill) need constraint
 * solving this codebase does not implement, so they are not offered here — a
 * library row that drops a mechanism the solver would reject is worse than no
 * row at all.
 *
 * Every architecture is a *class* of machine (a 6-axis 850 mm cobot, a 500 mm
 * SCARA) described by the numbers that class publishes: travel, rated speed,
 * payload, link lengths. The rows say they are class data, not one vendor's
 * datasheet, because quoting a specific model's joint limits without its
 * handbook would be a fabrication.
 *
 * Convention, shared with `demoArm.ts` and the kinematics regression tests:
 * Y is up, the base yaws about +Y, pitching joints turn about +X, and a link
 * grows along the axis its joint swings it into.
 */
import * as THREE from 'three'
import {
  advancedRobotics,
  type Joint,
  type Link,
  type Mechanism,
} from './advancedRobotics'

export type RobotArchitectureId =
  | 'cobot-6r-850'
  | 'industrial-6r-900'
  | 'scara-500'
  | 'gantry-400'
  | 'desktop-4r-280'
  | 'planar-2r-220'

/** Revolute limits are degrees, prismatic limits metres. */
export interface RobotJointSpec {
  name: string
  type: 'revolute' | 'prismatic'
  axis: [number, number, number]
  /** Where this joint sits relative to the previous joint frame, metres. */
  offset: [number, number, number]
  minLimit: number
  maxLimit: number
  /** rad/s for a revolute joint, m/s for a prismatic one. */
  velocity: number
  acceleration: number
  /** Rated torque (N·m) or force (N); informational, as the engine states. */
  rating: number
  /** The link this joint carries. `lengthM` 0 draws no link. */
  link: {
    name: string
    lengthM: number
    /** Cylinder radius or box edge, metres. */
    sizeM: number
    shape: 'cylinder' | 'box' | 'sphere'
    massKg: number
    /** Direction the link grows from its joint: up the arm or out the wrist. */
    grows: '+Y' | '-Y' | '+X' | 'none'
  }
}

export interface RobotArchitecture {
  id: RobotArchitectureId
  name: string
  /** Grouping label in the dock. */
  category: string
  dof: number
  reachMm: number
  payloadKg: number
  /** Short right-aligned readout for the dock row. */
  spec: string
  description: string
  tags: string[]
  joints: RobotJointSpec[]
}

const DEG = Math.PI / 180

/** Cylindrical arm link: radius `sizeM`, growing along `grows`. */
function linkGeometry(joint: RobotJointSpec): THREE.BufferGeometry {
  const { shape, sizeM: size, lengthM, grows } = joint.link
  if (shape === 'sphere') return new THREE.SphereGeometry(size)
  if (shape === 'box') {
    const box = grows === '+X'
      ? new THREE.BoxGeometry(lengthM, size, size)
      : new THREE.BoxGeometry(size, lengthM, size)
    if (grows === '+X') box.translate(lengthM / 2, 0, 0)
    else box.translate(0, grows === '-Y' ? -lengthM / 2 : lengthM / 2, 0)
    return box
  }
  const cylinder = new THREE.CylinderGeometry(size, size, lengthM)
  // A cylinder's own axis is +Y, so a vertical link needs no rotation; one
  // reaching out along +X is tipped over by −90° about Z.
  if (grows === '+X') cylinder.rotateZ(-Math.PI / 2).translate(lengthM / 2, 0, 0)
  else cylinder.translate(0, grows === '-Y' ? -lengthM / 2 : lengthM / 2, 0)
  return cylinder
}

/** Solid box / cylinder / sphere inertia about the link's own centre, kg·m². */
function linkInertia(joint: RobotJointSpec): THREE.Matrix3 {
  const { shape, sizeM: size, lengthM } = joint.link
  const mass = joint.link.massKg
  if (shape === 'sphere') {
    const value = 0.4 * mass * size * size
    return new THREE.Matrix3().set(value, 0, 0, 0, value, 0, 0, 0, value)
  }
  if (shape === 'cylinder') {
    const axial = 0.5 * mass * size * size
    const radial = (mass * (3 * size * size + lengthM * lengthM)) / 12
    return new THREE.Matrix3().set(radial, 0, 0, 0, axial, 0, 0, 0, radial)
  }
  const along = joint.link.grows === '+X' ? new THREE.Vector3(lengthM, size, size) : new THREE.Vector3(size, lengthM, size)
  return boxInertiaMatrix(mass, along)
}

/** Box inertia about its centre for a body of the given edge lengths, kg·m². */
export function boxInertiaMatrix(mass: number, size: THREE.Vector3): THREE.Matrix3 {
  const [x, y, z] = size.toArray()
  return new THREE.Matrix3().set(
    (mass * (y * y + z * z)) / 12, 0, 0,
    0, (mass * (x * x + z * z)) / 12, 0,
    0, 0, (mass * (x * x + y * y)) / 12,
  )
}

function linkCenter(joint: RobotJointSpec): THREE.Vector3 {
  const { lengthM, grows } = joint.link
  if (grows === '+X') return new THREE.Vector3(lengthM / 2, 0, 0)
  if (grows === '+Y') return new THREE.Vector3(0, lengthM / 2, 0)
  if (grows === '-Y') return new THREE.Vector3(0, -lengthM / 2, 0)
  return new THREE.Vector3(0, 0, 0)
}

/** Revolute limits arrive in degrees; the engine works in radians. */
function jointLimits(joint: RobotJointSpec): { min: number; max: number } {
  return joint.type === 'revolute'
    ? { min: joint.minLimit * DEG, max: joint.maxLimit * DEG }
    : { min: joint.minLimit, max: joint.maxLimit }
}

/**
 * Build the mechanism into the engine and return it.
 *
 * `advancedRobotics` keeps a registry, so this registers the machine the same
 * way the demo arms do and the panel's FK/IK/dynamics calls work unchanged.
 */
export function buildRobotMechanism(architecture: RobotArchitecture): Mechanism {
  const joints: Omit<Joint, 'id'>[] = architecture.joints.map((joint) => ({
    name: joint.name,
    type: joint.type,
    position: new THREE.Vector3(...joint.offset),
    axis: new THREE.Vector3(...joint.axis),
    limits: jointLimits(joint),
    velocity: joint.velocity,
    acceleration: joint.acceleration,
    torque: joint.rating,
    angle: 0,
  }))

  const links: Omit<Link, 'id'>[] = architecture.joints
    // The engine pairs joint i with link i by declaration order, so every joint
    // carries a body — a wrist roll gets a node, not an absent link.
    .map((joint) => ({
      name: joint.link.name,
      geometry: linkGeometry(joint),
      material: new THREE.MeshPhongMaterial({ color: 0x99a3ad }),
      mass: joint.link.massKg,
      centerOfMass: linkCenter(joint),
      inertiaTensor: linkInertia(joint),
      childJoints: [],
    }))

  const yaw = architecture.joints[0]?.axis.join(',')
  const upright = yaw === '0,1,0'
  const lastLink = architecture.joints.at(-1)?.link
  const toolOffset = new THREE.Vector3(0, 0, 0)
  if (lastLink) {
    if (lastLink.grows === '+X') toolOffset.x = lastLink.lengthM
    else if (lastLink.grows === '+Y') toolOffset.y = lastLink.lengthM
    else if (lastLink.grows === '-Y') toolOffset.y = -lastLink.lengthM
  }
  return advancedRobotics.createMechanism({
    name: architecture.name,
    type: 'serial',
    joints,
    links,
    basePosition: new THREE.Vector3(0, upright ? 0.05 : 0, 0),
    endEffectorOffset: toolOffset,
  })
}

/** 6-axis collaborative arm: 850 mm reach, 5 kg payload, class of UR5e. */
const COBOT_6R_850: RobotArchitecture = {
  id: 'cobot-6r-850',
  name: '6-axis cobot, 850 mm / 5 kg',
  category: 'Collaborative arms',
  dof: 6,
  reachMm: 850,
  payloadKg: 5,
  spec: '6R · 850 mm · 5 kg',
  description:
    'Collaborative 6-axis class: 425 mm upper arm, 392 mm forearm, wrist stack 109/109/93 mm. Class data, not one vendor datasheet.',
  tags: ['6-axis', 'cobot', 'collaborative', 'articulated'],
  joints: [
    {
      name: 'Base', type: 'revolute', axis: [0, 1, 0], offset: [0, 0, 0],
      minLimit: -360, maxLimit: 360, velocity: 3.14, acceleration: 6.28, rating: 90,
      link: { name: 'Base housing', lengthM: 0.11, sizeM: 0.075, shape: 'cylinder', massKg: 3.6, grows: '+Y' },
    },
    {
      name: 'Shoulder', type: 'revolute', axis: [1, 0, 0], offset: [0, 0.06, 0],
      minLimit: -180, maxLimit: 180, velocity: 3.14, acceleration: 6.28, rating: 90,
      link: { name: 'Upper arm', lengthM: 0.425, sizeM: 0.045, shape: 'cylinder', massKg: 3.2, grows: '+Y' },
    },
    {
      name: 'Elbow', type: 'revolute', axis: [1, 0, 0], offset: [0, 0.425, 0],
      minLimit: -360, maxLimit: 360, velocity: 3.14, acceleration: 7.54, rating: 45,
      link: { name: 'Forearm', lengthM: 0.392, sizeM: 0.038, shape: 'cylinder', massKg: 1.8, grows: '+Y' },
    },
    {
      name: 'Wrist 1', type: 'revolute', axis: [1, 0, 0], offset: [0, 0.392, 0],
      minLimit: -360, maxLimit: 360, velocity: 6.28, acceleration: 12.56, rating: 18,
      link: { name: 'Wrist unit', lengthM: 0.109, sizeM: 0.032, shape: 'cylinder', massKg: 0.9, grows: '+Y' },
    },
    {
      name: 'Wrist 2', type: 'revolute', axis: [1, 0, 0], offset: [0, 0.109, 0],
      minLimit: -180, maxLimit: 180, velocity: 6.28, acceleration: 12.56, rating: 18,
      link: { name: 'Wrist bend', lengthM: 0.109, sizeM: 0.028, shape: 'cylinder', massKg: 0.6, grows: '+Y' },
    },
    {
      name: 'Tool flange', type: 'revolute', axis: [0, 1, 0], offset: [0, 0.093, 0],
      minLimit: -360, maxLimit: 360, velocity: 6.28, acceleration: 12.56, rating: 9,
      link: { name: 'Flange', lengthM: 0.01, sizeM: 0.038, shape: 'sphere', massKg: 0.3, grows: 'none' },
    },
  ],
}

/** 6-axis industrial arm: 911 mm reach, 8 kg payload, KR AGILUS / GP8 class. */
const INDUSTRIAL_6R_900: RobotArchitecture = {
  id: 'industrial-6r-900',
  name: '6-axis industrial, 911 mm / 8 kg',
  category: 'Industrial arms',
  dof: 6,
  reachMm: 911,
  payloadKg: 8,
  spec: '6R · 911 mm · 8 kg',
  description:
    'Small industrial 6-axis class: 430 mm upper arm, 380 mm forearm, faster wrist rates and higher joint ratings than the cobot class. Class data.',
  tags: ['6-axis', 'industrial', 'articulated'],
  joints: [
    {
      name: 'Axis 1 (base)', type: 'revolute', axis: [0, 1, 0], offset: [0, 0, 0],
      minLimit: -185, maxLimit: 185, velocity: 4.4, acceleration: 12, rating: 200,
      link: { name: 'Machine base', lengthM: 0.145, sizeM: 0.095, shape: 'box', massKg: 16, grows: '+Y' },
    },
    {
      name: 'Axis 2 (shoulder)', type: 'revolute', axis: [1, 0, 0], offset: [0, 0.1, 0],
      minLimit: -120, maxLimit: 155, velocity: 4.2, acceleration: 12, rating: 200,
      link: { name: 'Upper arm', lengthM: 0.43, sizeM: 0.06, shape: 'box', massKg: 9, grows: '+Y' },
    },
    {
      name: 'Axis 3 (elbow)', type: 'revolute', axis: [1, 0, 0], offset: [0, 0.43, 0],
      minLimit: -80, maxLimit: 165, velocity: 4.6, acceleration: 14, rating: 90,
      link: { name: 'Forearm', lengthM: 0.38, sizeM: 0.05, shape: 'box', massKg: 5, grows: '+Y' },
    },
    {
      name: 'Axis 4 (wrist roll)', type: 'revolute', axis: [0, 1, 0], offset: [0, 0.38, 0],
      minLimit: -370, maxLimit: 370, velocity: 7.5, acceleration: 20, rating: 30,
      link: { name: 'Wrist tube', lengthM: 0.12, sizeM: 0.042, shape: 'cylinder', massKg: 2.4, grows: '+Y' },
    },
    {
      name: 'Axis 5 (wrist bend)', type: 'revolute', axis: [1, 0, 0], offset: [0, 0.12, 0],
      minLimit: -125, maxLimit: 125, velocity: 7.5, acceleration: 20, rating: 30,
      link: { name: 'Wrist bend', lengthM: 0.08, sizeM: 0.036, shape: 'cylinder', massKg: 1.4, grows: '+Y' },
    },
    {
      name: 'Axis 6 (flange)', type: 'revolute', axis: [0, 1, 0], offset: [0, 0.08, 0],
      minLimit: -370, maxLimit: 370, velocity: 9.4, acceleration: 25, rating: 20,
      link: { name: 'Flange', lengthM: 0.012, sizeM: 0.04, shape: 'sphere', massKg: 0.8, grows: 'none' },
    },
  ],
}

/** SCARA: two planar revolute axes, quill Z and tool theta. 500 mm / 3 kg class. */
const SCARA_500: RobotArchitecture = {
  id: 'scara-500',
  name: 'SCARA, 500 mm / 3 kg',
  category: 'SCARA and gantry',
  dof: 4,
  reachMm: 500,
  payloadKg: 3,
  spec: 'RRPR · 500 mm · 3 kg',
  description:
    'SCARA class for pick-and-place: 250 mm link 1, 250 mm link 2, 100 mm quill stroke and a theta axis. Modelled as the serial chain its kinematics are. Class data.',
  tags: ['scara', 'pick-and-place', '4-axis'],
  joints: [
    {
      name: 'Theta 1 (shoulder)', type: 'revolute', axis: [0, 1, 0], offset: [0, 0, 0],
      minLimit: -135, maxLimit: 135, velocity: 6.3, acceleration: 30, rating: 40,
      link: { name: 'Link 1', lengthM: 0.25, sizeM: 0.035, shape: 'box', massKg: 2.2, grows: '+X' },
    },
    {
      name: 'Theta 2 (elbow)', type: 'revolute', axis: [0, 1, 0], offset: [0.25, 0, 0],
      minLimit: -145, maxLimit: 145, velocity: 8.4, acceleration: 40, rating: 20,
      link: { name: 'Link 2', lengthM: 0.25, sizeM: 0.03, shape: 'box', massKg: 1.4, grows: '+X' },
    },
    {
      name: 'Quill (Z)', type: 'prismatic', axis: [0, -1, 0], offset: [0.25, 0, 0],
      minLimit: 0, maxLimit: 0.1, velocity: 1.5, acceleration: 10, rating: 60,
      link: { name: 'Quill', lengthM: 0.1, sizeM: 0.025, shape: 'cylinder', massKg: 0.9, grows: '-Y' },
    },
    {
      name: 'Theta 3 (tool)', type: 'revolute', axis: [0, 1, 0], offset: [0, -0.1, 0],
      minLimit: -360, maxLimit: 360, velocity: 9.4, acceleration: 40, rating: 6,
      link: { name: 'Tool plate', lengthM: 0.008, sizeM: 0.04, shape: 'sphere', massKg: 0.25, grows: 'none' },
    },
  ],
}

/** Cartesian gantry: X, Y, Z prismatic axes on a 400 × 400 × 100 mm bed. */
const GANTRY_400: RobotArchitecture = {
  id: 'gantry-400',
  name: 'Cartesian gantry, 400 × 400 × 100 mm',
  category: 'SCARA and gantry',
  dof: 3,
  reachMm: 574,
  payloadKg: 3,
  spec: 'PPP · 400×400×100 mm',
  description:
    'Gantry class: 400 mm X, 400 mm Y, 100 mm Z with 400 mm/s rapid rate. Reach is the bed diagonal. Class data.',
  tags: ['cartesian', 'gantry', 'delta-style', 'bed'],
  joints: [
    {
      name: 'X carriage', type: 'prismatic', axis: [1, 0, 0], offset: [-0.2, 0.2, 0],
      minLimit: 0, maxLimit: 0.4, velocity: 0.4, acceleration: 2, rating: 50,
      link: { name: 'X beam', lengthM: 0.4, sizeM: 0.02, shape: 'box', massKg: 1.2, grows: '+X' },
    },
    {
      name: 'Y carriage', type: 'prismatic', axis: [0, 0, 1], offset: [0, 0, -0.2],
      minLimit: 0, maxLimit: 0.4, velocity: 0.4, acceleration: 2, rating: 50,
      link: { name: 'Y beam', lengthM: 0.4, sizeM: 0.02, shape: 'box', massKg: 0.9, grows: '+X' },
    },
    {
      name: 'Z spindle', type: 'prismatic', axis: [0, -1, 0], offset: [0, 0, 0.2],
      minLimit: 0, maxLimit: 0.1, velocity: 0.2, acceleration: 1.5, rating: 30,
      link: { name: 'Spindle', lengthM: 0.08, sizeM: 0.02, shape: 'cylinder', massKg: 0.6, grows: '+Y' },
    },
  ],
}

/** Desktop 4-axis arm: 280 mm reach, 250 g payload. */
const DESKTOP_4R_280: RobotArchitecture = {
  id: 'desktop-4r-280',
  name: 'Desktop 4-axis arm, 280 mm / 250 g',
  category: 'Desktop and education',
  dof: 4,
  reachMm: 280,
  payloadKg: 0.25,
  spec: '4R · 280 mm · 250 g',
  description:
    'Servo-driven desktop arm class: 150 mm upper arm, 100 mm forearm, wrist pitch and yaw. Class data.',
  tags: ['desktop', 'education', '4-axis'],
  joints: [
    {
      name: 'Base yaw', type: 'revolute', axis: [0, 1, 0], offset: [0, 0, 0],
      minLimit: -150, maxLimit: 150, velocity: 1.2, acceleration: 4, rating: 3,
      link: { name: 'Base turret', lengthM: 0.05, sizeM: 0.04, shape: 'cylinder', massKg: 0.4, grows: '+Y' },
    },
    {
      name: 'Shoulder pitch', type: 'revolute', axis: [1, 0, 0], offset: [0, 0.05, 0],
      minLimit: -110, maxLimit: 110, velocity: 1.2, acceleration: 4, rating: 3,
      link: { name: 'Upper arm', lengthM: 0.15, sizeM: 0.02, shape: 'box', massKg: 0.25, grows: '+Y' },
    },
    {
      name: 'Elbow pitch', type: 'revolute', axis: [1, 0, 0], offset: [0, 0.15, 0],
      minLimit: -120, maxLimit: 120, velocity: 1.5, acceleration: 5, rating: 1.5,
      link: { name: 'Forearm', lengthM: 0.1, sizeM: 0.016, shape: 'box', massKg: 0.15, grows: '+Y' },
    },
    {
      name: 'Wrist yaw', type: 'revolute', axis: [0, 1, 0], offset: [0, 0.1, 0],
      minLimit: -90, maxLimit: 90, velocity: 1.5, acceleration: 5, rating: 0.6,
      link: { name: 'Gripper', lengthM: 0.02, sizeM: 0.018, shape: 'sphere', massKg: 0.06, grows: 'none' },
    },
  ],
}

/** Planar 2-link arm: hand-checkable tip position, matches the demo chain. */
const PLANAR_2R_220: RobotArchitecture = {
  id: 'planar-2r-220',
  name: 'Planar 2-link arm, 220 mm',
  category: 'Desktop and education',
  dof: 2,
  reachMm: 220,
  payloadKg: 0.2,
  spec: '2R · 220 mm · planar',
  description:
    'Two revolute joints about +Z with 120 mm and 100 mm links along +X. At θ = 0, 0 the tip is exactly 220 mm out, which is what the kinematics test asserts.',
  tags: ['planar', 'education', '2-axis'],
  joints: [
    {
      name: 'Shoulder', type: 'revolute', axis: [0, 0, 1], offset: [0, 0, 0],
      minLimit: -180, maxLimit: 180, velocity: 1.5, acceleration: 3, rating: 1,
      link: { name: 'Upper arm', lengthM: 0.12, sizeM: 0.012, shape: 'box', massKg: 0.15, grows: '+X' },
    },
    {
      name: 'Elbow', type: 'revolute', axis: [0, 0, 1], offset: [0.12, 0, 0],
      minLimit: -90, maxLimit: 90, velocity: 1.5, acceleration: 3, rating: 0.6,
      link: { name: 'Forearm', lengthM: 0.1, sizeM: 0.01, shape: 'box', massKg: 0.1, grows: '+X' },
    },
  ],
}

export const ROBOT_ARCHITECTURES: readonly RobotArchitecture[] = [
  COBOT_6R_850,
  INDUSTRIAL_6R_900,
  SCARA_500,
  GANTRY_400,
  DESKTOP_4R_280,
  PLANAR_2R_220,
]

export function robotArchitectureById(id: RobotArchitectureId): RobotArchitecture {
  const found = ROBOT_ARCHITECTURES.find((architecture) => architecture.id === id)
  if (!found) throw new Error(`Unknown robot architecture: ${id}.`)
  return found
}
