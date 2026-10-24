import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ControlSystemsPanel from '../components/control/ControlSystemsPanel'

afterEach(cleanup)

describe('ControlSystemsPanel', () => {
  it('shows margins, response metrics and stability for the default loop', () => {
    render(<ControlSystemsPanel onClose={() => {}} />)

    expect(screen.getByRole('heading', { name: 'Control Systems' })).toBeInTheDocument()
    expect(screen.getByText('Phase margin')).toBeInTheDocument()
    expect(screen.getByText('Gain margin')).toBeInTheDocument()
    expect(screen.getByText('Closed-loop stability')).toBeInTheDocument()
    expect(screen.getByText('stable')).toBeInTheDocument()
    expect(screen.getByText('Step response')).toBeInTheDocument()
    expect(screen.getByText('Bode magnitude')).toBeInTheDocument()
    expect(screen.getByText('Poles and zeros')).toBeInTheDocument()
  })

  it('loads a preset into the coefficient fields', () => {
    render(<ControlSystemsPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'First order' }))
    expect(screen.getByLabelText('Denominator coefficients')).toHaveValue('1, 1')
  })

  it('reports malformed coefficients instead of keeping stale results', () => {
    render(<ControlSystemsPanel onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Numerator coefficients'), { target: { value: 'abc' } })
    expect(screen.getByText(/not a finite number/)).toBeInTheDocument()
    expect(screen.queryByText('Phase margin')).not.toBeInTheDocument()
  })
})
