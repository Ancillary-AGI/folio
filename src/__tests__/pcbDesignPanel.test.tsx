/**
 * PCBDesignPanel render coverage.
 *
 * The panel is the React surface over the EMC, thermal and signal-integrity
 * engines plus the DRC/auto-route logic; nothing mounted it before. The
 * engines are stubbed where the point of the test is the UI's reaction to
 * them — wire→trace routing, DRC verdicts and export plumbing stay real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PCBDesignPanel from '../components/pcb/PCBDesignPanel'
import { useProjectStore } from '../stores/useProjectStore'
import { useAppStore } from '../stores/useAppStore'
import { emcSimulationEngine } from '../lib/emc/emcSimulation'
import type { EMCResult } from '../lib/emc/emcSimulation'
import { thermalAnalysisEngine } from '../lib/pcb/thermalAnalysis'
import type { ThermalAnalysisResult } from '../lib/pcb/thermalAnalysis'
import { analyzeSignalPath } from '../lib/manufacturing/signalIntegrity'
import { polylineLength } from '../lib/geometry/distance'
import {
  fourLayerStackup,
  microstripImpedance,
  nearestPlane,
  validateStackup,
} from '../lib/manufacturing/stackup'
import { planeLoopInductance, stitchingGrid } from '../lib/manufacturing/powerIntegrity'
import { dogboneFanout, MICROVIA_FANOUT_RULES } from '../lib/manufacturing/bgaFanout'
import { SOC_256 } from '../lib/electronics/socPackages'
import type { PlacedComponent, Wire, Net } from '../types'
import type { Component } from '../lib/supabase'
import { buildDemoBoard } from '../lib/demo/demoBoard'
import { buildDemoPcb } from '../lib/demo/demoPcb'
import { AgentHarness } from '../lib/agents/agentHarness'
import { registerEdaTools } from '../lib/agents/edaTools'

const exportSpies = vi.hoisted(() => ({
  exportToGerber: vi.fn(() => 'G04 test*'),
  downloadFile: vi.fn(),
}))
vi.mock('../lib/exportUtils', () => exportSpies)

/** Schematic wire with two points — enough to become a trace. */
const net = (netName: string, id: string): Wire => ({
  id,
  points: [{ x: 10, y: 10 }, { x: 60, y: 45 }],
  netName,
  connectedPins: [],
})

/** Wire tying two component pins into one net (what the router consumes). */
const pinNet = (netName: string, id: string, pins: Net['connectedPins']): Wire => ({
  id,
  points: [{ x: 10, y: 10 }, { x: 60, y: 45 }],
  netName,
  connectedPins: pins,
})

/** Two-pin part placed at a given mm position on the 100 × 80 board. */
const partAt = (id: string, x: number, y: number): PlacedComponent => ({
  id,
  componentId: `cmp-${id}`,
  component: {
    id: `cmp-${id}`,
    name: id.toUpperCase(),
    category: 'passive',
    symbol: { width: 60, height: 40, paths: [] },
    pins: [
      { id: '1', name: 'A', x: 0, y: 0, type: 'passive' },
      { id: '2', name: 'B', x: 0, y: 8, type: 'passive' },
    ],
    properties: {},
  },
  position: { x, y },
  rotation: 0,
  scale: 1,
  reference: id.toUpperCase(),
  properties: {},
})

const part: PlacedComponent = {
  id: 'pc-u1',
  componentId: 'cmp-mcu',
  component: {
    id: 'cmp-mcu',
    name: 'MCU',
    category: 'ic',
    symbol: { width: 60, height: 40, paths: [] },
    pins: [{ id: '1', name: 'VCC', x: 0, y: 0, type: 'power' }],
    properties: {},
  },
  position: { x: 400, y: 300 },
  rotation: 0,
  scale: 1,
  reference: 'U1',
  properties: { power: 0.8 },
}

/** Radix tabs activate on pointer-down, not click. */
const openTab = (name: string) => {
  const tab = screen.getByRole('tab', { name })
  fireEvent.mouseDown(tab)
  fireEvent.click(tab)
}

/**
 * jsdom has no SVG CTMs and reports a zero-sized box. A 1:1-mapping 1000 px
 * square lets pointer gestures resolve to board millimetres deterministically.
 */
const mockBoardRect = (): SVGSVGElement => {
  const svg = document.querySelector('svg[aria-label^="PCB layout"]') as SVGSVGElement
  expect(svg).not.toBeNull()
  Object.defineProperty(svg, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      width: 1000, height: 1000, left: 0, top: 0, right: 1000, bottom: 1000,
      x: 0, y: 0, toJSON: () => ({}),
    }),
  })
  return svg
}

/** Board millimetre → client pixel for a 100 × 80 board in the mock box. */
const boardToClient = (boardWidth: number, boardHeight: number) => {
  const margin = Math.max(4, Math.min(boardWidth, boardHeight) * 0.08)
  const viewWidth = boardWidth + margin * 2
  const viewHeight = boardHeight + margin * 2
  const scale = Math.min(1000 / viewWidth, 1000 / viewHeight)
  const offsetX = (1000 - viewWidth * scale) / 2
  const offsetY = (1000 - viewHeight * scale) / 2
  return (x: number, y: number) => ({
    clientX: offsetX + (x + margin) * scale,
    clientY: offsetY + (y + margin) * scale,
  })
}

describe('PCBDesignPanel', () => {
  beforeEach(() => {
    // The panel adopts a stored routed layout on mount, so each test starts
    // from a clean board rather than inheriting the previous test's copper.
    useProjectStore.setState({ components: [], wires: [], pcbLayout: null })
    useAppStore.setState({ selectedComponents: [], selectedWires: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    exportSpies.exportToGerber.mockClear()
    exportSpies.downloadFile.mockClear()
  })

  it('renders the chrome, layer stack, tools and design rules', () => {
    const onClose = vi.fn()
    render(<PCBDesignPanel onClose={onClose} />)

    expect(screen.getByRole('heading', { name: 'PCB Design' })).toBeInTheDocument()
    for (const tab of ['Canvas', 'DRC', 'EMC', 'Thermal', 'Signal', 'Advanced', 'Assembly']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument()
    }
    expect(screen.getByRole('tab', { name: 'Canvas' })).toHaveAttribute('data-state', 'active')

    // Default 7-layer stack; bottom soldermask ships hidden.
    for (const layer of [
      'Top Copper', 'Inner 1 (GND)', 'Inner 2 (PWR)', 'Bottom Copper',
      'Top Silkscreen', 'Top Soldermask', 'Bottom Soldermask',
    ]) {
      expect(screen.getByText(layer)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: 'Hide Top Copper' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show Bottom Soldermask' })).toBeInTheDocument()

    // Tool palette, canvas readout, counters and the design-rule table.
    for (const tool of ['Select', 'Route', 'Place via', 'Move part', 'Keep-out', 'Measure', 'Board outline']) {
      expect(screen.getByRole('button', { name: tool })).toBeInTheDocument()
    }
    expect(screen.getAllByText(/100 × 80 mm/)).not.toHaveLength(0)
    expect(screen.getByText('Traces: 0 | Vias: 0')).toBeInTheDocument()
    expect(screen.getByText('min trace width')).toBeInTheDocument()
    expect(screen.getByText('0.05 mm')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close PCB panel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps each analysis guard copy behind its tab', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)

    // Inactive Radix panes are unmounted, so only the canvas shows at first.
    expect(screen.queryByText(/Click "Run DRC"/)).not.toBeInTheDocument()

    openTab('DRC')
    expect(screen.getByText('Design Rule Check — 0 issues')).toBeInTheDocument()
    expect(screen.getByText(/Click "Run DRC" to check your design/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'DRC' })).toHaveAttribute('data-state', 'active')

    openTab('EMC')
    expect(screen.getByText(/Click "Run EMC" to analyse electromagnetic compliance/)).toBeInTheDocument()

    openTab('Thermal')
    expect(screen.getByText(/Click "Run Thermal" to simulate heat distribution/)).toBeInTheDocument()

    openTab('Signal')
    expect(screen.getByText(/Click "Run SI" to analyse signal integrity/)).toBeInTheDocument()
  })

  it('switches the active tool and layer, and toggles layer visibility', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)

    // 'Select' starts active (default variant); picking a tool moves it.
    expect(screen.getByRole('button', { name: 'Select' })).toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'Route' })).toHaveClass('bg-background')
    fireEvent.click(screen.getByRole('button', { name: 'Route' }))
    expect(screen.getByRole('button', { name: 'Route' })).toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'Select' })).not.toHaveClass('bg-primary')

    // Selecting a layer re-labels the canvas readout.
    fireEvent.click(screen.getByText('Inner 1 (GND)'))
    expect(screen.getByText(/Layer: Inner 1 \(GND\)/)).toBeInTheDocument()

    // The eye button flips visibility without stealing row selection.
    fireEvent.click(screen.getByRole('button', { name: 'Hide Top Copper' }))
    expect(screen.getByRole('button', { name: 'Show Top Copper' })).toBeInTheDocument()
    expect(screen.getByText(/Layer: Inner 1 \(GND\)/)).toBeInTheDocument()
  })

  it('auto-routes two pin nets through the A* router and clears DRC', () => {
    const components = [partAt('r1', 10, 10), partAt('r2', 60, 45)]
    const wires = [
      pinNet('GND', 'w1', [
        { componentId: 'r1', pinId: '1' },
        { componentId: 'r2', pinId: '1' },
      ]),
      pinNet('VCC', 'w2', [
        { componentId: 'r1', pinId: '2' },
        { componentId: 'r2', pinId: '2' },
      ]),
    ]
    render(<PCBDesignPanel onClose={vi.fn()} components={components} wires={wires} />)

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Route from Schematic' }))
    expect(screen.getByText('Traces: 2 | Vias: 0')).toBeInTheDocument()

    // One trace per net, layer-locked to top copper, endpoint-anchored on the
    // pad grid cells (the lucide toolbar icons render their own polylines, so
    // scope to the board overview).
    const boardSvg = document.querySelector('svg[aria-label^="PCB layout"]')
    expect(boardSvg).not.toBeNull()
    const traceLines = boardSvg!.querySelectorAll('polyline')
    expect(traceLines).toHaveLength(2)
    const pointLists = Array.from(traceLines).map(l => l.getAttribute('points') ?? '')
    expect(pointLists.some(p => /^10,10 .*60,45$/.test(p))).toBe(true)
    expect(pointLists.some(p => /^10,18 .*60,53$/.test(p))).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: 'Run DRC' }))
    expect(screen.getByRole('tab', { name: 'DRC' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('Design Rule Check — 0 issues')).toBeInTheDocument()
    expect(screen.getByText(/No copper rule broken in the scope above/)).toBeInTheDocument()
    // The verdict counts the copper and constraint geometry it measured: the four
    // lands the parts were routed from and the drawn keep-outs are scope, not
    // omissions.
    expect(screen.getByText(/DRC clean on 2 traces, 0 vias, 4 lands and 0 keep-outs/)).toBeInTheDocument()
    // What it did not judge is still named, and for the reason that is true: the
    // board places lands, so no package outline exists to overlap.
    expect(screen.getByText(/Not checked: courtyard overlap between footprints/)).toBeInTheDocument()
    expect(screen.queryByText(/Not checked: pad size/)).not.toBeInTheDocument()
  })

  it('flags nets that have no copper as DRC warnings', () => {
    render(<PCBDesignPanel onClose={vi.fn()} wires={[net('GND', 'w1')]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run DRC' }))

    expect(screen.getByText('Design Rule Check — 1 issue')).toBeInTheDocument()
    expect(screen.getByText(/has no copper trace/)).toBeInTheDocument()
    expect(screen.getByText('1 warning')).toBeInTheDocument()
    expect(screen.queryByText(/DRC clean/)).not.toBeInTheDocument()
  })

  it('refuses EMC analysis before any trace exists', () => {
    const simulate = vi.spyOn(emcSimulationEngine, 'simulate')
    render(<PCBDesignPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run EMC' }))

    expect(simulate).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Route at least one trace')
    expect(screen.getByRole('tab', { name: 'EMC' })).toHaveAttribute('data-state', 'active')
  })

  it('runs EMC with the declared assumptions and renders the estimate', () => {
    const canned: EMCResult = {
      radiatedDBuVPerM: 34.2,
      radiatedDBuV: 34.2,
      conductedDBuV: 31.8,
      limitDBuV: 40,
      marginDb: 5.8,
      compliant: true,
      hotspots: [],
      recommendations: ['Keep the return plane continuous under the clock trace.'],
      basis: { traceCount: 2, worstFrequencyHz: 1e7, worstCurrentA: 0.1, worstCommonModeCurrentA: 0.001 },
    }
    const simulate = vi.spyOn(emcSimulationEngine, 'simulate').mockReturnValue(canned)
    const components = [partAt('r1', 10, 10), partAt('r2', 60, 45)]
    const wires = [
      pinNet('GND', 'w1', [
        { componentId: 'r1', pinId: '1' },
        { componentId: 'r2', pinId: '1' },
      ]),
      pinNet('VCC', 'w2', [
        { componentId: 'r1', pinId: '2' },
        { componentId: 'r2', pinId: '2' },
      ]),
    ]
    render(<PCBDesignPanel onClose={vi.fn()} components={components} wires={wires} />)
    fireEvent.click(screen.getByRole('button', { name: 'Auto-Route from Schematic' }))

    fireEvent.click(screen.getByRole('button', { name: 'Run EMC' }))

    expect(simulate).toHaveBeenCalledTimes(1)
    const [traces, standard] = simulate.mock.calls[0]
    expect(standard).toBe('CISPR32')
    expect(traces).toHaveLength(2)
    expect(traces[0]).toMatchObject({
      currentA: 0.1,
      frequencyHz: 1e7,
      commonModeCurrentA: 0,
      cableLengthMm: 0,
    })
    expect(traces[0].loopAreaMm2).toBeCloseTo(traces[0].lengthMm * 0.2, 9)
    expect(screen.getByRole('tab', { name: 'EMC' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('Radiated Emission')).toBeInTheDocument()
    expect(screen.getByText('34.2 dBµV/m')).toBeInTheDocument()
    expect(screen.getByText('Conducted Emission')).toBeInTheDocument()
    expect(screen.getByText('31.8 dBµV')).toBeInTheDocument()
    expect(screen.getByText('Radiated limit / margin')).toBeInTheDocument()
    expect(screen.getByText('40 / 5.8 dB')).toBeInTheDocument()
    expect(screen.getByText('Estimated below the CISPR 32 Class B radiated limit')).toBeInTheDocument()
    expect(screen.getByText(/Keep the return plane continuous/)).toBeInTheDocument()
  })

  it('awaits the thermal solver and renders the hotspot report', async () => {
    const canned: ThermalAnalysisResult = {
      nodes: [],
      hotspots: [{ nodeId: 'pc-u1', temperature: 85, severity: 'critical' }],
      thermalGradient: [],
      maxTemperature: 62.4,
      converged: true,
      simulatedTime: 120,
      timeToSteadyState: 120,
      recommendations: ['Add a heatsink over pc-u1.'],
    }
    const analyze = vi.spyOn(thermalAnalysisEngine, 'analyzeThermal').mockResolvedValue(canned)
    render(<PCBDesignPanel onClose={vi.fn()} components={[part]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run Thermal' }))

    expect(await screen.findByText('Max temperature')).toBeInTheDocument()
    expect(screen.getByText('62.4 °C')).toBeInTheDocument()
    expect(screen.getByText('Hotspots')).toBeInTheDocument()
    expect(screen.getByText(/pc-u1: 85.0 °C — critical/)).toBeInTheDocument()
    expect(screen.getByText(/Add a heatsink over pc-u1/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Thermal' })).toHaveAttribute('data-state', 'active')

    // The placed part drives one node carrying its dissipated power.
    expect(analyze).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'pc-u1', powerDissipation: 0.8 })],
      [expect.objectContaining({ type: 'convection' })],
      expect.objectContaining({ ambientTemperature: 25, layerCount: 4 }),
    )
    // Analysis buttons come back once the run settles.
    expect(screen.getByRole('button', { name: 'Run EMC' })).toBeEnabled()
  })

  it('refuses signal integrity before any trace exists', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run Signal Integrity' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Route at least one trace')
    expect(screen.queryByText('Z₀')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Signal' })).toHaveAttribute('data-state', 'active')
  })

  it('renders physics-correct signal-integrity metrics for the first routed trace', async () => {
    const components = [partAt('r1', 10, 10), partAt('r2', 60, 45)]
    const wires = [
      pinNet('GND', 'w1', [
        { componentId: 'r1', pinId: '1' },
        { componentId: 'r2', pinId: '1' },
      ]),
      pinNet('VCC', 'w2', [
        { componentId: 'r1', pinId: '2' },
        { componentId: 'r2', pinId: '2' },
      ]),
    ]
    render(<PCBDesignPanel onClose={vi.fn()} components={components} wires={wires} />)
    // A failed run leaves an error; routing copper must clear it.
    fireEvent.click(screen.getByRole('button', { name: 'Run Signal Integrity' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Route at least one trace')
    fireEvent.click(screen.getByRole('button', { name: 'Auto-Route from Schematic' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    openTab('Canvas')

    // The panel analyses traces[0], whose length and width are the routed
    // values — not a fictional reference line.
    const boardSvg = document.querySelector('svg[aria-label^="PCB layout"]')
    expect(boardSvg).not.toBeNull()
    const polyline = boardSvg!.querySelector('polyline')
    expect(polyline).not.toBeNull()
    const points = (polyline!.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number)
        return { x, y }
      })
    const lengthMm = polylineLength(points)
    const widthMm = Number(polyline!.getAttribute('stroke-width'))

    fireEvent.click(screen.getByRole('button', { name: 'Run Signal Integrity' }))

    const expected = analyzeSignalPath({
      geometry: { kind: 'microstrip', widthMm, heightMm: 0.2, epsilonR: 4.4, copperThicknessMm: 0.035 },
      lengthMm,
      driverImpedanceOhm: 22,
      loadImpedanceOhm: 1e6,
      vHigh: 3.3,
    })
    expect(expected.success).toBe(true)

    expect(await screen.findByText('Z₀')).toBeInTheDocument()
    expect(screen.getByText(`${expected.z0Ohm.toFixed(1)} Ω`)).toBeInTheDocument()
    expect(screen.getByText(`${expected.delayNs.toFixed(2)} ns`)).toBeInTheDocument()
    expect(screen.getByText(`${expected.overshootVolts.toFixed(2)} V`)).toBeInTheDocument()
    expect(screen.getByText(expected.gammaLoad.toFixed(2))).toBeInTheDocument()
    expect(screen.getByText(/Trace trace_0/)).toBeInTheDocument()
    expect(screen.getByText(/Settles at/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Signal' })).toHaveAttribute('data-state', 'active')
  })

  it('exports Gerber and JSON through the export helpers', () => {
    const components = [part]
    const wires = [net('GND', 'w1')]
    render(<PCBDesignPanel onClose={vi.fn()} components={components} wires={wires} />)

    fireEvent.click(screen.getByRole('button', { name: 'Gerber (RS-274X)' }))
    expect(exportSpies.exportToGerber).toHaveBeenCalledWith(components, wires)
    expect(exportSpies.downloadFile).toHaveBeenCalledWith(
      'G04 test*',
      expect.stringMatching(/^pcb_top_copper_\d+\.gbr$/),
      'text/plain',
    )

    fireEvent.click(screen.getByRole('button', { name: 'PCB JSON' }))
    expect(exportSpies.downloadFile).toHaveBeenLastCalledWith(
      expect.stringContaining('"traces"'),
      expect.stringMatching(/^pcb_\d+\.json$/),
      'application/json',
    )
  })

  it('exports the fab package through buildFabPackage and gates violations', async () => {
    const fab = await import('../lib/manufacturing/fabExport')
    const spy = vi.spyOn(fab, 'buildFabPackage').mockReturnValue({
      files: new Map([['folio-pcb-F_Cu.gtl', 'G04 ok*']]),
      centroid: [],
      bom: [],
      violations: [],
      planes: [],
      shippable: true,
    })
    try {
      render(<PCBDesignPanel onClose={vi.fn()} components={[part]} wires={[net('GND', 'w1')]} />)
      fireEvent.click(screen.getByRole('button', { name: /Fab package/ }))
      expect(spy).toHaveBeenCalled()
      // Four copper layers in the default stackup means two inner films.
      expect(spy.mock.calls[0][2]).toMatchObject({ innerLayerCount: 2, planes: [] })
      expect(spy.mock.calls[0][2]?.nets?.map((entry) => entry.name)).toEqual(['GND'])
      expect(screen.getByText(/shippable/)).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('passes an inner-layer pour to the fab package when the stack declares one', async () => {
    const fab = await import('../lib/manufacturing/fabExport')
    const spy = vi.spyOn(fab, 'buildFabPackage').mockReturnValue({
      files: new Map([['folio-pcb-In1_Cu.g1', 'G04 plane*']]),
      centroid: [],
      bom: [],
      violations: [],
      planes: [{ film: 'inner-1', netName: 'GND', connections: 1, antiPads: 0 }],
      shippable: true,
    })
    try {
      const { container } = render(<PCBDesignPanel onClose={vi.fn()} components={[part]} wires={[net('GND', 'w1')]} />)
      const select = container.querySelector<HTMLSelectElement>('#plane-net-in1-cu')
      expect(select).not.toBeNull()
      fireEvent.change(select!, { target: { value: 'GND' } })
      fireEvent.click(screen.getByRole('button', { name: /Fab package/ }))
      expect(spy.mock.calls[0][2]?.planes).toEqual([{ film: 'inner-1', netName: 'GND' }])
      expect(screen.getByText(/GND pour on inner-1/)).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('renders the advanced stackup, power-integrity and BGA analyses', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    openTab('Advanced')

    const layers = fourLayerStackup()
    const { stackup } = validateStackup(layers)
    expect(screen.getByText('Stackup & controlled impedance')).toBeInTheDocument()
    expect(screen.getByText(`${stackup.totalThickness.toFixed(2)} mm`)).toBeInTheDocument()
    expect(screen.getByText(/Symmetric stackup, thickness within/)).toBeInTheDocument()

    const reference = nearestPlane(layers, 0)
    expect(reference).toBeDefined()
    const z0 = microstripImpedance(0.2, reference!.distance, 0.035, reference!.er)
    expect(screen.getByText(new RegExp(`${z0.toFixed(1)} Ω`))).toBeInTheDocument()

    // Plane pair 0.2 mm apart and a 10 mm stitching grid over 100 × 80 mm.
    const loop = planeLoopInductance(100, 80, 0.2)
    expect(screen.getByText(`${loop.toFixed(3)} nH`)).toBeInTheDocument()
    expect(screen.getByText(`${stitchingGrid(100, 80, 10, 1).length} @ 10 mm`)).toBeInTheDocument()

    // Template BGA: power balls tie to planes, every other net gets a via.
    const balls = SOC_256.balls.map((ball) => ({ ...ball, isPower: ball.kind === 'power' }))
    const fanout = dogboneFanout(balls, SOC_256, MICROVIA_FANOUT_RULES)
    expect(screen.getByText(
      `${SOC_256.partNumber} — ${SOC_256.rows}×${SOC_256.cols} @ ${SOC_256.pitch} mm`,
    )).toBeInTheDocument()
    expect(screen.getByText(`${fanout.vias.length} vias, planes: ${fanout.planeNets.join(' / ')}`))
      .toBeInTheDocument()
    expect(screen.getByText(/VDDIO ×/)).toBeInTheDocument()
    expect(screen.getByText(/No routed pairs yet/)).toBeInTheDocument()
  })

  it('derives DDR lane and fly-by checks from the routed copper', () => {
    const components = [
      partAt('r1', 10, 10), partAt('r2', 60, 45),
      partAt('r3', 20, 20), partAt('r4', 70, 55),
      partAt('r5', 30, 30), partAt('r6', 80, 60),
    ]
    const wires = [
      pinNet('DQS0', 'w1', [
        { componentId: 'r1', pinId: '1' }, { componentId: 'r2', pinId: '1' },
      ]),
      pinNet('DQ0', 'w2', [
        { componentId: 'r3', pinId: '1' }, { componentId: 'r4', pinId: '1' },
      ]),
      pinNet('CLK', 'w3', [
        { componentId: 'r5', pinId: '1' }, { componentId: 'r6', pinId: '1' },
      ]),
      pinNet('ADDR0', 'w4', [
        { componentId: 'r2', pinId: '2' }, { componentId: 'r4', pinId: '2' },
      ]),
    ]
    render(<PCBDesignPanel onClose={vi.fn()} components={components} wires={wires} />)
    fireEvent.click(screen.getByRole('button', { name: 'Auto-Route from Schematic' }))
    openTab('Advanced')

    expect(screen.getByText(/DQS0 \(lane 0\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 DQ bit · strobe/)).toBeInTheDocument()
    expect(screen.getByText(/Fly-by · CLK/)).toBeInTheDocument()
    expect(screen.getByText(/1 address net/)).toBeInTheDocument()
  })

  it('shows the DDR empty state before any matching net is routed', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    openTab('Advanced')
    expect(screen.getByText(/No DDR nets on the routed copper/)).toBeInTheDocument()
  })

  it('validates HDI microvia spans against the copper stack', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    openTab('Advanced')

    fireEvent.click(screen.getByRole('button', { name: 'Validate via span' }))
    expect(screen.getByRole('status')).toHaveTextContent(/top-cu → in1-cu is a legal microvia span/)

    fireEvent.change(screen.getByLabelText('Microvia end layer'), { target: { value: 'in2-cu' } })
    fireEvent.click(screen.getByRole('button', { name: 'Validate via span' }))
    expect(screen.getByRole('status')).toHaveTextContent(/spans 2 layers, max microvia span is 1/)
  })

  it('parses an IBIS file loaded from disk in the advanced tab', async () => {
    const ibs = [
      '[IBIS Ver] 3.2',
      '[File Name] demo.ibs',
      '[Component] DEMO_QFP',
      '[Pin] signal_name model_name',
      '1 DQ0 FAST_IO',
      '[Model] FAST_IO',
      'Model_type I/O',
      'C_comp 2.5pF 2.0pF 3.0pF',
      '[Pulldown]',
      '0.0 0.0',
      '1.0 25m',
      '[Pullup]',
      '-3.3 -25m',
      '-2.3 0.0',
      '[End]',
    ].join('\n')
    render(<PCBDesignPanel onClose={vi.fn()} />)
    openTab('Advanced')

    const file = new File([ibs], 'demo.ibs', { type: 'text/plain' })
    fireEvent.change(screen.getByLabelText('Import IBIS file'), { target: { files: [file] } })

    expect(await screen.findByText('FAST_IO')).toBeInTheDocument()
    expect(screen.getByText(/C_comp 2\.50 pF/)).toBeInTheDocument()
    expect(screen.getByText(/PU 2 \/ PD 2/)).toBeInTheDocument()
  })

  it('disables the engine analyses while a run is in flight', () => {
    vi.spyOn(thermalAnalysisEngine, 'analyzeThermal').mockImplementation(
      () => new Promise<ThermalAnalysisResult>(() => {}),
    )
    // The part must declare a dissipation, or the run has nothing to solve and
    // returns without ever reaching the solver.
    render(<PCBDesignPanel onClose={vi.fn()} components={[part]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run Thermal' }))

    expect(screen.getByRole('button', { name: 'Run EMC' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Run Thermal' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Run Signal Integrity' })).toBeDisabled()
    // DRC is synchronous and stays available.
    expect(screen.getByRole('button', { name: 'Run DRC' })).toBeEnabled()
  })

  it('refuses to invent dissipation when no part declares a loss', async () => {
    const analyze = vi.spyOn(thermalAnalysisEngine, 'analyzeThermal')
    render(<PCBDesignPanel onClose={vi.fn()} components={[partAt('r1', 10, 10), partAt('r2', 60, 45)]} />)
    openTab('Thermal')

    fireEvent.click(screen.getByRole('button', { name: 'Run Thermal' }))

    expect(await screen.findByText(/None of the 2 part\(s\) declares a dissipation/)).toBeInTheDocument()
    expect(screen.getByText(/No result: thermal analysis needs a declared dissipation/)).toBeInTheDocument()
    expect(screen.queryByText('Max temperature')).not.toBeInTheDocument()
    expect(analyze).not.toHaveBeenCalled()
  })

  it('solves only the parts that declare a loss and says how many were left out', async () => {
    const analyze = vi.spyOn(thermalAnalysisEngine, 'analyzeThermal').mockResolvedValue({
      nodes: [],
      hotspots: [],
      thermalGradient: [],
      maxTemperature: 41.5,
      converged: true,
      simulatedTime: 300,
      timeToSteadyState: 210,
      recommendations: [],
    })
    const hot = { ...partAt('pc-r7', 20, 30), properties: { power: 1.25 } }
    render(<PCBDesignPanel onClose={vi.fn()} components={[hot, partAt('r2', 60, 45)]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run Thermal' }))

    expect(await screen.findByText('Max temperature')).toBeInTheDocument()
    const [nodes] = analyze.mock.calls[0]!
    expect(nodes).toHaveLength(1)
    expect(nodes[0]).toEqual(expect.objectContaining({ id: 'pc-r7', powerDissipation: 1.25 }))
    expect(screen.getByText(/1 of 1 part\(s\) with declared loss solved \(1\.250 W total\)/)).toBeInTheDocument()
    expect(screen.getByText(/1 part\(s\) carry no loss data/)).toBeInTheDocument()
  })

  it('draws parts at the routed layout positions, matching its copper', () => {
    const board = buildDemoBoard()
    const pcb = buildDemoPcb()
    useProjectStore.setState({
      components: board.components,
      wires: board.wires,
      pcbLayout: pcb.scene,
    })

    render(<PCBDesignPanel onClose={vi.fn()} />)

    for (const placed of pcb.scene.components) {
      const group = document.querySelector(`[data-component-id="${placed.id}"]`)
      expect(group).not.toBeNull()
      expect(group!.getAttribute('transform')).toBe(
        `translate(${placed.x} ${placed.y}) rotate(${placed.rotationDeg ?? 0})`,
      )
    }
  })

  it('highlights the part selected on the sheet when it opens on a stored board', () => {
    const board = buildDemoBoard()
    const pcb = buildDemoPcb()
    useProjectStore.setState({ components: board.components, wires: board.wires, pcbLayout: pcb.scene })
    const target = board.components[0]
    useAppStore.setState({ selectedComponents: [target.id] })

    render(<PCBDesignPanel onClose={vi.fn()} />)

    // Opening the board must not drop the sheet's selection.
    expect(useAppStore.getState().selectedComponents).toEqual([target.id])
    expect(document.querySelector(`[data-component-id="${target.id}"]`)).toHaveAttribute('data-selected', 'true')
  })

  it("lights the selected part's nets and recedes the rest of the copper", () => {
    const board = buildDemoBoard()
    const pcb = buildDemoPcb()
    useProjectStore.setState({ components: board.components, wires: board.wires, pcbLayout: pcb.scene })
    const target = board.components.find(component => component.reference === 'D1') ?? board.components[0]
    const ownNets = new Set(
      board.wires
        .filter(wire => wire.connectedPins.some(pin => pin.componentId === target.id))
        .map(wire => wire.netName),
    )
    useAppStore.setState({ selectedComponents: [target.id] })

    render(<PCBDesignPanel onClose={vi.fn()} />)

    const traces = [...document.querySelectorAll('[data-trace-net]')]
    const focused = traces.filter(trace => trace.getAttribute('data-focused') === 'true')
    expect(focused.length).toBeGreaterThan(0)
    for (const trace of focused) {
      expect(ownNets.has(trace.getAttribute('data-trace-net')!)).toBe(true)
    }
    // Copper on other nets stays visible but gives way to the part's own nets.
    expect(traces.some(trace => trace.getAttribute('data-receded') === 'true')).toBe(true)
  })

  it('keeps the board at full contrast when the selected part has no routed copper', () => {
    const board = buildDemoBoard()
    const pcb = buildDemoPcb()
    // Only the source net is routed; D1's own nets (MID, OUT) have no copper.
    const scene = { ...pcb.scene, traces: pcb.scene.traces.filter(trace => trace.net === 'SRC') }
    useProjectStore.setState({ components: board.components, wires: board.wires, pcbLayout: scene })
    const target = board.components.find(component => component.reference === 'D1')!
    useAppStore.setState({ selectedComponents: [target.id] })

    render(<PCBDesignPanel onClose={vi.fn()} />)

    const traces = [...document.querySelectorAll('[data-trace-net]')]
    expect(traces.length).toBeGreaterThan(0)
    // Dimming everything while nothing is lit would read as a rendering fault.
    expect(traces.some(trace => trace.getAttribute('data-receded') === 'true')).toBe(false)
  })

  it('follows a sheet selection made while the board is open', () => {
    const board = buildDemoBoard()
    useProjectStore.setState({ components: board.components, wires: board.wires, pcbLayout: null })
    render(<PCBDesignPanel onClose={vi.fn()} />)
    const target = board.components[0]
    const group = document.querySelector(`[data-component-id="${target.id}"]`)
    expect(group).not.toHaveAttribute('data-selected')

    act(() => { useAppStore.setState({ selectedComponents: [target.id] }) })

    expect(document.querySelector(`[data-component-id="${target.id}"]`)).toHaveAttribute('data-selected', 'true')
  })

  it('selects the sheet part when a board part is picked', () => {
    render(
      <PCBDesignPanel onClose={vi.fn()} components={[partAt('r1', 20, 20)]} wires={[]} />,
    )
    mockBoardRect()

    fireEvent.pointerDown(document.querySelector('[data-component-id="r1"]') as SVGGElement, { button: 0 })

    expect(useAppStore.getState().selectedComponents).toEqual(['r1'])
  })

  it('adopts copper routed by the agent harness without a reload', async () => {
    const board = buildDemoBoard()
    useProjectStore.setState({ components: board.components, wires: board.wires, pcbLayout: null })
    render(<PCBDesignPanel onClose={vi.fn()} />)
    expect(screen.getByText('Traces: 0 | Vias: 0')).toBeInTheDocument()

    const harness = new AgentHarness()
    registerEdaTools(harness)
    let routed: { traces: number; vias: number } | undefined
    await act(async () => {
      const call = await harness.call(
        'eda.route', {}, { maxCalls: 10, maxWallMs: 60_000, startedAt: Date.now() }, () => true,
      )
      expect(call.error).toBeUndefined()
      routed = call.result as { traces: number; vias: number }
    })

    await waitFor(() => {
      expect(screen.getByText(`Traces: ${routed!.traces} | Vias: ${routed!.vias}`)).toBeInTheDocument()
    })
    expect(screen.queryByText(/Parts moved after routing/)).toBeNull()
  })

  it('drops a via where the board is clicked', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    const svg = mockBoardRect()
    fireEvent.click(screen.getByRole('button', { name: 'Place via' }))

    fireEvent.pointerDown(svg, { button: 0, ...boardToClient(100, 80)(50, 40) })

    expect(screen.getByText('Traces: 0 | Vias: 1')).toBeInTheDocument()
  })

  it('draws a keep-out rectangle and picks it for deletion', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    const svg = mockBoardRect()
    const at = boardToClient(100, 80)
    fireEvent.click(screen.getByRole('button', { name: 'Keep-out' }))

    fireEvent.pointerDown(svg, { button: 0, ...at(20, 20) })
    expect(document.querySelector('[data-testid="pcb-keepout-draft"]')).not.toBeNull()
    fireEvent.pointerMove(svg.parentElement!, at(30, 30))
    fireEvent.pointerUp(svg.parentElement!)

    const zone = document.querySelector('[data-keepout-id]')
    expect(zone).not.toBeNull()
    expect(zone).toHaveAttribute('data-keepout-layers', 'all')
    // The rectangle is stored origin-anchored with the drawn size.
    expect(zone!.querySelector('rect')).toHaveAttribute('width', '10')
    expect(zone!.querySelector('rect')).toHaveAttribute('height', '10')
    // Drawing it picks it, so Delete removes it without hunting for it.
    expect(screen.getByText(/keep-out picked — press Delete to remove/)).toBeInTheDocument()
    expect(document.querySelector('svg[aria-label^="PCB layout"]')).toHaveAttribute(
      'aria-label',
      expect.stringContaining('1 keep-outs'),
    )
  })

  it('restricts a keep-out to the active layer when Alt is held', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    const svg = mockBoardRect()
    const at = boardToClient(100, 80)
    fireEvent.click(screen.getByRole('button', { name: 'Keep-out' }))

    fireEvent.pointerDown(svg, { button: 0, altKey: true, ...at(20, 20) })
    fireEvent.pointerMove(svg.parentElement!, at(30, 30))
    fireEvent.pointerUp(svg.parentElement!)

    expect(document.querySelector('[data-keepout-id]')).toHaveAttribute('data-keepout-layers', 'top-cu')
  })

  it('reports copper inside a keep-out to the DRC', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    const svg = mockBoardRect()
    const at = boardToClient(100, 80)

    fireEvent.click(screen.getByRole('button', { name: 'Route' }))
    fireEvent.pointerDown(svg, { button: 0, ...at(50, 40) })
    fireEvent.pointerDown(svg, { button: 0, ...at(60, 40) })
    fireEvent.click(screen.getByRole('button', { name: 'Finish trace' }))

    fireEvent.click(screen.getByRole('button', { name: 'Keep-out' }))
    fireEvent.pointerDown(svg, { button: 0, ...at(45, 35) })
    fireEvent.pointerMove(svg.parentElement!, at(65, 45))
    fireEvent.pointerUp(svg.parentElement!)

    fireEvent.click(screen.getByRole('button', { name: 'Run DRC' }))

    expect(screen.getByText(/contains copper of trace/)).toBeInTheDocument()
  })

  it('measures between two snapped points', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    const svg = mockBoardRect()
    const at = boardToClient(100, 80)
    fireEvent.click(screen.getByRole('button', { name: 'Measure' }))

    fireEvent.pointerDown(svg, { button: 0, ...at(10, 10) })
    fireEvent.pointerDown(svg, { button: 0, ...at(40, 30) })

    const ruler = document.querySelector('[data-testid="pcb-measure"]')
    expect(ruler).not.toBeNull()
    expect(ruler!.textContent).toContain('36.06 mm')
    expect(ruler!.textContent).toContain('Δx 30.00 · Δy 20.00 mm')
  })

  it('resizes the board from the outline corner handle', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    const svg = mockBoardRect()
    const at = boardToClient(100, 80)
    fireEvent.click(screen.getByRole('button', { name: 'Board outline' }))
    expect(document.querySelector('[data-outline-handle="corner"]')).not.toBeNull()

    fireEvent.pointerDown(svg, { button: 0, ...at(100, 80) })
    fireEvent.pointerMove(svg.parentElement!, at(110, 90))
    fireEvent.pointerUp(svg.parentElement!)

    expect(screen.getAllByText(/110 × 90 mm/)).not.toHaveLength(0)
  })

  it('lays a two-point trace with the route tool and finishes it', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    const svg = mockBoardRect()
    fireEvent.click(screen.getByRole('button', { name: 'Route' }))
    const at = boardToClient(100, 80)

    fireEvent.pointerDown(svg, { button: 0, ...at(50, 40) })
    fireEvent.pointerDown(svg, { button: 0, ...at(60, 40) })
    fireEvent.click(screen.getByRole('button', { name: 'Finish trace' }))

    expect(screen.getByText('Traces: 1 | Vias: 0')).toBeInTheDocument()
    const boardSvg = document.querySelector('svg[aria-label^="PCB layout"]')
    expect(boardSvg!.querySelector('polyline')?.getAttribute('points')).toBe('50,40 60,40')
  })

  it('moves a part on the move tool and flags copper as stale', () => {
    render(
      <PCBDesignPanel
        onClose={vi.fn()}
        components={[partAt('r1', 20, 20)]}
        wires={[]}
      />,
    )
    const svg = mockBoardRect()
    fireEvent.click(screen.getByRole('button', { name: 'Move part' }))
    const at = boardToClient(100, 80)
    const start = at(20, 20)
    const group = document.querySelector('[data-component-id="r1"]') as SVGGElement

    fireEvent.pointerDown(group, { button: 0, ...start })
    fireEvent.pointerMove(svg.parentElement!, {
      clientX: start.clientX + 2 * (at(21, 20).clientX - start.clientX),
      clientY: start.clientY,
    })
    fireEvent.pointerUp(svg.parentElement!)

    expect(group.getAttribute('transform')).toBe('translate(22 20) rotate(0)')
    expect(screen.getByRole('status')).toHaveTextContent(/Parts moved after routing/)
  })

  describe('board editing', () => {
    /** Two lands on one net, nothing routed — the smallest ratable board. */
    const twoLands = {
      components: [partAt('r1', 20, 20), partAt('r2', 60, 45)],
      wires: [pinNet('VIN', 'w1', [
        { componentId: 'r1', pinId: '1' },
        { componentId: 'r2', pinId: '1' },
      ])],
    }
    const partGroup = () => document.querySelector('[data-component-id="r1"]')

    it('flies a ratsnest line between lands no copper joins', () => {
      render(<PCBDesignPanel onClose={vi.fn()} {...twoLands} />)
      expect(document.querySelectorAll('[data-testid="pcb-ratsnest"] line')).toHaveLength(1)

      fireEvent.click(screen.getByRole('switch', { name: /Ratsnest/ }))
      expect(document.querySelector('[data-testid="pcb-ratsnest"]')).toBeNull()
    })

    it('silent ratsnest once the two lands are routed together', async () => {
      render(<PCBDesignPanel onClose={vi.fn()} {...twoLands} />)
      fireEvent.click(screen.getByRole('button', { name: 'Auto-Route from Schematic' }))
      await waitFor(() => expect(screen.getByText(/Traces: [1-9]/)).toBeInTheDocument())
      expect(document.querySelector('[data-testid="pcb-ratsnest"]')).toBeNull()
    })

    it('turns the selected part with R and back with Shift+R', async () => {
      render(<PCBDesignPanel onClose={vi.fn()} {...twoLands} />)
      mockBoardRect()
      fireEvent.pointerDown(partGroup()!, { button: 0 })

      fireEvent.keyDown(window, { key: 'r' })
      await waitFor(() => expect(partGroup()?.getAttribute('transform')).toContain('rotate(90)'))

      fireEvent.keyDown(window, { key: 'R', shiftKey: true })
      await waitFor(() => expect(partGroup()?.getAttribute('transform')).toContain('rotate(0)'))
    })

    it('flips the selected part to the bottom face with F', async () => {
      render(<PCBDesignPanel onClose={vi.fn()} {...twoLands} />)
      mockBoardRect()
      fireEvent.pointerDown(partGroup()!, { button: 0 })
      expect(partGroup()).toHaveAttribute('data-side', 'top')

      fireEvent.keyDown(window, { key: 'f' })
      await waitFor(() => expect(partGroup()).toHaveAttribute('data-side', 'bottom'))
    })

    it('picks up a via on click and deletes it, and undo puts it back', () => {
      render(<PCBDesignPanel onClose={vi.fn()} {...twoLands} />)
      const svg = mockBoardRect()
      const at = boardToClient(100, 80)

      fireEvent.click(screen.getByRole('button', { name: 'Place via' }))
      fireEvent.pointerDown(svg, { button: 0, ...at(50, 40) })
      expect(screen.getByText('Traces: 0 | Vias: 1')).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Select' }))
      fireEvent.pointerDown(svg, { button: 0, ...at(50, 40) })
      expect(document.querySelector('[data-via-id][data-picked="true"]')).not.toBeNull()

      fireEvent.keyDown(window, { key: 'delete' })
      expect(screen.getByText('Traces: 0 | Vias: 0')).toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
      expect(screen.getByText('Traces: 0 | Vias: 1')).toBeInTheDocument()
    })

    it('counts a whole drag as one undo step', async () => {
      render(<PCBDesignPanel onClose={vi.fn()} components={[partAt('r1', 20, 20)]} wires={[]} />)
      const svg = mockBoardRect()
      const at = boardToClient(100, 80)
      const start = at(20, 20)
      const step = at(21, 20).clientX - start.clientX

      fireEvent.pointerDown(partGroup()!, { button: 0, ...start })
      // Three moves along one drag: an undo per pixel would bury the history.
      for (const mm of [2, 3, 4]) {
        fireEvent.pointerMove(svg.parentElement!, { clientX: start.clientX + mm * step, clientY: start.clientY })
      }
      fireEvent.pointerUp(svg.parentElement!)
      await waitFor(() => expect(partGroup()?.getAttribute('transform')).toContain('translate(24 20)'))

      fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
      await waitFor(() => expect(partGroup()?.getAttribute('transform')).toContain('translate(20 20)'))

      // Nothing left to undo: the board stays where the undo put it.
      fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
      expect(partGroup()?.getAttribute('transform')).toContain('translate(20 20)')

      fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true })
      await waitFor(() => expect(partGroup()?.getAttribute('transform')).toContain('translate(24 20)'))
    })

    it('marquee-selects the parts a rubber band touches', () => {
      render(<PCBDesignPanel onClose={vi.fn()} {...twoLands} />)
      const svg = mockBoardRect()
      const at = boardToClient(100, 80)

      fireEvent.pointerDown(svg, { button: 0, ...at(10, 10) })
      fireEvent.pointerMove(svg.parentElement!, at(35, 35))
      expect(document.querySelector('[data-testid="pcb-marquee"]')).not.toBeNull()
      fireEvent.pointerUp(svg.parentElement!)

      // r1 sits at 20,20 inside the band; r2 at 60,45 is outside it.
      expect(useAppStore.getState().selectedComponents).toEqual(['r1'])
      expect(document.querySelector('[data-testid="pcb-marquee"]')).toBeNull()
    })

    it('adds to and clears the selection with Shift and a bare click', () => {
      render(<PCBDesignPanel onClose={vi.fn()} {...twoLands} />)
      const svg = mockBoardRect()
      const at = boardToClient(100, 80)
      const r1 = () => document.querySelector('[data-component-id="r1"]') as SVGGElement
      const r2 = () => document.querySelector('[data-component-id="r2"]') as SVGGElement

      fireEvent.pointerDown(r1(), { button: 0, ...at(20, 20) })
      fireEvent.pointerDown(r2(), { button: 0, shiftKey: true, ...at(60, 45) })
      expect(useAppStore.getState().selectedComponents).toEqual(['r1', 'r2'])

      // A press on empty board that never moves clears on release.
      fireEvent.pointerDown(svg, { button: 0, ...at(10, 70) })
      fireEvent.pointerUp(svg.parentElement!)
      expect(useAppStore.getState().selectedComponents).toEqual([])
    })

    it('moves every selected part as one undo step', async () => {
      render(<PCBDesignPanel onClose={vi.fn()} {...twoLands} />)
      const svg = mockBoardRect()
      const at = boardToClient(100, 80)
      const start = at(20, 20)
      const step = at(21, 20).clientX - start.clientX
      const part = (id: string) => document.querySelector(`[data-component-id="${id}"]`) as SVGGElement

      fireEvent.pointerDown(part('r1'), { button: 0, ...start })
      fireEvent.pointerDown(part('r2'), { button: 0, shiftKey: true, ...at(60, 45) })
      // Grabbing any member drags the whole selection.
      fireEvent.pointerDown(part('r1'), { button: 0, ...start })
      fireEvent.pointerMove(svg.parentElement!, { clientX: start.clientX + 5 * step, clientY: start.clientY })
      fireEvent.pointerUp(svg.parentElement!)

      await waitFor(() => expect(part('r1').getAttribute('transform')).toContain('translate(25 20)'))
      expect(part('r2').getAttribute('transform')).toContain('translate(65 45)')

      fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
      await waitFor(() => expect(part('r1').getAttribute('transform')).toContain('translate(20 20)'))
      expect(part('r2').getAttribute('transform')).toContain('translate(60 45)')
    })

    it('snaps manual copper to the grid the selector is set to', () => {
      render(<PCBDesignPanel onClose={vi.fn()} {...twoLands} />)
      const svg = mockBoardRect()
      const at = boardToClient(100, 80)

      fireEvent.click(screen.getByRole('button', { name: '0.1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Route' }))
      fireEvent.pointerDown(svg, { button: 0, ...at(50.44, 40.27) })
      fireEvent.pointerDown(svg, { button: 0, ...at(60.44, 40.27) })
      fireEvent.click(screen.getByRole('button', { name: 'Finish trace' }))

      const boardSvg = document.querySelector('svg[aria-label^="PCB layout"]')
      expect(boardSvg!.querySelector('polyline')?.getAttribute('points')).toBe('50.4,40.3 60.4,40.3')
    })
  })

  describe('placing library parts', () => {
    const resistor: Component = {
      id: 'lib-res',
      name: 'Resistor',
      category: 'Passive',
      is_standard: true,
      symbol_data: { width: 40, height: 20, paths: [] },
      pins: [
        { id: '1', name: 'A', x: -20, y: 0, type: 'passive' },
        { id: '2', name: 'B', x: 20, y: 0, type: 'passive' },
      ],
      default_properties: { resistance: '10k' },
    }
    const partOnBoard = () => document.querySelector('[data-component-id]') as SVGGElement | null

    /**
     * jsdom has no DragEvent and a plain Event ignores coordinates in its init,
     * so the payload a browser sends is defined explicitly.
     */
    const dropEvent = (point: { clientX: number; clientY: number }, componentId: string) => {
      const event = new Event('drop', { bubbles: true, cancelable: true })
      Object.defineProperty(event, 'clientX', { value: point.clientX })
      Object.defineProperty(event, 'clientY', { value: point.clientY })
      Object.defineProperty(event, 'dataTransfer', {
        value: { types: ['componentId'], getData: () => componentId },
      })
      return event
    }

    it('adds a dropped part to the design and lands it where it was dropped', () => {
      render(<PCBDesignPanel onClose={vi.fn()} library={[resistor]} />)
      const svg = mockBoardRect()
      const at = boardToClient(100, 80)(30.04, 20.07)

      fireEvent(svg, dropEvent(at, 'lib-res'))

      // The sheet owns the netlist, so the drop creates the part there too…
      const design = useProjectStore.getState().components
      expect(design).toHaveLength(1)
      expect(design[0].reference).toBe('R1')
      expect(design[0].properties).toEqual({ resistance: '10k' })
      // …and the board records the snapped drop point, not the sheet slot.
      expect(partOnBoard()?.getAttribute('transform')).toBe('translate(30 20) rotate(0)')
    })

    it('places an armed part on the next board click and reports it placed', () => {
      const onPendingPlaced = vi.fn()
      render(
        <PCBDesignPanel
          onClose={vi.fn()}
          library={[resistor]}
          pendingComponent={resistor}
          onPendingPlaced={onPendingPlaced}
        />,
      )
      const svg = mockBoardRect()
      const at = boardToClient(100, 80)(70, 55)
      expect(screen.getByText(/Resistor is armed/)).toBeInTheDocument()

      fireEvent.pointerDown(svg, { button: 0, ...at })

      expect(useProjectStore.getState().components).toHaveLength(1)
      expect(partOnBoard()?.getAttribute('transform')).toBe('translate(70 55) rotate(0)')
      expect(onPendingPlaced).toHaveBeenCalledTimes(1)
    })

    it('leaves the route tool alone while a part is armed', () => {
      render(
        <PCBDesignPanel onClose={vi.fn()} library={[resistor]} pendingComponent={resistor} />,
      )
      const svg = mockBoardRect()
      const at = boardToClient(100, 80)

      fireEvent.click(screen.getByRole('button', { name: 'Route' }))
      fireEvent.pointerDown(svg, { button: 0, ...at(50, 40) })
      fireEvent.pointerDown(svg, { button: 0, ...at(60, 40) })
      fireEvent.click(screen.getByRole('button', { name: 'Finish trace' }))

      // The click routed copper; the armed part was not dropped on the way.
      expect(screen.getByText('Traces: 1 | Vias: 0')).toBeInTheDocument()
      expect(useProjectStore.getState().components).toHaveLength(0)
    })

    it('disarms on Escape', () => {
      const onPendingPlaced = vi.fn()
      render(
        <PCBDesignPanel
          onClose={vi.fn()}
          library={[resistor]}
          pendingComponent={resistor}
          onPendingPlaced={onPendingPlaced}
        />,
      )

      fireEvent.keyDown(window, { key: 'Escape' })

      expect(onPendingPlaced).toHaveBeenCalledTimes(1)
    })
  })
})
