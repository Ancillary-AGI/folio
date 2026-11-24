/**
 * HIL panel: the suite is authored, validated and run live.
 *
 * Two rigs are exercised for real. The circuit twin solves the reference
 * rectifier, so a verdict carries a measured voltage and a signed delta; the
 * bench rig has no hardware attached and must refuse closed rather than report
 * a pass. Editing, filtering, deletion with confirmation and undo, and project
 * persistence all go through the same state the engineer sees.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import HILTestingPanel from '../components/hil/HILTestingPanel'
import { ArduinoIDEIntegration } from '../lib/programming/boardProgrammer'
import { useProjectStore } from '../stores/useProjectStore'

const runSuite = () => fireEvent.click(screen.getByRole('button', { name: 'Run HIL suite' }))

describe('HILTestingPanel', () => {
  beforeEach(() => {
    useProjectStore.setState({ domainDesigns: {}, components: [], wires: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens populated with the reference suite, a rig choice and interface switches', () => {
    render(<HILTestingPanel />)
    expect(screen.getByRole('heading', { name: 'Hardware-in-the-loop' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run HIL suite' })).toBeEnabled()
    expect(screen.getByLabelText('Run against')).toHaveValue('twin')
    expect(screen.getByRole('button', { name: 'Analog' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'CAN' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText('rectifier-out-high')).toBeInTheDocument()
    expect(screen.getByText('rectifier-out-blocked')).toBeInTheDocument()
    expect(screen.getByText(/2 cases coherent/)).toBeInTheDocument()
    expect(screen.getByText(/Drive nets:/).parentElement).toHaveTextContent('SRC')
  })

  it('solves the rectifier against the twin and reports the measured drop, not the assertion', async () => {
    render(<HILTestingPanel />)
    runSuite()
    await waitFor(() => expect(screen.getByText(/1\/2 passed in/)).toBeInTheDocument())
    // The hand estimate ignores the 10 Ω source resistor: the twin measures ~4.15 V.
    await waitFor(() => expect(screen.getByText(/outside ±0\.1 V/)).toBeInTheDocument())
    const row = screen.getByRole('row', { name: /analog OUT/ })
    expect(within(row).getByText(/^4\.\d{2,} V$/)).toBeInTheDocument()
    expect(within(row).getByText(/^-0\.\d+ V$/)).toBeInTheDocument()
    expect(screen.getByText(/against Circuit twin/)).toBeInTheDocument()
  })

  it('passes both cases once the acceptance band is widened to cover the real drop', async () => {
    render(<HILTestingPanel />)
    fireEvent.change(
      screen.getByLabelText('rectifier-out-high assertion analog 1 tolerance volts'),
      { target: { value: '0.5' } },
    )
    runSuite()
    await waitFor(() => expect(screen.getByText(/2\/2 passed in/)).toBeInTheDocument())
    expect(screen.queryByText(/outside ±/)).not.toBeInTheDocument()
  })

  it('refuses closed on the bench rig instead of inventing a measurement', async () => {
    render(<HILTestingPanel />)
    fireEvent.change(screen.getByLabelText('Run against'), { target: { value: 'bench' } })
    expect(screen.getByText(/No bench interface is attached/)).toBeInTheDocument()
    runSuite()
    await waitFor(() => expect(screen.getByText(/0\/2 passed in/)).toBeInTheDocument())
    await waitFor(() => expect(screen.getAllByText(/requires connected hardware/)[0]).toBeInTheDocument())
  })

  it('locks the run button while a pass is in flight', () => {
    const spy = vi.spyOn(ArduinoIDEIntegration, 'setupHILTest').mockImplementation(() => new Promise(() => {}))
    render(<HILTestingPanel />)
    runSuite()
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled()
    spy.mockRestore()
  })

  it('surfaces a bridge failure instead of hanging', async () => {
    const spy = vi.spyOn(ArduinoIDEIntegration, 'setupHILTest').mockRejectedValue(new Error('no hardware'))
    render(<HILTestingPanel />)
    runSuite()
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('no hardware'))
    spy.mockRestore()
  })

  it('runs a single case without disturbing the others', async () => {
    render(<HILTestingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Run case rectifier-out-blocked' }))
    await waitFor(() => expect(screen.getByText(/1\/1 passed in/)).toBeInTheDocument())
    expect(screen.getByText('Enabled, not run')).toBeInTheDocument()
  })

  it('adds a case, refuses it while empty, then accepts authored channels', async () => {
    render(<HILTestingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Add case' }))
    expect(screen.getByLabelText('Case id')).toHaveValue('case-3')
    expect(screen.getAllByText(/declares no stimulus and no assertion/)[0]).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run HIL suite' })).toBeEnabled()

    fireEvent.change(screen.getByLabelText('Case id'), { target: { value: 'rail-low' } })
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Rail at 3 V' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add net' })[0])
    const nets = screen.getAllByLabelText(/rail-low stimulus analog 1 net/)
    fireEvent.change(nets[0], { target: { value: 'SRC' } })
    fireEvent.change(screen.getByLabelText('rail-low stimulus analog 1 volts'), { target: { value: '3' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add net' })[1])
    fireEvent.change(screen.getByLabelText('rail-low assertion analog 1 net'), { target: { value: 'OUT' } })
    fireEvent.change(screen.getByLabelText('rail-low assertion analog 1 volts'), { target: { value: '2.5' } })
    fireEvent.change(screen.getByLabelText('rail-low assertion analog 1 tolerance volts'), { target: { value: '0.5' } })

    await waitFor(() => expect(screen.getByText(/3 cases coherent/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Run this case' }))
    await waitFor(() => expect(screen.getByText(/1\/1 passed in/)).toBeInTheDocument())
    const row = screen.getByRole('row', { name: /analog OUT/ })
    expect(within(row).getByText(/^2\.\d{2,} V$/)).toBeInTheDocument()
  })

  it('blocks the suite when the interface a case uses is switched off', () => {
    render(<HILTestingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Analog' }))
    expect(screen.getByRole('button', { name: 'Analog' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getAllByText(/uses ANALOG I\/O but that interface is switched off/)[0]).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run HIL suite' })).toBeDisabled()
  })

  it('deletes a case only after confirmation, and undo puts it back', async () => {
    render(<HILTestingPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete case rectifier-out-blocked' }))
    expect(screen.getByRole('heading', { name: 'Delete "rectifier-out-blocked"?' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('rectifier-out-blocked')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete case rectifier-out-blocked' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete case' }))
    await waitFor(() => expect(screen.queryByText('rectifier-out-blocked')).not.toBeInTheDocument())
    expect(screen.getByText(/1 case deleted/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Undo delete' }))
    expect(screen.getByText('rectifier-out-blocked')).toBeInTheDocument()
  })

  it('filters and searches the case list', async () => {
    render(<HILTestingPanel />)
    runSuite()
    await waitFor(() => expect(screen.getByText(/1\/2 passed in/)).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Failed' }))
    expect(screen.getByText('rectifier-out-high')).toBeInTheDocument()
    expect(screen.queryByText('rectifier-out-blocked')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Passed' }))
    expect(screen.queryByText('rectifier-out-high')).not.toBeInTheDocument()
    expect(screen.getByText('rectifier-out-blocked')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    fireEvent.change(screen.getByLabelText('Search test cases'), { target: { value: 'negative' } })
    expect(screen.queryByText('rectifier-out-high')).not.toBeInTheDocument()
    expect(screen.getByText('rectifier-out-blocked')).toBeInTheDocument()
  })

  it('enables export only once there is a verdict to export', async () => {
    render(<HILTestingPanel />)
    expect(screen.getByRole('button', { name: /Suite JSON/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Verdict CSV/ })).toBeDisabled()
    runSuite()
    await waitFor(() => expect(screen.getByRole('button', { name: /Verdict CSV/ })).toBeEnabled())
    expect(screen.getByRole('button', { name: /Suite JSON/ })).toBeEnabled()
  })

  it('mirrors the suite into the project so a save or checkout carries it', async () => {
    render(<HILTestingPanel />)
    fireEvent.change(screen.getByLabelText('Case id'), { target: { value: 'renamed-case' } })
    await waitFor(() => {
      const saved = useProjectStore.getState().domainDesigns['hil-suite'] as { cases: Array<{ id: string }> }
      expect(saved.cases[0].id).toBe('renamed-case')
    })
  })

  it('adopts a design restored from the project store', async () => {
    render(<HILTestingPanel />)
    fireEvent.change(screen.getByLabelText('Sampling'), { target: { value: '2000' } })
    await waitFor(() => {
      const saved = useProjectStore.getState().domainDesigns['hil-suite'] as { samplingHz: string }
      expect(saved.samplingHz).toBe('2000')
    })
    // A checkout writes the bag directly; the mounted panel must adopt it.
    const saved = useProjectStore.getState().domainDesigns['hil-suite'] as Record<string, unknown>
    useProjectStore.getState().setDomainDesign('hil-suite', { ...saved, samplingHz: '4000' })
    await waitFor(() => expect(screen.getByLabelText('Sampling')).toHaveValue('4000'))
  })
})