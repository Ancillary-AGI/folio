import { create } from 'zustand'
import type { ERCResult } from '../lib/manufacturing/erc'

export type DesignHealthTab = 'problems' | 'outline'

interface DesignHealthState {
  /** Latest electrical rule check, or `null` before the sheet has been checked. */
  result: ERCResult | null
  /** The workbench bottom panel is an IDE-style dock, not a modal. */
  panelOpen: boolean
  tab: DesignHealthTab
  /** Dragged height in pixels; the quiet state ignores it. */
  panelHeight: number
  /**
   * Index into the severity-ordered findings, or `null` before the user has
   * stepped through them. F8/Shift+F8 own this cursor; a new rule-check result
   * clears it because the old row numbers no longer describe the same list.
   */
  activeFindingIndex: number | null
  setResult: (result: ERCResult) => void
  setPanelOpen: (open: boolean) => void
  togglePanel: () => void
  setTab: (tab: DesignHealthTab) => void
  setPanelHeight: (height: number) => void
  setActiveFindingIndex: (index: number | null) => void
}

/**
 * The sheet's rule-check result and the bottom panel that reads it.
 *
 * The result lives here because two surfaces own half of the story: the
 * schematic workspace runs the check on every edit, while the app status bar
 * is where a designer looks for the count. Keeping it in one store means the
 * status bar never re-runs the check and never disagrees with the panel.
 */
export const useDesignHealthStore = create<DesignHealthState>()((set) => ({
  result: null,
  panelOpen: false,
  tab: 'problems',
  panelHeight: 232,
  activeFindingIndex: null,
  setResult: (result) => set({ result, activeFindingIndex: null }),
  setPanelOpen: (panelOpen) => set({ panelOpen }),
  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  setTab: (tab) => set({ tab }),
  setPanelHeight: (panelHeight) => set({ panelHeight }),
  setActiveFindingIndex: (activeFindingIndex) => set({ activeFindingIndex }),
}))
