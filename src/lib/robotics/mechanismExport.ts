/**
 * Mechanism export — STEP geometry plus the gate that must pass first.
 *
 * `advancedRobotics.exportMechanismSTL` needs a live three.js scene, so it cannot run
 * in a test or in the light path. These functions describe a mechanism as plain numbers
 * instead: link lengths, sections and assembled angles. That keeps the export testable,
 * and it means the manufacturability verdict and the exported solid are computed from
 * the same description rather than from two different models that can disagree.
 *
 * The export is refused when the gate fails. Returning `ok: false` with the findings is
 * the whole point: a design that would buckle, jam a joint or overhang the printer must
 * not produce a file that looks ready to print.
 */

import { boxFaces, holePrism, stepDocument } from '../manufacturing/stepGeometry';
import { assessManufacturability, type ManufacturabilityInput } from './manufacturability';

/** One link in the export description, in millimetres. */
export interface ExportLink {
  id: string;
  length: number;
  /** Cross-section depth, millimetres. */
  depth: number;
  /** Cross-section width for a rectangular section, millimetres. */
  width: number;
  section: 'round' | 'rectangular';
  mass: number;
  /** Angle of the joint driving this link, radians. */
  angle: number;
}

export interface MechanismExportOptions {
  /** Diameter of the bore through each joint, millimetres; `0` omits the holes. */
  jointBore: number;
  /** Name written into the STEP header. */
  name: string;
}

export interface MechanismExport {
  ok: true;
  step: string;
  /** Axis-aligned bounds of the exported solid, millimetres. */
  bounds: { minX: number; maxX: number; minY: number; maxY: number; minZ: number; maxZ: number };
  /** Total length of the chain along its own axis, millimetres. */
  chainLength: number;
}

export interface MechanismExportBlocked {
  ok: false;
  /** Why the export was refused, one entry per failed check. */
  findings: ReturnType<typeof assessManufacturability>['findings'];
}

export type GatedExport = MechanismExport | MechanismExportBlocked;

/** Raw per-link measurements taken from a renderer's scene graph. */
export interface LinkMeasurement {
  id: string;
  /** Longest horizontal extent of the link's geometry, millimetres. */
  length: number;
  /** Depth of the link's cross-section, millimetres. */
  depth: number;
  mass: number;
  /** Assembled angle of the joint driving this link, radians. */
  angle: number;
  /** Declared travel of that joint, radians. */
  jointMin: number;
  jointMax: number;
}

/**
 * Turns renderer measurements into the plain descriptions the gate and the geometry
 * share. Keeping this a separate step means `mechanismExport` never imports three.js,
 * so the export path is testable and usable outside the 3D view.
 *
 * Link indices and joint indices must line up: the panel builds `jointAngles` by
 * walking `mechanism.joints` in insertion order, exactly as `initializeJointAngles`
 * and `simulateMechanism` do, and this preserves that pairing.
 */
export function describeMechanism(
  measurements: readonly LinkMeasurement[],
  section: 'round' | 'rectangular' = 'round',
): { links: ExportLink[]; joints: ManufacturabilityInput['joints'] } {
  if (measurements.length === 0) throw new Error('A mechanism needs at least one link.');
  const links: ExportLink[] = [];
  const joints: ManufacturabilityInput['joints'] = [];
  measurements.forEach((measurement, index) => {
    if (!Number.isFinite(measurement.length) || measurement.length <= 0) {
      throw new Error(`Link ${measurement.id} has an invalid length: ${measurement.length}.`);
    }
    if (!Number.isFinite(measurement.depth) || measurement.depth <= 0) {
      throw new Error(`Link ${measurement.id} has an invalid depth: ${measurement.depth}.`);
    }
    if (!Number.isFinite(measurement.mass) || measurement.mass < 0) {
      throw new Error(`Link ${measurement.id} has an invalid mass: ${measurement.mass}.`);
    }
    // A NaN angle would otherwise reach the STEP geometry as a NaN coordinate, which
    // produces a file that no CAM system can read.
    if (!Number.isFinite(measurement.angle)) {
      throw new Error(`Link ${measurement.id} has a non-finite angle: ${measurement.angle}.`);
    }
    if (!Number.isFinite(measurement.jointMin) || !Number.isFinite(measurement.jointMax)) {
      throw new Error(`Link ${measurement.id} has a non-finite joint limit.`);
    }
    if (measurement.jointMin > measurement.jointMax) {
      throw new Error(
        `Link ${measurement.id} has joint min ${measurement.jointMin} greater than max ${measurement.jointMax}.`,
      );
    }
    links.push({
      id: measurement.id,
      length: measurement.length,
      depth: measurement.depth,
      width: measurement.depth,
      section,
      mass: measurement.mass,
      angle: measurement.angle,
    });
    joints.push({
      id: `${measurement.id}-joint-${index}`,
      min: measurement.jointMin,
      max: measurement.jointMax,
      assembled: measurement.angle,
    });
  });
  return { links, joints };
}

/**
 * The gate and the geometry in one call. Runs every manufacturability check and returns
 * the STEP only when all of them pass, so a caller physically cannot obtain a file for a
 * design that would fail on the bench or the printer.
 *
 * When the caller does not supply joint limits, each link's own angle is checked against
 * a full ±π revolute stop. Supplied limits take precedence, because a real joint may
 * travel less than that and the caller knows its mechanism.
 */
export function exportMechanismStep(
  links: readonly ExportLink[],
  input: Omit<ManufacturabilityInput, 'links'>,
  options: MechanismExportOptions,
): GatedExport {
  const derivedJoints = links.map((link) => ({
    id: `${link.id}-joint`,
    min: -Math.PI,
    max: Math.PI,
    assembled: link.angle,
  }));
  const report = assessManufacturability({
    ...input,
    joints: input.joints && input.joints.length > 0 ? input.joints : derivedJoints,
    links: links.map((link) => ({
      id: link.id,
      length: link.length,
      depth: link.depth,
      width: link.width,
      section: link.section,
      mass: link.mass,
    })),
  });
  if (!report.manufacturable) return { ok: false, findings: report.findings };
  return mechanismStep(links, options);
}

/**
 * Lays a serial chain out along +X, folding each link by its joint angle, and returns
 * the STEP text for it. Each link is a box spanning from its joint to the next, with an
 * optional bore at the joint it swings about.
 *
 * The layout is the same projection the manufacturability gate measures, so the exported
 * solid and the reach verdict cannot describe two different mechanisms.
 */
export function mechanismStep(
  links: readonly ExportLink[],
  options: MechanismExportOptions,
): MechanismExport {
  if (links.length === 0) throw new Error('A mechanism needs at least one link to export.');
  if (!Number.isFinite(options.jointBore) || options.jointBore < 0) {
    throw new Error(`jointBore must be a non-negative finite number, got ${options.jointBore}.`);
  }

  const faces: number[][][] = [];
  let x = 0;
  let y = 0;
  let angle = 0;
  let minX = 0;
  let maxX = 0;
  let minY = 0;
  let maxY = 0;
  let maxZ = 0;

  for (const link of links) {
    if (!Number.isFinite(link.length) || link.length <= 0) {
      throw new Error(`Link ${link.id} has an invalid length: ${link.length}.`);
    }
    if (!Number.isFinite(link.angle)) {
      throw new Error(`Link ${link.id} has a non-finite angle: ${link.angle}.`);
    }
    angle += link.angle;
    const half = link.depth / 2;
    const dx = link.length * Math.cos(angle);
    const dy = link.length * Math.sin(angle);

    // A box from this joint to the next, standing half its depth above the plane.
    faces.push(...boxFaces(x, y - half, 0, x + dx, y + dy + half, link.depth));
    if (options.jointBore > 0) {
      faces.push(...holePrism(x, y + dy / 2, 0, link.depth, options.jointBore));
    }

    minX = Math.min(minX, x, x + dx);
    maxX = Math.max(maxX, x, x + dx);
    minY = Math.min(minY, y, y + dy);
    maxY = Math.max(maxY, y, y + dy);
    maxZ = Math.max(maxZ, link.depth);
    x += dx;
    y += dy;
  }

  return {
    ok: true,
    step: stepDocument(faces, options.name),
    bounds: { minX, maxX, minY, maxY, minZ: 0, maxZ },
    chainLength: links.reduce((sum, link) => sum + link.length, 0),
  };
}
