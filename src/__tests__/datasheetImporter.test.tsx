import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import DatasheetImporter from '../components/ecad/DatasheetImporter'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'

beforeEach(() => {
  useAppStore.setState({ demoRequest: null })
  useProjectStore.setState({ components: [], wires: [], componentLibrary: [] })
})
afterEach(cleanup)

describe('DatasheetImporter', () => {
  it('parses the demo datasheet and synthesizes a part on open', () => {
    useAppStore.setState({ demoRequest: 'datasheet-demo' })
    render(
      <StrictMode>
        <DatasheetImporter />
      </StrictMode>,
    )

    expect(screen.getByText('MCP3008-I/SL')).toBeInTheDocument()
    expect(screen.getByText(/16 pins/)).toBeInTheDocument()
    expect(screen.getByText(/2.7–5.5 V/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('VDD')).toBeInTheDocument()
    expect(screen.getByText(/Generated SPICE stub/)).toBeInTheDocument()
    expect(useAppStore.getState().demoRequest).toBeNull()
  })

  it('puts the confirmed part in the session library and on the sheet', () => {
    useAppStore.setState({ demoRequest: 'datasheet-demo' })
    render(<DatasheetImporter />)

    fireEvent.click(screen.getByRole('button', { name: /Add to Component Library and Place/ }))

    const state = useProjectStore.getState()
    expect(state.componentLibrary).toHaveLength(1)
    expect(state.componentLibrary[0]?.name).toBe('MCP3008-I/SL')
    expect(state.components).toHaveLength(1)
    expect(state.components[0]?.component.id).toBe(state.componentLibrary[0]?.id)
    expect(screen.getByRole('status')).toHaveTextContent(/placed M1 at 100, 120 on the sheet/)
  })

  it('places the edited pin table, not the raw parse', () => {
    useAppStore.setState({ demoRequest: 'datasheet-demo' })
    render(<DatasheetImporter />)

    fireEvent.change(screen.getByLabelText('Pin 1 name'), { target: { value: 'VCCIO' } })
    fireEvent.change(screen.getByLabelText('Pin 1 kind'), { target: { value: 'input' } })
    expect(screen.getByText(/VCCIO/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Add to Component Library and Place/ }))

    const placed = useProjectStore.getState().components[0]!
    const firstPin = placed.component.pins.find(pin => pin.id === 'p1')
    expect(firstPin?.name).toBe('VCCIO')
    expect(firstPin?.type).toBe('input')
  })
})
