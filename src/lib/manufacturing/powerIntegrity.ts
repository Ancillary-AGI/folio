/**
 * Plane pours + power integrity (Pi-class leg 4).
 * A Pi-class board lives on its planes: copper pours, thermal reliefs,
 * stitching vias and decoupling. All in mm, mΩ, nH.
 */
export interface PourRegion {
  net: string
  /** Polygon outline, closed implicitly. */
  outline: Array<{ x: number; y: number }>
  /** Isolation gap to other nets. */
  clearance: number
}

/** Shoelace area of a polygon. */
export function polygonArea(outline: Array<{ x: number; y: number }>): number {
  let area = 0
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i]
    const b = outline[(i + 1) % outline.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.abs(area) / 2
}

/** Copper resistance of a pour: R = ρ·L/(W·t), ρ = 17.24 nΩ·m. */
export function pourResistance(length: number, width: number, oz = 1): number {
  const rho = 17.24e-6 // Ω·mm
  const thickness = oz * 0.035
  if (width <= 0 || thickness <= 0) throw new Error('pour width and copper must be > 0')
  return (rho * length) / (width * thickness) * 1000 // mΩ
}

/** Loop inductance of a power/ground plane pair: L ≈ μ₀·h·l/w, in nH. */
export function planeLoopInductance(length: number, width: number, separation: number): number {
  const mu0 = 4 * Math.PI * 1e-7 // H/m
  const henries = (mu0 * (separation / 1000) * (length / 1000)) / Math.max(width / 1000, 1e-12)
  return henries * 1e9 // nH
}

/** Stitching grid: vias on a pitch across a rectangle; edge clearance kept. */
export function stitchingGrid(width: number, height: number, pitch: number, edge = 1): { x: number; y: number }[] {
  const vias: { x: number; y: number }[] = []
  for (let x = edge; x <= width - edge + 1e-9; x += pitch) {
    for (let y = edge; y <= height - edge + 1e-9; y += pitch) {
      vias.push({ x: Number(x.toFixed(3)), y: Number(y.toFixed(3)) })
    }
  }
  return vias
}

/** Thermal-relief spokes for a pad in a pour: 4 spokes, width per spoke. */
export function thermalSpokes(padDiameter: number, spokeWidth: number): { spokes: number; spokeWidth: number; copperFraction: number } {
  const circumference = Math.PI * padDiameter
  const copper = 4 * spokeWidth
  return { spokes: 4, spokeWidth, copperFraction: Math.min(1, copper / circumference) }
}
