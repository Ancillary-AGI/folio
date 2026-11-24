/**
 * IC Packaging Co-Design: QFN, TQFP, BGA, and WLCSP.
 * Connects silicon dies to the physical world: die attach paddles, leadframe fingers,
 * bondwire loop 3D trajectories with self-inductance/resistance parasitics,
 * and 3D STEP package body models.
 */

import { boxFaces, stepDocument } from '../manufacturing/stepGeometry';

export type PackageFamily = 'QFN' | 'TQFP' | 'BGA' | 'WLCSP';

export interface BondWireParasitics {
  wireLengthMm: number;
  inductanceNh: number;
  resistanceOhms: number;
  capacitancePf: number;
}

export interface BondWire {
  padIndex: number;
  signalName: string;
  diePadPosUm: { x: number; y: number };
  leadFingerPosMm: { x: number; y: number };
  loopHeightMm: number;
  wireDiameterUm: number;
  parasitics: BondWireParasitics;
}

export interface PackageSpec {
  name: string;
  family: PackageFamily;
  leadCount: number;
  bodyWidthMm: number;
  bodyHeightMm: number;
  bodyThicknessMm: number;
  pitchMm: number;
  dieAttachPaddleWidthMm: number;
  dieAttachPaddleHeightMm: number;
  maxDieWidthUm: number;
  maxDieHeightUm: number;
  thermalResistanceJunctionToCaseCperW: number;
}

export const STANDARD_PACKAGES: Record<string, PackageSpec> = {
  'qfn-32': {
    name: 'QFN-32 (5x5 mm, 0.5 mm pitch)',
    family: 'QFN',
    leadCount: 32,
    bodyWidthMm: 5.0,
    bodyHeightMm: 5.0,
    bodyThicknessMm: 0.85,
    pitchMm: 0.5,
    dieAttachPaddleWidthMm: 3.5,
    dieAttachPaddleHeightMm: 3.5,
    maxDieWidthUm: 3000,
    maxDieHeightUm: 3000,
    thermalResistanceJunctionToCaseCperW: 2.5,
  },
  'qfn-48': {
    name: 'QFN-48 (7x7 mm, 0.5 mm pitch)',
    family: 'QFN',
    leadCount: 48,
    bodyWidthMm: 7.0,
    bodyHeightMm: 7.0,
    bodyThicknessMm: 0.85,
    pitchMm: 0.5,
    dieAttachPaddleWidthMm: 5.1,
    dieAttachPaddleHeightMm: 5.1,
    maxDieWidthUm: 4500,
    maxDieHeightUm: 4500,
    thermalResistanceJunctionToCaseCperW: 2.1,
  },
  'tqfp-32': {
    name: 'TQFP-32 (7x7 mm, 0.8 mm pitch)',
    family: 'TQFP',
    leadCount: 32,
    bodyWidthMm: 7.0,
    bodyHeightMm: 7.0,
    bodyThicknessMm: 1.0,
    pitchMm: 0.8,
    dieAttachPaddleWidthMm: 4.0,
    dieAttachPaddleHeightMm: 4.0,
    maxDieWidthUm: 3200,
    maxDieHeightUm: 3200,
    thermalResistanceJunctionToCaseCperW: 14.0,
  },
  'bga-64': {
    name: 'BGA-64 (8x8 mm, 0.8 mm pitch)',
    family: 'BGA',
    leadCount: 64,
    bodyWidthMm: 8.0,
    bodyHeightMm: 8.0,
    bodyThicknessMm: 1.2,
    pitchMm: 0.8,
    dieAttachPaddleWidthMm: 6.0,
    dieAttachPaddleHeightMm: 6.0,
    maxDieWidthUm: 5000,
    maxDieHeightUm: 5000,
    thermalResistanceJunctionToCaseCperW: 5.0,
  },
};

/**
 * Gold (Au) bondwire standard: 25 um diameter (1.0 mil).
 * L ~ 1.0 nH/mm, R ~ 0.055 Ohms/mm, C ~ 0.15 pF/mm.
 */
export function calculateBondWireParasitics(
  dieXUm: number,
  dieYUm: number,
  leadXUm: number,
  leadYUm: number,
  loopHeightMm: number = 0.25,
): BondWireParasitics {
  const dxMm = (leadXUm - dieXUm) * 1e-3;
  const dyMm = (leadYUm - dieYUm) * 1e-3;
  const straightLengthMm = Math.hypot(dxMm, dyMm);
  // Loop curve factor: arc length over straight chord
  const wireLengthMm = Math.sqrt(straightLengthMm * straightLengthMm + 4 * loopHeightMm * loopHeightMm);

  const inductanceNh = Number((wireLengthMm * 1.0).toFixed(3)); // ~1 nH/mm
  const resistanceOhms = Number((wireLengthMm * 0.055).toFixed(3)); // ~55 mOhm/mm
  const capacitancePf = Number((wireLengthMm * 0.15).toFixed(3)); // ~0.15 pF/mm

  return {
    wireLengthMm: Number(wireLengthMm.toFixed(3)),
    inductanceNh,
    resistanceOhms,
    capacitancePf,
  };
}

export interface PackagedChip {
  packageSpec: PackageSpec;
  dieWidthUm: number;
  dieHeightUm: number;
  bondWires: BondWire[];
  stepModel: string;
}

/**
 * Package a silicon die into a target package with bondwires and 3D STEP geometry.
 */
export function packageSiliconDie(
  packageId: string,
  dieWidthUm: number,
  dieHeightUm: number,
  diePads: Array<{ index: number; name: string; xUm: number; yUm: number }>,
): PackagedChip {
  const pkg = STANDARD_PACKAGES[packageId];
  if (!pkg) throw new Error(`Unknown package ID: ${packageId}`);

  if (dieWidthUm > pkg.maxDieWidthUm || dieHeightUm > pkg.maxDieHeightUm) {
    throw new Error(
      `Die (${dieWidthUm}x${dieHeightUm} um) exceeds maximum allowed size for ${pkg.name} (${pkg.maxDieWidthUm}x${pkg.maxDieHeightUm} um).`,
    );
  }

  // 1. Bondwire routing from die pads to package lead fingers
  const bondWires: BondWire[] = [];
  const leadsPerSide = pkg.leadCount / 4;
  const halfBodyUm = (pkg.bodyWidthMm * 1e3) / 2;

  for (let i = 0; i < diePads.length && i < pkg.leadCount; i += 1) {
    const pad = diePads[i];
    // Position lead fingers along the package edge
    const sideIdx = Math.floor(i / leadsPerSide);
    const pinOnSide = i % leadsPerSide;
    const offsetUm = (pinOnSide - (leadsPerSide - 1) / 2) * (pkg.pitchMm * 1e3);

    let leadXUm = 0;
    let leadYUm = 0;
    if (sideIdx === 0) {
      leadXUm = offsetUm;
      leadYUm = -halfBodyUm;
    } else if (sideIdx === 1) {
      leadXUm = halfBodyUm;
      leadYUm = offsetUm;
    } else if (sideIdx === 2) {
      leadXUm = -offsetUm;
      leadYUm = halfBodyUm;
    } else {
      leadXUm = -halfBodyUm;
      leadYUm = -offsetUm;
    }

    const parasitics = calculateBondWireParasitics(pad.xUm, pad.yUm, leadXUm, leadYUm);
    bondWires.push({
      padIndex: pad.index,
      signalName: pad.name,
      diePadPosUm: { x: pad.xUm, y: pad.yUm },
      leadFingerPosMm: { x: Number((leadXUm * 1e-3).toFixed(3)), y: Number((leadYUm * 1e-3).toFixed(3)) },
      loopHeightMm: 0.25,
      wireDiameterUm: 25,
      parasitics,
    });
  }

  // 2. Generate 3D STEP Package Geometry
  // Epoxy mold compound block + exposed paddle
  const faces: number[][][] = [];
  const w = pkg.bodyWidthMm;
  const h = pkg.bodyHeightMm;
  const t = pkg.bodyThicknessMm;

  // Package body box
  faces.push(...boxFaces(-w / 2, -h / 2, 0, w / 2, h / 2, t));

  // Exposed thermal paddle on bottom
  const pw = pkg.dieAttachPaddleWidthMm;
  const ph = pkg.dieAttachPaddleHeightMm;
  faces.push(...boxFaces(-pw / 2, -ph / 2, -0.05, pw / 2, ph / 2, 0));

  const stepModel = stepDocument(faces, `folio-ic-${pkg.family.toLowerCase()}-${pkg.leadCount}`);

  return {
    packageSpec: pkg,
    dieWidthUm,
    dieHeightUm,
    bondWires,
    stepModel,
  };
}
