import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { User, UserPreferences } from '../types/domain'

interface AuthState {
  // Current user
  user: User | null
  isLoading: boolean
  isAuthenticated: boolean

  // Actions
  setUser: (user: User | null) => void
  setLoading: (loading: boolean) => void
  updateUser: (updates: Partial<User>) => void
  updatePreferences: (preferences: Partial<UserPreferences>) => void
  logout: () => void

  // Computed properties
  isAdmin: () => boolean
  isEditor: () => boolean
  canEdit: (resourceOwnerId?: string) => boolean
}


export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      // Initial state
      user: null,
      isLoading: true,
      isAuthenticated: false,

      // Actions
      setUser: (user) => set({
        user,
        isAuthenticated: !!user,
        isLoading: false
      }),

      setLoading: (loading) => set({ isLoading: loading }),

      updateUser: (updates) => set((state) => ({
        user: state.user ? { ...state.user, ...updates } : null
      })),

      updatePreferences: (preferences) => set((state) => ({
        user: state.user ? {
          ...state.user,
          preferences: { ...state.user.preferences, ...preferences }
        } : null
      })),

      logout: () => set({
        user: null,
        isAuthenticated: false,
        isLoading: false
      }),

      // Computed properties
      isAdmin: () => get().user?.role === 'admin',

      isEditor: () => ['admin', 'user'].includes(get().user?.role || ''),

      canEdit: (resourceOwnerId) => {
        const user = get().user
        if (!user) return false
        if (user.role === 'admin') return true
        if (resourceOwnerId && user.id === resourceOwnerId) return true
        return user.role === 'user'
      }
    }),
    {
      name: 'circuit-cad-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated
      })
    }
  )
)