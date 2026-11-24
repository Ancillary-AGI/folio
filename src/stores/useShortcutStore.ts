import { create } from 'zustand'
import {
  loadOverrides,
  saveOverrides,
  type KeyBinding,
  type ShortcutOverrides,
} from '../lib/keymap/shortcuts'

interface ShortcutState {
  overrides: ShortcutOverrides
  setBinding: (id: string, binding: KeyBinding) => void
  resetBinding: (id: string) => void
  resetAll: () => void
}

/**
 * User keymap overrides. The store is seeded from localStorage at creation and
 * writes through on every change, so a rebind survives a reload without a
 * separate save action.
 */
export const useShortcutStore = create<ShortcutState>()((set, get) => {
  const persist = (overrides: ShortcutOverrides) => {
    saveOverrides(overrides)
    set({ overrides })
  }
  return {
    overrides: loadOverrides(),
    setBinding: (id, binding) => persist({ ...get().overrides, [id]: binding }),
    resetBinding: (id) => {
      const next = { ...get().overrides }
      delete next[id]
      persist(next)
    },
    resetAll: () => persist({}),
  }
})
