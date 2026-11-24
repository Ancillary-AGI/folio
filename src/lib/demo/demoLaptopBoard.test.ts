import { describe, expect, it } from 'vitest'
import { calculateBuckConverter } from '../electronics/powerSources'
import { ratsnest } from '../pcb/boardEdit'
import { buildPcbScene } from '../pcb/pcbScene'
import { buildLaptopPcb } from './demoLaptopBoard'

/**
 * The measurement this file exists to keep honest.
 *
 * A 56-package mainboard on an eight-layer stackup, routed by the same A* the PCB
 * workspace runs at the rules declared in `demoLaptopBoard.ts`, then audited by the
 * production `DesignRuleChecker`. Every number below was read off a run of this
 * test, not written first and then defended: the net count, the 14 signal nets the
 * two-copper-layer escape cannot close, the DRC verdict on the finished copper, and
 * the time it takes. If a change moves one of them, this test says so instead of the
 * demo card quietly claiming a better board.
 */
describe('laptop mainboard demo', () => {
  const laptop = buildLaptopPcb()

  it('routes the declared netlist and reports exactly what it could not close', () => {
    console.info(JSON.stringify(laptop.summary, null, 2))
    expect(laptop.summary.parts).toBe(56)
    expect(laptop.summary.nets).toBe(66)
    expect(laptop.summary.routedNets).toBe(52)
    expect(laptop.summary.unrouted).toEqual([
      'DDR1_5',
      'KB2',
      'RTC_BAT',
      'TP_INT',
      'SSD_PRE',
      'SSD_TXN',
      'SSD_CLKN',
      'SSD_CLKP',
      'USB2_DP',
      'USB2_DM',
      'EDP_DP0P',
      'USB1_DP',
      'EC_SCL',
      'EC_SDA',
    ])
    expect(laptop.summary.completion).toBeCloseTo(52 / 66, 10)
  })

  it('finishes with no DRC error on the copper it laid', () => {
    console.info(JSON.stringify(laptop.drc.summary), laptop.drc.violations.slice(0, 5).map(v => `${v.type}: ${v.message}`).join(' | '))
    expect(laptop.drc.summary).toEqual({ errors: 0, warnings: 0, totalViolations: 0 })
    expect(laptop.drc.isValid).toBe(true)
  })

  it('builds scene geometry for every part and layer', () => {
    const scene = buildPcbScene(laptop.scene)
    console.info(JSON.stringify(scene.counts), scene.warnings.map(w => w.message).join(' | '))
    expect(scene.warnings).toEqual([])
    expect(scene.counts.components).toBe(laptop.summary.parts)
    expect(scene.counts.copperLayers).toBe(8)
    expect(scene.counts.segments).toBeGreaterThan(200)
    expect(scene.counts.pours).toBe(6)
  })

  it('flies a line for every net the router left open, and none for a closed one', () => {
    // The panel's flighting is what tells the designer how much work the board
    // still is, so it has to agree with the router's own verdict — net by net.
    const traces = laptop.scene.traces.map((trace) => ({
      id: trace.id, layerId: trace.layerId, width: trace.widthMm, points: trace.points, netName: trace.net,
    }))
    const vias = laptop.scene.vias.map((via) => ({
      id: via.id, position: { x: via.x, y: via.y }, netName: via.net ?? '',
      padDiameter: via.padDiameterMm, drillDiameter: via.drillDiameterMm,
    }))
    const wires = ratsnest(laptop.pads, traces, vias)
    const openNets = new Set(wires.map((wire) => wire.netName))
    console.info(`ratsnest: ${wires.length} flylines over ${openNets.size} open nets`)
    expect([...laptop.summary.unrouted].filter((net) => !openNets.has(net))).toEqual([])
    expect([...openNets].filter((net) => !laptop.summary.unrouted.includes(net))).toEqual([])
  })

  it('stitches each rail to its plane and reports the vias it had to skip', () => {
    expect([...laptop.summary.planeNets].sort()).toEqual(['GND', 'V1V0', 'V3V3', 'V5', 'VBAT', 'VBUS_PROT'])
    expect(laptop.summary.stitchVias).toBeGreaterThan(400)
    expect(laptop.summary.stitchSkipped).toBeLessThan(laptop.summary.stitchVias / 10)
  })

  it('routes within the time the demo may spend on boot', () => {
    console.info(`laptop routeMs=${laptop.summary.routeMs}`)
    expect(laptop.summary.routeMs).toBeLessThan(30_000)
  })

  it('sizes the rails from the power library, not from typed numbers', () => {
    // The invariant is that the board prints what `calculateBuckConverter` derives
    // for the declared rail, load and switching frequency — duties included, which
    // are not the ideal Vout/Vin ratio because the library accounts for the
    // switch and diode drops the real regulator has to work through.
    const v3v3 = calculateBuckConverter({ vinV: 11.1, voutV: 3.3, ioutA: 2, switchingFreqHz: 400_000 })
    const v1v0 = calculateBuckConverter({ vinV: 11.1, voutV: 1.0, ioutA: 8, switchingFreqHz: 600_000 })
    expect(laptop.power.v3v3.dutyCycle).toBeCloseTo(v3v3.dutyCycle, 10)
    expect(laptop.power.v3v3.inductanceMicroH).toBeCloseTo(v3v3.inductanceMicroH, 10)
    expect(laptop.power.v1v0.dutyCycle).toBeCloseTo(v1v0.dutyCycle, 10)
    expect(laptop.power.v1v0.inductanceMicroH).toBeCloseTo(v1v0.inductanceMicroH, 10)
    // Both buck's feedback pair against the same 0.76 V reference with 20 k on
    // the bottom leg — the constants `demoLaptopBoard.ts` declares.
    expect(laptop.power.feedback.v3v3Top).toBeCloseTo((3.3 / 0.76 - 1) * 20_000, 6)
    expect(laptop.power.feedback.v1v0Top).toBeCloseTo((1.0 / 0.76 - 1) * 20_000, 6)
    expect(laptop.power.feedback.v3v3Bottom).toBe(20_000)
  })
})
