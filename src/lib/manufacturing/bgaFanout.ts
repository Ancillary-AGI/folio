/**
 * BGA fanout + via discipline (Pi-class leg 3).
 * A Pi-class SoC is a dense BGA: without dog-bone fanout, via-in-pad
 * rules and escape-channel math you cannot break out a single row.
 * Lengths in mm.
 */
export interface BgaPackage {
  name: string
  rows: number
  cols: number
  pitch: number
  /** Ball pad diameter. */
  padDiameter: number
}

export interface BgaBall {
  row: number
  col: number
  x: number
  y: number
  net?: string
  isPower?: boolean
}

function validatePackage(pkg: BgaPackage): void {
  if (!Number.isInteger(pkg.rows) || pkg.rows < 1 || !Number.isInteger(pkg.cols) || pkg.cols < 1) {
    throw new Error('BGA rows and columns must be positive integers')
  }
  if (!Number.isFinite(pkg.pitch) || pkg.pitch <= 0) {
    throw new Error('BGA pitch must be positive and finite')
  }
  if (!Number.isFinite(pkg.padDiameter) || pkg.padDiameter <= 0) {
    throw new Error('BGA pad diameter must be positive and finite')
  }
}

export function bgaBalls(pkg: BgaPackage): BgaBall[] {
  validatePackage(pkg)
  const balls: BgaBall[] = []
  const w = (pkg.cols - 1) * pkg.pitch
  const h = (pkg.rows - 1) * pkg.pitch
  for (let r = 0; r < pkg.rows; r++) {
    for (let c = 0; c < pkg.cols; c++) {
      balls.push({ row: r, col: c, x: c * pkg.pitch - w / 2, y: r * pkg.pitch - h / 2 })
    }
  }
  return balls
}

export interface FanoutVia {
  x: number
  y: number
  drill: number
  diameter: number
}

export interface ViaRules {
  minDrill: number
  minDiameter: number
  minPitchClearance: number
}

/** JLCPCB-class mechanical via rules. At 0.8 mm pitch these do not fit. */
export const STD_VIA_RULES: ViaRules = { minDrill: 0.3, minDiameter: 0.5, minPitchClearance: 0.15 }

/** Laser microvia rules that actually break out a 0.8 mm-pitch BGA. */
export const MICROVIA_FANOUT_RULES: ViaRules = { minDrill: 0.1, minDiameter: 0.25, minPitchClearance: 0.1 }

/**
 * Dog-bone fanout: each signal ball gets a via in the first diagonal quadrant
 * that clears every ball (including copper clearance) and every via already
 * placed. Power balls tie to the plane instead of breaking out. Returns vias +
 * unbroken nets.
 */
export function dogboneFanout(
  balls: BgaBall[],
  pkg: BgaPackage,
  rules: ViaRules = STD_VIA_RULES,
): { vias: Array<FanoutVia & { net: string }>; planeNets: string[]; violations: string[] } {
  validatePackage(pkg)
  const violations: string[] = []
  if (!Number.isFinite(rules.minDrill) || rules.minDrill < 0.1) {
    violations.push('via drill below manufacturing floor')
  }
  if (!Number.isFinite(rules.minDiameter) || rules.minDiameter <= rules.minDrill) {
    violations.push('via pad has no annular ring')
  }
  if (!Number.isFinite(rules.minPitchClearance) || rules.minPitchClearance < 0) {
    violations.push('via clearance rule must be zero or positive')
  }
  // The via centre must sit outside its own ball pad by the via radius plus
  // copper clearance. Moving diagonally splits that centre distance over two
  // axes. Adjacent balls need the same copper clearance, which is why a
  // 0.5 mm mechanical via cannot fan out a 0.8 mm-pitch grid at all.
  const padRadius = pkg.padDiameter / 2
  const viaRadius = (Number.isFinite(rules.minDiameter) ? rules.minDiameter : 0) / 2
  const clearance = Number.isFinite(rules.minPitchClearance) ? Math.max(0, rules.minPitchClearance) : 0
  const diagonalOffset = (padRadius + viaRadius + clearance) / Math.SQRT2
  const ballKeepOut = padRadius + viaRadius + clearance
  const viaKeepOut = 2 * viaRadius + clearance
  const quadrants = [
    { sx: 1, sy: 1 },
    { sx: -1, sy: 1 },
    { sx: 1, sy: -1 },
    { sx: -1, sy: -1 },
  ] as const
  const vias: Array<FanoutVia & { net: string }> = []
  const planeNets: string[] = []
  let blockedByBalls = 0
  let blockedByVias = 0
  for (const ball of balls) {
    if (!ball.net) continue
    if (ball.isPower) {
      if (!planeNets.includes(ball.net)) planeNets.push(ball.net)
      continue
    }
    let placed = false
    let clearOfBalls = 0
    for (const { sx, sy } of quadrants) {
      const x = ball.x + sx * diagonalOffset
      const y = ball.y + sy * diagonalOffset
      const hitsBall = balls.some(
        (other) =>
          other !== ball &&
          Math.hypot(other.x - x, other.y - y) < ballKeepOut - 1e-9,
      )
      if (hitsBall) continue
      clearOfBalls += 1
      const hitsVia = vias.some((via) => Math.hypot(via.x - x, via.y - y) < viaKeepOut - 1e-9)
      if (hitsVia) continue
      vias.push({ x, y, drill: rules.minDrill, diameter: rules.minDiameter, net: ball.net })
      placed = true
      break
    }
    if (!placed) {
      if (clearOfBalls === 0) blockedByBalls += 1
      else blockedByVias += 1
    }
  }
  if (blockedByBalls > 0) {
    violations.push(
      `${blockedByBalls} dog-bone via(s) would overlap an adjacent ball at ${pkg.pitch} mm pitch; ` +
        'use a smaller via or a via-in-pad process',
    )
  }
  if (blockedByVias > 0) {
    violations.push(
      `${blockedByVias} dog-bone via(s) have no free quadrant without overlapping another via ` +
        `at ${pkg.pitch} mm pitch; use a smaller via or a via-in-pad process`,
    )
  }
  return { vias, planeNets, violations }
}

/**
 * Escape channels per side between outer-row vias: with pitch p and
 * via diameter d, gap = p - d must clear trace width + 2x spacing.
 */
export function escapeTracksPerChannel(pitch: number, viaDiameter: number, traceWidth: number, spacing: number): number {
  if (!Number.isFinite(pitch) || pitch <= 0) throw new Error('pitch must be positive and finite')
  if (!Number.isFinite(viaDiameter) || viaDiameter < 0) throw new Error('via diameter must be zero or positive and finite')
  if (!Number.isFinite(traceWidth) || traceWidth <= 0) throw new Error('trace width must be positive and finite')
  if (!Number.isFinite(spacing) || spacing < 0) throw new Error('spacing must be zero or positive and finite')
  const gap = pitch - viaDiameter
  if (gap <= 0) return 0
  return Math.max(0, Math.floor((gap - spacing) / (traceWidth + spacing)))
}
