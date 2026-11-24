/**
 * RFDesignPanel: the link tab has to present a computed budget, not a form
 * that renders a placeholder. The default terrestrial path is inside the
 * margin; switching to a LEO satellite at the same modest EIRP must honestly
 * report a failure instead of keeping a green banner.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import RFDesignPanel from '../components/rf/RFDesignPanel'

describe('RFDesignPanel link budget', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('computes a closing terrestrial link and a failing satellite link', async () => {
    render(<RFDesignPanel onClose={() => {}} />)

    fireEvent.click(screen.getByRole('tab', { name: 'Link & 6G' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/Link closes with \d+\.\d+ dB margin/)
    expect(screen.getByText('Free-space loss')).toBeInTheDocument()
    expect(screen.getByText('Noise floor')).toBeInTheDocument()
    expect(screen.getByText('NR numerology and candidate bands')).toBeInTheDocument()
    // A 2.4 GHz carrier is below every candidate 6G band, so none is highlighted
    // as a match; the list still names the research bands.
    expect(screen.getByText('Sub-THz 92–300 GHz')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Scenario'), { target: { value: 'satellite' } })
    const satelliteStatus = await screen.findByRole('status')
    expect(satelliteStatus).toHaveTextContent(/Link fails by \d+\.\d+ dB against the 6 dB requirement/)
    expect(screen.getByText(/km slant range/)).toBeInTheDocument()

    const numerology = screen.getByLabelText('NR numerology')
    fireEvent.change(numerology, { target: { value: '2' } })
    const timing = screen.getByText('Slot length').parentElement as HTMLElement
    expect(within(timing).getByText('250.000 µs')).toBeInTheDocument()
  })

  it('computes a fibre link budget with an honest photon comparison', async () => {
    render(<RFDesignPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Photonics' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveTextContent(/Optical link closes with \d+\.\d+ dB margin/)
    expect(screen.getByText('Power chain')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Chromatic dispersion' })).toBeInTheDocument()
    expect(screen.getByText('Photons per bit at sensitivity')).toBeInTheDocument()
    expect(screen.getByText('Ideal ln(1/BER) bound')).toBeInTheDocument()
    expect(screen.getByText(/is not a photon counter/)).toBeInTheDocument()
    expect(screen.getByText('Link margin')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Fibre span'), { target: { value: '200' } })
    const failed = await screen.findByRole('status')
    expect(failed).toHaveTextContent(/Optical link fails by \d+\.\d+ dB/)
  })

  it('evolves the Bell state and samples its distribution', async () => {
    render(<RFDesignPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Quantum' }))

    expect(await screen.findByText('Statevector · 2 qubits')).toBeInTheDocument()
    expect(screen.getByText('|00⟩')).toBeInTheDocument()
    expect(screen.getByText('|11⟩')).toBeInTheDocument()
    expect(screen.getAllByText('50.000 %')).toHaveLength(2)
    expect(screen.getAllByText('0.5000')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Run measurement' }))
    const sampled = await screen.findByRole('status')
    expect(sampled).toHaveTextContent(/1000 shots produced 2 observed outcomes/)
    expect(sampled).toHaveTextContent(/Sampling is statistical/)

    fireEvent.click(screen.getByRole('button', { name: 'GHZ-3' }))
    expect(await screen.findByText('Statevector · 3 qubits')).toBeInTheDocument()
    expect(screen.getAllByText('50.000 %')).toHaveLength(2)
    expect(screen.getByText('|000⟩')).toBeInTheDocument()
    expect(screen.getByText('|111⟩')).toBeInTheDocument()
  })

  it('edits the circuit and reports an invalid gate instead of hiding it', async () => {
    render(<RFDesignPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('tab', { name: 'Quantum' }))

    fireEvent.change(await screen.findByLabelText('Quantum gate'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add gate' }))
    expect(await screen.findByText(/3\. Pauli X · q0/)).toBeInTheDocument()
    expect(screen.getByText('|10⟩')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove gate 3' }))
    expect(screen.queryByText(/3\. Pauli X/)).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Quantum gate'), { target: { value: 'cnot' } })
    fireEvent.change(screen.getByLabelText('Target qubit'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add gate' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/distinct control and target/)

    fireEvent.change(screen.getByLabelText('Qubits'), { target: { value: '1' } })
    expect(await screen.findByText(/The empty circuit is \|0⟩/)).toBeInTheDocument()
  })
})
