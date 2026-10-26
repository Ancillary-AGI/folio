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
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SimulationPanel from '../components/simulation/SimulationPanel'
import { formatEngineering } from '../lib/simulation/formatEngineering'
import { spiceEngine } from '../lib/simulation/spiceEngine'
import type { SimulationResult } from '../lib/simulation/spiceEngine'
import { useProjectStore } from '../stores/useProjectStore'
import { useAppStore } from '../stores/useAppStore'
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
    useAppStore.setState({ demoRequest: null })
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

  it('defaults the DC sweep to temperature and actually runs it', async () => {
    const source = makeSymbol({ id: 'cmp-vsource', name: 'Voltage Source' })
    const placed = place('V1', source)
    placed.properties = { voltage: '5' }
    useProjectStore.setState({
      components: [placed],
      wires: [
        {
          id: 'w-gnd',
          points: [],
          netName: 'GND',
          connectedPins: [{ componentId: 'placed-V1', pinId: '2' }],
        },
        {
          id: 'w-out',
          points: [],
          netName: 'OUT',
          connectedPins: [{ componentId: 'placed-V1', pinId: '1' }],
        },
      ],
      simulationRuns: [],
    })

    render(<SimulationPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'DC sweep' }))
    // The picker displays Temperature by default; the run must carry the same
    // target instead of sending an empty sweepSource the solver rejects.
    expect(screen.getByLabelText('Sweep')).toHaveValue('TEMP')
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))

    expect(
      await screen.findByText(/Convergence: Success\s*\(/, {}, { timeout: 10_000 }),
    ).toBeInTheDocument()
    expect(screen.queryByText(/choose the component to sweep/)).not.toBeInTheDocument()
  })

  it('tabulates a Monte Carlo envelope instead of drawing a one-point waveform', async () => {
    seedSheet([place('R1', makeSymbol())])
    const canned: SimulationResult = {
      success: true,
      nodes: [],
      waveforms: [
        { name: 'V(OUT) mean', type: 'voltage', unit: 'V', data: [{ x: 0, y: 5 }] },
        { name: 'V(OUT) mean +3σ', type: 'voltage', unit: 'V', data: [{ x: 0, y: 5.1 }] },
        { name: 'V(OUT) mean −3σ', type: 'voltage', unit: 'V', data: [{ x: 0, y: 4.9 }] },
      ],
      convergenceInfo: { iterations: 100, converged: true },
      analysis: 'montecarlo',
    }
    vi.spyOn(spiceEngine, 'simulate').mockResolvedValue(canned)
    render(<SimulationPanel onClose={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Monte Carlo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))

    expect(await screen.findByRole('heading', { name: 'Tolerance envelope' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Signal' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'V(OUT)' })).toBeInTheDocument()
    expect(screen.getByText('5.00 V')).toBeInTheDocument()
    expect(screen.getByText('±100m V')).toBeInTheDocument()
    expect(screen.getByText('±2.00 %')).toBeInTheDocument()
    // One point per signal is a distribution, not a trace.
    expect(screen.queryByRole('checkbox', { name: /V\(OUT\) mean/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Waveform Plot' })).not.toBeInTheDocument()
  })

  it('formats chart ticks with SI prefixes instead of collapsing small values to 0.00', () => {
    expect(formatEngineering(0)).toBe('0')
    expect(formatEngineering(2e-11)).toBe('20.0p')
    expect(formatEngineering(4.07e-9)).toBe('4.07n')
    expect(formatEngineering(0.00021)).toBe('210µ')
    expect(formatEngineering(1234)).toBe('1.23k')
    expect(formatEngineering(1e6)).toBe('1.00M')
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
    expect(screen.getByText('3.30 V')).toBeInTheDocument()
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

  it('flags a displayed result when the sheet changes underneath it', async () => {
    seedSheet([place('R1', makeSymbol())])
    const canned: SimulationResult = {
      success: true,
      nodes: [],
      waveforms: [
        { name: 'V(out)', type: 'voltage', unit: 'V', data: [{ x: 0, y: 3.3 }] },
      ],
      operatingPoint: { out: 3.3 },
      convergenceInfo: { iterations: 4, converged: true },
      analysis: 'dc',
    }
    vi.spyOn(spiceEngine, 'simulate').mockResolvedValue(canned)
    render(<SimulationPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'DC operating point' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))
    expect(await screen.findByRole('heading', { name: 'Operating Point' })).toBeInTheDocument()
    expect(screen.queryByText(/sheet changed after this analysis ran/i)).not.toBeInTheDocument()

    // Moving a symbol is cosmetic: the solved circuit is unchanged.
    act(() => {
      useProjectStore.setState((state) => ({
        components: state.components.map((component) => ({ ...component, x: component.x + 20 })),
      }))
    })
    expect(screen.queryByText(/sheet changed after this analysis ran/i)).not.toBeInTheDocument()

    // Changing a value changes the circuit, so the old solve no longer describes it.
    act(() => {
      useProjectStore.setState((state) => ({
        components: state.components.map((component) => ({
          ...component,
          properties: { ...component.properties, resistance: 2200 },
        })),
      }))
    })
    expect(await screen.findByText(/sheet changed after this analysis ran/i)).toBeInTheDocument()
    // The old result stays for comparison instead of silently disappearing.
    expect(screen.getByRole('heading', { name: 'Operating Point' })).toBeInTheDocument()
  })

  it('clears a displayed result when the analysis tab changes', async () => {
    seedSheet([place('R1', makeSymbol())])
    const canned: SimulationResult = {
      success: true,
      nodes: [],
      waveforms: [
        { name: 'V(out)', type: 'voltage', unit: 'V', data: [{ x: 0, y: 3.3 }] },
      ],
      operatingPoint: { out: 3.3 },
      convergenceInfo: { iterations: 4, converged: true },
      analysis: 'dc',
    }
    vi.spyOn(spiceEngine, 'simulate').mockResolvedValue(canned)
    render(<SimulationPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'DC operating point' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))
    expect(await screen.findByRole('heading', { name: 'Operating Point' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Transient' }))

    // A DC operating point rendered under the Transient tab would show a
    // one-point "transient" with playback controls that mean nothing.
    expect(screen.queryByRole('heading', { name: 'Operating Point' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Export results' })).not.toBeInTheDocument()
  })

  it('does not surface a stitched solve under an analysis tab chosen mid-solve', async () => {
    let resolveRun: (result: SimulationResult) => void = () => {}
    const pending = new Promise<SimulationResult>((resolve) => {
      resolveRun = resolve
    })
    render(<SimulationPanel onClose={vi.fn()} />)
    importFile('divider.net', KICAD_DIVIDER)
    await screen.findByText(/divider — 3 parts/)
    vi.spyOn(spiceEngine, 'simulate').mockReturnValue(pending)

    fireEvent.click(screen.getByRole('button', { name: 'Stitch sheets and solve' }))
    // Analysis tabs stay enabled while stitching, so this switch is reachable.
    // The panel defaults to Transient, so pick AC to actually change the tab.
    fireEvent.click(screen.getByRole('button', { name: 'AC sweep' }))

    await act(async () => {
      resolveRun({
        success: true,
        nodes: [],
        waveforms: [
          { name: 'V(OUT)', type: 'voltage', unit: 'V', data: [{ x: 0, y: 2.5 }] },
        ],
        convergenceInfo: { iterations: 4, converged: true },
        analysis: 'dc',
      })
      await pending
    })

    expect(screen.queryByText('Waveforms')).not.toBeInTheDocument()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows measured rating margins, thermal estimate, and the power budget', async () => {
    const resistor = makeSymbol()
    useProjectStore.setState({
      components: [{
        ...place('R1', resistor),
        properties: { resistance: 1000, power: '0.25', footprint: '0603' },
      }],
      wires: [
        {
          id: 'w-in',
          points: [],
          netName: 'IN',
          connectedPins: [{ componentId: 'placed-R1', pinId: '1' }],
        },
        {
          id: 'w-gnd',
          points: [],
          netName: 'GND',
          connectedPins: [{ componentId: 'placed-R1', pinId: '2' }],
        },
      ],
      simulationRuns: [],
    })
    const canned: SimulationResult = {
      success: true,
      nodes: [],
      waveforms: [],
      operatingPoint: { IN: 20, '0': 0 },
      convergenceInfo: { iterations: 3, converged: true },
      analysis: 'dc',
    }
    vi.spyOn(spiceEngine, 'simulate').mockResolvedValue(canned)

    render(<SimulationPanel onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'DC operating point' }))
    fireEvent.click(screen.getByRole('button', { name: 'Run simulation' }))

    expect(
      await screen.findByRole('heading', { name: 'Ratings, heating & power' }),
    ).toBeInTheDocument()
    // 20 V across 1 kΩ is 400 mW — 160 % of the declared 0.25 W limit.
    expect(screen.getByText('1 over limit')).toBeInTheDocument()
    expect(screen.getByText(/R1 power at 160\.0 % of its 0\.250 W limit/)).toBeInTheDocument()
    expect(screen.getByText(/dissipated 400 mW/)).toBeInTheDocument()
    // 0603 typical θJA is 300 K/W: 27 °C + 0.4 W × 300 K/W.
    expect(screen.getByText(/R1: 147\.0 °C \(\+120\.0 K\)/)).toBeInTheDocument()
    expect(screen.getByText(/supplied not solved/)).toBeInTheDocument()
    expect(screen.getByText('How these numbers were obtained')).toBeInTheDocument()
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

  it('auto-runs the transient demo when the gallery requests it', async () => {
    const source = makeSymbol({ id: 'cmp-vsource', name: 'Voltage Source' })
    const placed = place('V1', source)
    placed.properties = { voltage: '5' }
    useProjectStore.setState({
      components: [placed],
      wires: [
        { id: 'w-gnd', points: [], netName: 'GND', connectedPins: [{ componentId: 'placed-V1', pinId: '2' }] },
        { id: 'w-out', points: [], netName: 'OUT', connectedPins: [{ componentId: 'placed-V1', pinId: '1' }] },
      ],
      simulationRuns: [],
    })
    const simulate = vi.spyOn(spiceEngine, 'simulate').mockResolvedValue({
      success: true,
      nodes: [{ name: 'OUT' }],
      waveforms: [{ name: 'V(OUT)', type: 'voltage', unit: 'V', data: [{ x: 0, y: 0 }, { x: 0.001, y: 5 }] }],
      convergenceInfo: { iterations: 12, converged: true },
      analysis: 'transient',
    })
    useAppStore.setState({ demoRequest: 'rectifier-transient' })

    render(<SimulationPanel onClose={vi.fn()} />)

    await waitFor(() => expect(simulate).toHaveBeenCalledTimes(1))
    expect(simulate.mock.calls[0][0].analyses[0]?.type).toBe('transient')
    await waitFor(() => expect(useAppStore.getState().demoRequest).toBeNull())
  })

  it('clears the shared playback frame when it closes', () => {
    seedSheet([place('R1', makeSymbol())])
    useProjectStore.setState({
      liveFrame: { time: 0.2, voltages: { OUT: 1 }, glow: { OUT: 0.4 }, lit: { R1: true } },
    })
    const view = render(<SimulationPanel onClose={vi.fn()} />)
    view.unmount()
    expect(useProjectStore.getState().liveFrame).toBeNull()
  })
})
