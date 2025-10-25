import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

export interface AppSettings {
  theme: 'light' | 'dark' | 'professional'
  gridSize: number
  snapToGrid: boolean
  showGrid: boolean
  showRulers: boolean
  autoSave: boolean
  autoSaveInterval: number
  language: string
  units: 'metric' | 'imperial'
}

export interface ViewportState {
  zoom: number
  pan: { x: number; y: number }
  canvasSize: { width: number; height: number }
}

export interface AppState {
  // Settings
  settings: AppSettings
  updateSettings: (settings: Partial<AppSettings>) => void
  
  // Viewport
  viewport: ViewportState
  setZoom: (zoom: number) => void
  setPan: (pan: { x: number; y: number }) => void
  setCanvasSize: (size: { width: number; height: number }) => void
  
  // UI State
  sidebarOpen: boolean
  propertiesPanelOpen: boolean
  simulationPanelOpen: boolean
  aiChatOpen: boolean
  componentLibraryOpen: boolean
  
  toggleSidebar: () => void
  togglePropertiesPanel: () => void
  toggleSimulationPanel: () => void
  toggleAiChat: () => void
  toggleComponentLibrary: () => void
  
  // Tool State
  activeTool: 'select' | 'wire' | 'delete' | 'measure' | 'text'
  setActiveTool: (tool: 'select' | 'wire' | 'delete' | 'measure' | 'text') => void
  
  // Selection
  selectedComponents: string[]
  selectedWires: string[]
  setSelectedComponents: (ids: string[]) => void
  setSelectedWires: (ids: string[]) => void
  clearSelection: () => void
  
  // Clipboard
  clipboard: Record<string, unknown>[]
  copy: (items: Record<string, unknown>[]) => void
  paste: () => Record<string, unknown>[]
  
  // Undo/Redo
  history: Record<string, unknown>[]
  historyIndex: number
  pushHistory: (state: Record<string, unknown>) => void
  undo: () => void
  redo: () => void
  canUndo: () => boolean
  canRedo: () => boolean
}

const defaultSettings: AppSettings = {
  theme: 'professional',
  gridSize: 10,
  snapToGrid: true,
  showGrid: true,
  showRulers: true,
  autoSave: true,
  autoSaveInterval: 30000, // 30 seconds
  language: 'en',
  units: 'metric'
}

const defaultViewport: ViewportState = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  canvasSize: { width: 2000, height: 1500 }
}

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set, get) => ({
        // Settings
        settings: defaultSettings,
        updateSettings: (newSettings) =>
          set((state) => ({
            settings: { ...state.settings, ...newSettings }
          })),
        
        // Viewport
        viewport: defaultViewport,
        setZoom: (zoom) =>
          set((state) => ({
            viewport: { ...state.viewport, zoom: Math.max(0.1, Math.min(5, zoom)) }
          })),
        setPan: (pan) =>
          set((state) => ({
            viewport: { ...state.viewport, pan }
          })),
        setCanvasSize: (canvasSize) =>
          set((state) => ({
            viewport: { ...state.viewport, canvasSize }
          })),
        
        // UI State
        sidebarOpen: true,
        propertiesPanelOpen: false,
        simulationPanelOpen: false,
        aiChatOpen: false,
        componentLibraryOpen: true,
        
        toggleSidebar: () =>
          set((state) => ({ sidebarOpen: !state.sidebarOpen })),
        togglePropertiesPanel: () =>
          set((state) => ({ propertiesPanelOpen: !state.propertiesPanelOpen })),
        toggleSimulationPanel: () =>
          set((state) => ({ simulationPanelOpen: !state.simulationPanelOpen })),
        toggleAiChat: () =>
          set((state) => ({ aiChatOpen: !state.aiChatOpen })),
        toggleComponentLibrary: () =>
          set((state) => ({ componentLibraryOpen: !state.componentLibraryOpen })),
        
        // Tool State
        activeTool: 'select',
        setActiveTool: (tool) => set({ activeTool: tool }),
        
        // Selection
        selectedComponents: [],
        selectedWires: [],
        setSelectedComponents: (ids) => set({ selectedComponents: ids }),
        setSelectedWires: (ids) => set({ selectedWires: ids }),
        clearSelection: () => set({ selectedComponents: [], selectedWires: [] }),
        
        // Clipboard
        clipboard: [],
        copy: (items) => set({ clipboard: items }),
        paste: () => get().clipboard,
        
        // Undo/Redo
        history: [],
        historyIndex: -1,
        pushHistory: (state) =>
          set((current) => {
            const newHistory = current.history.slice(0, current.historyIndex + 1)
            newHistory.push(state)
            return {
              history: newHistory.slice(-50), // Keep last 50 states
              historyIndex: Math.min(newHistory.length - 1, 49)
            }
          }),
        undo: () =>
          set((state) => ({
            historyIndex: Math.max(0, state.historyIndex - 1)
          })),
        redo: () =>
          set((state) => ({
            historyIndex: Math.min(state.history.length - 1, state.historyIndex + 1)
          })),
        canUndo: () => get().historyIndex > 0,
        canRedo: () => get().historyIndex < get().history.length - 1,
      }),
      {
        name: 'circuit-cad-app-store',
        partialize: (state) => ({
          settings: state.settings,
          viewport: state.viewport,
          sidebarOpen: state.sidebarOpen,
          propertiesPanelOpen: state.propertiesPanelOpen,
          simulationPanelOpen: state.simulationPanelOpen,
          componentLibraryOpen: state.componentLibraryOpen,
        }),
      }
    )
  )
)