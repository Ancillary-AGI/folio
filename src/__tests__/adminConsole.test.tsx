import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AdminConsole from '../components/admin/AdminConsole'
import type { User } from '../types'
import { QUOTA_STORAGE_KEY } from '../lib/admin/quotaPolicy'
import { USAGE_STORAGE_KEY, getUsageEvents, recordUsage, resetUsageLedger } from '../lib/admin/usageLedger'

const owner: User = { id: 'owner-1', name: 'Local User', email: 'local@offline', role: 'owner' }

beforeEach(() => {
  localStorage.clear()
  resetUsageLedger()
})

describe('AdminConsole (local owner)', () => {
  it('renders the overview and records the open in the ledger', async () => {
    render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)

    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument()
    expect(screen.getByText('This device · local owner')).toBeInTheDocument()
    expect(screen.getByText('Local only')).toBeInTheDocument()

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) ?? '[]') as Array<{ kind: string }>
      expect(stored.some((event) => event.kind === 'admin.open')).toBe(true)
    })
  })

  it('shows the single local owner and labels invitations as cloud-only', async () => {
    render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Administration' })

    fireEvent.click(screen.getByRole('tab', { name: 'People' }))
    expect(await screen.findByText('Local User (you)')).toBeInTheDocument()
    expect(screen.getByText('local@offline')).toBeInTheDocument()
    expect(screen.getByText('Managed in cloud')).toBeInTheDocument()
    expect(screen.getByText(/Invitations need Supabase's server-side admin API/)).toBeInTheDocument()
  })

  it('lists recorded usage and filters by kind', async () => {
    recordUsage('export.run', owner.id, { format: 'netlist' }, Date.now())
    render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Administration' })

    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }))
    expect(await screen.findByRole('heading', { name: 'Usage' })).toBeInTheDocument()
    expect(screen.getAllByText('Export produced').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/netlist/).length).toBeGreaterThan(0)
  })

  it('saves an engineer policy and applies it to the stored limits', async () => {
    render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Administration' })

    fireEvent.click(screen.getByRole('tab', { name: 'Quotas' }))
    const input = await screen.findByLabelText('Engineer Projects limit')
    fireEvent.change(input, { target: { value: '7' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save policy' })[0])

    expect(await screen.findByText('Policy saved and audited.')).toBeInTheDocument()
    const stored = JSON.parse(localStorage.getItem(QUOTA_STORAGE_KEY) ?? '{}') as {
      engineer?: { maxProjects?: number }
    }
    expect(stored.engineer?.maxProjects).toBe(7)
  })

  it('rejects a negative limit without saving', async () => {
    render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Administration' })

    fireEvent.click(screen.getByRole('tab', { name: 'Quotas' }))
    const input = await screen.findByLabelText('Viewer Exports / day limit')
    fireEvent.change(input, { target: { value: '-5' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save policy' })[1])

    expect(await screen.findByText('Enter zero or a positive number, or leave blank for unlimited.')).toBeInTheDocument()
    expect(localStorage.getItem(QUOTA_STORAGE_KEY)).toBeNull()
  })

  it('describes the local environment honestly', async () => {
    render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Administration' })

    fireEvent.click(screen.getByRole('tab', { name: 'Environment' }))
    expect(await screen.findByText('Local device')).toBeInTheDocument()
    expect(screen.getByText('No Supabase credentials; all data stays in this browser.')).toBeInTheDocument()
    expect(screen.getByText('Local runner only')).toBeInTheDocument()
    expect(screen.getByText('Not applicable')).toBeInTheDocument()
    expect(screen.getByText(/Invite accounts: server function required/)).toBeInTheDocument()
  })

  it('returns to the workbench through the back control', async () => {
    const onBack = vi.fn()
    render(<AdminConsole user={owner} offlineMode onBack={onBack} />)
    await screen.findByRole('heading', { name: 'Administration' })

    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }))
    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('downloads the visible usage rows as a CSV file', async () => {
    recordUsage('export.run', owner.id, { format: 'netlist' }, Date.now())
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    const createObjectURL = vi.fn(() => 'blob:usage')
    const revokeObjectURL = vi.fn()
    URL.createObjectURL = createObjectURL
    URL.revokeObjectURL = revokeObjectURL
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
      await screen.findByRole('heading', { name: 'Administration' })
      fireEvent.click(screen.getByRole('tab', { name: 'Usage' }))

      fireEvent.click(await screen.findByRole('button', { name: 'CSV' }))
      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(click).toHaveBeenCalledTimes(1)
      // The object URL is released after the browser has taken the download.
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:usage'))
    } finally {
      click.mockRestore()
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
    }
  })

  it('names the whole ledger before clearing it, including rows outside the window', async () => {
    // One event is older than the default 14-day window: the confirmation must
    // describe what the action deletes, not just what the table happens to show.
    recordUsage('export.run', owner.id, { format: 'netlist' }, Date.now() - 40 * 24 * 3600 * 1000)
    recordUsage('simulation.run', owner.id, {}, Date.now())
    render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
    await screen.findByRole('heading', { name: 'Administration' })
    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }))

    expect(await screen.findByText(/removes all 3 recorded events/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: "Clear this device's ledger" }))
    fireEvent.click(screen.getByRole('button', { name: /clear all 3 events/i }))

    await waitFor(() => expect(getUsageEvents()).toHaveLength(0))
    fireEvent.click(screen.getByRole('tab', { name: 'Audit trail' }))
    expect(await screen.findByText('admin:usage_cleared')).toBeInTheDocument()
  })

  it('reports storage as unavailable instead of zero when the browser offers no estimate', async () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, 'storage')
    Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
    try {
      render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
      await screen.findByRole('heading', { name: 'Administration' })
      fireEvent.click(screen.getByRole('tab', { name: 'Quotas' }))

      expect(await screen.findByText('Unavailable')).toBeInTheDocument()
      expect(screen.getByText(/did not report a storage estimate/)).toBeInTheDocument()
    } finally {
      if (originalStorage) Object.defineProperty(navigator, 'storage', originalStorage)
      else Object.defineProperty(navigator, 'storage', { value: undefined, configurable: true })
    }
  })

  it('warns when the browser refuses to persist the usage ledger', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    try {
      render(<AdminConsole user={owner} offlineMode onBack={vi.fn()} />)
      await screen.findByRole('heading', { name: 'Administration' })
      fireEvent.click(screen.getByRole('tab', { name: 'Usage' }))

      expect(await screen.findByText(/lives in memory only/)).toBeInTheDocument()
      fireEvent.click(screen.getByRole('tab', { name: 'Environment' }))
      expect(await screen.findByText(/Stored in memory only/)).toBeInTheDocument()
    } finally {
      setItem.mockRestore()
      resetUsageLedger()
    }
  })
})
