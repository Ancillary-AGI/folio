/**
 * The toolbox is a thin layer over `src/lib/control/autoTune`, but these drive it
 * the way an engineer does — press a route, read the numbers it reports — because
 * the point of the surface is that the figures shown are the ones the simulation
 * produced. Anchors are analytically known values, not snapshots.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import ControllerToolbox from './ControllerToolbox'
import type { PidGains } from '../../lib/control/pid'
import type { TransferFunction } from '../../lib/control/transferFunction'

/** 1/(s+1)³: the −180° crossing is at ω=√3, so Ku=8 and Tu=2π/√3 exactly. */
const triplePole: TransferFunction = { numerator: [1], denominator: [1, 3, 3, 1] }
const integratorPlusLag: TransferFunction = { numerator: [1], denominator: [1, 1, 0] }

const ULTIMATE_GAIN = 8
const ULTIMATE_PERIOD = (2 * Math.PI) / Math.sqrt(3)

function renderToolbox(overrides: Partial<React.ComponentProps<typeof ControllerToolbox>> = {}) {
  const onApplyGains = vi.fn()
  render(
    <ControllerToolbox
      plant={triplePole}
      plantText="1 / 1, 3, 3, 1"
      currentGains={{ kp: 2, ki: 1, kd: 0.1, derivativeFilterSeconds: 0.01 }}
      horizon={{ tEndSeconds: 10, dtSeconds: 0.005 }}
      marginScan={{ fMinHz: 0.01, fMaxHz: 1000 }}
      onApplyGains={onApplyGains}
      {...overrides}
    />,
  )
  return onApplyGains
}

const runButton = () => screen.getByRole('button', { name: /^run /i })

/** The value line of a summary card, as the number it prints. */
function summaryValue(label: string): string {
  const card = screen.getByText(label).nextElementSibling
  return card?.textContent ?? ''
}

describe('ControllerToolbox', () => {
  it('names the plant it is tuning', () => {
    renderToolbox()
    expect(screen.getByText(/P\(s\) = 1 \/ 1, 3, 3, 1/i)).toBeInTheDocument()
  })

  it('shuts off without a usable plant', () => {
    renderToolbox({ plant: null })
    expect(screen.getByText(/coefficients above are not usable/i)).toBeInTheDocument()
    expect(runButton()).toBeDisabled()
    expect(screen.getByText(/Fix the plant coefficients to use the toolbox/i)).toBeInTheDocument()
  })

  it('measures the critical gain of the triple pole off its own limit cycle', async () => {
    renderToolbox()
    // Hysteresis is the textbook relay's enemy here: with h = 0 the loop crosses
    // at exactly −180°, so the analytic Ku and Tu apply without a shift.
    fireEvent.change(screen.getByLabelText('Relay hysteresis'), { target: { value: '0' } })
    fireEvent.click(runButton())
    await waitFor(() => expect(screen.getByText('Critical gain Ku')).toBeInTheDocument())

    const ku = parseFloat(summaryValue('Critical gain Ku'))
    expect(Math.abs(ku - ULTIMATE_GAIN) / ULTIMATE_GAIN).toBeLessThan(0.05)
    const period = parseFloat(summaryValue('Ultimate period Tu'))
    expect(Math.abs(period - ULTIMATE_PERIOD) / ULTIMATE_PERIOD).toBeLessThan(0.05)
  }, 20000)

  it('shows the hysteresis shifting the crossing instead of hiding it', async () => {
    renderToolbox()
    fireEvent.change(screen.getByLabelText('Relay hysteresis'), { target: { value: '0.06' } })
    fireEvent.click(runButton())
    await waitFor(() => expect(screen.getByText('Critical gain Ku')).toBeInTheDocument())

    const shifted = parseFloat(summaryValue('Critical gain Ku'))
    // A relay with lag meets the plant above the −180° crossing, where the plant
    // attenuates less, so the reported critical gain drops. The run says so.
    expect(shifted).toBeLessThan(ULTIMATE_GAIN)
    expect(screen.getByText(/of relay phase lag/i)).toBeInTheDocument()
    expect(screen.getByText(/at that shifted crossing/i)).toBeInTheDocument()
  }, 20000)

  it('hands the tuned gains to the workspace when Apply is pressed', async () => {
    const onApplyGains = renderToolbox()
    fireEvent.click(runButton())
    await waitFor(() => expect(screen.getByText('Critical gain Ku')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Apply to the loop above/i }))
    expect(onApplyGains).toHaveBeenCalledTimes(1)
    const gains: PidGains = onApplyGains.mock.calls[0][0]
    expect(gains.kp).toBeGreaterThan(0)
    expect(gains.kp).toBeLessThan(ULTIMATE_GAIN)
    expect(Number.isFinite(gains.ki)).toBe(true)
    expect(gains.kd).toBeGreaterThan(0)
  }, 20000)

  it('refuses rules of thumb on a plant with no self-regulating step response', async () => {
    renderToolbox({ plant: integratorPlusLag })
    fireEvent.click(screen.getByRole('button', { name: 'Rules of thumb' }))
    fireEvent.click(runButton())

    await waitFor(() => expect(screen.getByText(/self-regulating/i)).toBeInTheDocument())
    expect(screen.queryByText('Identified K')).not.toBeInTheDocument()
  })

  it('reports the budget it spent and how the search stopped', async () => {
    renderToolbox()
    fireEvent.click(screen.getByRole('button', { name: 'Heuristic search' }))
    fireEvent.change(screen.getByLabelText('Evaluation budget'), { target: { value: '40' } })
    fireEvent.click(runButton())

    await waitFor(() => expect(screen.getByText('Termination')).toBeInTheDocument())
    const [used, cap] = summaryValue('Simulations').split(' of ').map(Number)
    expect(cap).toBe(40)
    expect(used).toBeGreaterThan(0)
    expect(used).toBeLessThanOrEqual(cap)
    expect(['budget', 'converged']).toContain(summaryValue('Termination'))
    // Every term the tuner optimised is on the page, so a low total can be audited.
    expect(screen.getByText('Cost breakdown — every term the tuner saw')).toBeInTheDocument()
  }, 30000)

  it('shows what an actuator limit does to the gains already in the panel', async () => {
    renderToolbox()
    fireEvent.click(screen.getByRole('button', { name: 'Sampled loop check' }))
    fireEvent.click(runButton())

    await waitFor(() => expect(screen.getByText('Saturated samples')).toBeInTheDocument())
    const [saturated, total] = summaryValue('Saturated samples').split(' of ').map(Number)
    // Kp 2 against a ±1 actuator on a unit step cannot avoid the rail.
    expect(saturated).toBeGreaterThan(0)
    expect(total).toBeGreaterThan(saturated)
    expect(screen.getByText(/linear tuning was not the whole story/i)).toBeInTheDocument()
  }, 20000)
})
