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

export function bgaBalls(pkg: BgaPackage): BgaBall[] {
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

/** JLCPCB-class mechanical via rules. */
export const STD_VIA_RULES: ViaRules = { minDrill: 0.3, minDiameter: 0.5, minPitchClearance: 0.15 }

/**
 * Dog-bone fanout: via offset diagonally from each signal ball at
 * 45 degrees, clear of the pad by the annular ring. Power balls tie
 * to the plane instead of breaking out. Returns vias + unbroken nets.
 */
export function dogboneFanout(
  balls: BgaBall[],
  pkg: BgaPackage,
  rules: ViaRules = STD_VIA_RULES,
): { vias: Array<FanoutVia & { net: string }>; planeNets: string[]; violations: string[] } {
  const violations: string[] = []
  if (rules.minDrill < 0.1) violations.push('via drill below manufacturing floor')
  const offset = pkg.pitch / 2 - 0.1
  const vias: Array<FanoutVia & { net: string }> = []
  const planeNets: string[] = []
  for (const ball of balls) {
    if (!ball.net) continue
    if (ball.isPower) {
      if (!planeNets.includes(ball.net)) planeNets.push(ball.net)
      continue
    }
    const sx = ball.col === 0 ? 1 : -1
    const sy = ball.row === 0 ? 1 : -1
    vias.push({ x: ball.x + sx * offset * 0.5, y: ball.y + sy * offset * 0.5, drill: rules.minDrill, diameter: rules.minDiameter, net: ball.net })
  }
  return { vias, planeNets, violations }
}

/**
 * Escape channels per side between outer-row vias: with pitch p and
 * via diameter d, gap = p - d must clear trace width + 2x spacing.
 */
export function escapeTracksPerChannel(pitch: number, viaDiameter: number, traceWidth: number, spacing: number): number {
  const gap = pitch - viaDiameter
  if (gap <= 0) return 0
  return Math.max(0, Math.floor((gap - spacing) / (traceWidth + spacing)))
}
