/**
 * Assembly calculator render coverage.
 *
 * The panel is the mounted surface for the passive-selection, interface,
 * harness, thermal/mounting and reflow modules. These tests assert the
 * numbers the tested modules produce, not just that a label exists.
 */
import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import DesignCalculatorsPanel from '../components/electronics/DesignCalculatorsPanel'

describe('DesignCalculatorsPanel', () => {
  it('selects the nearest E12 passive and recomputes on family change', () => {
    render(<DesignCalculatorsPanel />)

    expect(screen.getByText('Selected value')).toBeInTheDocument()
    expect(screen.getByText('4.7 kΩ')).toBeInTheDocument()
    expect(screen.getByText('Max current at rated power')).toBeInTheDocument()
    expect(screen.getByText('100 mW')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Family'), { target: { value: 'capacitor' } })
    fireEvent.change(screen.getByLabelText('Target value (nF)'), { target: { value: '10' } })
    expect(screen.getByText('10 nF')).toBeInTheDocument()
    expect(screen.getByText('Dielectric tolerance')).toBeInTheDocument()
    expect(screen.getByText('±10%')).toBeInTheDocument()
  })

  it('computes interface budgets and flags an out-of-spec I²C rise time', () => {
    render(<DesignCalculatorsPanel />)

    expect(screen.getByText('4.883 mV')).toBeInTheDocument()
    expect(screen.getByText('1.41 mV')).toBeInTheDocument()
    expect(screen.getByText('11.000')).toBeInTheDocument()
    expect(screen.getByText('10 bits')).toBeInTheDocument()
    expect(screen.getByText('-0.223%')).toBeInTheDocument()
    expect(screen.getByText('11494 B/s')).toBeInTheDocument()
    expect(screen.getByText('597.3 ns')).toBeInTheDocument()
    expect(screen.getByText('Standard-mode only')).toBeInTheDocument()
  })

  it('recommends and applies a larger gauge when the loop drop exceeds 3%', () => {
    render(<DesignCalculatorsPanel />)

    expect(screen.getByText('5.34%', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Recommended gauge (≤3% drop)')).toBeInTheDocument()
    expect(screen.getAllByText('AWG 14').length).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: 'Apply recommended gauge' }))
    expect(screen.getByLabelText('Conductor')).toHaveValue('14')
    expect(screen.getByText('2.11%', { exact: false })).toBeInTheDocument()
  })

  it('computes TIM resistance and rejects a reflow trace outside the JEDEC window', () => {
    render(<DesignCalculatorsPanel />)

    expect(screen.getByText('0.833 K/W')).toBeInTheDocument()
    expect(screen.getByText('4.17 °C')).toBeInTheDocument()
    expect(screen.getByText('Profile inside JEDEC window')).toBeInTheDocument()

    const trace = screen.getByLabelText('Measured reflow profile samples')
    fireEvent.change(trace, { target: { value: '0,25' } })
    expect(screen.getByRole('alert')).toHaveTextContent('at least two time-temperature samples')

    fireEvent.change(trace, { target: { value: '0,25\n30,260\n60,25' } })
    expect(screen.getByText(/violation\(s\)/)).toBeInTheDocument()
  })

  it('shows the mounting, coating and potting catalogue values for the selection', () => {
    render(<DesignCalculatorsPanel />)

    expect(screen.getByText('Ø2.2 mm')).toBeInTheDocument()
    expect(screen.getByText('Ø5 mm')).toBeInTheDocument()
    expect(screen.getByText('Ø4.5 mm')).toBeInTheDocument()
    expect(screen.getByText('0.25 N·m')).toBeInTheDocument()
    expect(screen.getByText('IPC-CC-830 Type AR')).toBeInTheDocument()
    expect(screen.getByText('Shore A 60')).toBeInTheDocument()
  })
})
