/**
 * AgentPanel ERC surface.
 * The symbolic verifier is deterministic and canvas-agnostic; this suite
 * proves the panel runs it over the netlist the simulator would build.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AgentPanel from '../components/ecad/AgentPanel'
import { useProjectStore } from '../stores/useProjectStore'
import type { CanvasComponent, CanvasWire } from '../stores/useProjectStore'

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
