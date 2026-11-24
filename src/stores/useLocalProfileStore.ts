/**
 * Standalone-mode identity — a local profile index, not a server session.
 *
 * The standalone build runs without a backend, so "signing in" here means
 * choosing which local profile to wear — one per name the studio has been
 * used under. Nothing leaves the device. When the Folio cloud is configured
 * the hosted auth gate is the door and this store is unused.
 */
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export interface LocalProfile {
  id: string
  name: string
  createdAt: number
}

interface LocalProfileState {
  profiles: LocalProfile[]
  activeProfileId: string | null
  setActiveProfile: (id: string) => void
  /** Sign the active profile out. The profiles stay on the device. */
  clearActiveProfile: () => void
  addProfile: (name: string) => LocalProfile
  removeProfile: (id: string) => void
  /**
   * Standalone mode boots straight into the workbench — no gate, no sign-in
   * screen, ever. The first run silently creates the device's default
   * identity; there is no sign-out state to return to.
   */
  ensureDefaultProfile: () => LocalProfile
}

function newId(): string {
  try {
    return crypto.randomUUID()
  } catch {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  }
}

export const useLocalProfileStore = create<LocalProfileState>()(
  devtools(
    persist(
      (set, get) => ({
        profiles: [],
        activeProfileId: null,

        setActiveProfile: (id) => {
          if (get().profiles.some((profile) => profile.id === id)) {
            set({ activeProfileId: id })
          }
        },

        clearActiveProfile: () => set({ activeProfileId: null }),

        addProfile: (name) => {
          const trimmed = name.trim()
          if (trimmed.length < 2) throw new Error('A name needs at least two characters.')
          const profile: LocalProfile = { id: newId(), name: trimmed, createdAt: Date.now() }
          set({ profiles: [...get().profiles, profile], activeProfileId: profile.id })
          return profile
        },

        removeProfile: (id) => {
          const { profiles, activeProfileId } = get()
          if (activeProfileId === id) return
          set({ profiles: profiles.filter((profile) => profile.id !== id) })
        },

        ensureDefaultProfile: () => {
          const { profiles, activeProfileId } = get()
          const active = profiles.find((profile) => profile.id === activeProfileId)
          if (active) return active
          // No explicit sign-out state survives: an inactive profile is
          // reactivated, so the standalone build never shows a sign-in gate.
          const fallback = [...profiles].sort((a, b) => b.createdAt - a.createdAt)[0]
          if (fallback) {
            set({ activeProfileId: fallback.id })
            return fallback
          }
          const profile: LocalProfile = {
            id: newId(),
            name: 'Workspace',
            createdAt: Date.now(),
          }
          set({ profiles: [profile], activeProfileId: profile.id })
          return profile
        },
      }),
      {
        name: 'folio-local-profile',
        version: 2,
        migrate: (persisted) => {
          const state = persisted as { profile?: { name?: string } | null; profiles?: LocalProfile[] }
          /* A single legacy profile (persist v1) becomes the first local
           * identity and the active one, so a returning user never sees the
           * "who are you" screen empty. */
          if (state?.profile && state.profile.name) {
            const legacy: LocalProfile = { id: newId(), name: state.profile.name, createdAt: Date.now() }
            return { profiles: [legacy], activeProfileId: legacy.id }
          }
          if (Array.isArray(state?.profiles)) return persisted as LocalProfileState
          return { profiles: [], activeProfileId: null }
        },
      },
    ),
    { name: 'FolioLocalProfile' },
  ),
)

export function getActiveProfile(state: LocalProfileState): LocalProfile | null {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) ?? null
}

export function selectActiveProfile(state: LocalProfileState): LocalProfile | null {
  return getActiveProfile(state)
}

export function useActiveProfile(): LocalProfile | null {
  return useLocalProfileStore(selectActiveProfile)
}
