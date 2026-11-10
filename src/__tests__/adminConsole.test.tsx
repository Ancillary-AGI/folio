import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AdminConsole from '../admin/AdminConsole'
import type { Account, AdminApi, AuditEntry, DeploymentInfo, MutationResult } from '../lib/admin/adminService'
import type { Operator } from '../lib/admin/operatorSession'
import { DEFAULT_QUOTA_POLICIES, type AdminRole, type QuotaLimits } from '../lib/admin/quotaPolicy'
import type { UsageEvent } from '../lib/admin/usageLedger'

/*
 * The console is tested against a stand-in for the deployment, not against this
 * browser's storage. Every number it shows must come from the reads it made, so
 * the fake keeps mutable state: a role change is visible on the reload that
 * follows it, exactly as it is against Postgres.
 */

const operator: Operator = { id: 'op-1', name: 'Ada Okoro', email: 'ada@folio.team', role: 'owner' }
const administrator: Operator = { ...operator, id: 'op-2', name: 'Ben Mensah', email: 'ben@folio.team', role: 'admin' }

const NOW = Date.now()
const DAY = 24 * 3600 * 1000

function seedAccounts(): Account[] {
  return [
    { id: 'op-1', name: 'Ada Okoro', email: 'ada@folio.team', role: 'owner', status: 'active' },
    { id: 'op-2', name: 'Ben Mensah', email: 'ben@folio.team', role: 'admin', status: 'active' },
    { id: 'eng-1', name: 'Chidi Eze', email: 'chidi@studio.dev', role: 'engineer', status: 'active' },
    { id: 'vw-1', name: 'Dana Ali', email: 'dana@studio.dev', role: 'viewer', status: 'active' },
    { id: 'un-1', name: 'Efe Bello', email: 'efe@studio.dev', role: 'user', status: 'active' },
    { id: 'sus-1', name: 'Femi Cole', email: 'femi@studio.dev', role: 'engineer', status: 'suspended' },
  ]
}

function seedEvents(): UsageEvent[] {
  return [
    { id: 'u1', at: NOW, user: 'eng-1', kind: 'export.run', detail: { format: 'gerber' } },
    { id: 'u2', at: NOW - 1000, user: 'eng-1', kind: 'export.run' },
    { id: 'u3', at: NOW - 2000, user: 'eng-1', kind: 'simulation.run', detail: { solver: 'spice' } },
    { id: 'u4', at: NOW - 3000, user: 'eng-1', kind: 'workspace.open', detail: { mode: 'mechanical' } },
    { id: 'u5', at: NOW - 4000, user: 'vw-1', kind: 'workspace.open', detail: { mode: 'schematic' } },
    { id: 'u6', at: NOW - 5000, user: 'vw-1', kind: 'export.run' },
    { id: 'u7', at: NOW - 6000, user: 'op-1', kind: 'admin.open' },
    { id: 'u8', at: NOW - 7000, user: 'un-1', kind: 'project.create' },
    { id: 'u9', at: NOW - 40 * DAY, user: 'eng-1', kind: 'workspace.open', detail: { mode: 'rf' } },
  ]
}

function seedAudit(): AuditEntry[] {
  return [
    { id: 'a1', at: NOW - 10_000, actor: 'op-1', action: 'admin:role_change', resource: 'eng-1', details: { role: 'engineer' } },
    { id: 'a2', at: NOW - 20_000, actor: 'op-2', action: 'admin:quota_policy', resource: 'viewer', details: { maxProjects: 3 } },
    { id: 'a3', at: NOW - 30_000, actor: 'op-1', action: 'admin:open', resource: 'admin-console', details: { role: 'owner' } },
  ]
}

const stats = {
  projects: 412,
  projectsByRole: { engineer: 300, viewer: 90, owner: 22 },
  accounts: 6,
  activeAccounts: 5,
  suspendedAccounts: 1,
  operatorAccounts: 2,
  usageEvents: 1840,
  auditEvents: 37,
  exportsToday: 12,
  simulationsToday: 8,
}

interface Overrides {
  accounts?: Account[]
  events?: UsageEvent[]
  policies?: Record<AdminRole, QuotaLimits>
  audit?: AuditEntry[]
  deployment?: DeploymentInfo
  accountsError?: string
  usageError?: string
  policyError?: string
  auditError?: string
  truncated?: boolean
  roleResult?: MutationResult
  statusResult?: MutationResult
  policyResult?: MutationResult
}

function fakeApi(overrides: Overrides = {}) {
  let accounts = overrides.accounts ?? seedAccounts()
  let policies = overrides.policies ?? { ...DEFAULT_QUOTA_POLICIES }
  const events = overrides.events ?? seedEvents()
  const audit = overrides.audit ?? seedAudit()
  const calls = {
    recordOpen: vi.fn(async () => {}),
    listAccounts: vi.fn(async () => ({
      accounts: overrides.accountsError ? [] : [...accounts],
      error: overrides.accountsError,
    })),
    loadUsage: vi.fn(async (days: number) => ({
      events: overrides.usageError ? [] : events.filter((event) => event.at >= NOW - days * DAY),
      truncated: overrides.truncated ?? false,
      error: overrides.usageError,
    })),
    loadPolicies: vi.fn(async () => ({ policies: { ...policies }, error: overrides.policyError })),
    loadAudit: vi.fn(async () => ({ entries: overrides.auditError ? [] : [...audit], error: overrides.auditError })),
    loadDeployment: vi.fn(async (): Promise<DeploymentInfo> => overrides.deployment ?? {
      host: 'folio.supabase.co',
      agentRunnerConfigured: true,
      stats,
    }),
    setRole: vi.fn(async (id: string, role: AdminRole): Promise<MutationResult> => {
      if (overrides.roleResult) return overrides.roleResult
      accounts = accounts.map((account) => (account.id === id ? { ...account, role } : account))
      return { ok: true }
    }),
    setStatus: vi.fn(async (id: string, status: Account['status']): Promise<MutationResult> => {
      if (overrides.statusResult) return overrides.statusResult
      accounts = accounts.map((account) => (account.id === id ? { ...account, status } : account))
      return { ok: true }
    }),
    savePolicy: vi.fn(async (role: AdminRole, limits: QuotaLimits): Promise<MutationResult> => {
      if (overrides.policyResult) return overrides.policyResult
      policies = { ...policies, [role]: { ...limits } }
      return { ok: true }
    }),
  }
  const api: AdminApi = calls
  return { api, calls }
}

async function open(overrides: Overrides = {}, principal: Operator = operator) {
  const { api, calls } = fakeApi(overrides)
  const onSignOut = vi.fn()
  render(<AdminConsole operator={principal} api={api} onSignOut={onSignOut} />)
  await screen.findByRole('heading', { name: 'Admin console' })
  return { api, calls, onSignOut }
}

function row(name: string): HTMLElement {
  const cell = screen.getByText(name, { selector: 'p' }).closest('tr')
  if (!cell) throw new Error(`No table row for ${name}`)
  return cell
}

/** The number a KPI card is reporting, read from the card rather than the page. */
function kpiValue(label: string): string {
  const card = screen.getByText(label, { selector: 'span' }).closest('.rounded-lg')
  if (!card) throw new Error(`No KPI card labelled ${label}`)
  return card.querySelector('p')?.textContent ?? ''
}

/*
 * jsdom implements neither object-URL helper, and its Blob has no `text()`, so
 * the download is observed through the URL the browser was handed and read back
 * with FileReader. Both mocks live for the whole file: a download revokes its
 * URL on a timer, and restoring the globals before that timer runs would throw
 * outside any test.
 */
const createObjectURL = vi.fn(() => 'blob:csv')
const revokeObjectURL = vi.fn()
const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

function readBlob(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('The downloaded file could not be read'))
    reader.readAsText(blob)
  })
}

function downloadedCsv(): Promise<string> {
  const call = createObjectURL.mock.calls[0] as unknown as [Blob] | undefined
  if (!call) throw new Error('No file was downloaded')
  return readBlob(call[0])
}

beforeEach(() => {
  localStorage.clear()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL
  URL.revokeObjectURL = revokeObjectURL as unknown as typeof URL.revokeObjectURL
})

afterEach(() => {
  if (originalCreate) URL.createObjectURL = originalCreate
  else delete (URL as unknown as Record<string, unknown>).createObjectURL
  if (originalRevoke) URL.revokeObjectURL = originalRevoke
  else delete (URL as unknown as Record<string, unknown>).revokeObjectURL
})

describe('operator console', () => {
  it('opens on the accounts it governs and records the visit once', async () => {
    const { calls } = await open()

    expect(screen.getByRole('tab', { name: 'Accounts' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('heading', { name: 'Accounts' })).toBeInTheDocument()
    expect(screen.getByText('Ada Okoro · Owner')).toBeInTheDocument()
    expect(screen.getByText('Folio operations · folio.supabase.co')).toBeInTheDocument()
    expect(screen.getByText('4 of 6 accounts active · 14d')).toBeInTheDocument()
    await waitFor(() => expect(calls.recordOpen).toHaveBeenCalledTimes(1))
  })

  it('records the visit once even when React double-invokes the effect', async () => {
    const { api, calls } = fakeApi()
    render(<StrictMode><AdminConsole operator={operator} api={api} onSignOut={vi.fn()} /></StrictMode>)
    await screen.findByRole('heading', { name: 'Admin console' })
    await waitFor(() => expect(calls.recordOpen).toHaveBeenCalledTimes(1))
  })

  it('has no local mode, no ledger erasure and no browser storage estimate', async () => {
    await open()
    for (const label of ['Accounts', 'Usage', 'Quotas', 'Audit trail', 'Deployment']) {
      fireEvent.click(screen.getByRole('tab', { name: label }))
      await screen.findByRole('heading', { name: label })
      expect(screen.queryByText('Standalone')).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /clear ledger/i })).not.toBeInTheDocument()
      expect(screen.queryByText(/memory only/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/storage estimate/i)).not.toBeInTheDocument()
    }
    // Nothing the console reads is written to this device's own ledgers.
    expect(localStorage.getItem('folio.usage.v1')).toBeNull()
    expect(localStorage.getItem('folio.quotas.v1')).toBeNull()
  })

  it('lists the directory with roles, status and what each account actually did', async () => {
    await open()

    expect(screen.getByText('Chidi Eze')).toBeInTheDocument()
    expect(screen.getByText('chidi@studio.dev')).toBeInTheDocument()
    expect(within(row('Chidi Eze')).getByText('4')).toBeInTheDocument()
    expect(within(row('Chidi Eze')).getByText('Export produced')).toBeInTheDocument()
    expect(within(row('Femi Cole')).getByText('suspended')).toBeInTheDocument()
    expect(within(row('Femi Cole')).getByText('No recorded activity')).toBeInTheDocument()
    expect(screen.getByLabelText('Role for Efe Bello')).toHaveValue('user')
    expect(screen.getByText('1 unassigned, governed by the viewer policy')).toBeInTheDocument()
    expect(screen.getByText('1 account suspended. They cannot sign in to the workbench.')).toBeInTheDocument()
  })

  it('opens an account activity rollup and names the ledger it came from', async () => {
    await open()

    const activity = screen.getByRole('button', { name: 'Show activity for Chidi Eze' })
    expect(activity).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(activity)

    expect(screen.getByRole('button', { name: 'Hide activity for Chidi Eze' })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Export produced · 2')).toBeInTheDocument()
    expect(screen.getByText('Simulation run · 1')).toBeInTheDocument()
    expect(screen.getByText('Workspace opened · 1')).toBeInTheDocument()
    expect(screen.getByText(/From the deployment usage ledger, last 14 days/)).toBeInTheDocument()
    expect(screen.getByText(/The ledger is append-only; the console cannot delete it/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Hide activity for Chidi Eze' }))
    expect(screen.queryByText('Export produced · 2')).not.toBeInTheDocument()
  })

  it('searches the directory by name or email and says when nothing matches', async () => {
    await open()

    const search = screen.getByPlaceholderText('Search name or email')
    fireEvent.change(search, { target: { value: 'nobody' } })
    expect(await screen.findByText('No account matches “nobody”')).toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'CHIDI@STUDIO' } })
    expect(screen.getByText('Chidi Eze')).toBeInTheDocument()
    expect(screen.queryByText('Dana Ali')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear account search' }))
    expect(screen.getByText('Dana Ali')).toBeInTheDocument()
    expect(screen.queryByText(/No account matches/)).not.toBeInTheDocument()
  })

  it('orders the directory by the operator’s choice', async () => {
    await open()

    fireEvent.change(screen.getByLabelText('Order accounts'), { target: { value: 'name' } })
    const names = screen.getAllByText(/^(Ada Okoro|Ben Mensah|Chidi Eze|Dana Ali|Efe Bello|Femi Cole)( \(you\))?$/, { selector: 'p' })
    expect(names.map((node) => node.textContent)).toEqual([
      'Ada Okoro (you)', 'Ben Mensah', 'Chidi Eze', 'Dana Ali', 'Efe Bello', 'Femi Cole',
    ])
  })

  it('changes a role through the deployment and shows the reloaded value', async () => {
    const { calls } = await open()

    fireEvent.change(screen.getByLabelText('Role for Dana Ali'), { target: { value: 'engineer' } })

    await waitFor(() => expect(calls.setRole).toHaveBeenCalledWith('vw-1', 'engineer'))
    await waitFor(() => expect(screen.getByLabelText('Role for Dana Ali')).toHaveValue('engineer'))
  })

  it('arms a suspension in words and cancels without touching the account', async () => {
    const { calls } = await open()

    fireEvent.click(screen.getByRole('button', { name: 'Suspend Chidi Eze' }))
    expect(calls.setStatus).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Suspend access' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(calls.setStatus).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Suspend Chidi Eze' })).toBeInTheDocument()
  })

  it('suspends and restores access, and reports a refusal honestly', async () => {
    const { calls } = await open()

    fireEvent.click(screen.getByRole('button', { name: 'Suspend Chidi Eze' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suspend access' }))
    await waitFor(() => expect(calls.setStatus).toHaveBeenCalledWith('eng-1', 'suspended'))
    await waitFor(() => expect(within(row('Chidi Eze')).getByText('suspended')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Restore Chidi Eze' }))
    await waitFor(() => expect(calls.setStatus).toHaveBeenCalledWith('eng-1', 'active'))
    await waitFor(() => expect(within(row('Chidi Eze')).getByText('active')).toBeInTheDocument())
  })

  it('shows a refused change instead of implying it landed', async () => {
    await open({ statusResult: { ok: false, error: 'permission denied for table profiles' } })

    fireEvent.click(screen.getByRole('button', { name: 'Suspend Chidi Eze' }))
    fireEvent.click(screen.getByRole('button', { name: 'Suspend access' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('permission denied for table profiles')
    expect(within(row('Chidi Eze')).getByText('active')).toBeInTheDocument()
  })

  it('warns when a change landed but its audit row did not', async () => {
    await open({ roleResult: { ok: true, warning: 'The role change was saved, but the audit trail did not accept the row: timeout' } })

    fireEvent.change(screen.getByLabelText('Role for Dana Ali'), { target: { value: 'engineer' } })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/did not accept the row: timeout/)
    expect(alert.className).toContain('text-warning')
  })

  it('never offers to change the operator’s own access', async () => {
    await open()

    expect(screen.queryByLabelText('Role for Ada Okoro')).not.toBeInTheDocument()
    expect(within(row('Ada Okoro (you)')).getByText('your access')).toBeInTheDocument()
    expect(within(row('Ada Okoro (you)')).getByText('Signed in here')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend Ada Okoro' })).not.toBeInTheDocument()
  })

  it('lets an administrator manage engineers but not owners', async () => {
    await open({}, administrator)

    expect(screen.getByLabelText('Role for Chidi Eze')).toBeInTheDocument()
    expect(screen.queryByLabelText('Role for Ada Okoro')).not.toBeInTheDocument()
    expect(within(row('Ada Okoro')).getByText('Owner only')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Suspend Ada Okoro' })).not.toBeInTheDocument()
    // An administrator cannot grant the role that outranks it.
    expect(within(screen.getByLabelText('Role for Chidi Eze')).queryByRole('option', { name: 'Owner' })).not.toBeInTheDocument()
  })

  it('lets an owner change an owner account', async () => {
    await open()
    expect(within(screen.getByLabelText('Role for Ben Mensah')).getByRole('option', { name: 'Owner' })).toBeInTheDocument()
  })

  it('reports an unreadable directory rather than an empty one', async () => {
    await open({ accounts: [], accountsError: 'relation "profiles" does not exist' })

    expect(await screen.findByRole('alert')).toHaveTextContent('The account directory could not be read: relation "profiles" does not exist')
    expect(screen.getByText('The account directory could not be read')).toBeInTheDocument()
    expect(screen.getByText(/Reload to try again/)).toBeInTheDocument()
  })

  it('says when the deployment has no accounts yet', async () => {
    await open({ accounts: [] })
    expect(await screen.findByText('No accounts on this deployment yet')).toBeInTheDocument()
  })

  it('labels invitations as needing a server-side key, and does not fake the call', async () => {
    await open()
    expect(screen.getByText('Creating accounts')).toBeInTheDocument()
    expect(screen.getByText(/a service-role key, which must never reach a browser/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /invite/i })).not.toBeInTheDocument()
  })

  it('signs the operator out of the console', async () => {
    const { onSignOut } = await open()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(onSignOut).toHaveBeenCalledTimes(1)
  })
})

describe('operator console usage', () => {
  async function openUsage(overrides: Overrides = {}) {
    const result = await open(overrides)
    fireEvent.click(screen.getByRole('tab', { name: 'Usage' }))
    await screen.findByRole('heading', { name: 'Usage' })
    return result
  }

  it('counts what the deployment recorded, not what this browser did', async () => {
    await openUsage()

    expect(kpiValue('Events')).toBe('8')
    expect(kpiValue('Accounts active')).toBe('4')
    expect(kpiValue('Exports')).toBe('3')
    expect(kpiValue('Simulations')).toBe('1')
    expect(screen.getAllByText('Export produced').length).toBeGreaterThan(0)
    expect(screen.getByText('mechanical')).toBeInTheDocument()
    expect(screen.getByText('schematic')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Daily activity over 14 days, 8 events total' })).toBeInTheDocument()
  })

  it('re-reads the deployment when the window changes', async () => {
    const { calls } = await openUsage()

    fireEvent.change(screen.getByLabelText('Window'), { target: { value: '7' } })

    await waitFor(() => expect(calls.loadUsage).toHaveBeenCalledWith(7))
    expect(screen.getByText('Recorded in the last 7 days')).toBeInTheDocument()
  })

  it('filters the event table by action kind', async () => {
    await openUsage()

    fireEvent.change(screen.getByLabelText('Action kind'), { target: { value: 'export.run' } })

    const table = screen.getByRole('table', { name: 'Recorded usage events' })
    expect(within(table).getAllByText('Export produced')).toHaveLength(3)
    expect(within(table).queryByText('Simulation run')).not.toBeInTheDocument()
    expect(within(table).getByText('format=gerber')).toBeInTheDocument()
  })

  it('says when the window holds more rows than the deployment returned', async () => {
    await openUsage({ truncated: true })
    expect(await screen.findByRole('alert')).toHaveTextContent('only the newest 10,000 are shown')
  })

  it('reports an unreadable usage feed instead of showing zero activity', async () => {
    await openUsage({ usageError: 'permission denied for table usage_events' })

    expect(await screen.findByRole('alert')).toHaveTextContent('Usage could not be read: permission denied for table usage_events')
    expect(screen.getByText('No events in this window')).toBeInTheDocument()
  })

  it('exports the visible rows with the account resolved to a name and email', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let csv = ''
    try {
      await openUsage()
      fireEvent.change(screen.getByLabelText('Action kind'), { target: { value: 'export.run' } })
      fireEvent.click(screen.getByRole('button', { name: 'CSV' }))

      expect(createObjectURL).toHaveBeenCalledTimes(1)
      expect(click).toHaveBeenCalledTimes(1)
      csv = await downloadedCsv()
      // The object URL is released only after the browser has taken the file.
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv'))
    } finally {
      click.mockRestore()
    }
    expect(csv.split('\r\n')[0]).toBe('"timestamp","account","email","kind","detail"')
    expect(csv).toContain('"Chidi Eze","chidi@studio.dev","export.run"')
    expect(csv).not.toContain('simulation.run')
    expect(csv.split('\r\n')).toHaveLength(4)
  })

  it('states the table cap and points at the complete export', async () => {
    const events: UsageEvent[] = Array.from({ length: 305 }, (_, index) => ({
      id: `bulk-${index}`,
      at: NOW - index * 1000,
      user: 'eng-1',
      kind: 'workspace.open',
      detail: { mode: 'mechanical' },
    }))
    await openUsage({ events })

    expect(screen.getByText('Showing the newest 300 of 305 matching events. The CSV export contains all of them.')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Recorded usage events' })
    expect(within(table).getAllByRole('row')).toHaveLength(301)
  })
})

describe('operator console quotas', () => {
  async function openQuotas(overrides: Overrides = {}) {
    const result = await open(overrides)
    fireEvent.click(screen.getByRole('tab', { name: 'Quotas' }))
    await screen.findByRole('heading', { name: 'Quotas' })
    return result
  }

  it('shows the stored policy and saves an edit back to the deployment', async () => {
    const { calls } = await openQuotas()

    const projects = screen.getByLabelText('Engineer Projects limit')
    expect(projects).toHaveValue(100)
    fireEvent.change(projects, { target: { value: '7' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save policy' })[0])

    await waitFor(() => expect(calls.savePolicy).toHaveBeenCalledWith('engineer', {
      maxProjects: 7, maxExportsPerDay: 200, maxSimulationsPerDay: 1000, maxStorageMb: 2048,
    }))
    expect(await screen.findByRole('status')).toHaveTextContent('Policy saved. The deployment enforces it on the next insert.')
    await waitFor(() => expect(screen.getByLabelText('Engineer Projects limit')).toHaveValue(7))
  })

  it('treats a blank limit as unlimited', async () => {
    const { calls } = await openQuotas()

    fireEvent.change(screen.getByLabelText('Viewer Storage (MB) limit'), { target: { value: '' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save policy' })[1])

    await waitFor(() => expect(calls.savePolicy).toHaveBeenCalledWith('viewer', expect.objectContaining({ maxStorageMb: null })))
  })

  it('refuses a negative limit without calling the deployment', async () => {
    const { calls } = await openQuotas()

    fireEvent.change(screen.getByLabelText('Viewer Exports / day limit'), { target: { value: '-5' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Save policy' })[1])

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter zero or a positive number, or leave blank for unlimited.')
    expect(calls.savePolicy).not.toHaveBeenCalled()
  })

  it('reports a refused policy save', async () => {
    await openQuotas({ policyResult: { ok: false, error: 'new row violates row-level security policy' } })

    fireEvent.click(screen.getAllByRole('button', { name: 'Save policy' })[0])

    expect(await screen.findByRole('alert')).toHaveTextContent('new row violates row-level security policy')
  })

  it('never offers to edit the owner or administrator policy', async () => {
    await openQuotas()

    expect(screen.getByRole('heading', { name: 'Engineer policy' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Viewer policy' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Owner policy' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Administrator policy' })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Save policy' })).toHaveLength(2)
    expect(screen.getByText('Owner and administrator limits are fixed at unlimited so the console can never lock itself out.')).toBeInTheDocument()
  })

  it('governs an unassigned account with the viewer policy', async () => {
    await openQuotas()
    expect(screen.getByText('Read-only access. The tightest default quotas. 2 accounts governed.')).toBeInTheDocument()
    expect(screen.getByText('Creates and edits designs. Subject to the engineering quotas below. 2 accounts governed.')).toBeInTheDocument()
  })

  it('counts today’s exports and solver runs against each account’s own limit', async () => {
    await openQuotas({
      policies: {
        ...DEFAULT_QUOTA_POLICIES,
        engineer: { ...DEFAULT_QUOTA_POLICIES.engineer, maxExportsPerDay: 2 },
        viewer: { ...DEFAULT_QUOTA_POLICIES.viewer, maxExportsPerDay: 20 },
      },
    })

    expect(screen.getByRole('heading', { name: 'Today against policy' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Accounts against their daily export and simulation limits' })
    expect(within(table).getByText('Chidi Eze')).toBeInTheDocument()
    expect(within(within(table).getByText('Chidi Eze').closest('tr') as HTMLElement).getByText('/ 2')).toBeInTheDocument()
    // Two of two exports used is a reached limit, and the console says how many.
    expect(kpiValue('Accounts at a limit')).toBe('1')
    expect(screen.getByText('0 more above 80% of a daily limit')).toBeInTheDocument()
  })

  it('says when nothing has been exported or solved today', async () => {
    await openQuotas({ events: [{ id: 'old', at: NOW - 3 * DAY, user: 'eng-1', kind: 'export.run' }] })
    expect(screen.getByText('No exports or solver runs today')).toBeInTheDocument()
  })

  it('shows deployment totals and admits when the aggregate is unavailable', async () => {
    await openQuotas({ deployment: { host: 'folio.supabase.co', agentRunnerConfigured: false, stats: null, statsError: 'Apply the operator console migration.' } })

    expect(kpiValue('Projects')).toBe('—')
    expect(screen.getByText('Apply the operator console migration.')).toBeInTheDocument()
    expect(kpiValue('Exports today')).toBe('—')
    expect(kpiValue('Solver runs today')).toBe('—')
  })

  it('falls back to the defaults, and says so, when the stored policies cannot be read', async () => {
    await openQuotas({ policyError: 'relation "quota_policies" does not exist' })

    expect(await screen.findByRole('alert')).toHaveTextContent('The stored policies could not be read: relation "quota_policies" does not exist')
    expect(screen.getByLabelText('Engineer Projects limit')).toHaveValue(100)
  })

  it('states that storage is a policy figure the server does not measure', async () => {
    await openQuotas()
    expect(screen.getByText(/Storage is a policy figure only/)).toBeInTheDocument()
    expect(screen.getByText(/the server does not measure an account's design bytes/)).toBeInTheDocument()
  })
})

describe('operator console audit and deployment', () => {
  it('lists operator actions with the account resolved to a name', async () => {
    await open()
    fireEvent.click(screen.getByRole('tab', { name: 'Audit trail' }))

    expect(await screen.findByRole('heading', { name: 'Audit trail' })).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Operator audit trail entries' })
    expect(within(table).getByText('role change')).toBeInTheDocument()
    expect(within(table).getByText('Chidi Eze')).toBeInTheDocument()
    expect(within(table).getByText('This console')).toBeInTheDocument()
    expect(within(table).getAllByText('Ada Okoro')).toHaveLength(2)
    expect(screen.getByText(/The trail is append-only/)).toBeInTheDocument()
  })

  it('reports an unreadable audit trail', async () => {
    await open({ audit: [], auditError: 'permission denied for table admin_audit' })
    fireEvent.click(screen.getByRole('tab', { name: 'Audit trail' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('The audit trail could not be read: permission denied for table admin_audit')
    expect(screen.getByText('No operator actions recorded yet')).toBeInTheDocument()
  })

  it('exports the audit trail as CSV', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    let csv = ''
    try {
      await open()
      fireEvent.click(screen.getByRole('tab', { name: 'Audit trail' }))
      fireEvent.click(await screen.findByRole('button', { name: 'CSV' }))
      csv = await downloadedCsv()
      await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:csv'))
    } finally {
      click.mockRestore()
    }
    expect(csv.split('\r\n')[0]).toBe('"timestamp","operator","action","resource","details"')
    expect(csv).toContain('"Ada Okoro","admin:role_change","eng-1"')
    expect(csv.split('\r\n')).toHaveLength(4)
  })

  it('reports the installation it operates and what the agent runner can do', async () => {
    await open()
    fireEvent.click(screen.getByRole('tab', { name: 'Deployment' }))

    expect(await screen.findByRole('heading', { name: 'Deployment' })).toBeInTheDocument()
    expect(screen.getByText('folio.supabase.co')).toBeInTheDocument()
    expect(screen.getByText('Configured')).toBeInTheDocument()
    expect(screen.getByText('Agent jobs can keep running after the designer closes the tab.')).toBeInTheDocument()
    expect(screen.getByText('412')).toBeInTheDocument()
    expect(screen.getByText('1,840')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Projects by role' })).toBeInTheDocument()
  })

  it('says when the always-on runner is not configured, and how to change that', async () => {
    await open({ deployment: { host: 'folio.supabase.co', agentRunnerConfigured: false, stats } })
    fireEvent.click(screen.getByRole('tab', { name: 'Deployment' }))

    expect(await screen.findByText('Not configured')).toBeInTheDocument()
    expect(screen.getByText(/Set VITE_AGENT_CLOUD_URL on the workbench build/)).toBeInTheDocument()
  })

  it('explains the operator’s own reach', async () => {
    await open({}, administrator)
    fireEvent.click(screen.getByRole('tab', { name: 'Deployment' }))

    expect(await screen.findByText('Administrators manage engineers and viewers. Only an owner can change an owner account.')).toBeInTheDocument()
  })

  it('states what the console cannot do, including reading anyone’s design', async () => {
    await open()
    fireEvent.click(screen.getByRole('tab', { name: 'Deployment' }))

    expect(await screen.findByRole('heading', { name: 'What this console does not do' })).toBeInTheDocument()
    expect(screen.getByText(/It does not open, read or export anyone's design/)).toBeInTheDocument()
    expect(screen.getByText(/It cannot delete usage or audit rows/)).toBeInTheDocument()
    expect(screen.getByText(/It has no local mode/)).toBeInTheDocument()
  })
})