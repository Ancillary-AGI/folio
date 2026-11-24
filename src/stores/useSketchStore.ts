import { create } from 'zustand'
import type { Point } from '../lib/sketch/geometry'

export interface SketchStroke {
  id: string
  /** Sheet coordinates, not screen pixels: ink survives pan and zoom. */
  points: Point[]
  /** Per-point stylus pressure (0–1), aligned with `points`. */
  pressure: number[]
  pointerType: 'pen' | 'touch' | 'mouse'
}

interface SketchState {
  strokes: SketchStroke[]
  /** Ink drawn on the sheet but not yet committed, kept while the tool is off. */
  addStroke: (stroke: Omit<SketchStroke, 'id'>) => void
  undoStroke: () => void
  clear: () => void
}

let strokeSeq = 0

/** Uncommitted sketch ink. Deliberately not part of the design snapshot: it is
 * a transient drawing, so undo/redo and saves never see half-recognised ink. */
export const useSketchStore = create<SketchState>()((set) => ({
  strokes: [],
  addStroke: (stroke) =>
    set((state) => ({ strokes: [...state.strokes, { ...stroke, id: `ink-${++strokeSeq}` }] })),
  undoStroke: () => set((state) => ({ strokes: state.strokes.slice(0, -1) })),
  clear: () => set({ strokes: [] }),
}))
