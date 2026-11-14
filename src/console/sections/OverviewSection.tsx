/**
 * Overview — the page you open first: who you are, what the last 30 days
 * hold, what changed lately, and where to go next. Every number below is
 * read from the stores the workbench actually writes.
 */
import { ArrowRight, Gauge, Hammer, History, Download, ShieldCheck, Wrench } from 'lucide-react'
import { resolvePlan, usageRollup, formatBytes, storageSnapshot, recentActivity, relativeTime, exportLocalData, USAGE_KIND_LABEL } from '../consoleData'
import Avatar from '../../components/Avatar'
import UsageCharts from './UsageCharts'
import { downloadFile } from '../../lib/exportUtils'
import type { User } from '../../types'
import type { LocalProfile } from '../../stores/useLocalProfileStore'

interface OverviewSectionProps {
  offlineMode: boolean
  user: User | null
  localProfile: LocalProfile | null
  onOpenSection: (section: 'usage' | 'plan' | 'data') => void
}

export default function OverviewSection({ offlineMode, user, localProfile, onOpenSection }: OverviewSectionProps) {
  const plan = resolvePlan(user, offlineMode)
  const rollup = usageRollup(30)
  const storage = storageSnapshot()
  const activity = recentActivity(8)
  const displayName = offlineMode ? localProfile?.name ?? 'Workspace owner' : (user?.email ?? 'Account')

  return (
    <div className="space-y-6">
      {/* Identity strip */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={displayName} size={56} className="h-14 w-14 flex-shrink-0" />
          <div className="min-w-0">
            <p className="truncate text-lg font-extrabold tracking-tight text-foreground">{displayName}</p>
            <p className="text-xs text-muted-foreground">
              {offlineMode ? 'Local profile on this device' : 'Cloud account'} · {plan.label}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a
            href="/app"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-[#D97A12] bg-primary px-3.5 text-xs font-bold text-[#221300] transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
            Open the workbench
          </a>
          <button
            type="button"
            onClick={() => {
              const { filename, json } = exportLocalData()
              downloadFile(json, filename, 'application/json')
            }}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3.5 text-xs font-semibold text-foreground transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Download my data
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {/* Plan card */}
        <button
          type="button"
          onClick={() => onOpenSection('plan')}
          className="group rounded-xl border border-border/70 bg-card/60 p-4 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center justify-between">
            <Gauge className="h-4 w-4 text-primary" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Plan</p>
          <p className="mt-1 text-sm font-bold text-foreground">{plan.label}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground line-clamp-2">{plan.detail}</p>
        </button>

        {/* Usage card */}
        <button
          type="button"
          onClick={() => onOpenSection('usage')}
          className="group rounded-xl border border-border/70 bg-card/60 p-4 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center justify-between">
            <History className="h-4 w-4 text-primary" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Last 30 days</p>
          <p className="mt-1 text-sm font-bold text-foreground">{rollup.totalEvents.toLocaleString()} recorded actions</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {rollup.highlights[0].count} agent runs · {rollup.highlights[1].count} simulations · {rollup.highlights[2].count} designs made theirs
          </p>
        </button>

        {/* Storage card */}
        <button
          type="button"
          onClick={() => onOpenSection('data')}
          className="group rounded-xl border border-border/70 bg-card/60 p-4 text-left transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="flex items-center justify-between">
            <Hammer className="h-4 w-4 text-primary" aria-hidden="true" />
            <ArrowRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </div>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">This device holds</p>
          <p className="mt-1 text-sm font-bold text-foreground">{formatBytes(storage.totalBytes)} of Folio data</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{storage.entries.length} storage keys, tied to this browser profile.</p>
        </button>
      </div>

      <UsageCharts days={30} />

      {/* Recent activity — the actual ledger tail, newest first. */}
      <section aria-labelledby="recent-heading" className="overflow-hidden rounded-xl border border-border/70 bg-card/40">
        <div className="flex items-center justify-between gap-4 border-b border-border/70 px-4 py-2.5">
          <h2 id="recent-heading" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Recent activity
          </h2>
          <button
            type="button"
            onClick={() => onOpenSection('usage')}
            className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            Full usage →
          </button>
        </div>
        {activity.length === 0 ? (
          <p className="px-4 py-5 text-xs leading-relaxed text-muted-foreground">
            Nothing recorded yet. The ledger starts the moment you open a workspace, run a simulation or export a design — it will fill in as you work.
          </p>
        ) : (
          <ul className="divide-y divide-border/60">
            {activity.map(({ event }) => (
              <li key={event.id} className="flex items-center justify-between gap-4 px-4 py-2">
                <span className="min-w-0 truncate text-xs font-medium text-foreground">{USAGE_KIND_LABEL[event.kind] ?? event.kind}</span>
                <span className="flex-shrink-0 font-mono text-[10px] text-muted-foreground">{relativeTime(event.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* What lives where — the sentence every honest console should say out loud. */}
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-muted-foreground">
            {offlineMode
              ? 'Everything you do in Folio stays on this device: projects, design history, the usage ledger. There is no server metering you and no sync to another machine — yet. Use Data → download your local copy if you want a backup.'
              : 'Your designs live in the deployment’s database. The numbers in Usage are read from this device’s ledger; your organisation sees the mirrored events in its admin console.'}
          </p>
        </div>
      </div>
    </div>
  )
}
