import HoverHelp from '../ui/HoverHelp'
/**
 * The surface every biology scale view shares.
 *
 * Six scales is six chances to make the same panel look like six different apps.
 * They are not: a run is a parameter rail, a refusal, some measured numbers, a
 * trace and a protocol. Each of those lives here once, so the molecule view and
 * the whole-body view read the same way, use the same chart, and state a result
 * in the same voice.
 *
 * Nothing in this file computes. Every number a view shows has to come from the
 * solver it called, and this kit only draws what came back.
 */
import type { ReactNode } from 'react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { RangeControl } from '../ui/range-control'
import { LoadingSpinner } from '../ui/LoadingSpinner'
import TraceChart, { type TraceRow, type TraceSeries } from '../charts/TraceChart'
import { fixed } from '../../lib/numberFormat'

/**
 * What the shell hands every view: the dial overrides stored for the model that is
 * loaded, and the two ways to change them. Values are keyed per model, so editing
 * an afterload experiment does not move the enzyme dial you left on another row.
 */
export interface BioViewControls {
  overrides: Readonly<Record<string, number>>
  setOverride: (key: string, value: number) => void
  resetOverrides: () => void
}

export function Kpi({
  label,
  value,
  detail,
  tone = 'default',
}: {
  label: string
  value: string
  detail?: string
  tone?: 'default' | 'warn' | 'good'
}) {
  return (
    <div
      className={`rounded-md border p-3 ${
        tone === 'warn' ? 'border-warning/50 bg-warning/5' : tone === 'good' ? 'border-primary/40 bg-primary/5' : 'border-border bg-card'
      }`}
    >
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="cad-readout mt-1 text-lg font-semibold">{value}</div>
      {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
    </div>
  )
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
}

export interface DialSpec {
  key: string
  label: string
  unit: string
  min: number
  max: number
  step: number
  /** The preset's own value: what "reset" returns to and what the run starts from. */
  default: number
  /** What the dial does to the model, in one line — the slider cannot say it. */
  help?: string
}

/**
 * The parameter rail. One `RangeControl` per dial, in a rail that wraps rather
 * than scrolls, so a model with two inputs and one with ten look deliberate.
 */
export function DialGrid({
  specs,
  values,
  onChange,
  onReset,
  label,
}: {
  specs: readonly DialSpec[]
  values: Readonly<Record<string, number>>
  onChange: (key: string, value: number) => void
  onReset: () => void
  label: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{label}</CardTitle>
          <HoverHelp title="Put every dial on this model back to the values the preset ships with" description="Put every dial on this model back to the values the preset ships with">
<Button type="button"
            size="sm"
            variant="ghost"
            onClick={onReset}>
            Reset inputs
          </Button>
</HoverHelp>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {specs.map((spec) => (
          <div key={spec.key} className="min-w-0">
            <RangeControl
              label={spec.label}
              value={values[spec.key] ?? spec.default}
              min={spec.min}
              max={spec.max}
              step={spec.step}
              onValueChange={(value) => onChange(spec.key, value)}
              format={(value) => `${trim(value)} ${spec.unit}`}
            />
            {spec.help && <p className="mt-1 text-xs text-muted-foreground">{spec.help}</p>}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(value < 1 ? 3 : 2)
}

/** The trace: the interactive chart, its own explanation, and nothing else. */
export function BioTrace({
  title,
  hint,
  data,
  series,
  xKey = 'x',
  xLabel,
  xFormatter,
  yFormatter,
  rightFormatter,
  readoutFormatter,
  yDomain,
  referencesY,
  logX,
  markerX,
  curve,
  height = 320,
  ariaLabel,
}: {
  title: string
  hint?: string
  data: TraceRow[]
  series: TraceSeries[]
  xKey?: string
  xLabel: string
  xFormatter: (value: number) => string
  yFormatter?: (value: number) => string
  rightFormatter?: (value: number) => string
  readoutFormatter?: (value: number) => string
  yDomain?: [number, number]
  referencesY?: { value: number; label?: string }[]
  logX?: boolean
  markerX?: number | null
  /** `linear` for a closed curve — see `TraceChart`. */
  curve?: 'monotone' | 'linear'
  height?: number
  ariaLabel: string
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <TraceChart
          data={data}
          series={series}
          xKey={xKey}
          xLabel={xLabel}
          xFormatter={xFormatter}
          yFormatter={yFormatter}
          rightFormatter={rightFormatter}
          readoutFormatter={readoutFormatter}
          yDomain={yDomain}
          referencesY={referencesY}
          logX={logX}
          markerX={markerX}
          curve={curve}
          height={height}
          ariaLabel={ariaLabel}
        />
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/** The two-or-three-button choice between views of the same solved run. */
export function TraceToggle({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly { id: string; label: string; hint: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1" role="group" aria-label={label}>
      {options.map((option) => (
        <Button
          key={option.id}
          type="button"
          size="sm"
          variant={option.id === value ? 'default' : 'outline'}
          onClick={() => onChange(option.id)}
          aria-pressed={option.id === value}
          title={option.hint}
        >
          {option.label}
        </Button>
      ))}
    </div>
  )
}

/** Term/value pairs, right-aligned in the readout face. */
export function BioMetrics({
  title,
  hint,
  rows,
}: {
  title: string
  hint?: string
  rows: readonly (readonly [string, string])[]
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5">
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 text-xs sm:text-sm">
          {rows.map(([term, value]) => (
            <div key={term} className="contents">
              <dt className="text-muted-foreground">{term}</dt>
              <dd className="cad-readout text-right">{value}</dd>
            </div>
          ))}
        </dl>
        {hint && <p className="pt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}

/**
 * A solver that refused.
 *
 * The biology solvers throw on an input they cannot integrate, and that refusal
 * is an answer about the design. It is shown as the alert it is, next to the
 * advice that makes it fixable, rather than becoming an empty chart.
 */
export function BioRefusal({ error, advice }: { error: string; advice?: string }) {
  return (
    <Card className="border-destructive/50">
      <CardContent className="space-y-2 py-4 text-sm">
        <p role="alert" className="font-medium text-destructive">
          {error}
        </p>
        {advice && (
          <p className="text-muted-foreground">
            {advice}
          </p>
        )}
        <p className="text-muted-foreground">
          Nothing below is plotted: the run has no numbers to plot, and an invented curve would be worse than none.
        </p>
      </CardContent>
    </Card>
  )
}

/**
 * The honest answer to "why is this not plotted yet".
 *
 * A tissue run is seven tenths of a second at the shipping mesh and forty at the
 * finest one the dial offers, so the wait is the truth of the model rather than a
 * bug to hide. It says what is running, which thread is doing it, and what the last
 * one cost — and it is a `status` region, so the answer arriving is announced.
 */
export function BioSolving({
  label,
  accelerator,
  lastDurationMs,
}: {
  label: string
  accelerator: 'worker' | 'main-thread' | null
  lastDurationMs: number | null
}) {
  const where = accelerator === 'worker' ? 'off the main thread' : accelerator === 'main-thread' ? 'on the main thread' : null
  return (
    <Card className="border-primary/40">
      <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm" role="status">
        <LoadingSpinner size="sm" />
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {where ? `Solving ${where}${lastDurationMs === null ? '' : `; the last run took ${fixed(lastDurationMs / 1000, 2)} s`}.` : 'Starting the run.'}
        </span>
      </CardContent>
    </Card>
  )
}

/** What the model says about itself — the preset note, quoted, not paraphrased. */
export function BioNote({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{heading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">{children}</CardContent>
    </Card>
  )
}

/** A check that passed or failed, with the number that decided it. */
export function BioChecks({
  title,
  hint,
  checks,
}: {
  title: string
  hint?: string
  checks: readonly { label: string; value: string; passed: boolean; note?: string }[]
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {checks.map((check) => (
          <div key={check.label} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-border pb-2 last:border-0 last:pb-0">
            <span className="min-w-0 text-sm">
              <span className={check.passed ? 'text-foreground' : 'font-medium text-warning'}>{check.label}</span>
              {check.note && <span className="block text-xs text-muted-foreground">{check.note}</span>}
            </span>
            <span className="cad-readout whitespace-nowrap text-sm">{check.value}</span>
          </div>
        ))}
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  )
}
