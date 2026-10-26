import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import HDLEditor from '../components/ecad/HDLEditor'
import { useAppStore } from '../stores/useAppStore'

describe('HDLEditor', () => {
  beforeEach(() => {
    useAppStore.setState({ demoRequest: null })
  })

  it('elaborates and simulates the default half adder', async () => {
    render(<HDLEditor />)

    fireEvent.click(screen.getByRole('button', { name: /Run/ }))

    expect(await screen.findByText(/Parsed module: half_adder/)).toBeInTheDocument()
    expect(await screen.findByText(/Digital simulation/)).toBeInTheDocument()
  })

  it('auto-runs when the gallery requests it and drives the half adder inputs', async () => {
    useAppStore.setState({ demoRequest: 'hdl-half-adder' })

    render(<HDLEditor />)

    expect(await screen.findByText(/Digital simulation/)).toBeInTheDocument()
    // No stimulus means every node stays X and the run has zero events; the
    // demo must produce real transitions instead.
    expect(screen.getByText(/Auto testbench: a, b driven as a binary count/)).toBeInTheDocument()
    expect(screen.getByText(/Digital simulation \(0–20 time units, [1-9][0-9]* events\)/)).toBeInTheDocument()
    await waitFor(() => expect(useAppStore.getState().demoRequest).toBeNull())
  })
})
