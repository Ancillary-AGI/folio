/**
 * AgentPanel ERC surface.
 * The symbolic verifier is deterministic and canvas-agnostic; this suite
 * proves the panel runs it over the netlist the simulator would build.
 */
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AgentPanel from '../components/ecad/AgentPanel'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import type { CanvasComponent, CanvasWire } from '../stores/useProjectStore'
import { buildDemoBoard } from '../lib/demo/demoBoard'
import { createDefaultMechanicalParts } from '../lib/mechanical/partModel'
import {
  agentSessionStore,
  createAgentSession,
  finishAgentSession,
} from '../lib/agents/agentSession'

const pin = (id: string, type: 'input' | 'output' | 'passive') => ({
  id,
  name: id,
  x: 0,
  y: 0,
  type,
})

const part = (
  id: string,
  reference: string,
  pins: ReturnType<typeof pin>[],
): CanvasComponent => ({
  id,
  componentId: `${id}-symbol`,
  component: {
    name: 'Buffer',
    category: 'digital',
    is_standard: true,
    symbol_data: { width: 40, height: 20, paths: [] },
    pins,
    default_properties: {},
  },
  x: 0,
  y: 0,
  rotation: 0,
  reference,
  properties: {},
})

const net = (id: string, netName: string, pins: CanvasWire['connectedPins']): CanvasWire => ({
  id,
  points: [],
  netName,
  connectedPins: pins,
})

const seed = (components: CanvasComponent[], wires: CanvasWire[]) => {
  useProjectStore.setState({ components, wires })
}

describe('AgentPanel ERC', () => {
  beforeEach(() => {
    seed([], [])
    useProjectStore.setState({
      pcbLayout: null,
      mechanicalParts: createDefaultMechanicalParts(),
    })
    agentSessionStore.clear()
    useAppStore.setState({ demoRequest: null })
  })

  it('requires a drawn circuit before verifying', () => {
    render(<AgentPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Verify circuit topology' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Draw at least one component before running ERC.',
    )
  })

  it('reports bus contention found on the drawn net', () => {
    seed(
      [part('u1', 'U1', [pin('1', 'output')]), part('u2', 'U2', [pin('1', 'output')])],
      [net('w1', 'DATA', [
        { componentId: 'u1', pinId: '1' },
        { componentId: 'u2', pinId: '1' },
      ])],
    )
    render(<AgentPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Verify circuit topology' }))

    expect(screen.getByText(/ERC found 1 error/)).toBeInTheDocument()
    expect(screen.getByText(/Bus contention: Node "DATA"/)).toBeInTheDocument()
  })

  it('passes an input pulled up through a passive', () => {
    seed(
      [
        part('u1', 'U1', [pin('1', 'input')]),
        part('r1', 'R1', [pin('1', 'passive'), pin('2', 'passive')]),
      ],
      [net('w1', 'CS_N', [
        { componentId: 'u1', pinId: '1' },
        { componentId: 'r1', pinId: '1' },
      ])],
    )
    render(<AgentPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Verify circuit topology' }))

    expect(screen.getByText(/ERC passed/)).toBeInTheDocument()
    expect(screen.queryByText(/Floating input/)).not.toBeInTheDocument()
  })
})

describe('AgentPanel surfaces', () => {
  beforeEach(() => {
    seed([], [])
    agentSessionStore.clear()
    useAppStore.setState({ demoRequest: null })
  })

  it('runs the symbolic verifier when the gallery requests it', async () => {
    const board = buildDemoBoard()
    seed(board.components, board.wires)
    useAppStore.setState({ demoRequest: 'agents-verifier' })

    render(<AgentPanel />)

    expect(await screen.findByText(/ERC (passed|found)/)).toBeInTheDocument()
    // The demo claims to prove the tool harness, so it must land on Tools.
    expect(screen.getByRole('tab', { name: 'Tools' })).toHaveAttribute('aria-selected', 'true')
    await waitFor(() => expect(useAppStore.getState().demoRequest).toBeNull())
  })

  it('runs the full autopilot loop when the gallery requests it, even under StrictMode', async () => {
    const board = buildDemoBoard()
    seed(board.components, board.wires)
    useAppStore.setState({ demoRequest: 'agents-autopilot' })

    render(
      <StrictMode>
        <AgentPanel />
      </StrictMode>,
    )

    await screen.findByText(/saved locally/, {}, { timeout: 60_000 })
    expect(screen.getAllByRole('button', { name: /Show iteration/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByAltText(/Waveforms from iteration/).length).toBeGreaterThan(0)
    expect(useAppStore.getState().demoRequest).toBeNull()
    expect(useProjectStore.getState().components).toHaveLength(board.components.length)
  }, 75_000)

  it('renders the registered CAD and EDA tools instead of a stale doc', () => {
    render(<AgentPanel />)
    fireEvent.click(screen.getByRole('tab', { name: 'Tools' }))
    const panel = screen.getByRole('tabpanel', { name: 'Tools' })
    expect(within(panel).getByText('cad.observe')).toBeInTheDocument()
    expect(within(panel).getByText('cad.simulate')).toBeInTheDocument()
    expect(within(panel).getByText('eda.route')).toBeInTheDocument()
    expect(within(panel).getByText('approval')).toBeInTheDocument()
  })

  it('asks for a knob before searching and can suggest one from the sheet', () => {
    const resistor = part('r1', 'R1', [pin('1', 'passive'), pin('2', 'passive')])
    resistor.properties = { value: '1k', footprint: '0603' }
    seed([resistor], [])

    render(<AgentPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Run autopilot' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/Add at least one knob/)

    fireEvent.click(screen.getByRole('button', { name: 'Suggest from sheet' }))
    expect(screen.getByLabelText('Knob 1 part')).toHaveValue('R1')
    expect(screen.getByLabelText('Knob 1 from')).toHaveValue('100')
    expect(screen.getByLabelText('Knob 1 to')).toHaveValue('10000')
  })

  it('suggests the filter capacitor for a ripple objective', () => {
    const board = buildDemoBoard()
    seed(board.components, board.wires)

    render(<AgentPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Suggest from sheet' }))

    expect(screen.getByLabelText('Knob 1 part')).toHaveValue('C1')
    expect(Number((screen.getByLabelText('Knob 1 from') as HTMLInputElement).value)).toBeCloseTo(1e-6, 12)
    expect(Number((screen.getByLabelText('Knob 1 to') as HTMLInputElement).value)).toBeCloseTo(1e-4, 12)
  })

  it('states the runner mode honestly and preserves saved sessions for audit', () => {
    const session = finishAgentSession(
      createAgentSession({ title: 'Ripple tuning session' }),
      { status: 'completed', summary: 'Target met at C1 = 47 µF.' },
    )
    expect(agentSessionStore.save(session).ok).toBe(true)

    render(<AgentPanel />)
    expect(screen.getByText('Local runner')).toBeInTheDocument()
    expect(screen.getByText(/docs\/AGENT_CLOUD\.md/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Audit' }))
    const panel = screen.getByRole('tabpanel', { name: 'Audit' })
    expect(within(panel).getByText('Ripple tuning session')).toBeInTheDocument()
    fireEvent.click(within(panel).getByRole('button', { name: 'Show session Ripple tuning session' }))
    expect(within(panel).getByText('#1')).toBeInTheDocument()
    expect(within(panel).getAllByText(/Target met at C1/).length).toBeGreaterThan(0)
  })

  it('runs the autopilot loop, shows live evidence, and saves the session', async () => {
    const board = buildDemoBoard()
    seed(board.components, board.wires)
    const initialCount = board.components.length

    render(<AgentPanel />)
    fireEvent.change(screen.getByLabelText('Knob 1 part'), { target: { value: 'C1' } })
    fireEvent.change(screen.getByLabelText('Knob 1 from'), { target: { value: '10e-6' } })
    fireEvent.change(screen.getByLabelText('Knob 1 to'), { target: { value: '100e-6' } })
    fireEvent.change(screen.getByLabelText('Samples per knob'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Max candidates'), { target: { value: '9' } })
    fireEvent.change(screen.getByLabelText('Stop (ms)'), { target: { value: '4' } })
    fireEvent.change(screen.getByLabelText('Step (µs)'), { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run autopilot' }))

    await screen.findByText(/saved locally/, {}, { timeout: 30_000 })
    expect(screen.getAllByRole('button', { name: /Show iteration/ }).length).toBeGreaterThan(0)
    expect(screen.getAllByAltText(/Schematic after iteration/).length).toBeGreaterThan(0)
    expect(agentSessionStore.list()).toHaveLength(1)
    expect(useProjectStore.getState().components).toHaveLength(initialCount)
  }, 45_000)

  it('sizes the live beam through the mechanical tab and shows per-iteration drawings', async () => {
    render(<AgentPanel />)
    fireEvent.click(screen.getByRole('tab', { name: 'Mechanical sizing' }))
    fireEvent.change(screen.getByLabelText('Dimension samples'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Candidate budget'), { target: { value: '14' } })
    fireEvent.click(screen.getByRole('button', { name: 'Run sizing search' }))

    await screen.findByText(/saved locally/, {}, { timeout: 30_000 })
    const panel = screen.getByRole('tabpanel', { name: 'Mechanical sizing' })
    expect(within(panel).getAllByAltText(/Assembly after iteration/).length).toBeGreaterThan(0)
    expect(within(panel).getAllByRole('button', { name: /Show sizing iteration/ }).length).toBeGreaterThan(0)
    expect(within(panel).getAllByText(/not a proof of a global optimum/).length).toBeGreaterThan(0)
    const beam = useProjectStore.getState().mechanicalParts.find((part) => part.id === 'beam-1')
    expect(beam?.properties.mass).toBeLessThan(54)
    expect(agentSessionStore.list()).toHaveLength(1)
  }, 45_000)

  it('inspects the live schematic through the cad tools and shows the drawing', async () => {
    const board = buildDemoBoard()
    seed(board.components, board.wires)

    render(<AgentPanel />)
    fireEvent.click(screen.getByRole('tab', { name: 'Assistant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect schematic' }))

    expect(await screen.findByAltText('Schematic after agent step')).toBeInTheDocument()
    expect(screen.getByText(/Completed 1 of 1 step/)).toBeInTheDocument()
    expect(screen.getByText(new RegExp(`Schematic: ${board.components.length} part`))).toBeInTheDocument()
  }, 45_000)

  it('runs the assistant EDA plan against the live canvas payloads', async () => {
    const board = buildDemoBoard()
    seed(board.components, board.wires)

    render(<AgentPanel />)
    fireEvent.click(screen.getByRole('tab', { name: 'Assistant' }))
    fireEvent.change(screen.getByLabelText('Assistant prompt'), { target: { value: 'Auto-route board' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await screen.findByText(/Route:/, {}, { timeout: 30_000 })
    expect(screen.getByText(/Completed 4 of 4 step/)).toBeInTheDocument()
    expect(screen.getByText(/DRC:/)).toBeInTheDocument()
    // The autopilot tab stays mounted, so the routed-board preview consumes the
    // layout the same tools just published.
    expect(await screen.findByAltText('Routed board top view')).toBeInTheDocument()
  }, 45_000)
})
