import { describe, expect, it } from 'vitest'
import { buildDemoBoard } from '../demo/demoBoard'
import { captureDesignSnapshot } from '../agents/designSnapshot'
import { buildCircuitNetlist } from '../simulation/netlistBuilder'
import { spiceEngine } from '../simulation/spiceEngine'
import { assessDesignMargins } from './designMargins'

const run = async (overrides: Record<string, string | number | boolean> = {}) => {
  const demo = buildDemoBoard()
  const components = demo.components.map((component) =>
    component.reference === 'RSRC'
      ? { ...component, properties: { ...component.properties, ...overrides } }
      : component,
  )
  const snapshot = captureDesignSnapshot(components, demo.wires)
  const netlist = buildCircuitNetlist('margins', components, demo.wires, {
    type: 'transient',
    stopTime: 20e-3,
    stepTime: 20e-6,
  })
  const result = await spiceEngine.simulate(netlist)
  return { snapshot, result }
}

describe('design margins', () => {
  it('measures the rectifier, rates its packages, and reports the limiting factor', async () => {
    const { snapshot, result } = await run()
    expect(result.success).toBe(true)
    // New solver surface: the transient carries device currents, not just nodes.
    expect(result.waveforms.some((waveform) => waveform.name === 'I(D1)')).toBe(true)
    expect(result.waveforms.some((waveform) => waveform.name === 'I(RSRC)')).toBe(true)

    const report = assessDesignMargins(snapshot, result)
    expect(report.coverage.components).toBe(5)
    expect(report.coverage.unrated.map((entry) => entry.reference)).not.toContain('C1')
    const rload = report.measurements.find((m) => m.reference === 'RLOAD')
    expect(rload?.powerAverageW).toBeGreaterThan(0)
    expect(report.measurements.find((m) => m.reference === 'D1')?.powerAverageW).toBeGreaterThan(0)
    expect(report.measurements.find((m) => m.reference === 'D1')?.reversePeakV).toBeGreaterThan(3)
    expect(report.hottest?.reference).toBeTruthy()
    expect(report.worst).toBeDefined()
    expect(report.limitingFactor).toContain(report.worst?.reference ?? '')

    // Power is V·I, not average voltage. The 10 V sine through RSRC into a
    // 100 Ω load must land near Vout²/R, not near the 3.2 V output itself.
    expect(rload?.powerAverageW).toBeGreaterThan(0.08)
    expect(rload?.powerAverageW).toBeLessThan(0.15)
    const capacitor = report.measurements.find((m) => m.reference === 'C1')
    expect(capacitor?.powerAverageW).toBeLessThan(0.01)
    // Ideal capacitors and sources must not inherit a chip-resistor package
    // rating and become the fictitious "hottest part".
    expect(report.items.some((item) => item.id === 'C1.power')).toBe(false)
    expect(report.items.some((item) => item.id === 'V1.power')).toBe(false)
    expect(capacitor?.thermal).toBeUndefined()
    expect(report.hottest?.reference).not.toBe('C1')

    const voltageItem = report.items.find((item) => item.id === 'C1.voltage')
    expect(voltageItem?.limit).toBe(50)
    expect(voltageItem?.status).toBe('ok')
    const diode = report.items.find((item) => item.id === 'D1.voltage')
    expect(diode?.limit).toBe(40)
    const resistorPower = report.items.find((item) => item.id === 'RLOAD.power')
    expect(resistorPower?.limit).toBeCloseTo(0.25, 9)
    expect(report.power.sourceCount).toBe(1)
    expect(report.power.suppliedW ?? 0).toBeGreaterThan(0)
    expect(report.power.dissipatedW ?? 0).toBeGreaterThan(0)
    // A closed budget: the only gap is energy stored in the capacitor.
    expect(report.power.suppliedW ?? 0).toBeGreaterThan(report.power.dissipatedW ?? 0)
    const gap = (report.power.suppliedW ?? 0) - (report.power.dissipatedW ?? 0)
    expect(gap).toBeLessThan((report.power.suppliedW ?? 0) * 0.05)
  })

  it('fails a component that exceeds its declared rating', async () => {
    const { snapshot, result } = await run({ power: '0.0001W' })
    const report = assessDesignMargins(snapshot, result)
    const over = report.items.find((item) => item.id === 'RSRC.power')
    expect(over?.status).toBe('fail')
    expect(over?.utilization).toBeGreaterThan(1)
    expect(report.worst?.id).toBe('RSRC.power')
    expect(report.limitingFactor).toMatch(/RSRC power/)
  })

  it('accepts an explicit thetaJA and reports junction temperature', async () => {
    const { snapshot, result } = await run()
    const report = assessDesignMargins(snapshot, result, { ambientCelsius: 40, thetaJaOverride: 60 })
    const rload = report.measurements.find((m) => m.reference === 'RLOAD')
    expect(rload?.thermal?.ambientC).toBe(40)
    expect(rload?.thermal?.thetaJa).toBe(60)
    expect(rload?.thermal?.estimated).toBe(false)
    expect(rload?.thermal?.junctionC).toBeGreaterThan(40)
    expect(report.assumptions.join(' ')).toMatch(/60 K\/W/)
  })

  it('refuses to fabricate margins from a frequency-domain run', async () => {
    const { snapshot } = await run()
    const report = assessDesignMargins(snapshot, {
      success: true,
      nodes: [],
      waveforms: [],
      analysis: 'ac',
    })
    expect(report.items).toEqual([])
    expect(report.notes.join(' ')).toMatch(/frequency-domain/i)
  })

  it('describes a Monte Carlo envelope as statistical, not frequency-domain', () => {
    const demo = buildDemoBoard()
    const snapshot = captureDesignSnapshot(demo.components, demo.wires)
    const report = assessDesignMargins(snapshot, {
      success: true,
      nodes: [],
      waveforms: [],
      analysis: 'montecarlo',
    })
    expect(report.items).toEqual([])
    expect(report.notes.join(' ')).toMatch(/statistical envelope/i)
    expect(report.notes.join(' ')).not.toMatch(/frequency-domain/i)
  })

  it('reports a missing simulation rather than inventing ratings', () => {
    const demo = buildDemoBoard()
    const snapshot = captureDesignSnapshot(demo.components, demo.wires)
    const report = assessDesignMargins(snapshot, null)
    expect(report.items).toEqual([])
    expect(report.notes.join(' ')).toMatch(/Run a DC operating point or transient/i)
  })
})
