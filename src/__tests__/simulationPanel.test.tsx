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
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SimulationPanel from '../components/simulation/SimulationPanel'
import { spiceEngine } from '../lib/simulation/spiceEngine'
import type { SimulationResult } from '../lib/simulation/spiceEngine'
import { useProjectStore } from '../stores/useProjectStore'
import type { CanvasComponent } from '../stores/useProjectStore'
import type { Component } from '../lib/supabase'

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
  })

  it('renders the chrome and guard states for an empty sheet', () => {
    const onClose = vi.fn()
    render(<SimulationPanel onClose={onClose} />)

    expect(screen.getByText('Circuit Simulation')).toBeInTheDocument()
    // Default analysis: DC operating point, with its honest summary.
    expect(screen.getByText(/Solves the bias point by modified nodal analysis/)).toBeInTheDocument()

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

    fireEvent.click(screen.getByRole('button', { name: 'Transient' }))
    expect(screen.getByText(/Integrates capacitors and inductors with backward-Euler/)).toBeInTheDocument()
    expect(screen.getByLabelText('Stop time (s)')).toBeInTheDocument()
    expect(screen.getByLabelText('Max step (s)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Start frequency (Hz)')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AC sweep' }))
    expect(screen.getByText(/Sweeps the complex small-signal network/)).toBeInTheDocument()
    expect(screen.getByLabelText('Start frequency (Hz)')).toBeInTheDocument()
    expect(screen.getByLabelText('Stop frequency (Hz)')).toBeInTheDocument()
    expect(screen.queryByLabelText('Stop time (s)')).not.toBeInTheDocument()

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
    render(<SimulationPanel onClose={vi.fn()} />)

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
})
