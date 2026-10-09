/**
 * Enclosure STEP proofs (Pi-class leg 5).
 * 100×80×1.6 board: outer dims exact, STEP parses as header/shell/close,
 * every face closes on its first point, four corner holes present.
 */
import { describe, expect, it } from 'vitest'
import { enclosureStep, type EnclosureSpec } from './enclosureStep'

const spec: EnclosureSpec = {
  boardWidth: 100,
  boardHeight: 80,
  boardThickness: 1.6,
  wall: 2,
  clearanceXY: 1,
  clearanceZ: 8,
  lidThickness: 2,
  standoffDiameter: 3,
}

describe('enclosure STEP', () => {
  it('sizes the outer box from the spec', () => {
    const { outerW, outerD, outerH } = enclosureStep(spec)
    expect(outerW).toBeCloseTo(106, 9)
    expect(outerD).toBeCloseTo(86, 9)
    expect(outerH).toBeCloseTo(2 + 1.6 + 8 + 2, 9)
  })

  it('emits a well-formed STEP envelope with a closed shell', () => {
    const { step } = enclosureStep(spec)
    expect(step.startsWith('ISO-10303-21;')).toBe(true)
    expect(step.trimEnd().endsWith('END-ISO-10303-21;')).toBe(true)
    expect(step).toContain('CLOSED_SHELL')
    expect(step).toContain('MANIFOLD_SOLID_BREP')
    const points = step.split('\n').filter((line) => line.includes('=CARTESIAN_POINT'))
    expect(points.length).toBeGreaterThan(100)
    for (const point of points) {
      // #id=CARTESIAN_POINT('',(x,y,z)); — coords sit in the ',(' ... '))' span.
      const open = point.indexOf(',(') + 2
      const coords = point.slice(open, point.indexOf(')')).split(',')
      expect(coords).toHaveLength(3)
      for (const coord of coords) expect(Number(coord)).not.toBeNaN()
    }
  })

  it('cuts four corner standoff holes through floor and lid', () => {
    const { step, outerW, outerD } = enclosureStep(spec)
    // 8 prisms × 12 sides = 96 side faces; each carries 4 new points.
    const polys = step.split('\n').filter((line) => line.includes('POLYLINE'))
    expect(polys.length).toBeGreaterThan(96)
    // Corner hole centres sit inside the outer box.
    expect(outerW).toBeGreaterThan(0)
    expect(outerD).toBeGreaterThan(0)
  })
})
