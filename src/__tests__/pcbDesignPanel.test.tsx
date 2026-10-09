/**
 * PCBDesignPanel render coverage.
 *
 * The panel is the React surface over the EMC, thermal and signal-integrity
 * engines plus the DRC/auto-route logic; nothing mounted it before. The
 * engines are stubbed where the point of the test is the UI's reaction to
 * them — wire→trace routing, DRC verdicts and export plumbing stay real.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PCBDesignPanel from '../components/pcb/PCBDesignPanel'
import { emcSimulationEngine } from '../lib/emc/emcSimulation'
import type { EMCResult } from '../lib/emc/emcSimulation'
import { thermalAnalysisEngine } from '../lib/pcb/thermalAnalysis'
import type { ThermalAnalysisResult } from '../lib/pcb/thermalAnalysis'
import { signalIntegrityAnalyzer } from '../lib/pcb/signalIntegrity'
import type { PlacedComponent, Wire } from '../types'

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

describe('PCBDesignPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    exportSpies.exportToGerber.mockClear()
    exportSpies.downloadFile.mockClear()
  })

  it('renders the chrome, layer stack, tools and design rules', () => {
    const onClose = vi.fn()
    render(<PCBDesignPanel onClose={onClose} />)

    expect(screen.getByRole('heading', { name: 'PCB Design' })).toBeInTheDocument()
    for (const tab of ['Canvas', 'DRC', 'EMC', 'Thermal', 'Signal']) {
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
    expect(screen.getByText(/100 × 80 mm/)).toBeInTheDocument()
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

  it('auto-routes schematic wires into traces and clears DRC', () => {
    render(<PCBDesignPanel onClose={vi.fn()} wires={[net('GND', 'w1'), net('VCC', 'w2')]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Auto-Route from Schematic' }))
    expect(screen.getByText('Traces: 2 | Vias: 0')).toBeInTheDocument()
    // Scope by coordinates — lucide toolbar icons also contain polylines.
    expect(document.querySelectorAll('polyline[points="10,10 60,45"]')).toHaveLength(2)

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

  it('runs EMC through the engine and renders the compliance verdict', () => {
    const canned: EMCResult = {
      radiatedDBuVPerM: 34.2,
      radiatedDBuV: 34.2,
      conductedDBuV: 31.8,
      limitDBuV: 40,
      marginDb: 5.8,
      compliant: true,
      hotspots: [],
      recommendations: ['Keep the return plane continuous under the clock trace.'],
    }
    const simulate = vi.spyOn(emcSimulationEngine, 'simulate').mockReturnValue(canned)
    render(<PCBDesignPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run EMC' }))

    // No traces yet → the engine still receives one default worst-case trace.
    expect(simulate).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'default' })],
      'CISPR32',
    )
    expect(screen.getByRole('tab', { name: 'EMC' })).toHaveAttribute('data-state', 'active')
    expect(screen.getByText('Radiated Emission')).toBeInTheDocument()
    expect(screen.getByText('34.2 dBµV')).toBeInTheDocument()
    expect(screen.getByText('Conducted Emission')).toBeInTheDocument()
    expect(screen.getByText('31.8 dBµV')).toBeInTheDocument()
    expect(screen.getByText('Limit')).toBeInTheDocument()
    expect(screen.getByText('Margin')).toBeInTheDocument()
    expect(screen.getByText('5.8 dB')).toBeInTheDocument()
    expect(screen.getByText('✓ CISPR 32 compliant')).toBeInTheDocument()
    expect(screen.getByText(/Keep the return plane continuous/)).toBeInTheDocument()
  })

  it('awaits the thermal solver and renders the hotspot report', async () => {
    const canned: ThermalAnalysisResult = {
      nodes: [],
      hotspots: [{ nodeId: 'pc-u1', temperature: 85, severity: 'critical' }],
      thermalGradient: [],
      steadyStateTemperature: 62.4,
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

  it('renders signal-integrity metrics for the first trace', async () => {
    const analyze = vi.spyOn(signalIntegrityAnalyzer, 'analyzeTrace').mockResolvedValue({
      impedance: 50,
      propagationDelay: 0.68,
      riseTime: 0.35,
      reflectionCoefficient: 0.05,
    })
    render(<PCBDesignPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run Signal Integrity' }))

    expect(await screen.findByText('Impedance')).toBeInTheDocument()
    expect(screen.getByText('50.0 Ω')).toBeInTheDocument()
    expect(screen.getByText('0.68 ns')).toBeInTheDocument()
    expect(screen.getByText('0.35 ns')).toBeInTheDocument()
    expect(screen.getByText('5.0%')).toBeInTheDocument()
    // No traces → a default reference line (50 mm, 0.2 mm wide, FR4).
    expect(analyze).toHaveBeenCalledWith(
      expect.objectContaining({ length: 50, width: 0.2, dielectricConstant: 4.5 }),
    )
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



})
