import { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Cpu, FolderOpen, Menu, Bot, BarChart3, Settings, Package, Users,
  Download, Image, FileText, List, Lock, LogOut, Mic, MicOff,
  Shield, Bell, RefreshCw, History, RotateCcw, Moon, Sun, AlertCircle, FlaskConical, Search,
  MoreHorizontal, ShieldCheck, ShieldAlert, X,
} from 'lucide-react'
import { Button } from './components/ui/button'
import type { PlacedComponent, Wire, User } from './types'
import { supabase, isSupabaseConfigured, type Project, type Schematic, type Component } from './lib/supabase'
import { offlineProjectStore } from './lib/offlineProjectStore'
import { standardComponents } from './lib/componentLibrary'
import { buildDemoBoard } from './lib/demo/demoBoard'
import { isBoardDemoLoad, loadDemoScenario } from './lib/demo/loadDemo'
import type { DemoScenario } from './lib/demo/demoScenarios'
import { exportToImage, exportToNetlist, exportToJSON, exportToBOM, exportToGerber, downloadFile } from './lib/exportUtils'
import { buildSchematicDrawing } from './lib/schematic/engineeringDrawing'
import { pluginManager } from './lib/plugins/pluginManager'
import { type CollabUser } from './lib/collaboration/collaborativeEditor'
import { useCollaborationPresence } from './lib/collaboration/useCollaborationPresence'
import { nlpService } from './lib/nlp/nlpService'
import { siemService } from './lib/siem/siemService'
import { assetSecurity } from './lib/security/assetSecurity'
import { backupService, type ProjectBackup } from './lib/backup/backupService'
import { useAppStore } from './stores/useAppStore'
import {
  ADMIN_ROUTE,
  currentRoute,
  isAdminPath,
  isWorkspaceMode,
  navigateTo,
  PROJECTS_ROUTE,
  subscribeToRoute,
  writeWorkspaceRoute,
} from './stores/routing'
import { useProjectStore } from './stores/useProjectStore'
import type { CanvasComponent, CanvasWire } from './stores/useProjectStore'
import { vcsService, type VcsCommit } from './lib/vcs/vcsService'
import { createDefaultMechanicalParts, type MechanicalPart } from './lib/mechanical/partModel'
import OnboardingTour, { type TourExitReason } from './components/OnboardingTour'
import { ONBOARDING_STEP_COUNT } from './lib/onboarding/onboardingSteps'
import {
  hasCompletedOnboarding,
  markOnboardingComplete,
  readOnboardingStep,
  resetOnboarding,
} from './lib/onboarding/onboardingStorage'
import DomainWorkspace from './components/workspace/DomainWorkspace'
import ProjectManager from './components/ProjectManager'
import AuthForm from './components/AuthForm'
import VoiceCommandBar from './components/nlp/VoiceCommandBar'
import { LoadingSpinner } from './components/ui/LoadingSpinner'
import UserPresence from './components/collaboration/UserPresence'
import { useTheme } from './lib/theme/useTheme'
import { describeTheme } from './lib/theme/tokens'
import { WORKSPACE_MODE_META } from './lib/workspace/modes'
import { resolveLocalRole } from './lib/admin/adminService'
import { checkQuotaCapacity } from './lib/admin/quotaPolicy'
import { countUsage } from './lib/admin/usageLedger'
import { recordPlatformUsage } from './lib/admin/usageRecorder'

// On-demand panels keep their heavyweight deps (recharts, plugin runtimes)
// out of the first paint until the user actually opens them.
const SimulationPanel = lazy(() => import('./components/simulation/SimulationPanel'))
const AIChatPanel = lazy(() => import('./components/ai/AIChatPanel'))
const PluginPanel = lazy(() => import('./components/plugins/PluginPanel'))
const CollaborativePanel = lazy(() => import('./components/collaboration/CollaborativePanel'))
const SettingsPanel = lazy(() => import('./components/SettingsPanel'))
const DemoGallery = lazy(() => import('./components/workspace/DemoGallery'))
const CommandPalette = lazy(() => import('./components/workspace/CommandPalette'))
const AdminConsole = lazy(() => import('./components/admin/AdminConsole'))
const LimitsDialog = lazy(() => import('./components/workspace/LimitsDialog'))

const panelFallback = (
  <div className="flex h-full items-center justify-center p-4">
    <LoadingSpinner size="sm" />
  </div>
)

/** Shortcut chips must match the platform's modifier keys. */
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)
const DEMO_SHORTCUT_LABEL = IS_MAC ? '⇧⌘D' : 'Ctrl+Shift+D'
const PALETTE_SHORTCUT_LABEL = IS_MAC ? '⌘K' : 'Ctrl+K'

type PcbLayout = ReturnType<typeof useProjectStore.getState>['pcbLayout']

/** Saved canvases and commits may predate layout persistence; reject junk. */
function asPcbLayout(value: unknown): PcbLayout {
  if (!value || typeof value !== 'object') return null
  const layout = value as Record<string, unknown>
  return Number.isFinite(layout.widthMm) && Number.isFinite(layout.heightMm)
    && Array.isArray(layout.layers) && Array.isArray(layout.traces)
    && Array.isArray(layout.vias) && Array.isArray(layout.components)
    ? (value as PcbLayout)
    : null
}

/** Saved mechanical assemblies and domain bags may be absent in older files. */
function asMechanicalParts(value: unknown): MechanicalPart[] {
  return Array.isArray(value) ? value as MechanicalPart[] : createDefaultMechanicalParts()
}

function asDomainDesigns(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function startOfToday(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** In-app, dismissible message. Native alerts block automation and the canvas. */
function NoticeBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  if (!message) return null
  return (
    <div
      role="alert"
      className="flex items-start gap-3 border-b border-warning/40 bg-warning/10 px-6 py-2 text-xs text-foreground"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" aria-hidden="true" />
      <p className="flex-1 leading-relaxed">{message}</p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss message"
        className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/** Deterministic presence colour so a user looks the same in every session. */
function generateUserColor(userId: string): string {
  const palette = ['#3B82F6','#EF4444','#10B981','#F59E0B','#8B5CF6','#EC4899','#06B6D4','#84CC16','#F97316','#6366F1']
  let hash = 0
  for (const c of userId) hash = c.charCodeAt(0) + ((hash << 5) - hash)
  return palette[Math.abs(hash) % palette.length]
}

function App() {
  // Without cloud credentials the app boots straight into local mode — there is
  // no account to sign in to, so users never hit a login or "continue offline" gate.
  const [user, setUser] = useState<User | null>(() =>
    isSupabaseConfigured
      ? null
      : { id: 'offline-local', name: 'Local User', email: 'local@offline', role: 'owner' },
  )
  const offlineMode = !isSupabaseConfigured
  const [showSettings, setShowSettings] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(() => readOnboardingStep(ONBOARDING_STEP_COUNT))
  /*
   * Which steps the guide actually opened. The count lives here, beside the step
   * state, so the ledger can say how much was read instead of assuming the whole
   * curriculum was — a card closed on step two is not a finished tour.
   */
  const tourStepsOpened = useRef<Set<number>>(new Set())
  const tourIsOpen = useRef(false)
  const [loading, setLoading] = useState(true)
  const [libraryComponents, setLibraryComponents] = useState<Component[]>([])
  const [canvasData, setCanvasData] = useState<Record<string, unknown> | null>(null)
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showVcsMenu, setShowVcsMenu] = useState(false)
  const [vcsMessage, setVcsMessage] = useState('')
  const [vcsLog, setVcsLog] = useState<VcsCommit[]>([])
  const [vcsStatus, setVcsStatus] = useState('')
  const [backupList, setBackupList] = useState<ProjectBackup[]>([])
  const [showProjectManager, setShowProjectManager] = useState(false)
  const [showAdmin, setShowAdmin] = useState(false)
  const [notice, setNotice] = useState('')
  const [showPluginPanel, setShowPluginPanel] = useState(false)
  const [showDemoGallery, setShowDemoGallery] = useState(false)
  const [showLimits, setShowLimits] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showCollaborativePanel, setShowCollaborativePanel] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [collaborativeUsers, setCollaborativeUsers] = useState<CollabUser[]>([])
  const [isVoiceActive, setIsVoiceActive] = useState(false)
  const [showVoiceBar, setShowVoiceBar] = useState(false)
  const [voiceError, setVoiceError] = useState('')
  const [exportStatus, setExportStatus] = useState('')
  const [activeAlertCount, setActiveAlertCount] = useState(0)
  const [activeAlertSummary, setActiveAlertSummary] = useState('')
  const canvasRef = useRef<HTMLCanvasElement>(null)

  // The right-hand drawer is one slot: opening a tool replaces whatever is there.
  const openPluginPanel = () => {
    useAppStore.setState({ simulationPanelOpen: false, aiChatOpen: false })
    setShowCollaborativePanel(false)
    setShowPluginPanel(true)
  }

  /* The project list is a route, not a modal flag: back/forward and reload both
   * land on the same screen. The open project stays loaded for a quick return. */
  const openProjectManager = () => {
    setShowProjectManager(true)
    setShowAdmin(false)
    navigateTo(PROJECTS_ROUTE)
  }

  /* Administration is a sibling route, not a modal: it survives reloads and
   * Back returns to whichever screen opened it. */
  const openAdmin = () => {
    setShowAdmin(true)
    setShowExportMenu(false)
    setShowVcsMenu(false)
    setShowMoreMenu(false)
    navigateTo(ADMIN_ROUTE)
  }

  const closeAdmin = () => {
    setShowAdmin(false)
    const project = useProjectStore.getState().currentProject
    if (showProjectManager || !project) {
      navigateTo(PROJECTS_ROUTE)
      setShowProjectManager(true)
      return
    }
    writeWorkspaceRoute(useAppStore.getState().workspaceMode, project.id)
  }

  const simulationQuotaError = (): string | null => {
    if (!user) return 'Sign in to run a simulation.'
    const decision = checkQuotaCapacity('simulation', resolveLocalRole(user, offlineMode), {
      projects: 0,
      exportsToday: 0,
      simulationsToday: countUsage('simulation.run', startOfToday(), user.id),
      storageMb: 0,
    })
    return decision.allowed ? null : decision.reason ?? 'Your simulation quota is exhausted.'
  }

  const recordSimulationRun = () => {
    recordPlatformUsage('simulation.run', user, offlineMode, { source: 'solver' })
  }

  const {
    workspaceMode,
    settings,
    activeTool,
    selectedComponents,
    simulationPanelOpen,
    aiChatOpen,
    sidebarOpen,
    toggleSidebar,
    toggleSimulationPanel,
    toggleAiChat,
  } = useAppStore()

  const {
    currentProject,
    currentSchematic,
    setCurrentProject,
    setCurrentSchematic,
    isDirty,
    markClean,
    components,
    wires,
    componentLibrary,
  } = useProjectStore()

  // Parts imported this session live in the project store; the cloud/offline
  // catalogue is separate App state. The palette shows both, without doubling up
  // on an id when a session import re-uses a catalogue entry.
  const paletteComponents = useMemo(
    () => [
      ...libraryComponents,
      ...componentLibrary.filter(extra => !libraryComponents.some(existing => existing.id === extra.id)),
    ],
    [libraryComponents, componentLibrary],
  )

  const buildDesignSnapshot = () => {
    const live = useProjectStore.getState()
    return {
      components: live.components,
      wires: live.wires,
      code: live.firmwareCode || null,
      pcbLayout: live.pcbLayout,
      mechanicalParts: live.mechanicalParts,
      domains: live.domainDesigns,
      netlist: null,
      simConfig: null,
      meta: { viewport: useAppStore.getState().viewport },
    }
  }

  /*
   * Theming is entirely owned by `useTheme`, which writes validated tokens from
   * `lib/theme/tokens.ts` onto <html>. App must never touch `documentElement`
   * colours directly — doing so is what produced the mixed light/dark UI.
   */
  const { preference: themePreference, theme: resolvedTheme, isDark: isDarkTheme, toggle: toggleTheme } = useTheme()

  /* The browser tab doubles as a workspace readout: project, mode, unsaved. */
  useEffect(() => {
    if (showAdmin) {
      document.title = 'Administration · Folio'
      return
    }
    const mode = WORKSPACE_MODE_META[workspaceMode].label
    document.title = currentProject
      ? `${isDirty ? '● ' : ''}${currentProject.name} — ${mode} · Folio`
      : `${mode} · Folio`
  }, [currentProject, isDirty, showAdmin, workspaceMode])

  /* Opening a workspace is the workbench's most meaningful usage signal. */
  useEffect(() => {
    if (!user || showAdmin) return
    recordPlatformUsage('workspace.open', user, offlineMode, { mode: workspaceMode })
  }, [user, offlineMode, showAdmin, workspaceMode])

  // ── Auth ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false)
      return
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user as unknown as User ?? null)
      setLoading(false)
    }).catch((error) => {
      console.error('Error restoring session:', error)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user as unknown as User ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  const openTour = useCallback((step: number) => {
    tourStepsOpened.current = new Set([step])
    tourIsOpen.current = true
    setOnboardingStep(step)
    setShowOnboarding(true)
  }, [])

  const showTourStep = useCallback((step: number) => {
    tourStepsOpened.current.add(step)
    setOnboardingStep(step)
  }, [])

  useEffect(() => {
    if (user && !hasCompletedOnboarding()) openTour(readOnboardingStep(ONBOARDING_STEP_COUNT))
  }, [openTour, user])

  useEffect(() => {
    if (!user) return
    if (offlineMode) {
      // Offline library entries need stable ids so drag/click-to-place can address them.
      setLibraryComponents(
        standardComponents.map((component, index) => ({
          ...component,
          id: `std-${index}-${component.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        })),
      )
      return
    }

    const load = async () => {
      try {
        const { data: existing } = await supabase.from('components').select('id').eq('is_standard', true).limit(1)
        if (!existing || existing.length === 0) {
          await supabase.from('components').insert(standardComponents.map(c => ({ ...c, user_id: null })))
        }
        const { data, error } = await supabase.from('components').select('*').order('category', { ascending: true })
        if (error) throw error
        setLibraryComponents(data || [])
      } catch (err) {
        console.error('Error loading components:', err)
      }
    }
    void load()
  }, [user, offlineMode])

  useEffect(() => {
    setVcsLog(currentProject ? vcsService.log(currentProject.id) : [])
    setBackupList(currentProject ? backupService.listBackups(currentProject.id) : [])
    setVcsStatus('')
    setVcsMessage('')
  }, [currentProject])

  // ── Plugin system ────────────────────────────────────────────────────────────
  useEffect(() => {
    const handlePluginLoaded = (...args: unknown[]) => console.info('Plugin loaded:', args[0])
    const handlePluginError = (...args: unknown[]) => console.error('Plugin error:', args[0])
    pluginManager.on('plugin:loaded', handlePluginLoaded)
    pluginManager.on('plugin:error', handlePluginError)
    return () => {
      pluginManager.off('plugin:loaded', handlePluginLoaded)
      pluginManager.off('plugin:error', handlePluginError)
    }
  }, [])

  // ── Collaboration ────────────────────────────────────────────────────────────
  const collabUser: CollabUser | null = useMemo(() => {
    if (!user) return null
    const metadata = (user as User & { user_metadata?: { full_name?: string; avatar_url?: string } }).user_metadata
    return {
      id: user.id,
      name: metadata?.full_name || user.email || 'Anonymous',
      email: user.email || '',
      avatar: metadata?.avatar_url,
      color: generateUserColor(user.id),
      isActive: true,
      lastSeen: Date.now(),
    }
  }, [user])

  useCollaborationPresence(collabUser, currentProject?.id ?? null, !offlineMode, setCollaborativeUsers)

  // ── SIEM monitoring ─────────────────────────────────────────────────────────
  useEffect(() => {
    siemService.startMonitoring()
    const refreshAlerts = () => {
      const alerts = siemService.getAlerts({ status: 'active' })
      setActiveAlertCount(alerts.length)
      setActiveAlertSummary(alerts[0]?.description ?? alerts[0]?.title ?? '')
    }
    refreshAlerts()
    const interval = setInterval(refreshAlerts, 15000)
    return () => clearInterval(interval)
  }, [])

  // ── NLP intent → store dispatch ─────────────────────────────────────────────
  useEffect(() => {
    nlpService.registerIntent({
      name: 'switch_workspace',
      patterns: ['switch to {mode}', 'open {mode}', 'go to {mode}'],
      examples: ['switch to pcb', 'open siem', 'go to robotics'],
      handler: async (entities) => {
        const mode = String(entities.mode || '').toLowerCase()
        if (isWorkspaceMode(mode)) useAppStore.getState().setWorkspaceMode(mode)
        return { action: 'switch_workspace', mode }
      },
    })
  }, [])

  // ── Keyboard entry points: command palette (Ctrl/⌘+K) and demo gallery ─────
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && !event.shiftKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setShowCommandPalette((open) => !open)
        return
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault()
        setShowDemoGallery((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const handleNewProject = async () => {
    if (!user) return
    setNotice('')
    let projectCount = offlineProjectStore.list().filter((entry) => entry.user_id === user.id).length
    if (!offlineMode) {
      const { count } = await supabase.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', user.id)
      projectCount = count ?? 0
    }
    const quota = checkQuotaCapacity('project', resolveLocalRole(user, offlineMode), {
      projects: projectCount, exportsToday: 0, simulationsToday: 0, storageMb: 0,
    })
    if (!quota.allowed) {
      setNotice(quota.reason ?? 'Your project quota is exhausted.')
      return
    }
    if (offlineMode) {
      const project = offlineProjectStore.create(user.id, `New Project ${new Date().toLocaleDateString()}`)
      useProjectStore.setState({
        components: [], wires: [], firmwareCode: '', simulationRuns: [], pcbLayout: null,
        simulationResults: [], isSimulating: false, liveFrame: null, isDirty: false,
      })
      setCurrentSchematic(null)
      setCanvasData(project.canvas_data ?? null)
      useAppStore.getState().setZoom(1)
      useAppStore.getState().setPan({ x: 0, y: 0 })
      setCurrentProject(project)
      setShowProjectManager(false)
      recordPlatformUsage('project.create', user, offlineMode, { name: project.name, storage: 'local' })
      siemService.logAuditEvent({ user: user.id, action: 'project:create', resource: project.id, details: { name: project.name } })
      return
    }
    try {
      const { data, error } = await supabase.from('projects').insert({
        user_id: user.id,
        name: `New Project ${new Date().toLocaleDateString()}`,
        description: 'Engineering design project',
      }).select().single()
      if (error) throw error
      await supabase.from('schematics').insert({ project_id: data.id, name: 'Main Schematic', order_index: 0 })
      useProjectStore.setState({
        components: [], wires: [], firmwareCode: '', simulationRuns: [], pcbLayout: null,
        simulationResults: [], isSimulating: false, liveFrame: null, isDirty: false,
      })
      setCurrentSchematic(null)
      setCanvasData(null)
      useAppStore.getState().setZoom(1)
      useAppStore.getState().setPan({ x: 0, y: 0 })
      setCurrentProject(data)
      setShowProjectManager(false)
      recordPlatformUsage('project.create', user, offlineMode, { name: data.name, storage: 'cloud' })
      siemService.logAuditEvent({ user: user.id, action: 'project:create', resource: data.id, details: { name: data.name } })
    } catch (err) {
      console.error('Error creating project:', err)
    }
  }

  const closeOnboarding = (reason: TourExitReason) => {
    // One close of a running guide records. The register hand-off can reach here
    // twice in a single click — from the tour's own button and from the shell —
    // and a duplicated ledger row would double-count the same tour.
    if (!tourIsOpen.current) return
    tourIsOpen.current = false
    const steps = tourStepsOpened.current.size
    markOnboardingComplete()
    setShowOnboarding(false)
    setOnboardingStep(0)
    recordPlatformUsage(
      reason === 'finished' ? 'onboarding.complete' : 'onboarding.exit',
      user,
      offlineMode,
      {
        steps,
        total: ONBOARDING_STEP_COUNT,
        ...(reason === 'finished' ? {} : { reason }),
      },
    )
  }

  const restartOnboarding = () => {
    resetOnboarding()
    openTour(0)
  }

  /*
   * The register is the thing being read, so it must never sit underneath a
   * coach mark: opening it from the status bar or the palette ends a running
   * tour exactly as the tour's own final step does.
   */
  const openLimitsRegister = () => {
    setShowLimits(true)
    if (showOnboarding) closeOnboarding('dismissed')
  }

  const confirmReplace = (label: string): boolean => {
    if (useProjectStore.getState().components.length === 0) return true
    return window.confirm(`Replace the current schematic with the ${label}?`)
  }

  const ensureProject = async (): Promise<boolean> => {
    if (!useProjectStore.getState().currentProject) await handleNewProject()
    return Boolean(useProjectStore.getState().currentProject)
  }

  // Gallery / palette entry point: a demo must be savable, and a board demo
  // must never silently overwrite an unsaved schematic.
  const openDemoScenario = async (scenario: DemoScenario) => {
    if (isBoardDemoLoad(scenario.load) && !confirmReplace(scenario.title)) return
    if (!(await ensureProject())) return
    loadDemoScenario(scenario)
    recordPlatformUsage('demo.load', user, offlineMode, { scenario: scenario.title })
  }

  const handleLoadSampleCircuit = async () => {
    if (!confirmReplace('5 V divider example')) return
    if (!(await ensureProject())) return

    const resistorDefinition = standardComponents.find(component => component.name === 'Resistor')
    const sourceDefinition = standardComponents.find(component => component.name === 'DC Voltage Source')
    if (!resistorDefinition || !sourceDefinition) throw new Error('The standard library is missing a sample-circuit component')

    const makeComponent = (
      libraryId: string,
      reference: string,
      definition: typeof resistorDefinition | typeof sourceDefinition,
      x: number,
      y: number,
      properties: Record<string, string | number | boolean>,
    ): CanvasComponent => ({
      id: `sample-${reference.toLowerCase()}`,
      componentId: libraryId,
      component: { ...definition, id: libraryId } as Component,
      x,
      y,
      rotation: 0,
      reference,
      properties,
    })

    const source = makeComponent('standard-dc-source', 'V1', sourceDefinition, 170, 100, { type: 'DC', voltage: '5V' })
    const upperResistor = makeComponent('standard-resistor', 'R1', resistorDefinition, 360, 85, { value: '1k' })
    const lowerResistor = makeComponent('standard-resistor', 'R2', resistorDefinition, 550, 85, { value: '1k' })
    // Pin map (rotation 0): V1+ (200,100) V1- (200,160) | R1 p1 (360,100)
    // p2 (440,100) | R2 p1 (550,100) p2 (630,100).
    const sampleWires: CanvasWire[] = [
      { id: 'sample-vin', points: [{ x: 200, y: 100 }, { x: 360, y: 100 }], netName: 'VIN', connectedPins: [
        { componentId: source.id, pinId: 'positive' },
        { componentId: upperResistor.id, pinId: 'p1' },
      ] },
      { id: 'sample-output', points: [{ x: 440, y: 100 }, { x: 550, y: 100 }], netName: 'OUT', connectedPins: [
        { componentId: upperResistor.id, pinId: 'p2' },
        { componentId: lowerResistor.id, pinId: 'p1' },
      ] },
      { id: 'sample-ground', points: [{ x: 200, y: 160 }, { x: 200, y: 220 }, { x: 630, y: 220 }, { x: 630, y: 100 }], netName: 'GND', connectedPins: [
        { componentId: source.id, pinId: 'negative' },
        { componentId: lowerResistor.id, pinId: 'p2' },
      ] },
    ]

    useProjectStore.setState({ components: [source, upperResistor, lowerResistor], wires: sampleWires, isDirty: true })
    useAppStore.setState({ simulationPanelOpen: true })
    useAppStore.getState().setWorkspaceMode('schematic')
  }

  const handleLoadDemoBoard = async () => {
    if (!confirmReplace('tested half-wave rectifier board')) return
    if (!(await ensureProject())) return
    const board = buildDemoBoard()
    useProjectStore.setState({ components: board.components, wires: board.wires, isDirty: true })
    useAppStore.setState({ simulationPanelOpen: true })
    useAppStore.getState().setWorkspaceMode('schematic')
  }

  const handleSelectProject = async (project: Project) => {
    try {
      let schematic: Schematic | null = null
      let savedCanvas: Record<string, unknown> | null = null
      if (offlineMode) {
        savedCanvas = offlineProjectStore.get(project.id)?.canvas_data ?? null
      } else {
        const { data, error } = await supabase.from('schematics').select('*')
          .eq('project_id', project.id).order('order_index', { ascending: true }).limit(1).maybeSingle()
        if (error) throw error
        schematic = data
        savedCanvas = schematic?.canvas_data ?? null
      }
      useProjectStore.setState({
        components: Array.isArray(savedCanvas?.components)
          ? savedCanvas.components as ReturnType<typeof useProjectStore.getState>['components']
          : [],
        wires: Array.isArray(savedCanvas?.wires)
          ? savedCanvas.wires as ReturnType<typeof useProjectStore.getState>['wires']
          : [],
        firmwareCode: typeof savedCanvas?.firmwareCode === 'string' ? savedCanvas.firmwareCode : '',
        simulationRuns: Array.isArray(savedCanvas?.simulationRuns)
          ? savedCanvas.simulationRuns as ReturnType<typeof useProjectStore.getState>['simulationRuns']
          : [],
        pcbLayout: asPcbLayout(savedCanvas?.pcbLayout),
        mechanicalParts: asMechanicalParts(savedCanvas?.mechanicalParts),
        domainDesigns: asDomainDesigns(savedCanvas?.domainDesigns),
        simulationResults: [],
        isSimulating: false,
        liveFrame: null,
        isDirty: false,
      })
      setCurrentSchematic(schematic)
      setCanvasData(savedCanvas)
      const viewport = savedCanvas?.viewport as { zoom?: unknown; pan?: unknown } | undefined
      if (viewport && typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) {
        useAppStore.getState().setZoom(viewport.zoom)
      }
      if (viewport?.pan && typeof viewport.pan === 'object') {
        const pan = viewport.pan as { x?: unknown; y?: unknown }
        if (typeof pan.x === 'number' && Number.isFinite(pan.x) && typeof pan.y === 'number' && Number.isFinite(pan.y)) {
          useAppStore.getState().setPan({ x: pan.x, y: pan.y })
        }
      }
      setCurrentProject(project)
      setShowProjectManager(false)
    } catch (err) {
      console.error('Error loading schematic:', err)
      return
    }
    if (user) {
      recordPlatformUsage('project.open', user, offlineMode, { name: project.name })
      siemService.logAuditEvent({ user: user.id, action: 'project:open', resource: project.id, details: {} })
    }
  }

  /*
   * URL ownership lives in App because App is mounted for every screen: the
   * workspace (and its old hash router) only mounts after a project opens, so
   * a `#/agents` reload landed on the project list before the mode could apply.
   * Applying the location here also gives back/forward one stable owner.
   */
  const selectProjectRef = useRef<(project: Project) => void>(() => {})
  useEffect(() => {
    selectProjectRef.current = (project) => { void handleSelectProject(project) }
  })

  useEffect(() => {
    const applyLocation = () => {
      // Administration is not a workspace; keep it out of parseRoute's modes.
      if (typeof window !== 'undefined' && isAdminPath(window.location.pathname)) {
        setShowAdmin(true)
        return
      }
      setShowAdmin(false)
      const route = currentRoute()
      if (route.isProjectList) {
        setShowProjectManager(true)
        return
      }
      if (!route.mode) {
        // Unknown paths are not documents; canonicalise them to the project list.
        navigateTo(PROJECTS_ROUTE, { replace: true })
        setShowProjectManager(true)
        return
      }
      setShowProjectManager(false)
      // Re-setting the active mode clears a pending demo request, so only
      // dispatch when the URL genuinely names a different workspace.
      if (useAppStore.getState().workspaceMode !== route.mode) {
        useAppStore.getState().setWorkspaceMode(route.mode)
      }
      if (route.projectId && offlineMode) {
        const openProject = useProjectStore.getState().currentProject
        if (openProject?.id !== route.projectId) {
          const project = offlineProjectStore.get(route.projectId)
          if (project) {
            void selectProjectRef.current(project)
          } else {
            // A stale/deleted local project id cannot be opened; do not leave
            // the address bar describing a document that is not shown.
            navigateTo(PROJECTS_ROUTE, { replace: true })
            setShowProjectManager(true)
          }
        }
      } else if (!route.projectId && useProjectStore.getState().currentProject) {
        // Back landed on a project-free view while a document is still loaded.
        // Show the list over it instead of pretending `/` is that document.
        setShowProjectManager(true)
      }
    }
    applyLocation()
    return subscribeToRoute(applyLocation)
  }, [offlineMode])

  /*
   * Mirror the live document into history. pushState keeps Back meaningful;
   * an already-canonical deep link compares equal and writes nothing, so a
   * reload never adds a duplicate entry.
   */
  const routeProjectId = currentProject?.id ?? null
  useEffect(() => {
    if (!routeProjectId || showProjectManager || showAdmin) return
    writeWorkspaceRoute(workspaceMode, routeProjectId)
  }, [routeProjectId, workspaceMode, showProjectManager, showAdmin])

  const handleSave = useCallback(async (data: Record<string, unknown>) => {
    if (!currentProject) return
    // Canvas autosave sends only components/wires/viewport. Merge the rest of
    // the working design so moving a part cannot drop the firmware, simulation
    // runs, or the routed board from the saved project.
    const live = useProjectStore.getState()
    const payload: Record<string, unknown> = {
      ...data,
      firmwareCode: data.firmwareCode === undefined ? live.firmwareCode : data.firmwareCode,
      simulationRuns: data.simulationRuns === undefined ? live.simulationRuns : data.simulationRuns,
      pcbLayout: data.pcbLayout === undefined ? live.pcbLayout : data.pcbLayout,
      mechanicalParts: data.mechanicalParts === undefined ? live.mechanicalParts : data.mechanicalParts,
      domainDesigns: data.domainDesigns === undefined ? live.domainDesigns : data.domainDesigns,
    }
    if (offlineMode) {
      offlineProjectStore.saveCanvas(currentProject.id, payload)
      setCanvasData(payload)
      markClean()
      return
    }
    try {
      const { data: schematic } = await supabase.from('schematics').select('id')
        .eq('project_id', currentProject.id).order('order_index', { ascending: true }).limit(1).maybeSingle()
      if (schematic) {
        await supabase.from('schematics').update({ canvas_data: payload, updated_at: new Date().toISOString() }).eq('id', schematic.id)
        await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', currentProject.id)
        setCanvasData(payload)
        markClean()
        if (user) siemService.logAuditEvent({ user: user.id, action: 'project:save', resource: currentProject.id, details: {} })
      }
    } catch (err) {
      console.error('Error saving:', err)
    }
  }, [currentProject, offlineMode, markClean, user])

  const getCheckpointData = () => ({
    components: useProjectStore.getState().components,
    wires: useProjectStore.getState().wires,
    firmwareCode: useProjectStore.getState().firmwareCode,
    simulationRuns: useProjectStore.getState().simulationRuns,
    pcbLayout: useProjectStore.getState().pcbLayout,
    mechanicalParts: useProjectStore.getState().mechanicalParts,
    domainDesigns: useProjectStore.getState().domainDesigns,
    viewport: useAppStore.getState().viewport,
  })

  const refreshVcs = () => {
    if (!currentProject) return
    setVcsLog(vcsService.log(currentProject.id))
    setBackupList(backupService.listBackups(currentProject.id))
    const dirty = vcsService.status(currentProject.id, buildDesignSnapshot())
    const storageNotes = [
      vcsService.getPersistenceError() ? `Version history is not fully saved: ${vcsService.getPersistenceError()}.` : '',
      backupService.getStorageError() ? `Backups are not fully saved: ${backupService.getStorageError()}.` : '',
    ].filter(Boolean)
    setVcsStatus(storageNotes.length > 0
      ? storageNotes.join(' ')
      : dirty.length === 0 ? 'clean' : `${dirty.length} change(s)`)
  }

  const handleVcsCommit = () => {
    if (!currentProject) return
    const message = vcsMessage.trim() || `Commit ${new Date().toLocaleString()}`
    try {
      const commit = vcsService.commit(currentProject.id, message, buildDesignSnapshot(), user?.id ?? 'local-user')
      recordPlatformUsage('vcs.commit', user, offlineMode, { message: commit.message })
      setVcsMessage('')
      setVcsStatus('')
      refreshVcs()
      const persistenceError = vcsService.getPersistenceError()
      if (persistenceError) {
        setVcsStatus(`Committed for this session only — ${persistenceError}. Export the project to keep a copy.`)
      }
      siemService.logAuditEvent({
        user: user?.id || 'unknown',
        action: 'project:vcs:commit',
        resource: currentProject.id,
        details: { commitId: commit.id, message: commit.message },
      })
    } catch (err) {
      setVcsStatus(err instanceof Error ? err.message : 'Commit failed')
    }
  }

  const handleVcsCheckout = (commit: VcsCommit) => {
    if (!currentProject || !window.confirm(`Restore commit “${commit.message}”? Unsaved work is kept in a backup first.`)) return
    try {
      backupService.createBackup(currentProject.id, getCheckpointData(), 'Before VCS restore')
    } catch (err) {
      setVcsStatus(`Restore cancelled: a safety backup could not be created (${err instanceof Error ? err.message : String(err)}).`)
      return
    }
    let snapshot
    try {
      snapshot = vcsService.checkout(currentProject.id, commit.id)
    } catch (err) {
      setVcsStatus(err instanceof Error ? err.message : 'Restore failed')
      return
    }
    const comps = Array.isArray(snapshot.components) ? snapshot.components : []
    const wr = Array.isArray(snapshot.wires) ? snapshot.wires : []
    const current = useProjectStore.getState()
    useProjectStore.setState({
      components: comps as typeof components,
      wires: wr as typeof wires,
      firmwareCode: typeof snapshot.code === 'string' ? snapshot.code : '',
      pcbLayout: asPcbLayout(snapshot.pcbLayout),
      // Pre-multidomain commits did not record these; keep the live design
      // rather than silently replacing it with defaults.
      mechanicalParts: snapshot.mechanicalParts === undefined
        ? current.mechanicalParts
        : asMechanicalParts(snapshot.mechanicalParts),
      domainDesigns: snapshot.domains === undefined
        ? current.domainDesigns
        : asDomainDesigns(snapshot.domains),
      simulationResults: [],
      isSimulating: false,
      liveFrame: null,
      isDirty: true,
    })
    const viewportMeta = snapshot.meta?.viewport
    if (viewportMeta && typeof viewportMeta === 'object') {
      const viewport = viewportMeta as { zoom?: unknown; pan?: unknown }
      if (typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) {
        useAppStore.getState().setZoom(viewport.zoom)
      }
      const pan = viewport.pan as { x?: unknown; y?: unknown } | undefined
      if (pan && typeof pan.x === 'number' && Number.isFinite(pan.x) && typeof pan.y === 'number' && Number.isFinite(pan.y)) {
        useAppStore.getState().setPan({ x: pan.x, y: pan.y })
      }
    }
    // Keep the export/import canvas in step with the restored design; otherwise
    // netlist export would still describe the pre-restore sheet.
    const restoredData = getCheckpointData()
    setCanvasData(restoredData)
    void handleSave(restoredData)
    refreshVcs()
    setShowVcsMenu(false)
    const backupError = backupService.getStorageError()
    if (backupError) {
      setVcsStatus(`Restored “${commit.message}”. The safety backup is session-only — ${backupError}.`)
    }
    siemService.logAuditEvent({
      user: user?.id || 'unknown',
      action: 'project:vcs:checkout',
      resource: currentProject.id,
      details: { commitId: commit.id },
    })
  }

  const createCheckpoint = () => {
    if (!currentProject) return
    const label = `Checkpoint ${new Date().toLocaleString()}`
    const checkpoint = backupService.createBackup(currentProject.id, getCheckpointData(), label)
    let status = `Backed up as ${checkpoint.label} (also committed below for history)`
    try {
      vcsService.commit(currentProject.id, label, buildDesignSnapshot(), user?.id ?? 'local-user')
      recordPlatformUsage('vcs.commit', user, offlineMode, { message: label, checkpoint: true })
    } catch (err) {
      status += `; history commit failed (${err instanceof Error ? err.message : String(err)})`
    }
    refreshVcs()
    const vcsError = vcsService.getPersistenceError()
    const backupError = backupService.getStorageError()
    if (vcsError) status += `; history is session-only (${vcsError})`
    if (backupError) status += `; backup is session-only (${backupError})`
    setVcsStatus(status)
    siemService.logAuditEvent({
      user: user?.id || 'unknown',
      action: 'project:checkpoint:create',
      resource: currentProject.id,
      details: { checkpointId: checkpoint.id, label: checkpoint.label },
    })
  }

  const restoreCheckpoint = async (checkpoint: ProjectBackup) => {
    if (!currentProject || !window.confirm(`Restore “${checkpoint.label}”? A safety backup of the current state is created first.`)) return

    const restored = backupService.restore(checkpoint.id, currentProject.id)
    if (!restored || !Array.isArray(restored.components) || !Array.isArray(restored.wires)) {
      setVcsStatus('This backup is invalid and could not be restored.')
      return
    }

    backupService.createBackup(currentProject.id, getCheckpointData(), 'Before restore')
    useProjectStore.setState({
      components: restored.components as typeof components,
      wires: restored.wires as typeof wires,
      firmwareCode: typeof restored.firmwareCode === 'string' ? restored.firmwareCode : useProjectStore.getState().firmwareCode,
      simulationRuns: Array.isArray(restored.simulationRuns)
        ? restored.simulationRuns as ReturnType<typeof useProjectStore.getState>['simulationRuns']
        : useProjectStore.getState().simulationRuns,
      pcbLayout: asPcbLayout(restored.pcbLayout),
      mechanicalParts: restored.mechanicalParts === undefined
        ? useProjectStore.getState().mechanicalParts
        : asMechanicalParts(restored.mechanicalParts),
      domainDesigns: restored.domainDesigns === undefined
        ? useProjectStore.getState().domainDesigns
        : asDomainDesigns(restored.domainDesigns),
      simulationResults: [],
      isSimulating: false,
      liveFrame: null,
      isDirty: true,
    })
    const viewport = restored.viewport as { zoom?: unknown; pan?: unknown } | undefined
    if (viewport && typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) {
      useAppStore.getState().setZoom(viewport.zoom)
    }
    if (viewport?.pan && typeof viewport.pan === 'object') {
      const pan = viewport.pan as { x?: unknown; y?: unknown }
      if (typeof pan.x === 'number' && Number.isFinite(pan.x) && typeof pan.y === 'number' && Number.isFinite(pan.y)) {
        useAppStore.getState().setPan({ x: pan.x, y: pan.y })
      }
    }

    setCanvasData(restored)
    refreshVcs()
    setShowVcsMenu(false)
    const backupError = backupService.getStorageError()
    setVcsStatus(backupError
      ? `Restored ${checkpoint.label}. The safety backup is session-only — ${backupError}.`
      : `Restored ${checkpoint.label}`)
    await handleSave(restored)
    siemService.logAuditEvent({
      user: user?.id || 'unknown',
      action: 'project:checkpoint:restore',
      resource: currentProject.id,
      details: { checkpointId: checkpoint.id, label: checkpoint.label },
    })
  }

  // ── Export handlers ──────────────────────────────────────────────────────────
  /* Quotas are checked before the file is produced; usage is recorded only after
   * it actually exists, so a failed export does not consume the daily allowance. */
  const exportQuotaError = (): string | null => {
    if (!user) return 'Sign in to export a design.'
    const decision = checkQuotaCapacity('export', resolveLocalRole(user, offlineMode), {
      projects: 0,
      exportsToday: countUsage('export.run', startOfToday(), user.id),
      simulationsToday: 0,
      storageMb: 0,
    })
    return decision.allowed ? null : decision.reason ?? 'Your export quota is exhausted.'
  }

  const finishExport = (format: string) => {
    recordPlatformUsage('export.run', user, offlineMode, { format })
    setShowExportMenu(false)
  }

  const handleExportImage = () => {
    const canvas = document.querySelector('canvas')
    if (!canvas || !currentProject) return
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    const dataUrl = exportToImage(canvas)
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${currentProject.name}.png`
    a.click()
    finishExport('png')
  }

  const handleExportNetlist = () => {
    if (!canvasData || !currentProject) return
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    const netlist = exportToNetlist(
      (canvasData.components as PlacedComponent[]) || [],
      (canvasData.wires as Wire[]) || [],
      currentProject.name,
    )
    downloadFile(netlist, `${currentProject.name}.net`, 'text/plain')
    finishExport('netlist')
  }

  const handleExportJSON = () => {
    if (!currentProject) return
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    const json = exportToJSON(
      components.map(c => ({ ...c, position: { x: c.x, y: c.y }, scale: 1 } as unknown as PlacedComponent)),
      wires.map(w => ({ ...w, points: w.points } as unknown as Wire)),
      currentProject.name,
    )
    downloadFile(json, `${currentProject.name}.json`, 'application/json')
    finishExport('json')
  }

  const handleExportBOM = () => {
    if (!currentProject) return
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    const bom = exportToBOM(
      components.map(c => ({ ...c, position: { x: c.x, y: c.y }, scale: 1 } as unknown as PlacedComponent))
    )
    // `exportToBOM` is a formatted report, not a CSV; label it honestly.
    downloadFile(bom, `${currentProject.name}_BOM.txt`, 'text/plain')
    finishExport('bom')
  }

  const handleExportGerber = () => {
    if (!currentProject) return
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    const gerber = exportToGerber(
      components.map(c => ({ ...c, position: { x: c.x, y: c.y }, scale: 1 } as unknown as PlacedComponent)),
      wires.map(w => ({ ...w } as unknown as Wire)),
    )
    downloadFile(gerber, `${currentProject.name}.gbr`, 'text/plain')
    finishExport('gerber')
  }

  /*
   * Vector engineering drawing, not a canvas screenshot: sheet border, zone
   * references, title block, haloed labels and print-registration ink all come
   * from the same layout module the interactive canvas draws with.
   */
  const handleExportDrawing = () => {
    if (!currentProject) return
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    const svg = buildSchematicDrawing(components, wires, {
      title: currentSchematic?.name || currentProject.name,
      projectName: currentProject.name,
      notes: ['Crossings without a junction dot are not connected.'],
    })
    downloadFile(svg, `${currentProject.name}_drawing.svg`, 'image/svg+xml')
    finishExport('drawing-svg')
  }

  const handleSignOut = async () => {
    if (offlineMode) {
      // Local mode has no session to end; "signing out" returns to the project list.
      setCurrentProject(null)
      setCurrentSchematic(null)
      setCanvasData(null)
      openProjectManager()
      return
    }
    if (user) siemService.logAuditEvent({ user: user.id, action: 'auth:signout', resource: 'session', details: {} })
    await supabase.auth.signOut()
    setCurrentProject(null)
    setCurrentSchematic(null)
    setCanvasData(null)
    navigateTo(PROJECTS_ROUTE, { replace: true })
  }

  const themeIcon = isDarkTheme ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />
  const themeLabel = describeTheme(themePreference, resolvedTheme)
  const themeToggleLabel = isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'

  const toggleVoice = async () => {
    setShowVoiceBar(true)
    if (isVoiceActive) {
      nlpService.stopVoiceListening()
      setIsVoiceActive(false)
      return
    }
    try {
      await nlpService.startVoiceListening()
      setIsVoiceActive(true)
      setVoiceError('')
    } catch (error) {
      // The typed command bar stays usable even without SpeechRecognition.
      setVoiceError(error instanceof Error ? error.message : 'Voice input unavailable')
    }
  }

  const closeVoiceBar = () => {
    nlpService.stopVoiceListening()
    setIsVoiceActive(false)
    setShowVoiceBar(false)
    setVoiceError('')
  }

  const handleExportEncrypted = async () => {
    if (!currentProject) return
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    const passphrase = window.prompt('Passphrase for the encrypted export (it cannot be recovered):')
    if (!passphrase) return
    const userId = user?.id ?? 'offline-local'
    const assetId = currentProject.id
    try {
      assetSecurity.grant(userId, assetId, 'owner')
      const plaintext = JSON.stringify(buildDesignSnapshot(), null, 2)
      const encrypted = await assetSecurity.encryptAsset(userId, assetId, plaintext, passphrase)
      downloadFile(
        JSON.stringify(encrypted, null, 2),
        `${currentProject.name}.folio.enc.json`,
        'application/json',
      )
      recordPlatformUsage('export.run', user, offlineMode, { format: 'encrypted-json' })
      setExportStatus(`Encrypted with ${encrypted.algorithm}.`)
    } catch (error) {
      setExportStatus(error instanceof Error ? error.message : 'Encrypted export failed.')
    }
  }

  // ── Render gates ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
          <LoadingSpinner size="lg" />
          <span className="text-muted-foreground">Loading Folio…</span>
        </div>
      </div>
    )
  }

  if (!user) return <AuthForm onAuthSuccess={() => {}} />

  if (showAdmin) {
    return (
      <Suspense
        fallback={(
          <div className="flex min-h-screen items-center justify-center bg-background">
            <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
              <LoadingSpinner size="lg" />
              <span className="text-muted-foreground">Loading administration…</span>
            </div>
          </div>
        )}
      >
        <AdminConsole user={user} offlineMode={offlineMode} onBack={closeAdmin} />
      </Suspense>
    )
  }

  if (!currentProject || showProjectManager) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <header className="app-chrome app-chrome-divider flex flex-shrink-0 items-center justify-between px-6 py-4" data-tour="app-header">
          <div className="flex items-center gap-3">
            <Cpu className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-lg font-semibold leading-tight text-surface-foreground">Folio</h1>
              <p className="text-xs text-muted-foreground">Multi-domain engineering workbench</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={openAdmin} title="Administration" aria-label="Administration">
              <ShieldCheck className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} title={themeToggleLabel} aria-label={themeToggleLabel}>{themeIcon}</Button>
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings"><Settings className="w-4 h-4" /></Button>
            {!offlineMode && (
              <Button variant="ghost" onClick={handleSignOut} className="flex items-center gap-2">
                <LogOut size={16} />Sign Out
              </Button>
            )}
          </div>
        </header>
        <NoticeBanner message={notice} onDismiss={() => setNotice('')} />
        <ProjectManager onSelectProject={handleSelectProject} onNewProject={handleNewProject} offlineMode={offlineMode} />
        {showSettings && (
          <Suspense fallback={panelFallback}>
            <SettingsPanel onClose={() => setShowSettings(false)} onRestartOnboarding={restartOnboarding} />
          </Suspense>
        )}
        {showLimits && (
          <Suspense fallback={panelFallback}>
            <LimitsDialog open onClose={() => setShowLimits(false)} />
          </Suspense>
        )}
        {showOnboarding && (
          <OnboardingTour
            onClose={closeOnboarding}
            onCreateProject={() => { void handleNewProject() }}
            onLoadSampleCircuit={() => { void handleLoadSampleCircuit() }}
            onLoadDemoBoard={() => { void handleLoadDemoBoard() }}
            onOpenLimits={openLimitsRegister}
            hasProject={Boolean(currentProject)}
            stepIndex={onboardingStep}
            setStepIndex={showTourStep}
          />
        )}
      </div>
    )
  }

  // ── Main IDE layout ───────────────────────────────────────────────────────────
  return (
    <div className="app-shell">

      {/* ── Header ── */}
      <header className="app-chrome app-chrome-divider flex min-w-0 flex-shrink-0 items-center justify-between gap-2 px-4 py-2" data-tour="app-header">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Button variant="ghost" size="icon" onClick={openProjectManager} title="Projects" aria-label="Projects">
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button
            variant={sidebarOpen ? 'default' : 'ghost'}
            size="icon"
            onClick={toggleSidebar}
            title="Toggle Library" aria-label="Toggle Library"
            aria-pressed={sidebarOpen}
          >
            <Menu className="w-4 h-4" />
          </Button>
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <div className="flex min-w-0 items-center gap-2">
            <Cpu className="hidden h-4 w-4 flex-shrink-0 text-primary sm:block" />
            <div className="min-w-0">
              <h1 className="truncate text-[13px] font-semibold leading-tight text-foreground" title={currentProject.name}>
                {currentProject.name}
              </h1>
              {(isDirty || offlineMode) && (
                <div className="flex items-center gap-2 text-[10px] uppercase leading-tight tracking-[0.08em]">
                  {isDirty && <span className="text-warning">● Unsaved</span>}
                  {offlineMode && <span className="text-muted-foreground">Local only</span>}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex min-w-0 flex-shrink-0 items-center gap-1">
          {/* Secondary actions stay out of the way on narrow viewports and are
           * reachable from the More menu, so no control disappears. */}
          <div className="hidden items-center gap-1 lg:flex">
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            {/* Voice control */}
            <Button
              variant={isVoiceActive ? 'default' : 'ghost'}
              size="icon"
              onClick={toggleVoice}
              title={isVoiceActive ? 'Stop voice control' : 'Start voice control'} aria-label={isVoiceActive ? 'Stop voice control' : 'Start voice control'}
            >
              {isVoiceActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </Button>

            {/* Security alerts — shield itself flags active alerts (no floating count pill) */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => useAppStore.getState().setWorkspaceMode('siem')}
              title={activeAlertCount > 0 ? `${activeAlertCount} active security alert${activeAlertCount === 1 ? '' : 's'}` : 'Security alerts'} aria-label={activeAlertCount > 0 ? `${activeAlertCount} active security alert${activeAlertCount === 1 ? '' : 's'}` : 'Security alerts'}
            >
              <Shield className={activeAlertCount > 0 ? 'w-4 h-4 text-destructive' : 'w-4 h-4'} />
            </Button>

            <Button variant="ghost" size="icon" onClick={toggleAiChat} title="AI Assistant" aria-label="AI Assistant" data-tour="agent-button">
              <Bot className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={openAdmin} title="Administration" aria-label="Administration">
              <ShieldCheck className="w-4 h-4" />
            </Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <Button variant="ghost" size="icon" onClick={() => useAppStore.getState().setWorkspaceMode('simulation')} title="Open simulation workspace" aria-label="Open simulation workspace" data-tour="simulation-toggle">
              <BarChart3 className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings">
              <Settings className="w-4 h-4" />
            </Button>
            <Button variant="ghost" size="icon" onClick={openPluginPanel} title="Plugins" aria-label="Plugins">
              <Package className="w-4 h-4" />
            </Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
            <Button variant="ghost" size="icon" onClick={() => setShowCollaborativePanel(true)} title="Collaboration" aria-label="Collaboration">
              <Users className="w-4 h-4" />
            </Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          </div>

          <div className="relative" data-tour="version-history">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => { setShowVcsMenu(value => !value); refreshVcs() }}
              title="Version history"
              aria-label="Version history"
              aria-expanded={showVcsMenu}
            >
              <History className="w-4 h-4" />
            </Button>
            {showVcsMenu && (
              <div className="app-panel absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border shadow-xl">
                <div className="p-3 border-b border-border">
                  <h2 className="text-sm font-semibold">Version history</h2>
                  <p className="text-xs text-muted-foreground mt-1">
                    Content-addressed commits of the whole project — schematic, PCB, mechanical assembly,
                    firmware and every CAD domain — stored on this device. Restore brings the design back
                    as one consistent state.
                  </p>
                  <form
                    className="flex gap-2 mt-3"
                    onSubmit={event => { event.preventDefault(); handleVcsCommit() }}
                  >
                    <input
                      value={vcsMessage}
                      onChange={event => setVcsMessage(event.target.value)}
                      placeholder="Commit message"
                      aria-label="Commit message"
                      maxLength={120}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                    />
                    <Button type="submit" size="sm">Commit</Button>
                    <Button type="button" size="sm" variant="outline" onClick={createCheckpoint} title="Safety backup + commit">Back up</Button>
                  </form>
                  {vcsStatus && <p role="status" className="text-xs text-muted-foreground mt-2">{vcsStatus}</p>}
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {vcsLog.length === 0 && backupList.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No commits yet. Describe the change and press Commit.</p>
                  ) : (
                    <>
                    {vcsLog.map(commit => (
                    <div key={`c-${commit.id}`} className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" title={commit.message}>{commit.message}</p>
                        <p className="text-xs text-muted-foreground">{new Date(commit.timestamp).toLocaleString()} · {commit.id.slice(0, 8)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={`Restore ${commit.message}`}
                        aria-label={`Restore ${commit.message}`}
                        onClick={() => handleVcsCheckout(commit)}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    </div>
                    ))}
                    {backupList.map(backup => (
                    <div key={`b-${backup.id}`} className="flex items-center gap-2 px-3 py-2 border-b border-border last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm" title={backup.label}>{backup.label} (backup)</p>
                        <p className="text-xs text-muted-foreground">{new Date(backup.createdAt).toLocaleString()} · {(backup.sizeBytes / 1024).toFixed(1)} KB</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={`Restore ${backup.label}`}
                        aria-label={`Restore ${backup.label}`}
                        onClick={() => void restoreCheckpoint(backup)}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    </div>
                    ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setShowCommandPalette(true)}
            title={`Command palette (${PALETTE_SHORTCUT_LABEL})`}
            aria-label="Command palette"
            aria-haspopup="dialog"
            data-tour="command-palette"
          >
            <Search className="w-4 h-4" />
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="flex items-center gap-1 text-xs"
            onClick={() => setShowDemoGallery(true)}
            title={`Open the demo gallery (${DEMO_SHORTCUT_LABEL})`}
            aria-label="Open the demo gallery"
            aria-haspopup="dialog"
          >
            <FlaskConical className="h-4 w-4" />
            <span className="hidden sm:inline">Demos</span>
          </Button>

          {/* Export menu */}
          <div className="relative">
            <Button
              variant="default"
              size="sm"
              className="flex items-center gap-1 text-xs"
              onClick={() => {
                setShowExportMenu(v => !v)
                setExportStatus('')
              }}
              aria-label="Export design"
              aria-expanded={showExportMenu}
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
            {showExportMenu && (
              <div className="app-panel absolute right-0 z-50 mt-2 w-56 rounded-md border border-border py-2 shadow-xl">
                {[
                  { label: 'Export as Image', icon: Image, action: handleExportImage },
                  { label: 'Export Drawing (SVG)', icon: FileText, action: handleExportDrawing },
                  { label: 'Export Netlist (.net)', icon: FileText, action: handleExportNetlist },
                  { label: 'Export JSON', icon: FileText, action: handleExportJSON },
                  { label: 'Export Gerber (.gbr)', icon: FileText, action: handleExportGerber },
                  { label: 'Bill of Materials', icon: List, action: handleExportBOM },
                  { label: 'Encrypted JSON…', icon: Lock, action: handleExportEncrypted },
                ].map(({ label, icon: Icon, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    className="w-full px-4 py-2 text-left hover:bg-accent flex items-center gap-3 text-sm"
                  >
                    <Icon size={15} />
                    {label}
                  </button>
                ))}
                {exportStatus && (
                  <p role="status" className="border-t border-border px-4 pt-2 text-xs text-muted-foreground">
                    {exportStatus}
                  </p>
                )}
              </div>
            )}
          </div>

          <Button variant="ghost" size="icon" onClick={toggleTheme} title={themeToggleLabel} aria-label={themeToggleLabel}>
            {themeIcon}
          </Button>
          <Button variant="ghost" size="icon" className="hidden sm:inline-flex" onClick={() => {
            setCurrentProject(null)
            setCurrentSchematic(null)
            setCanvasData(null)
            openProjectManager()
          }} title="Back to Projects" aria-label="Back to Projects">
            <RefreshCw className="w-4 h-4" />
          </Button>
          {!offlineMode && (
            <Button variant="ghost" size="icon" className="hidden md:inline-flex" onClick={handleSignOut} title="Sign Out" aria-label="Sign Out">
              <LogOut className="w-4 h-4" />
            </Button>
          )}

          <div className="relative lg:hidden">
            <Button
              variant={showMoreMenu ? 'default' : 'ghost'}
              size="icon"
              onClick={() => setShowMoreMenu(value => !value)}
              title="More tools"
              aria-label="More tools"
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
            >
              <MoreHorizontal className="w-4 h-4" />
            </Button>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} aria-hidden="true" />
                <div
                  className="app-panel absolute right-0 top-full z-50 mt-1 w-60 rounded-md border border-border py-1 shadow-xl"
                  role="menu"
                  aria-label="More tools"
                >
                  {([
                    { label: isVoiceActive ? 'Stop voice control' : 'Start voice control', icon: isVoiceActive ? MicOff : Mic, action: toggleVoice },
                    { label: activeAlertCount > 0 ? `Security alerts (${activeAlertCount} active)` : 'Security alerts', icon: Shield, action: () => useAppStore.getState().setWorkspaceMode('siem') },
                    { label: 'AI Assistant', icon: Bot, action: toggleAiChat },
                    { label: 'Administration', icon: ShieldCheck, action: openAdmin },
                    { label: 'Simulation workspace', icon: BarChart3, action: () => useAppStore.getState().setWorkspaceMode('simulation') },
                    { label: 'Settings', icon: Settings, action: () => setShowSettings(true) },
                    { label: 'Plugins', icon: Package, action: openPluginPanel },
                    { label: 'Collaboration', icon: Users, action: () => setShowCollaborativePanel(true) },
                    { label: 'Back to Projects', icon: RefreshCw, action: () => { setCurrentProject(null); setCurrentSchematic(null); setCanvasData(null); openProjectManager() } },
                  ] as const).map(({ label, icon: Icon, action }) => (
                    <button
                      key={label}
                      type="button"
                      role="menuitem"
                      onClick={() => { action(); setShowMoreMenu(false) }}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm text-foreground hover:bg-accent"
                    >
                      <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                      <span className="truncate">{label}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <NoticeBanner message={notice} onDismiss={() => setNotice('')} />

      {showVoiceBar && (
        <VoiceCommandBar
          listening={isVoiceActive}
          onToggleListening={() => { void toggleVoice() }}
          onClose={closeVoiceBar}
          error={voiceError}
        />
      )}

      {/* ── Main area ── */}
      <main aria-label="Workspace" className="relative flex min-w-0 flex-1 overflow-hidden">
        {/* Domain workspace with 13-mode tab routing */}
        <DomainWorkspace
          libraryComponents={paletteComponents}
          onSave={handleSave}
          onOpenDemos={() => setShowDemoGallery(true)}
          beforeSimulationRun={simulationQuotaError}
          onSimulationRun={recordSimulationRun}
        />

        {/* Right panel stack — docked on desktop, a drawer over the sheet below xl. */}
        {(simulationPanelOpen || aiChatOpen || showCollaborativePanel || showPluginPanel) && (
          <div
            className="fixed inset-0 z-40 bg-overlay/40 xl:hidden"
            onClick={() => {
              useAppStore.setState({ simulationPanelOpen: false, aiChatOpen: false })
              setShowCollaborativePanel(false)
              setShowPluginPanel(false)
            }}
            aria-hidden="true"
          />
        )}
        <div className="flex min-w-0 flex-shrink-0 max-xl:absolute max-xl:inset-y-0 max-xl:right-0 max-xl:z-40 max-xl:shadow-2xl">
          <Suspense fallback={panelFallback}>
          {simulationPanelOpen && (
            <div className="app-panel w-96 max-w-[calc(100vw-2rem)] border-l border-border max-xl:h-full">
              <SimulationPanel
                onClose={toggleSimulationPanel}
                beforeRun={simulationQuotaError}
                onRunComplete={recordSimulationRun}
              />
            </div>
          )}
          {aiChatOpen && (
            <div className="app-panel w-96 max-w-[calc(100vw-2rem)] border-l border-border max-xl:h-full">
              <AIChatPanel onClose={toggleAiChat} />
            </div>
          )}
          {showCollaborativePanel && (
            <div className="app-panel w-80 max-w-[calc(100vw-2rem)] border-l border-border max-xl:h-full">
              <CollaborativePanel onClose={() => setShowCollaborativePanel(false)} />
            </div>
          )}
          {showPluginPanel && (
            <div className="app-panel w-96 max-w-[calc(100vw-2rem)] border-l border-border max-xl:h-full">
              <PluginPanel onClose={() => setShowPluginPanel(false)} />
            </div>
          )}
          </Suspense>
        </div>
      </main>

      {/* ── Status bar: document metrics on the sheet, workspace context elsewhere ── */}
      <footer className="status-bar" aria-label="Workspace status" data-tour="status-bar">
        <span className="status-segment text-foreground" title={WORKSPACE_MODE_META[workspaceMode].description}>
          MODE <span className="cad-readout uppercase">{WORKSPACE_MODE_META[workspaceMode].label}</span>
        </span>
        {workspaceMode === 'schematic' ? (
          <>
            <span className="status-segment">
              PARTS <span className="cad-readout">{components.length}</span>
            </span>
            <span className="status-segment">
              WIRES <span className="cad-readout">{wires.length}</span>
            </span>
            <span className="status-segment">
              SEL <span className="cad-readout">{selectedComponents.length}</span>
            </span>
            <span className="status-segment">
              TOOL <span className="cad-readout uppercase">{activeTool}</span>
            </span>
            <span className="status-segment hidden sm:inline-flex">
              GRID <span className="cad-readout">{settings.gridSize}</span>
            </span>
            <span className="status-segment hidden sm:inline-flex">
              SNAP <span className="cad-readout">{settings.snapToGrid ? 'ON' : 'OFF'}</span>
            </span>
          </>
        ) : (
          <span className="status-segment hidden truncate lg:inline-flex" title={WORKSPACE_MODE_META[workspaceMode].description}>
            {WORKSPACE_MODE_META[workspaceMode].description}
          </span>
        )}
        <span className="status-segment hidden md:inline-flex">
          THEME <span className="cad-readout">{themeLabel}</span>
        </span>
        {isDirty && <span className="status-segment text-warning">● UNSAVED</span>}
        {isVoiceActive && (
          <span className="status-segment animate-pulse text-success">
            <Mic className="h-3 w-3" /> VOICE
          </span>
        )}
        {activeAlertCount > 0 && (
          <button
            type="button"
            onClick={() => useAppStore.getState().setWorkspaceMode('siem')}
            title={`${activeAlertCount} active alert${activeAlertCount === 1 ? '' : 's'}${activeAlertSummary ? `: ${activeAlertSummary}` : ''}`}
            aria-label={`Open security alerts: ${activeAlertCount} active${activeAlertSummary ? ` - ${activeAlertSummary}` : ''}`}
            className="status-segment text-destructive transition-colors hover:bg-accent"
          >
            <AlertCircle className="h-3 w-3" /> {activeAlertCount} ALERT{activeAlertCount !== 1 ? 'S' : ''}
          </button>
        )}
        <button
          type="button"
          onClick={openLimitsRegister}
          data-tour="limits-button"
          className="status-segment ml-auto hidden border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:inline-flex"
          title="Open the capabilities and limits registry"
        >
          <ShieldAlert className="h-3 w-3" /> LIMITS
        </button>
        <button
          type="button"
          onClick={() => setShowDemoGallery(true)}
          className="status-segment hidden border-l border-border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground lg:inline-flex"
          title={`Open the demo gallery (${DEMO_SHORTCUT_LABEL})`}
        >
          <FlaskConical className="h-3 w-3" /> DEMOS <span className="cad-kbd ml-1">{DEMO_SHORTCUT_LABEL}</span>
        </button>
        <span className="status-segment hidden border-r-0 lg:inline-flex">
          <Bell className="w-3 h-3" aria-hidden="true" />
        </span>
      </footer>

      {/* Canvas ref for UserPresence */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Overlays */}
      <UserPresence
        users={collaborativeUsers}
        showCursors={true}
        showSelections={true}
        canvasRef={canvasRef}
      />

      <Suspense fallback={panelFallback}>
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onRestartOnboarding={restartOnboarding} />}
        {showDemoGallery && (
          <DemoGallery
            open
            onClose={() => setShowDemoGallery(false)}
            onOpenScenario={openDemoScenario}
          />
        )}
        {showCommandPalette && (
          <CommandPalette
            open
            onClose={() => setShowCommandPalette(false)}
            onSave={() => { void handleSave(getCheckpointData()) }}
            onOpenDemos={() => setShowDemoGallery(true)}
            onOpenLimits={openLimitsRegister}
            onToggleTheme={toggleTheme}
            onOpenScenario={openDemoScenario}
          />
        )}
        {showLimits && (
          <LimitsDialog open onClose={() => setShowLimits(false)} currentMode={workspaceMode} />
        )}
      </Suspense>
      {showOnboarding && (
        <OnboardingTour
          onClose={closeOnboarding}
          onCreateProject={() => { void handleNewProject() }}
          onLoadSampleCircuit={() => { void handleLoadSampleCircuit() }}
          onLoadDemoBoard={() => { void handleLoadDemoBoard() }}
          onOpenLimits={openLimitsRegister}
          hasProject
          stepIndex={onboardingStep}
          setStepIndex={showTourStep}
        />
      )}
    </div>
  )
}

export default App
