/**
 * The PCB board's editable state, with an undo stack that covers all of it.
 *
 * Placement, copper and part rotation/side are one record because they are one
 * design: undoing a move must not leave the copper that was drawn against the
 * old pads, and undoing a track must not leave the part it was routed to where
 * it was. Splitting them into three `useState` hooks is how an editor ends up
 * with an undo that half-restores a board.
 *
 * History stores whole snapshots — see `createHistory` in `lib/pcb/boardEdit`.
 * A drag would otherwise push one snapshot per pointer event, so a drag passes a
 * coalescing key and the pointer release seals it: one gesture, one undo.
 */
import { useCallback, useRef, useState } from 'react'
import {
  commitHistory,
  createHistory,
  redoHistory,
  undoHistory,
  type EditableTrace,
  type EditableVia,
  type History,
  type PlacementEdit,
} from '../../lib/pcb/boardEdit'
import type { PCBKeepout } from '../../lib/manufacturing/pcb'

export interface BoardEdits {
  traces: EditableTrace[]
  vias: EditableVia[]
  placements: Record<string, PlacementEdit>
  keepouts: PCBKeepout[]
}

export interface BoardEditor {
  edits: BoardEdits
  traces: EditableTrace[]
  vias: EditableVia[]
  placements: Record<string, PlacementEdit>
  keepouts: PCBKeepout[]
  canUndo: boolean
  canRedo: boolean
  /** Commit one edit. `coalesceKey` folds a continuous gesture into one undo step. */
  apply: (mutate: (current: BoardEdits) => BoardEdits, coalesceKey?: string) => void
  /** End a coalesced gesture so the next one is its own undo step. */
  seal: () => void
  /** Adopt a board this panel did not draw; the history starts from here. */
  adopt: (next: BoardEdits) => void
  undo: () => void
  redo: () => void
}

export function useBoardEdits(initial: () => BoardEdits): BoardEditor {
  const [history, setHistory] = useState<History<BoardEdits>>(() => createHistory(initial()))
  // The coalescing key lives in a ref, not state: pointer-event bursts inside
  // one frame must each see the key their predecessor just set, and a state
  // read inside one synchronous batch is always the pre-gesture value.
  const gestureRef = useRef<string | null>(null)

  const apply = useCallback((mutate: (current: BoardEdits) => BoardEdits, coalesceKey?: string) => {
    const continuing = coalesceKey !== undefined && coalesceKey === gestureRef.current
    setHistory((current) => (continuing
      ? { ...current, present: mutate(current.present) }
      : commitHistory(current, mutate(current.present))))
    // No key starts a fresh gesture; a different key replaces the current one.
    gestureRef.current = coalesceKey ?? null
  }, [])

  const seal = useCallback(() => { gestureRef.current = null }, [])

  const adopt = useCallback((next: BoardEdits) => {
    gestureRef.current = null
    setHistory(createHistory(next))
  }, [])

  const undo = useCallback(() => {
    gestureRef.current = null
    setHistory(undoHistory)
  }, [])

  const redo = useCallback(() => {
    gestureRef.current = null
    setHistory(redoHistory)
  }, [])

  return {
    edits: history.present,
    traces: history.present.traces,
    vias: history.present.vias,
    placements: history.present.placements,
    keepouts: history.present.keepouts,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    apply,
    seal,
    adopt,
    undo,
    redo,
  }
}
