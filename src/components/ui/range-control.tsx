import * as React from 'react'

import { cn } from '../../lib/utils'

/** Filled fraction of the track, clamped so an out-of-range value cannot paint past the end. */
function fillFraction(value: number, min: number, max: number): number {
  if (!(max > min)) return 0
  const fraction = (value - min) / (max - min)
  if (!Number.isFinite(fraction)) return 0
  return Math.min(1, Math.max(0, fraction))
}

export interface RangeControlProps {
  /** Accessible name; also the visible label unless `compact` is set. */
  label: string
  value: number
  min: number
  max: number
  step?: number
  onValueChange: (value: number) => void
  /** Formats the live readout, and the value a screen reader announces. */
  format?: (value: number) => string
  disabled?: boolean
  className?: string
  /** For a control living in a row of its own (the playback scrubber): no label
   * line and no value chip, but the name is still announced. */
  compact?: boolean
  id?: string
}

/**
 * The app's one slider. It stays a native `<input type="range">` — arrow keys,
 * Page Up/Down, Home/End, pointer and touch dragging, the disabled state and
 * the accessible name all come from the platform; the skin is `.cad-slider` in
 * `src/app/globals.css`, driven by the `--cad-slider-pos` custom property set here.
 */
export function RangeControl({
  label,
  value,
  min,
  max,
  step,
  onValueChange,
  format,
  disabled,
  className,
  compact,
  id,
}: RangeControlProps) {
  const generated = React.useId()
  const inputId = id ?? generated
  const readout = format ? format(value) : String(value)

  const input = (
    <input
      id={inputId}
      type="range"
      className="cad-slider"
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      style={{ '--cad-slider-pos': fillFraction(value, min, max) } as React.CSSProperties}
      onChange={(event) => onValueChange(event.target.valueAsNumber)}
      {...(compact ? { 'aria-label': label } : {})}
      {...(format ? { 'aria-valuetext': readout } : {})}
    />
  )

  if (compact) {
    return <div className={cn('min-w-0 flex-1', className)}>{input}</div>
  }

  return (
    <div className={cn('space-y-0.5', className)}>
      {/* The chip sits outside the <label>: folding it in would make the readout
       * part of the accessible name, so a screen reader would announce a value
       * that changes under the user's fingers. */}
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="text-xs font-medium">
          {label}
        </label>
        <span className="cad-slider-value">{readout}</span>
      </div>
      {input}
    </div>
  )
}
