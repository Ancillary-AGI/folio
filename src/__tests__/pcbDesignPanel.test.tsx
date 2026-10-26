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
    for (const tool of ['select', 'route', 'via', 'move']) {
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

    // 'select' starts active (default variant); picking a tool moves it.
    expect(screen.getByRole('button', { name: 'select' })).toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'route' })).toHaveClass('bg-background')
    fireEvent.click(screen.getByRole('button', { name: 'route' }))
    expect(screen.getByRole('button', { name: 'route' })).toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'select' })).not.toHaveClass('bg-primary')

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
    expect(screen.getByText('All design rules pass.')).toBeInTheDocument()
    expect(screen.getByText('DRC passed ✓')).toBeInTheDocument()
  })

  it('flags nets that have no copper as DRC warnings', () => {
    render(<PCBDesignPanel onClose={vi.fn()} wires={[net('GND', 'w1')]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run DRC' }))

    expect(screen.getByText('Design Rule Check — 1 issue')).toBeInTheDocument()
    expect(screen.getByText(/has no copper trace/)).toBeInTheDocument()
    expect(screen.getByText('1 warning')).toBeInTheDocument()
    expect(screen.queryByText(/DRC passed/)).not.toBeInTheDocument()
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
      shippable: true,
    })
    try {
      render(<PCBDesignPanel onClose={vi.fn()} components={[part]} wires={[net('GND', 'w1')]} />)
      fireEvent.click(screen.getByRole('button', { name: /Fab package/ }))
      expect(spy).toHaveBeenCalled()
      expect(screen.getByText(/shippable/)).toBeInTheDocument()
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
    render(<PCBDesignPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run Thermal' }))

    expect(screen.getByRole('button', { name: 'Run EMC' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Run Thermal' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Run Signal Integrity' })).toBeDisabled()
    // DRC is synchronous and stays available.
    expect(screen.getByRole('button', { name: 'Run DRC' })).toBeEnabled()
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
    fireEvent.click(screen.getByRole('button', { name: 'via' }))

    fireEvent.pointerDown(svg, { button: 0, ...boardToClient(100, 80)(50, 40) })

    expect(screen.getByText('Traces: 0 | Vias: 1')).toBeInTheDocument()
  })

  it('lays a two-point trace with the route tool and finishes it', () => {
    render(<PCBDesignPanel onClose={vi.fn()} />)
    const svg = mockBoardRect()
    fireEvent.click(screen.getByRole('button', { name: 'route' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'move' }))
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
})
