/**
 * PowerGridPanel: the study has to headline the solver's real verdict. A
 * three-bus case converges and reports generation, demand and losses; pushing
 * the stressed tie past its transfer limit must admit non-convergence instead
 * of painting the last iterate green. The distribution tab exercises the
 * backward/forward sweep on the default urban feeder.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import PowerGridPanel from '../components/electronics/PowerGridPanel'

describe('PowerGridPanel power flow', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('solves the default transmission study with real totals', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/Power flow converged in \d+ iterations? with a [\d.e+-]+ pu mismatch/)

    expect(screen.getByText('Generation')).toBeInTheDocument()
    expect(screen.getByText('Demand')).toBeInTheDocument()
    expect(screen.getByText('Losses')).toBeInTheDocument()
    expect(screen.getByText('Minimum voltage')).toBeInTheDocument()

    const busTable = screen.getByRole('table', { name: 'Bus voltages, angles and power injections' })
    expect(within(busTable).getByText('Bus 1')).toBeInTheDocument()
    expect(within(busTable).getByText('Bus 3')).toBeInTheDocument()

    const branchTable = screen.getByRole('table', { name: 'Branch sending-end and receiving-end power flows' })
    expect(within(branchTable).getByText('Bus 1 → Bus 2')).toBeInTheDocument()
  })

  it('reports non-convergence past the transfer limit instead of a fake solution', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Transmission study'), { target: { value: 'two-bus' } })
    fireEvent.change(screen.getByLabelText('Demand scale'), { target: { value: '2' } })

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(
      /Power flow did not converge after \d+ Newton iterations\. Bus values below are the last iterate, not a solution\./,
    )
    expect(screen.getByText('stopped without a solution')).toBeInTheDocument()
  })

  it('runs the distribution sweep and reports section currents', async () => {
    render(<PowerGridPanel onClose={() => {}} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Distribution' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/Feeder converged in \d+ backward\/forward sweeps?\./)

    expect(screen.getByText('Source delivered')).toBeInTheDocument()
    expect(screen.getByText('Copper loss')).toBeInTheDocument()

    const sectionTable = screen.getByRole('table', { name: 'Feeder section currents, losses and voltage drop' })
    expect(within(sectionTable).getByText('Tx → Kiosk A')).toBeInTheDocument()
    expect(within(sectionTable).getByText('Kiosk B → Kiosk C')).toBeInTheDocument()
  })
})
