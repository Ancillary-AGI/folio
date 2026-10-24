/**
 * Silicon Die Floorplanning and Power Grid Distribution.
 * Computes core dimensions from gate area and utilization target,
 * creates perimeter I/O bonding pad rings, and constructs VDD/VSS power rings
 * with IR drop estimation.
 */

import { SKY130_PDK } from './standardCellLibrary';

export interface IoPad {
  index: number;
  name: string;
  kind: 'signal' | 'vdd' | 'vss' | 'clock' | 'reset';
  side: 'north' | 'south' | 'east' | 'west';
  xUm: number;
  yUm: number;
  widthUm: number;
  heightUm: number;
}

export interface PowerStripe {
  layer: 'Metal4' | 'Metal5';
  net: 'VDD' | 'VSS';
  x1Um: number;
  y1Um: number;
  x2Um: number;
  y2Um: number;
  widthUm: number;
}

export interface DieFloorplan {
  moduleName: string;
  coreWidthUm: number;
  coreHeightUm: number;
  dieWidthUm: number;
  dieHeightUm: number;
  rowCount: number;
  utilizationPercent: number;
  ioPads: IoPad[];
  powerStripes: PowerStripe[];
  estimatedCoreCurrentMa: number;
  estimatedIrDropMv: number;
}

export interface FloorplanOptions {
  targetUtilizationPercent?: number; // 40% - 80%, default 60%
  aspectRatio?: number; // Width / Height, default 1.0
  padWidthUm?: number; // default 60 um wirebond pad
  padHeightUm?: number; // default 60 um
  padPitchUm?: number; // default 80 um
  coreToDieMarginUm?: number; // default 80 um for pads + rings
  clocks?: string[];
  resets?: string[];
}

/**
 * Floorplan a silicon die from total standard cell area and I/O signals.
 */
export function generateDieFloorplan(
  moduleName: string,
  totalCellAreaUm2: number,
  signals: { inputs: string[]; outputs: string[]; clocks?: string[]; resets?: string[] },
  options: FloorplanOptions = {},
): DieFloorplan {
  if (!Number.isFinite(totalCellAreaUm2) || totalCellAreaUm2 <= 0) {
    throw new Error('Total cell area must be a finite, positive value.');
  }

  const targetPercent = options.targetUtilizationPercent ?? 60;
  if (!Number.isFinite(targetPercent) || targetPercent <= 0 || targetPercent > 100) {
    throw new Error('Target utilization must be a finite percentage in (0,100].');
  }
  const aspectRatio = options.aspectRatio ?? 1.0;
  if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
    throw new Error('Aspect ratio must be finite and positive.');
  }
  const padWidth = options.padWidthUm ?? 60.0;
  const padHeight = options.padHeightUm ?? 60.0;
  const padPitch = options.padPitchUm ?? 80.0;
  const margin = options.coreToDieMarginUm ?? 80.0;
  for (const [name, value] of [
    ['Pad width', padWidth],
    ['Pad height', padHeight],
    ['Pad pitch', padPitch],
  ] as const) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be finite and positive.`);
    }
  }
  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error('Core-to-die margin must be finite and non-negative.');
  }

  const targetUtil = targetPercent / 100;

  // 1. Calculate Core Dimensions
  const coreArea = totalCellAreaUm2 / targetUtil;
  // Area = W * H, W = H * aspect -> Area = H^2 * aspect -> H = sqrt(Area / aspect)
  const rawCoreH = Math.sqrt(coreArea / aspectRatio);
  const rowHeight = SKY130_PDK.standardCellHeightUm;
  const rowCount = Math.max(4, Math.ceil(rawCoreH / rowHeight));
  const coreHeight = rowCount * rowHeight;
  const coreWidth = Math.ceil((coreArea / coreHeight) / SKY130_PDK.sitePitchUm) * SKY130_PDK.sitePitchUm;

  const dieWidth = Number((coreWidth + 2 * margin).toFixed(2));
  const dieHeight = Number((coreHeight + 2 * margin).toFixed(2));

  // 2. I/O Pad Allocation
  const signalList: Array<{ name: string; kind: IoPad['kind'] }> = [];
  for (const clk of options.clocks ?? signals.clocks ?? ['clk']) {
    signalList.push({ name: clk, kind: 'clock' });
  }
  for (const rst of options.resets ?? signals.resets ?? ['rst_n']) {
    signalList.push({ name: rst, kind: 'reset' });
  }
  for (const inp of signals.inputs) {
    if (!signalList.some((s) => s.name === inp)) signalList.push({ name: inp, kind: 'signal' });
  }
  for (const out of signals.outputs) {
    if (!signalList.some((s) => s.name === out)) signalList.push({ name: out, kind: 'signal' });
  }

  // Add VDD and VSS power pads
  signalList.push({ name: 'VDD', kind: 'vdd' });
  signalList.push({ name: 'VSS', kind: 'vss' });

  const ioPads: IoPad[] = [];
  const sides: Array<'south' | 'east' | 'north' | 'west'> = ['south', 'east', 'north', 'west'];
  let currentSideIdx = 0;

  for (let i = 0; i < signalList.length; i += 1) {
    const side = sides[currentSideIdx % 4];
    currentSideIdx += 1;
    const pad = signalList[i];

    let x = 0;
    let y = 0;
    const offset = margin / 2;

    if (side === 'south') {
      x = offset + (i * padPitch) % (dieWidth - 2 * offset);
      y = offset;
    } else if (side === 'north') {
      x = offset + (i * padPitch) % (dieWidth - 2 * offset);
      y = dieHeight - offset;
    } else if (side === 'west') {
      x = offset;
      y = offset + (i * padPitch) % (dieHeight - 2 * offset);
    } else {
      x = dieWidth - offset;
      y = offset + (i * padPitch) % (dieHeight - 2 * offset);
    }

    ioPads.push({
      index: i + 1,
      name: pad.name,
      kind: pad.kind,
      side,
      xUm: Number(x.toFixed(2)),
      yUm: Number(y.toFixed(2)),
      widthUm: padWidth,
      heightUm: padHeight,
    });
  }

  // 3. Power Distribution Network (PDN) Stripes
  const powerStripes: PowerStripe[] = [];
  const stripeWidth = 4.8; // Metal4/5 power stripe width in um
  const stripePitch = 30.0; // Stripe spacing

  // Horizontal Metal 4 Stripes (VDD / VSS alternating)
  let netToggle = true;
  for (let y = margin; y < margin + coreHeight; y += stripePitch) {
    const net = netToggle ? 'VDD' : 'VSS';
    netToggle = !netToggle;
    powerStripes.push({
      layer: 'Metal4',
      net,
      x1Um: margin,
      y1Um: y,
      x2Um: margin + coreWidth,
      y2Um: y,
      widthUm: stripeWidth,
    });
  }

  // Vertical Metal 5 Stripes
  for (let x = margin; x < margin + coreWidth; x += stripePitch) {
    const net = netToggle ? 'VDD' : 'VSS';
    netToggle = !netToggle;
    powerStripes.push({
      layer: 'Metal5',
      net,
      x1Um: x,
      y1Um: margin,
      x2Um: x,
      y2Um: margin + coreHeight,
      widthUm: stripeWidth,
    });
  }

  // 4. IR Drop Estimation
  // Estimate core current: ~15 uA per cell area unit in um2 at typical activity
  const estimatedCoreCurrentMa = (totalCellAreaUm2 * 0.015);
  // Grid resistance based on copper/aluminum sheet rho_sq ~ 0.03 ohms/sq
  const gridResistanceOhms = (aspectRatio * 0.03) / Math.max(1, powerStripes.length / 4);
  const irDropMv = (estimatedCoreCurrentMa * 1e-3) * gridResistanceOhms * 1e3;

  return {
    moduleName,
    coreWidthUm: Number(coreWidth.toFixed(2)),
    coreHeightUm: Number(coreHeight.toFixed(2)),
    dieWidthUm: dieWidth,
    dieHeightUm: dieHeight,
    rowCount,
    utilizationPercent: Number(((totalCellAreaUm2 / (coreWidth * coreHeight)) * 100).toFixed(1)),
    ioPads,
    powerStripes,
    estimatedCoreCurrentMa: Number(estimatedCoreCurrentMa.toFixed(2)),
    estimatedIrDropMv: Number(irDropMv.toFixed(2)),
  };
}
