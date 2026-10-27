/**
 * Gallery scenarios that used to only open a workspace.
 *
 * Each test asks the panel for its one-shot demo request and asserts the
 * engine actually ran: the device lab reports measured model output, the
 * imaging panel stages an image and a boot verdict, the plugin marketplace
 * shows a manifest and installs through the permission gate, and the design
 * marketplace surfaces its publish round-trip verdict.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import ICDesignPanel from '../components/ecad/ICDesignPanel'
import PiImagingPanel from '../components/programming/PiImagingPanel'
import PluginMarketplace from '../components/ecad/PluginMarketplace'
import MarketplacePanel from '../components/marketplace/MarketplacePanel'
import { useAppStore } from '../stores/useAppStore'

beforeEach(() => {
  useAppStore.setState({ demoRequest: null })
})

afterEach(cleanup)

describe('gallery scenarios reach their engines', () => {
  it('runs all four device-lab models and leaves flash semantics visible', async () => {
    useAppStore.setState({ demoRequest: 'ic-device-lab' })
    render(<ICDesignPanel />)

    const report = await screen.findByRole('status', { name: 'Device lab demo report' })
    expect(report).toHaveTextContent(/74HC595: shifted 0xA6 LSB-first/)
    expect(report).toHaveTextContent(/74HC165: parallel-loaded 0x65/)
    expect(report).toHaveTextContent(/74HC138: CBA=101 .* selects Y5/)
    expect(report).toHaveTextContent(/W25Q128JV: sector erase 4096 bytes in 400 ms/)

    expect(screen.getByLabelText('Logic / memory part')).toHaveValue('flash-w25q128')
    expect(screen.getByText(/0x5a, then 0xf0 → 0x50/)).toBeInTheDocument()
    expect(useAppStore.getState().demoRequest).toBeNull()
  })

  it('stages an image plan and a passing boot contract without claiming a flash', async () => {
    useAppStore.setState({ demoRequest: 'imaging-pipeline' })
    render(<PiImagingPanel onClose={() => {}} />)

    expect(await screen.findByRole('status', { name: 'Imaging demo status' })).toHaveTextContent(
      /No device was written/,
    )
    expect(await screen.findByText(/4 chunks planned/)).toBeInTheDocument()
    expect(screen.getByText(/#0 type 0x0c/)).toBeInTheDocument()
    expect(screen.getByText(/#1 type 0x83/)).toBeInTheDocument()
    expect(screen.getByText('Boot contract satisfied')).toBeInTheDocument()
    // The daemon is still offline: the demo must not enable a real flash.
    expect(screen.getByText('Daemon offline')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Flash via companion' })).toBeDisabled()
    expect(useAppStore.getState().demoRequest).toBeNull()
  })

  it('shows manifest permissions and installs a local plugin through the gate', async () => {
    useAppStore.setState({ demoRequest: 'plugins-permissions' })
    render(<PluginMarketplace />)

    const status = await screen.findByRole('status', { name: 'Plugin demo status' })
    expect(status).toHaveTextContent(/Installed KiCad Project Import: manifest validated/)
    expect(status).toHaveTextContent(/ui:panels, read:circuit/)
    expect(status).toHaveTextContent(/cover 1 declared tool\(s\)/)
    // Installing records the package; the panel must not claim a tool executed.
    expect(status).toHaveTextContent(/Installing records the package/)
    expect(screen.getByText('Declared permissions (2)')).toBeInTheDocument()
    expect(screen.getByText(/^ui:panels/)).toBeInTheDocument()
    expect(screen.getByText(/Lifecycle:/)).toBeInTheDocument()
    expect(screen.getByText(/Installed locally/)).toBeInTheDocument()
    expect(useAppStore.getState().demoRequest).toBeNull()
  })

  it('surfaces the publish/install round-trip verdict', async () => {
    useAppStore.setState({ demoRequest: 'marketplace-bundle' })
    render(<MarketplacePanel />)

    const verdict = await screen.findByRole('status', { name: 'Publish verdict' })
    expect(verdict).toHaveTextContent(/PASS: "Half-Wave Rectifier Kit \(tested\)"/)
    expect(verdict).toHaveTextContent(/6 parts/)
    expect(verdict).toHaveTextContent(/round-trip byte-identical/)
    expect(useAppStore.getState().demoRequest).toBeNull()
  })
})
