import { describe, expect, it } from 'vitest'
import {
  buildPcbScene,
  resolveFootprint,
  stackLayers,
  type PcbSceneInput,
} from './pcbScene'

const BASE: PcbSceneInput = {
  widthMm: 100,
  heightMm: 80,
  thicknessMm: 1.6,
  layers: [
    { id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000' },
    { id: 'in1-cu', name: 'Inner 1', kind: 'copper', color: '#009900' },
    { id: 'in2-cu', name: 'Inner 2', kind: 'copper', color: '#0000cc' },
    { id: 'bot-cu', name: 'Bottom Copper', kind: 'copper', color: '#ffaa00' },
    { id: 'top-silk', name: 'Top Silkscreen', kind: 'silk', color: '#ffffff' },
    { id: 'top-mask', name: 'Top Soldermask', kind: 'mask', color: '#008800' },
  ],
  traces: [],
  vias: [],
  components: [],
}

describe('stackLayers', () => {
  it('places outer copper outside the substrate and inner copper inside it', () => {
    const layers = stackLayers(BASE.layers, 1.6, 0.035)
    const byId = new Map(layers.map((layer) => [layer.id, layer]))
    expect(byId.get('top-cu')?.yMm).toBeCloseTo(0.8 + 0.0175, 9)
    expect(byId.get('bot-cu')?.yMm).toBeCloseTo(-0.8 - 0.0175, 9)
    const inner1 = byId.get('in1-cu')?.yMm ?? Number.NaN
    const inner2 = byId.get('in2-cu')?.yMm ?? Number.NaN
    expect(Math.abs(inner1)).toBeLessThan(0.8)
    expect(Math.abs(inner2)).toBeLessThan(0.8)
    expect(inner1).toBeGreaterThan(inner2)
  })

  it('keeps silkscreen above the solder mask', () => {
    const layers = stackLayers(BASE.layers, 1.6, 0.035)
    const silk = layers.find((layer) => layer.id === 'top-silk')
    const mask = layers.find((layer) => layer.id === 'top-mask')
    expect(silk && mask && silk.yMm > mask.yMm).toBe(true)
  })
})

describe('buildPcbScene', () => {
  it('centres the board on the origin with Y up', () => {
    const scene = buildPcbScene(BASE)
    expect(scene.board.widthMm).toBe(100)
    expect(scene.board.heightMm).toBe(80)
    expect(scene.board.topSurfaceYMm).toBeCloseTo(0.8, 9)
    expect(scene.board.bottomSurfaceYMm).toBeCloseTo(-0.8, 9)
    expect(scene.counts.copperLayers).toBe(4)
    expect(scene.counts.segments).toBe(0)
    expect(scene.warnings.map((warning) => warning.code)).toContain('empty-board')
  })

  it('splits a polyline into segments with real lengths and layer heights', () => {
    const scene = buildPcbScene({
      ...BASE,
      traces: [{
        id: 't1', net: 'OUT', layerId: 'top-cu', widthMm: 0.25,
        points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }],
      }],
    })
    expect(scene.traces).toHaveLength(2)
    const [first, second] = scene.traces
    expect(first.lengthMm).toBeCloseTo(20, 9)
    expect(first.start).toEqual({ x: -40, y: 0.8175, z: -20 })
    expect(first.end).toEqual({ x: -20, y: 0.8175, z: -20 })
    expect(first.rotationYDeg).toBeCloseTo(0, 9)
    expect(second.lengthMm).toBeCloseTo(20, 9)
    expect(second.rotationYDeg).toBeCloseTo(-90, 9)
    expect(scene.counts.segments).toBe(2)
    expect(scene.warnings.map((warning) => warning.code)).not.toContain('empty-board')
  })

  it('reports traces that leave the outline instead of clamping them', () => {
    const scene = buildPcbScene({
      ...BASE,
      traces: [{
        id: 't2', net: 'X', layerId: 'top-cu', widthMm: 0.2,
        points: [{ x: 50, y: 10 }, { x: 120, y: 10 }],
      }],
    })
    expect(scene.traces).toHaveLength(1)
    expect(scene.warnings).toContainEqual(expect.objectContaining({
      code: 'trace-outside-board', elementId: 't2',
    }))
  })

  it('rejects traces on non-copper layers', () => {
    const scene = buildPcbScene({
      ...BASE,
      traces: [{
        id: 't3', net: 'X', layerId: 'top-silk', widthMm: 0.2,
        points: [{ x: 10, y: 10 }, { x: 20, y: 10 }],
      }],
    })
    expect(scene.traces).toHaveLength(0)
    expect(scene.warnings).toContainEqual(expect.objectContaining({
      code: 'trace-outside-board', elementId: 't3',
    }))
  })

  it('sizes via barrels to span the full stack', () => {
    const scene = buildPcbScene({
      ...BASE,
      vias: [{ id: 'v1', net: 'GND', x: 50, y: 40, padDiameterMm: 0.6, drillDiameterMm: 0.3 }],
    })
    expect(scene.vias).toHaveLength(1)
    expect(scene.vias[0].position).toEqual({ x: 0, y: 0, z: 0 })
    expect(scene.vias[0].heightMm).toBeCloseTo(1.6 + 0.07, 9)
  })

  it('builds a footprint body and transformed pads for each placed part', () => {
    const scene = buildPcbScene({
      ...BASE,
      components: [{
        id: 'c1', reference: 'R1', footprint: '0805', category: 'resistor',
        x: 25, y: 20, rotationDeg: 90,
      }],
    })
    expect(scene.components).toHaveLength(1)
    const component = scene.components[0]
    expect(component.footprintId).toBe('res_0805')
    expect(component.bodyWidthMm).toBeCloseTo(2.0, 9)
    expect(component.bodyDepthMm).toBeCloseTo(1.25, 9)
    expect(component.bodyHeightMm).toBeCloseTo(0.55, 9)
    expect(component.position.x).toBeCloseTo(-25, 9)
    expect(component.position.z).toBeCloseTo(-20, 9)
    expect(component.position.y).toBeCloseTo(0.8 + 0.035 + 0.275, 9)
    expect(component.pads.length).toBeGreaterThan(0)
    // 90 degrees sends the local +X pad offset to +Z.
    const pad = component.pads[0]
    expect(Math.abs(pad.position.z - component.position.z)).toBeCloseTo(0.9, 9)
    expect(pad.position.x).toBeCloseTo(component.position.x, 9)
    expect(component.onBoard).toBe(true)
    expect(scene.counts.pads).toBe(component.pads.length)
  })

  it('falls back to a generic body and warns for an unknown footprint', () => {
    const scene = buildPcbScene({
      ...BASE,
      components: [{
        id: 'c2', reference: 'U9', footprint: 'NOT-A-FOOTPRINT', x: 10, y: 10,
      }],
    })
    expect(scene.warnings).toContainEqual(expect.objectContaining({
      code: 'unknown-footprint', elementId: 'c2',
    }))
    expect(scene.components[0].bodyWidthMm).toBe(2)
  })

  it('flags components outside the outline', () => {
    const scene = buildPcbScene({
      ...BASE,
      components: [{ id: 'c3', reference: 'J1', footprint: '0805', x: -5, y: 10 }],
    })
    expect(scene.components[0].onBoard).toBe(false)
    expect(scene.warnings).toContainEqual(expect.objectContaining({
      code: 'component-outside-board', elementId: 'c3',
    }))
  })

  it('rejects invalid board dimensions and copper thickness', () => {
    expect(() => buildPcbScene({ ...BASE, widthMm: 0 })).toThrow(/Board width/)
    expect(() => buildPcbScene({ ...BASE, heightMm: Number.NaN })).toThrow(/Board height/)
    expect(() => buildPcbScene({ ...BASE, thicknessMm: -1 })).toThrow(/Board thickness/)
    expect(() => buildPcbScene({ ...BASE, copperThicknessMm: 0 })).toThrow(/Copper thickness/)
  })
})

describe('resolveFootprint', () => {
  it('resolves by id, by name and by family', () => {
    expect(resolveFootprint('res_0805')?.id).toBe('res_0805')
    expect(resolveFootprint('0805')?.id).toBe('res_0805')
    expect(resolveFootprint('not-real', 'ic')?.category).toBe('ic')
    expect(resolveFootprint('not-real', 'not-a-family')).toBeUndefined()
  })
})
