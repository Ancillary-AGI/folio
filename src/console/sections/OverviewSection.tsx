/**
 * Overview — the page you open first: who you are, what this month holds,
 * and the three numbers this device actually knows.
 */
import { ArrowRight, Gauge, Hammer, History, ShieldCheck } from 'lucide-react'
import { resolvePlan, usageRollup, formatBytes, storageSnapshot } from '../consoleData'
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
  const displayName = offlineMode ? localProfile?.name ?? 'Workspace owner' : (user?.email ?? 'Account')

  return (
    <div className="space-y-6">
      {/* Identity strip */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-lg font-bold text-primary" aria-hidden="true">
          {displayName.trim().slice(0, 1).toUpperCase() || '?'}
        </div>
        <div className="min-w-0">
          <p className="truncate text-lg font-extrabold tracking-tight text-foreground">{displayName}</p>
          <p className="text-xs text-muted-foreground">
            {offlineMode ? 'Local profile on this device' : 'Cloud account'} · {plan.label}
          </p>
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
