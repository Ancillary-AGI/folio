/**
 * The net inspector is the net's own palette: summary rows, the pins it
 * reaches, and this net's rule findings. Renaming stages a draft and commits
 * the whole net only through Apply.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import NetInspector, { type NetInspectorModel } from '../components/NetInspector'

const net: NetInspectorModel = {
  key: 'GND',
  name: 'GND',
  pins: [
    { componentId: 'placed-r1', pinId: '1', reference: 'R1', partName: 'Resistor', pinName: 'A', pinType: 'passive' },
    { componentId: 'placed-r1', pinId: '2', reference: 'R1', partName: 'Resistor', pinName: 'B', pinType: 'passive' },
    { componentId: 'placed-r2', pinId: '1', reference: 'R2', partName: 'Resistor', pinName: 'A', pinType: 'passive' },
  ],
  wireIds: ['w1', 'w2'],
  segmentCount: 2,
  lengthMm: 7,
}

const renderNet = (overrides: Partial<ComponentProps<typeof NetInspector>> = {}) => {
  const onRename = overrides.onRename ?? vi.fn((): string | null => null)
  const props: ComponentProps<typeof NetInspector> = {
    net,
    findings: [],
    onSelectPin: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
    onRename,
  }
  render(<NetInspector {...props} />)
  return { ...props, onRename }
}

describe('NetInspector', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('summarises the net and lists every pin it reaches', () => {
    renderNet()

    expect(screen.getByText('GND')).toBeInTheDocument()
    expect(screen.getByText('7.0 mm')).toBeInTheDocument()
    expect(screen.getByText('3 pins')).toBeInTheDocument()

    expect(screen.getByTitle('Select R1 · Resistor · pin A')).toBeInTheDocument()
    expect(screen.getByTitle('Select R1 · Resistor · pin B')).toBeInTheDocument()
    expect(screen.getByTitle('Select R2 · Resistor · pin A')).toBeInTheDocument()
  })

  it('drills into the part behind a pin', () => {
    const props = renderNet()
    fireEvent.click(screen.getByTitle('Select R2 · Resistor · pin A'))
    expect(props.onSelectPin).toHaveBeenCalledWith('placed-r2')
  })

  it('stages a rename and commits it through Apply', () => {
    const props = renderNet()
    const field = screen.getByLabelText('Name') as HTMLInputElement

    fireEvent.change(field, { target: { value: '  VSS  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(props.onRename).toHaveBeenCalledWith('VSS')
  })

  it('blocks an invalid name before it reaches the design', () => {
    const props = renderNet()
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '1BAD' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(props.onRename).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent('Names start with a letter')
  })

  it('shows the conflict returned by the rename handler', () => {
    renderNet({ onRename: () => 'Another net is already named "VCC".' })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'VCC' } })
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))

    expect(screen.getByRole('alert')).toHaveTextContent('Another net is already named "VCC".')
  })

  it('names an unnamed wire and shows its findings', () => {
    renderNet({
      net: { ...net, key: 'wire:w1', name: null, wireIds: ['w1'] },
      findings: [
        {
          type: 'no_driver',
          severity: 'warning',
          message: 'Net "wire:w1" connects only inputs (R1.A) — nothing drives it',
          netId: 'wire:w1',
          suggestion: 'Connect it to an output or source, or split the net',
        },
      ],
    })

    expect(screen.getByText('Unnamed net')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByText(/nothing drives it/)).toBeInTheDocument()
    expect(screen.getByText('Connect it to an output or source, or split the net')).toBeInTheDocument()
  })
})
