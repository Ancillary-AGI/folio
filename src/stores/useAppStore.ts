import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { ThemePreference } from '../lib/theme/tokens'
import type { LibraryItem } from '../lib/library/types'
import type { ShadingMode } from '../lib/3d/outline'
import type { TransientIntegration } from '../lib/simulation/stamping'
import { DEFAULT_SETTINGS, coerceSetting, normalizeSettings } from '../lib/settings/registry'

export type WorkspaceMode =
  | 'schematic'
  | 'simulation'
  | 'control'
  | 'machines'
  | 'grid'
  | 'mechanical'
  | 'structures'
  | 'biology'
  | 'pcb'
  | 'rf'
  | 'convert'
  | 'preview3d'
  | 'robotics'
  | 'embedded'
  | 'imaging'
  | 'visual'
  | 'fpga'
  | 'hil'
  | 'twin'
  | 'siem'
  | 'marketplace'
  | 'dashboard'
  | 'bom'
  | 'hdl'
  | 'icdesign'
  | 'agents'
  | 'components'
  | 'plugins'

export interface AppSettings {
  /** `system` follows the OS; every other value is an explicit user choice. */
  theme: ThemePreference
  /** When false the shell applies `.reduce-motion` and suppresses transitions. */
  animations: boolean
  /**
   * The ambient light field behind the shell. Off removes it entirely — the
   * chrome bars go solid again instead of blurring an empty background.
   */
  ambientLight: boolean

  // Drafting canvas
  gridSize: number
  snapToGrid: boolean
  showGrid: boolean
  showRulers: boolean
  /** Net-name labels drawn on the sheet; off leaves only copper and parts. */
  showNetLabels: boolean
  /**
   * Edit states the undo history keeps. The store used to clip at a hardcoded 50,
   * which a long routing session quietly outgrew — the first hour of edits becomes
   * unrecoverable and nothing says so.
   */
  historyDepth: number

  // 3D viewport
  /** Solid shading, or the crease wire with a ghost of the surface behind it. */
  shadingMode: ShadingMode
  viewerShadows: boolean
  viewerGrid: boolean
  /** Device-pixel multiple the 3D renderer is capped at. */
  viewerPixelRatio: number
  /** Body exaggeration of placed parts in the board preview, 1 being true size. */
  viewerPartScale: number

  // Code editor
  editorFontSize: number
  editorLineNumbers: boolean
  /** The ghost text and completion popup. Off means typing is yours alone. */
  editorSuggestions: boolean
  editorAutoCloseBrackets: boolean
  editorAutoIndent: boolean
  /** Spaces a Tab or an auto-indent inserts, in every code buffer. */
  editorTabSize: number
  /** Tint the row the caret sits on. */
  editorActiveLine: boolean

  // Board rules
  /** Copper width the autorouter draws and DRC measures, in millimetres. */
  boardTraceWidthMm: number
  /** Copper-to-copper spacing the router keeps and DRC demands. */
  boardClearanceMm: number
  /** Finished drill of a signal via; the pad is built around this. */
  boardViaDrillMm: number
  boardViaPadMm: number

  // Simulation
  /** Temperature a run starts at when the deck states none. */
  simTemperatureC: number
  /** Transient window a new run is opened with, in microseconds. */
  simTransientStopUs: number
  simTransientStepUs: number
  /** Integration rule a transient run defaults to. */
  simIntegrationMethod: TransientIntegration
  /** Frequency samples per decade for an AC or noise sweep. */
  simPointsPerDecade: number

  // 3D framing
  /** Vertical field of view of every 3D camera, in degrees. */
  cameraFovDeg: number

  // Export
  /** Pixel multiple of a PNG sheet export. */
  imageExportScale: number
  /** Gerber coordinate unit at the output boundary. */
  gerberUnits: 'mm' | 'in'
  /** Paper the engineering drawing is laid out on. */
  drawingPaperSize: 'A4' | 'A3' | 'Letter'

  // Saving
  autoSave: boolean
  autoSaveInterval: number
}

export interface ViewportState {
  zoom: number
  pan: { x: number; y: number }
}

export type SplitMode = 'single' | 'split-h' | 'split-v' | 'pip-3d'

export type NetSelection = { name: string } | { wireId: string }

export interface AppState {
  // Settings
  settings: AppSettings
  /**
   * Live-apply write. There is no draft and no Save button: the value a control
   * shows is the value the app uses, and it is clamped to its registry range on
   * the way in, so a stale or hand-edited stored number cannot reach a renderer.
   */
  updateSettings: (settings: Partial<AppSettings>) => void
  /** Back to the registry defaults — the listed keys, or every key when omitted. */
  resetSettings: (keys?: Array<keyof AppSettings>) => void
  
  // Viewport
  viewport: ViewportState
  setZoom: (zoom: number) => void
  setPan: (pan: { x: number; y: number }) => void
  /**
   * One-shot request: the sheet was opened fresh with no saved view, so the
   * first canvas that mounts (or content that arrives on an open canvas)
   * frames the design — every part centered with a margin, not top-left at
   * origin with the sheet clipped. Cleared by the consumer.
   */
  pendingFit: boolean
  requestFit: () => void
  consumeFitRequest: () => void
  
  workspaceMode: WorkspaceMode
  setWorkspaceMode: (mode: WorkspaceMode) => void

  /** One-shot request a workspace panel consumes on mount (demo bootstrap). */
  demoRequest: string | null
  requestDemo: (request: string | null) => void
  clearDemoRequest: () => void

  /**
   * The library row armed by a click in the dock. A panel whose drop zone takes
   * that kind places it; leaving the workspace disarms it.
   */
  armedLibraryItem: LibraryItem | null
  setArmedLibraryItem: (item: LibraryItem | null) => void

  // UI State
  sidebarOpen: boolean
  simulationPanelOpen: boolean
  aiChatOpen: boolean
  
  toggleSidebar: () => void
  toggleSimulationPanel: () => void
  toggleAiChat: () => void
  
  // Futuristic Split View & Multi-Domain Viewport Engine
  splitMode: SplitMode
  secondaryWorkspace: WorkspaceMode
  splitRatio: number
  setSplitMode: (mode: SplitMode, secondary?: WorkspaceMode) => void
  setSplitRatio: (ratio: number) => void

  // Active PCB copper layer (floating HUD quick switch)
  activePcbLayer: string
  setActivePcbLayer: (layer: string) => void

  // Tool State. These four are the sheet tools the rail actually offers; the
  // board has its own tool set in the PCB panel and does not live here.
  // One-shot handoff: the launcher's composer writes a brief here when the
  // user starts a project by describing it; the assistant consumes it once on
  // mount and clears it. Not persisted — it is a moment, not a setting.
  pendingAssistantPrompt: string | null
  setPendingAssistantPrompt: (prompt: string | null) => void
  
  activeTool: 'select' | 'wire' | 'delete' | 'sketch'
  setActiveTool: (tool: 'select' | 'wire' | 'delete' | 'sketch') => void
  
  // Selection: the ids of the components the sheet currently holds. The board's
  // cross-probe, the inspector and the status-bar count all read this one list.
  selectedComponents: string[]
  setSelectedComponents: (ids: string[]) => void
  /**
   * The net under the cursor. A named net spans every wire segment and pin with
   * that name; an unnamed wire falls back to its own id. Parts and nets share
   * one cursor — choosing either replaces the other.
   */
  selectedNet: NetSelection | null
  selectNet: (target: NetSelection) => void
  clearSelection: () => void

  /**
   * One-shot "bring this part under the viewport". The sheet owns the geometry,
   * so it consumes the request once it has a measured stage. Sending it through
   * the store rather than a window event keeps a palette row working even when
   * the same click is what mounts the sheet.
   */
  focusRequest: { id: string; nonce: number } | null
  requestComponentFocus: (id: string) => void
  consumeComponentFocus: (nonce: number) => void

  /** The same one-shot framing, for a net's wire run instead of a part. */
  netFocusRequest: { name: string; nonce: number } | null
  requestNetFocus: (name: string) => void
  consumeNetFocus: (nonce: number) => void
}

const defaultViewport: ViewportState = {
  zoom: 1,
  pan: { x: 0, y: 0 }
}

/* Each request gets a new token so asking twice for the same part still moves
 * the viewport, and a consumer cannot clear a newer request by accident. */
let focusNonce = 0

export const useAppStore = create<AppState>()(
  devtools(
    persist(
      (set) => ({
        // Settings
        settings: DEFAULT_SETTINGS,
        updateSettings: (newSettings) =>
          set((state) => {
            const patch: Record<string, unknown> = {}
            for (const key of Object.keys(newSettings) as Array<keyof AppSettings>) {
              patch[key] = coerceSetting(key, newSettings[key])
            }
            return { settings: { ...state.settings, ...patch } as AppSettings }
          }),
        resetSettings: (keys) =>
          set((state) => {
            if (!keys) return { settings: { ...DEFAULT_SETTINGS } }
            const patch: Record<string, unknown> = {}
            for (const key of keys) patch[key] = DEFAULT_SETTINGS[key]
            return { settings: { ...state.settings, ...patch } as AppSettings }
          }),
        
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
        // Starts false so a persisted store never replays a stale fit.
        pendingFit: false,
        requestFit: () => set({ pendingFit: true }),
        consumeFitRequest: () => set({ pendingFit: false }),
        
        workspaceMode: 'schematic',
        // A manual mode switch drops any unconsumed demo bootstrap and any armed
        // library row, so neither can fire in an unrelated workspace later.
        setWorkspaceMode: (workspaceMode) => set({ workspaceMode, demoRequest: null, armedLibraryItem: null }),

        demoRequest: null,
        requestDemo: (demoRequest) => set({ demoRequest }),
        clearDemoRequest: () => set({ demoRequest: null }),

        armedLibraryItem: null,
        setArmedLibraryItem: (armedLibraryItem) => set({ armedLibraryItem }),

        // UI State
        sidebarOpen: true,
        simulationPanelOpen: false,
        aiChatOpen: false,
        
        toggleSidebar: () =>
          set((state) => ({ sidebarOpen: !state.sidebarOpen })),
        toggleSimulationPanel: () =>
          set((state) => ({ simulationPanelOpen: !state.simulationPanelOpen })),
        toggleAiChat: () =>
          set((state) => ({ aiChatOpen: !state.aiChatOpen })),

        // Futuristic Split View & Multi-Domain Viewport Engine
        splitMode: 'single',
        secondaryWorkspace: 'preview3d',
        splitRatio: 0.5,
        setSplitMode: (splitMode, secondary) =>
          set((state) => ({
            splitMode,
            secondaryWorkspace: secondary ?? state.secondaryWorkspace,
          })),
        setSplitRatio: (splitRatio) => set({ splitRatio: Math.max(0.2, Math.min(0.8, splitRatio)) }),

        // Active PCB copper layer (floating HUD quick switch)
        // Active PCB copper layer — the same id space as the board panel's
        // DEFAULT_LAYERS; the floating HUD's quick switch mirrors it.
        activePcbLayer: 'top-cu',
        setActivePcbLayer: (activePcbLayer) => set({ activePcbLayer }),

        // One-shot handoff from the launcher composer to the assistant
        pendingAssistantPrompt: null,
        setPendingAssistantPrompt: (pendingAssistantPrompt) => set({ pendingAssistantPrompt }),

        // Tool State
        activeTool: 'select',
        setActiveTool: (tool) => set({ activeTool: tool }),
        
        // Selection: one cursor at a time, so choosing parts drops the net and
        // choosing a net drops the parts.
        selectedComponents: [],
        setSelectedComponents: (ids) => set({ selectedComponents: ids, selectedNet: null }),
        selectedNet: null,
        selectNet: (target) => set({ selectedNet: target, selectedComponents: [] }),
        clearSelection: () => set({ selectedComponents: [], selectedNet: null }),

        // Focus request (never persisted)
        focusRequest: null,
        requestComponentFocus: (id) => set({ focusRequest: { id, nonce: ++focusNonce } }),
        consumeComponentFocus: (nonce) =>
          set((state) =>
            state.focusRequest?.nonce === nonce ? { focusRequest: null } : {},
          ),
        netFocusRequest: null,
        requestNetFocus: (name) => set({ netFocusRequest: { name, nonce: ++focusNonce } }),
        consumeNetFocus: (nonce) =>
          set((state) =>
            state.netFocusRequest?.nonce === nonce ? { netFocusRequest: null } : {},
          ),
      }),
      {
        name: 'circuit-cad-app-store',
        partialize: (state) => ({
          settings: state.settings,
          viewport: state.viewport,
          sidebarOpen: state.sidebarOpen,
          simulationPanelOpen: state.simulationPanelOpen,
        }),
        /**
         * A stored blob may come from a release whose `settings` partialize
         * was thinner than today's (a browser profile that predates the full
         * registry, or a partial write from a pre-paint theme script).
         * Same-version payloads skip `migrate` entirely, so without this, a
         * stale blob can carry `{ theme }` alone and every consumer reading
         * `state.settings[key]` gets undefined — e.g. a 3D-viewer slider whose
         * `.toFixed` then throws and the workspace never paints. Merge over
         * the defaults instead: unknown keys are dropped, known ones clamped.
         */
        merge: (persisted, current) => {
          const stored = (persisted ?? {}) as Partial<AppState> & { viewport?: Partial<ViewportState> }
          const merged = { ...current, ...stored }
          merged.settings = normalizeSettings(stored.settings ?? current.settings)
          merged.viewport = {
            zoom: stored.viewport?.zoom ?? 1,
            pan: stored.viewport?.pan ?? { x: 0, y: 0 },
          }
          merged.sidebarOpen = stored.sidebarOpen ?? true
          merged.simulationPanelOpen = stored.simulationPanelOpen ?? false
          return merged
        },
        /**
         * Rebuild the persisted shape from the keys `partialize` writes, so a
         * payload from an earlier release cannot smuggle back a piece of state the
         * store no longer has (the old properties-panel and library-dock toggles,
         * a cached canvas size) or leave `viewport.canvasSize` stranded.
         */
        migrate: (persisted) => {
          const state = persisted as (Partial<AppState> & { viewport?: Partial<ViewportState> }) | undefined
          if (!state) return undefined as unknown as AppState
          return {
            settings: state.settings ? normalizeSettings(state.settings) : DEFAULT_SETTINGS,
            viewport: {
              zoom: state.viewport?.zoom ?? 1,
              pan: state.viewport?.pan ?? { x: 0, y: 0 },
            },
            sidebarOpen: state.sidebarOpen ?? true,
            simulationPanelOpen: state.simulationPanelOpen ?? false,
          } as AppState
        },
        version: 4,
      }
    )
  )
)
