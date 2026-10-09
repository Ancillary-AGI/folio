/**
 * Power-integrity proofs (Pi-class leg 4).
 */
import { describe, expect, it } from 'vitest'
import { planeLoopInductance, polygonArea, pourResistance, stitchingGrid, thermalSpokes } from './powerIntegrity'

describe('power integrity', () => {
  it('measures a pour polygon by shoelace', () => {
    expect(polygonArea([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }, { x: 0, y: 5 }])).toBe(50)
    expect(polygonArea([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 3 }])).toBe(6)
  })

  it('computes copper resistance in milliohms', () => {
    // 10 mm × 5 mm, 1 oz: 17.24e-6·10/(5·0.035) ≈ 0.985 mΩ.
    expect(pourResistance(10, 5, 1)).toBeCloseTo(0.985, 2)
    // 2 oz halves it.
    expect(pourResistance(10, 5, 2)).toBeCloseTo(0.49, 2)
  })

  it('computes plane-pair loop inductance in nanohenries', () => {
    // μ₀·0.2mm·10mm/20mm = 1.26e-10 H ≈ 0.126 nH.
    expect(planeLoopInductance(10, 20, 0.2)).toBeCloseTo(0.126, 2)
    // Tighter spacing means less inductance.
    expect(planeLoopInductance(10, 20, 0.1)).toBeLessThan(planeLoopInductance(10, 20, 0.2))
  })

  it('lays a stitching grid with edge clearance', () => {
    const vias = stitchingGrid(10, 10, 4, 1)
    expect(vias).toHaveLength(9)
    expect(vias[0]).toEqual({ x: 1, y: 1 })
    expect(vias.every((v) => v.x >= 1 && v.x <= 9 && v.y >= 1 && v.y <= 9)).toBe(true)
  })

  it('sizes thermal reliefs as a copper fraction', () => {
    const relief = thermalSpokes(1.5, 0.3)
    expect(relief.spokes).toBe(4)
    expect(relief.copperFraction).toBeGreaterThan(0)
    expect(relief.copperFraction).toBeLessThan(1)
  })
})
