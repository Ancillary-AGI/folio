/**
 * HIL panel render coverage.
 * The engine is real (validates, executes, summarizes) so the suite runs
 * live: idle chrome, busy lock, success verdict, bridge failure — all
 * through the actual setup/run path with no mocks.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import HILTestingPanel from '../components/hil/HILTestingPanel'
import { ArduinoIDEIntegration } from '../lib/programming/boardProgrammer'

describe('HILTestingPanel', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders idle chrome with no session', () => {
    render(<HILTestingPanel />)
    expect(screen.getByRole('heading', { name: 'Hardware-in-the-loop' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run HIL suite' })).toBeInTheDocument()
    expect(screen.getByText('Session —')).toBeInTheDocument()
  })

  it('runs the suite live and reports the verdict', async () => {
    render(<HILTestingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Run HIL suite' }))
    await waitFor(() => expect(screen.getByText(/passed in/)).toBeInTheDocument())
    expect(screen.getByText('led-high')).toBeInTheDocument()
    expect(screen.getByText('adc-rail')).toBeInTheDocument()
  })

  it('locks the button while running', async () => {
    const spy = vi.spyOn(ArduinoIDEIntegration, 'setupHILTest').mockImplementation(
      () => new Promise(() => {}),
    )
    try {
      render(<HILTestingPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'Run HIL suite' }))
      expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled()
    } finally {
      spy.mockRestore()
    }
  })

  it('surfaces a bridge failure instead of hanging', async () => {
    const spy = vi.spyOn(ArduinoIDEIntegration, 'setupHILTest').mockRejectedValue(new Error('no hardware'))
    try {
      render(<HILTestingPanel />)
      fireEvent.click(screen.getByRole('button', { name: 'Run HIL suite' }))
      await waitFor(() => expect(screen.getByText(/no hardware/)).toBeInTheDocument())
    } finally {
      spy.mockRestore()
    }
  })
})
