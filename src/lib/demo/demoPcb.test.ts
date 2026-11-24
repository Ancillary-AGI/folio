import { describe, expect, it } from 'vitest'
import { buildPcbScene } from '../pcb/pcbScene'
import { buildDemoPcb } from './demoPcb'

describe('demo PCB', () => {
  it('routes the tested rectifier netlist with the real autorouter', () => {
    const demo = buildDemoPcb()

    expect(demo.summary.totalNets).toBe(4)
    expect(demo.summary.routedNets).toBe(4)
    expect(demo.summary.unrouted).toEqual([])
    expect(demo.summary.traceLengthMm).toBeGreaterThan(0)
    expect(demo.traces.length).toBeGreaterThan(0)
    expect(demo.traces.every((trace) => trace.points.length >= 2)).toBe(true)
  })

  it('keeps every routed point inside the declared outline', () => {
    const demo = buildDemoPcb()
    const { widthMm, heightMm } = demo.board

    for (const trace of demo.traces) {
      for (const point of trace.points) {
        expect(Number.isFinite(point.x)).toBe(true)
        expect(Number.isFinite(point.y)).toBe(true)
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(widthMm)
        expect(point.y).toBeLessThanOrEqual(heightMm)
      }
    }
    for (const via of demo.vias) {
      expect(via.x).toBeGreaterThanOrEqual(0)
      expect(via.y).toBeGreaterThanOrEqual(0)
      expect(via.x).toBeLessThanOrEqual(widthMm)
      expect(via.y).toBeLessThanOrEqual(heightMm)
    }
  })

  it('builds a scene with no unresolved footprints or off-board parts', () => {
    const demo = buildDemoPcb()
    const scene = buildPcbScene(demo.scene)

    // Five physical parts; the ground symbol is a net annotation, not a body.
    expect(scene.components).toHaveLength(5)
    expect(scene.components.map((component) => component.reference)).not.toContain('G1')
    expect(scene.traces.length).toBeGreaterThan(0)
    expect(scene.layers.filter((layer) => layer.kind === 'copper')).toHaveLength(2)
    expect(scene.warnings).toEqual([])
  })
})
