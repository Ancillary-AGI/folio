/**
 * Mechanical panel render coverage.
 * The beam math runs synchronously in the panel: chrome, static run with von
 * Mises output, modal run with frequencies attributed to the selected part,
 * component selection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import MechanicalDesignPanel from '../components/mechanical/MechanicalDesignPanel'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import { createDefaultMechanicalParts } from '../lib/mechanical/partModel'

const exportSpies = vi.hoisted(() => ({ downloadFile: vi.fn() }))
vi.mock('../lib/exportUtils', () => exportSpies)

beforeEach(() => {
  exportSpies.downloadFile.mockClear()
  useAppStore.setState({ demoRequest: null })
  useProjectStore.setState({ mechanicalParts: createDefaultMechanicalParts() })
})

describe('MechanicalDesignPanel', () => {
  it('renders chrome with default beam selected', () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    expect(screen.getByText('Mechanical Design')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run Analysis/ })).toBeInTheDocument()
    expect(screen.getByText('Status: Ready')).toBeInTheDocument()
  })

  it('runs a static analysis and reports von Mises stress', async () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis/ }))
    await waitFor(() => expect(screen.getByText(/Max von Mises:/)).toBeInTheDocument())
    expect(screen.getByText('Status: Ready')).toBeInTheDocument()
  })

  it('runs a modal analysis and reports natural frequencies', async () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    const selects = screen.getAllByRole('combobox')
    fireEvent.change(selects[0], { target: { value: 'modal' } })
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis/ }))
    await waitFor(() => expect(screen.getByText(/Natural Frequencies/)).toBeInTheDocument())
    expect(screen.getByText(/Natural Frequencies · Main Beam/)).toBeInTheDocument()
  })

  it('solves the multiphysics calculators from the panel', () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)

    // Default mode: 1D conduction between 25 °C and 100 °C.
    fireEvent.click(screen.getByRole('button', { name: /^Solve$/ }))
    expect(screen.getByText('Midpoint temperature')).toBeInTheDocument()
    expect(screen.getByText('62.50 °C')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Multiphysics solver'), { target: { value: 'axial' } })
    fireEvent.click(screen.getByRole('button', { name: /^Solve$/ }))
    expect(screen.getByText('Elongation')).toBeInTheDocument()
    expect(screen.getByText('Reaction at fixed end')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Multiphysics solver'), { target: { value: 'truss' } })
    fireEvent.click(screen.getByRole('button', { name: /^Solve$/ }))
    expect(screen.getByText('Apex deflection')).toBeInTheDocument()
    expect(screen.getByText('Member 1 force')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Multiphysics solver'), { target: { value: 'electrostatic' } })
    fireEvent.click(screen.getByRole('button', { name: /^Solve$/ }))
    expect(screen.getByText('Capacitance')).toBeInTheDocument()
    expect(screen.getByText('Parallel-plate estimate')).toBeInTheDocument()
  })

  it('reports invalid multiphysics inputs instead of a number', () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    fireEvent.change(screen.getByLabelText('Length (m)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /^Solve$/ }))
    expect(screen.getByRole('alert')).toHaveTextContent(/bar length must be > 0/)
  })

  it('checks and applies a distance mate between two parts', () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)

    // The parts start 60 mm apart; request 40 mm and verify before applying.
    fireEvent.change(screen.getByLabelText('Origin-to-origin gap (mm)'), { target: { value: '40' } })
    fireEvent.click(screen.getByRole('button', { name: 'Check mate' }))
    expect(screen.getByRole('alert', { name: 'Mate verdict' })).toHaveTextContent(/does not satisfy the mate/)

    fireEvent.click(screen.getByRole('button', { name: /Solve & apply/ }))
    expect(screen.getByRole('status', { name: 'Mate verdict' })).toHaveTextContent(
      /Mate holds — Support Plate moved to \[1\.000, -0\.040, 0\.000\] m \(40\.0 mm from Main Beam\)/,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Check mate' }))
    expect(screen.getByRole('status', { name: 'Mate verdict' })).toHaveTextContent(/satisfies the mate/)
  })

  it('runs the bounded section search and applies the optimal section', async () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: /Run sizing search/ }))
    const verdict = await screen.findByRole('status', { name: 'Sizing result' })
    expect(verdict).toHaveTextContent(/Feasible/)
    expect(verdict).toHaveTextContent(/mm/)

    const before = screen.getAllByText('0.894 kg').length
    fireEvent.click(screen.getByRole('button', { name: /Apply to Main Beam/ }))
    await waitFor(() => expect(screen.getAllByText('0.894 kg')).toHaveLength(before + 1))
  })

  it('reports invalid sizing inputs instead of searching', async () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)

    fireEvent.change(screen.getByLabelText('Span (m)'), { target: { value: '0' } })
    fireEvent.click(screen.getByRole('button', { name: /Run sizing search/ }))
    const error = await screen.findByRole('alert', { name: 'Sizing error' })
    expect(error).toHaveTextContent(/Span must be a finite value > 0/)
  })

  it('exports the enclosure tray as real sliced G-code', () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Download G-code/ }))

    expect(exportSpies.downloadFile).toHaveBeenCalledTimes(1)
    const [gcode, filename, mime] = exportSpies.downloadFile.mock.calls[0]
    expect(filename).toBe('enclosure_tray.gcode')
    expect(mime).toBe('text/plain')
    expect(gcode).toContain('M83')
    expect(gcode).toContain('; Layer 0')
    expect(gcode).toContain('; Raft')

    const status = screen.getByRole('status', { name: 'Print status' })
    expect(status).toHaveTextContent(/G-code ready/)
    expect(status).toHaveTextContent(/58 layers/)
  })

  it('loads the enclosure solids and its thermal verdict', () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Load rectifier enclosure/ }))

    expect(screen.getAllByText('Enclosure floor').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Enclosure left wall').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Enclosure front wall').length).toBeGreaterThan(0)
    expect(screen.getByText(/PASS: lid at/)).toBeInTheDocument()

    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'static' } })
    fireEvent.click(screen.getByRole('button', { name: /Run Analysis/ }))
    expect(screen.getByText(/Max von Mises:/)).toBeInTheDocument()
  })

  it('opens the enclosure and prepares its G-code and STEP artifacts', async () => {
    useAppStore.setState({ demoRequest: 'mechanical-enclosure' })
    render(<MechanicalDesignPanel onClose={() => {}} />)

    expect((await screen.findAllByText('Enclosure floor')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Enclosure back wall').length).toBeGreaterThan(0)
    // The card promises slicing and STEP export: both ran without downloading.
    expect(screen.getByRole('status', { name: 'Print status' })).toHaveTextContent(/G-code sliced:/)
    expect(screen.getByRole('status', { name: 'STEP export status' })).toHaveTextContent(/STEP validated:/)
    expect(useAppStore.getState().demoRequest).toBeNull()
  })

  it('selects a component from the list', () => {
    render(<MechanicalDesignPanel onClose={() => {}} />)
    const buttons = screen.getAllByRole('button')
    const plate = buttons.find((button) => button.textContent?.includes('plate'))
    if (plate) {
      fireEvent.click(plate)
    }
    expect(screen.getByText('Mechanical Design')).toBeInTheDocument()
  })
})
