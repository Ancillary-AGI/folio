/**
 * Usage charts for the console — all of them real.
 *
 * Every bar on this page is computed from the same `folio.usage.v1` ledger
 * the workbench writes; nothing is estimated, sampled down or pre-baked.
 * The hour histogram answers "when do I actually work" from the timestamps
 * of recorded actions, and the category bars show the same actions by kind.
 */
import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getUsageEvents, summarizeUsage } from '../../lib/admin/usageLedger'

function useUsageEvents(days: number) {
  // Read the ledger once per mount; SSR renders nothing that depends on it.
  return useMemo(() => {
    const events = getUsageEvents();
    return { events, summary: summarizeUsage(events, days) };
  }, [days]);
}

export default function UsageCharts({ days }: { days: number }) {
  const { events, summary } = useUsageEvents(days);
  const hourly = useMemo(() => {
    const since = Date.now() - days * 24 * 3600 * 1000;
    const buckets = new Array(24).fill(0) as number[];
    for (const event of events) {
      if (event.at < since) continue;
      buckets[new Date(event.at).getHours()] += 1;
    }
    return buckets.map((count, hour) => ({ hour: `${String(hour).padStart(2, '0')}`, count }));
  }, [events, days]);
  const { total, daily, byKind } = summary;
  const empty = total === 0
  const insight = useMemo(() => {
    if (byKind.length === 0) return null
    const [top] = byKind
    return { label: top.kind, share: Math.round((top.count / total) * 100) }
  }, [byKind, total])

  return (
    <section aria-label="Usage dashboard" className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-border/70 bg-card/60 p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Your last {days} days
          </h3>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {total.toLocaleString()} action{total === 1 ? '' : 's'}
          </span>
        </div>
        <div className="mt-2 flex h-36 items-end gap-[3px]" role="img" aria-label={`Actions per day over the last ${days} days`}>
          {daily.map((day) => {
            const peak = Math.max(1, ...daily.map((candidate) => candidate.count))
            return (
              <div key={day.date} className="group relative flex flex-1 flex-col justify-end" aria-label={`${day.date}: ${day.count} action${day.count === 1 ? '' : 's'}`}>
                <div
                  className="rounded-[2px] transition-colors group-hover:bg-primary"
                  style={{ height: `${empty ? 0 : (day.count / peak) * 100}%`, minHeight: day.count > 0 ? '4px' : '1px', background: day.count > 0 ? 'hsl(var(--primary) / 0.85)' : 'hsl(var(--border))' }}
                />
              </div>
            )
          })}
        </div>
        <div className="mt-1.5 flex justify-between font-mono text-[9px] text-muted-foreground/80" aria-hidden="true">
          <span>{daily[0]?.date.slice(5)}</span>
          <span>{daily[daily.length - 1]?.date.slice(5)}</span>
        </div>
        {!empty && insight && (
          <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
            Your most-used action is <span className="font-semibold text-foreground">{insight.label}</span> ({insight.share}% of the window).
          </p>
        )}
      </div>

      <div className="rounded-xl border border-border/70 bg-card/60 p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">When you work</h3>
        {empty ? (
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            The hour strip fills in as you use the workbench — each bar counts recorded actions inside that hour.
          </p>
        ) : (
          <div className="mt-2">
            <ResponsiveContainer width="100%" height={104}>
              <BarChart data={hourly} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="12%">
                <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="2 4" vertical={false} />
                <XAxis dataKey="hour" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 9 }} tickLine={false} axisLine={false} interval={5} />
                <YAxis hide domain={[0, 'dataMax']} />
                <Tooltip cursor={{ fill: 'hsl(var(--accent) / 0.35)' }} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: 6, fontSize: 11 }} labelFormatter={(value) => `${value}:00 hour`} />
                <Bar dataKey="count" name="actions" fill="hsl(var(--primary))" isAnimationActive={false} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  )
}