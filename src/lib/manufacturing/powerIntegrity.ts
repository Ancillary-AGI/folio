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

const requirePositive = (value: number, label: string): void => {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be positive and finite`)
}

/** Copper resistance of a pour: R = ρ·L/(W·t), ρ = 17.24 nΩ·m. */
export function pourResistance(length: number, width: number, oz = 1): number {
  const rho = 17.24e-6 // Ω·mm
  requirePositive(length, 'pour length')
  requirePositive(width, 'pour width')
  requirePositive(oz, 'copper weight')
  const thickness = oz * 0.035
  return (rho * length) / (width * thickness) * 1000 // mΩ
}

/** Loop inductance of a power/ground plane pair: L ≈ μ₀·h·l/w, in nH. */
export function planeLoopInductance(length: number, width: number, separation: number): number {
  requirePositive(length, 'plane length')
  requirePositive(width, 'plane width')
  requirePositive(separation, 'plane separation')
  const mu0 = 4 * Math.PI * 1e-7 // H/m
  const henries = (mu0 * (separation / 1000) * (length / 1000)) / (width / 1000)
  return henries * 1e9 // nH
}

/** Stitching grid: vias on a pitch across a rectangle; edge clearance kept. */
export function stitchingGrid(width: number, height: number, pitch: number, edge = 1): { x: number; y: number }[] {
  if (!Number.isFinite(width) || width < 0) throw new Error('stitching width must be zero or positive and finite')
  if (!Number.isFinite(height) || height < 0) throw new Error('stitching height must be zero or positive and finite')
  requirePositive(pitch, 'stitching pitch')
  if (!Number.isFinite(edge) || edge < 0) throw new Error('stitching edge clearance must be zero or positive and finite')

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
  requirePositive(padDiameter, 'pad diameter')
  if (!Number.isFinite(spokeWidth) || spokeWidth < 0) {
    throw new Error('spoke width must be zero or positive and finite')
  }
  const circumference = Math.PI * padDiameter
  const copper = 4 * spokeWidth
  return { spokes: 4, spokeWidth, copperFraction: Math.min(1, copper / circumference) }
}
