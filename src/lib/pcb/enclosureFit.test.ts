import { describe, expect, it } from 'vitest'
import { boxMeshObj } from '../3d/meshFixtures'
import { parseObj } from '../3d/objImporter'
import { buildPcbScene, type PcbSceneInput } from './pcbScene'
import { assessEnclosureFit, contentEnvelope, stackEnvelope } from './enclosureFit'

const BASE: PcbSceneInput = {
  widthMm: 100,
  heightMm: 80,
  thicknessMm: 1.6,
  layers: [{ id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000' }],
  traces: [],
  vias: [],
  components: [],
}

describe('board envelopes', () => {
  it('reports no content envelope for a bare board but still a stack to fit', () => {
    const scene = buildPcbScene(BASE)
    expect(contentEnvelope(scene).empty).toBe(true)
    const stack = stackEnvelope(scene)
    expect(stack.empty).toBe(false)
    expect([stack.minX, stack.maxX]).toEqual([-50, 50])
    expect([stack.minZ, stack.maxZ]).toEqual([-40, 40])
    expect([stack.minY, stack.maxY]).toEqual([-0.8, 0.8])
  })

  it('grows the stack to the tallest body and to parts overhanging the outline', () => {
    const scene = buildPcbScene({
      ...BASE,
      components: [
        { id: 'j1', reference: 'J1', footprint: 'SOIC-8', category: 'connector', x: 50, y: 40 },
        { id: 's1', reference: 'U2', footprint: 'DIP-8', x: 99, y: 79 },
      ],
    })
    const stack = stackEnvelope(scene)
    const tallest = Math.max(...scene.components.map(c => c.position.y + c.bodyHeightMm / 2))
    expect(stack.maxY).toBeCloseTo(tallest, 9)
    // A part on the corner spills past the outline, and the enclosure has to clear it.
    expect(stack.maxX).toBeGreaterThan(50)
    expect(stack.maxZ).toBeGreaterThan(40)
  })
})

describe('assessEnclosureFit', () => {
  it('measures the room on all six sides of a bare board', () => {
    const fit = assessEnclosureFit(stackEnvelope(buildPcbScene(BASE)), parseObj(boxMeshObj(120, 90, 20)))
    expect(fit.cavityMm).toEqual({ width: 120, depth: 90, height: 20 })
    expect(fit.stackMm).toEqual({ width: 100, depth: 80, height: 1.6 })
    expect(fit.clearanceMm).toEqual({ negX: 10, posX: 10, negZ: 5, posZ: 5, negY: 9.2, posY: 9.2 })
    expect(fit.tightestMm).toBe(5)
    expect(fit.fits).toBe(true)
    expect(fit.shellClosed).toBe(true)
  })

  it('reports a negative clearance instead of calling an over-full box a fit', () => {
    const fit = assessEnclosureFit(stackEnvelope(buildPcbScene(BASE)), parseObj(boxMeshObj(88, 90, 20)))
    expect(fit.clearanceMm.negX).toBeCloseTo(-6, 9)
    expect(fit.clearanceMm.posX).toBeCloseTo(-6, 9)
    expect(fit.tightestMm).toBeCloseTo(-6, 9)
    expect(fit.fits).toBe(false)
  })

  it('counts the tallest component against the lid, not the board thickness', () => {
    const scene = buildPcbScene({
      ...BASE,
      components: [{ id: 'c1', reference: 'T1', footprint: 'TO-220', category: 'ic', x: 50, y: 40 }],
    })
    const stack = stackEnvelope(scene)
    const roomy = assessEnclosureFit(stack, parseObj(boxMeshObj(120, 90, 20)))
    const shallow = assessEnclosureFit(stack, parseObj(boxMeshObj(120, 90, 4)))
    expect(roomy.fits).toBe(true)
    expect(shallow.fits).toBe(false)
    expect(shallow.clearanceMm.posY).toBeLessThan(0)
    expect(shallow.tightestMm).toBeCloseTo(shallow.clearanceMm.posY, 9)
  })

  it('keeps the verdict about the envelope when the shell is not a solid', () => {
    // A flat sheet: a real bounding box, but nothing a board could live inside.
    const fit = assessEnclosureFit(stackEnvelope(buildPcbScene(BASE)), parseObj(
      'v -60 0 -45\nv 60 0 -45\nv 60 0 45\nv -60 0 45\nf 1 2 3 4',
    ))
    expect(fit.shellClosed).toBe(false)
    expect(fit.openEdges).toBe(4)
    expect(fit.cavityMm).toEqual({ width: 120, depth: 90, height: 0 })
    expect(fit.fits).toBe(false)
    expect(fit.clearanceMm.posY).toBeCloseTo(-0.8, 9)
  })
})
