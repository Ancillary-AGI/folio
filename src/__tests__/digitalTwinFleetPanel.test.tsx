/**
 * The fleet console: registry CRUD, triage views, live thresholds, trends,
 * twin binding and the audit log, all against the real singletons.
 *
 * Two honesty contracts are load-bearing here. A fleet twin carries no sensors,
 * actuators or circuit model, so a sync must say that no physics ran rather than
 * imply the asset was reconciled; and the rectifier proof is the one pass that
 * solves a netlist, so its verdict has to come from the solver. A failed sync
 * must surface the error instead of leaving the previous status on screen.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import DigitalTwinFleetPanel from '../components/digitalTwin/DigitalTwinFleetPanel'
import { digitalTwinService } from '../lib/digitalTwin/digitalTwinService'
import { DEFAULT_THRESHOLDS, iiotFleetManager } from '../lib/iiot/fleetManager'
import { useProjectStore } from '../stores/useProjectStore'

const exportSpies = vi.hoisted(() => ({ downloadFile: vi.fn() }))
vi.mock('../lib/exportUtils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/exportUtils')>()),
  downloadFile: exportSpies.downloadFile,
}))

/** The six stat tiles, in strip order: health, online, degraded, held, alerts, twin. */
const tiles = () => Array.from(document.querySelectorAll('div.text-2xl'), (node) => node.textContent)
const inspected = () =>
  screen.getAllByRole('button', { name: /^Inspect / }).map((button) => button.getAttribute('aria-label'))
const emptyFleet = () => {
  iiotFleetManager.restore({ devices: [], commands: [], history: {}, thresholds: { ...DEFAULT_THRESHOLDS } })
}

describe('DigitalTwinFleetPanel', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    exportSpies.downloadFile.mockClear()
    useProjectStore.setState({ domainDesigns: {} })
    emptyFleet()
    for (const twin of digitalTwinService.getAllDigitalTwins()) digitalTwinService.deleteDigitalTwin(twin.id)
  })

  it('reports the post-sync status and states that no physics ran', async () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Sync twins' }))

    await waitFor(() => expect(screen.getByText(/status online, health 100%/)).toBeInTheDocument())
    expect(screen.getByText(/no physics ran/)).toBeInTheDocument()
    expect(screen.getByText('online', { selector: 'div.text-2xl' })).toBeInTheDocument()
  })

  it('shows the sync error and marks the twin as failed', async () => {
    vi.spyOn(digitalTwinService, 'syncWithPhysicalDevice').mockRejectedValue(new Error('gateway unreachable'))
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Sync twins' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('gateway unreachable'))
    expect(screen.queryByText(/no physics ran/)).not.toBeInTheDocument()
    expect(tiles()[5]).toBe('error')
  })

  it('verifies the rectifier twin through the solver and badges the verdict', async () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Verify rectifier twin' }))

    // The verification runs a real solver pass over the rectifier's HIL cases;
    // on a loaded CI box that outlasts waitFor's 1 s default by far.
    await waitFor(() => expect(screen.getByText('verified', { selector: 'div.text-2xl' })).toBeInTheDocument(), { timeout: 20000 })
    expect(screen.getByText('verified', { selector: 'div.rounded-full' })).toBeInTheDocument()
    expect(screen.getByText(/twin verifies centre and refuses \+2 V drift/)).toBeInTheDocument()
    expect(screen.getByText('2 HIL cases')).toBeInTheDocument()
  })

  it('opens on the seeded fleet with its health, alert feed and detail panel', () => {
    render(<DigitalTwinFleetPanel />)

    expect(screen.getByRole('heading', { name: 'Digital twin & IIoT fleet' })).toBeInTheDocument()
    expect(screen.getByText('5 of 5 shown')).toBeInTheDocument()
    expect(tiles()[0]).toBe('100%')
    expect(tiles()[1]).toBe('5')
    expect(tiles()[4]).toBe('1')
    expect(screen.getByText(/12% battery is under the 15% reserve/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect AGV 07' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByText('24 / 240')).toBeInTheDocument()
  })

  it('searches across name, id, site and firmware and clears back to the whole fleet', () => {
    render(<DigitalTwinFleetPanel />)
    const search = screen.getByLabelText('Search devices by name, id, site or firmware')

    fireEvent.change(search, { target: { value: 'cell-b' } })
    expect(screen.getByText('2 of 5 shown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect Cell B Gateway' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Inspect AGV 07' })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: '2.4.1' } })
    expect(screen.getByText('1 of 5 shown')).toBeInTheDocument()
    expect(inspected()).toEqual(['Inspect Assembly Arm 01'])

    fireEvent.click(screen.getByRole('button', { name: 'Clear the device search' }))
    expect(screen.getByText('5 of 5 shown')).toBeInTheDocument()
  })

  it('composes site, class and status filters and offers a way out of an empty view', () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'line-a' } })
    expect(screen.getByText('3 of 5 shown')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Device class'), { target: { value: 'robot' } })
    expect(screen.getByText('1 of 5 shown')).toBeInTheDocument()
    expect(inspected()).toEqual(['Inspect Assembly Arm 01'])

    fireEvent.click(screen.getByRole('button', { name: /^Alerting/ }))
    expect(screen.getByText('No devices match this view')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(screen.getByText('5 of 5 shown')).toBeInTheDocument()
    expect(screen.getByLabelText('Site')).toHaveValue('all')
  })

  it('sorts by a reading in both directions with a stable order', () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.change(screen.getByLabelText('Sort devices by'), { target: { value: 'temperature' } })
    expect(inspected()).toEqual([
      'Inspect Environment Hub 11', 'Inspect AGV 07', 'Inspect Assembly Arm 01',
      'Inspect Line A PLC', 'Inspect Cell B Gateway',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Sort descending' }))
    expect(inspected()).toEqual([
      'Inspect Cell B Gateway', 'Inspect Line A PLC', 'Inspect Assembly Arm 01',
      'Inspect AGV 07', 'Inspect Environment Hub 11',
    ])
    expect(screen.getByRole('button', { name: 'Sort ascending' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('groups the list by site', () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Group by site' }))
    expect(screen.getByRole('heading', { name: 'cell-b 2' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'line-a 3' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Group by site' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('saves a named view, re-applies it, refuses a duplicate and deletes it', () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'cell-b' } })
    fireEvent.change(screen.getByLabelText('Name for the saved view'), { target: { value: 'Cell B' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save view' }))
    expect(screen.getByRole('button', { name: 'Cell B' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name for the saved view')).toHaveValue('')

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'all' } })
    expect(screen.getByText('5 of 5 shown')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cell B' }))
    expect(screen.getByText('2 of 5 shown')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Name for the saved view'), { target: { value: 'Same filters' } })
    expect(screen.getByRole('button', { name: 'Save view' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete the saved view Cell B' }))
    expect(screen.getByText('None yet.')).toBeInTheDocument()
  })

  it('holds and resumes the whole shown fleet in bulk', () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByLabelText('Select all shown'))
    expect(screen.getByText('5 selected')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }))
    expect(tiles()[3]).toBe('5')
    expect(screen.getByRole('button', { name: 'Resume Assembly Arm 01' })).toBeInTheDocument()
    expect(iiotFleetManager.getCommands().filter((entry) => entry.command === 'maintenance')).toHaveLength(5)

    fireEvent.click(screen.getByLabelText('Select all shown'))
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(tiles()[1]).toBe('5')
    expect(tiles()[3]).toBe('0')
  })

  it('registers a device through the dialog and refuses an id that already exists', () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Add device' }))
    const dialog = screen.getByRole('dialog', { name: 'Register a device' })
    expect(within(dialog).getByRole('button', { name: 'Register device' })).toBeDisabled()
    expect(within(dialog).getByText('Device name is required.')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Device id'), { target: { value: 'arm-01' } })
    expect(within(dialog).getByText('Device id "arm-01" is already registered.')).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText('Device id'), { target: { value: 'press-01' } })
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Press 01' } })
    fireEvent.change(within(dialog).getByLabelText('Site'), { target: { value: 'line-c' } })
    fireEvent.change(within(dialog).getByLabelText('Firmware'), { target: { value: '0.1.0' } })
    fireEvent.change(within(dialog).getByLabelText('Temperature'), { target: { value: '55' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Register device' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('6 of 6 shown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Inspect Press 01' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('heading', { name: 'Press 01' })).toBeInTheDocument()
    expect(screen.getByText('1 / 240')).toBeInTheDocument()
  })

  it('edits identity and site while keeping the id immutable', () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit AGV 07' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit AGV 07' })
    expect(within(dialog).getByLabelText('Device id')).toBeDisabled()
    expect(within(dialog).getByLabelText('Device id')).toHaveValue('agv-07')

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'AGV 07-B' } })
    fireEvent.change(within(dialog).getByLabelText('Site'), { target: { value: 'line-z' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save device' }))

    expect(screen.getByRole('button', { name: 'Inspect AGV 07-B' })).toBeInTheDocument()
    expect(iiotFleetManager.getDevice('agv-07')?.site).toBe('line-z')
    expect(iiotFleetManager.historyOf('agv-07')).toHaveLength(25)
  })

  it('asks before removing, then puts the device and its trend back on undo', async () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Remove AGV 07' }))
    let dialog = screen.getByRole('dialog', { name: 'Remove "AGV 07"?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('5 of 5 shown')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove AGV 07' }))
    dialog = screen.getByRole('dialog', { name: 'Remove "AGV 07"?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove device' }))

    await waitFor(() => expect(screen.getByText('4 of 4 shown')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: 'Inspect AGV 07' })).not.toBeInTheDocument()
    expect(screen.getByText('1 device removed. The trend went with them.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo remove' }))
    expect(screen.getByText('5 of 5 shown')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Inspect AGV 07' }))
    expect(screen.getByText('24 / 240')).toBeInTheDocument()
  })

  it('re-judges the fleet the moment a threshold parses and refuses a non-number', () => {
    render(<DigitalTwinFleetPanel />)
    const limit = screen.getByLabelText('Temperature', { selector: '#fleet-limit-temp' })

    fireEvent.change(limit, { target: { value: '40' } })
    expect(tiles()[2]).toBe('3')
    expect(tiles()[4]).toBe('4')
    expect(screen.getAllByText(/41 °C is over the 40 °C limit/)[0]).toBeInTheDocument()
    expect(iiotFleetManager.getDevice('arm-01')?.status).toBe('degraded')

    fireEvent.change(limit, { target: { value: 'abc' } })
    expect(screen.getByText('Use a number between -40 and 250.')).toBeInTheDocument()
    expect(iiotFleetManager.getThresholds().temperatureC).toBe(40)

    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }))
    expect(tiles()[2]).toBe('0')
    expect(limit).toHaveValue('85')
  })

  it('ingests a sample into the trend and degrades the device on a critical reading', () => {
    render(<DigitalTwinFleetPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Assembly Arm 01' }))
    expect(screen.getByText('24 / 240')).toBeInTheDocument()

    const temperature = screen.getByLabelText('Temperature', { selector: '#ingest-temp-arm-01' })
    fireEvent.change(temperature, { target: { value: '' } })
    expect(screen.getByRole('button', { name: 'Ingest sample' })).toBeDisabled()

    fireEvent.change(temperature, { target: { value: '90' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ingest sample' }))

    expect(screen.getByText('25 / 240')).toBeInTheDocument()
    expect(screen.getAllByText(/90 °C is over the 85 °C limit/)[0]).toBeInTheDocument()
    expect(iiotFleetManager.getDevice('arm-01')?.status).toBe('degraded')
    expect(screen.getAllByText('90.0 °C')[0]).toBeInTheDocument()
  })

  it('switches trend channel and says plainly when a device reports none of it', () => {
    render(<DigitalTwinFleetPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Line A PLC' }))

    fireEvent.click(screen.getByRole('button', { name: 'Battery' }))
    expect(screen.getByText('This device reports no battery samples yet.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Temperature' }))
    expect(screen.getByRole('figure', { name: 'Line A PLC Temperature history, 24 samples' })).toBeInTheDocument()
    expect(screen.getAllByText('48.0 °C')[0]).toBeInTheDocument()
  })

  it('creates, synchronizes and deletes the twin bound to a device', async () => {
    render(<DigitalTwinFleetPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Assembly Arm 01' }))
    expect(screen.getByText(/No twin is bound\./)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create twin' }))
    const twinId = iiotFleetManager.getDevice('arm-01')?.twinId
    expect(twinId).toBeTruthy()
    expect(screen.getByText('0 sensors, 0 actuators, 0 model components.', { exact: false })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sync this twin' }))
    await waitFor(() => expect(screen.getByText(/no physics ran/)).toBeInTheDocument())
    expect(digitalTwinService.getDigitalTwin(twinId as string)?.status).toBe('online')

    fireEvent.click(screen.getByRole('button', { name: 'Delete twin' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete the twin bound to "Assembly Arm 01"?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete twin' }))

    await waitFor(() => expect(screen.getByText(/No twin is bound\./)).toBeInTheDocument())
    expect(digitalTwinService.getDigitalTwin(twinId as string)).toBeUndefined()
    expect(iiotFleetManager.getDevice('arm-01')?.twinId).toBeUndefined()
  })

  it('offers to recreate a binding whose twin is not in this session', () => {
    iiotFleetManager.registerDevice({
      id: 'press-01', name: 'Press 01', type: 'plc', site: 'line-c', firmware: '1.0.0',
      telemetry: { temperature: 40, cpuLoad: 20, latencyMs: 10 }, twinId: 'ghost-twin',
    })
    render(<DigitalTwinFleetPanel />)

    expect(screen.getByText(/twins are not saved with the project/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Recreate twin' }))
    expect(screen.getByRole('button', { name: 'Sync this twin' })).toBeInTheDocument()
    expect(iiotFleetManager.getDevice('press-01')?.twinId).not.toBe('ghost-twin')
  })

  it('logs an issued command with its note and clears the log only on confirmation', async () => {
    render(<DigitalTwinFleetPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Inspect Assembly Arm 01' }))
    expect(screen.getByText(/Nothing issued yet\./)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'restart' } })
    expect(screen.getByText(/the device does not actually reboot/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Command note'), { target: { value: 'bearing check' } })
    fireEvent.click(screen.getByRole('button', { name: 'Issue to arm-01' }))

    expect(screen.getByText('“bearing check”')).toBeInTheDocument()
    expect(screen.getByText(/1 command issued to this device/)).toBeInTheDocument()
    expect(screen.getByLabelText('Command note')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'Clear log' }))
    const dialog = screen.getByRole('dialog', { name: 'Clear the command log?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear log' }))
    await waitFor(() => expect(screen.getByText(/Nothing issued yet\./)).toBeInTheDocument())
    expect(iiotFleetManager.getCommands()).toHaveLength(0)
  })

  it('exports the registry as JSON and only the shown rows as CSV', () => {
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Fleet JSON' }))
    const [json, jsonName] = exportSpies.downloadFile.mock.calls[0]
    expect(jsonName).toBe('iiot-fleet.json')
    const parsed = JSON.parse(json as string)
    expect(parsed.devices).toHaveLength(5)
    expect(parsed.history['arm-01']).toHaveLength(24)
    expect(parsed.thresholds).toEqual(DEFAULT_THRESHOLDS)

    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'cell-b' } })
    fireEvent.click(screen.getByRole('button', { name: 'CSV' }))
    const [csv, csvName] = exportSpies.downloadFile.mock.calls[1]
    expect(csvName).toBe('iiot-fleet.csv')
    const rows = (csv as string).split(/\r?\n/).filter(Boolean)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatch(/^id,name,type,site,firmware,status/)
    expect(rows.some((r) => r.includes('gw-cell-b'))).toBe(true)
    expect(rows.some((r) => r.includes('env-11'))).toBe(true)
  })

  it('carries the registry and the view through a remount', () => {
    const first = render(<DigitalTwinFleetPanel />)
    fireEvent.click(screen.getByRole('button', { name: 'Hold Assembly Arm 01' }))
    fireEvent.change(screen.getByLabelText('Site'), { target: { value: 'cell-b' } })
    first.unmount()

    render(<DigitalTwinFleetPanel />)
    expect(screen.getByLabelText('Site')).toHaveValue('cell-b')
    expect(screen.getByText('2 of 5 shown')).toBeInTheDocument()
    expect(iiotFleetManager.getDevice('arm-01')?.status).toBe('maintenance')
    expect(iiotFleetManager.historyOf('arm-01')).toHaveLength(24)
  })

  it('keeps a deliberately emptied registry empty and seeds the demo only on request', () => {
    useProjectStore.setState({
      domainDesigns: {
        'iiot-fleet': { devices: [], commands: [], history: {}, thresholds: { ...DEFAULT_THRESHOLDS } },
      },
    })
    render(<DigitalTwinFleetPanel />)

    expect(screen.getByText('The registry is empty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fleet JSON' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'CSV' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Load demo fleet' }))
    expect(screen.getByText('5 of 5 shown')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fleet JSON' })).toBeEnabled()
  })

  it('refuses to synchronize a twin when the registry is empty', async () => {
    useProjectStore.setState({
      domainDesigns: {
        'iiot-fleet': { devices: [], commands: [], history: {}, thresholds: { ...DEFAULT_THRESHOLDS } },
      },
    })
    render(<DigitalTwinFleetPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Sync twins' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('The registry is empty.'))
    expect(tiles()[5]).toBe('error')
  })
})