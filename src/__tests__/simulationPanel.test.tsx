/**
 * SimulationPanel render coverage.
 *
 * The panel is the only React surface over the SPICE solver and until now
 * nothing mounted it — analysis switching, the empty-sheet guard states and
 * the run lifecycle (results, errors, persisted runs) were all untested UI
 * code. The solver itself is stubbed where the point of the test is the UI's
 * reaction to it; netlist building stays real.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SimulationPanel from '../components/simulation/SimulationPanel'
import { spiceEngine } from '../lib/simulation/spiceEngine'
import type { SimulationResult } from '../lib/simulation/spiceEngine'
import { useProjectStore } from '../stores/useProjectStore'
import type { CanvasComponent } from '../stores/useProjectStore'
import type { Component } from '../lib/supabase'

const exportSpies = vi.hoisted(() => ({ downloadFile: vi.fn() }))
vi.mock('../lib/exportUtils', () => exportSpies)

const KICAD_DIVIDER = `(export (version D)
  (components
    (comp (ref V1) (value "5") (footprint ""))
    (comp (ref R1) (value "1k") (footprint ""))
    (comp (ref R2) (value "2k") (footprint "")))
  (nets
    (net 1 "IN" (node (ref V1) (pin 1)) (node (ref R1) (pin 1)))
    (net 2 "OUT" (node (ref R1) (pin 2)) (node (ref R2) (pin 1)))
    (net 0 "GND" (node (ref V1) (pin 2)) (node (ref R2) (pin 2)))))`

/** Minimal symbol: a plain two-pin passive, never listed in PIN_ORDER. */
const makeSymbol = (overrides: Partial<Component> = {}): Component => ({
  id: 'cmp-resistor',
  name: 'Resistor',
  category: 'passive',
  is_standard: true,
  symbol_data: { width: 60, height: 30, paths: [] },
  pins: [
    { id: '1', name: '1', x: 0, y: 15, type: 'passive' },
    { id: '2', name: '2', x: 60, y: 15, type: 'passive' },
  ],
  default_properties: {},
  ...overrides,
})

const place = (reference: string, component: Component): CanvasComponent => ({
  id: `placed-${reference}`,
  componentId: component.id ?? component.name,
  component,
  x: 120,
  y: 90,
  rotation: 0,
  reference,
  properties: { resistance: 1000 },
})

const seedSheet = (components: CanvasComponent[]) => {
  useProjectStore.setState({ components, wires: [], simulationRuns: [] })
}

describe('SimulationPanel', () => {
  beforeEach(() => {
    seedSheet([])
  })

  afterEach(() => {
    vi.restoreAllMocks()
    exportSpies.downloadFile.mockClear()
  })

  const importFile = (name: string, text: string) => {
    fireEvent.change(screen.getByLabelText('Import KiCad (.net) or EAGLE (.sch) netlist'), {
      target: { files: [new File([text], name, { type: 'text/plain' })] },
    })
  }

  it('renders the chrome and guard states for an empty sheet', () => {
    const onClose = vi.fn()
    render(<SimulationPanel onClose={onClose} />)

    expect(screen.getByText('Circuit Simulation')).toBeInTheDocument()
    // Default analysis: transient, ready to run on first open.
    expect(screen.getByText(/companion models\. Backward Euler is unconditionally stable/)).toBeInTheDocument()

    // Every solver-supported analysis is offered as a menu button.
    for (const label of [
      'DC operating point',
      'DC sweep',
      'Transient',
      'AC sweep',
      'Noise',
      'Monte Carlo',
    ]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }

    // Empty-sheet guards: warning banner, empty state, disabled run button.
    expect(
      screen.getByText(/Place at least one component on the schematic before simulating/),
    ).toBeInTheDocument()
    expect(screen.getByText('Configure parameters and run simulation')).toBeInTheDocument()
    expect(screen.getByText('Add components to your circuit first')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Close simulation panel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('swaps the parameter form when the analysis changes', () => {
    render(<SimulationPanel onClose={vi.fn()} />)

    expect(screen.getByText(/companion models\. Backward Euler is unconditionally stable/)).toBeInTheDocument()
    expect(screen.getByLabelText('Stop time (s)')).toBeInTheDocument()
    expect(screen.getByLabelText('Max step (s)')).toBeInTheDocument()
    const integration = screen.getByLabelText('Integration rule')
    expect(integration).toHaveValue('backward-euler')
    expect(screen.getByRole('option', { name: /Gear\/BDF2/ })).toBeInTheDocument()
    fireEvent.change(integration, { target: { value: 'bdf2' } })
    expect(integration).toHaveValue('bdf2')
    expect(screen.queryByLabelText('Start frequency (Hz)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AC sweep' }))
    expect(screen.getByText(/Sweeps the complex small-signal network/)).toBeInTheDocument()
    expect(screen.getByLabelText('Start frequency (Hz)')).toBeInTheDocument()
    expect(screen.getByLabelText('Stop frequency (Hz)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Stop time (s)')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Integration rule')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Noise' }))
    expect(screen.getByLabelText('Output net')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Monte Carlo' }))
    expect(screen.getByLabelText('Runs')).toBeInTheDocument()
    expect(screen.getByLabelText('Random seed')).toBeInTheDocument()
    expect(screen.queryByLabelText('Output net')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'DC sweep' }))
    expect(screen.getByLabelText('Sweep')).toBeInTheDocument()
    expect(screen.getByLabelText('Start')).toBeInTheDocument()
    expect(screen.getByLabelText('Stop')).toBeInTheDocument()
    expect(screen.getByLabelText('Step')).toBeInTheDocument()
    expect(screen.queryByLabelText('Stop time (s)')).not.toBeInTheDocument()
  })

  it('drives the analog sheet from the digital deck through a coupling', async () => {
    // The digital example's CLK node drives an analog net; the run must reach
    // the real co-simulation bridge and report the analog window it produced.
    render(<SimulationPanel onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Seconds per digital tick'), {
      target: { value: '0.00001' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Run mixed-signal' }))

    // The co-simulation run is real work; under full-suite parallel load it can
    // exceed Testing Library's 1 s default without indicating a hang.
    expect(await screen.findByText(/analog waveform/, {}, { timeout: 10_000 })).toBeInTheDocument()
    expect(screen.getByLabelText('Mixed-signal couplings')).toHaveValue('CLK=CLK_IN')
  })

  it('offers only sweepable symbols in the DC sweep picker', () => {
    const resistor = makeSymbol()
    const capacitor = makeSymbol({ id: 'cmp-capacitor', name: 'Capacitor' })
    seedSheet([place('R1', resistor), place('C1', capacitor)])
    render(<SimulationPanel onClose={vi.fn()} />)

    // With parts on the sheet the warning is replaced by readiness copy and
    // the solver can run.
    expect(
      screen.queryByText(/Place at least one component on the schematic/),
    ).not.toBeInTheDocument()
    expect(screen.getByText('2 components ready')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'DC sweep' }))
    const select = screen.getByLabelText('Sweep')
    const options = within(select)
      .getAllByRole('option')
      .map((option) => option.textContent ?? '')

    expect(options).toContain('R1')
    expect(options).not.toContain('C1')
    expect(within(select).getByRole('option', { name: /^Temperature/ })).toBeInTheDocument()

    fireEvent.change(select, { target: { value: 'R1' } })
    expect(select).toHaveValue('R1')
  })

  it('parses model cards, blocks malformed decks, and passes cards to the solver', async () => {
    seedSheet([place('R1', makeSymbol())])
    const canned: SimulationResult = {
      success: true,
      nodes: [],
      waveforms: [],
      operatingPoint: {},
      convergenceInfo: { iterations: 2, converged: true },
      analysis: 'dc',
    }
    const simulate = vi.spyOn(spiceEngine, 'simulate').mockResolvedValue(canned)
    render(<SimulationPanel onClose={vi.fn()} />)

    const modelDeck = screen.getByLabelText('SPICE model cards')
    fireEvent.change(modelDeck, { target: { value: '.model MYNPN NPN (IS=1E-14 BF=200)' } })
    expect(screen.getByText('Loaded: MYNPN (NPN)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'DC operating point' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))
    await waitFor(() => expect(simulate).toHaveBeenCalledTimes(1))
    expect(simulate.mock.calls[0][0].models?.MYNPN?.parameters.bf).toBe(200)

    fireEvent.change(modelDeck, { target: { value: '.model BAD NPN (BF=100 BF=200)' } })
    expect(screen.getByText(/duplicate model parameter BF/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run simulation' })).toBeDisabled()
  })

  it('reports solver failures in an alert without recording the run', async () => {
    seedSheet([place('R1', makeSymbol())])
    vi.spyOn(spiceEngine, 'simulate').mockRejectedValue(new Error('singular matrix at R1'))
    render(<SimulationPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('singular matrix at R1')
    expect(useProjectStore.getState().simulationRuns).toHaveLength(0)
  })

  it('renders solver results and records the run into the design', async () => {
    seedSheet([place('R1', makeSymbol())])
    render(<SimulationPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'DC operating point' }))
    const canned: SimulationResult = {
      success: true,
      nodes: [],
      waveforms: [
        {
          name: 'V(out)',
          type: 'voltage',
          unit: 'V',
          data: [
            { x: 0, y: 0 },
            { x: 1e-3, y: 3.3 },
          ],
        },
      ],
      operatingPoint: { out: 3.3 },
      convergenceInfo: { iterations: 4, converged: true },
      notes: ['Node NC_placed-R1_1 is floating'],
      analysis: 'dc',
    }
    vi.spyOn(spiceEngine, 'simulate').mockResolvedValue(canned)

    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))

    expect(await screen.findByRole('heading', { name: 'Operating Point' })).toBeInTheDocument()
    expect(screen.getByText('3.300000 V')).toBeInTheDocument()
    // The first waveform is auto-selected so the plot is never blank.
    expect(screen.getByRole('checkbox', { name: /V\(out\)/ })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Export results' })).toBeInTheDocument()
    // JSX line-breaking collapses "Success" and "(" without a space.
    expect(screen.getByText(/Convergence: Success\s*\(4 iterations\)/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Solver diagnostics' })).toBeInTheDocument()

    const runs = useProjectStore.getState().simulationRuns
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ type: 'dc', status: 'completed' })
    expect(runs[0].name).toContain('DC operating point')
  })

  it('exports the drawn circuit in KiCad and EAGLE formats', () => {
    const resistor = makeSymbol()
    seedSheet([place('R1', resistor), place('R2', resistor)])
    render(<SimulationPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Export KiCad netlist' }))
    expect(exportSpies.downloadFile).toHaveBeenCalledWith(
      expect.stringContaining('(export'),
      'folio_netlist.net',
      'text/plain',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Export EAGLE schematic' }))
    expect(exportSpies.downloadFile).toHaveBeenLastCalledWith(
      expect.stringContaining('<eagle'),
      'folio_schematic.sch',
      'text/plain',
    )
  })

  it('imports a KiCad netlist and solves the stitched sheets', async () => {
    render(<SimulationPanel onClose={vi.fn()} />)

    importFile('divider.net', KICAD_DIVIDER)
    expect(await screen.findByText(/divider — 3 parts · 3 nets \(KICAD\)/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stitch sheets and solve' }))

    expect(await screen.findByRole('status')).toHaveTextContent('1 sheet stitched into 3 devices')
    expect(screen.getByText('Waveforms')).toBeInTheDocument()
  })

  it('rejects duplicate references between imported and drawn sheets', async () => {
    seedSheet([place('R1', makeSymbol())])
    render(<SimulationPanel onClose={vi.fn()} />)

    importFile('divider.net', KICAD_DIVIDER)
    await screen.findByText(/divider — 3 parts/)
    fireEvent.click(screen.getByRole('button', { name: 'Stitch sheets and solve' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Duplicate reference R1 on sheets divider and Drawn sheet',
    )
  })

  it('reports a malformed netlist without importing it', async () => {
    render(<SimulationPanel onClose={vi.fn()} />)

    importFile('bad.net', '(netlist)')

    expect(await screen.findByRole('alert')).toHaveTextContent(/root must be an \(export/i)
    expect(screen.queryByText(/bad —/)).not.toBeInTheDocument()
  })
})
