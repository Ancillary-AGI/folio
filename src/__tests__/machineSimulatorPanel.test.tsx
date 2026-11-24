import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import MachineSimulatorPanel from '../components/electronics/MachineSimulatorPanel'

afterEach(cleanup)

describe('MachineSimulatorPanel', () => {
  it('runs the default brushed DC motor and reports its operating point', () => {
    render(<MachineSimulatorPanel onClose={() => {}} />)

    expect(screen.getByRole('heading', { name: 'Electric Machines' })).toBeInTheDocument()
    expect(screen.getByDisplayValue('RS-550 brushed DC (12 V)')).toBeInTheDocument()
    expect(screen.getByText('Steady speed')).toBeInTheDocument()
    expect(screen.getByText('Current')).toBeInTheDocument()
    expect(screen.getByText('Terminal voltage')).toBeInTheDocument()
    expect(screen.getByText('Speed and current')).toBeInTheDocument()
  })

  it('switches to generator operation and asks for a prime-mover torque', () => {
    render(<MachineSimulatorPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'DC generator' }))
    expect(screen.getByText('Prime-mover torque (N·m)')).toBeInTheDocument()
    expect(screen.getByText(/applied opposite rotation/)).toBeInTheDocument()
    expect(screen.getByLabelText('Generator load resistance')).toBeInTheDocument()
  })

  it('exposes the BLDC and stepper operating points', () => {
    render(<MachineSimulatorPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'BLDC / PMSM' }))
    expect(screen.getByLabelText('Modulation index')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Stepper' }))
    expect(screen.getByLabelText('Step rate')).toBeInTheDocument()
    expect(screen.getByText('Average rate')).toBeInTheDocument()
    expect(screen.getByText('Command and rotor position')).toBeInTheDocument()
  })
})
