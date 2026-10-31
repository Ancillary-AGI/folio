import { describe, expect, it } from 'vitest'
import { buildPcbScene } from '../pcb/pcbScene'
import { buildPlaneBoard } from '../pcb/planeBoard'
import { ratsnest } from '../pcb/boardEdit'
import { buildShowcasePcb, SHOWCASE_SPEC } from './demoShowcase'

describe('showcase board', () => {
  const demo = buildShowcasePcb()

  it('routes the whole netlist with the A* autorouter', () => {
    console.info(JSON.stringify(demo.summary, null, 2))
    expect(demo.summary.unrouted).toEqual([])
    expect(demo.summary.completion).toBe(1)
  })

  it('produces scene geometry with no out-of-bounds warnings', () => {
    const scene = buildPcbScene(demo.scene)
    console.info(JSON.stringify(scene.counts), scene.warnings.map((w) => w.message).join(' | '))
    expect(scene.warnings).toEqual([])
    expect(scene.counts.components).toBe(demo.summary.parts)
    expect(scene.counts.segments).toBeGreaterThan(40)
  })

  it('passes the production design-rule checker at its own rules', () => {
    // Not the router's own bookkeeping: `DesignRuleChecker` re-measures every trace,
    // via and land pair on the finished board, with drilled lands carried as copper
    // on both faces.
    console.info(JSON.stringify(demo.drc.summary), demo.drc.violations.slice(0, 5).map((v) => `${v.type}: ${v.message}`).join(' | '))
    expect(demo.drc.summary).toEqual({ errors: 0, warnings: 0, totalViolations: 0 })
    expect(demo.drc.isValid).toBe(true)
  })

  it('routes within the documented time budget', () => {
    expect(demo.summary.routeMs).toBeLessThan(20_000)
  })

  it('leaves the editor with nothing to fly', () => {
    // 26 of 26 nets closed, so the panel's ratsnest over this board's own pads and
    // copper must be silent. Measured here rather than trusted from the count.
    const traces = demo.scene.traces.map((trace) => ({
      id: trace.id, layerId: trace.layerId, width: trace.widthMm, points: trace.points, netName: trace.net,
    }))
    const vias = demo.scene.vias.map((via) => ({
      id: via.id, position: { x: via.x, y: via.y }, netName: via.net ?? '',
      padDiameter: via.padDiameterMm, drillDiameter: via.drillDiameterMm,
    }))
    const wires = ratsnest(demo.pads, traces, vias)
    console.info(`ratsnest: ${wires.length} flylines`, wires.slice(0, 6).map((w) => w.netName).join(', '))
    expect(wires).toEqual([])
  })

  it('loses escape lanes only when the routing grid is coarsened past the pitch', () => {
    // The `gridMm: 0.3` note in the demo claims a coarser grid drops a net on this
    // board. Same netlist, same rules, one number changed — swept and measured, so
    // the claim says where the lane actually goes away instead of where it used to.
    const sweep = [0.3, 0.4, 0.5, 0.6, 0.8].map((gridMm) => {
      const board = buildPlaneBoard({ ...SHOWCASE_SPEC, router: { ...SHOWCASE_SPEC.router, gridMm } })
      return { gridMm, routed: board.summary.routedNets, unrouted: board.summary.unrouted }
    })
    console.info(sweep.map((row) => `${row.gridMm} mm: ${row.routed}/26 (${row.unrouted.join(', ') || 'clean'})`).join(' | '))
    expect(sweep[0].routed).toBe(26)
    expect(sweep[sweep.length - 1].routed).toBeLessThan(26)
  })
})
