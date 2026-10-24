import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ICDesignPanel from '../components/ecad/ICDesignPanel'
import { useAppStore } from '../stores/useAppStore'

beforeEach(() => useAppStore.setState({ demoRequest: null }))
afterEach(cleanup)

describe('ICDesignPanel', () => {
  it('takes the default Verilog design through synthesis, floorplan, packaging and GDSII', async () => {
    render(<ICDesignPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Synthesis' }))
    fireEvent.click(screen.getByRole('button', { name: /Run Synthesis/ }))

    expect(await screen.findByText(/Synthesis complete/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Plan Floorplan' }))
    expect(await screen.findByText('Select a package type for the die.')).toBeInTheDocument()

    fireEvent.click(screen.getByText(/QFN-32/))
    expect(screen.getByText(/Package details/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Continue → GDSII Export/ }))
    fireEvent.click(screen.getByRole('button', { name: /Generate GDSII/ }))
    expect(await screen.findByText(/GDSII summary/)).toBeInTheDocument()
  })

  it('runs synthesis and lands on the floorplan when the full-flow demo opens', async () => {
    useAppStore.setState({ demoRequest: 'ic-full-flow' })
    render(<ICDesignPanel />)

    expect(await screen.findByText(/Synthesis complete/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Plan Floorplan' })).toBeInTheDocument()
    expect(useAppStore.getState().demoRequest).toBeNull()
  })

  it('shifts a 74HC595 and reads/writes a memory device in the Device Lab', () => {
    render(<ICDesignPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Device Lab' }))

    expect(screen.getByLabelText('Logic / memory part')).toHaveValue('hc595')

    fireEvent.click(screen.getByLabelText('SER'))
    fireEvent.click(screen.getByLabelText('SRCLK'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply step' }))
    expect(screen.getByText(/Shift 0x01/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('SER'))
    fireEvent.click(screen.getByLabelText('SRCLK'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply step' }))
    fireEvent.click(screen.getByLabelText('SRCLK'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply step' }))
    expect(screen.getByText(/Shift 0x02/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('RCLK'))
    fireEvent.click(screen.getByRole('button', { name: 'Apply step' }))
    expect(screen.getByText(/Latch 0x02/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Logic / memory part'), { target: { value: 'sram-23lc1024' } })
    fireEvent.change(screen.getByLabelText('Address (0x…)'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Value (0–255)'), { target: { value: '165' } })
    fireEvent.click(screen.getByRole('button', { name: 'Write' }))
    expect(screen.getByText(/Wrote 0xa5 at 0xa in 0 ms/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Read' }))
    expect(screen.getByText(/0xa = 0xa5/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Logic / memory part'), { target: { value: 'flash-w25q128' } })
    fireEvent.change(screen.getByLabelText('Value (0–255)'), { target: { value: '15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Write' }))
    fireEvent.change(screen.getByLabelText('Value (0–255)'), { target: { value: '240' } })
    fireEvent.click(screen.getByRole('button', { name: 'Write' }))
    expect(screen.getByText(/flash kept the zero bits/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Erase sector' }))
    expect(screen.getByText(/Erased 4096 bytes from 0x0 in 400 ms/)).toBeInTheDocument()
  })
})
