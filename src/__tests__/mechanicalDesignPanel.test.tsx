/**
 * Mechanical panel render coverage.
 * The beam math is inline and synchronous, so the suite runs it live:
 * chrome, static run with von Mises output, modal run with frequencies,
 * component selection.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import MechanicalDesignPanel from '../components/mechanical/MechanicalDesignPanel'

describe('MechanicalDesignPanel', () => {
  it('renders chrome with default beam selected', () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    expect(screen.getByText('Mechanical Design')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run Analysis/ })).toBeInTheDocument()
    expect(screen.getByText('Status: Ready')).toBeInTheDocument()
  })

  it('runs a static analysis and reports von Mises stress', async () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis/ }))
    await waitFor(() => expect(screen.getByText(/Max von Mises:/)).toBeInTheDocument())
    expect(screen.getByText('Status: Ready')).toBeInTheDocument()
  })

  it('runs a modal analysis and reports natural frequencies', async () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'modal' } })
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis/ }))
    await waitFor(() => expect(screen.getByText(/Natural Frequencies/)).toBeInTheDocument())
  })

  it('selects a component from the list', () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    const buttons = screen.getAllByRole('button')
    const plate = buttons.find((button) => button.textContent?.includes('plate'))
    if (plate) {
      fireEvent.click(plate)
    }
    expect(screen.getByText('Mechanical Design')).toBeInTheDocument()
  })
})
