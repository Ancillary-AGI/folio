import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, ArrowLeft, CheckCircle2, Database, FileDown, Gauge,
  Layers, RefreshCw, Shield, ShieldCheck, Trash2, UserRound, Users, Wrench,
} from 'lucide-react'
import { Button } from '../ui/button'
import type { User } from '../../types'
import { siemService } from '../../lib/siem/siemService'
import {
  capabilities, listMembers, loadCloudUsage, loadEnvironment, loadProjectCount,
  recordAdminOpen, resolveAdminAccess, savePolicy, setMemberRole, setMemberStatus, syncCloudPolicies,
  type AdminAccess, type AdminEnvironment, type AdminMember, type CloudUsageSummary,
} from '../../lib/admin/adminService'
import {
  ADMIN_ROLES, ROLE_DESCRIPTIONS, ROLE_LABELS, checkQuotaCapacity, parseQuotaLimit, quotaRows,
  readQuotaPolicies, type AdminRole, type QuotaLimits,
} from '../../lib/admin/quotaPolicy'
import {
  countUsage, getUsageEvents, resetUsageLedger, subscribeUsage, summarizeUsage, usageSince,
  type UsageEvent, type UsageKind,
} from '../../lib/admin/usageLedger'
import { recordPlatformUsage } from '../../lib/admin/usageRecorder'

type TabId = 'overview' | 'people' | 'usage' | 'quotas' | 'audit' | 'environment'

const TABS: Array<{ id: TabId; label: string; icon: typeof Gauge }> = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'people', label: 'People', icon: Users },
  { id: 'usage', label: 'Usage', icon: Activity },
  { id: 'quotas', label: 'Quotas', icon: ShieldCheck },
  { id: 'audit', label: 'Audit trail', icon: Shield },
  { id: 'environment', label: 'Environment', icon: Database },
]

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
  'admin.open': 'Administration opened',
}

const KIND_OPTIONS: Array<{ value: 'all' | UsageKind; label: string }> = [
  { value: 'all', label: 'All activity' },
  ...(Object.keys(USAGE_KIND_LABELS) as UsageKind[]).map((kind) => ({ value: kind, label: USAGE_KIND_LABELS[kind] })),
]

function startOfToday(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function formatBytesMb(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return 'Unavailable'
  if (value >= 1024) return `${(value / 1024).toFixed(1)} GB`
  return `${value.toFixed(value >= 10 ? 0 : 1)} MB`
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

function downloadCsv(filename: string, header: string[], rows: string[][]): void {
  const escape = (value: string): string => `"${value.replace(/"/g, '""')}"`
  const csv = [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n')
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) return
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  // Detached anchors are not clickable in every browser, and revoking the URL
  // in the same task can cancel the download before it starts.
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function Kpi({ label, value, hint, icon: Icon }: { label: string; value: string; hint: string; icon: typeof Gauge }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </div>
      <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </div>
  )
}

function DailyChart({ data }: { data: Array<{ date: string; count: number }> }) {
  const max = Math.max(1, ...data.map((point) => point.count))
  const total = data.reduce((sum, point) => sum + point.count, 0)
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`Daily activity over ${data.length} days, ${total} events total`}>
        {data.map((point) => {
          const height = point.count === 0 ? 3 : Math.max(6, Math.round((point.count / max) * 100))
          return (
            <div
              key={point.date}
              className={`flex-1 rounded-sm ${point.count === 0 ? 'bg-muted' : 'bg-primary/70'}`}
              style={{ height: `${height}%` }}
              title={`${point.date}: ${point.count} event${point.count === 1 ? '' : 's'}`}
            />
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
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

interface AdminConsoleProps {
  user: User
  offlineMode: boolean
  onBack: () => void
}

export default function AdminConsole({ user, offlineMode, onBack }: AdminConsoleProps) {
  const [access, setAccess] = useState<AdminAccess | null>(null)
  const [tab, setTab] = useState<TabId>('overview')
  const [members, setMembers] = useState<AdminMember[]>([])
  const [membersError, setMembersError] = useState('')
  const [environment, setEnvironment] = useState<AdminEnvironment | null>(null)
  const [projectCount, setProjectCount] = useState(0)
  const [cloudUsage, setCloudUsage] = useState<CloudUsageSummary | null>(null)
  const [usageDays, setUsageDays] = useState(14)
  const [kindFilter, setKindFilter] = useState<'all' | UsageKind>('all')
  const [revision, setRevision] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [peopleError, setPeopleError] = useState('')
  const [busyMember, setBusyMember] = useState('')
  const [policyDraft, setPolicyDraft] = useState<Record<'engineer' | 'viewer', Record<keyof QuotaLimits, string>>>(
    () => draftFromPolicies(),
  )
  const [policyStatus, setPolicyStatus] = useState<{ role: AdminRole; message: string; ok: boolean } | null>(null)
  const [policySyncError, setPolicySyncError] = useState('')
  const [clearArmed, setClearArmed] = useState(false)
  const [audit, setAudit] = useState(() => siemService.getAuditTrail({ limit: 200 }))

  useEffect(() => subscribeUsage(() => setRevision((value) => value + 1)), [])

  useEffect(() => {
    let alive = true
    resolveAdminAccess(user, offlineMode)
      .then((result) => {
        if (!alive) return
        setAccess(result)
        if (result.allowed) {
          recordAdminOpen(user)
          recordPlatformUsage('admin.open', user, offlineMode, { role: result.role })
        }
      })
      .catch((error: unknown) => {
        if (!alive) return
        setAccess({ allowed: false, role: 'user', status: 'active', reason: error instanceof Error ? error.message : String(error) })
      })
    return () => { alive = false }
  }, [user, offlineMode])

  const refresh = useCallback(async () => {
    setRefreshing(true)
    try {
      const [memberResult, env, projects, policySync] = await Promise.all([
        listMembers(user, offlineMode),
        loadEnvironment(),
        loadProjectCount(user, offlineMode),
        syncCloudPolicies(offlineMode),
      ])
      setMembers(memberResult.members)
      setMembersError(memberResult.error ?? '')
      setEnvironment(env)
      setProjectCount(projects.count)
      setPolicySyncError(policySync ?? '')
      if (!offlineMode) setCloudUsage(await loadCloudUsage(usageDays))
      setAudit(siemService.getAuditTrail({ limit: 200 }))
      setPolicyDraft(draftFromPolicies())
    } finally {
      setRefreshing(false)
    }
  }, [user, offlineMode, usageDays])

  useEffect(() => {
    if (access?.allowed) void refresh()
  }, [access, refresh])

  const usageEvents = useMemo(() => {
    // `revision` is deliberately a dependency: it is the ledger's change signal.
    void revision
    return usageSince(usageDays)
  }, [usageDays, revision])

  const summary = useMemo(() => summarizeUsage(usageEvents, usageDays), [usageEvents, usageDays])

  const filteredEvents = useMemo(() => {
    const rows = kindFilter === 'all' ? usageEvents : usageEvents.filter((event) => event.kind === kindFilter)
    return [...rows].sort((a, b) => b.at - a.at)
  }, [usageEvents, kindFilter])

  // Recomputed on every render; `revision` changes when the ledger changes.
  const quotaUsage = {
    projects: projectCount,
    exportsToday: countUsage('export.run', startOfToday(), user.id),
    simulationsToday: countUsage('simulation.run', startOfToday(), user.id),
    storageMb: environment?.storageUsedMb ?? 0,
  }
  // A missing estimate is not zero usage; the storage row says so instead.
  const storageMeasured = environment?.storageUsedMb != null
  const ledgerTotal = getUsageEvents().length

  const subjectRole = access?.role ?? 'user'
  const rows = quotaRows(subjectRole, quotaUsage)
  const activeAlerts = siemService.getAlerts({ status: 'active' }).length
  const capabilitiesForMode = capabilities(offlineMode)

  if (!access) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground" role="status">Checking administrator access…</p>
      </div>
    )
  }

  if (!access.allowed) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <header className="flex items-center justify-between border-b border-border px-6 py-4">
          <div className="flex items-center gap-3">
            <Shield className="h-6 w-6 text-primary" aria-hidden="true" />
            <div>
              <h1 className="text-base font-semibold text-foreground">Administration</h1>
              <p className="text-xs text-muted-foreground">Access control</p>
            </div>
          </div>
          <Button variant="ghost" onClick={onBack} className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" /> Back to projects
          </Button>
        </header>
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-12">
          <div className="rounded-lg border border-border bg-card p-8 text-center">
            <Shield className="mx-auto h-10 w-10 text-warning" aria-hidden="true" />
            <h2 className="mt-4 text-lg font-semibold text-foreground">Administrator access required</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{access.reason}</p>
            <p className="mt-4 text-xs text-muted-foreground">
              Current role: <span className="font-medium text-foreground">{access.role === 'user' ? 'Unassigned' : ROLE_LABELS[access.role]}</span>
            </p>
            <Button className="mt-6" onClick={onBack}>Return to the workbench</Button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-surface px-6 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to projects" title="Back to projects">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <ShieldCheck className="h-6 w-6 flex-shrink-0 text-primary" aria-hidden="true" />
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-tight text-foreground">Administration</h1>
            <p className="truncate text-[11px] text-muted-foreground">
              {offlineMode ? 'This device · local owner' : `${ROLE_LABELS[access.role as AdminRole]} · cloud workspace`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
            offlineMode ? 'border-warning/40 bg-warning/10 text-warning' : 'border-success/40 bg-success/10 text-success'
          }`}>
            {offlineMode ? 'Local only' : 'Cloud connected'}
          </span>
          <Button variant="ghost" size="icon" onClick={() => { void refresh() }} aria-label="Refresh administration data" title="Refresh">
            <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </header>

      <div className="border-b border-border px-4">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Administration sections">
          {TABS.map((entry) => {
            const Icon = entry.icon
            const selected = tab === entry.id
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                id={`admin-tab-${entry.id}`}
                aria-selected={selected}
                aria-controls={`admin-panel-${entry.id}`}
                onClick={() => setTab(entry.id)}
                className={`flex flex-shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-medium transition-colors ${
                  selected
                    ? 'border-b-primary text-foreground'
                    : 'border-b-transparent text-muted-foreground hover:text-foreground'
                }`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                {entry.label}
              </button>
            )
          })}
        </div>
      </div>

      <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-6">
        {tab === 'overview' && (
          <section role="tabpanel" id="admin-panel-overview" aria-labelledby="admin-tab-overview" className="space-y-6">
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Usage events" value={String(summary.total)} hint={`Last ${usageDays} days on this device`} icon={Activity} />
              <Kpi label="Projects" value={String(projectCount)} hint={offlineMode ? 'Stored on this device' : 'Owned by your account'} icon={Layers} />
              <Kpi label="People" value={String(members.length)} hint={offlineMode ? 'One local owner' : `${members.filter((member) => member.status === 'active').length} active`} icon={Users} />
              <Kpi label="Security alerts" value={String(activeAlerts)} hint="Active SIEM alerts" icon={AlertTriangle} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-foreground">Activity</h2>
                  <span className="text-[11px] text-muted-foreground">{summary.total} recorded actions</span>
                </div>
                <DailyChart data={summary.daily} />
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Most used workspaces</h2>
                {summary.byMode.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No workspace activity recorded yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {summary.byMode.slice(0, 6).map((row) => {
                      const max = summary.byMode[0]?.count ?? 1
                      return (
                        <li key={row.mode}>
                          <div className="flex items-center justify-between text-[11px]">
                            <span className="truncate capitalize text-foreground">{row.mode}</span>
                            <span className="tabular-nums text-muted-foreground">{row.count}</span>
                          </div>
                          <div className="mt-1 h-1.5 rounded-full bg-muted">
                            <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(4, (row.count / max) * 100)}%` }} />
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-card p-4">
                <h2 className="mb-3 text-sm font-semibold text-foreground">Recent activity</h2>
                {filteredEvents.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nothing recorded yet. Open a workspace or load a demo and it appears here.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {filteredEvents.slice(0, 8).map((event) => (
                      <li key={event.id} className="flex items-start justify-between gap-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">{USAGE_KIND_LABELS[event.kind]}</p>
                          <p className="truncate text-[10px] text-muted-foreground">
                            {event.user}{typeof event.detail?.mode === 'string' ? ` · ${event.detail.mode}` : ''}
                          </p>
                        </div>
                        <time className="flex-shrink-0 text-[10px] tabular-nums text-muted-foreground" dateTime={new Date(event.at).toISOString()}>
                          {formatTime(event.at)}
                        </time>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="space-y-3 rounded-lg border border-border bg-card p-4">
                <h2 className="text-sm font-semibold text-foreground">What this console governs</h2>
                <p className="text-xs leading-relaxed text-muted-foreground">{capabilitiesForMode.note}</p>
                <ul className="space-y-1.5 text-xs text-muted-foreground">
                  <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success" aria-hidden="true" />Local usage ledger and quota enforcement are active.</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success" aria-hidden="true" />Administrative actions are written to the audit trail.</li>
                  <li className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-success" aria-hidden="true" />Role policies apply to cloud accounts when configured.</li>
                </ul>
              </div>
            </div>
          </section>
        )}

        {tab === 'people' && (
          <section role="tabpanel" id="admin-panel-people" aria-labelledby="admin-tab-people" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">People</h2>
                <p className="text-xs text-muted-foreground">
                  {offlineMode ? 'One owner on this device. Cloud accounts appear here when Supabase is configured.' : 'Accounts from the cloud governance profile table.'}
                </p>
              </div>
              <span className="text-[11px] text-muted-foreground">{members.length} account{members.length === 1 ? '' : 's'}</span>
            </div>

            {peopleError && (
              <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{peopleError}</p>
            )}
            {membersError && (
              <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                The account directory could not be read: {membersError}
              </p>
            )}

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[640px] text-left text-xs">
                <caption className="sr-only">Accounts and their governance roles</caption>
                <thead className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Account</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Role</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Status</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Last seen</th>
                    <th scope="col" className="px-4 py-2.5 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {members.map((member) => {
                    const self = member.id === user.id
                    return (
                      <tr key={member.id}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="truncate font-medium text-foreground">{member.name}{self ? ' (you)' : ''}</p>
                              <p className="truncate text-[10px] text-muted-foreground">{member.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {capabilitiesForMode.managePeople && !self ? (
                            <select
                              aria-label={`Role for ${member.name}`}
                              className="rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                              value={member.role}
                              disabled={busyMember === member.id}
                              onChange={(event) => {
                                const role = event.target.value as AdminRole
                                setBusyMember(member.id)
                                setPeopleError('')
                                setMemberRole(user, offlineMode, member.id, role)
                                  .then((result) => {
                                    if (!result.ok) setPeopleError(result.error ?? 'Role change failed.')
                                    else void refresh()
                                  })
                                  .finally(() => setBusyMember(''))
                              }}
                            >
                              {ADMIN_ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
                            </select>
                          ) : (
                            <span className="text-foreground">{member.role === 'user' ? 'Unassigned' : ROLE_LABELS[member.role]}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${
                            member.status === 'active' ? 'bg-success/15 text-success' : 'bg-destructive/15 text-destructive'
                          }`}>
                            {member.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {member.source === 'local' ? 'Now' : member.lastSeenAt ? formatTime(member.lastSeenAt) : 'Unknown'}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {capabilitiesForMode.suspendMembers && !self ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busyMember === member.id}
                              onClick={() => {
                                const next = member.status === 'active' ? 'suspended' : 'active'
                                setBusyMember(member.id)
                                setPeopleError('')
                                setMemberStatus(user, offlineMode, member.id, next)
                                  .then((result) => {
                                    if (!result.ok) setPeopleError(result.error ?? 'Status change failed.')
                                    else void refresh()
                                  })
                                  .finally(() => setBusyMember(''))
                              }}
                            >
                              {member.status === 'active' ? 'Suspend' : 'Restore'}
                            </Button>
                          ) : (
                            <span className="text-[10px] text-muted-foreground">Managed in cloud</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Invitations</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Invitations need Supabase's server-side admin API with a service-role key, which must never ship in the
                browser. This build does not fake that call: create accounts in Supabase Auth and assign a role here.
                See <span className="font-medium text-foreground">docs/ADMINISTRATION.md</span> for the deployment contract.
              </p>
            </div>
          </section>
        )}

        {tab === 'usage' && (
          <section role="tabpanel" id="admin-panel-usage" aria-labelledby="admin-tab-usage" className="space-y-4">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Usage</h2>
                <p className="text-xs text-muted-foreground">Append-only ledger of actions on this device. Cloud-wide aggregation is shown separately.</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <label className="text-[11px] text-muted-foreground">
                  Window
                  <select
                    className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    value={usageDays}
                    onChange={(event) => setUsageDays(Number(event.target.value))}
                  >
                    <option value={7}>7 days</option>
                    <option value={14}>14 days</option>
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                  </select>
                </label>
                <label className="text-[11px] text-muted-foreground">
                  Kind
                  <select
                    className="ml-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground"
                    value={kindFilter}
                    onChange={(event) => setKindFilter(event.target.value as 'all' | UsageKind)}
                  >
                    {KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center gap-1.5"
                  onClick={() => downloadCsv(
                    `folio-usage-${new Date().toISOString().slice(0, 10)}.csv`,
                    ['timestamp', 'user', 'kind', 'detail'],
                    filteredEvents.map((event) => [new Date(event.at).toISOString(), event.user, event.kind, JSON.stringify(event.detail ?? {})]),
                  )}
                >
                  <FileDown className="h-3.5 w-3.5" /> CSV
                </Button>
              </div>
            </div>

            {environment?.cloudUsageMirrorError && (
              <p role="alert" className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                The last usage mirror failed: {environment.cloudUsageMirrorError}. The event is still recorded on this
                device, but cloud-wide reports and server-side quota checks did not see it.
              </p>
            )}

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <Kpi label="Events" value={String(summary.total)} hint={`Window: ${usageDays} days`} icon={Activity} />
              <Kpi label="Workspaces" value={String(summary.byMode.length)} hint="Distinct workspaces opened" icon={Layers} />
              <Kpi label="Exports" value={String(summary.byKind.find((row) => row.kind === 'export.run')?.count ?? 0)} hint="Export actions" icon={FileDown} />
              <Kpi label="Simulations" value={String(summary.byKind.find((row) => row.kind === 'simulation.run')?.count ?? 0)} hint="Solver runs" icon={Wrench} />
            </div>

            <div className="grid gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
                <h3 className="mb-3 text-sm font-semibold text-foreground">Daily activity</h3>
                <DailyChart data={summary.daily} />
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="mb-3 text-sm font-semibold text-foreground">By action</h3>
                {summary.byKind.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No activity in this window.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {summary.byKind.map((row) => (
                      <li key={row.kind} className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate text-foreground">{USAGE_KIND_LABELS[row.kind]}</span>
                        <span className="tabular-nums text-muted-foreground">{row.count}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {!offlineMode && (
              <div className="rounded-lg border border-border bg-card p-4">
                <h3 className="text-sm font-semibold text-foreground">Cloud-wide usage</h3>
                {cloudUsage?.error ? (
                  <p className="mt-2 text-xs text-warning">Cloud usage feed unavailable: {cloudUsage.error}</p>
                ) : cloudUsage ? (
                  <div className="mt-3 grid gap-4 sm:grid-cols-3">
                    <div><p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Events</p><p className="text-lg font-semibold tabular-nums text-foreground">{cloudUsage.total}</p></div>
                    <div><p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Accounts</p><p className="text-lg font-semibold tabular-nums text-foreground">{cloudUsage.byUser.length}</p></div>
                    <div><p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Top action</p><p className="truncate text-sm font-medium text-foreground">{cloudUsage.byKind[0]?.kind ?? '—'}</p></div>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">No cloud usage loaded.</p>
                )}
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[720px] text-left text-xs">
                <caption className="sr-only">Recorded usage events</caption>
                <thead className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">When</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Account</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Action</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredEvents.slice(0, 200).map((event: UsageEvent) => (
                    <tr key={event.id}>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">{formatTime(event.at)}</td>
                      <td className="px-4 py-2 text-foreground">{event.user}</td>
                      <td className="px-4 py-2 text-foreground">{USAGE_KIND_LABELS[event.kind]}</td>
                      <td className="px-4 py-2 text-muted-foreground">
                        {event.detail ? Object.entries(event.detail).map(([key, value]) => `${key}=${String(value)}`).join(', ') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredEvents.length === 0 && (
                <div className="p-6"><EmptyState title="No events in this window" detail="Open workspaces, run simulations, export or commit to populate the ledger." /></div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
              <div>
                <h3 className="text-xs font-semibold text-foreground">Device ledger</h3>
                <p className="mt-1 max-w-xl text-[11px] text-muted-foreground">
                  Clearing removes all {ledgerTotal.toLocaleString()} recorded event{ledgerTotal === 1 ? '' : 's'} from this
                  browser, not only the rows in the current window. Audit events are kept.
                </p>
                {environment && !environment.ledgerPersistent && (
                  <p className="mt-1 max-w-xl text-[11px] font-medium text-warning">
                    This browser refused durable storage, so the ledger lives in memory only and is lost when the tab closes.
                  </p>
                )}
              </div>
              {clearArmed ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="destructive"
                    size="sm"
                    className="flex items-center gap-1.5"
                    onClick={() => {
                      resetUsageLedger()
                      siemService.logAuditEvent({ user: user.id, action: 'admin:usage_cleared', resource: 'usage-ledger', details: { offlineMode, cleared: ledgerTotal } })
                      setClearArmed(false)
                      setRevision((value) => value + 1)
                      // The clear itself is an audit event; show it without a manual refresh.
                      setAudit(siemService.getAuditTrail({ limit: 200 }))
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Clear {ledgerTotal === 0 ? 'ledger' : `all ${ledgerTotal.toLocaleString()} events`}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setClearArmed(false)}>Cancel</Button>
                </div>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setClearArmed(true)}>Clear this device&apos;s ledger</Button>
              )}
            </div>
          </section>
        )}

        {tab === 'quotas' && (
          <section role="tabpanel" id="admin-panel-quotas" aria-labelledby="admin-tab-quotas" className="space-y-5">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Quotas</h2>
              <p className="text-xs text-muted-foreground">
                A blank limit means unlimited. Owner and administrator policies are fixed at unlimited so administration cannot lock itself out.
              </p>
              {policySyncError && (
                <p role="alert" className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
                  The cloud policy table could not be read: {policySyncError}. Showing this device&apos;s last known policies.
                </p>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Current usage · {subjectRole === 'user' ? 'unassigned' : ROLE_LABELS[subjectRole]}</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {rows.map((row) => (
                  <div key={row.id} className="rounded-md border border-border bg-background p-3">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">{row.label}</p>
                    {row.id === 'storage' && !storageMeasured ? (
                      <>
                        <p className="mt-1 text-sm font-semibold text-muted-foreground">Unavailable</p>
                        <p className="mt-1 text-[10px] leading-snug text-muted-foreground">
                          The browser did not report a storage estimate, so this row is not compared to the policy.
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">
                          {row.used.toLocaleString()} {row.limit === null ? <span className="text-muted-foreground">/ unlimited</span> : <span className="text-muted-foreground">/ {row.limit.toLocaleString()} {row.unit}</span>}
                        </p>
                        <div className="mt-2 h-1.5 rounded-full bg-muted">
                          <div className={`h-1.5 rounded-full ${row.status === 'fail' ? 'bg-destructive' : row.status === 'warn' ? 'bg-warning' : 'bg-success'}`} style={{ width: `${row.limit === null || row.limit === 0 ? (row.used > 0 ? 100 : 0) : Math.min(100, (row.used / row.limit) * 100)}%` }} />
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-[11px] text-muted-foreground">
                Project creation, exports and solver runs are checked against the active role&apos;s policy in this browser. Storage is reported from the browser&apos;s estimate; the cloud schema enforces quotas for the account activity it records.
              </p>
            </div>

            {(['engineer', 'viewer'] as const).map((role) => (
              <div key={role} className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">{ROLE_LABELS[role]} policy</h3>
                    <p className="text-[11px] text-muted-foreground">{ROLE_DESCRIPTIONS[role]}</p>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      const draft = policyDraft[role]
                      const parsed = {
                        maxProjects: parseQuotaLimit(draft.maxProjects),
                        maxExportsPerDay: parseQuotaLimit(draft.maxExportsPerDay),
                        maxSimulationsPerDay: parseQuotaLimit(draft.maxSimulationsPerDay),
                        maxStorageMb: parseQuotaLimit(draft.maxStorageMb),
                      }
                      if (Object.values(parsed).some((value) => value === undefined)) {
                        setPolicyStatus({ role, message: 'Enter zero or a positive number, or leave blank for unlimited.', ok: false })
                        return
                      }
                      const limits: QuotaLimits = {
                        maxProjects: parsed.maxProjects as number | null,
                        maxExportsPerDay: parsed.maxExportsPerDay as number | null,
                        maxSimulationsPerDay: parsed.maxSimulationsPerDay as number | null,
                        maxStorageMb: parsed.maxStorageMb as number | null,
                      }
                      void savePolicy(user, offlineMode, role, limits).then((result) => {
                        setPolicyStatus({ role, message: result.ok ? 'Policy saved and audited.' : result.error ?? 'Policy could not be saved.', ok: result.ok })
                        if (result.ok) setPolicyDraft(draftFromPolicies())
                      })
                    }}
                  >
                    Save policy
                  </Button>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  {([
                    ['maxProjects', 'Projects', 'projects'],
                    ['maxExportsPerDay', 'Exports / day', 'exports'],
                    ['maxSimulationsPerDay', 'Simulations / day', 'runs'],
                    ['maxStorageMb', 'Storage (MB)', 'MB'],
                  ] as Array<[keyof QuotaLimits, string, string]>).map(([key, label, unit]) => (
                    <label key={key} className="text-[11px] text-muted-foreground">
                      {label} <span className="text-muted-foreground/70">({unit})</span>
                      <input
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        placeholder="Unlimited"
                        aria-label={`${ROLE_LABELS[role]} ${label} limit`}
                        className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs text-foreground"
                        value={policyDraft[role][key]}
                        onChange={(event) => setPolicyDraft((current) => ({
                          ...current,
                          [role]: { ...current[role], [key]: event.target.value },
                        }))}
                      />
                    </label>
                  ))}
                </div>
                {policyStatus?.role === role && (
                  <p role="status" className={`mt-3 text-[11px] ${policyStatus.ok ? 'text-success' : 'text-destructive'}`}>{policyStatus.message}</p>
                )}
              </div>
            ))}

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Enforcement preview</h3>
              <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                {(['project', 'export', 'simulation'] as const).map((kind) => {
                  const decision = checkQuotaCapacity(kind, subjectRole, quotaUsage)
                  return (
                    <li key={kind} className="flex items-center gap-2">
                      {decision.allowed
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden="true" />
                        : <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden="true" />}
                      <span className="capitalize">{kind}</span>
                      <span>— {decision.allowed ? 'allowed' : decision.reason}</span>
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>
        )}

        {tab === 'audit' && (
          <section role="tabpanel" id="admin-panel-audit" aria-labelledby="admin-tab-audit" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Audit trail</h2>
                <p className="text-xs text-muted-foreground">Administrative and project actions recorded by the SIEM service.</p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-1.5"
                onClick={() => downloadCsv(
                  `folio-audit-${new Date().toISOString().slice(0, 10)}.csv`,
                  ['timestamp', 'user', 'action', 'resource', 'details'],
                  audit.map((entry) => [new Date(entry.timestamp).toISOString(), entry.user, entry.action, entry.resource, JSON.stringify(entry.details)]),
                )}
              >
                <FileDown className="h-3.5 w-3.5" /> CSV
              </Button>
            </div>
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[680px] text-left text-xs">
                <caption className="sr-only">Audit trail entries</caption>
                <thead className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-2.5 font-semibold">When</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Account</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Action</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Resource</th>
                    <th scope="col" className="px-4 py-2.5 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {audit.map((entry) => (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums text-muted-foreground">{formatTime(entry.timestamp)}</td>
                      <td className="px-4 py-2 text-foreground">{entry.user}</td>
                      <td className="px-4 py-2 font-mono text-[11px] text-foreground">{entry.action}</td>
                      <td className="px-4 py-2 text-muted-foreground">{entry.resource}</td>
                      <td className="max-w-[240px] truncate px-4 py-2 text-muted-foreground">{JSON.stringify(entry.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {audit.length === 0 && <div className="p-6"><EmptyState title="No audit events yet" detail="Administrative and project actions will appear here." /></div>}
            </div>
          </section>
        )}

        {tab === 'environment' && (
          <section role="tabpanel" id="admin-panel-environment" aria-labelledby="admin-tab-environment" className="space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-foreground">Environment</h2>
              <p className="text-xs text-muted-foreground">What this deployment can actually do, without optimistic claims.</p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Deployment</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{environment?.deployment === 'cloud' ? 'Cloud-connected' : 'Local device'}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{environment?.supabaseConfigured ? 'Supabase credentials detected.' : 'No Supabase credentials; all data stays in this browser.'}</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Always-on agents</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{environment?.agentCloudConfigured ? 'Runner configured' : 'Local runner only'}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{environment?.agentCloudConfigured ? 'Background agents can connect to the configured runner.' : 'Agents stop when this tab closes; set VITE_AGENT_CLOUD_URL for an always-on runner.'}</p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Browser storage</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{formatBytesMb(environment?.storageUsedMb ?? null)}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {environment?.storageQuotaMb ? `of an estimated ${formatBytesMb(environment.storageQuotaMb)} quota` : 'Browser quota estimate unavailable'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Usage ledger</p>
                <p className="mt-1 text-sm font-semibold tabular-nums text-foreground">{environment?.ledgerEvents ?? 0} events</p>
                <p className={`mt-1 text-[11px] ${environment && !environment.ledgerPersistent ? 'text-warning' : 'text-muted-foreground'}`}>
                  {environment && !environment.ledgerPersistent
                    ? 'Stored in memory only: this browser refused durable storage, so events are lost when the tab closes.'
                    : 'Append-only, capped at 5,000 entries, persisted under folio.usage.v1 in this browser.'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Governance schema</p>
                <p className="mt-1 text-sm font-semibold text-foreground">{offlineMode ? 'Not applicable' : 'profiles · usage_events · quota_policies'}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {offlineMode ? 'Local mode has no server directory.' : 'Apply the admin migration before granting roles.'}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">Capability summary</p>
                <ul className="mt-1 space-y-1 text-[11px] text-muted-foreground">
                  <li>Manage people: {capabilitiesForMode.managePeople ? 'yes' : 'cloud only'}</li>
                  <li>Suspend accounts: {capabilitiesForMode.suspendMembers ? 'yes' : 'cloud only'}</li>
                  <li>Invite accounts: {capabilitiesForMode.inviteMembers ? 'yes' : 'server function required'}</li>
                  <li>Cloud usage feed: {capabilitiesForMode.cloudUsageFeed ? 'yes' : 'cloud only'}</li>
                </ul>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">Honest limits</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                Local mode cannot enumerate accounts on other devices, cannot revoke a session remotely, and cannot enforce a
                quota for someone else. Those operations require the cloud schema plus RLS, and invitations require a
                service-role server function. The console labels each capability above rather than pretending otherwise.
              </p>
            </div>
          </section>
        )}
      </main>
    </div>
  )
}

function draftFromPolicies(): Record<'engineer' | 'viewer', Record<keyof QuotaLimits, string>> {
  const policies = readQuotaPolicies()
  const toDraft = (limits: QuotaLimits): Record<keyof QuotaLimits, string> => ({
    maxProjects: limits.maxProjects === null ? '' : String(limits.maxProjects),
    maxExportsPerDay: limits.maxExportsPerDay === null ? '' : String(limits.maxExportsPerDay),
    maxSimulationsPerDay: limits.maxSimulationsPerDay === null ? '' : String(limits.maxSimulationsPerDay),
    maxStorageMb: limits.maxStorageMb === null ? '' : String(limits.maxStorageMb),
  })
  return { engineer: toDraft(policies.engineer), viewer: toDraft(policies.viewer) }
}
