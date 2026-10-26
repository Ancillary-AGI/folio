import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AdminConsole from '../components/admin/AdminConsole'
import type { User } from '../types'
import { QUOTA_STORAGE_KEY } from '../lib/admin/quotaPolicy'
import { USAGE_STORAGE_KEY, recordUsage, resetUsageLedger } from '../lib/admin/usageLedger'

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
})
