/**
 * Interactive trace chart: the solved samples, plus the gestures an engineer
 * uses to read them.
 *
 * Drag to zoom a window, Shift-drag to pan, wheel to zoom under the cursor,
 * click to pin a readout, and keyboard (+/-, arrows, R) for the same without a
 * pointer. Zooming only ever changes the visible domain — every value shown
 * comes from a real solved sample, never an interpolation, so a pinned cursor
 * reports what the solver produced.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { chartColor } from '../../lib/theme/tokens'
import { useTheme } from '../../lib/theme/useTheme'

export interface TraceSeries {
  key: string
  color: string
  axis?: 'left' | 'right'
  /** Display name for the legend and the cursor readout; defaults to `key`. */
  label?: string
  /** Suffix for the cursor readout, e.g. "V", "Hz" or "°". */
  unit?: string
  /** SVG dash pattern for a trace, e.g. a reference or derived quantity. */
  dash?: string
}

/** Horizontal reference line, e.g. the −3 dB corner of a filter. */
export interface TraceReferenceY {
  value: number
  label?: string
}

export interface TraceRow {
  /** `null` marks a sample the solver could not produce; the line breaks there. */
  [column: string]: number | null | undefined
}

interface TraceChartProps {
  data: TraceRow[]
  series: TraceSeries[]
  xKey?: string
  xLabel: string
  xFormatter: (value: number) => string
  yFormatter?: (value: number) => string
  /**
   * Digits for the pinned cursor readout. Axis ticks can round for space; a
   * value an engineer reads off a cursor must keep the solved precision.
   */
  readoutFormatter?: (value: number) => string
  rightFormatter?: (value: number) => string
  /** Fixed left-axis range, e.g. −80…5 dB so designs stay comparable. */
  yDomain?: [number, number]
  yTicks?: number[]
  /** Horizontal reference lines drawn on the left axis. */
  referencesY?: TraceReferenceY[]
  logX?: boolean
  /** Explicit x ticks, e.g. decade marks on a frequency axis. */
  ticks?: number[]
  height?: number
  /** Vertical marker in x units, e.g. a playback head. */
  markerX?: number | null
  ariaLabel: string
}

const MARGIN = { top: 8, right: 8, bottom: 24, left: 8 }
const LEFT_AXIS_WIDTH = 62
const RIGHT_AXIS_WIDTH = 56
const MIN_SPAN_RATIO = 1e-6

/**
 * Recharts calls a tick formatter as `formatter(value, index)`. Passing a panel's
 * one-argument formatter straight through hands it the tick index as its second
 * argument, which is how `toPrecision(0)` once reached a scale function.
 */
function axisText(format: (value: number) => string): (value: unknown) => string {
  return (value) => format(Number(value))
}

function finiteXs(data: TraceRow[], xKey: string): number[] {
  return data
    .map((row) => row[xKey])
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((left, right) => left - right)
}

/**
 * Snap a requested window onto real sample positions so the view is exact.
 * Distances are compared in axis space, which keeps a log view honest.
 */
function snapToSamples(
  xs: number[],
  lo: number,
  hi: number,
  toAxis: (value: number) => number = (value) => value,
): { lo: number; hi: number } {
  if (xs.length === 0) return { lo, hi }
  const targetLo = toAxis(lo)
  const targetHi = toAxis(hi)
  const lower = xs.reduce((best, x) => (Math.abs(toAxis(x) - targetLo) < Math.abs(toAxis(best) - targetLo) ? x : best), xs[0])
  const upper = xs.reduce((best, x) => (Math.abs(toAxis(x) - targetHi) < Math.abs(toAxis(best) - targetHi) ? x : best), xs[0])
  return lower < upper ? { lo: lower, hi: upper } : { lo: upper, hi: lower }
}

export default function TraceChart({
  data,
  series,
  xKey = 'x',
  xLabel,
  xFormatter,
  yFormatter = (value) => value.toPrecision(3),
  readoutFormatter,
  rightFormatter,
  yDomain,
  yTicks,
  referencesY,
  logX = false,
  ticks,
  height = 256,
  markerX = null,
  ariaLabel,
}: TraceChartProps) {
  const { theme } = useTheme()
  const chrome = useMemo(
    () => ({
      grid: chartColor(theme, '--border'),
      label: chartColor(theme, '--muted-foreground'),
      cursor: chartColor(theme, '--foreground'),
    }),
    [theme],
  )
  const xs = useMemo(() => finiteXs(data, xKey), [data, xKey])
  const fullDomain = useMemo(() => {
    if (xs.length === 0) return null
    const [min, max] = [xs[0], xs[xs.length - 1]]
    // A log axis cannot include zero or negatives; fall back to linear rather
    // than silently dropping the first samples.
    if (logX && min <= 0) return { lo: min, hi: max, log: false }
    return { lo: min, hi: max, log: logX }
  }, [xs, logX])

  const [view, setView] = useState<{ lo: number; hi: number } | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [selection, setSelection] = useState<{ from: number; to: number } | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ start: number; mode: 'zoom' | 'pan' } | null>(null)

  const domainLo = fullDomain?.lo
  const domainHi = fullDomain?.hi

  // A fresh analysis changes the axis range; re-rendering the same solve must
  // not throw away the window the engineer just zoomed to.
  useEffect(() => {
    setView(null)
    setCursor(null)
  }, [domainLo, domainHi])

  const domain = fullDomain ?? null
  const viewLo = view?.lo ?? domain?.lo ?? 0
  const viewHi = view?.hi ?? domain?.hi ?? 0
  const zoomed = view !== null
  const logarithmic = Boolean(domain?.log)

  const toAxis = useCallback(
    (value: number) => (logarithmic ? Math.log(Math.max(value, Number.MIN_VALUE)) : value),
    [logarithmic],
  )
  const fromAxis = useCallback(
    (position: number) => (logarithmic ? Math.exp(position) : position),
    [logarithmic],
  )

  const valueAt = useCallback(
    (fraction: number) => {
      const clamped = Math.min(1, Math.max(0, fraction))
      const lo = toAxis(viewLo)
      return fromAxis(lo + (toAxis(viewHi) - lo) * clamped)
    },
    [fromAxis, toAxis, viewLo, viewHi],
  )

  const pointerFraction = (clientX: number) => {
    const rect = overlayRef.current?.getBoundingClientRect()
    if (!rect || rect.width <= 0) return null
    return (clientX - rect.left) / rect.width
  }

  /**
   * Scale the visible window by `factor` while keeping the value under the
   * pointer (or the centre, for buttons and keys) in place.
   */
  const zoomAround = useCallback(
    (centre: number, factor: number) => {
      if (!domain) return
      const fullLo = toAxis(domain.lo)
      const fullHi = toAxis(domain.hi)
      const lo = toAxis(viewLo)
      const hi = toAxis(viewHi)
      const span = hi - lo
      const nextSpan = span * factor
      if (nextSpan >= fullHi - fullLo) {
        setView(null)
        return
      }
      if (nextSpan <= (fullHi - fullLo) * MIN_SPAN_RATIO) return
      const centreAxis = toAxis(centre)
      const anchorRatio = span === 0 ? 0.5 : (centreAxis - lo) / span
      const nextLo = centreAxis - anchorRatio * nextSpan
      const nextHi = nextLo + nextSpan
      setView(
        snapToSamples(
          xs,
          fromAxis(Math.max(fullLo, nextLo)),
          fromAxis(Math.min(fullHi, nextHi)),
          toAxis,
        ),
      )
    },
    [domain, fromAxis, toAxis, viewLo, viewHi, xs],
  )

  const pan = useCallback(
    (deltaPixels: number) => {
      if (!domain || !overlayRef.current) return
      const rect = overlayRef.current.getBoundingClientRect()
      if (rect.width <= 0) return
      const fullLo = toAxis(domain.lo)
      const fullHi = toAxis(domain.hi)
      const shift = (deltaPixels / rect.width) * (toAxis(viewHi) - toAxis(viewLo))
      let lo = toAxis(viewLo) - shift
      let hi = toAxis(viewHi) - shift
      if (lo < fullLo) {
        hi += fullLo - lo
        lo = fullLo
      }
      if (hi > fullHi) {
        lo -= hi - fullHi
        hi = fullHi
      }
      setView(snapToSamples(xs, fromAxis(lo), fromAxis(hi), toAxis))
    },
    [domain, fromAxis, toAxis, viewHi, viewLo, xs],
  )

  const nearestSample = useCallback(
    (value: number) => {
      if (xs.length === 0) return null
      const target = toAxis(value)
      return xs.reduce(
        (best, x) => (Math.abs(toAxis(x) - target) < Math.abs(toAxis(best) - target) ? x : best),
        xs[0],
      )
    },
    [toAxis, xs],
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const fraction = pointerFraction(event.clientX)
    if (fraction === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { start: fraction, mode: event.shiftKey ? 'pan' : 'zoom' }
    setSelection({ from: fraction, to: fraction })
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    const fraction = pointerFraction(event.clientX)
    if (fraction === null) return
    if (dragRef.current.mode === 'zoom') setSelection({ from: dragRef.current.start, to: fraction })
  }

  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    dragRef.current = null
    setSelection(null)
    if (!drag || !domain) return
    const fraction = pointerFraction(event.clientX) ?? drag.start
    const travelled = Math.abs(fraction - drag.start)
    if (travelled < 0.01) {
      if (drag.mode === 'zoom') {
        const pinned = nearestSample(valueAt(fraction))
        setCursor(pinned !== null && pinned !== cursor ? pinned : null)
      }
      return
    }
    if (drag.mode === 'pan') {
      pan((fraction - drag.start) * (overlayRef.current?.getBoundingClientRect().width ?? 0))
      return
    }
    const a = valueAt(Math.min(drag.start, fraction))
    const b = valueAt(Math.max(drag.start, fraction))
    setView(snapToSamples(xs, Math.max(domain.lo, a), Math.min(domain.hi, b), toAxis))
  }

  useEffect(() => {
    const node = overlayRef.current
    if (!node) return
    const onWheel = (event: WheelEvent) => {
      if (!domain) return
      // Trackpads emit deltaX-only wheels while scrolling sideways; zooming for
      // those would hijack a gesture the engineer never meant as a zoom.
      if (event.deltaY === 0) return
      event.preventDefault()
      const rect = node.getBoundingClientRect()
      if (rect.width <= 0) return
      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      zoomAround(valueAt(fraction), event.deltaY < 0 ? 1 / 1.35 : 1.35)
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [domain, valueAt, zoomAround])

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const centre = valueAt(0.5)
    const stepAxis = (toAxis(viewHi) - toAxis(viewLo)) * 0.1
    const cursorPosition = cursor ?? centre
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomAround(centre, 1 / 1.6)
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      zoomAround(centre, 1.6)
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setCursor(nearestSample(fromAxis(Math.max(toAxis(domain?.lo ?? viewLo), toAxis(cursorPosition) - stepAxis))))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setCursor(nearestSample(fromAxis(Math.min(toAxis(domain?.hi ?? viewHi), toAxis(cursorPosition) + stepAxis))))
    } else if (event.key === 'r' || event.key === 'R') {
      event.preventDefault()
      setView(null)
      setCursor(null)
    }
  }

  const cursorRow = useMemo(() => {
    if (cursor === null) return null
    return data.find((row) => row[xKey] === cursor) ?? null
  }, [cursor, data, xKey])

  // A re-solve can keep the same axis range but move the sample grid; a cursor
  // that no longer lands on a sample would report a value the solver never made.
  useEffect(() => {
    if (cursor === null) return
    if (!xs.some((x) => x === cursor)) setCursor(null)
  }, [cursor, xs])

  const hasRightAxis = series.some((entry) => entry.axis === 'right')
  const readoutValue = readoutFormatter ?? yFormatter

  if (!domain || data.length === 0) {
    return (
      <div
        role="figure"
        aria-label={ariaLabel}
        className="flex items-center justify-center rounded border border-border/60 bg-muted/30 text-xs text-muted-foreground"
        style={{ height }}
      >
        Run an analysis to plot a response.
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="relative" style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={MARGIN}>
            <CartesianGrid stroke={chrome.grid} strokeDasharray="3 3" />
            <XAxis
              dataKey={xKey}
              type="number"
              scale={logarithmic ? 'log' : 'linear'}
              domain={[viewLo, viewHi]}
              ticks={ticks}
              allowDataOverflow
              tickFormatter={axisText(xFormatter)}
              stroke={chrome.label}
              fontSize={11}
              minTickGap={24}
            />
            <YAxis
              yAxisId="left"
              width={LEFT_AXIS_WIDTH}
              tickFormatter={axisText(yFormatter)}
              domain={yDomain}
              ticks={yTicks}
              allowDataOverflow={yDomain !== undefined}
              stroke={chrome.label}
              fontSize={11}
            />
            {hasRightAxis && (
              <YAxis
                yAxisId="right"
                orientation="right"
                width={RIGHT_AXIS_WIDTH}
                tickFormatter={axisText(rightFormatter ?? yFormatter)}
                stroke={chrome.label}
                fontSize={11}
              />
            )}
            <Tooltip
              formatter={(value: number, name: string) => [
                typeof value === 'number' ? readoutValue(value) : String(value),
                name,
              ]}
              labelFormatter={(value: number) => `${xLabel}: ${xFormatter(value)}`}
            />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {series.map((entry) => (
              <Line
                key={entry.key}
                yAxisId={entry.axis === 'right' ? 'right' : 'left'}
                type="monotone"
                dataKey={entry.key}
                name={entry.label ?? entry.key}
                stroke={entry.color}
                strokeWidth={2}
                strokeDasharray={entry.dash}
                dot={false}
                isAnimationActive={false}
              />
            ))}
            {referencesY?.map((reference) => (
              <ReferenceLine
                key={`${reference.value}`}
                yAxisId="left"
                y={reference.value}
                stroke={chrome.label}
                strokeDasharray="4 4"
                label={
                  reference.label
                    ? { value: reference.label, position: 'insideTopRight', fontSize: 10, fill: chrome.label }
                    : undefined
                }
              />
            ))}
            {markerX !== null && markerX !== undefined && (
              <ReferenceLine yAxisId="left" x={markerX} stroke={chrome.label} strokeDasharray="4 4" />
            )}
            {cursor !== null && (
              <ReferenceLine yAxisId="left" x={cursor} stroke={chrome.cursor} strokeDasharray="2 2" />
            )}
          </LineChart>
        </ResponsiveContainer>

        <div
          ref={overlayRef}
          role="application"
          tabIndex={0}
          aria-label={`${ariaLabel} plot area. Drag to zoom, shift-drag to pan, click to pin a readout, plus and minus to zoom, left and right arrows to step the cursor, R to reset.`}
          className="absolute cursor-crosshair outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{
            top: MARGIN.top,
            bottom: MARGIN.bottom,
            left: MARGIN.left + LEFT_AXIS_WIDTH,
            right: MARGIN.right + (hasRightAxis ? RIGHT_AXIS_WIDTH : 0),
            touchAction: 'none',
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragRef.current = null
            setSelection(null)
          }}
          onDoubleClick={() => setView(null)}
          onKeyDown={onKeyDown}
        >
          {selection && (
            <div
              className="pointer-events-none absolute top-0 bottom-0 bg-sky-400/20 ring-1 ring-sky-400/60"
              style={{
                left: `${Math.min(selection.from, selection.to) * 100}%`,
                width: `${Math.abs(selection.to - selection.from) * 100}%`,
              }}
            />
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-mono text-muted-foreground" aria-live="polite">
          {`${xLabel} ${xFormatter(viewLo)} – ${xFormatter(viewHi)}`}
          {zoomed ? ` of ${xFormatter(domain.lo)} – ${xFormatter(domain.hi)}` : ''}
        </span>
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-40"
          onClick={() => zoomAround(valueAt(0.5), 1 / 1.6)}
        >
          Zoom in
        </button>
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-40"
          onClick={() => zoomAround(valueAt(0.5), 1.6)}
          disabled={!zoomed}
        >
          Zoom out
        </button>
        <button
          type="button"
          className="rounded border border-border px-2 py-0.5 hover:bg-accent disabled:opacity-40"
          onClick={() => {
            setView(null)
            setCursor(null)
          }}
          disabled={!zoomed && cursor === null}
        >
          Reset view
        </button>
      </div>

      {cursor !== null && cursorRow && (
        <div
          role="status"
          aria-label="Pinned cursor readout"
          className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground"
        >
          {xLabel} {xFormatter(cursor)}
          {series.map((entry) => {
            const value = cursorRow[entry.key]
            return (
              <span key={entry.key}>
                {' · '}
                {entry.label ?? entry.key}{' '}
                {value === undefined || value === null ? '—' : `${readoutValue(value)}${entry.unit ? ` ${entry.unit}` : ''}`}
              </span>
            )
          })}
        </div>
      )}
    </div>
  )
}
