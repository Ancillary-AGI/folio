/**
 * DigitalTwinFleetPanel synchronization reporting.
 *
 * "Sync twins" is an await-then-report path: the status shown must come from the
 * twin record after the pass finishes, and a twin with no sensors, actuators or
 * circuit model has to say that the pass recorded a stamp rather than implying a
 * physical asset was reconciled. The rectifier button is the one that solves a
 * real netlist, and a failed pass must surface the error instead of leaving the
 * previous status on screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import DigitalTwinFleetPanel from '../components/digitalTwin/DigitalTwinFleetPanel'
import { digitalTwinService } from '../lib/digitalTwin/digitalTwinService'

describe('DigitalTwinFleetPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('reports the post-sync status and states that no physics ran', async () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Sync twins' }))

    await waitFor(() => expect(screen.getByText(/status online, health 100%/)).toBeInTheDocument())
    expect(screen.getByText(/no physics ran/)).toBeInTheDocument()
    expect(screen.getByText('online', { selector: 'div.text-2xl' })).toBeInTheDocument()
  })

  it('shows the sync error and marks the twin as failed', async () => {
    vi.spyOn(digitalTwinService, 'syncWithPhysicalDevice').mockRejectedValue(new Error('gateway unreachable'))
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Sync twins' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('gateway unreachable'))
    expect(screen.queryByText(/no physics ran/)).not.toBeInTheDocument()
  })

  it('verifies the rectifier twin through the solver and badges the verdict', async () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Verify rectifier twin' }))

    await waitFor(() => expect(screen.getByText('verified', { selector: 'div.text-2xl' })).toBeInTheDocument())
    expect(screen.getByText('verified', { selector: 'div.rounded-full' })).toBeInTheDocument()
    expect(screen.getByText(/twin verifies centre and refuses \+2 V drift/)).toBeInTheDocument()
  })
})
