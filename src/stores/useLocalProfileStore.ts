/**
 * Standalone-mode account.
 *
 * The standalone build runs without a backend — no sign-up can ever reach a
 * server. That is a feature, but a front door is still owed: the workbench is
 * not for anonymous passers-by either. Before a design can be created, the
 * designer creates a local profile: a name, an optional email, all of it on
 * this device only. When the Folio cloud is configured instead, the hosted
 * auth gate is the door and this store stays unused.
 */
import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export interface LocalProfile {
  name: string
  email: string
}

interface LocalProfileState {
  profile: LocalProfile | null
  setProfile: (profile: LocalProfile) => void
  clearProfile: () => void
}

export const useLocalProfileStore = create<LocalProfileState>()(
  devtools(
    persist(
      (set) => ({
        profile: null,
        setProfile: (profile) => set({ profile }),
        clearProfile: () => set({ profile: null }),
      }),
      { name: 'folio-local-profile' },
    ),
    { name: 'FolioLocalProfile' },
  ),
)
