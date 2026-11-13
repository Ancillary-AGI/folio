/**
 * Usage — what this device actually recorded, from the ledger the workbench
 * writes. Windowed, attributed, and honest about being device-local.
 */
import { useMemo, useState } from 'react'
import { Activity, Cpu, Copy, Download } from 'lucide-react'
import { usageRollup, usageCsv, USAGE_KIND_LABEL } from '../consoleData'
import { downloadFile } from '../../lib/exportUtils'

const WINDOWS = [7, 14, 30, 90] as const

export default function UsageSection() {
  const [windowDays, setWindowDays] = useState<number>(30)
  const rollup = useMemo(() => usageRollup(windowDays), [windowDays])
  const { summary } = rollup

  const maxDaily = Math.max(1, ...summary.daily.map((day) => day.count))
  const shownDaily = summary.daily.slice(-14)

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-foreground">Usage on this device</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            From the local ledger — append-only, capped at 5,000 events. Cloud deployments mirror each event to the org ledger.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const { filename, csv } = usageCsv(windowDays)
              downloadFile(csv, filename, 'text/csv')
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-border/70 bg-card/50 px-2.5 text-[10px] font-semibold text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            title="Download a CSV of this window, one row per day"
          >
            <Download className="h-3 w-3" aria-hidden="true" />
            CSV
          </button>
          <div role="group" aria-label="Window" className="flex items-center gap-1 rounded-lg border border-border/70 bg-card/50 p-1">
            {WINDOWS.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => setWindowDays(days)}
                aria-pressed={windowDays === days}
                className={`h-7 rounded-md px-3 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${windowDays === days ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {rollup.totalEvents === 0 ? (
        <div className="rounded-xl border border-border/70 bg-card/60 p-6 text-center">
          <Activity className="mx-auto h-6 w-6 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-2 text-sm font-semibold text-foreground">Nothing recorded yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
            The ledger starts recording the moment you open a workspace, run a simulation or make a design yours. It will fill in as you work.
          </p>
        </div>
      ) : (
        <>
          {/* Highlights — the three numbers people ask about first. */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3">
            {[
              { icon: Cpu, label: 'Agent runs', value: rollup.highlights[0].count },
              { icon: Activity, label: 'Simulations', value: rollup.highlights[1].count },
              { icon: Copy, label: 'Community designs made theirs', value: rollup.highlights[2].count },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-xl border border-border/70 bg-card/60 p-3 text-center sm:p-4">
                <Icon className="mx-auto h-4 w-4 text-primary" aria-hidden="true" />
                <p className="mt-2 text-xl font-extrabold tabular-nums text-foreground sm:text-2xl">{value.toLocaleString()}</p>
                <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:text-[11px]">{label}</p>
              </div>
            ))}
          </div>

          {/* Headline stats for the window. */}
          <div className="grid grid-cols-3 gap-2 sm:gap-3 text-center">
            {(() => {
              const counts = summary.daily.map((day) => day.count)
              const activeDays = counts.filter((count) => count > 0).length
              const peak = Math.max(0, ...counts)
              const average = (rollup.totalEvents / windowDays).toFixed(1)
              return [
                { value: String(activeDays), label: `Active days / ${windowDays}` },
                { value: String(peak), label: 'Peak day' },
                { value: average, label: 'Avg per day' },
              ]
            })().map(({ value, label }) => (
              <div key={label} className="rounded-xl border border-border/70 bg-card/40 p-2.5 sm:p-3">
                <p className="text-lg font-extrabold tabular-nums text-foreground sm:text-xl">{value}</p>
                <p className="mt-0.5 text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground sm:text-[10px]">{label}</p>
              </div>
            ))}
          </div>

          {/* Daily activity — pure divs, no chart library for one bar chart. */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Last {shownDaily.length} days</p>
            <div className="mt-2 flex h-28 items-end gap-1" aria-hidden="true">
              {shownDaily.map((day) => (
                <div
                  key={day.date}
                  className="flex-1 rounded-sm bg-primary/70 transition-colors hover:bg-primary"
                  style={{ height: `${Math.max(2, Math.round((day.count / maxDaily) * 100))}%` }}
                  title={`${day.date} — ${day.count} events`}
                />
              ))}
            </div>
            <div className="mt-1 flex justify-between text-[9px] text-muted-foreground/80">
              <span>{shownDaily[0]?.date.slice(5)}</span>
              <span>{shownDaily[shownDaily.length - 1]?.date.slice(5)}</span>
            </div>
          </div>

          {/* Every kind, counted. */}
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">By kind — {windowDays}d</p>
            <ul className="mt-2 divide-y divide-border/60 rounded-xl border border-border/70 bg-card/60">
              {summary.byKind.map(({ kind, count }) => (
                <li key={kind} className="flex items-center justify-between gap-4 px-4 py-2 text-xs">
                  <span className="text-muted-foreground">{USAGE_KIND_LABEL[kind] ?? kind}</span>
                  <span className="tabular-nums font-semibold text-foreground">{count.toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
