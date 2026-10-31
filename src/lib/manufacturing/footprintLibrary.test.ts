import { describe, expect, it } from 'vitest'
import { footprintLibrary } from './footprintLibrary'
import { landShapeOf, shapeGapMm } from '../geometry/landShape'

/**
 * The finest clearance this CAD is willing to route with, which is the number the
 * demo boards are built and checked against. A footprint whose own lands sit closer
 * than that cannot be routed at the rules its board is routed at.
 */
const MIN_LAND_GAP_MM = 0.15

interface Pair {
  footprint: string
  a: string
  b: string
  gapMm: number
}

/**
 * Every library footprint is measured with the same outline maths the router
 * reserves with and the DRC audits with, at its own unrotated pattern.
 *
 * Two lands of a single package that overlap are a short between two pins, and two
 * that sit closer than the fab's minimum gap cannot be pulled apart by anything the
 * router does: their clearance is set by the pattern, not by the routing. The TQFP-32
 * in this library had corner lands centred on the body edge, which buried the last
 * land of each row inside the first land of the next and walled those four pins out
 * of every board that used the package — a defect that looks exactly like a routing
 * failure until the pattern is measured.
 */
function illegalLandPairs(): Pair[] {
  const offenders: Pair[] = []
  for (const footprint of footprintLibrary.getAllFootprints()) {
    for (let i = 0; i < footprint.pads.length; i++) {
      for (let j = i + 1; j < footprint.pads.length; j++) {
        const a = footprint.pads[i]
        const b = footprint.pads[j]
        // Copper only shorts to copper on the same layer; a land patterned on the
        // top and one patterned on the bottom may cross without touching.
        if (!a.layers.some(layer => b.layers.includes(layer))) continue
        const gapMm = shapeGapMm(
          landShapeOf({
            widthMm: a.size.width,
            depthMm: a.size.height,
            shape: a.shape,
          }),
          landShapeOf({
            widthMm: b.size.width,
            depthMm: b.size.height,
            shape: b.shape,
          }),
          b.position.x - a.position.x,
          b.position.y - a.position.y,
        )
        if (gapMm < MIN_LAND_GAP_MM - 1e-9) {
          offenders.push({ footprint: footprint.id, a: a.id, b: b.id, gapMm })
        }
      }
    }
  }
  return offenders
}

describe('footprint library patterns', () => {
  it('keeps every land of a package apart by at least the routable clearance', () => {
    expect(illegalLandPairs()).toEqual([])
  })

  it('lets the last land of a QFP row escape past the first of the next', () => {
    // The corner is where a quad flat pack fails or works: pin 16 of TQFP-32 leaves
    // the right edge at the same height where pin 17 crosses the top edge, so the
    // two lands must miss each other diagonally or the corner pin has no lane out.
    const qfp = footprintLibrary.getFootprint('qfp_32')
    expect(qfp).toBeDefined()
    const pads = qfp!.pads
    const corner = (id: string) => pads.find(pad => pad.id === id)!

    const corners = [
      ['pad8', 'pad9'],
      ['pad16', 'pad17'],
      ['pad24', 'pad25'],
      ['pad32', 'pad1'],
    ].map(([first, second]) => {
      const a = corner(first)
      const b = corner(second)
      const gap = shapeGapMm(
        landShapeOf({ widthMm: a.size.width, depthMm: a.size.height, shape: a.shape }),
        landShapeOf({ widthMm: b.size.width, depthMm: b.size.height, shape: b.shape }),
        b.position.x - a.position.x,
        b.position.y - a.position.y,
      )
      return { pair: `${first}→${second}`, gapMm: Number(gap.toFixed(3)) }
    })

    expect(corners.every(corner => corner.gapMm >= MIN_LAND_GAP_MM)).toBe(true)
    expect(corners.map(corner => `${corner.pair} ${corner.gapMm}`)).toEqual([
      'pad8→pad9 0.495',
      'pad16→pad17 0.495',
      'pad24→pad25 0.495',
      'pad32→pad1 0.495',
    ])
  })

  it('keeps every land inside the courtyard that promises to protect it', () => {
    // A land outside its courtyard is copper the placement checker believes is
    // covered by an outline that does not reach it.
    const offenders: string[] = []
    for (const footprint of footprintLibrary.getAllFootprints()) {
      const courtyard = footprint.courtyard
      if (!courtyard || courtyard.length === 0) continue
      const maxX = Math.max(...courtyard.map(point => point.x))
      const maxY = Math.max(...courtyard.map(point => point.y))
      for (const pad of footprint.pads) {
        // Per axis, because a land is a rectangle and not the square drawn around
        // it: a 2.0 x 1.1 mm land reaches 1.0 mm in x and 0.55 mm in y.
        const reachX = Math.abs(pad.position.x) + pad.size.width / 2
        const reachY = Math.abs(pad.position.y) + pad.size.height / 2
        if (reachX > maxX + 1e-9 || reachY > maxY + 1e-9) {
          offenders.push(`${footprint.id}/${pad.id} reaches ${reachX.toFixed(2)} x ${reachY.toFixed(2)}, courtyard ${maxX.toFixed(2)} x ${maxY.toFixed(2)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
