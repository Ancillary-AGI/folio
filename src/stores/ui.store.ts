import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { Viewport, Selection, Tool, ApplicationSettings, ValidationError } from '../types/domain'

interface UIState {
  // Viewport state
  viewport: Viewport

  // Panel visibility
  panels: {
    sidebar: boolean
    properties: boolean
    simulation: boolean
    aiChat: boolean
    componentLibrary: boolean
    collaboration: boolean
    plugin: boolean
  }

  // Active tool and selection
  activeTool: Tool | null
  selection: Selection | null

  // Dialog and modal states
  dialogs: {
    export: boolean
    import: boolean
    settings: boolean
    about: boolean
    shortcuts: boolean
    projectManager: boolean
  }

  // Application settings
  settings: ApplicationSettings

  // UI feedback
  notifications: Notification[]
  loadingStates: Record<string, boolean>
  progressIndicators: Record<string, number>

  // Validation and errors
  validationErrors: ValidationError[]
  globalErrors: Error[]

  // Actions
  updateViewport: (viewport: Partial<Viewport>) => void
  togglePanel: (panel: keyof UIState['panels']) => void
  setActiveTool: (tool: Tool | null) => void
  setSelection: (selection: Selection | null) => void
  openDialog: (dialog: keyof UIState['dialogs']) => void
  closeDialog: (dialog: keyof UIState['dialogs']) => void
  updateSettings: (settings: Partial<ApplicationSettings>) => void

  // Notifications
  addNotification: (notification: Omit<Notification, 'id' | 'timestamp'>) => void
  removeNotification: (id: string) => void
  clearNotifications: () => void

  // Loading states
  setLoading: (key: string, loading: boolean) => void
  setProgress: (key: string, progress: number) => void

  // Validation
  setValidationErrors: (errors: ValidationError[]) => void
  addGlobalError: (error: Error) => void
  clearGlobalErrors: () => void

  // Utility
  reset: () => void
}

interface Notification {
  id: string
  type: 'info' | 'success' | 'warning' | 'error'
  title: string
  message: string
  timestamp: Date
  duration?: number
  action?: {
    label: string
    onClick: () => void
  }
}

const defaultViewport: Viewport = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  bounds: { x: 0, y: 0, width: 2000, height: 1500 },
  gridSize: 10,
  snapToGrid: true,
  showGrid: true,
  showRulers: true
}

const defaultSettings: ApplicationSettings = {
  theme: 'system',
  language: 'en',
  units: 'metric',
  gridSize: 10,
  snapToGrid: true,
  autoSave: true,
  autoSaveInterval: 30000,
  showTooltips: true,
  showAnimations: true,
  performance: {
    maxUndoSteps: 50,
    canvasResolution: 1,
    simulationPrecision: 1e-6,
    enableHardwareAcceleration: true
  }
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      // Initial state
      viewport: defaultViewport,
      panels: {
        sidebar: true,
        properties: false,
        simulation: false,
        aiChat: false,
        componentLibrary: true,
        collaboration: false,
        plugin: false
      },
      activeTool: null,
      selection: null,
      dialogs: {
        export: false,
        import: false,
        settings: false,
        about: false,
        shortcuts: false,
        projectManager: false
      },
      settings: defaultSettings,
      notifications: [],
      loadingStates: {},
      progressIndicators: {},
      validationErrors: [],
      globalErrors: [],

      // Viewport actions
      updateViewport: (viewport) =>
        set((state) => ({
          viewport: { ...state.viewport, ...viewport }
        })),

      // Panel actions
      togglePanel: (panel) =>
        set((state) => ({
          panels: {
            ...state.panels,
            [panel]: !state.panels[panel]
          }
        })),

      // Tool and selection actions
      setActiveTool: (tool) => set({ activeTool: tool }),
      setSelection: (selection) => set({ selection }),

      // Dialog actions
      openDialog: (dialog) =>
        set((state) => ({
          dialogs: {
            ...state.dialogs,
            [dialog]: true
          }
        })),

      closeDialog: (dialog) =>
        set((state) => ({
          dialogs: {
            ...state.dialogs,
            [dialog]: false
          }
        })),

      // Settings actions
      updateSettings: (settings) =>
        set((state) => ({
          settings: { ...state.settings, ...settings }
        })),

      // Notification actions
      addNotification: (notification) =>
        set((state) => ({
          notifications: [
            ...state.notifications,
            {
              ...notification,
              id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
              timestamp: new Date()
            }
          ]
        })),

      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id)
        })),

      clearNotifications: () => set({ notifications: [] }),

      // Loading and progress actions
      setLoading: (key, loading) =>
        set((state) => ({
          loadingStates: {
            ...state.loadingStates,
            [key]: loading
          }
        })),

      setProgress: (key, progress) =>
        set((state) => ({
          progressIndicators: {
            ...state.progressIndicators,
            [key]: Math.max(0, Math.min(100, progress))
          }
        })),

      // Validation actions
      setValidationErrors: (errors) => set({ validationErrors: errors }),

      addGlobalError: (error) =>
        set((state) => ({
          globalErrors: [...state.globalErrors, error]
        })),

      clearGlobalErrors: () => set({ globalErrors: [] }),

      // Reset action
      reset: () =>
        set({
          viewport: defaultViewport,
          panels: {
            sidebar: true,
            properties: false,
            simulation: false,
            aiChat: false,
            componentLibrary: true,
            collaboration: false,
            plugin: false
          },
          activeTool: null,
          selection: null,
          dialogs: {
            export: false,
            import: false,
            settings: false,
            about: false,
            shortcuts: false,
            projectManager: false
          },
          notifications: [],
          loadingStates: {},
          progressIndicators: {},
          validationErrors: [],
          globalErrors: []
        })
    }),
    {
      name: 'circuit-cad-ui',
      partialize: (state) => ({
        viewport: state.viewport,
        panels: state.panels,
        settings: state.settings
      })
    }
  )
)