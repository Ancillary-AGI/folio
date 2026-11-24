import HoverHelp from '../components/ui/HoverHelp'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, ChevronDown, Database, FileDown, LogOut,
  RefreshCw, Search, Shield, Users, Wrench, X,
} from 'lucide-react'
import TestimonialPanel from './TestimonialPanel'
import NewsletterPanel from './NewsletterPanel'
import FaqPanel from './FaqPanel'
import LegalPanel from './LegalPanel'
import SiteSettingsPanel from './SiteSettingsPanel'
import OverviewPanel from './OverviewPanel'
import IamPanel from './IamPanel'
import { Button } from '../components/ui/button'
import { FolioMark } from '../components/brand/FolioLogo'
import Avatar from '../components/Avatar'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useConfirm } from '../components/ui/useConfirm'
import type {
  AccessModel, Account, AdminApi, AuditEntry, DeploymentInfo,
} from '../lib/admin/adminService'
import type { Operator } from '../lib/admin/operatorSession'
import {
  ADMIN_ROLES, DEFAULT_QUOTA_POLICIES, ROLE_DESCRIPTIONS, ROLE_LABELS, parseQuotaLimit,
  type AdminRole, type QuotaLimits, type QuotaSubject,
} from '../lib/admin/quotaPolicy'
import {
  USAGE_KINDS, summarizeUsage, usageByAccount, usageKindLabel,
  type UsageEvent, type UsageKind,
} from '../lib/admin/usageLedger'
import {
  CAPABILITY_DEFINITIONS, isConsoleRole, hasCapability, type Capability,
} from '../lib/admin/permissions'
import { dailyQuotaPressure } from '../lib/admin/analytics'
import { ADMIN_SECTIONS, SECTION_GROUPS, type SectionId } from './sections'
import {
  Alert, Card, CHART_HUES, EmptyState, Kpi, Meter, PICKER_CLASS, Picker,
  SectionHeader, StatusChip,
} from './shared'
import { downloadCsv, formatTime, roleLabel } from './format'

/*
 * The console for the people who run Folio: the accounts that use the product,
 * what each one actually did, the limits that govern them, and the record of
 * what operators changed. It is a separate document with its own session — the
 * workbench has no route to it and no link to it. Every number on screen is a
 * read from the deployment; nothing here is inferred from this browser.
 *
 * The opening screen is the Overview. The rail is grouped by the job an
 * operator is doing, and each section is driven by the same rows the overview
 * rolls up, so a figure on the dashboard always has a table behind it.
 */

const WINDOWS = [7, 14, 30, 90] as const

type AccountSort = 'active' | 'recent' | 'name' | 'role'
type RoleFilter = 'all' | QuotaSubject
type StatusFilter = 'all' | Account['status']

const KIND_OPTIONS: Array<{ value: 'all' | UsageKind; label: string }> = [
  { value: 'all', label: 'All activity' },
  ...USAGE_KINDS.map((kind) => ({ value: kind, label: usageKindLabel(kind) })),
]

const LIMIT_FIELDS: Array<[keyof QuotaLimits, string, string]> = [
  ['maxProjects', 'Projects', 'projects'],
  ['maxExportsPerDay', 'Exports / day', 'exports'],
  ['maxSimulationsPerDay', 'Simulations / day', 'runs'],
  ['maxStorageMb', 'Storage (MB)', 'MB'],
]

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
  const [section, setSection] = useState<SectionId>('overview')
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
  const [access, setAccess] = useState<AccessModel | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  const [usageDays, setUsageDays] = useState<number>(14)
  const [kindFilter, setKindFilter] = useState<'all' | UsageKind>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<AccountSort>('active')
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [openAccount, setOpenAccount] = useState('')
  const [busyAccount, setBusyAccount] = useState('')
  const [accountNotice, setAccountNotice] = useState<{ message: string; tone: 'destructive' | 'warning' } | null>(null)
  const [policyDraft, setPolicyDraft] = useState<Draft>(() => draftFrom({ ...DEFAULT_QUOTA_POLICIES }))
  const [policyStatus, setPolicyStatus] = useState<{ role: AdminRole; message: string; tone: 'success' | 'destructive' | 'warning' } | null>(null)
  const [savingPolicy, setSavingPolicy] = useState<AdminRole | ''>('')

  const { spec: confirmSpec, confirm, resolve: resolveConfirm } = useConfirm()

  const opened = useRef(false)
  useEffect(() => {
    if (opened.current) return
    opened.current = true
    void api.recordOpen()
  }, [api])

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const [directory, usage, policy, trail, info, accessModel] = await Promise.all([
        api.listAccounts(),
        api.loadUsage(usageDays),
        api.loadPolicies(),
        api.loadAudit(200),
        api.loadDeployment(),
        api.loadAccessModel(),
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
      setAccess(accessModel)
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
  const pressure = useMemo(() => dailyQuotaPressure(accounts, events, policies), [accounts, events, policies])

  const can = useCallback(
    (capability: Capability) => hasCapability(operator.role, capability),
    [operator.role],
  )
  const canManageAccounts = can('accounts.manage')
  const canManageOwners = can('operators.manage_owner')
  const canExport = can('data.export')
  const canEditQuotas = can('quotas.manage')

  const filteredEvents = useMemo(() => {
    const rows = kindFilter === 'all' ? events : events.filter((event) => event.kind === kindFilter)
    return [...rows].sort((a, b) => b.at - a.at)
  }, [events, kindFilter])

  const visibleAccounts = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const rows = accounts.filter((account) => {
      if (roleFilter !== 'all' && account.role !== roleFilter) return false
      if (statusFilter !== 'all' && account.status !== statusFilter) return false
      if (!needle) return true
      return `${account.name} ${account.email}`.toLowerCase().includes(needle)
    })
    const count = (account: Account) => accountUsage.get(account.id)?.events ?? 0
    const last = (account: Account) => accountUsage.get(account.id)?.lastAt ?? account.lastSeenAt ?? 0
    rows.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'role') return a.role.localeCompare(b.role) || a.name.localeCompare(b.name)
      if (sort === 'recent') return last(b) - last(a) || a.name.localeCompare(b.name)
      return count(b) - count(a) || a.name.localeCompare(b.name)
    })
    return rows
  }, [accounts, accountUsage, query, sort, roleFilter, statusFilter])

  const maxAccountEvents = useMemo(
    () => Math.max(1, ...accounts.map((account) => accountUsage.get(account.id)?.events ?? 0)),
    [accounts, accountUsage],
  )

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { owner: 0, admin: 0, engineer: 0, viewer: 0, user: 0 }
    for (const account of accounts) counts[account.role] = (counts[account.role] ?? 0) + 1
    return counts
  }, [accounts])

  const suspendedCount = accounts.filter((account) => account.status === 'suspended').length
  const atLimit = pressure.filter((row) => row.state === 'fail')
  const nearLimit = pressure.filter((row) => row.state === 'warn')

  const applyResult = (result: { ok: boolean; error?: string; warning?: string }) => {
    if (!result.ok) setAccountNotice({ message: result.error ?? 'The change was refused.', tone: 'destructive' })
    else if (result.warning) setAccountNotice({ message: result.warning, tone: 'warning' })
    else setAccountNotice(null)
  }

  const changeRole = async (account: Account, role: AdminRole) => {
    if (role === account.role) return
    const from = roleLabel(account.role)
    const to = ROLE_LABELS[role]
    const detail = role === 'owner'
      ? `${account.name} will be able to change any account, including other owners. Owner changes are reserved to owners for exactly this reason. Their designs and history are kept.`
      : role === 'admin'
        ? `${account.name} will be able to open this console, manage accounts, policies and public content, but cannot grant or change an owner. Their designs and history are kept.`
        : `${account.name} will lose console access and be governed by the ${to.toLowerCase()} policy. Their designs, projects and recorded usage are kept.`
    const accepted = await confirm({
      title: `Change ${account.name} from ${from} to ${to}?`,
      detail,
      confirmLabel: `Change to ${to}`,
      destructive: !isConsoleRole(role),
    })
    if (!accepted) return
    setBusyAccount(account.id)
    applyResult(await api.setRole(account.id, role))
    setBusyAccount('')
    await load()
  }

  const changeStatus = async (account: Account, status: Account['status']) => {
    const accepted = await confirm({
      title: status === 'suspended' ? `Suspend ${account.name}?` : `Restore ${account.name}?`,
      detail: status === 'suspended'
        ? 'They will be signed out on their next request and cannot sign in to the workbench until an operator restores them. Their designs and history are kept.'
        : 'They will be able to sign in to the workbench again under their current role and policy.',
      confirmLabel: status === 'suspended' ? 'Suspend access' : 'Restore access',
      destructive: status === 'suspended',
    })
    if (!accepted) return
    setBusyAccount(account.id)
    applyResult(await api.setStatus(account.id, status))
    setBusyAccount('')
    await load()
  }

  const savePolicy = async (role: 'engineer' | 'viewer') => {
    if (!canEditQuotas) {
      setPolicyStatus({ role, message: 'This account does not hold the quotas.manage capability.', tone: 'destructive' })
      return
    }
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

  const exportDirectory = () => {
    if (!canExport) return
    downloadCsv(
      `folio-accounts-${new Date().toISOString().slice(0, 10)}.csv`,
      ['name', 'email', 'role', 'status', 'last_seen', 'actions_in_window', 'busiest_action'],
      visibleAccounts.map((account) => {
        const usage = accountUsage.get(account.id)
        return [
          account.name,
          account.email,
          roleLabel(account.role),
          account.status,
          formatTime(usage?.lastAt ?? account.lastSeenAt ?? 0),
          String(usage?.events ?? 0),
          usage ? usageKindLabel(usage.topKind) : '',
        ]
      }),
    )
  }

  const railCounts: Partial<Record<SectionId, number>> = {
    accounts: accounts.length,
    iam: accounts.filter((account) => isConsoleRole(account.role)).length,
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
      <header className="app-chrome flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <FolioMark className="h-6 w-6 flex-shrink-0 text-primary" />
          <h1 className="truncate text-sm font-semibold text-foreground">Admin console</h1>
          {deployment?.host && (
            <span className="hidden font-mono text-[11px] text-muted-foreground sm:inline">Folio operations · {deployment.host}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="cad-chip border-primary/40 bg-primary/10 text-primary">{`${operator.name} · ${ROLE_LABELS[operator.role]}`}</span>
          {accounts.length > 0 && (
            <span className="cad-chip">{`${summary.byUser.length} of ${accounts.length} accounts active · ${usageDays}d`}</span>
          )}
          <HoverHelp title="Reload deployment data" description="Reload accounts, usage, policies and the audit trail from the deployment.">
            <Button variant="ghost" size="icon" onClick={() => { void load() }} aria-label="Reload deployment data">
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </Button>
          </HoverHelp>
          <Button variant="outline" size="sm" className="flex items-center gap-1.5" onClick={onSignOut}>
            <LogOut className="h-3.5 w-3.5" aria-hidden="true" /> Sign out
          </Button>
        </div>
      </header>

      <div className="flex w-full max-w-[1500px] flex-1 flex-col self-center lg:flex-row">
        <nav className="admin-rail" aria-label="Admin console sections">
          <div className="admin-rail__list" role="tablist" aria-orientation="vertical">
            {SECTION_GROUPS.map((group) => (
              <Fragment key={group}>
                <p
                  role="presentation"
                  aria-hidden="true"
                  className="mb-1 mt-3 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground first:mt-0"
                >
                  {group}
                </p>
                {ADMIN_SECTIONS.filter((entry) => entry.group === group).map((entry) => {
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
                      title={entry.hint}
                      onClick={() => setSection(entry.id)}
                      className="admin-rail__item"
                    >
                      <Icon className="admin-rail__icon" aria-hidden="true" />
                      <span className="truncate">{entry.label}</span>
                      {count !== undefined && <span className="admin-rail__count" aria-hidden="true">{count}</span>}
                    </button>
                  )
                })}
              </Fragment>
            ))}
          </div>
          <p className="admin-rail__note">
            {suspendedCount > 0 ? (
              <span className="admin-rail__note--alert">
                {suspendedCount} account{suspendedCount === 1 ? '' : 's'} suspended. They cannot sign in to the workbench.
              </span>
            ) : (
              'Every account in the directory is active.'
            )}
          </p>
        </nav>

        <main className="min-w-0 flex-1 px-4 py-5 sm:px-6">
          {section === 'overview' && (
            <OverviewPanel
              operator={operator}
              accounts={accounts}
              events={events}
              summary={summary}
              usageDays={usageDays}
              policies={policies}
              audit={audit}
              deployment={deployment}
              accountUsage={accountUsage}
              errors={{ accounts: accountsError, usage: usageError, policies: policyError, audit: auditError }}
              onOpen={setSection}
              onInspectAccount={(account) => {
                setQuery(account.email || account.name)
                setOpenAccount(account.id)
                setSection('accounts')
              }}
              onWindow={setUsageDays}
            />
          )}

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
                    <HoverHelp title="Clear the search" description="Empty the search box.">
                      <button type="button" aria-label="Clear account search" onClick={() => setQuery('')} className="text-muted-foreground hover:text-foreground">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </HoverHelp>
                  )}
                </label>
                <Picker label="Filter by role" value={roleFilter} onChange={(value) => setRoleFilter(value as RoleFilter)}>
                  <option value="all">All roles</option>
                  {ADMIN_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                  <option value="user">Unassigned</option>
                </Picker>
                <Picker label="Filter by status" value={statusFilter} onChange={(value) => setStatusFilter(value as StatusFilter)}>
                  <option value="all">Any status</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </Picker>
                <Picker label="Order accounts" value={sort} onChange={(value) => setSort(value as AccountSort)}>
                  <option value="active">Most activity</option>
                  <option value="recent">Most recent</option>
                  <option value="role">Role</option>
                  <option value="name">Name A–Z</option>
                </Picker>
                <Picker label="Activity window" value={usageDays} onChange={(value) => setUsageDays(Number(value))}>
                  {WINDOWS.map((days) => <option key={days} value={days}>{`${days} days`}</option>)}
                </Picker>
                <HoverHelp title="Download the filtered directory as a CSV file" description="Download the filtered directory as a CSV file">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5"
                    disabled={!canExport}
                    onClick={exportDirectory}
                  >
                    <FileDown className="h-3.5 w-3.5" aria-hidden="true" /> CSV
                  </Button>
                </HoverHelp>
              </SectionHeader>

              {accountNotice && <Alert tone={accountNotice.tone}>{accountNotice.message}</Alert>}
              {accountsError && <Alert tone="warning">{`The account directory could not be read: ${accountsError}`}</Alert>}
              {usageError && <Alert tone="warning">{`Usage could not be read, so the activity columns are empty: ${usageError}`}</Alert>}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Accounts" value={String(accounts.length)} hint={`${accounts.length - suspendedCount} active · ${suspendedCount} suspended`} icon={Users} tone="primary" />
                <Kpi label="Operators" value={String(roleCounts.owner + roleCounts.admin)} hint={`${roleCounts.owner} owner · ${roleCounts.admin} administrator`} icon={Shield} tone="amber" />
                <Kpi label="Engineers" value={String(roleCounts.engineer)} hint={ROLE_DESCRIPTIONS.engineer} icon={Wrench} tone="success" />
                <Kpi label="Viewers" value={String(roleCounts.viewer + roleCounts.user)} hint={`${roleCounts.user} unassigned, governed by the viewer policy`} icon={Activity} tone="muted" />
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
                      const locked = self || (account.role === 'owner' && !canManageOwners) || !canManageAccounts
                      const busy = busyAccount === account.id
                      return (
                        <Fragment key={account.id}>
                          <tr>
                            <td>
                              <div className="flex min-w-0 items-center gap-2.5">
                                <Avatar name={account.name} size={28} className="h-7 w-7 flex-shrink-0 rounded-md" />
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-foreground">{account.name}{self ? ' (you)' : ''}</p>
                                  <p className="truncate text-[10px] text-muted-foreground">{account.email || 'No email on record'}</p>
                                </div>
                              </div>
                            </td>
                            <td>
                              {locked ? (
                                <span className="text-foreground">
                                  {roleLabel(account.role)}
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
                                  {ADMIN_ROLES.filter((role) => canManageOwners || role !== 'owner').map((role) => (
                                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                                  ))}
                                </select>
                              )}
                            </td>
                            <td><StatusChip status={account.status} /></td>
                            <td>
                              {usage ? (
                                <div className="flex min-w-[150px] items-center gap-2">
                                  <span className="w-7 flex-shrink-0 text-right text-[11px] font-medium tabular-nums text-foreground">{usage.events}</span>
                                  <span aria-hidden="true" className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                                    <span className="block h-full rounded-full bg-primary/70" style={{ width: `${Math.max(8, Math.round((usage.events / maxAccountEvents) * 100))}%` }} />
                                  </span>
                                  <span className="flex-shrink-0 truncate text-[10px] text-muted-foreground">{usageKindLabel(usage.topKind)}</span>
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
                                  <span className="text-[10px] text-muted-foreground">
                                    {self ? 'Signed in here' : account.role === 'owner' ? 'Owner only' : 'Read-only'}
                                  </span>
                                ) : account.status === 'active' ? (
                                  <Button variant="ghost" size="sm" disabled={busy} aria-label={`Suspend ${account.name}`} onClick={() => { void changeStatus(account, 'suspended') }}>
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
                                      <span key={kind.kind} className="cad-chip">{`${usageKindLabel(kind.kind)} · ${kind.count}`}</span>
                                    ))}
                                  </div>
                                  <ul className="space-y-1">
                                    {events.filter((event) => event.user === account.id).sort((a, b) => b.at - a.at).slice(0, 8).map((event) => (
                                      <li key={event.id} className="flex items-baseline justify-between gap-3 text-[11px]">
                                        <span className="truncate text-foreground">
                                          {usageKindLabel(event.kind)}
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
                    {accountsError ? (
                      <EmptyState title="The account directory could not be read" detail={`${accountsError} Reload to try again.`} />
                    ) : query.trim() !== '' || roleFilter !== 'all' || statusFilter !== 'all' ? (
                      <EmptyState
                        /* Echo the term: "no account matches" alone leaves the
                         * operator guessing whether the search ran at all. */
                        title={query.trim() !== '' ? `No account matches “${query.trim()}”` : 'No account matches these filters'}
                        detail="Clear the search or widen the role and status filters to see the full directory."
                      />
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

          {section === 'iam' && (
            <IamPanel
              operator={operator}
              accounts={accounts}
              access={access}
              busyAccount={busyAccount}
              onChangeRole={(account, role) => { void changeRole(account, role) }}
              onOpenAccounts={() => setSection('accounts')}
            />
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
                <HoverHelp title="Download the visible usage rows as a CSV file" description="Download the visible usage rows as a CSV file">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5"
                    disabled={!canExport}
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
                </HoverHelp>
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
                              <span className="truncate text-foreground">{usageKindLabel(row.kind)}</span>
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
                        <td className="text-foreground">{usageKindLabel(event.kind)}</td>
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
              {!canEditQuotas && <Alert tone="warning">This account can read the policies but does not hold the quotas.manage capability, so the save controls are disabled.</Alert>}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Projects" value={stats ? stats.projects.toLocaleString() : '—'} hint={stats ? 'Designs stored on this deployment' : deployment?.statsError ?? 'Deployment totals unavailable'} icon={Database} />
                <Kpi label="Exports today" value={stats ? stats.exportsToday.toLocaleString() : '—'} hint="Across every account since midnight" icon={FileDown} />
                <Kpi label="Solver runs today" value={stats ? stats.simulationsToday.toLocaleString() : '—'} hint="Across every account since midnight" icon={Wrench} />
                <Kpi label="Accounts at a limit" value={String(atLimit.length)} hint={`${nearLimit.length} more above 80% of a daily limit`} icon={AlertTriangle} />
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
                    <Button size="sm" disabled={savingPolicy === role || !canEditQuotas} onClick={() => { void savePolicy(role) }}>
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
                          disabled={!canEditQuotas}
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
                {pressure.length === 0 ? (
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
                        {pressure.map((row) => (
                          <tr key={row.id}>
                            <td className="text-foreground">{row.name}</td>
                            <td className="text-muted-foreground">{roleLabel(row.role)}</td>
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
                <HoverHelp title="Download the audit trail as a CSV file" description="Download the audit trail as a CSV file">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex items-center gap-1.5"
                    disabled={!canExport}
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
                </HoverHelp>
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
              {can('content.manage') ? (
                <FaqPanel api={api} onReload={() => { void load() }} />
              ) : (
                <Alert tone="warning">This account does not hold the content.manage capability.</Alert>
              )}
            </section>
          )}

          {section === 'legal' && (
            <section role="tabpanel" id="admin-panel-legal" aria-labelledby="admin-tab-legal" className="space-y-4">
              {can('content.manage') ? (
                <LegalPanel api={api} onReload={() => { void load() }} />
              ) : (
                <Alert tone="warning">This account does not hold the content.manage capability.</Alert>
              )}
            </section>
          )}

          {section === 'site' && (
            <section role="tabpanel" id="admin-panel-site" aria-labelledby="admin-tab-site" className="space-y-4">
              {can('content.manage') ? (
                <SiteSettingsPanel api={api} onReload={() => { void load() }} />
              ) : (
                <Alert tone="warning">This account does not hold the content.manage capability.</Alert>
              )}
            </section>
          )}

          {section === 'testimonials' && (
            <section role="tabpanel" id="admin-panel-testimonials" aria-labelledby="admin-tab-testimonials" className="space-y-4">
              {can('content.manage') ? (
                <TestimonialPanel api={api} onReload={() => { void load() }} />
              ) : (
                <Alert tone="warning">This account does not hold the content.manage capability.</Alert>
              )}
            </section>
          )}

          {section === 'newsletter' && (
            <section role="tabpanel" id="admin-panel-newsletter" aria-labelledby="admin-tab-newsletter" className="space-y-4">
              {can('newsletter.read') ? (
                <NewsletterPanel api={api} />
              ) : (
                <Alert tone="warning">This account does not hold the newsletter.read capability.</Alert>
              )}
            </section>
          )}

          {section === 'deployment' && (
            <section role="tabpanel" id="admin-panel-deployment" aria-labelledby="admin-tab-deployment" className="space-y-4">
              <SectionHeader title="Deployment" detail="What this installation runs and what it can reach." />

              {deployment?.statsError && (
                <Alert tone="warning">{`Totals unavailable: ${deployment.statsError}`}</Alert>
              )}

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <Kpi label="Projects" value={stats ? stats.projects.toLocaleString() : '—'} hint="Designs stored" icon={Database} />
                <Kpi label="Accounts" value={stats ? stats.accounts.toLocaleString() : String(accounts.length)} hint={stats ? `${stats.activeAccounts} active · ${stats.suspendedAccounts} suspended` : 'From the directory'} icon={Users} />
                <Kpi label="Usage events" value={stats ? stats.usageEvents.toLocaleString() : '—'} hint="Total recorded" icon={Activity} />
                <Kpi label="Audit trail" value={stats ? stats.auditEvents.toLocaleString() : String(audit.length)} hint="Operator actions" icon={Shield} />
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Card className="p-4">
                  <p className="text-[11px] text-muted-foreground">Deployment</p>
                  <p className="mt-1 truncate text-sm font-semibold text-foreground">{deployment?.host || 'Unknown'}</p>
                </Card>
                <Card className="p-4">
                  <p className="text-[11px] text-muted-foreground">Agent runner</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{deployment?.agentRunnerConfigured ? 'Configured' : 'Not configured'}</p>
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                    {deployment?.agentRunnerConfigured
                      ? 'Cloud agents can run after the browser closes.'
                      : 'Jobs stay in the browser until an operator configures the runner.'}
                  </p>
                </Card>
                <Card className="p-4">
                  <p className="text-[11px] text-muted-foreground">Your access</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{ROLE_LABELS[operator.role]}</p>
                  <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{`${access?.grants[operator.role].length ?? 0} of ${CAPABILITY_DEFINITIONS.length} capabilities granted`}</p>
                </Card>
              </div>

              {stats && Object.keys(stats.projectsByRole).length > 0 && (
                <Card className="p-4">
                  <h3 className="text-sm font-semibold text-foreground">Projects by role</h3>
                  <ul className="mt-3 space-y-2">
                    {Object.entries(stats.projectsByRole).sort((a, b) => b[1] - a[1]).map(([role, total], index) => {
                      const max = Math.max(1, ...Object.values(stats.projectsByRole))
                      return (
                        <li key={role}>
                          <div className="flex items-center justify-between gap-2 text-[11px]">
                            <span className="truncate text-foreground">{roleLabel(role)}</span>
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
            </section>
          )}
        </main>
      </div>

      <ConfirmDialog spec={confirmSpec} onResolve={resolveConfirm} />
    </div>
  )
}
