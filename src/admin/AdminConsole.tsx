import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  Activity, AlertTriangle, ChevronDown, Database, FileDown, Gauge, LogOut,
  RefreshCw, Search, Shield, Users, Wrench, X, BookOpen, type LucideIcon,
} from 'lucide-react'
import FaqPanel from './FaqPanel'
import { Button } from '../components/ui/button'
import { FolioMark } from '../components/brand/FolioLogo'
import type { Account, AdminApi, AuditEntry, DeploymentInfo } from '../lib/admin/adminService'
import type { Operator } from '../lib/admin/operatorSession'
import {
  ADMIN_ROLES, DEFAULT_QUOTA_POLICIES, ROLE_DESCRIPTIONS, ROLE_LABELS, parseQuotaLimit,
  type AdminRole, type QuotaLimits, type QuotaSubject,
} from '../lib/admin/quotaPolicy'
import { summarizeUsage, usageByAccount, type UsageEvent, type UsageKind } from '../lib/admin/usageLedger'

/*
 * The console for the people who run Folio: the accounts that use the product,
 * what each one actually did, the limits that govern them, and the record of
 * what operators changed. It is a separate document with its own session — the
 * workbench has no route to it and no link to it. Every number on screen is a
 * read from the deployment; nothing here is inferred from this browser.
 */

type SectionId = 'accounts' | 'usage' | 'quotas' | 'audit' | 'deployment' | 'faq'

const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: 'accounts', label: 'Accounts', icon: Users },
  { id: 'usage', label: 'Usage', icon: Activity },
  { id: 'quotas', label: 'Quotas', icon: Gauge },
  { id: 'audit', label: 'Audit trail', icon: Shield },
  { id: 'faq', label: 'FAQ', icon: BookOpen },
  { id: 'deployment', label: 'Deployment', icon: Database },
]

const WINDOWS = [7, 14, 30, 90] as const

type AccountSort = 'active' | 'recent' | 'name' | 'role'

const USAGE_KIND_LABELS: Record<UsageKind, string> = {
  'workspace.open': 'Workspace opened',
  'demo.load': 'Demo loaded',
  'project.create': 'Project created',
  'project.open': 'Project opened',
  'vcs.commit': 'Version committed',
  'export.run': 'Export produced',
  'simulation.run': 'Simulation run',
  'agent.run': 'Agent run',
  'onboarding.complete': 'Guided tour finished',
  'onboarding.exit': 'Guided tour ended early',
  'admin.open': 'Admin console opened',
  'template.fork': 'Community design made theirs',
}

const KIND_OPTIONS: Array<{ value: 'all' | UsageKind; label: string }> = [
  { value: 'all', label: 'All activity' },
  ...(Object.keys(USAGE_KIND_LABELS) as UsageKind[]).map((kind) => ({ value: kind, label: USAGE_KIND_LABELS[kind] })),
]

const LIMIT_FIELDS: Array<[keyof QuotaLimits, string, string]> = [
  ['maxProjects', 'Projects', 'projects'],
  ['maxExportsPerDay', 'Exports / day', 'exports'],
  ['maxSimulationsPerDay', 'Simulations / day', 'runs'],
  ['maxStorageMb', 'Storage (MB)', 'MB'],
]

function startOfToday(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function formatTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Unknown'
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

/** Roles arrive as strings from the aggregate; an unknown one is shown verbatim. */
function roleLabel(role: string): string {
  if (role === 'user') return 'Unassigned'
  return (ADMIN_ROLES as readonly string[]).includes(role) ? ROLE_LABELS[role as AdminRole] : role
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? '?'}${parts[parts.length - 1][0] ?? ''}`.toUpperCase()
}

function downloadCsv(filename: string, header: string[], rows: string[][]): void {
  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`
  const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revoking in the same task can cancel the download before it starts.
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-card ${className}`}>{children}</div>
}

function SectionHeader({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="mt-0.5 max-w-3xl text-xs leading-relaxed text-muted-foreground">{detail}</p>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  )
}

const PICKER_CLASS =
  'min-h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50'

function Picker({ label, value, onChange, children }: {
  label: string
  value: string | number
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <select aria-label={label} className={PICKER_CLASS} value={value} onChange={(event) => onChange(event.target.value)}>
      {children}
    </select>
  )
}

function Kpi({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: LucideIcon }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 flex-shrink-0 text-primary/70" aria-hidden="true" />
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </Card>
  )
}

const CHART_HUES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)']

function DailyChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...data.map((point) => point.count))
  const total = data.reduce((sum, point) => sum + point.count, 0)
  return (
    <div>
      <div
        className="flex h-28 items-end gap-[3px]"
        role="img"
        aria-label={`Daily activity over ${data.length} days, ${total} events total`}
      >
        {data.map((point, index) => {
          const height = point.count === 0 ? 3 : Math.max(6, Math.round((point.count / max) * 100))
          return (
            <div
              key={point.date}
              className="flex-1 rounded-sm transition-[height] duration-300"
              style={{
                height: `${height}%`,
                background: point.count === 0 ? 'hsl(var(--muted))' : CHART_HUES[index % CHART_HUES.length],
                opacity: point.count === 0 ? 1 : 0.55 + 0.45 * (point.count / max),
              }}
              title={`${point.date}: ${point.count} event${point.count === 1 ? '' : 's'}`}
            />
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] tabular-nums text-muted-foreground">
        <span>{data[0]?.date}</span>
        <span>{data[data.length - 1]?.date}</span>
      </div>
    </div>
  )
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function Alert({ tone, children }: { tone: 'warning' | 'destructive' | 'success'; children: ReactNode }) {
  const tones = {
    warning: 'border-warning/40 bg-warning/10 text-warning',
    destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
    success: 'border-success/40 bg-success/10 text-success',
  } as const
  return (
    <p role={tone === 'success' ? 'status' : 'alert'} className={`rounded-md border px-3 py-2 text-xs ${tones[tone]}`}>
      {children}
    </p>
  )
}

function Meter({ used, limit }: { used: number; limit: number | null }) {
  const ratio = limit === null || limit === 0 ? (used > 0 ? 1 : 0) : Math.min(1, used / limit)
  const tone = limit !== null && used >= limit ? 'bg-destructive' : ratio >= 0.8 ? 'bg-warning' : 'bg-success'
  return (
    <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(ratio > 0 ? 6 : 0, ratio * 100)}%` }} />
    </span>
  )
}

type Draft = Record<'engineer' | 'viewer', Record<keyof QuotaLimits, string>>

function draftFrom(policies: Record<AdminRole, QuotaLimits>): Draft {
  const toDraft = (limits: QuotaLimits): Record<keyof QuotaLimits, string> => ({
    maxProjects: limits.maxProjects === null ? '' : String(limits.maxProjects),
    maxExportsPerDay: limits.maxExportsPerDay === null ? '' : String(limits.maxExportsPerDay),
    maxSimulationsPerDay: limits.maxSimulationsPerDay === null ? '' : String(limits.maxSimulationsPerDay),
    maxStorageMb: limits.maxStorageMb === null ? '' : String(limits.maxStorageMb),
  })
  return { engineer: toDraft(policies.engineer), viewer: toDraft(policies.viewer) }
}

export interface AdminConsoleProps {
  operator: Operator
  api: AdminApi
  onSignOut: () => void
}

export default function AdminConsole({ operator, api, onSignOut }: AdminConsoleProps) {
  const [section, setSection] = useState<SectionId>('accounts')
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accountsError, setAccountsError] = useState('')
  const [events, setEvents] = useState<UsageEvent[]>([])
  const [usageError, setUsageError] = useState('')
  const [truncated, setTruncated] = useState(false)
  const [policies, setPolicies] = useState<Record<AdminRole, QuotaLimits>>({ ...DEFAULT_QUOTA_POLICIES })
  const [policyError, setPolicyError] = useState('')
  const [audit, setAudit] = useState<AuditEntry[]>([])
  const [auditError, setAuditError] = useState('')
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [usageDays, setUsageDays] = useState<number>(14)
  const [kindFilter, setKindFilter] = useState<'all' | UsageKind>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AccountSort>('active')
  const [openAccount, setOpenAccount] = useState('')
  const [busyAccount, setBusyAccount] = useState('')
  const [suspendArmed, setSuspendArmed] = useState('')
  const [accountNotice, setAccountNotice] = useState<{ message: string; tone: 'destructive' | 'warning' } | null>(null)
  const [policyDraft, setPolicyDraft] = useState<Draft>(() => draftFrom({ ...DEFAULT_QUOTA_POLICIES }))
  const [policyStatus, setPolicyStatus] = useState<{ role: AdminRole; message: string; tone: 'success' | 'destructive' | 'warning' } | null>(null)
  const [savingPolicy, setSavingPolicy] = useState<AdminRole | ''>('')

  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void api.recordOpen()
  }, [api])

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const [directory, usage, policy, trail, info] = await Promise.all([
        api.listAccounts(),
        api.loadUsage(usageDays),
        api.loadPolicies(),
        api.loadAudit(200),
        api.loadDeployment(),
      ])
      setAccounts(directory.accounts)
      setAccountsError(directory.error ?? '')
      setEvents(usage.events)
      setUsageError(usage.error ?? '')
      setTruncated(usage.truncated)
      setPolicies(policy.policies)
      setPolicyError(policy.error ?? '')
      setAudit(trail.entries)
      setAuditError(trail.error ?? '')
      setDeployment(info)
    } finally {
      setRefreshing(false)
      setLoading(false)
    }
  }, [api, usageDays])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setPolicyDraft(draftFrom(policies)) }, [policies])

  const summary = useMemo(() => summarizeUsage(events, usageDays), [events, usageDays])
  const accountUsage = useMemo(() => usageByAccount(events), [events])
  const accountById = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts])
  const accountName = useCallback(
    (id: string) => accountById.get(id)?.name ?? (id === operator.id ? operator.name : id),
    [accountById, operator],
  )

  const filteredEvents = useMemo(() => {
    const rows = kindFilter === 'all' ? events : events.filter((event) => event.kind === kindFilter)
    return [...rows].sort((a, b) => b.at - a.at)
  }, [events, kindFilter])

  const visibleAccounts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = needle
      ? accounts.filter((account) => `${account.name} ${account.email}`.toLowerCase().includes(needle))
      : [...accounts]
    const count = (account: Account) => accountUsage.get(account.id)?.events ?? 0
    const last = (account: Account) => accountUsage.get(account.id)?.lastAt ?? account.lastSeenAt ?? 0
    rows.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'role') return a.role.localeCompare(b.role) || a.name.localeCompare(b.name)
      if (sort === 'recent') return last(b) - last(a) || a.name.localeCompare(b.name)
      return count(b) - count(a) || a.name.localeCompare(b.name)
    })
    return rows
  }, [accounts, accountUsage, query, sort])

  const maxAccountEvents = useMemo(
    () => Math.max(1, ...accounts.map((account) => accountUsage.get(account.id)?.events ?? 0)),
    [accounts, accountUsage],
  )

  /** Per-account activity since midnight, which is the window the daily quotas use. */
  const todayRows = useMemo(() => {
    const midnight = startOfToday()
    const totals = new Map<string, { exports: number; simulations: number }>()
    for (const event of events) {
      if (event.at < midnight) continue
      if (event.kind !== 'export.run' && event.kind !== 'simulation.run') continue
      const row = totals.get(event.user) ?? { exports: 0, simulations: 0 }
      if (event.kind === 'export.run') row.exports += 1
      else row.simulations += 1
      totals.set(event.user, row)
    }
    return [...totals.entries()]
      .map(([id, row]) => {
        const account = accountById.get(id)
        // An unassigned account is governed by the viewer policy until a role is set.
        const role: QuotaSubject = account?.role ?? 'user'
        const limits = role === 'user' ? policies.viewer : policies[role]
        const exportRatio = limits.maxExportsPerDay ? row.exports / limits.maxExportsPerDay : 0
        const runRatio = limits.maxSimulationsPerDay ? row.simulations / limits.maxSimulationsPerDay : 0
        const ratio = Math.max(exportRatio, runRatio)
        return { id, name: accountName(id), role, limits, ...row, ratio }
      })
      .sort((a, b) => b.ratio - a.ratio || b.exports + b.simulations - (a.exports + a.simulations))
  }, [events, accountById, accountName, policies])

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { owner: 0, admin: 0, engineer: 0, viewer: 0, user: 0 }
    for (const account of accounts) counts[account.role] = (counts[account.role] ?? 0) + 1
    return counts
  }, [accounts])

  const suspendedCount = accounts.filter((account) => account.status === 'suspended').length
  const canTouchOwner = operator.role === 'owner'

  const applyResult = (result: { ok: boolean; error?: string; warning?: string }) => {
    if (!result.ok) setAccountNotice({ message: result.error ?? 'The change was refused.', tone: 'destructive' })
    else if (result.warning) setAccountNotice({ message: result.warning, tone: 'warning' })
    else setAccountNotice(null)
  }

  const changeRole = async (account: Account, role: AdminRole) => {
    setBusyAccount(account.id)
    applyResult(await api.setRole(account.id, role))
    setBusyAccount('')
    await load()
  }

  const changeStatus = async (account: Account, status: Account['status']) => {
    setBusyAccount(account.id)
    setSuspendArmed('')
    applyResult(await api.setStatus(account.id, status))
    setBusyAccount('')
    await load()
  }

  const savePolicy = async (role: 'engineer' | 'viewer') => {
    const draft = policyDraft[role]
    const parsed = {
      maxProjects: parseQuotaLimit(draft.maxProjects),
      maxExportsPerDay: parseQuotaLimit(draft.maxExportsPerDay),
      maxSimulationsPerDay: parseQuotaLimit(draft.maxSimulationsPerDay),
      maxStorageMb: parseQuotaLimit(draft.maxStorageMb),
    }
    if (Object.values(parsed).some((value) => value === undefined)) {
      setPolicyStatus({ role, message: 'Enter zero or a positive number, or leave blank for unlimited.', tone: 'destructive' })
      return
    }
    setSavingPolicy(role)
    const result = await api.savePolicy(role, {
      maxProjects: parsed.maxProjects as number | null,
      maxExportsPerDay: parsed.maxExportsPerDay as number | null,
      maxSimulationsPerDay: parsed.maxSimulationsPerDay as number | null,
      maxStorageMb: parsed.maxStorageMb as number | null,
    })
    setSavingPolicy('')
    setPolicyStatus({
      role,
      message: result.ok
        ? result.warning ?? 'Policy saved. The deployment enforces it on the next insert.'
        : result.error ?? 'The policy could not be saved.',
      tone: result.ok ? (result.warning ? 'warning' : 'success') : 'destructive',
    })
    if (result.ok) await load()
  }

  const railCounts: Partial<Record<SectionId, number>> = {
    accounts: accounts.length,
    usage: summary.total,
    audit: audit.length,
  }

  const stats = deployment?.stats ?? null

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground" role="status">Reading the deployment…</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="app-chrome app-chrome-divider flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <FolioMark className="h-7 w-7 flex-shrink-0 text-primary" />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-tight text-foreground">Admin console</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {deployment?.host ? `Folio operations · ${deployment.host}` : 'Folio operations'}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="cad-chip border-primary/40 bg-primary/10 text-primary">
            {`${operator.name} · ${ROLE_LABELS[operator.role]}`}
          </span>
          {accounts.length > 0 && (
            <span className="cad-chip">
              {`${summary.byUser.length} of ${accounts.length} accounts active · ${usageDays}d`}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { void load() }}
            aria-label="Reload deployment data"
            title="Reload accounts, usage, policies and the audit trail"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="outline" size="sm" className="flex items-center gap-1.5" onClick={onSignOut}>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
          </Button>
        </div>
      </header>

      <div className="flex w-full max-w-[1500px] flex-1 flex-col self-center lg:flex-row">
        <nav className="admin-rail" aria-label="Admin console sections">
          <p className="mb-2 hidden px-2.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground lg:block">
            Operations
          </p>
          <div className="admin-rail__list" role="tablist" aria-orientation="vertical">
            {SECTIONS.map((entry) => {
              const Icon = entry.icon
              const selected = section === entry.id
              const count = railCounts[entry.id]
              return (
                <button
                  key={entry.id}
                  type="button"
                  role="tab"
                  id={`admin-tab-${entry.id}`}
                  aria-label={entry.label}
                  aria-selected={selected}
                  aria-controls={`admin-panel-${entry.id}`}
                  onClick={() => setSection(entry.id)}
                  className="admin-rail__item"
                >
                  <Icon className="admin-rail__icon" aria-hidden="true" />
                  <span className="truncate">{entry.label}</span>
                  {count !== undefined && <span className="admin-rail__count" aria-hidden="true">{count}</span>}
                </button>
              )
            })}
          </div>
          <p className="admin-rail__note">
            {suspendedCount > 0
              ? `${suspendedCount} account${suspendedCount === 1 ? '' : 's'} suspended. They cannot sign in to the workbench.`
              : 'Every account in the directory is active.'}
          </p>
        </nav>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">
          {section === 'accounts' && (
            <section role="tabpanel" id="admin-panel-accounts" aria-labelledby="admin-tab-accounts" className="space-y-4">
              <SectionHeader
                title="Accounts"
                detail="Everyone who can sign in to Folio on this deployment. Set what each account may do, suspend access, and see what it actually used."
              >
                <label className="cad-search flex min-h-9 w-full items-center gap-2 rounded-md border border-input bg-background px-2.5 text-xs sm:w-64">
                  <Search className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="sr-only">Search accounts</span>
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search name or email"
                    className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
                  />
                  {query && (
                    <button type="button" aria-label="Clear account search" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </label>
                <Picker label="Order accounts" value={sort} onChange={(value) => setSort(value as AccountSort)}>
                  <option value="active">Most activity</option>
                  <option value="recent">Most recent</option>
                  <option value="role">Role</option>
                  <option value="name">Name A–Z</option>
                </Picker>
                <Picker label="Activity window" value={usageDays} onChange={(value) => setUsageDays(Number(value))}>
                  {WINDOWS.map((days) => <option key={days} value={days}>{`${days} days`}</option>)}
                </Picker>
              </SectionHeader>

              {accountNotice && <Alert tone={accountNotice.tone}>{accountNotice.message}</Alert>}
              {accountsError && <Alert tone="warning">{`The account directory could not be read: ${accountsError}`}</Alert>}
              {usageError && <Alert tone="warning">{`Usage could not be read, so the activity columns are empty: ${usageError}`}</Alert>}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Accounts" value={String(accounts.length)} hint={`${accounts.length - suspendedCount} active · ${suspendedCount} suspended`} icon={Users} />
                <Kpi label="Operators" value={String(roleCounts.owner + roleCounts.admin)} hint={`${roleCounts.owner} owner · ${roleCounts.admin} administrator`} icon={Shield} />
                <Kpi label="Engineers" value={String(roleCounts.engineer)} hint={ROLE_DESCRIPTIONS.engineer} icon={Wrench} />
                <Kpi label="Viewers" value={String(roleCounts.viewer + roleCounts.user)} hint={`${roleCounts.user} unassigned, governed by the viewer policy`} icon={Activity} />
              </div>

              <Card className="overflow-x-auto">
                <table className="admin-table min-w-[860px]">
                  <caption className="sr-only">Accounts, their roles, their status and their recorded usage</caption>
                  <thead>
                    <tr>
                      <th scope="col">Account</th>
                      <th scope="col">Role</th>
                      <th scope="col">Status</th>
                      <th scope="col">{`Actions in ${usageDays} days`}</th>
                      <th scope="col">Last action</th>
                      <th scope="col">Manage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleAccounts.map((account) => {
                      const self = account.id === operator.id
                      const usage = accountUsage.get(account.id)
                      const expanded = openAccount === account.id
                      const activityId = `account-activity-${account.id}`
                      const locked = self || (account.role === 'owner' && !canTouchOwner)
                      const busy = busyAccount === account.id
                      return (
                        <Fragment key={account.id}>
                          <tr>
                            <td>
                              <div className="flex min-w-0 items-center gap-2.5">
                                <span aria-hidden="true" className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border bg-background text-[10px] font-semibold text-muted-foreground">
                                  {initials(account.name)}
                                </span>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground">{account.name}{self ? ' (you)' : ''}</p>
                                  <p className="truncate text-[10px] text-muted-foreground">{account.email || 'No email on record'}</p>
                                </div>
                              </div>
                            </td>
                            <td>
                              {locked ? (
                                <span className="text-foreground">
                                  {account.role === 'user' ? 'Unassigned' : ROLE_LABELS[account.role]}
                                  {self && <span className="ml-1 text-[10px] text-muted-foreground">your access</span>}
                                </span>
                              ) : (
                                <select
                                  aria-label={`Role for ${account.name}`}
                                  className={PICKER_CLASS}
                                  value={account.role}
                                  disabled={busy}
                                  onChange={(event) => { void changeRole(account, event.target.value as AdminRole) }}
                                >
                                  {account.role === 'user' && <option value="user">Unassigned</option>}
                                  {ADMIN_ROLES.filter((role) => canTouchOwner || role !== 'owner').map((role) => (
                                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td>
                              <span className={`cad-chip ${account.status === 'active' ? 'border-success/40 bg-success/10 text-success' : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
                                {account.status}
                              </span>
                            </td>
                            <td>
                              {usage ? (
                                <div className="flex min-w-[150px] items-center gap-2">
                                  <span className="w-7 flex-shrink-0 text-right text-[11px] font-medium tabular-nums text-foreground">{usage.events}</span>
                                  <span aria-hidden="true" className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                                    <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(8, Math.round((usage.events / maxAccountEvents) * 100))}%` }} />
                                  </span>
                                  <span className="flex-shrink-0 truncate text-[10px] text-muted-foreground">{USAGE_KIND_LABELS[usage.topKind]}</span>
                                </div>
                              ) : (
                                <span className="text-muted-foreground">No recorded activity</span>
                              )}
                            </td>
                            <td className="whitespace-nowrap tabular-nums text-muted-foreground">
                              {formatTime(usage?.lastAt ?? account.lastSeenAt ?? 0)}
                            </td>
                            <td>
                              <div className="flex items-center justify-end gap-1.5">
                                {usage && (
                                  <button
                                    type="button"
                                    className="cad-ctl"
                                    aria-expanded={expanded}
                                    aria-controls={activityId}
                                    aria-label={expanded ? `Hide activity for ${account.name}` : `Show activity for ${account.name}`}
                                    title={expanded ? 'Hide this account activity' : 'Show this account activity'}
                                    onClick={() => setOpenAccount(expanded ? '' : account.id)}
                                  >
                                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                                    Activity
                                  </button>
                                )}
                                {locked ? (
                                  <span className="text-[10px] text-muted-foreground">{self ? 'Signed in here' : 'Owner only'}</span>
                                ) : suspendArmed === account.id ? (
                                  <>
                                    <Button variant="destructive" size="sm" disabled={busy} onClick={() => { void changeStatus(account, 'suspended') }}>
                                      Suspend access
                                    </Button>
                                    <Button variant="ghost" size="sm" onClick={() => setSuspendArmed('')}>Cancel</Button>
                                  </>
                                ) : account.status === 'active' ? (
                                  <Button variant="ghost" size="sm" disabled={busy} aria-label={`Suspend ${account.name}`} onClick={() => setSuspendArmed(account.id)}>
                                    Suspend
                                  </Button>
                                ) : (
                                  <Button variant="outline" size="sm" disabled={busy} aria-label={`Restore ${account.name}`} onClick={() => { void changeStatus(account, 'active') }}>
                                    Restore
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                          {expanded && usage && (
                            <tr id={activityId}>
                              <td colSpan={6} className="bg-surface/40 px-3 py-3">
                                <div className="space-y-2.5">
                                  <div className="flex flex-wrap gap-1.5">
                                    {usage.kinds.map((kind) => (
                                      <span key={kind.kind} className="cad-chip">{`${USAGE_KIND_LABELS[kind.kind]} · ${kind.count}`}</span>
                                    ))}
                                  </div>
                                  <ul className="space-y-1">
                                    {events.filter((event) => event.user === account.id).sort((a, b) => b.at - a.at).slice(0, 8).map((event) => (
                                      <li key={event.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                                        <span className="truncate text-foreground">
                                          {USAGE_KIND_LABELS[event.kind]}
                                          {typeof event.detail?.mode === 'string' ? ` · ${event.detail.mode}` : ''}
                                        </span>
                                        <time className="flex-shrink-0 tabular-nums text-muted-foreground" dateTime={new Date(event.at).toISOString()}>
                                          {formatTime(event.at)}
                                        </time>
                                      </li>
                                    ))}
                                  </ul>
                                  <p className="text-[10px] text-muted-foreground">
                                    {`From the deployment usage ledger, last ${usageDays} days. The ledger is append-only; the console cannot delete it.`}
                                  </p>
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
                {visibleAccounts.length === 0 && (
                  <div className="p-6">
                    {query.trim() !== '' ? (
                      <EmptyState title={`No account matches “${query.trim()}”`} detail="Clear the search to see the full directory." />
                    ) : accountsError ? (
                      <EmptyState title="The account directory could not be read" detail={`${accountsError} Reload to try again.`} />
                    ) : (
                      <EmptyState title="No accounts on this deployment yet" detail="Accounts appear here as soon as someone signs up to the workbench." />
                    )}
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <h3 className="text-xs font-semibold text-foreground">Creating accounts</h3>
                <p className="mt-2 max-w-3xl text-xs leading-relaxed text-muted-foreground">
                  Inviting someone needs the identity service&apos;s admin API and a service-role key, which must never reach a
                  browser. Create the account in the identity service, then assign its role here. New sign-ups start unassigned
                  and are governed by the viewer policy until you set a role.
                </p>
              </Card>
            </section>
          )}

          {section === 'usage' && (
            <section role="tabpanel" id="admin-panel-usage" aria-labelledby="admin-tab-usage" className="space-y-4">
              <SectionHeader
                title="Usage"
                detail="What the accounts on this deployment actually did in the product: workspaces opened, designs committed, exports produced and solver runs."
              >
                <Picker label="Window" value={usageDays} onChange={(value) => setUsageDays(Number(value))}>
                  {WINDOWS.map((days) => <option key={days} value={days}>{`${days} days`}</option>)}
                </Picker>
                <Picker label="Action kind" value={kindFilter} onChange={(value) => setKindFilter(value as 'all' | UsageKind)}>
                  {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </Picker>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center gap-1.5"
                  title="Download the visible usage rows as a CSV file"
                  onClick={() => downloadCsv(
                    `folio-usage-${new Date().toISOString().slice(0, 10)}.csv`,
                    ['timestamp', 'account', 'email', 'kind', 'detail'],
                    filteredEvents.map((event) => [
                      new Date(event.at).toISOString(),
                      accountName(event.user),
                      accountById.get(event.user)?.email ?? '',
                      event.kind,
                      JSON.stringify(event.detail ?? {}),
                    ]),
                  )}
                >
                  <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> CSV
                </Button>
              </SectionHeader>

              {usageError && <Alert tone="destructive">{`Usage could not be read: ${usageError}`}</Alert>}
              {truncated && (
                <Alert tone="warning">
                  This window holds more than 10,000 events, so only the newest 10,000 are shown. Narrow the window for a complete count.
                </Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Events" value={summary.total.toLocaleString()} hint={`Recorded in the last ${usageDays} days`} icon={Activity} />
                <Kpi label="Accounts active" value={String(summary.byUser.length)} hint={`of ${accounts.length} in the directory`} icon={Users} />
                <Kpi label="Exports" value={String(summary.byKind.find((row) => row.kind === 'export.run')?.count ?? 0)} hint="Files produced for manufacture or interchange" icon={FileDown} />
                <Kpi label="Simulations" value={String(summary.byKind.find((row) => row.kind === 'simulation.run')?.count ?? 0)} hint="Solver runs across every domain" icon={Wrench} />
              </div>

              <div className="grid gap-4 lg:grid-cols-3">
                <Card className="p-4 lg:col-span-2">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-foreground">Daily activity</h3>
                    <span className="text-[11px] tabular-nums text-muted-foreground">{summary.total.toLocaleString()} recorded actions</span>
                  </div>
                  <DailyChart data={summary.daily} />
                </Card>
                <div className="space-y-4">
                  <Card className="p-4">
                    <h3 className="mb-3 text-sm font-semibold text-foreground">By action</h3>
                    {summary.byKind.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No activity in this window.</p>
                    ) : (
                      <ul className="space-y-1.5">
                        {summary.byKind.map((row, index) => (
                          <li key={row.kind} className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ background: CHART_HUES[index % CHART_HUES.length] }} />
                              <span className="truncate text-foreground">{USAGE_KIND_LABELS[row.kind]}</span>
                            </span>
                            <span className="flex-shrink-0 tabular-nums text-muted-foreground">{row.count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                  <Card className="p-4">
                    <h3 className="mb-1 text-sm font-semibold text-foreground">Domains opened</h3>
                    <p className="mb-3 text-[11px] text-muted-foreground">Which engineering workspaces the product is actually used for.</p>
                    {summary.byMode.length === 0 ? (
                      <p className="text-xs text-muted-foreground">No workspace opens recorded in this window.</p>
                    ) : (
                      <ul className="space-y-2">
                        {summary.byMode.map((modeRow, index) => {
                          const max = summary.byMode[0]?.count ?? 1
                          return (
                            <li key={modeRow.mode}>
                              <div className="flex items-center justify-between gap-2 text-[11px]">
                                <span className="truncate capitalize text-foreground">{modeRow.mode.replace(/-/g, ' ')}</span>
                                <span className="flex-shrink-0 tabular-nums text-muted-foreground">{modeRow.count}</span>
                              </div>
                              <div className="mt-1 h-1.5 rounded-full bg-muted">
                                <div className="h-1.5 rounded-full" style={{ width: `${Math.max(4, (modeRow.count / max) * 100)}%`, background: CHART_HUES[index % CHART_HUES.length] }} />
                              </div>
                            </li>
                          )
                        })}
                      </ul>
                    )}
                  </Card>
                </div>
              </div>

              <Card className="scrollbar-overlay max-h-[560px] overflow-auto">
                <table className="admin-table min-w-[720px]">
                  <caption className="sr-only">Recorded usage events</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Account</th>
                      <th scope="col">Action</th>
                      <th scope="col">Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEvents.slice(0, 300).map((event) => (
                      <tr key={event.id}>
                        <td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(event.at)}</td>
                        <td className="text-foreground">{accountName(event.user)}</td>
                        <td className="text-foreground">{USAGE_KIND_LABELS[event.kind]}</td>
                        <td className="text-muted-foreground">
                          {event.detail ? Object.entries(event.detail).map(([key, value]) => `${key}=${String(value)}`).join(', ') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredEvents.length === 0 && (
                  <div className="p-6">
                    <EmptyState
                      title="No events in this window"
                      detail={usageError ? usageError : 'Events arrive as accounts open workspaces, commit designs, export and run solvers.'}
                    />
                  </div>
                )}
                {filteredEvents.length > 300 && (
                  <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                    {`Showing the newest 300 of ${filteredEvents.length.toLocaleString()} matching events. The CSV export contains all of them.`}
                  </p>
                )}
              </Card>
            </section>
          )}

          {section === 'quotas' && (
            <section role="tabpanel" id="admin-panel-quotas" aria-labelledby="admin-tab-quotas" className="space-y-5">
              <SectionHeader
                title="Quotas"
                detail="The limits each role gets on this deployment. A blank limit means unlimited. The database enforces these on insert, so a limit holds even if a client ignores it."
              />

              {policyError && <Alert tone="warning">{`The stored policies could not be read: ${policyError}. The defaults below are shown instead.`}</Alert>}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Projects" value={stats ? stats.projects.toLocaleString() : '—'} hint={stats ? 'Designs stored on this deployment' : deployment?.statsError ?? 'Deployment totals unavailable'} icon={Database} />
                <Kpi label="Exports today" value={stats ? stats.exportsToday.toLocaleString() : '—'} hint="Across every account since midnight" icon={FileDown} />
                <Kpi label="Solver runs today" value={stats ? stats.simulationsToday.toLocaleString() : '—'} hint="Across every account since midnight" icon={Wrench} />
                <Kpi label="Accounts at a limit" value={String(todayRows.filter((row) => row.ratio >= 1).length)} hint={`${todayRows.filter((row) => row.ratio >= 0.8 && row.ratio < 1).length} more above 80% of a daily limit`} icon={AlertTriangle} />
              </div>

              {(['engineer', 'viewer'] as const).map((role) => (
                <Card key={role} className="p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-foreground">{ROLE_LABELS[role]} policy</h3>
                      <p className="text-[11px] text-muted-foreground">
                        {`${ROLE_DESCRIPTIONS[role]} ${roleCounts[role] + (role === 'viewer' ? roleCounts.user : 0)} account${roleCounts[role] + (role === 'viewer' ? roleCounts.user : 0) === 1 ? '' : 's'} governed.`}
                      </p>
                    </div>
                    <Button size="sm" disabled={savingPolicy === role} onClick={() => { void savePolicy(role) }}>
                      {savingPolicy === role ? 'Saving…' : 'Save policy'}
                    </Button>
                  </div>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    {LIMIT_FIELDS.map(([key, label, unit]) => (
                      <label key={key} className="text-[11px] text-muted-foreground">
                        {label} <span className="text-muted-foreground/70">({unit})</span>
                        <input
                          type="number"
                          min={0}
                          step="any"
                          inputMode="decimal"
                          placeholder="Unlimited"
                          aria-label={`${ROLE_LABELS[role]} ${label} limit`}
                          className="mt-1 min-h-8 w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          value={policyDraft[role][key]}
                          onChange={(event) => setPolicyDraft((current) => ({
                            ...current,
                            [role]: { ...current[role], [key]: event.target.value },
                          }))}
                        />
                      </label>
                    ))}
                  </div>
                  {policyStatus?.role === role && <div className="mt-3"><Alert tone={policyStatus.tone}>{policyStatus.message}</Alert></div>}
                </Card>
              ))}

              <Card className="p-4">
                <h3 className="text-sm font-semibold text-foreground">Today against policy</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Daily limits are per account, not per deployment. These are the accounts that exported or ran a solver since midnight.
                </p>
                {todayRows.length === 0 ? (
                  <div className="mt-3">
                    <EmptyState title="No exports or solver runs today" detail="The daily counters reset at midnight in the deployment's time zone." />
                  </div>
                ) : (
                  <div className="mt-3 overflow-x-auto">
                    <table className="admin-table min-w-[640px]">
                      <caption className="sr-only">Accounts against their daily export and simulation limits</caption>
                      <thead>
                        <tr>
                          <th scope="col">Account</th>
                          <th scope="col">Role</th>
                          <th scope="col">Exports today</th>
                          <th scope="col">Solver runs today</th>
                        </tr>
                      </thead>
                      <tbody>
                        {todayRows.map((row) => (
                          <tr key={row.id}>
                            <td className="text-foreground">{row.name}</td>
                            <td className="text-muted-foreground">{row.role === 'user' ? 'Unassigned' : ROLE_LABELS[row.role]}</td>
                            <td>
                              <p className="text-[11px] tabular-nums text-foreground">
                                {row.exports} <span className="text-muted-foreground">/ {row.limits.maxExportsPerDay === null ? 'unlimited' : row.limits.maxExportsPerDay}</span>
                              </p>
                              <div className="mt-1.5 max-w-[180px]"><Meter used={row.exports} limit={row.limits.maxExportsPerDay} /></div>
                            </td>
                            <td>
                              <p className="text-[11px] tabular-nums text-foreground">
                                {row.simulations} <span className="text-muted-foreground">/ {row.limits.maxSimulationsPerDay === null ? 'unlimited' : row.limits.maxSimulationsPerDay}</span>
                              </p>
                              <div className="mt-1.5 max-w-[180px]"><Meter used={row.simulations} limit={row.limits.maxSimulationsPerDay} /></div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card className="p-4">
                <h3 className="text-xs font-semibold text-foreground">How the limits are enforced</h3>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li>Project creation is blocked by a database trigger when the account is at its project limit.</li>
                  <li>Exports and solver runs are blocked by a trigger that counts the account&apos;s events since midnight.</li>
                  <li>Storage is a policy figure only: the browser reports its own estimate, and the server does not measure an account&apos;s design bytes.</li>
                  <li>Owner and administrator limits are fixed at unlimited so the console can never lock itself out.</li>
                </ul>
              </Card>
            </section>
          )}

          {section === 'audit' && (
            <section role="tabpanel" id="admin-panel-audit" aria-labelledby="admin-tab-audit" className="space-y-4">
              <SectionHeader
                title="Audit trail"
                detail="Every change an operator made on this deployment, recorded in the database as part of the same call. The trail is append-only."
              >
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center gap-1.5"
                  title="Download the audit trail as a CSV file"
                  onClick={() => downloadCsv(
                    `folio-audit-${new Date().toISOString().slice(0, 10)}.csv`,
                    ['timestamp', 'operator', 'action', 'resource', 'details'],
                    audit.map((entry) => [
                      new Date(entry.at).toISOString(),
                      accountName(entry.actor),
                      entry.action,
                      entry.resource,
                      JSON.stringify(entry.details),
                    ]),
                  )}
                >
                  <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> CSV
                </Button>
              </SectionHeader>

              {auditError && <Alert tone="warning">{`The audit trail could not be read: ${auditError}`}</Alert>}

              <Card className="scrollbar-overlay max-h-[600px] overflow-auto">
                <table className="admin-table min-w-[720px]">
                  <caption className="sr-only">Operator audit trail entries</caption>
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Operator</th>
                      <th scope="col">Action</th>
                      <th scope="col">Account or policy</th>
                      <th scope="col">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {audit.map((entry) => (
                      <tr key={entry.id}>
                        <td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(entry.at)}</td>
                        <td className="text-foreground">{accountName(entry.actor)}</td>
                        <td className="text-foreground">{entry.action.replace(/^admin:/, '').replace(/_/g, ' ')}</td>
                        <td className="text-muted-foreground">
                          {entry.resource === 'admin-console' ? 'This console' : accountById.has(entry.resource) ? accountName(entry.resource) : entry.resource}
                        </td>
                        <td className="max-w-[260px] truncate text-muted-foreground">{JSON.stringify(entry.details)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {audit.length === 0 && (
                  <div className="p-6">
                    <EmptyState
                      title="No operator actions recorded yet"
                      detail={auditError ? auditError : 'Role changes, suspensions and policy edits appear here as they happen.'}
                    />
                  </div>
                )}
              </Card>
            </section>
          )}

          {section === 'faq' && (
            <section role="tabpanel" id="admin-panel-faq" aria-labelledby="admin-tab-faq" className="space-y-4">
              <FaqPanel api={api} onReload={() => { void load() }} />
            </section>
          )}

          {section === 'deployment' && (
            <section role="tabpanel" id="admin-panel-deployment" aria-labelledby="admin-tab-deployment" className="space-y-4">
              <SectionHeader
                title="Deployment"
                detail="The Folio installation this console operates, and what it can honestly do."
              />

              {deployment?.statsError && (
                <Alert tone="warning">{`Deployment totals are unavailable: ${deployment.statsError}`}</Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Projects" value={stats ? stats.projects.toLocaleString() : '—'} hint="Designs stored across all accounts" icon={Database} />
                <Kpi label="Accounts" value={stats ? stats.accounts.toLocaleString() : String(accounts.length)} hint={stats ? `${stats.activeAccounts} active · ${stats.suspendedAccounts} suspended` : 'From the directory read'} icon={Users} />
                <Kpi label="Usage events" value={stats ? stats.usageEvents.toLocaleString() : '—'} hint="All time, across every account" icon={Activity} />
                <Kpi label="Operator actions" value={stats ? stats.auditEvents.toLocaleString() : String(audit.length)} hint="Recorded in the audit trail" icon={Shield} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Card className="p-4">
                  <p className="text-[11px] text-muted-foreground">Identity and data</p>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">{deployment?.host || 'Unknown host'}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    Accounts, designs, usage and policies live in this managed deployment. The console reads them through
                    row-level security that admits operators only.
                  </p>
                </Card>
                <Card className="p-4">
                  <p className="text-[11px] text-muted-foreground">Always-on agent runner</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{deployment?.agentRunnerConfigured ? 'Configured' : 'Not configured'}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {deployment?.agentRunnerConfigured
                      ? 'Agent jobs can keep running after the designer closes the tab.'
                      : 'Agent jobs stop when the designer closes the tab. Set VITE_AGENT_CLOUD_URL on the workbench build to change that.'}
                  </p>
                </Card>
                <Card className="p-4">
                  <p className="text-[11px] text-muted-foreground">Your operator access</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{ROLE_LABELS[operator.role]}</p>
                  <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                    {canTouchOwner
                      ? 'Owners can grant or remove the owner role and change any account.'
                      : 'Administrators manage engineers and viewers. Only an owner can change an owner account.'}
                  </p>
                </Card>
              </div>

              {stats && Object.keys(stats.projectsByRole).length > 0 && (
                <Card className="p-4">
                  <h3 className="text-sm font-semibold text-foreground">Projects by role</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">Who is producing designs, counted by the role of the account that owns them.</p>
                  <ul className="mt-3 space-y-2">
                    {Object.entries(stats.projectsByRole).sort((a, b) => b[1] - a[1]).map(([role, total], index) => {
                      const max = Math.max(1, ...Object.values(stats.projectsByRole))
                      const label = roleLabel(role)
                      return (
                        <li key={role}>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-foreground">{label}</span>
                            <span className="flex-shrink-0 tabular-nums text-muted-foreground">{total.toLocaleString()}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-muted">
                            <div className="h-1.5 rounded-full" style={{ width: `${Math.max(3, (total / max) * 100)}%`, background: CHART_HUES[index % CHART_HUES.length] }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </Card>
              )}

              <Card className="p-4">
                <h3 className="text-xs font-semibold text-foreground">What this console does not do</h3>
                <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                  <li>It does not open, read or export anyone&apos;s design. Project totals are counts only.</li>
                  <li>It cannot invite accounts: that needs a service-role server function, which must never ship to a browser.</li>
                  <li>It cannot delete usage or audit rows. Both ledgers are append-only for every client, including operators.</li>
                  <li>It has no local mode. With no deployment configured there are no accounts to manage, and the console says so instead of inventing a directory.</li>
                </ul>
              </Card>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}