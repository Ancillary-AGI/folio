/**
 * The operator's opening screen.
 *
 * Every figure is a read from the deployment: the directory, the usage ledger,
 * the quota policies, the audit trail and the security-definer aggregate. The
 * charts are the same rows the detail sections show, rolled up — so a number on
 * this screen always has a table behind it. Where a read failed, the card says
 * so instead of drawing a zero that looks measured.
 */
import { useMemo } from 'react'
import {
  Activity, AlertTriangle, ArrowUpRight, CheckCircle2, Database, FileDown, Gauge,
  Shield, Users, Wrench, type LucideIcon,
} from 'lucide-react'
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Account, AuditEntry, DeploymentInfo } from '../lib/admin/adminService'
import type { AccountUsage, UsageEvent, UsageSummary } from '../lib/admin/usageLedger'
import { usageKindLabel } from '../lib/admin/usageLedger'
import type { Operator } from '../lib/admin/operatorSession'
import { type AdminRole, type QuotaLimits } from '../lib/admin/quotaPolicy'
import {
  accountGrowth, attentionItems, dailyQuotaPressure, hourlyActivity, roleDistribution,
  statusDistribution, topAccounts, type AttentionItem,
} from '../lib/admin/analytics'
import type { SectionId } from './sections'
import {
  Alert, Card, CHART_HUES, CHART_TOOLTIP_STYLE, EmptyState, Kpi, Picker, SectionHeader,
  type KpiTone,
} from './shared'
import { formatTime, roleLabel } from './format'

export interface OverviewErrors {
  accounts?: string
  usage?: string
  policies?: string
  audit?: string
  deployment?: string
}

export interface OverviewPanelProps {
  operator: Operator
  accounts: Account[]
  events: UsageEvent[]
  summary: UsageSummary
  usageDays: number
  policies: Record<AdminRole, QuotaLimits>
  audit: AuditEntry[]
  deployment: DeploymentInfo | null
  accountUsage: Map<string, AccountUsage>
  errors: OverviewErrors
  onOpen: (section: SectionId) => void
  onInspectAccount: (account: Account) => void
  onWindow: (days: number) => void
}

const WINDOWS = [7, 14, 30, 90] as const

const ATTENTION_TONE: Record<AttentionItem['tone'], string> = {
  destructive: 'border-destructive/35 bg-destructive/5 text-destructive',
  warning: 'border-warning/35 bg-warning/5 text-warning',
  info: 'border-border bg-muted/40 text-muted-foreground',
}

function ChartFigure({ label, caption, children }: { label: string; caption: string; children: React.ReactNode }) {
  return (
    <figure role="img" aria-label={label} className="min-w-0">
      <figcaption className="sr-only">{caption}</figcaption>
      {children}
    </figure>
  )
}

function MiniStat({ icon: Icon, label, value, hint }: { icon: LucideIcon; label: string; value: string; hint: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-border bg-muted/60 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</p>
        <p className="mt-0.5 truncate text-sm font-semibold tabular-nums text-foreground">{value}</p>
        <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">{hint}</p>
      </div>
    </div>
  )
}

export default function OverviewPanel({
  operator,
  accounts,
  events,
  summary,
  usageDays,
  policies,
  audit,
  deployment,
  accountUsage,
  errors,
  onOpen,
  onInspectAccount,
  onWindow,
}: OverviewPanelProps) {
  const stats = deployment?.stats ?? null
  const suspended = accounts.filter((account) => account.status === 'suspended').length
  const active = accounts.length - suspended
  const activeInWindow = summary.byUser.length

  const hourly = useMemo(() => hourlyActivity(events, usageDays), [events, usageDays])
  const roleMix = useMemo(() => roleDistribution(accounts), [accounts])
  const statusMix = useMemo(() => statusDistribution(accounts), [accounts])
  const growth = useMemo(() => accountGrowth(accounts, 12), [accounts])
  const pressure = useMemo(() => dailyQuotaPressure(accounts, events, policies), [accounts, events, policies])
  const attention = useMemo(() => attentionItems({
    accounts,
    pressure,
    activeAccounts: activeInWindow,
    usageError: errors.usage,
    accountsError: errors.accounts,
    deploymentError: deployment?.statsError,
  }), [accounts, pressure, activeInWindow, errors.usage, errors.accounts, deployment?.statsError])
  const top = useMemo(() => topAccounts(accounts, accountUsage, 6), [accounts, accountUsage])

  const nameOf = useMemo(() => {
    const directory = new Map(accounts.map((account) => [account.id, account.name]))
    directory.set(operator.id, operator.name)
    return (id: string) => directory.get(id) ?? id
  }, [accounts, operator])

  const totalActions = summary.total
  const topKind = summary.byKind[0] ?? null
  const exportCount = summary.byKind.find((row) => row.kind === 'export.run')?.count ?? 0
  const simulationCount = summary.byKind.find((row) => row.kind === 'simulation.run')?.count ?? 0
  const growthHasDates = growth.some((point) => point.total > 0)
  const roleTotal = roleMix.reduce((sum, point) => sum + point.count, 0)

  const kpis: Array<{ label: string; value: string; hint: string; icon: LucideIcon; tone: KpiTone }> = [
    {
      label: 'Accounts',
      value: accounts.length.toLocaleString(),
      hint: `${active} active · ${suspended} suspended`,
      icon: Users,
      tone: suspended > 0 ? 'amber' : 'primary',
    },
    {
      label: 'Active in window',
      value: activeInWindow.toLocaleString(),
      hint: `of ${accounts.length} accounts, last ${usageDays} days`,
      icon: Activity,
      tone: activeInWindow > 0 ? 'success' : 'muted',
    },
    {
      label: 'Designs stored',
      value: stats ? stats.projects.toLocaleString() : '—',
      hint: stats ? 'Projects across the deployment' : deployment?.statsError ?? 'Totals unavailable',
      icon: Database,
      tone: 'primary',
    },
    {
      label: 'Exports today',
      value: stats ? stats.exportsToday.toLocaleString() : '—',
      hint: `${exportCount} in the selected window`,
      icon: FileDown,
      tone: 'primary',
    },
    {
      label: 'Solver runs today',
      value: stats ? stats.simulationsToday.toLocaleString() : '—',
      hint: `${simulationCount} in the selected window`,
      icon: Wrench,
      tone: 'primary',
    },
    {
      label: 'Needs attention',
      value: attention.filter((item) => item.tone !== 'info').length.toLocaleString(),
      hint: attention.length === 0 ? 'No warnings from the rows read' : `${attention.length} item${attention.length === 1 ? '' : 's'} listed below`,
      icon: attention.some((item) => item.tone === 'destructive') ? AlertTriangle : CheckCircle2,
      tone: attention.some((item) => item.tone === 'destructive') ? 'destructive' : attention.length > 0 ? 'amber' : 'success',
    },
  ]

  return (
    <section role="tabpanel" id="admin-panel-overview" aria-labelledby="admin-tab-overview" className="space-y-4">
      <SectionHeader
        title="Overview"
        detail={`The state of ${deployment?.host || 'this deployment'}, read from the directory, usage ledger, quota policy and audit trail. Charts use the same rows as the detail sections.`}
      >
        {/* The signed-in operator is identified once, in the console header, so
            it is not repeated here — two identical chips also made the section
            ambiguous to query and to read. */}
        <Picker label="Overview window" value={usageDays} onChange={(value) => onWindow(Number(value))}>
          {WINDOWS.map((days) => <option key={days} value={days}>{`${days} days`}</option>)}
        </Picker>
      </SectionHeader>

      {errors.accounts && <Alert tone="destructive">{`The account directory could not be read: ${errors.accounts}`}</Alert>}
      {errors.usage && <Alert tone="destructive">{`The usage ledger could not be read: ${errors.usage}`}</Alert>}
      {errors.policies && <Alert tone="warning">{`The quota policy could not be read; the built-in limits are shown: ${errors.policies}`}</Alert>}
      {deployment?.statsError && <Alert tone="warning">{`Deployment totals are unavailable: ${deployment.statsError}`}</Alert>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        {kpis.map((kpi) => <Kpi key={kpi.label} {...kpi} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4 lg:col-span-2">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Activity</h3>
              <p className="text-[11px] text-muted-foreground">Recorded actions per day, local calendar days.</p>
            </div>
            <span className="text-[11px] tabular-nums text-muted-foreground">{`${totalActions.toLocaleString()} actions · ${usageDays} days`}</span>
          </div>
          {totalActions === 0 ? (
            <EmptyState
              title="No recorded activity in this window"
              detail={errors.usage ? errors.usage : 'Events appear as accounts open workspaces, commit designs, export and run solvers.'}
            />
          ) : (
            <ChartFigure
              label={`Daily activity over ${usageDays} days`}
              caption={`${totalActions} recorded actions across ${summary.daily.length} days.`}
            >
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={summary.daily} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
                    <defs>
                      <linearGradient id="admin-overview-activity" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.38} />
                        <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value: string) => value.slice(5)}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={24}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 10 }}
                      tickLine={false}
                      axisLine={false}
                      width={38}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      labelFormatter={(value) => `Day ${value}`}
                      formatter={(value: number) => [value.toLocaleString(), 'actions']}
                    />
                    <Area
                      type="monotone"
                      dataKey="count"
                      name="Actions"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      fill="url(#admin-overview-activity)"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </ChartFigure>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Deployment</h3>
              <p className="text-[11px] text-muted-foreground">What this console is operating.</p>
            </div>
            <button type="button" className="cad-ctl" onClick={() => onOpen('deployment')}>
              Inspect <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
          <p className="mt-3 truncate font-mono text-xs text-foreground">{deployment?.host || 'Unknown host'}</p>
          <div className="mt-4 grid gap-3">
            <MiniStat
              icon={Database}
              label="Projects"
              value={stats ? stats.projects.toLocaleString() : '—'}
              hint={stats ? `${stats.operatorAccounts} operator account${stats.operatorAccounts === 1 ? '' : 's'}` : 'Aggregate unavailable'}
            />
            <MiniStat
              icon={Activity}
              label="Usage events"
              value={stats ? stats.usageEvents.toLocaleString() : '—'}
              hint="Append-only deployment ledger"
            />
            <MiniStat
              icon={Shield}
              label="Audit entries"
              value={stats ? stats.auditEvents.toLocaleString() : '—'}
              hint="Operator actions on record"
            />
            <MiniStat
              icon={Gauge}
              label="Always-on runner"
              value={deployment?.agentRunnerConfigured ? 'Configured' : 'Not configured'}
              hint={deployment?.agentRunnerConfigured
                ? 'Cloud agents can run after the browser closes'
                : 'Jobs stay in the browser; see Deployment'}
            />
          </div>
          {statusMix.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border/70 pt-3">
              {statusMix.map((point) => (
                <span key={point.status} className={`cad-chip ${point.status === 'active'
                  ? 'border-success/40 bg-success/10 text-success'
                  : 'border-warning/40 bg-warning/10 text-warning'}`}>
                  {`${point.count} ${point.label.toLowerCase()}`}
                </span>
              ))}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Role mix</h3>
          <p className="text-[11px] text-muted-foreground">How the directory is governed.</p>
          {roleMix.length === 0 ? (
            <div className="mt-3">
              <EmptyState title="No roles to chart" detail={errors.accounts ? errors.accounts : 'Accounts appear here once someone signs up.'} />
            </div>
          ) : (
            <div className="mt-2 grid grid-cols-[7.5rem_1fr] items-center gap-3">
              <ChartFigure label="Accounts by role" caption={`${roleTotal} accounts across ${roleMix.length} role groups.`}>
                <div className="h-28">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={roleMix}
                        dataKey="count"
                        nameKey="label"
                        innerRadius="58%"
                        outerRadius="88%"
                        paddingAngle={2}
                        stroke="hsl(var(--card))"
                        strokeWidth={2}
                        isAnimationActive={false}
                      >
                        {roleMix.map((point, index) => (
                          <Cell key={point.role} fill={CHART_HUES[index % CHART_HUES.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(value: number, name: string) => [value.toLocaleString(), name]}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </ChartFigure>
              <ul className="space-y-1.5">
                {roleMix.map((point, index) => (
                  <li key={point.role} className="flex items-center justify-between gap-2 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span aria-hidden="true" className="h-2 w-2 flex-shrink-0 rounded-sm" style={{ background: CHART_HUES[index % CHART_HUES.length] }} />
                      <span className="truncate text-foreground">{point.label}</span>
                    </span>
                    <span className="flex-shrink-0 tabular-nums text-muted-foreground">{point.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" className="cad-ctl mt-3" onClick={() => onOpen('iam')}>
            Open roles & access
          </button>
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">When work happens</h3>
          <p className="text-[11px] text-muted-foreground">Recorded actions by local hour.</p>
          {totalActions === 0 ? (
            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">The hour strip fills in as the deployment records actions in this window.</p>
          ) : (
            <ChartFigure label="Activity by hour of day" caption={`Recorded actions by local hour over ${usageDays} days.`}>
              <div className="mt-2 h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourly} margin={{ top: 8, right: 0, bottom: 0, left: -22 }} barCategoryGap="18%">
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                    <XAxis
                      dataKey="hour"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      interval={5}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      labelFormatter={(value) => `${value}:00 hour`}
                      formatter={(value: number) => [value.toLocaleString(), 'actions']}
                    />
                    <Bar dataKey="count" name="Actions" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartFigure>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="text-sm font-semibold text-foreground">Account growth</h3>
          <p className="text-[11px] text-muted-foreground">Accounts created per week, and the running total.</p>
          {!growthHasDates ? (
            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
              The directory did not return creation dates for these accounts, so no growth line can be drawn honestly.
            </p>
          ) : (
            <ChartFigure label="Account growth over twelve weeks" caption="Accounts created per week and the cumulative total over the last twelve weeks.">
              <div className="mt-2 h-36">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={growth} margin={{ top: 8, right: 4, bottom: 0, left: -22 }}>
                    <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(value: string) => value.slice(5)}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      minTickGap={22}
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }}
                      tickLine={false}
                      axisLine={false}
                      width={30}
                    />
                    <Tooltip
                      contentStyle={CHART_TOOLTIP_STYLE}
                      labelFormatter={(value) => `Week of ${value}`}
                  />
                    <Line type="monotone" dataKey="total" name="Accounts" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="created" name="New this week" stroke="hsl(var(--chart-3))" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </ChartFigure>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Needs attention</h3>
              <p className="text-[11px] text-muted-foreground">Derived from the directory, today&apos;s policy pressure and failed reads.</p>
            </div>
            {attention.length === 0 && <CheckCircle2 className="h-4 w-4 text-success" aria-hidden="true" />}
          </div>
          {attention.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">Nothing in the rows read needs an operator right now.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {attention.map((item) => (
                <li key={item.id} className={`rounded-md border p-2.5 ${ATTENTION_TONE[item.tone]}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">{item.title}</p>
                      <p className="mt-0.5 text-[11px] leading-relaxed opacity-90">{item.detail}</p>
                    </div>
                    <button type="button" className="cad-ctl flex-shrink-0" onClick={() => onOpen(item.section)}>
                      Open
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Most active accounts</h3>
              <p className="text-[11px] text-muted-foreground">Recorded actions in the last {usageDays} days.</p>
            </div>
            <button type="button" className="cad-ctl" onClick={() => onOpen('accounts')}>All accounts</button>
          </div>
          {top.length === 0 ? (
            <p className="mt-4 text-xs text-muted-foreground">No account has recorded activity in this window.</p>
          ) : (
            <ul className="mt-3 space-y-2.5">
              {top.map(({ account, usage }) => {
                const max = top[0]?.usage.events || 1
                return (
                  <li key={account.id}>
                    <button
                      type="button"
                      className="block w-full rounded-md text-left outline-none hover:bg-accent/50 focus-visible:ring-1 focus-visible:ring-ring"
                      onClick={() => onInspectAccount(account)}
                    >
                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span className="truncate font-medium text-foreground">{account.name}</span>
                        <span className="flex-shrink-0 tabular-nums text-muted-foreground">{usage.events.toLocaleString()}</span>
                      </div>
                      <div className="mt-1 h-1.5 rounded-full bg-muted">
                        <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(4, (usage.events / max) * 100)}%` }} />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {`${roleLabel(account.role)} · ${usageKindLabel(usage.topKind)} · last ${formatTime(usage.lastAt)}`}
                      </p>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {topKind && (
            <p className="mt-4 border-t border-border/70 pt-3 text-[11px] text-muted-foreground">
              {`The busiest action in this window is ${usageKindLabel(topKind.kind)} (${topKind.count.toLocaleString()}).`}
            </p>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Recent operator actions</h3>
            <p className="text-[11px] text-muted-foreground">The newest rows from the append-only audit trail.</p>
          </div>
          <button type="button" className="cad-ctl" onClick={() => onOpen('audit')}>Open audit trail</button>
        </div>
        {audit.length === 0 ? (
          <p className="mt-3 text-xs text-muted-foreground">{errors.audit ? errors.audit : 'No operator action has been recorded yet.'}</p>
        ) : (
          <ul className="mt-3 divide-y divide-border/70">
            {audit.slice(0, 6).map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-[11px]">
                <span className="min-w-0">
                  <span className="font-medium text-foreground">{nameOf(entry.actor)}</span>
                  <span className="text-muted-foreground">{` · ${entry.action.replace(/^admin:/, '').replace(/_/g, ' ')}`}</span>
                  {entry.resource && entry.resource !== 'admin-console' && (
                    <span className="text-muted-foreground">{` → ${nameOf(entry.resource)}`}</span>
                  )}
                </span>
                <time className="flex-shrink-0 tabular-nums text-muted-foreground" dateTime={new Date(entry.at).toISOString()}>
                  {formatTime(entry.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  )
}
