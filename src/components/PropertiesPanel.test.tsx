/**
 * Properties inspector tests.
 *
 * The inspector is how a designer changes a stimulus after placing it, so the
 * contract that matters is that an added key reaches the store with the type the
 * SPICE reader expects: a bare number stays numeric, and '1u' stays text because
 * '1u' means 1e-6 while the number 1 means one second.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import PropertiesPanel from './PropertiesPanel'

const source = () => ({
  id: 'cmp-v1',
  reference: 'V1',
  component: {
    name: 'DC Voltage Source',
    category: 'power',
    pins: [
      { id: 'positive', name: '+', type: 'power' },
      { id: 'negative', name: '-', type: 'ground' },
    ],
  },
  properties: { voltage: '5V', type: 'DC' },
  x: 100,
  y: 200,
  rotation: 0,
})

function renderPanel(onUpdate = vi.fn()) {
  render(
    <PropertiesPanel component={source()} onUpdate={onUpdate} onClose={() => {}} />,
  )
  return onUpdate
}

function addAttribute(name: string, value: string) {
  fireEvent.change(screen.getByLabelText('New attribute name'), { target: { value: name } })
  fireEvent.change(screen.getByLabelText('New attribute value'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Add attribute' }))
}

/**
 * The workspace builds its inspector prop as an object literal inside render, so
 * every parent re-render — a canvas tool switch, a status-bar tick — hands the
 * panel a new object carrying the same design. Staged edits must survive that.
 */
function renderPanelWithChurn() {
  const properties = { voltage: '5V', type: 'DC' }
  const instance = {
    id: 'cmp-v1',
    reference: 'V1',
    component: source().component,
    properties,
    x: 100,
    y: 200,
    rotation: 0,
    locked: false,
    visible: true,
  }
  const onUpdate = vi.fn()
  const view = render(<PropertiesPanel component={instance} onUpdate={onUpdate} onClose={() => {}} />)
  const rerenderAt = (next: Partial<typeof instance>) =>
    view.rerender(
      <PropertiesPanel component={{ ...instance, ...next }} onUpdate={onUpdate} onClose={() => {}} />,
    )
  return { onUpdate, rerenderAt, properties }
}

describe('PropertiesPanel', () => {
  it('adds a bare number as a numeric attribute', () => {
    const onUpdate = renderPanel()
    addAttribute('ac', '1')

    const field = screen.getByLabelText('Ac')
    expect(field).toHaveAttribute('type', 'number')
    expect(field).toHaveValue(1)

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    expect(onUpdate).toHaveBeenCalledWith('cmp-v1', expect.objectContaining({ ac: 1 }))
  })

  it('keeps a SPICE-scaled value as text', () => {
    renderPanel()
    addAttribute('td', '1u')

    const field = screen.getByLabelText('Td')
    expect(field).toHaveAttribute('type', 'text')
    // A number input would show 0.000001 and lose the suffix the parser needs.
    expect(field).toHaveValue('1u')
  })

  it('refuses a key the transform rows already own', () => {
    renderPanel()
    addAttribute('rotation', '90')

    expect(screen.getByRole('alert')).toHaveTextContent(/Transform and Display rows/i)
    expect(screen.queryByRole('button', { name: 'Remove rotation attribute' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Rotation in degrees')).toHaveValue(0)
  })

  it('refuses a duplicate key instead of silently retyping it', () => {
    renderPanel()
    addAttribute('voltage', '12')
    expect(screen.getByRole('alert')).toHaveTextContent(/already an attribute/i)
    expect(screen.getByLabelText('Voltage')).toHaveValue('5V')
  })

  it('rejects a malformed name', () => {
    renderPanel()
    addAttribute('2a', '1')
    expect(screen.getByRole('alert')).toHaveTextContent(/start with a letter/i)
  })

  it('removes an attribute and leaves it out on apply', () => {
    const onUpdate = renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Remove voltage attribute' }))
    expect(screen.queryByLabelText('Voltage')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
    const patch = onUpdate.mock.calls[0][1]
    expect(patch).not.toHaveProperty('voltage')
    expect(patch).toHaveProperty('type', 'DC')
  })

  it('keeps un-applied edits across a parent re-render', () => {
    const { onUpdate, rerenderAt } = renderPanelWithChurn()
    fireEvent.change(screen.getByLabelText('Voltage'), { target: { value: '12V' } })
    rerenderAt({})

    // Before, the rebuild reset this to '5V' and greyed the Apply button out.
    expect(screen.getByLabelText('Voltage')).toHaveValue('12V')
    const apply = screen.getByRole('button', { name: 'Apply' })
    expect(apply).toBeEnabled()
    fireEvent.click(apply)
    expect(onUpdate).toHaveBeenCalledWith('cmp-v1', expect.objectContaining({ voltage: '12V' }))
  })

  it('adopts a value the design committed to elsewhere', () => {
    const { rerenderAt, properties } = renderPanelWithChurn()
    fireEvent.change(screen.getByLabelText('Voltage'), { target: { value: '12V' } })
    rerenderAt({ properties: { ...properties, voltage: '3.3V' } })

    expect(screen.getByLabelText('Voltage')).toHaveValue('3.3V')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
  })

  it('reflects the lock the instance actually carries', () => {
    const { rerenderAt } = renderPanelWithChurn()
    rerenderAt({ locked: true })

    const lock = screen.getByRole('checkbox', { name: 'Locked' })
    expect(lock).toBeChecked()
    fireEvent.click(lock)
    expect(screen.getByRole('checkbox', { name: 'Free' })).not.toBeChecked()
  })
})
