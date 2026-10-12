/**
 * Mechanism manufacturability — the gate a robotics design must pass before it is
 * exported to a printer or a mill.
 *
 * A mechanism that simulates perfectly is not necessarily printable: a link can be
 * longer than the build volume, a joint can be assembled past its own stop, and a link
 * carrying a payload can buckle or yield long before the kinematics complain. This
 * module answers those questions with the same closed-form structural mechanics used
 * elsewhere in the mechanical domain, so the verdict is a calculation rather than an
 * opinion.
 *
 * Every check is independent: bed fit is pure geometry, joint limits compare the
 * assembled pose against declared stops, and the stress checks come from
 * `../mechanical/structural` (Euler buckling, `Mc/I`, section modulus). Nothing here
 * smooths over a failure — the report lists each reason, and `manufacturable` is false
 * if any check failed.
 */

import {
  axialStress,
  bendingStress,
  circleInertia,
  eulerBucklingLoad,
  rectangleInertia,
} from '../mechanical/structural';

/** A printable link, described without any renderer or three.js dependency. */
export interface PrintableLink {
  id: string;
  /** Distance from this joint to the next, millimetres. */
  length: number;
  /** Cross-section depth used for the bending section modulus, millimetres. */
  depth: number;
  /** Cross-section width, millimetres; `'round'` links use the depth as a diameter. */
  width: number;
  section: 'round' | 'rectangular';
  /** Mass of the link plus everything it carries beyond, kilograms. */
  mass: number;
}

/** A revolute joint and the travel it is allowed. */
export interface JointLimit {
  id: string;
  /** Declared minimum, radians. */
  min: number;
  /** Declared maximum, radians. */
  max: number;
  /** Angle the mechanism is assembled at, radians. */
  assembled: number;
}

export interface MaterialSpec {
  /** Young's modulus, **pascals**. */
  modulus: number;
  /** Yield strength, **pascals**. The bending check compares against this. */
  yieldStrength: number;
}

export interface PrinterSpec {
  /** Build envelope, millimetres. */
  bedWidth: number;
  bedDepth: number;
  bedHeight: number;
}

export interface ManufacturabilityInput {
  links: readonly PrintableLink[];
  /**
   * Declared joint travel. Optional: a mechanism may legitimately have no limits
   * declared, in which case the envelope still folds by each link's own angle and no
   * joint-limit finding can be raised.
   */
  joints?: readonly JointLimit[];
  material: MaterialSpec;
  printer: PrinterSpec;
  /** Payload the end effector must carry, newtons, applied at the last link's tip. */
  payload: number;
}

export interface Finding {
  check: 'bed-fit' | 'joint-limit' | 'buckling' | 'bending';
  /** `'link'` or `'joint'`. */
  subject: string;
  reason: string;
  /** The margin as a fraction of the limit; negative means the limit was exceeded. */
  margin: number;
}

export interface ManufacturabilityReport {
  manufacturable: boolean;
  findings: Finding[];
  /** Total mass of the mechanism, kilograms. */
  totalMass: number;
  /** Axis-aligned bounding box of the assembled mechanism, millimetres. */
  envelope: { width: number; depth: number; height: number };
}

function positive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number, got ${value}.`);
  }
}

/** Second moment of area of a link's cross-section, in mm⁴. */
function linkInertia(link: PrintableLink): number {
  return link.section === 'round'
    ? circleInertia(link.depth)
    : rectangleInertia(link.width, link.depth);
}

/** Distance to the extreme fibre, millimetres. */
function linkExtremeFibre(link: PrintableLink): number {
  // Both sections are symmetric about the bending axis, so half the depth.
  return link.depth / 2;
}

/** Cross-sectional area in mm², used for the axial stress from the payload. */
function linkArea(link: PrintableLink): number {
  return link.section === 'round'
    ? (Math.PI * link.depth * link.depth) / 4
    : link.width * link.depth;
}

/**
 * Bounding box of the mechanism laid out in a straight line from the base. The real
 * assembled pose is folded by the joint angles, so the horizontal reach uses the sum of
 * each link's projected length and the height is the tallest link standing off the bed.
 */
function envelopeOf(
  links: readonly PrintableLink[],
  joints: readonly JointLimit[],
): { width: number; depth: number; height: number } {
  let reach = 0;
  let height = 0;
  links.forEach((link, index) => {
    const angle = joints[index]?.assembled ?? 0;
    reach += Math.abs(link.length * Math.cos(angle));
    height = Math.max(height, Math.abs(link.length * Math.sin(angle)));
  });
  const thickest = links.reduce((max, link) => Math.max(max, link.depth), 0);
  return { width: reach, depth: thickest, height: height + thickest };
}

/**
 * Runs every check and returns a report. `manufacturable` is true only when the list of
 * findings is empty, so a caller cannot mistake a skipped check for a passing one.
 */
export function assessManufacturability(
  input: ManufacturabilityInput,
): ManufacturabilityReport {
  const { links, joints = [], material, printer, payload } = input;
  if (links.length === 0) throw new Error('A mechanism needs at least one link.');
  positive(material.modulus, 'material.modulus');
  positive(material.yieldStrength, 'material.yieldStrength');
  positive(printer.bedWidth, 'printer.bedWidth');
  positive(printer.bedDepth, 'printer.bedDepth');
  positive(printer.bedHeight, 'printer.bedHeight');
  if (!Number.isFinite(payload) || payload < 0) {
    throw new Error(`payload must be a non-negative finite number, got ${payload}.`);
  }

  const findings: Finding[] = [];
  const envelope = envelopeOf(links, joints);
  const totalMass = links.reduce((sum, link) => sum + link.mass, 0);

  // Section geometry is in millimetres, so the structural maths runs in the mm set:
  // stress in N/mm² (which is MPa), load in newtons, and the material constants scaled
  // from pascals to N/mm² once, here. Mixing the two would compare MPa against Pa and
  // never trip a limit, which is exactly the bug this conversion exists to prevent.
  const yieldMPa = material.yieldStrength / 1e6;
  const modulusMPa = material.modulus / 1e6;

  // Bed fit: the envelope must fit, and no single link may exceed the smallest axis.
  const smallest = Math.min(printer.bedWidth, printer.bedDepth);
  if (envelope.width > printer.bedWidth) {
    findings.push({
      check: 'bed-fit',
      subject: 'mechanism',
      reason: `Assembled reach ${envelope.width.toFixed(1)} mm exceeds the ${printer.bedWidth} mm bed width.`,
      margin: (printer.bedWidth - envelope.width) / printer.bedWidth,
    });
  }
  if (envelope.height > printer.bedHeight) {
    findings.push({
      check: 'bed-fit',
      subject: 'mechanism',
      reason: `Assembled height ${envelope.height.toFixed(1)} mm exceeds the ${printer.bedHeight} mm bed height.`,
      margin: (printer.bedHeight - envelope.height) / printer.bedHeight,
    });
  }
  for (const link of links) {
    positive(link.length, `link ${link.id} length`);
    positive(link.depth, `link ${link.id} depth`);
    if (link.length > smallest) {
      findings.push({
        check: 'bed-fit',
        subject: link.id,
        reason: `Link ${link.id} is ${link.length.toFixed(1)} mm long, past the ${smallest.toFixed(1)} mm smallest bed axis.`,
        margin: (smallest - link.length) / smallest,
      });
    }
  }

  // Joint limits: the assembled angle must sit inside the declared travel.
  for (const joint of joints) {
    if (!Number.isFinite(joint.assembled)) {
      throw new Error(`Joint ${joint.id} has a non-finite assembled angle.`);
    }
    if (joint.min > joint.max) {
      throw new Error(`Joint ${joint.id} has min ${joint.min} greater than max ${joint.max}.`);
    }
    if (joint.assembled < joint.min || joint.assembled > joint.max) {
      findings.push({
        check: 'joint-limit',
        subject: joint.id,
        reason: `Joint ${joint.id} is assembled at ${joint.assembled.toFixed(3)} rad, outside [${joint.min}, ${joint.max}].`,
        margin:
          joint.assembled < joint.min
            ? joint.assembled - joint.min
            : joint.max - joint.assembled,
      });
    }
  }

  // Structural: each link is a cantilever carrying everything downstream of it.
  let carried = payload;
  for (let index = links.length - 1; index >= 0; index -= 1) {
    const link = links[index];
    const inertia = linkInertia(link);
    const extremeFibre = linkExtremeFibre(link);

    // Bending at the root from the load at the tip, in N·mm against MPa of yield.
    const moment = carried * link.length;
    const stress = bendingStress(moment, extremeFibre, inertia);
    if (stress > yieldMPa) {
      findings.push({
        check: 'bending',
        subject: link.id,
        reason:
          `Link ${link.id} sees ${stress.toFixed(1)} MPa bending against a ` +
          `${yieldMPa.toFixed(1)} MPa yield strength.`,
        margin: yieldMPa / Math.max(stress, Number.EPSILON) - 1,
      });
    }

    // Axial crush at the same section, from the same load.
    const axial = axialStress(-carried, linkArea(link));
    if (Math.abs(axial) > yieldMPa) {
      findings.push({
        check: 'bending',
        subject: link.id,
        reason:
          `Link ${link.id} sees ${Math.abs(axial).toFixed(1)} MPa axial compression ` +
          `against a ${yieldMPa.toFixed(1)} MPa yield strength.`,
        margin: yieldMPa / Math.max(Math.abs(axial), Number.EPSILON) - 1,
      });
    }

    // Euler buckling with the load as the axial force and a fixed-free column.
    const critical = eulerBucklingLoad(modulusMPa, inertia, link.length, 'fixed-free');
    if (carried > critical) {
      findings.push({
        check: 'buckling',
        subject: link.id,
        reason:
          `Link ${link.id} carries ${carried.toFixed(1)} N against an Euler critical load ` +
          `of ${critical.toFixed(1)} N.`,
        margin: critical / Math.max(carried, Number.EPSILON) - 1,
      });
    }

    // This link's own weight becomes part of what its parent has to hold.
    carried += link.mass * 9.81;
  }

  return { manufacturable: findings.length === 0, findings, totalMass, envelope };
}
