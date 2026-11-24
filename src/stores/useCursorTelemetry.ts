/**
 * Cursor telemetry for the floating HUD — a dedicated store on purpose.
 *
 * Position updates arrive at pointer-move frequency (60–120 Hz during a drag).
 * The shell's global store notifies every whole-store subscriber (the header,
 * the nav, the status bar, every panel) on each write, which turns a mouse
 * move into a cascade of React work. This store has exactly two subscribers —
 * the canvas that publishes and the HUD that reads — and the write is a no-op
 * when nothing actually moved.
 */
import { create } from 'zustand'

export type TelemetryUnit = 'mm' | 'mil' | 'in'

interface CursorTelemetryState {
  /** Board/sheet units, always millimetres at rest; `unit` is the display mode. */
  x: number
  y: number
  unit: TelemetryUnit
  setPosition: (x: number, y: number) => void
  cycleUnit: () => void
}

export const useCursorTelemetry = create<CursorTelemetryState>()((set) => ({
  x: 0,
  y: 0,
  unit: 'mm',
  setPosition: (x, y) =>
    set((state) =>
      Math.abs(state.x - x) < 1e-4 && Math.abs(state.y - y) < 1e-4
        ? state
        : { x, y },
    ),
  cycleUnit: () =>
    set((state) => ({ unit: state.unit === 'mm' ? 'mil' : state.unit === 'mil' ? 'in' : 'mm' })),
}))

/** Format a mm value for the active unit — one place, so every readout agrees. */
export function formatTelemetry(mm: number, unit: TelemetryUnit): { value: string; unit: string } {
  if (unit === 'mil') return { value: (mm * 39.3701).toFixed(1), unit: 'mil' }
  if (unit === 'in') return { value: (mm * 0.0393701).toFixed(3), unit: 'in' }
  return { value: mm.toFixed(2), unit: 'mm' }
}
