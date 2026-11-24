/**
 * Small presentational pieces shared by the console sections.
 *
 * They live in one module so the overview and the detail sections cannot drift
 * into two different ideas of a KPI card, a status chip or a CSV download.
 * None of them read data; every number arrives from the deployment.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-border bg-card ${className}`}>{children}</div>
}

export function SectionHeader({ title, detail, children }: { title: string; detail: string; children?: ReactNode }) {
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

export const PICKER_CLASS =
  'min-h-8 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50'

export function Picker({ label, value, onChange, children }: {
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

export type KpiTone = 'primary' | 'amber' | 'success' | 'muted' | 'destructive'

export function Kpi({ label, value, hint, icon: Icon, tone = 'primary' }: {
  label: string
  value: string
  hint: string
  icon: LucideIcon
  tone?: KpiTone
}) {
  const tones: Record<KpiTone, string> = {
    primary: 'border-primary/40 bg-primary/10 text-primary',
    amber: 'border-warning/40 bg-warning/10 text-warning',
    success: 'border-success/40 bg-success/10 text-success',
    muted: 'border-border bg-muted text-muted-foreground',
    destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
  }
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">{label}</span>
        <span className={`flex h-7 w-7 items-center justify-center rounded-md border ${tones[tone]}`}>
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold tabular-nums tracking-tight text-foreground">{value}</p>
      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</p>
    </Card>
  )
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-6 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

export function Alert({ tone, children }: { tone: 'warning' | 'destructive' | 'success'; children: ReactNode }) {
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

export function Meter({ used, limit }: { used: number; limit: number | null }) {
  const ratio = limit === null || limit === 0 ? (used > 0 ? 1 : 0) : Math.min(1, used / limit)
  const tone = limit !== null && used >= limit ? 'bg-destructive' : ratio >= 0.8 ? 'bg-warning' : 'bg-success'
  return (
    <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(ratio > 0 ? 6 : 0, ratio * 100)}%` }} />
    </span>
  )
}

export function StatusChip({ status }: { status: 'active' | 'suspended' }) {
  return (
    <span className={`cad-chip ${status === 'active'
      ? 'border-success/40 bg-success/10 text-success'
      : 'border-destructive/40 bg-destructive/10 text-destructive'}`}>
      {status}
    </span>
  )
}

/** Chart hues resolve through CSS custom properties, so every theme stays legible. */
export const CHART_HUES = [
  'hsl(var(--chart-1))',
  'hsl(var(--chart-2))',
  'hsl(var(--chart-3))',
  'hsl(var(--chart-4))',
  'hsl(var(--chart-5))',
  'hsl(var(--chart-6))',
] as const

export const CHART_TOOLTIP_STYLE = {
  background: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 11,
  color: 'hsl(var(--foreground))',
} as const
