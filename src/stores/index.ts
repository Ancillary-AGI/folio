// Centralized store exports for better organization

// Authentication store
export { useAuthStore } from './auth.store'
export type { User, UserPreferences } from '../types/domain'

// Project management store
export { useProjectStore } from './project.store'
export type {
  Project,
  Schematic,
  PlacedComponent,
  Wire,
  Net,
  Simulation,
  Component,
  ComponentLibrary,
  ValidationError
} from '../types/domain'

// UI state management store
export { useUIStore } from './ui.store'
export type {
  Viewport,
  Selection,
  Tool,
  ApplicationSettings
} from '../types/domain'

// Legacy stores (to be migrated)
export { useAppStore } from './useAppStore'
export { useProjectStore as useLegacyProjectStore } from './useProjectStore'


// Re-export domain types for convenience
export * from '../types/domain'