import HoverHelp from './components/ui/HoverHelp'
import { lazy, Suspense, useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  FolderOpen, PanelLeft, BarChart3, Settings, Package, Users,
  Download, Image, FileText, List, Lock, LogOut, Mic, MicOff,
  ArrowLeft, History, RotateCcw, Moon, Sun, AlertCircle,
  MoreHorizontal, ShieldAlert, ShieldCheck, HelpCircle, X, ScrollText, Send, CloudOff,
  Cloud, HardDrive, Cable, MousePointer2, Grid3X3, Magnet, Wrench, CircleUserRound,
} from 'lucide-react'
import ScribeIcon from './components/workspace/ScribeIcon'
import { Button } from './components/ui/button'
import type { PlacedComponent, Wire, User } from './types'
import { supabase, isSupabaseConfigured, type Project, type Schematic, type Component } from './lib/supabase'
import {
  CURATED_DEMO_BY_TEMPLATE_ID,
  applyTemplateFile,
  fetchCommunityFork,
  licenseLabel,
  type CommunityTemplate,
  type CommunityTemplateFile,
} from './lib/community/community'
import { useCommunityPreviewStore } from './stores/useCommunityPreviewStore'
import { offlineProjectStore } from './lib/offlineProjectStore'
import { standardComponents } from './lib/componentLibrary'
import { libraryForMode } from './lib/library/catalog'
import { isBoardDemoLoad, loadBoardDemo, loadDemoScenario } from './lib/demo/loadDemo'
import type { DemoScenario } from './lib/demo/demoScenarios'
import { DEMO_SCENARIOS } from './lib/demo/demoScenarios'
import { exportToImage, exportToNetlist, exportToJSON, exportToBOM, exportToGerber, downloadFile } from './lib/exportUtils'
import { buildSchematicDrawing } from './lib/schematic/engineeringDrawing'
import { pluginManager } from './lib/plugins/pluginManager'
import { type CollabUser } from './lib/collaboration/collaborativeEditor'
import { useCollaborationPresence } from './lib/collaboration/useCollaborationPresence'
import { nlpService } from './lib/nlp/nlpService'
import { voiceController } from './lib/voice/controller'
import { useVoiceStore } from './stores/useVoiceStore'
import { siemService } from './lib/siem/siemService'
import { assetSecurity } from './lib/security/assetSecurity'
import { backupService, type ProjectBackup } from './lib/backup/backupService'
import { buildCheckpointPayload } from './lib/backup/checkpoint'
import { useAppStore, type WorkspaceMode } from './stores/useAppStore'
import { WORKSPACE_MODES } from './lib/workspace/modes'
import { useShortcutStore } from './stores/useShortcutStore'
import { useDesignHealthStore } from './stores/useDesignHealthStore'
import { isEditableTarget, matchesShortcut } from './lib/keymap/shortcuts'
import {
  currentRoute,
  navigateTo,
  COMMUNITY_ROUTE,
  PROJECTS_ROUTE,
  subscribeToRoute,
  writeWorkspaceRoute,
} from './stores/routing'
import { useProjectStore } from './stores/useProjectStore'
import type { CanvasComponent, CanvasWire } from './stores/useProjectStore'
import { vcsService, type VcsCommit } from './lib/vcs/vcsService'
import { agentJobRunner } from './lib/agents/agentJobs'
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
import ConfirmDialog from './components/ui/ConfirmDialog'
import SecretDialog from './components/ui/SecretDialog'
import { useConfirm } from './components/ui/useConfirm'
import { useSecretPrompt } from './components/ui/useSecretPrompt'
import type { HelpTab } from './components/help/HelpCenter'
import type { Tutorial } from './lib/tutorials/tutorials'
import ProjectManager from './components/ProjectManager'
import EditableProjectTitle from './components/EditableProjectTitle'
import NotFound from './components/NotFound'
import AuthForm from './components/AuthForm'
import FolioLogo, { FolioMark } from './components/brand/FolioLogo'
import { AuroraField } from './components/brand/AuroraField'
import VoiceCommandBar from './components/nlp/VoiceCommandBar'
import { LoadingSpinner } from './components/ui/LoadingSpinner'
import LocalProfileGate from './components/LocalProfileGate'
import CommunityPage from './components/community/CommunityPage'
import PublishDesignDialog from './components/community/PublishDesignDialog'
import { useLocalProfileStore, useActiveProfile } from './stores/useLocalProfileStore'
import UserPresence from './components/collaboration/UserPresence'
import NotificationBell from './components/workspace/NotificationBell'
import { watchAgentJobsForNotifications } from './lib/notifications/agentNotifications'
import { notifyNotification } from './lib/notifications/notifications'
import { triggerHaptic } from './lib/haptics'
import AgentStatusPill from './components/workspace/AgentStatusPill'
import AgentStatusSegment from './components/workspace/AgentStatusSegment'
import { useTheme } from './lib/theme/useTheme'
import { WORKSPACE_GROUPS, WORKSPACE_MODE_META, FIRST_MODE_BY_GROUP, groupForMode, type WorkspaceGroupId } from './lib/workspace/modes'
import { GROUP_ACCENT_TOKENS } from './lib/workspace/accents'
import { checkQuotaCapacity, resolveQuotaRole } from './lib/admin/quotaPolicy'
import { readOwnGovernanceRole, syncQuotaPoliciesFromCloud } from './lib/admin/quotaSync'
import { countUsage } from './lib/admin/usageLedger'
import { getLastCloudUsageError, recordPlatformUsage, subscribeUsageMirror } from './lib/admin/usageRecorder'

// On-demand panels keep their heavyweight deps (recharts, plugin runtimes)
// out of the first paint until the user actually opens them.
const SimulationPanel = lazy(() => import('./components/simulation/SimulationPanel'))
const AIChatPanel = lazy(() => import('./components/ai/AIChatPanel'))
const PluginPanel = lazy(() => import('./components/plugins/PluginPanel'))
const CollaborativePanel = lazy(() => import('./components/collaboration/CollaborativePanel'))
const SettingsPanel = lazy(() => import('./components/SettingsPanel'))
const DemoGallery = lazy(() => import('./components/workspace/DemoGallery'))
const CommandPalette = lazy(() => import('./components/workspace/CommandPalette'))
const LimitsDialog = lazy(() => import('./components/workspace/LimitsDialog'))
const HelpCenter = lazy(() => import('./components/help/HelpCenter'))
const TutorialRunner = lazy(() => import('./components/help/TutorialRunner'))

const panelFallback = (
  <div className="flex h-full items-center justify-center p-4">
    <LoadingSpinner size="sm" />
  </div>
)

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

/**
 * The workspace mode stored in the payload's viewport (as of v2 checkpoints).
 * Validated against the registry so a hand-edited file cannot pick an unknown
 * mode; unknown values are ignored rather than guessed.
 */
const VALID_MODES = new Set(WORKSPACE_MODES.map((mode) => mode.id))
function asStoredMode(viewport: unknown): WorkspaceMode | null {
  const mode = (viewport as { mode?: unknown } | undefined)?.mode
  return typeof mode === 'string' && VALID_MODES.has(mode as WorkspaceMode)
    ? (mode as WorkspaceMode)
    : null
}
/** Apply the payload's stored workspace mode, when it is one we ship. */
function applyStoredMode(viewport: unknown): void {
  const mode = asStoredMode(viewport)
  if (mode) useAppStore.getState().setWorkspaceMode(mode)
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

/*
 * A board demo is routed on the main thread when it is opened: the laptop
 * mainboard measures about six seconds of A* plus a nine-thousand-segment scene
 * build, and a blocked thread paints nothing. Yielding two frames first lets the
 * busy state below actually reach the screen. The timer is a guard for a hidden
 * document, where animation frames never fire.
 */
function yieldToPaint(): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      window.clearTimeout(fallback)
      resolve()
    }
    const fallback = window.setTimeout(finish, 250)
    requestAnimationFrame(() => requestAnimationFrame(finish))
  })
}

/** Blocks input while a demo's routing run holds the main thread. */
function DemoLoadingOverlay({ title }: { title: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="fixed inset-0 z-[70] flex items-center justify-center bg-overlay/60"
    >
      <div className="app-panel flex w-[min(26rem,calc(100vw-2rem))] items-start gap-4 rounded-xl border border-border bg-card px-5 py-4 shadow-2xl">
        <LoadingSpinner size="lg" className="mt-0.5 flex-shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-card-foreground">Opening {title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Placing every part and routing the copper runs on this tab, so the workspace
            pauses for a few seconds on a large board. It resumes by itself.
          </p>
        </div>
      </div>
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
  // Identity comes before designing. The hosted auth gate is the door on
  // cloud deployments; the local profile picker is the door on standalone ones.
  const localProfile = useActiveProfile()
  const [user, setUser] = useState<User | null>(() =>
    isSupabaseConfigured
      ? null
      : {
          id: 'offline-local',
          name: useLocalProfileStore.getState().profiles.find(p => p.id === useLocalProfileStore.getState().activeProfileId)?.name ?? 'Workspace Owner',
          email: 'owner@folio.local',
          role: 'owner',
        },
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
  const [showExportMenu, setShowExportMenu] = useState(false)
  const [showVcsMenu, setShowVcsMenu] = useState(false)
  const [vcsMessage, setVcsMessage] = useState('')
  const [vcsLog, setVcsLog] = useState<VcsCommit[]>([])
  const [vcsStatus, setVcsStatus] = useState('')
  const [backupList, setBackupList] = useState<ProjectBackup[]>([])
  const [showProjectManager, setShowProjectManager] = useState(false)
  /* Set when the URL matches nothing in the app: render the 404 surface
     instead of silently bouncing to the launcher. The visitor’s path stands;
     replacing it would hide the reason the page exists. Initialised null and
     set by the location effect so `/` keeps redirecting to the launcher. */
  const [notFoundPath, setNotFoundPath] = useState<string | null>(null)
  const [publishOpen, setPublishOpen] = useState(false)
  const [showCommunity, setShowCommunity] = useState(() => currentRoute().isCommunity)
  const [notice, setNotice] = useState('')
  const [demoBusy, setDemoBusy] = useState<string | null>(null)
  const [showPluginPanel, setShowPluginPanel] = useState(false)
  const [showDemoGallery, setShowDemoGallery] = useState(false)
  const [showLimits, setShowLimits] = useState(false)
  /*
   * The shell asks three questions it used to hand to the browser: load an
   * example over a sheet that has work on it, restore a commit, restore a
   * backup. Answering in this app's own panel keeps the consequence in the
   * sentence instead of a system box, and lets a test click the real buttons.
   */
  const { spec: confirmSpec, confirm, resolve: resolveConfirm } = useConfirm()
  // …and one that takes a secret: the passphrase that seals an export.
  const { request: secretRequest, ask: askSecret, resolve: resolveSecret } = useSecretPrompt()
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  const [helpTab, setHelpTab] = useState<HelpTab>('tutorials')
  const [activeTutorial, setActiveTutorial] = useState<Tutorial | null>(null)
  const [showCollaborativePanel, setShowCollaborativePanel] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [collaborativeUsers, setCollaborativeUsers] = useState<CollabUser[]>([])
  const voiceListening = useVoiceStore((state) => state.listening)
  const voiceOpen = useVoiceStore((state) => state.open)
  const [exportStatus, setExportStatus] = useState('')
  const [activeAlertCount, setActiveAlertCount] = useState(0)
  const [activeAlertSummary, setActiveAlertSummary] = useState('')
  /*
   * A usage event that never reached the deployment is still in this device's
   * ledger, but server-side reports and quota checks did not see it. The
   * designer whose action went uncounted is the person who needs to know, so
   * the warning lives here rather than in a console they cannot open.
   */
  const [usageMirrorError, setUsageMirrorError] = useState('')
  useEffect(() => subscribeUsageMirror(() => setUsageMirrorError(getLastCloudUsageError() ?? '')), [])

  // The right-hand drawer is one slot: opening a tool replaces whatever is there.
  const openPluginPanel = () => {    useAppStore.setState({ simulationPanelOpen: false, aiChatOpen: false })
    setShowCollaborativePanel(false)
    setShowPluginPanel(true)
  }

  /* The project list is a route, not a modal flag: back/forward and reload both
   * land on the same screen. The open project stays loaded for a quick return. */
  const openProjectManager = () => {
    setShowProjectManager(true)
    navigateTo(PROJECTS_ROUTE)
  }

  const simulationQuotaError = (): string | null => {
    if (!user) return 'Sign in to run a simulation.'
    const decision = checkQuotaCapacity('simulation', resolveQuotaRole(user, offlineMode), {
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
    selectedNet,
    clearSelection,
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

  // The schematic workspace runs the rule check and mirrors the result here, so
  // the status bar can state the design's health without a second pass.
  const healthResult = useDesignHealthStore((state) => state.result)
  const healthPanelOpen = useDesignHealthStore((state) => state.panelOpen)
  const toggleHealthPanel = useDesignHealthStore((state) => state.togglePanel)
  const healthErrors = healthResult?.summary.errors ?? 0
  const healthWarnings = healthResult?.summary.warnings ?? 0
  const healthNotices = healthResult?.summary.info ?? 0
  const healthTotal = healthResult?.summary.totalViolations ?? 0

  // The sheet's net cursor, mirrored in the status bar: the name is what the
  // user picked, the count is every distinct pin the run lands on.
  const selectedNetName = useMemo(() => {
    if (!selectedNet) return null
    if ('name' in selectedNet) return selectedNet.name
    return wires.find((wire) => wire.id === selectedNet.wireId)?.netName || 'Unnamed net'
  }, [selectedNet, wires])
  const selectedNetPins = useMemo(() => {
    if (!selectedNet) return 0
    if ('name' in selectedNet) {
      const pins = new Set<string>()
      for (const wire of wires) {
        if (wire.netName !== selectedNet.name) continue
        for (const pin of wire.connectedPins) pins.add(`${pin.componentId}:${pin.pinId}`)
      }
      return pins.size
    }
    return wires.find((wire) => wire.id === selectedNet.wireId)?.connectedPins.length ?? 0
  }, [selectedNet, wires])

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

  /*
   * The dock is per domain: the sheet takes symbols, mechanical takes ISO parts,
   * control takes transfer functions, firmware takes code. The header toggle
   * names what it opens and stands down where a workspace places nothing, so it
   * is never a dead control.
   */
  const workspaceLibraryLabel = useMemo(
    () => libraryForMode(workspaceMode, paletteComponents)?.label ?? null,
    [workspaceMode, paletteComponents],
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
      meta: { viewport: buildCheckpointPayload().viewport as Record<string, unknown> },
    }
  }

  /*
   * Theming is entirely owned by `useTheme`, which writes validated tokens from
   * `lib/theme/tokens.ts` onto <html>. App must never touch `documentElement`
   * colours directly — doing so is what produced the mixed light/dark UI.
   */
  const { isDark: isDarkTheme, toggle: toggleTheme } = useTheme()

  /* The browser tab doubles as a workspace readout: project, mode, unsaved. */
  useEffect(() => {
    const mode = WORKSPACE_MODE_META[workspaceMode].label
    document.title = currentProject
      ? `${isDirty ? 'Unsaved — ' : ''}${currentProject.name} — ${mode} · Folio`
      : showProjectManager
        ? 'Projects · Folio'
        : `${mode} · Folio`
  }, [currentProject, isDirty, showProjectManager, workspaceMode])

  /* Opening a workspace is the workbench's most meaningful usage signal. */
  useEffect(() => {
    if (!user || !currentProject) return
    recordPlatformUsage('workspace.open', user, offlineMode, { mode: workspaceMode })
  }, [user, offlineMode, currentProject, workspaceMode])

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

  /*
   * The workbench pre-checks an action against the policy an operator set, so it
   * can refuse before spending the designer's time. Both reads are best-effort:
   * the database enforces the same limits on insert, and a failed read leaves
   * the shipped defaults in place rather than blocking the workbench.
   */
  const userId = user?.id ?? null
  useEffect(() => {
    if (!userId || offlineMode) return
    let alive = true
    void Promise.all([readOwnGovernanceRole(userId), syncQuotaPoliciesFromCloud()]).then(([role]) => {
      if (!alive) return
      setUser((current) => (current && current.id === userId ? { ...current, role } : current))
    })
    return () => { alive = false }
  }, [userId, offlineMode])

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

  /* The guide is a tour around the CAD, not the launcher or the website: it
   * starts when a design is first open, never on the project list. */
  useEffect(() => {
    if (user && currentProject && !hasCompletedOnboarding()) openTour(readOnboardingStep(ONBOARDING_STEP_COUNT))
  }, [openTour, user, currentProject])

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

  /* The presence host runs in the header, so it shows the other people only —
   * an avatar of yourself next to your own name is noise. */
  const othersPresent = useMemo(
    () => collaborativeUsers.filter((person) => person.id !== collabUser?.id),
    [collaborativeUsers, collabUser],
  )

  // ── SIEM monitoring ─────────────────────────────────────────────────────────
  useEffect(() => {
    siemService.startMonitoring()
    const refreshAlerts = () => {
      const alerts = siemService.getAlerts({ status: 'active' })
      const count = alerts.length
      const summary = alerts[0]?.description ?? alerts[0]?.title ?? ''
      setActiveAlertCount((previous) => (previous === count ? previous : count))
      setActiveAlertSummary((previous) => (previous === summary ? previous : summary))
    }
    refreshAlerts()
    // Subscribe so an alert opened or retired by a panel updates the status bar
    // at once. The slow poll stays as a fallback for conditions the service
    // cannot observe (a checkpoint written by another surface).
    const unsubscribe = siemService.subscribe(refreshAlerts)
    const interval = setInterval(refreshAlerts, 15000)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [])

  // ── Always-on agent jobs ────────────────────────────────────────────────────
  // A tab closed mid-run leaves the active job marked running; recover() brings
  // it back as paused with a recovery flag, then the FIFO runner drains the
  // queue against the live sheet. Jobs run only while Folio is open — 24/7
  // execution needs the cloud runner documented in docs/AGENT_CLOUD.md.
  useEffect(() => {
    agentJobRunner.recover()
    agentJobRunner.start()
    return () => {
      agentJobRunner.stop()
    }
  }, [])

  // In-app notifications: the bell surfaces what the workbench just did —
  // agent verdicts, exports, community opens — straight from the stores.
  useEffect(() => watchAgentJobsForNotifications(), [])

  // ── NLP intent → store dispatch ─────────────────────────────────────────────

  /*
   * Help, its tutorial runner and the palette open from global shortcuts that
   * work on the first frame. Their chunks are code-split, so fetch them once the
   * shell is idle: the keypress should open the surface, not a spinner.
   */
  useEffect(() => {
    const warm = () => {
      void import('./components/help/HelpCenter')
      void import('./components/help/TutorialRunner')
      void import('./components/workspace/CommandPalette')
      void import('./components/SettingsPanel')
    }
    const idle = (window as Window & { requestIdleCallback?: (callback: () => void) => number }).requestIdleCallback
    if (idle) {
      const handle = idle(warm)
      return () => (window as Window & { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(handle)
    }
    const timer = window.setTimeout(warm, 800)
    return () => window.clearTimeout(timer)
  }, [])

  // ── Keyboard entry points: command palette, demo gallery, agents and help ───
  // Keys come from the shared shortcut registry, so a rebind applies here too.
  const shortcutOverrides = useShortcutStore((s) => s.overrides)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = isEditableTarget(event.target)
      // These surfaces share the viewport, so a shortcut replaces whatever is
      // already open instead of stacking a second modal over it. A surface that
      // toggles itself is left out of the sweep, so its own updater still sees
      // the state the user is in rather than the `false` queued moments before.
      const closeSiblingOverlays = (keep?: 'palette' | 'gallery') => {
        setShowHelp(false)
        if (keep !== 'palette') setShowCommandPalette(false)
        if (keep !== 'gallery') setShowDemoGallery(false)
        setShowLimits(false)
        setShowSettings(false)
      }
      // F1 always works; `?` is a normal character in netlist and property fields.
      if (
        matchesShortcut(event, 'help.open', shortcutOverrides) ||
        (!typing && matchesShortcut(event, 'help.openQuestion', shortcutOverrides))
      ) {
        event.preventDefault()
        closeSiblingOverlays()
        setHelpTab('tutorials')
        setShowHelp(true)
        return
      }
      if (matchesShortcut(event, 'palette.open', shortcutOverrides)) {
        event.preventDefault()
        closeSiblingOverlays('palette')
        setShowCommandPalette((open) => !open)
        return
      }
      if (matchesShortcut(event, 'settings.open', shortcutOverrides)) {
        event.preventDefault()
        closeSiblingOverlays()
        setShowSettings(true)
        return
      }
      if (matchesShortcut(event, 'demos.open', shortcutOverrides)) {
        event.preventDefault()
        closeSiblingOverlays('gallery')
        setShowDemoGallery((open) => !open)
        return
      }
      if (matchesShortcut(event, 'agents.open', shortcutOverrides)) {
        event.preventDefault()
        closeSiblingOverlays()
        useAppStore.getState().setWorkspaceMode('agents')
        return
      }
      if (!typing && matchesShortcut(event, 'voice.toggle', shortcutOverrides)) {
        event.preventDefault()
        voiceController.toggleListening()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [shortcutOverrides])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  /*
   * Both create paths end the same way: the design state is cleared, the new
   * project is put on screen, and — when the launcher's family tile was the one
   * that asked for it — the workspace opens on that family's first tab instead of
   * the default one. One function, so the two paths cannot drift apart.
   */
  const enterNewProject = (
    project: Project,
    uid: string,
    storage: 'local' | 'cloud',
    family?: WorkspaceGroupId,
    workspaceMode?: WorkspaceMode,
  ) => {
    useProjectStore.getState().clearHistory()
    useProjectStore.setState({
      components: [], wires: [], firmwareCode: '', simulationRuns: [], pcbLayout: null,
      simulationResults: [], isSimulating: false, liveFrame: null, isDirty: false,
      mechanicalParts: createDefaultMechanicalParts(),
      domainDesigns: {},
    })
    useAppStore.getState().clearSelection()
    useAppStore.getState().setArmedLibraryItem(null)
    setCurrentSchematic(null)
    useAppStore.getState().setZoom(1)
    useAppStore.getState().setPan({ x: 0, y: 0 })
    // Open by framing the sheet, not at origin with the top clipped; the
    // canvas closes the fit once it mounts.
    useAppStore.getState().requestFit()
    if (family) useAppStore.getState().setWorkspaceMode(FIRST_MODE_BY_GROUP[family])
    else if (workspaceMode) useAppStore.getState().setWorkspaceMode(workspaceMode)
    setCurrentProject(project)
    setShowProjectManager(false)
    setShowCommunity(false)
    useCommunityPreviewStore.getState().clear()
    recordPlatformUsage('project.create', user, offlineMode, { name: project.name, storage, family: family ?? 'default' })
    siemService.logAuditEvent({ user: uid, action: 'project:create', resource: project.id, details: { name: project.name, family } })
  }

  /* A project name a human would keep: the first few words of the brief,
   * capitalised — never the 132-character prompt. */
  const deriveProjectName = (brief: string): string => {
    const first = brief.trim().split(/\s+/).slice(0, 6).join(' ')
    if (!first) return `New Project ${new Date().toLocaleDateString()}`
    const named = `${first.charAt(0).toUpperCase()}${first.slice(1)}`
    return named.length > 58 ? `${named.slice(0, 57)}…` : named
  }

  /* The handshake: after a brief creates a project, the assistant opens with
   * the conversation already started — the user lands on a working session,
   * not an empty workspace and a blinking cursor. */
  const startBriefConversation = (brief: string) => {
    useAppStore.getState().setPendingAssistantPrompt(brief)
    useAppStore.setState({ aiChatOpen: true })
  }

  const handleNewProject = async (family?: WorkspaceGroupId, brief?: string, mode?: WorkspaceMode) => {
    if (!user) return
    const uid = user.id
    setNotice('')
    const name = brief ? deriveProjectName(brief) : `New Project ${new Date().toLocaleDateString()}`
    let projectCount = offlineProjectStore.list().filter((entry) => entry.user_id === uid).length
    if (!offlineMode) {
      // A failed count must not fail the quota check open — the server quota
      // still backstops this, but then the user gets a generic failure with
      // no explanation. Say what actually happened instead.
      const { count, error } = await supabase.from('projects').select('id', { count: 'exact', head: true }).eq('user_id', uid)
      if (error) {
        console.error('Could not verify project quota', error)
        setNotice('Could not check your remaining project allowance — check your connection and try again.')
        return
      }
      projectCount = count ?? 0
    }
    const quota = checkQuotaCapacity('project', resolveQuotaRole(user, offlineMode), {
      projects: projectCount, exportsToday: 0, simulationsToday: 0, storageMb: 0,
    })
    if (!quota.allowed) {
      setNotice(quota.reason ?? 'Your project quota is exhausted.')
      return
    }
    if (offlineMode) {
      try {
        const project = offlineProjectStore.create(uid, name)
        enterNewProject(project, uid, 'local', family, mode)
        if (brief) startBriefConversation(brief)
      } catch (err) {
        console.error('Error creating project (offline):', err)
        setNotice(err instanceof Error ? err.message : 'The project could not be stored on this device.')
      }
      return
    }
    try {
      const { data, error } = await supabase.from('projects').insert({
        user_id: uid,
        name,
        description: brief ?? 'Engineering design project',
      }).select().single()
      if (error) throw error
      await supabase.from('schematics').insert({ project_id: data.id, name: 'Main Schematic', order_index: 0 })
      enterNewProject(data, uid, 'cloud', family, mode)
      if (brief) startBriefConversation(brief)
    } catch (err) {
      console.error('Error creating project:', err)
      setNotice('Could not create the project. Check your connection and try again.')
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

  /*
   * Loading a board over a sheet that has parts on it throws that work away, so
   * it asks first — in the app's own panel, and only when there is something to
   * lose. Every caller is a demo or a sample, so the question always names the
   * thing arriving and the thing leaving.
   */
  const confirmReplace = async (label: string): Promise<boolean> => {
    if (useProjectStore.getState().components.length === 0) return true
    return confirm({
      title: `Replace the current schematic with the ${label}?`,
      detail: `The ${useProjectStore.getState().components.length} parts on the sheet are overwritten by the example. Commit first if you want the current arrangement back.`,
      confirmLabel: 'Load example',
    })
  }

  const ensureProject = async (): Promise<'created' | 'existing' | null> => {
    if (useProjectStore.getState().currentProject) return 'existing'
    await handleNewProject()
    return useProjectStore.getState().currentProject ? 'created' : null
  }

  /*
   * Adopting a community design persists the design under the template's name,
   * never "New Project" — the adoption path owns that, and nothing else renames.
   */

  /*
   * One entry point for loading a demo, so the busy state cannot be forgotten by
   * a caller: the gallery, the palette and a tutorial re-seeding its own demo all
   * route through here and all show the same pause.
   */
  /*
   * Community designs open first, own later.
   *
   * Opening never creates a project: the design is applied to the live stores
   * under an attributed synthetic shell that exists only in memory. The action
   * guard in `useProjectStore` renders every edit inert and routes it to the
   * banner ("make it yours"), which is the only point at which a project row is
   * created — with the design carried over as it stands, never re-applied from
   * scratch. Discarding throws the session away without persisting anything.
   */
  const previewCounter = useRef(0)
  const preview = useCommunityPreviewStore((state) => state.preview)
  const previewActive = preview !== null
  const previewFlash = useCommunityPreviewStore((state) => state.flash)

  const liveSnapshot = () => {
    const live = useProjectStore.getState()
    return {
      components: live.components,
      wires: live.wires,
      firmwareCode: live.firmwareCode,
      simulationRuns: live.simulationRuns,
      pcbLayout: live.pcbLayout,
      mechanicalParts: live.mechanicalParts,
      domainDesigns: live.domainDesigns,
      viewport: useAppStore.getState().viewport,
    }
  }

  /** Payload persist to the same keys `handleSave` writes, so a reload round-trips. */
  const liveSnapshotFromFile = (file: CommunityTemplateFile): Record<string, unknown> => ({
    components: file.design.components,
    wires: file.design.wires,
    firmwareCode: file.design.firmwareCode || '',
    simulationRuns: file.design.simulationRuns ?? [],
    pcbLayout: file.design.pcbLayout ?? null,
    mechanicalParts: file.design.mechanicalParts ?? [],
    domainDesigns: file.design.domainDesigns ?? {},
    viewport: useAppStore.getState().viewport,
  })

  const resetWorkingDesign = () => {
    useProjectStore.setState({
      components: [], wires: [], firmwareCode: '', simulationRuns: [], pcbLayout: null,
      simulationResults: [], isSimulating: false, liveFrame: null, isDirty: false,
      currentSchematic: null,
      // A fresh document starts with the same seed parts the store boots
      // with — not with the previous document's assembly — and no stale
      // domain bags riding into the save payload.
      mechanicalParts: createDefaultMechanicalParts(),
      domainDesigns: {},
    })
    // History is per-document: without this, Ctrl+Z after a swap pops a
    // snapshot of the document the user just left.
    useProjectStore.getState().clearHistory()
    // Selection must not name ids that no longer exist on the sheet.
    useAppStore.getState().clearSelection()
    useAppStore.getState().setArmedLibraryItem(null)
  }

  const syntheticPreviewShell = (template: CommunityTemplate): Project => {
    previewCounter.current += 1
    const now = new Date().toISOString()
    return {
      id: `preview-${Date.now().toString(36)}-${previewCounter.current}`,
      user_id: user?.id ?? 'guest',
      name: template.name,
      description: `Community design by ${template.authorName}`,
      created_at: now,
      updated_at: now,
    }
  }

  /* Open a template as an attributed, read-only design. Throws with a readable
   * message when it cannot be opened; the caller owns the feedback surface. */
  const beginCommunityPreview = useCallback(async (template: CommunityTemplate) => {
    let file: CommunityTemplateFile | null = null
    let demoId: string | null = null
    if (template.source === 'curated') {
      demoId = CURATED_DEMO_BY_TEMPLATE_ID[template.id] ?? null
      if (!demoId) throw new Error('This seed has no openable design.')
    } else {
      const result = await fetchCommunityFork(template.id)
      if (!result.ok || !result.canvasData) {
        throw new Error(result.error ?? 'This template could not be read. You may be offline, or the host refused the payload.')
      }
      file = result.canvasData
    }

    // Snapshot first — a failed open must hand the user their design back.
    const priorDesign = liveSnapshot()
    const priorProject = useProjectStore.getState().currentProject

    // Swap in the attributed synthetic shell — nothing is persisted.
    resetWorkingDesign()
    useProjectStore.setState({ currentProject: syntheticPreviewShell(template) })

    if (file) {
      if (!applyTemplateFile(file)) {
        useProjectStore.setState({ ...priorDesign, currentProject: priorProject })
        throw new Error('This template is malformed and was not applied.')
      }
    } else {
      const scenario = DEMO_SCENARIOS.find((entry) => entry.id === demoId)
      if (!scenario) {
        useProjectStore.setState({ ...priorDesign, currentProject: priorProject })
        throw new Error('This seed has no openable design.')
      }
      loadDemoScenario(scenario)
    }
    useAppStore.getState().setWorkspaceMode(template.workspaceMode)
    useCommunityPreviewStore.getState().begin({
      name: template.name,
      authorName: template.authorName,
      license: template.license,
      templateId: template.id,
      source: template.source,
      demoId: demoId ?? undefined,
      workspaceMode: template.workspaceMode,
      origin: currentRoute().isCommunity ? 'community' : 'launcher',
    })
    notifyNotification({
      kind: 'community',
      title: `Opened ${template.name} for preview`,
      detail: 'Nothing was saved to your projects. Use Make it mine when you want to keep it.',
    })
    setShowProjectManager(false)
    setShowCommunity(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resetWorkingDesign is a closure over stores only
  }, [user])

  const handleOpenTemplate = useCallback(async (template: CommunityTemplate) => {
    await beginCommunityPreview(template)
  }, [beginCommunityPreview])

  /* Persist a design that already lives in the stores as a real project.
   * Shared by adopting a preview and importing a hand-carried file. */
  const persistAdoptedDesign = useCallback(async (
    name: string,
    authorName: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> => {
    if (offlineMode) {
      try {
        const created = offlineProjectStore.create(user?.id ?? 'offline-local', name)
        offlineProjectStore.saveCanvasWithStatus(created.id, payload)
        useProjectStore.setState({ currentProject: created })
        return true
      } catch (err) {
        console.error('Could not store the project on this device', err)
        setNotice(err instanceof Error ? err.message : 'Could not make it yours — this device cannot store more projects.')
        return false
      }
    }
    try {
      const { data, error } = await supabase.from('projects').insert({
        user_id: user?.id,
        name,
        description: `Community design by ${authorName}`,
      }).select().single()
      if (error) throw error
      const { error: schematicError } = await supabase.from('schematics').insert({
        project_id: data.id, name: 'Main Schematic', order_index: 0, canvas_data: payload,
      })
      if (schematicError) throw schematicError
      useProjectStore.setState({ currentProject: data as unknown as Project })
      return true
    } catch (err) {
      console.error('Could not create the project', err)
      setNotice('Could not make it yours — check your connection and try again.')
      return false
    }
  }, [offlineMode, user])

  /* The one moment a preview becomes a project. */
  const adoptPreview = useCallback(async () => {
    const current = useCommunityPreviewStore.getState().preview
    if (!current || !user) return
    const payload = liveSnapshot()
    const ok = await persistAdoptedDesign(current.name, current.authorName, payload)
    if (!ok) return
    useProjectStore.getState().markClean()
    recordPlatformUsage('template.fork', user, offlineMode, { template: current.templateId, source: current.source })
    useCommunityPreviewStore.getState().clear()
    setNotice(`“${current.name}” is yours — edit away.`)
  }, [offlineMode, persistAdoptedDesign, user])

  /* Import is ownership from the first click — a file in hand is the user's.
   * The current design is snapshotted first; a malformed file hands it back
   * instead of leaving an empty sheet and a success toast. */
  const adoptImportedFile = useCallback(async (
    file: CommunityTemplateFile,
    template: CommunityTemplate,
  ): Promise<boolean> => {
    const payload = liveSnapshotFromFile(file)
    const priorDesign = liveSnapshot()
    const priorProject = useProjectStore.getState().currentProject
    resetWorkingDesign()
    if (!applyTemplateFile(file)) {
      useProjectStore.setState({ ...priorDesign, currentProject: priorProject })
      setNotice('That file is not a usable Folio community template — your design was left untouched.')
      return false
    }
    const ok = await persistAdoptedDesign(template.name, template.authorName, payload)
    if (!ok) {
      // The design is applied but not persisted: keep it on screen and say so
      // honestly instead of claiming ownership that never happened.
      setNotice('The design was opened but could not be saved as a project — check your connection.')
      return false
    }
    if (user) {
      recordPlatformUsage('template.fork', user, offlineMode, { template: template.id, source: 'import' })
    }
    setShowProjectManager(false)
    setShowCommunity(false)
    setNotice(`“${template.name}” imported as your project.`)
    return true
  }, [offlineMode, persistAdoptedDesign, user])

  const discardCommunityPreview = useCallback(() => {
    const origin = useCommunityPreviewStore.getState().preview?.origin
    useCommunityPreviewStore.getState().clear()
    resetWorkingDesign()
    useProjectStore.setState({ currentProject: null })
    if (origin === 'community') {
      setShowCommunity(true)
      setShowProjectManager(false)
      navigateTo(COMMUNITY_ROUTE)
      return
    }
    setShowProjectManager(true)
    setShowCommunity(false)
    navigateTo(PROJECTS_ROUTE)
  }, [])

  useEffect(() => {
    // Auto-clear the refusal flash; the banner re-shows it on the next refused edit.
    if (!previewFlash) return
    const id = window.setTimeout(() => useCommunityPreviewStore.getState().clearFlash(), 4500)
    return () => window.clearTimeout(id)
  }, [previewFlash])
  
  const runDemoLoad = async (scenario: DemoScenario): Promise<void> => {
    setDemoBusy(scenario.title)
    try {
      await yieldToPaint()
      loadDemoScenario(scenario)
    } finally {
      setDemoBusy(null)
    }
  }

  // Gallery / palette entry point: a demo must be savable, and a board demo
  // must never silently overwrite an unsaved schematic.
  const openDemoScenario = async (scenario: DemoScenario): Promise<boolean> => {
    if (isBoardDemoLoad(scenario.load) && !(await confirmReplace(scenario.title))) return false
    const canOpen = await ensureProject()
    if (!canOpen) return false
    await runDemoLoad(scenario)
    /*
     * A demo opened on a fresh project inherits the demo's name — the header
     * stops saying "New Project <date>" beside a half-wave rectifier, and
     * exports land under a name the designer recognises. The auto-name is the
     * marker: a project the user typed deliberately is never renamed.
     */
    const opened = useProjectStore.getState().currentProject
    if (opened && /^New Project\s/.test(opened.name)) {
      try {
        await renameCurrentProject(scenario.title)
      } catch {
        // A demo that could not be renamed is still the demo.
      }
    }
    recordPlatformUsage('demo.load', user, offlineMode, { scenario: scenario.title })
    return true
  }

  const openHelp = (tab: HelpTab = 'tutorials') => {
    // One help surface at a time: opening the centre parks an active tutorial
    // (its step is already persisted) instead of stacking two panels.
    setActiveTutorial(null)
    setHelpTab(tab)
    setShowHelp(true)
  }

  /*
   * A tutorial starts from its own demo, so the first step is never a blank
   * sheet: the same confirmation that protects a gallery demo protects it.
   * Progress is written by the runner, not here.
   */
  const startTutorial = async (tutorial: Tutorial) => {
    const scenario = DEMO_SCENARIOS.find((entry) => entry.id === tutorial.demoId)
    if (!scenario) {
      setNotice(`This tutorial starts from the “${tutorial.demoId}” demo, which isn't available here.`)
      return
    }
    if (!(await openDemoScenario(scenario))) return
    setShowHelp(false)
    setActiveTutorial(tutorial)
  }

  const restartTutorialDemo = (tutorial: Tutorial) => {
    const scenario = DEMO_SCENARIOS.find((entry) => entry.id === tutorial.demoId)
    if (scenario) void runDemoLoad(scenario)
  }

  const openWorkspaceFromHelp = (mode: WorkspaceMode) => {
    useAppStore.getState().setWorkspaceMode(mode)
    setShowHelp(false)
  }

  const handleLoadSampleCircuit = async () => {
    if (!(await confirmReplace('5 V divider example'))) return
    if (!(await ensureProject())) return

    const resistorDefinition = standardComponents.find(component => component.name === 'Resistor')
    const sourceDefinition = standardComponents.find(component => component.name === 'DC Voltage Source')
    if (!resistorDefinition || !sourceDefinition) {
      setNotice('The standard library is missing a sample-circuit component, so the example was not built.')
      return
    }

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

    useProjectStore.getState().clearHistory()
    useProjectStore.setState({ components: [source, upperResistor, lowerResistor], wires: sampleWires, isDirty: true })
    useAppStore.setState({ simulationPanelOpen: true })
    useAppStore.getState().setWorkspaceMode('schematic')
  }

  const handleLoadDemoBoard = async () => {
    if (!(await confirmReplace('tested half-wave rectifier board'))) return
    if (!(await ensureProject())) return
    loadBoardDemo('Half-wave rectifier')
    useAppStore.setState({ simulationPanelOpen: true })
    useAppStore.getState().setWorkspaceMode('schematic')
  }

  const handleSelectProject = async (project: Project) => {
    useCommunityPreviewStore.getState().clear()
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
      useProjectStore.getState().clearHistory()
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
      applyStoredMode(savedCanvas?.viewport)
      const viewport = savedCanvas?.viewport as { zoom?: unknown; pan?: unknown } | undefined
      const hasSavedView =
        (viewport && typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) ||
        (viewport?.pan && typeof viewport.pan === 'object')
      if (hasSavedView) {
        if (viewport && typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) {
          useAppStore.getState().setZoom(viewport.zoom)
        }
        if (viewport?.pan && typeof viewport.pan === 'object') {
          const pan = viewport.pan as { x?: unknown; y?: unknown }
          if (typeof pan.x === 'number' && Number.isFinite(pan.x) && typeof pan.y === 'number' && Number.isFinite(pan.y)) {
            useAppStore.getState().setPan({ x: pan.x, y: pan.y })
          }
        }
      } else {
        // A design with nothing saved arrives framed, not at origin.
        useAppStore.getState().requestFit()
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
   * The library owns the project's name, but the shell header and every export
   * filename read it off the open project, so a rename has to reach the store as
   * well or the workspace keeps titling files with the name it just discarded.
   */
  const handleProjectRenamed = (renamed: Project) => {
    if (currentProject?.id === renamed.id) setCurrentProject(renamed)
    if (user) {
      siemService.logAuditEvent({ user: user.id, action: 'project:rename', resource: renamed.id, details: { name: renamed.name } })
    }
  }

  /*
   * Renaming from the header writes the same row the launcher cards write — the
   * local store offline, the projects table when the workspace is cloud-owned —
   * because a title that only moved in the shell would be overwritten by the next
   * save and would export files under a name nothing else knows.
   *
   * It rejects rather than returning a flag: the field keeps the typed text on
   * screen and shows the reason under it, so a failed rename never looks saved.
   */
  const renameCurrentProject = async (nextName: string) => {
    if (previewActive) throw new Error('Make it yours before renaming.')
    // The store is the source of truth — the closure's `currentProject` can be
    // stale here, e.g. mid-demo-load when this runs right after creation.
    const project = useProjectStore.getState().currentProject
    if (!project) throw new Error('No project is open to rename.')
    const trimmed = nextName.trim()
    if (!trimmed) throw new Error('A project needs a name.')

    if (offlineMode) {
      const updated = offlineProjectStore.rename(project.id, trimmed)
      if (!updated) throw new Error('This project is no longer in the workspace, so the name was not saved.')
      handleProjectRenamed(updated)
      return
    }

    const updatedAt = new Date().toISOString()
    const { error } = await supabase
      .from('projects')
      .update({ name: trimmed, updated_at: updatedAt })
      .eq('id', project.id)
    if (error) throw new Error(`Could not rename the project: ${error.message}`)
    handleProjectRenamed({ ...project, name: trimmed, updated_at: updatedAt })
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

  const openDemoScenarioRef = useRef<(scenario: DemoScenario) => void>(() => {})
  useEffect(() => {
    openDemoScenarioRef.current = (scenario) => { void openDemoScenario(scenario) }
  })

  useEffect(() => {
    const applyLocation = () => {
      const route = currentRoute()
      if (route.isCommunity) {
        setShowCommunity(true)
        setShowProjectManager(false)
        return
      }
      setShowCommunity(false)
      // `/app/demos/:demoId` — the marketing CTA and a deep link: open the
      // gallery demo instead of a blank workspace.
      if (route.demoId) {
        const scenario = DEMO_SCENARIOS.find((entry) => entry.id === route.demoId)
        if (!scenario) {
          // An unknown demo id is the user landing on an address that does not
          // exist — name it plainly instead of bouncing them to the launcher.
          setNotFoundPath(window.location.pathname)
          return
        }
        setShowProjectManager(false)
        setNotFoundPath(null)
        openDemoScenarioRef.current(scenario)
        return
      }
      if (route.isProjectList) {
        setShowProjectManager(true)
        return
      }
      if (!route.mode) {
        const path = window.location.pathname
        // `/app/*` routes that resolve to nothing are the visitor landing on a
        // URL that does not exist — name the failure plainly instead of
        // bouncing to the launcher. Anything outside /app is not a document
        // either — that one keeps the old redirect to the launcher.
        if (path.startsWith('/app/') || path === '/app') {
          setNotFoundPath(path)
          setShowProjectManager(false)
          return
        }
        navigateTo(PROJECTS_ROUTE, { replace: true })
        setShowProjectManager(true)
        return
      }
      setNotFoundPath(null)
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
    // The community page (and a read-only community preview holding a synthetic
    // shell) are their own URLs — never rewrite them back to a workspace.
    if (!routeProjectId || showProjectManager || showCommunity || previewActive) return
    writeWorkspaceRoute(workspaceMode, routeProjectId)
  }, [routeProjectId, workspaceMode, showProjectManager, showCommunity, previewActive])

  const handleSave = useCallback(async (data: Record<string, unknown>) => {
    if (previewActive) {
      setNotice('This is someone else’s design — make it yours before saving.')
      return
    }
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
      try {
        offlineProjectStore.saveCanvasWithStatus(currentProject.id, payload)
      } catch (err) {
        // Out of quota or storage blocked: keep the document dirty and say so.
        console.error('Error saving (offline):', err)
        setNotice(err instanceof Error ? err.message : 'The project could not be stored on this device.')
        return
      }
      markClean()
      return
    }
    try {
      const { data: schematic, error: selectError } = await supabase.from('schematics').select('id')
        .eq('project_id', currentProject.id).order('order_index', { ascending: true }).limit(1).maybeSingle()
      if (selectError) throw selectError
      if (schematic) {
        const { error: updateError } = await supabase.from('schematics')
          .update({ canvas_data: payload, updated_at: new Date().toISOString() }).eq('id', schematic.id)
        if (updateError) throw updateError
        const { error: projectError } = await supabase.from('projects')
          .update({ updated_at: new Date().toISOString() }).eq('id', currentProject.id)
        if (projectError) throw projectError
        markClean()
        if (user) siemService.logAuditEvent({ user: user.id, action: 'project:save', resource: currentProject.id, details: {} })
        return
      }
      // No schematic row for this project (legacy data or a row removed by
      // hand): create it instead of pretending the save happened.
      const { error: insertError } = await supabase.from('schematics').insert({
        project_id: currentProject.id, name: 'Main Schematic', order_index: 0,
        canvas_data: payload, updated_at: new Date().toISOString(),
      })
      if (insertError) throw insertError
      markClean()
      if (user) siemService.logAuditEvent({ user: user.id, action: 'project:save', resource: currentProject.id, details: {} })
    } catch (err) {
      console.error('Error saving:', err)
      setNotice('The design could not be saved — check your connection and try again. It stays marked as unsaved.')
    }
  }, [currentProject, offlineMode, markClean, user, previewActive])

  const getCheckpointData = () => buildCheckpointPayload()

  /*
   * Auto-save, on the interval from Settings. Both halves of the preference are
   * honoured: the switch and the period, so the timer is rebuilt when either
   * moves. It fires only while the document is actually dirty — a "save" that
   * writes an unchanged design is noise that makes people distrust the timer.
   */
  const autoSave = settings.autoSave
  const autoSaveInterval = settings.autoSaveInterval
  useEffect(() => {
    if (!autoSave || !currentProject) return
    const timer = window.setInterval(() => {
      if (!useProjectStore.getState().isDirty) return
      void handleSave(buildCheckpointPayload())
    }, autoSaveInterval)
    return () => window.clearInterval(timer)
  }, [autoSave, autoSaveInterval, currentProject, handleSave])

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
    if (previewActive) {
      setNotice('This is someone else’s design — make it yours before committing.')
      return
    }
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

  /*
   * Restoring a commit rewrites the sheet, so the panel says what happens to the
   * work that is currently unsaved: it is not lost, it goes into a backup taken
   * first. The question is asked before the backup so declining changes nothing.
   */
  const handleVcsCheckout = async (commit: VcsCommit) => {
    if (!currentProject) return
    const accepted = await confirm({
      title: `Restore the commit “${commit.message}”?`,
      detail:
        'The sheet, the board and the code go back to what that commit held. Anything you have not committed stays available: a backup of the current state is taken first and appears in the restore list.',
      confirmLabel: 'Restore commit',
    })
    if (!accepted) return
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
    useProjectStore.getState().clearHistory()
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
    applyStoredMode(snapshot.meta?.viewport)
    const viewportMeta = snapshot.meta?.viewport
    const hasSavedView =
      viewportMeta &&
      typeof viewportMeta === 'object' &&
      (typeof (viewportMeta as { zoom?: unknown }).zoom === 'number' ||
        typeof (viewportMeta as { pan?: unknown }).pan === 'object')
    if (hasSavedView) {
      const viewport = viewportMeta as { zoom?: unknown; pan?: unknown }
      if (typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) {
        useAppStore.getState().setZoom(viewport.zoom)
      }
      const pan = viewport.pan as { x?: unknown; y?: unknown } | undefined
      if (pan && typeof pan.x === 'number' && Number.isFinite(pan.x) && typeof pan.y === 'number' && Number.isFinite(pan.y)) {
        useAppStore.getState().setPan({ x: pan.x, y: pan.y })
      }
    } else {
      useAppStore.getState().requestFit()
    }
    // Keep the export/import canvas in step with the restored design; otherwise
    // netlist export would still describe the pre-restore sheet.
    const restoredData = getCheckpointData()
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
    if (previewActive) {
      setNotice('This is someone else’s design — make it yours before checkpointing.')
      return
    }
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
    if (!currentProject) return
    const accepted = await confirm({
      title: `Restore the backup “${checkpoint.label}”?`,
      detail:
        'The sheet goes back to the state saved in that backup. The current state is kept as a new backup first, so this is reversible from the same list.',
      confirmLabel: 'Restore backup',
    })
    if (!accepted) return

    const restored = backupService.restore(checkpoint.id, currentProject.id)
    if (!restored || !Array.isArray(restored.components) || !Array.isArray(restored.wires)) {
      setVcsStatus('This backup is invalid and could not be restored.')
      return
    }

    backupService.createBackup(currentProject.id, getCheckpointData(), 'Before restore')
    useProjectStore.getState().clearHistory()
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
    applyStoredMode(restored.viewport)
    const viewport = restored.viewport as { zoom?: unknown; pan?: unknown } | undefined
    const hasSavedView =
      (viewport && typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) ||
      (viewport?.pan && typeof viewport.pan === 'object')
    if (hasSavedView) {
      if (viewport && typeof viewport.zoom === 'number' && Number.isFinite(viewport.zoom)) {
        useAppStore.getState().setZoom(viewport.zoom)
      }
      if (viewport?.pan && typeof viewport.pan === 'object') {
        const pan = viewport.pan as { x?: unknown; y?: unknown }
        if (typeof pan.x === 'number' && Number.isFinite(pan.x) && typeof pan.y === 'number' && Number.isFinite(pan.y)) {
          useAppStore.getState().setPan({ x: pan.x, y: pan.y })
        }
      }
    } else {
      useAppStore.getState().requestFit()
    }

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
    const decision = checkQuotaCapacity('export', resolveQuotaRole(user, offlineMode), {
      projects: 0,
      exportsToday: countUsage('export.run', startOfToday(), user.id),
      simulationsToday: 0,
      storageMb: 0,
    })
    return decision.allowed ? null : decision.reason ?? 'Your export quota is exhausted.'
  }

  const finishExport = (format: string) => {
    recordPlatformUsage('export.run', user, offlineMode, { format })
    const labels: Record<string, string> = {
      png: 'Image',
      netlist: 'Netlist',
      json: 'JSON',
      bom: 'BOM',
      gerber: 'Gerber',
      'drawing-svg': 'CAD drawing',
      encrypted: 'Encrypted JSON',
    }
    notifyNotification({
      kind: 'export',
      title: `${labels[format] ?? format} export ready`,
      detail: currentProject ? `${currentProject.name} — downloaded to this device.` : undefined,
    })
    triggerHaptic('success')
    setShowExportMenu(false)
  }

  const handleExportImage = () => {
    // The sheet canvas carries this hook attribute; a stray canvas elsewhere
    // in the document (3D view, sketch overlay) is never captured by accident.
    const canvas = document.querySelector<HTMLCanvasElement>('[data-folio-sheet="true"] canvas')
    if (!canvas) {
      setNotice('Nothing to capture yet — the sheet has not been rendered.')
      return
    }
    if (!currentProject) return
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    const dataUrl = exportToImage(canvas, { resolution: settings.imageExportScale })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${currentProject.name}.png`
    a.click()
    finishExport('png')
  }

  const handleExportNetlist = () => {
    if (!currentProject) return
    // Read the live sheet, not the saved-canvas snapshot: every other export
    // does, and a netlist taken between an edit and the next save would
    // describe a different circuit than the one on screen.
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    const live = useProjectStore.getState()
    const netlist = exportToNetlist(
      live.components.map((c) => ({ ...c, position: { x: c.x, y: c.y }, scale: 1 } as unknown as PlacedComponent)),
      live.wires.map((w) => ({ ...w, points: w.points } as unknown as Wire)),
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
      { units: settings.gerberUnits, traceWidth: settings.boardTraceWidthMm },
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
      paperSize: settings.drawingPaperSize,
      notes: ['Crossings without a junction dot are not connected.'],
    })
    downloadFile(svg, `${currentProject.name}_drawing.svg`, 'image/svg+xml')
    finishExport('drawing-svg')
  }

  const handleSignOut = async () => {
    if (offlineMode) {
      // A standalone workspace has no session to end; signing out returns to the project list.
      setCurrentProject(null)
      setCurrentSchematic(null)
      openProjectManager()
      return
    }
    if (user) siemService.logAuditEvent({ user: user.id, action: 'auth:signout', resource: 'session', details: {} })
    await supabase.auth.signOut()
    setCurrentProject(null)
    setCurrentSchematic(null)
    navigateTo(PROJECTS_ROUTE, { replace: true })
  }

  const themeIcon = isDarkTheme ? <Sun /> : <Moon />
  const themeToggleLabel = isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'
  /* The palette chord is branded per platform rather than always saying Ctrl:
   * a Mac user reading a Windows keycap learns the wrong gesture. */
  const commandKey = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform) ? '⌘' : 'Ctrl'

  const toggleVoice = () => {
    voiceController.toggleListening()
  }

  const closeVoiceBar = () => {
    voiceController.close()
  }

  const backToProjects = () => {
    setCurrentProject(null)
    setCurrentSchematic(null)
    openProjectManager()
  }

  /* Everything the bar no longer carries, as words instead of icons. Grouped so
   * the overflow reads as a menu rather than a list of nine unrelated verbs, and
   * each group is named for what its rows have in common. */
  const moreMenuSections = [
    {
      group: 'Scribe',
      items: [
        { label: voiceListening ? 'Stop voice control' : 'Start voice control', icon: voiceListening ? MicOff : Mic, action: toggleVoice },
      ],
    },
    {
      group: 'Workspaces',
      items: [
        { label: 'Simulation workspace', icon: BarChart3, action: () => useAppStore.getState().setWorkspaceMode('simulation') },
        { label: activeAlertCount > 0 ? `Activity log (${activeAlertCount} active alert${activeAlertCount === 1 ? '' : 's'})` : 'Activity log', icon: ShieldAlert, action: () => useAppStore.getState().setWorkspaceMode('siem') },
      ],
    },
    {
      group: 'Project',
      items: [
        { label: 'Collaboration', icon: Users, action: () => setShowCollaborativePanel(true) },
        { label: 'Plugins', icon: Package, action: openPluginPanel },
        { label: 'Publish to community', icon: Send, action: () => setPublishOpen(true) },
        { label: 'Back to Projects', icon: ArrowLeft, action: backToProjects },
      ],
    },
    ...(offlineMode ? [] : [{ group: 'Account', items: [{ label: 'Sign out', icon: LogOut, action: () => void handleSignOut() }] }]),
  ]

  // ── Voice → shell actions ───────────────────────────────────────────────────
  // Save and export live in this component; the voice controller asks here
  // instead of duplicating them. Results report what really happened. The
  // effect deliberately has no dependency array: the hooks are reassigned on
  // every render so they always close over the freshest handlers.
  useEffect(() => {
    const saveDesign = async (): Promise<{ applied: boolean; detail: string }> => {
      if (!currentProject) return { applied: false, detail: 'No project is open, so there was nothing to save.' }
      await handleSave(getCheckpointData())
      const stillDirty = useProjectStore.getState().isDirty
      return stillDirty
        ? { applied: true, detail: 'Save requested, but the project still shows unsaved changes — check the save.' }
        : { applied: true, detail: 'Saved the project.' }
    }

    const exportDesign = async (format: string): Promise<{ applied: boolean; detail: string }> => {
      const handlers: Record<string, (() => void) | undefined> = {
        json: handleExportJSON,
        netlist: handleExportNetlist,
        bom: handleExportBOM,
        gerber: handleExportGerber,
        png: handleExportImage,
        svg: handleExportDrawing,
        drawing: handleExportDrawing,
      }
      const run = handlers[format]
      if (!run) return { applied: false, detail: `Voice cannot export as ${format}; use the Export menu instead.` }
      if (!currentProject) return { applied: false, detail: 'No project is open to export.' }
      const quotaError = exportQuotaError()
      if (quotaError) return { applied: false, detail: quotaError }
      if (format === 'png' && !document.querySelector('[data-folio-sheet="true"] canvas')) {
        return { applied: false, detail: 'There is no canvas to capture, so no image was exported.' }
      }
      run()
      return { applied: true, detail: `Started the ${format} export — check your downloads.` }
    }

    nlpService.registerActionHooks({ saveDesign, exportDesign })
  })

  const handleExportEncrypted = async () => {
    if (!currentProject) return
    const quotaError = exportQuotaError()
    if (quotaError) { setNotice(quotaError); setShowExportMenu(false); return }
    /*
     * The passphrase used to come out of `window.prompt()`, which shows a secret
     * in plain text in a box that belongs to the browser. It is asked for in the
     * app now: masked field, the rule stated up front, and a decline that
     * exports nothing.
     */
    const passphrase = await askSecret({
      title: 'Passphrase for the encrypted export',
      detail:
        'The design is sealed with this passphrase before it is downloaded. Folio never stores it and cannot recover it — lose it and the file stays sealed.',
      fieldLabel: 'Passphrase',
      confirmLabel: 'Seal and export',
      hint: 'At least 8 characters. Type it somewhere nobody is watching the screen.',
      minLength: 8,
    })
    if (passphrase === null) return
    setShowExportMenu(false)
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
      notifyNotification({
        kind: 'export',
        title: 'Encrypted JSON export ready',
        detail: `${currentProject.name} — encrypted with ${encrypted.algorithm}, downloaded to this device.`,
      })
      triggerHaptic('success')
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

  /*
   * Shared overlay stack for the workbench and the project launcher. Both
   * screens advertise the same global shortcuts, so both must mount the
   * surfaces those shortcuts open.
   */
  const overlayStack = (
    <Suspense fallback={panelFallback}>
      {publishOpen && (
        <PublishDesignDialog open onClose={() => setPublishOpen(false)} />
      )}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} onRestartOnboarding={restartOnboarding} />}
      {showDemoGallery && (
        <DemoGallery
          open
          onClose={() => setShowDemoGallery(false)}
          onOpenScenario={openDemoScenario}
          onStartTutorial={(tutorial) => { void startTutorial(tutorial) }}
        />
      )}
      {showCommandPalette && (
        <CommandPalette
          open
          onClose={() => setShowCommandPalette(false)}
          onSave={() => { void handleSave(getCheckpointData()) }}
          onOpenDemos={() => setShowDemoGallery(true)}
          onOpenLimits={openLimitsRegister}
          onOpenHelp={() => openHelp('tutorials')}
          onOpenShortcuts={() => {
            setShowCommandPalette(false)
            setShowDemoGallery(false)
            setShowLimits(false)
            openHelp('shortcuts')
          }}
          onToggleTheme={toggleTheme}
          onToggleDesignHealth={() => {
            const health = useDesignHealthStore.getState()
            if (useAppStore.getState().workspaceMode !== 'schematic') {
              // Findings are about the sheet, so land where they can be acted on.
              useAppStore.getState().setWorkspaceMode('schematic')
              health.setPanelOpen(true)
            } else {
              health.setPanelOpen(!health.panelOpen)
            }
          }}
          onOpenSettings={() => setShowSettings(true)}
          onOpenScenario={openDemoScenario}
        />
      )}
      {showLimits && (
        <LimitsDialog open onClose={() => setShowLimits(false)} currentMode={workspaceMode} />
      )}
      {showHelp && (
        <HelpCenter
          open
          initialTab={helpTab}
          currentMode={workspaceMode}
          onClose={() => setShowHelp(false)}
          onOpenWorkspace={openWorkspaceFromHelp}
          onStartTutorial={(tutorial) => { void startTutorial(tutorial) }}
          onOpenDemos={() => { setShowHelp(false); setShowDemoGallery(true) }}
          onOpenLimits={() => { setShowHelp(false); openLimitsRegister() }}
          onRestartOnboarding={() => { setShowHelp(false); restartOnboarding() }}
        />
      )}
      {activeTutorial && (
        <TutorialRunner
          key={activeTutorial.id}
          tutorial={activeTutorial}
          onClose={() => setActiveTutorial(null)}
          onRestartDemo={() => restartTutorialDemo(activeTutorial)}
          onOpenHelp={() => openHelp('tutorials')}
        />
      )}

      {/* Shell-level answer box for the three irreversible actions above. The
          launcher has its own instance for the one it asks (a delete). */}
      <ConfirmDialog spec={confirmSpec} onResolve={resolveConfirm} />
      <SecretDialog request={secretRequest} onResolve={resolveSecret} />
    </Suspense>
  )

  /*
   * Outside the stack, because the stack sits inside a `Suspense`: a lazy chunk
   * that mounts after the click would hold the fallback and swallow the busy
   * state — the one moment the user needs to be told the tab is working.
   */
  const demoBusyOverlay = demoBusy ? <DemoLoadingOverlay title={demoBusy} /> : null

  /* Unknown routes render the 404 surface before any identity gate — a bad URL
     should not bounce a visitor through a sign-in they don't need to see. */
  if (notFoundPath !== null) {
    return <NotFound path={notFoundPath} />
  }

  /*
   * The community browse surface requires identity like everything else in the
   * workbench: no local profile (standalone) or cloud session (deployed), no CAD.
   * Cloud deployments therefore render the hosted auth gate here too.
   */
  if (!user) return <AuthForm onAuthSuccess={() => {}} />

  /* The standalone deployment's front door: no cloud account exists, so
   * designing starts only after a local profile is claimed. Cloud deployments
   * are already gated above by the real auth flow. */
  if (offlineMode && !localProfile) return <LocalProfileGate />

  if (showCommunity) {
    return (
      <>
        <CommunityPage
          onBack={() => {
            navigateTo(PROJECTS_ROUTE)
            setShowCommunity(false)
            setShowProjectManager(true)
          }}
          onOpenTemplate={handleOpenTemplate}
          onImportFile={adoptImportedFile}
        />
        {overlayStack}
        {demoBusyOverlay}
      </>
    )
  }

  if (!currentProject || showProjectManager) {
    return (
      <div className="launcher-shell flex min-h-screen flex-col bg-background">
        <AuroraField />
        {/* Chrome is full-bleed: the lockup sits on the window's left edge, where
            every app bar puts a brand, and the actions on the right edge. The
            launcher's *content* below keeps its own centred column — a bar that
            marched to the same inner gutter as the cards read as a centred block
            floating in the header instead of a header. */}
        <header className="app-chrome app-chrome-divider flex-shrink-0" data-tour="app-header">
          <div className="flex w-full items-center justify-between gap-3 px-4 py-3 sm:px-5">
            <FolioLogo
              markClassName="h-8 w-8 flex-shrink-0 text-primary"
              wordmarkClassName="h-[15px] w-auto text-surface-foreground"
              showTagline
            />
            <div className="flex flex-shrink-0 items-center gap-2">
              <HoverHelp topicId="header.theme" placement="bottom">
                <Button variant="ghost" size="icon" onClick={toggleTheme} aria-label={themeToggleLabel}>{themeIcon}</Button>
              </HoverHelp>
              <HoverHelp topicId="header.settings" placement="bottom">
                <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} aria-label="Settings"><Settings className="h-4 w-4" /></Button>
              </HoverHelp>
              <HoverHelp topicId="header.console" placement="bottom">
                <a
                  href="/console"
                  aria-label="Open your account console"
                  className="flex h-9 w-9 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CircleUserRound className="h-5 w-5" aria-hidden="true" />
                </a>
              </HoverHelp>
              {!offlineMode && (
                <HoverHelp topicId="header.sign-out" placement="bottom">
                  <Button variant="ghost" onClick={handleSignOut} className="flex items-center gap-2">
                    <LogOut size={16} />Sign Out
                  </Button>
                </HoverHelp>
              )}
            </div>
          </div>
        </header>
        <NoticeBanner message={notice} onDismiss={() => setNotice('')} />
        <ProjectManager
          onSelectProject={handleSelectProject}
          onNewProject={handleNewProject}
          onBriefSubmit={(brief, scaffold) => {
            void handleNewProject(undefined, brief, scaffold === 'embedded' ? 'embedded' : 'schematic')
          }}
          onProjectRenamed={handleProjectRenamed}
          offlineMode={offlineMode}
          onOpenDemos={() => setShowDemoGallery(true)}
          onOpenDemo={(scenario) => { void openDemoScenario(scenario) }}
        />
        {/* Community designs belong to the community page, not the project
            landing. One link, not a grid users didn't ask for. */}
        <div className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
          <button
            type="button"
            onClick={() => {
              navigateTo(COMMUNITY_ROUTE)
              setShowCommunity(true)
            }}
            className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-border/70 bg-card/50 px-4 py-3 text-left transition-colors hover:border-primary/40 hover:bg-accent"
            aria-label="Open the community designs page"
          >
            <span className="min-w-0">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Community</span>
              <span className="mt-0.5 block text-sm font-semibold text-foreground">Browse community designs →</span>
            </span>
            <span className="flex-shrink-0 text-[11px] text-muted-foreground">Open, inspect and make yours</span>
          </button>
        </div>
        {overlayStack}
        {demoBusyOverlay}
      </div>
    )
  }

  // ── Main IDE layout ───────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      {/* Scenery, not chrome: the field follows the open workspace family and
          sits under every bar in the shell. It is aria-hidden and takes no
          events, so it cannot disturb the tab order below it. */}
      <AuroraField accentToken={GROUP_ACCENT_TOKENS[groupForMode(workspaceMode)]} />

      {/* First focusable thing in the tab order: the header carries dozens of
          repeated controls before the design sheet, so a keyboard user needs one
          keypress to skip past them (WCAG 2.4.1). */}
      <a href="#workspace" className="skip-link">Skip to the workspace</a>

      {/* ── Header ── */}
      <header className="app-chrome ide-header flex min-w-0 flex-shrink-0 items-center justify-between gap-2 border-b border-border/80 px-3 py-1.5" data-tour="app-header" style={{ minHeight: '46px' }}>
        {/* Left: brand + project identity */}
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <HoverHelp topicId="header.projects" placement="bottom">
            <Button
              variant="ghost"
              size="bar-icon"
              onClick={openProjectManager}
              aria-label="Projects"
              className="shrink-0"
            >
              <FolderOpen />
            </Button>
          </HoverHelp>
          <HoverHelp topicId="header.library" placement="bottom">
            <Button
              variant={sidebarOpen && workspaceLibraryLabel ? 'default' : 'ghost'}
              size="bar-icon"
              onClick={toggleSidebar}
              disabled={!workspaceLibraryLabel}
              aria-label={workspaceLibraryLabel ? `Toggle ${workspaceLibraryLabel}` : 'Toggle Library'}
              aria-pressed={sidebarOpen}
              className="shrink-0"
            >
              <PanelLeft />
            </Button>
          </HoverHelp>

          <span className="folio-sep hidden sm:block" aria-hidden="true" />

          {/* Brand mark + project name */}
          <div className="flex min-w-0 items-center gap-2">
            <FolioMark className="hidden h-[18px] w-[18px] shrink-0 text-primary sm:block" />
            <div className="flex min-w-0 flex-col justify-center gap-0" style={{ lineHeight: 1.2 }}>
              <EditableProjectTitle
                name={currentProject.name}
                onRename={renameCurrentProject}
                titleClassName="text-[13px] font-semibold tracking-[-0.015em] leading-tight"
              />
              <div className="flex items-center gap-1.5 mt-0.5">
                {/* Mode badge — instrument chip, no trinkets */}
                <span
                  className="folio-mode-badge"
                  title={WORKSPACE_MODE_META[workspaceMode].description}
                >
                  {WORKSPACE_MODE_META[workspaceMode].label}
                </span>
                {/* Save state — text carries the signal, nothing else */}
                <span
                  className={`inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${isDirty ? 'text-warning' : 'text-muted-foreground/60'}`}
                  role="status"
                  aria-live="polite"
                >
                  <span className="hidden sm:inline">{isDirty ? 'Unsaved' : offlineMode ? 'Local' : 'Saved'}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Centre: command bar (Ctrl+K) + live agent activity */}
        <div className="flex shrink items-center justify-center gap-2 px-2">
          <HoverHelp topicId="header.palette" placement="bottom">
            <button
              type="button"
              onClick={() => setShowCommandPalette(true)}
              aria-label="Command palette — search parts, nets, commands"
              aria-haspopup="dialog"
              data-tour="command-palette"
              className="shell-command-pill"
            >
              <span className="shell-command-pill__sheen" aria-hidden="true" />
              <span className="agent-orb" aria-hidden="true" />
              <span className="shell-command__label min-w-0 flex-1 truncate text-left text-muted-foreground/85">
                Ask Folio — parts, nets, workspaces, actions…
              </span>
              <span className="shell-command__key flex shrink-0 items-center gap-0.5" aria-hidden="true">
                <kbd className="cad-kbd">{commandKey}</kbd>
                <kbd className="cad-kbd">K</kbd>
              </span>
            </button>
          </HoverHelp>
          <AgentStatusPill onOpenAgents={() => useAppStore.getState().setWorkspaceMode('agents')} />
        </div>

        {/* Right: actions */}
        <div className="flex min-w-0 shrink-0 items-center gap-0.5">
          <HoverHelp topicId="header.assistant" placement="bottom">
            <Button
              variant={aiChatOpen ? 'default' : 'ghost'}
              size="bar"
              onClick={toggleAiChat}
              aria-label="Ask Scribe"
              aria-pressed={aiChatOpen}
              data-tour="agent-button"
              className={`gap-1.5 ${aiChatOpen ? 'cad-agent-ring' : 'hover:border-primary/50 hover:text-primary'}`}
            >
              <ScribeIcon />
              <span className="hidden lg:inline">Ask Scribe</span>
            </Button>
          </HoverHelp>

          <span className="folio-sep" aria-hidden="true" />

          <div className="relative" data-tour="version-history">
            <HoverHelp topicId="header.version-history" placement="bottom">
              <Button
                variant="ghost"
                size="bar-icon"
                onClick={() => { setShowVcsMenu(value => !value); refreshVcs() }}
                aria-label="Version history"
                aria-expanded={showVcsMenu}
              >
                <History />
              </Button>
            </HoverHelp>
            {showVcsMenu && (
              <div className="cad-glass-panel cad-popover-enter absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border shadow-2xl">
                <div className="bg-surface/50 p-3 border-b border-border/60">
                  <h2 className="text-sm font-semibold">Version history</h2>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Content-addressed commits of every domain — schematic, PCB, mechanical,
                    firmware and more. Restore snaps the whole project back as one coherent state.
                  </p>
                  <form
                    className="flex gap-2 mt-3"
                    onSubmit={event => { event.preventDefault(); handleVcsCommit() }}
                  >
                    <input
                      value={vcsMessage}
                      onChange={event => setVcsMessage(event.target.value)}
                      placeholder="Commit message…"
                      aria-label="Commit message"
                      maxLength={120}
                      className="min-w-0 flex-1 rounded-lg border border-input bg-background/60 px-2.5 py-1.5 text-xs focus:outline-none focus:border-ring focus:ring-0"
                    />
                    <Button type="submit" size="sm" className="shrink-0">Commit</Button>
                    <HoverHelp title="Safety backup + commit" description="Safety backup + commit">
<Button type="button" size="sm" variant="outline" onClick={createCheckpoint} className="shrink-0">Backup</Button>
</HoverHelp>
                  </form>
                  {vcsStatus && <p role="status" className="text-xs text-muted-foreground mt-2">{vcsStatus}</p>}
                </div>
                <div className="max-h-64 overflow-y-auto scrollbar-thin">
                  {vcsLog.length === 0 && backupList.length === 0 ? (
                    <p className="px-4 py-5 text-xs text-muted-foreground text-center">No commits yet. Add a message and press Commit.</p>
                  ) : (
                    <>
                    {vcsLog.map(commit => (
                    <div key={`c-${commit.id}`} className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/40 last:border-0 hover:bg-accent/40 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium" title={commit.message}>{commit.message}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{new Date(commit.timestamp).toLocaleString()} · {commit.id.slice(0, 8)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="bar-icon"
                        title={`Restore "${commit.message}"`}
                        aria-label={`Restore commit: ${commit.message}`}
                        onClick={() => void handleVcsCheckout(commit)}
                        className="shrink-0"
                      >
                        <RotateCcw />
                      </Button>
                    </div>
                    ))}
                    {backupList.map(backup => (
                    <div key={`b-${backup.id}`} className="flex items-center gap-2.5 px-3 py-2.5 border-b border-border/40 last:border-0 hover:bg-accent/40 transition-colors">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium" title={backup.label}>{backup.label} <span className="text-muted-foreground font-normal">(backup)</span></p>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{new Date(backup.createdAt).toLocaleString()} · {(backup.sizeBytes / 1024).toFixed(1)} KB</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="bar-icon"
                        title={`Restore backup: ${backup.label}`}
                        aria-label={`Restore backup: ${backup.label}`}
                        onClick={() => void restoreCheckpoint(backup)}
                        className="shrink-0"
                      >
                        <RotateCcw />
                      </Button>
                    </div>
                    ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <HoverHelp topicId="header.notifications" placement="bottom">
            <NotificationBell />
          </HoverHelp>

          <HoverHelp topicId="header.help" placement="bottom">
            <Button
              variant="ghost"
              size="bar-icon"
              onClick={() => openHelp('tutorials')}
              aria-label="Help and tutorials"
              aria-haspopup="dialog"
              data-tour="help-button"
            >
              <HelpCircle />
            </Button>
          </HoverHelp>

          {/* Export menu */}
          <div className="relative">
            <HoverHelp topicId="header.export" placement="bottom">
              <Button
                variant="default"
                size="bar"
                onClick={() => {
                  setShowExportMenu(v => !v)
                  setExportStatus('')
                }}
                aria-label="Export design"
                aria-expanded={showExportMenu}
                className="gap-1.5"
              >
                <Download />
                <span className="hidden sm:inline">Export</span>
              </Button>
            </HoverHelp>
            {showExportMenu && (
              <div className="cad-glass-panel cad-popover-enter absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-border py-1 shadow-2xl">
                {[
                  { label: 'Export as Image', icon: Image, action: handleExportImage },
                  { label: 'Drawing (SVG)', icon: FileText, action: handleExportDrawing },
                  { label: 'Netlist (.net)', icon: FileText, action: handleExportNetlist },
                  { label: 'Export JSON', icon: FileText, action: handleExportJSON },
                  { label: 'Gerber (.gbr)', icon: FileText, action: handleExportGerber },
                  { label: 'Bill of Materials', icon: List, action: handleExportBOM },
                  { label: 'Encrypted JSON…', icon: Lock, action: handleExportEncrypted },
                ].map(({ label, icon: Icon, action }) => (
                  <button
                    key={label}
                    onClick={action}
                    className="w-full px-3.5 py-2 text-left hover:bg-accent/70 flex items-center gap-2.5 text-xs font-medium text-foreground transition-colors"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    {label}
                  </button>
                ))}
                {exportStatus && (
                  <p role="status" className="border-t border-border/60 px-3.5 py-2 text-[10px] text-muted-foreground">
                    {exportStatus}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Who else is in this project — the roster itself, not a toggle to it. */}
          <UserPresence users={othersPresent} />

          <span className="folio-sep" aria-hidden="true" />
          <HoverHelp topicId="header.settings" placement="bottom">
            <Button variant="ghost" size="bar-icon" onClick={() => setShowSettings(true)} aria-label="Settings">
              <Settings />
            </Button>
          </HoverHelp>
          <HoverHelp topicId="header.console" placement="bottom">
            <a
              href="/console"
              aria-label="Open your account console"
              className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CircleUserRound className="h-[18px] w-[18px]" aria-hidden="true" />
            </a>
          </HoverHelp>
          <HoverHelp topicId="header.theme" placement="bottom">
            <Button variant="ghost" size="bar-icon" onClick={toggleTheme} aria-label={themeToggleLabel}>
              {themeIcon}
            </Button>
          </HoverHelp>

          <div className="relative">
            <HoverHelp topicId="header.more" placement="bottom">
              <Button
                variant={showMoreMenu ? 'default' : 'ghost'}
                size="bar-icon"
                onClick={() => setShowMoreMenu(value => !value)}
                aria-label="More tools"
                aria-haspopup="menu"
                aria-expanded={showMoreMenu}
              >
                <MoreHorizontal />
              </Button>
            </HoverHelp>
            {showMoreMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMoreMenu(false)} aria-hidden="true" />
                <div
                  className="cad-glass-panel cad-popover-enter absolute right-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-xl border border-border py-1 shadow-2xl"
                  role="menu"
                  aria-label="More tools"
                >
                  {moreMenuSections.map(({ group, items }) => (
                    <div key={group} role="group" aria-label={group} className="pb-1">
                      <p className="px-3.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                        {group}
                      </p>
                      {items.map(({ label, icon: Icon, action }) => (
                        <button
                          key={label}
                          type="button"
                          role="menuitem"
                          onClick={() => { action(); setShowMoreMenu(false) }}
                          className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-xs font-medium text-foreground hover:bg-accent/70 transition-colors"
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          <span className="truncate">{label}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <NoticeBanner message={notice} onDismiss={() => setNotice('')} />

      {/* Community design in preview: attribution, the license it arrived
          under, the one action that makes it the user's, and a way back. */}
      {preview && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 border-b border-primary/25 bg-primary/10 px-4 py-1.5 text-[11px] font-medium text-foreground"
        >
          <span className="min-w-0">
            <span className="font-bold text-primary">Community design</span>
            <span className="text-muted-foreground"> — by {preview.authorName} · {licenseLabel(preview.license)}</span>
          </span>
          {previewFlash && (
            <span className="truncate font-semibold text-amber-500">{previewFlash}</span>
          )}
          <span className="flex items-center gap-2">
            <Button size="sm" className="h-7 gap-1 px-3 text-[11px]" onClick={() => void adoptPreview()}>
              Make it mine
            </Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={discardCommunityPreview}>
              Discard design
            </Button>
          </span>
        </div>
      )}

      {voiceOpen && <VoiceCommandBar onClose={closeVoiceBar} />}

      {/* ── Main area ── */}
      <main id="workspace" aria-label="Workspace" className="relative flex min-w-0 flex-1 overflow-hidden">
        {/* Domain workspace with 13-mode tab routing */}
        <DomainWorkspace
          libraryComponents={paletteComponents}
          onSave={handleSave}
          onOpenDemos={() => setShowDemoGallery(true)}
          onOpenHelp={() => openHelp('workspaces')}
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
            <div className="app-panel w-[27rem] max-w-[calc(100vw-2rem)] border-l border-border max-xl:h-full">
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
        {/* Where you are: family › document, in instrument-tape caps. */}
        <span className="status-segment text-foreground" title={WORKSPACE_MODE_META[workspaceMode].description}>
          <span className="seg-label hidden lg:inline">
            {WORKSPACE_GROUPS.find((group) => group.id === groupForMode(workspaceMode))?.label}
          </span>
          <span className="hidden text-muted-foreground/70 lg:inline" aria-hidden="true">/</span>
          <span className="cad-readout">{WORKSPACE_MODE_META[workspaceMode].label}</span>
        </span>
        {workspaceMode === 'schematic' ? (
          <>
            <span className="status-segment">
              <Package className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
              <span className="seg-label">Parts</span> <span className="cad-readout">{components.length}</span>
            </span>
            <span className="status-segment">
              <Cable className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
              <span className="seg-label">Wires</span> <span className="cad-readout">{wires.length}</span>
            </span>
            <span className="status-segment">
              <MousePointer2 className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
              <span className="seg-label">Selected</span> <span className="cad-readout">{selectedComponents.length}</span>
            </span>
            {selectedNet && selectedNetName ? (
              <button
                type="button"
                onClick={() => clearSelection()}
                className="status-segment transition-colors hover:bg-accent"
                aria-label={`Selected net ${selectedNetName}${selectedNetPins > 0 ? `, ${selectedNetPins} pins` : ''}. Clear selection.`}
              >
                Net <span className="cad-readout">{selectedNetName}</span>
                {selectedNetPins > 0 ? (
                  <span className="text-muted-foreground">
                    {selectedNetPins} pin{selectedNetPins === 1 ? '' : 's'}
                  </span>
                ) : null}
              </button>
            ) : null}
            <span className="status-segment">
              <Wrench className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
              <span className="seg-label">Tool</span> <span className="cad-readout">{activeTool}</span>
            </span>
            <span className="status-segment hidden sm:inline-flex">
              <Grid3X3 className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
              <span className="seg-label">Grid</span> <span className="cad-readout">{settings.gridSize}</span>
            </span>
            <span className="status-segment hidden sm:inline-flex">
              <Magnet className="h-3 w-3 text-muted-foreground/60" aria-hidden="true" />
              <span className="seg-label">Snap</span> <span className="cad-readout">{settings.snapToGrid ? 'on' : 'off'}</span>
            </span>
            <button
              type="button"
              onClick={toggleHealthPanel}
              aria-expanded={healthPanelOpen}
              aria-controls="design-health-panel"
              aria-label={`Design health: ${healthErrors} error${healthErrors === 1 ? '' : 's'}, ${healthWarnings} warning${healthWarnings === 1 ? '' : 's'}, ${healthNotices} notice${healthNotices === 1 ? '' : 's'}. ${healthPanelOpen ? 'Hide' : 'Show'} the findings panel.`}
              title={
                healthTotal === 0
                  ? 'The electrical rule check passes on this sheet. Open the design health panel for the outline.'
                  : 'Electrical rule check findings. Open the design health panel to locate each one.'
              }
              className={`status-segment transition-colors hover:bg-accent ${
                healthErrors > 0
                  ? 'status-segment--crit'
                  : healthTotal > 0
                    ? 'status-segment--warn'
                    : 'status-segment--ok'
              }`}
            >
              {healthTotal === 0 ? (
                <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              ) : (
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
              )}
              {healthTotal === 0 ? (
                <span className="seg-label">ERC clean</span>
              ) : (
                <>
                  <span className="seg-label">ERC</span>
                  {healthErrors > 0 && (
                    <span className="cad-readout">
                      {healthErrors}E
                    </span>
                  )}
                  {healthWarnings > 0 && (
                    <span className="cad-readout">
                      {healthWarnings}W
                    </span>
                  )}
                  {healthNotices > 0 && (
                    <span className="cad-readout">
                      {healthNotices}N
                    </span>
                  )}
                </>
              )}
            </button>
          </>
        ) : (
          <span className="status-segment hidden truncate lg:inline-flex" title={WORKSPACE_MODE_META[workspaceMode].description}>
            {WORKSPACE_MODE_META[workspaceMode].description}
          </span>
        )}
        {/* Save state — text only; amber when the buffer holds work */}
        <span
          className={`status-segment hidden sm:inline-flex ${isDirty ? 'status-segment--warn' : 'text-muted-foreground/70'}`}
          title={isDirty ? 'Changes are held in the editor until the next save.' : 'Every change has been written to the project.'}
        >
          <span className="seg-label">{isDirty ? 'Unsaved' : offlineMode ? 'Saved locally' : 'Saved'}</span>
        </span>
        {/* Storage mode */}
        <span
          className="status-segment hidden text-muted-foreground/60 lg:inline-flex"
          title={offlineMode
            ? 'No cloud backend configured: projects are stored on this device.'
            : 'Projects are synced to the configured cloud backend.'}
        >
          {offlineMode ? (
            <HardDrive className="h-3 w-3" aria-hidden="true" />
          ) : (
            <Cloud className="h-3 w-3" aria-hidden="true" />
          )}
          <span className="seg-label">{offlineMode ? 'On device' : 'Cloud sync'}</span>
        </span>
        {/* Voice listening indicator */}
        {voiceListening && (
          <span className="status-segment status-segment--ok">
            <Mic className="h-3 w-3 cad-live-indicator" aria-hidden="true" />
            <span className="seg-label">Listening</span>
          </span>
        )}
        {/* Usage sync error */}
        {usageMirrorError && (
          <span
            className="status-segment hidden text-warning md:inline-flex"
            role="status"
            title={`Usage sync error: ${usageMirrorError}`}
          >
            <CloudOff className="h-3 w-3" aria-hidden="true" />
            <span className="seg-label">Usage not synced</span>
          </span>
        )}
        {/* Always-on agent activity (renders only while work is in flight) */}
        <AgentStatusSegment onOpenAgents={() => useAppStore.getState().setWorkspaceMode('agents')} />
        {/* Security alerts */}
        {activeAlertCount > 0 && (
          <button
            type="button"
            onClick={() => useAppStore.getState().setWorkspaceMode('siem')}
            title={`${activeAlertCount} active alert${activeAlertCount === 1 ? '' : 's'}${activeAlertSummary ? `: ${activeAlertSummary}` : ''}`}
            aria-label={`Open security alerts: ${activeAlertCount} active${activeAlertSummary ? ` - ${activeAlertSummary}` : ''}`}
            className="status-segment status-segment--crit animate-pulse"
          >
            <ShieldAlert className="h-3 w-3" aria-hidden="true" />
            <span className="cad-readout">{activeAlertCount} alert{activeAlertCount !== 1 ? 's' : ''}</span>
          </button>
        )}
        {/* Limits register — right-aligned */}
        <HoverHelp topicId="nav.limits" placement="top">
          <button
            type="button"
            onClick={openLimitsRegister}
            data-tour="limits-button"
            className="status-segment ml-auto hidden border-l border-border/60 text-muted-foreground/70 transition-colors hover:bg-accent/60 hover:text-foreground sm:inline-flex"
          >
            <ScrollText className="h-3 w-3" aria-hidden="true" />
            <span className="seg-label">Limits</span>
          </button>
        </HoverHelp>
      </footer>

      {overlayStack}
      {demoBusyOverlay}
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
