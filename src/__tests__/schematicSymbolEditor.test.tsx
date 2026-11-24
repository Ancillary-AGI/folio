/**
 * Symbol editor dialog coverage: it writes the draft to every instance of the
 * part, and it will not write one the canvas contract would reject.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SchematicSymbolEditor from '../components/SchematicSymbolEditor'
import { useProjectStore, type CanvasComponent } from '../stores/useProjectStore'
import { standardComponents } from '../lib/componentLibrary'
import type { Component } from '../lib/supabase'

const resistor = (): Component =>
  ({ ...standardComponents.find((entry) => entry.name === 'Resistor')!, id: 'lib-resistor' }) as Component

const placed = (id: string, reference: string): CanvasComponent => ({
  id,
  componentId: 'lib-resistor',
  component: resistor(),
  x: 100,
  y: 100,
  rotation: 0,
  reference,
  properties: { value: '10k' },
})

describe('SchematicSymbolEditor', () => {
  beforeEach(() => {
    useProjectStore.setState({
      components: [placed('c1', 'R1'), placed('c2', 'R2')],
      wires: [],
      isDirty: false,
    })
  })

  it('edits the body and applies it to every instance of the part', () => {
    const onClose = vi.fn()
    render(<SchematicSymbolEditor componentId="c1" onClose={onClose} />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(/R1 · Resistor/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /Apply to 2 instances/ }))

    const widths = useProjectStore.getState().components.map((entry) => entry.component.symbol_data.width)
    expect(widths).toEqual([120, 120])
    expect(useProjectStore.getState().isDirty).toBe(true)
    expect(onClose).toHaveBeenCalled()
  })

  it('refuses to save a pin that falls outside the body', () => {
    const onClose = vi.fn()
    render(<SchematicSymbolEditor componentId="c1" onClose={onClose} />)

    fireEvent.change(screen.getByLabelText('Pin 1 x'), { target: { value: '400' } })

    expect(screen.getByRole('alert')).toHaveTextContent(/outside the symbol body/)
    expect(screen.getByRole('button', { name: /Apply to 2 instances/ })).toBeDisabled()
    expect(useProjectStore.getState().components[0].component.symbol_data.width).toBe(80)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('resets the draft back to the library symbol', () => {
    render(<SchematicSymbolEditor componentId="c1" onClose={vi.fn()} />)

    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '120' } })
    fireEvent.click(screen.getByRole('button', { name: /Reset/ }))

    expect(screen.getByLabelText('Width')).toHaveValue(80)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<SchematicSymbolEditor componentId="c1" onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders nothing when the part is gone', () => {
    const { container } = render(<SchematicSymbolEditor componentId="missing" onClose={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
