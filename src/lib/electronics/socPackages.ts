/**
 * SoC/BGA ball maps (Pi-class parts).
 *
 * `bgaFanout.ts` knows geometry (pitch, dog-bone, escape channels) and
 * `microcontrollers.ts` knows QFP MCUs — but no part describes a dense BGA
 * SoC: which balls are power, which are ground, which carry DDR, USB, or
 * Ethernet. This module adds that layer: ball maps with power/ground nets,
 * DDR byte groups for length matching, and the high-speed interfaces the
 * diff-pair and DDR routers consume. Fail-loud on duplicate balls, missing
 * power, or unmapped package pins.
 */
import type { BgaBall, BgaPackage } from '../manufacturing/bgaFanout';

export type SocBallKind = 'power' | 'ground' | 'signal' | 'nc';

export interface SocBall extends BgaBall {
  kind: SocBallKind;
  /** Interface group, e.g. `DDR_DQ0`, `USB_DP`, `ETH_TX`. */
  group?: string;
  /** Supply rail for power balls, e.g. `VDD_CORE`, `VDDIO`. */
  rail?: string;
}

export interface SocPackage extends BgaPackage {
  partNumber: string;
  manufacturer: string;
  balls: SocBall[];
}

/** Build the centred ball grid with row/col/x/y precomputed. */
function gridBalls(rows: number, cols: number, pitch: number): Array<{ row: number; col: number; x: number; y: number }> {
  const w = (cols - 1) * pitch;
  const h = (rows - 1) * pitch;
  const out: Array<{ row: number; col: number; x: number; y: number }> = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      out.push({ row: r, col: c, x: c * pitch - w / 2, y: r * pitch - h / 2 });
    }
  }
  return out;
}

const ballId = (row: number, col: number): string =>
  `${String.fromCharCode(65 + row)}${col + 1}`;

/**
 * Generic 256-ball SoC template: perimeter power ring, ground core,
 * DDR byte groups on the east edge, USB + Ethernet on the south edge.
 * A template, not a specific silicon — but every ball is placed and every
 * power ball names its rail, so fanout and plane assignment are real.
 */
function buildSoc256(): SocBall[] {
  const rows = 16;
  const cols = 16;
  const pitch = 0.8;
  const balls: SocBall[] = gridBalls(rows, cols, pitch).map((g) => ({
    ...g, kind: 'signal' as SocBallKind, net: `BALL_${ballId(g.row, g.col)}`,
  }));
  const at = (row: number, col: number): SocBall => balls[row * cols + col];
  // Perimeter ring: alternating VDDIO / GND.
  for (let c = 0; c < cols; c += 1) {
    for (const r of [0, rows - 1]) {
      const b = at(r, c);
      const even = (r + c) % 2 === 0;
      b.kind = even ? 'power' : 'ground';
      b.net = even ? 'VDDIO' : 'GND';
      if (even) b.rail = 'VDDIO';
    }
  }
  for (let r = 1; r < rows - 1; r += 1) {
    for (const c of [0, cols - 1]) {
      const b = at(r, c);
      const even = (r + c) % 2 === 0;
      b.kind = even ? 'power' : 'ground';
      b.net = even ? 'VDDIO' : 'GND';
      if (even) b.rail = 'VDDIO';
    }
  }
  // Core: 4x4 ground block (thermal + return) with VDD_CORE corners.
  for (let r = 6; r < 10; r += 1) {
    for (let c = 6; c < 10; c += 1) {
      const corner = (r === 6 || r === 9) && (c === 6 || c === 9);
      const b = at(r, c);
      b.kind = corner ? 'power' : 'ground';
      b.net = corner ? 'VDD_CORE' : 'GND';
      if (corner) b.rail = 'VDD_CORE';
    }
  }
  // DDR byte groups down the east inner columns: 4 groups x 8 lanes,
  // each group occupying two adjacent rows x four columns.
  const dqGroups = ['DDR_DQ0', 'DDR_DQ1', 'DDR_DQ2', 'DDR_DQ3'];
  dqGroups.forEach((group, g) => {
    for (let k = 0; k < 8; k += 1) {
      const b = at(2 + g * 2 + Math.floor(k / 4), 10 + (k % 4));
      b.kind = 'signal';
      b.group = group;
      b.net = `${group}_${k}`;
    }
  });
  // USB + Ethernet on the south inner row.
  const hsio: Array<[number, number, string, string]> = [
    [13, 5, 'USB_DM', 'USB'], [13, 6, 'USB_DP', 'USB'],
    [13, 8, 'ETH_TXP', 'ETH'], [13, 9, 'ETH_TXN', 'ETH'],
    [13, 10, 'ETH_RXP', 'ETH'], [13, 11, 'ETH_RXN', 'ETH'],
  ];
  for (const [r, c, net, group] of hsio) {
    const b = at(r, c);
    b.kind = 'signal';
    b.group = group;
    b.net = net;
  }
  return balls;
}

export const SOC_256: SocPackage = {
  name: 'SOC-256',
  partNumber: 'FOLIO-SOC256-TMPL',
  manufacturer: 'Folio template',
  rows: 16,
  cols: 16,
  pitch: 0.8,
  padDiameter: 0.4,
  balls: buildSoc256(),
};

export const STANDARD_SOCS: readonly SocPackage[] = [SOC_256];

/** Power balls grouped by rail. */
export function powerRails(pkg: SocPackage): Map<string, SocBall[]> {
  const rails = new Map<string, SocBall[]>();
  for (const b of pkg.balls) {
    if (b.kind !== 'power' || !b.rail) continue;
    const list = rails.get(b.rail) ?? [];
    list.push(b);
    rails.set(b.rail, list);
  }
  return rails;
}

/** Balls of one interface group (e.g. all `DDR_DQ0` byte lanes). */
export function interfaceGroup(pkg: SocPackage, group: string): SocBall[] {
  return pkg.balls.filter((b) => b.group === group);
}

/** Validate a ball map: no duplicates, has power and ground, package dims match. */
export function validateBallMap(pkg: SocPackage): void {
  if (pkg.balls.length !== pkg.rows * pkg.cols) {
    throw new Error(`${pkg.partNumber} declares ${pkg.rows}x${pkg.cols} but carries ${pkg.balls.length} balls.`);
  }
  const seen = new Set<string>();
  for (const b of pkg.balls) {
    const id = `${b.row},${b.col}`;
    if (seen.has(id)) throw new Error(`${pkg.partNumber} has a duplicate ball at row ${b.row} col ${b.col}.`);
    seen.add(id);
  }
  if (!pkg.balls.some((b) => b.kind === 'power')) throw new Error(`${pkg.partNumber} has no power balls.`);
  if (!pkg.balls.some((b) => b.kind === 'ground')) throw new Error(`${pkg.partNumber} has no ground balls.`);
}
