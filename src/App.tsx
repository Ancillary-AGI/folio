import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Cpu, FolderOpen, Menu, Bot, BarChart3, Settings, Package, Users,
  Download, Image, FileText, List, LogOut, Mic, MicOff,
  Shield, Bell, RefreshCw, History, RotateCcw, Moon, Sun, BookOpen, AlertCircle
} from 'lucide-react'
import { Button } from './components/ui/button'
import type { PlacedComponent, Wire, User } from './types'
import { supabase, isSupabaseConfigured, type Project, type Schematic, type Component } from './lib/supabase'
import { offlineProjectStore } from './lib/offlineProjectStore'
import { standardComponents } from './lib/componentLibrary'
import { exportToImage, exportToNetlist, exportToJSON, exportToBOM, exportToGerber, downloadFile } from './lib/exportUtils'
import { pluginManager } from './lib/plugins/pluginManager'
import { collaborativeEditor } from './lib/collaboration/collaborativeEditor'
import { nlpService } from './lib/nlp/nlpService'
import { siemService } from './lib/siem/siemService'
import { backupService, type ProjectBackup } from './lib/backup/backupService'
import { useAppStore, type WorkspaceMode } from './stores/useAppStore'
import { useProjectStore } from './stores/useProjectStore'
import { vcsService, type VcsCommit } from './lib/vcs/vcsService'
import type { CanvasComponent, CanvasWire } from './stores/useProjectStore'
import DomainWorkspace from './components/workspace/DomainWorkspace'
import SimulationPanel from './components/simulation/SimulationPanel'
import AIChatPanel from './components/ai/AIChatPanel'
import ProjectManager from './components/ProjectManager'
import AuthForm from './components/AuthForm'
import PluginPanel from './components/plugins/PluginPanel'
import CollaborativePanel from './components/collaboration/CollaborativePanel'
import UserPresence from './components/collaboration/UserPresence'
import OnboardingTour from './components/OnboardingTour'
import SettingsPanel from './components/SettingsPanel'
import { useTheme } from './lib/theme/useTheme'
import { describeTheme } from './lib/theme/tokens'
import { hasCompletedOnboarding, markOnboardingComplete, readOnboardingStep } from './lib/onboarding/onboardingStorage'
import { ONBOARDING_STEP_COUNT } from './lib/onboarding/onboardingSteps'


function App() {
  // Without cloud credentials the app boots straight into local mode — there is
  // no account to sign in to, so users never hit a login or "continue offline" gate.
  const [user, setUser] = useState<User | null>(() =>
    isSupabaseConfigured
      ? null
      : { id: 'offline-local', name: 'Local User', email: 'local@offline', role: 'owner' },
  )
  const offlineMode = !isSupabaseConfigured
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [onboardingStep, setOnboardingStep] = useState(0)
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
  const [showPluginPanel, setShowPluginPanel] = useState(false)
  const [showCollaborativePanel, setShowCollaborativePanel] = useState(false)
  const [collaborativeUsers, setCollaborativeUsers] = useState<
    Array<{ id: string; name: string; email: string; avatar?: string; color: string; isActive: boolean; lastSeen: number }>
  >([])
  const [isVoiceActive, setIsVoiceActive] = useState(false)
  const [activeAlertCount, setActiveAlertCount] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const {
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
    setCurrentProject,
    setCurrentSchematic,
    isDirty,
    markClean,
    components,
    wires,
  } = useProjectStore()

  const buildDesignSnapshot = () => ({
    components: useProjectStore.getState().components,
    wires: useProjectStore.getState().wires,
    code: useProjectStore.getState().firmwareCode || null,
    netlist: null,
    simConfig: null,
    meta: { viewport: useAppStore.getState().viewport },
  })

  /*
   * Theming is entirely owned by `useTheme`, which writes validated tokens from
   * `lib/theme/tokens.ts` onto <html>. App must never touch `documentElement`
   * colours directly — doing so is what produced the mixed light/dark UI.
   */
  const { preference: themePreference, theme: resolvedTheme, isDark: isDarkTheme, toggle: toggleTheme } = useTheme()

  useEffect(() => {
    if (!user) return
    // Resume an interrupted guide; only first-run users see it unprompted.
    if (hasCompletedOnboarding()) return
    setOnboardingStep(readOnboardingStep(ONBOARDING_STEP_COUNT))
    setShowOnboarding(true)
  }, [user])

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
  useEffect(() => {
    if (!user || !currentProject || offlineMode) return

    const metadata = (user as User & { user_metadata?: { full_name?: string; avatar_url?: string } }).user_metadata
    const collabUser = {
      id: user.id,
      name: metadata?.full_name || user.email || 'Anonymous',
      email: user.email || '',
      avatar: metadata?.avatar_url,
      color: generateUserColor(user.id),
      isActive: true,
      lastSeen: Date.now(),
    }

    collaborativeEditor.connect(collabUser, currentProject.id).then(connected => {
      if (!connected) return
      collaborativeEditor.on('user:joined', (u) =>
        setCollaborativeUsers(prev => [...prev.filter(x => x.id !== u.id), u])
      )
      collaborativeEditor.on('user:left', (u) =>
        setCollaborativeUsers(prev => prev.filter(x => x.id !== u.id))
      )
      collaborativeEditor.on('session:joined', (session) =>
        setCollaborativeUsers(Array.from(session.users.values()))
      )
    })

    return () => { collaborativeEditor.disconnect() }
  }, [user, currentProject, offlineMode])

  // ── SIEM monitoring ─────────────────────────────────────────────────────────
  useEffect(() => {
    siemService.startMonitoring()
    const interval = setInterval(() => {
      const alerts = siemService.getAlerts({ status: 'active' })
      setActiveAlertCount(alerts.length)
    }, 15000)
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
        const validModes: WorkspaceMode[] = ['schematic', 'convert', 'pcb', 'mechanical', 'preview3d', 'embedded', 'fpga', 'hil', 'robotics', 'twin', 'siem', 'marketplace', 'dashboard', 'bom']
        const workspaceMode = validModes.find(candidate => candidate === mode)
        if (workspaceMode) useAppStore.getState().setWorkspaceMode(workspaceMode)
        return { action: 'switch_workspace', mode }
      },
    })
  }, [])

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const generateUserColor = (userId: string): string => {
    const palette = ['#3B82F6','#EF4444','#10B981','#F59E0B','#8B5CF6','#EC4899','#06B6D4','#84CC16','#F97316','#6366F1']
    let hash = 0
    for (const c of userId) hash = c.charCodeAt(0) + ((hash << 5) - hash)
    return palette[Math.abs(hash) % palette.length]
  }

  const handleNewProject = async () => {
    if (!user) return
    if (offlineMode) {
      const project = offlineProjectStore.create(user.id, `New Project ${new Date().toLocaleDateString()}`)
      useProjectStore.setState({ components: [], wires: [], isDirty: false })
      setCurrentSchematic(null)
      setCanvasData(project.canvas_data ?? null)
      useAppStore.getState().setZoom(1)
      useAppStore.getState().setPan({ x: 0, y: 0 })
      setCurrentProject(project)
      setShowProjectManager(false)
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
      useProjectStore.setState({ components: [], wires: [], isDirty: false })
      setCurrentSchematic(null)
      setCanvasData(null)
      useAppStore.getState().setZoom(1)
      useAppStore.getState().setPan({ x: 0, y: 0 })
      setCurrentProject(data)
      setShowProjectManager(false)
      siemService.logAuditEvent({ user: user.id, action: 'project:create', resource: data.id, details: { name: data.name } })
    } catch (err) {
      console.error('Error creating project:', err)
    }
  }

  const handleLoadSampleCircuit = async () => {
    if (useProjectStore.getState().components.length > 0 && !window.confirm('Replace the current schematic with the 5 V divider example?')) return
    if (!useProjectStore.getState().currentProject) await handleNewProject()
    const project = useProjectStore.getState().currentProject
    if (!project) return

    const resistorDefinition = standardComponents.find(component => component.name === 'Resistor')
    const sourceDefinition = standardComponents.find(component => component.name === 'DC Voltage Source')
    if (!resistorDefinition || !sourceDefinition) throw new Error('The sample circuit components are missing from the standard library')

    const makeComponent = (
      libraryId: string,
      reference: string,
      definition: typeof resistorDefinition | typeof sourceDefinition,
      x: number,
      y: number,
      properties: Record<string, string | number | boolean>,
    ): CanvasComponent => {
      const libraryComponent = { ...definition, id: libraryId } as Component
      return {
        id: `sample-${reference.toLowerCase()}`,
        componentId: libraryId,
        component: libraryComponent,
        x,
        y,
        rotation: 0,
        reference,
        properties,
      }
    }

    const source = makeComponent('standard-dc-source', 'V1', sourceDefinition, 170, 100, { type: 'DC', voltage: '5V' })
    const upperResistor = makeComponent('standard-resistor', 'R1', resistorDefinition, 360, 85, { value: '1k' })
    const lowerResistor = makeComponent('standard-resistor', 'R2', resistorDefinition, 550, 85, { value: '1k' })
    const sampleWires: CanvasWire[] = [
      { id: 'sample-vin', points: [], netName: 'VIN', connectedPins: [
        { componentId: source.id, pinId: 'positive' },
        { componentId: upperResistor.id, pinId: 'p1' },
      ] },
      { id: 'sample-output', points: [], netName: 'OUT', connectedPins: [
        { componentId: upperResistor.id, pinId: 'p2' },
        { componentId: lowerResistor.id, pinId: 'p1' },
      ] },
      { id: 'sample-ground', points: [], netName: 'GND', connectedPins: [
        { componentId: source.id, pinId: 'negative' },
        { componentId: lowerResistor.id, pinId: 'p2' },
      ] },
    ]

    useProjectStore.setState({ components: [source, upperResistor, lowerResistor], wires: sampleWires, isDirty: true })
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
    if (user) siemService.logAuditEvent({ user: user.id, action: 'project:open', resource: project.id, details: {} })
  }

  const handleSave = useCallback(async (data: Record<string, unknown>) => {
    if (!currentProject) return
    if (offlineMode) {
      offlineProjectStore.saveCanvas(currentProject.id, data)
      setCanvasData(data)
      markClean()
      return
    }
    try {
      const { data: schematic } = await supabase.from('schematics').select('id')
        .eq('project_id', currentProject.id).order('order_index', { ascending: true }).limit(1).maybeSingle()
      if (schematic) {
        await supabase.from('schematics').update({ canvas_data: data, updated_at: new Date().toISOString() }).eq('id', schematic.id)
        await supabase.from('projects').update({ updated_at: new Date().toISOString() }).eq('id', currentProject.id)
        setCanvasData(data)
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
    viewport: useAppStore.getState().viewport,
  })

  const refreshVcs = () => {
    if (!currentProject) return
    setVcsLog(vcsService.log(currentProject.id))
    setBackupList(backupService.listBackups(currentProject.id))
    const dirty = vcsService.status(currentProject.id, buildDesignSnapshot())
    setVcsStatus(dirty.length === 0 ? 'clean' : `${dirty.length} change(s)`)
  }

  const handleVcsCommit = () => {
    if (!currentProject) return
    const message = vcsMessage.trim() || `Commit ${new Date().toLocaleString()}`
    try {
      const commit = vcsService.commit(currentProject.id, message, buildDesignSnapshot(), user?.id ?? 'local-user')
      setVcsMessage('')
      setVcsStatus('')
      refreshVcs()
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
    backupService.createBackup(currentProject.id, getCheckpointData(), 'Before VCS restore')
    const snapshot = vcsService.checkout(currentProject.id, commit.id)
    const comps = Array.isArray(snapshot.components) ? snapshot.components : []
    const wr = Array.isArray(snapshot.wires) ? snapshot.wires : []
    useProjectStore.setState({
      components: comps as typeof components,
      wires: wr as typeof wires,
      firmwareCode: typeof snapshot.code === 'string' ? snapshot.code : '',
      isDirty: true,
    })
    refreshVcs()
    setShowVcsMenu(false)
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
    setVcsStatus(`Backed up as ${checkpoint.label} (also committed below for history)`)
    try {
      vcsService.commit(currentProject.id, label, buildDesignSnapshot(), user?.id ?? 'local-user')
    } catch {
      /* backup already saved; commit is best-effort */
    }
    refreshVcs()
    siemService.logAuditEvent({
      user: user?.id || 'unknown',
      action: 'project:checkpoint:create',
      resource: currentProject.id,
      details: { checkpointId: checkpoint.id, label: checkpoint.label },
    })
  }

  const restoreCheckpoint = async (checkpoint: ProjectBackup) => {
    if (!currentProject || !window.confirm(`Restore “${checkpoint.label}”? A safety commit of the current state is created first.`)) return

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
    setVcsStatus(`Restored ${checkpoint.label}`)
    await handleSave(restored)
    siemService.logAuditEvent({
      user: user?.id || 'unknown',
      action: 'project:checkpoint:restore',
      resource: currentProject.id,
      details: { checkpointId: checkpoint.id, label: checkpoint.label },
    })
  }

  // ── Export handlers ──────────────────────────────────────────────────────────
  const handleExportImage = () => {
    const canvas = document.querySelector('canvas')
    if (!canvas || !currentProject) return
    const dataUrl = exportToImage(canvas)
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `${currentProject.name}.png`
    a.click()
    setShowExportMenu(false)
  }

  const handleExportNetlist = () => {
    if (!canvasData || !currentProject) return
    const netlist = exportToNetlist(
      (canvasData.components as PlacedComponent[]) || [],
      (canvasData.wires as Wire[]) || [],
      currentProject.name,
    )
    downloadFile(netlist, `${currentProject.name}.net`, 'text/plain')
    setShowExportMenu(false)
  }

  const handleExportJSON = () => {
    if (!currentProject) return
    const json = exportToJSON(
      components.map(c => ({ ...c, position: { x: c.x, y: c.y }, scale: 1 } as unknown as PlacedComponent)),
      wires.map(w => ({ ...w, points: w.points } as unknown as Wire)),
      currentProject.name,
    )
    downloadFile(json, `${currentProject.name}.json`, 'application/json')
    setShowExportMenu(false)
  }

  const handleExportBOM = () => {
    if (!currentProject) return
    const bom = exportToBOM(
      components.map(c => ({ ...c, position: { x: c.x, y: c.y }, scale: 1 } as unknown as PlacedComponent))
    )
    downloadFile(bom, `${currentProject.name}_BOM.csv`, 'text/csv')
    setShowExportMenu(false)
  }

  const handleExportGerber = () => {
    if (!currentProject) return
    const gerber = exportToGerber(
      components.map(c => ({ ...c, position: { x: c.x, y: c.y }, scale: 1 } as unknown as PlacedComponent)),
      wires.map(w => ({ ...w } as unknown as Wire)),
    )
    downloadFile(gerber, `${currentProject.name}.gbr`, 'text/plain')
    setShowExportMenu(false)
  }

  const handleSignOut = async () => {
    if (offlineMode) {
      // Local mode has no session to end; "signing out" returns to the project list.
      setCurrentProject(null)
      setCurrentSchematic(null)
      setCanvasData(null)
      setShowProjectManager(true)
      return
    }
    if (user) siemService.logAuditEvent({ user: user.id, action: 'auth:signout', resource: 'session', details: {} })
    await supabase.auth.signOut()
    setCurrentProject(null)
    setCurrentSchematic(null)
    setCanvasData(null)
  }

  const themeIcon = isDarkTheme ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />
  const themeLabel = describeTheme(themePreference, resolvedTheme)
  const themeToggleLabel = isDarkTheme ? 'Switch to light theme' : 'Switch to dark theme'

  const closeOnboarding = () => {
    setShowOnboarding(false)
    setOnboardingStep(0)
    markOnboardingComplete()
  }

  const toggleVoice = async () => {
    if (isVoiceActive) {
      nlpService.stopVoiceListening()
      setIsVoiceActive(false)
    } else {
      try {
        await nlpService.startVoiceListening()
        setIsVoiceActive(true)
      } catch {
        console.warn('Voice not available')
      }
    }
  }

  // ── Render gates ─────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3" role="status" aria-live="polite">
          <Cpu className="h-10 w-10 animate-pulse text-primary" />
          <span className="text-muted-foreground">Loading Folio…</span>
        </div>
      </div>
    )
  }

  if (!user) return <AuthForm onAuthSuccess={() => {}} />

  if (!currentProject || showProjectManager) {
    return (
      <div className="flex min-h-screen flex-col bg-background">
        <header className="app-chrome app-chrome-divider flex flex-shrink-0 items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Cpu className="h-7 w-7 text-primary" />
            <div>
              <h1 className="text-lg font-semibold leading-tight text-surface-foreground">Folio</h1>
              <p className="text-xs text-muted-foreground">Multi-domain engineering workbench</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={toggleTheme} title={themeToggleLabel} aria-label={themeToggleLabel}>{themeIcon}</Button>
            <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings"><Settings className="w-4 h-4" /></Button>
            {!offlineMode && (
              <Button variant="ghost" onClick={handleSignOut} className="flex items-center gap-2">
                <LogOut size={16} />Sign Out
              </Button>
            )}
          </div>
        </header>
        <ProjectManager onSelectProject={handleSelectProject} onNewProject={handleNewProject} offlineMode={offlineMode} />
        <div className="fixed bottom-4 right-4 z-40 flex gap-2">
          <Button variant="outline" onClick={() => setShowOnboarding(true)}>
            <BookOpen className="mr-2 h-4 w-4" /> Guided onboarding
          </Button>
        </div>
        {showOnboarding && (
          <OnboardingTour
            onClose={closeOnboarding}
            onCreateProject={() => { void handleNewProject() }}
            onLoadSampleCircuit={() => { void handleLoadSampleCircuit() }}
            hasProject={Boolean(currentProject)}
            stepIndex={onboardingStep}
            setStepIndex={setOnboardingStep}
          />
        )}
        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      </div>
    )
  }

  // ── Main IDE layout ───────────────────────────────────────────────────────────
  return (
    <div className="app-shell">

      {/* ── Header ── */}
      <header className="app-chrome app-chrome-divider flex flex-shrink-0 items-center justify-between px-4 py-2">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setShowProjectManager(true)} title="Projects">
            <FolderOpen className="w-4 h-4" />
          </Button>
          <Button
            variant={sidebarOpen ? 'default' : 'ghost'}
            size="icon"
            onClick={toggleSidebar}
            title="Toggle Library"
            aria-pressed={sidebarOpen}
          >
            <Menu className="w-4 h-4" />
          </Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <div className="flex min-w-0 items-center gap-2">
            <Cpu className="h-4 w-4 flex-shrink-0 text-primary" />
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

        <div className="flex items-center gap-1">
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          {/* Voice control */}
          <Button
            variant={isVoiceActive ? 'default' : 'ghost'}
            size="icon"
            onClick={toggleVoice}
            title={isVoiceActive ? 'Stop voice control' : 'Start voice control'}
          >
            {isVoiceActive ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </Button>

          {/* Security alerts — shield itself flags active alerts (no floating count pill) */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => useAppStore.getState().setWorkspaceMode('siem')}
            title={activeAlertCount > 0 ? `${activeAlertCount} active security alert${activeAlertCount === 1 ? '' : 's'}` : 'Security alerts'}
          >
            <Shield className={activeAlertCount > 0 ? 'w-4 h-4 text-destructive' : 'w-4 h-4'} />
          </Button>

          <Button variant="ghost" size="icon" onClick={toggleAiChat} title="AI Assistant">
            <Bot className="w-4 h-4" />
          </Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <Button variant="ghost" size="icon" onClick={toggleSimulationPanel} title="Simulation">
            <BarChart3 className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowSettings(true)} title="Settings" aria-label="Settings">
            <Settings className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowPluginPanel(true)} title="Plugins">
            <Package className="w-4 h-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setShowOnboarding(true)} title="Guided onboarding" aria-label="Guided onboarding">
            <BookOpen className="w-4 h-4" />
          </Button>
          <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />
          <div className="relative">
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
                  <p className="text-xs text-muted-foreground mt-1">Content-addressed commits of schematic, firmware and sim config, stored on this device.</p>
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
          <Button variant="ghost" size="icon" onClick={() => setShowCollaborativePanel(true)} title="Collaboration">
            <Users className="w-4 h-4" />
          </Button>

          {/* Export menu */}
          <div className="relative">
            <Button
              variant="default"
              size="sm"
              className="flex items-center gap-1 text-xs"
              onClick={() => setShowExportMenu(v => !v)}
            >
              <Download className="w-4 h-4" />
              Export
            </Button>
            {showExportMenu && (
              <div className="app-panel absolute right-0 z-50 mt-2 w-56 rounded-md border border-border py-2 shadow-xl">
                {[
                  { label: 'Export as Image', icon: Image, action: handleExportImage },
                  { label: 'Export Netlist (.net)', icon: FileText, action: handleExportNetlist },
                  { label: 'Export JSON', icon: FileText, action: handleExportJSON },
                  { label: 'Export Gerber (.gbr)', icon: FileText, action: handleExportGerber },
                  { label: 'Bill of Materials', icon: List, action: handleExportBOM },
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
              </div>
            )}
          </div>

          <Button variant="ghost" size="icon" onClick={toggleTheme} title={themeToggleLabel} aria-label={themeToggleLabel}>
            {themeIcon}
          </Button>
          <Button variant="ghost" size="icon" onClick={() => {
            setCurrentProject(null)
            setCurrentSchematic(null)
          }} title="Back to Projects">
            <RefreshCw className="w-4 h-4" />
          </Button>
          {!offlineMode && (
            <Button variant="ghost" size="icon" onClick={handleSignOut} title="Sign Out">
              <LogOut className="w-4 h-4" />
            </Button>
          )}
        </div>
      </header>

      {/* ── Main area ── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Domain workspace with 13-mode tab routing */}
        <DomainWorkspace libraryComponents={libraryComponents} onSave={handleSave} />

        {/* Right panel stack */}
        <div className="flex flex-shrink-0">
          {simulationPanelOpen && (
            <div className="app-panel w-96 border-l border-border">
              <SimulationPanel onClose={toggleSimulationPanel} />
            </div>
          )}
          {aiChatOpen && (
            <div className="app-panel w-96 border-l border-border">
              <AIChatPanel onClose={toggleAiChat} />
            </div>
          )}
          {showCollaborativePanel && (
            <div className="app-panel w-80 border-l border-border">
              <CollaborativePanel onClose={() => setShowCollaborativePanel(false)} />
            </div>
          )}
        </div>
      </div>

      {/* ── Status bar ── */}
      <div className="status-bar">
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
        <span className="status-segment">
          GRID <span className="cad-readout">{settings.gridSize}</span>
        </span>
        <span className="status-segment">
          SNAP <span className="cad-readout">{settings.snapToGrid ? 'ON' : 'OFF'}</span>
        </span>
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
          <span className="status-segment text-destructive">
            <AlertCircle className="h-3 w-3" /> {activeAlertCount} ALERT{activeAlertCount !== 1 ? 'S' : ''}
          </span>
        )}
        <span className="status-segment ml-auto border-r-0">
          <Bell className="w-3 h-3" />
        </span>
      </div>

      {/* Canvas ref for UserPresence */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Overlays */}
      <UserPresence
        users={collaborativeUsers}
        showCursors={true}
        showSelections={true}
        canvasRef={canvasRef}
      />

      {showPluginPanel && <PluginPanel onClose={() => setShowPluginPanel(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showOnboarding && (
        <OnboardingTour
          onClose={closeOnboarding}
          onCreateProject={() => { void handleNewProject() }}
          onLoadSampleCircuit={() => { void handleLoadSampleCircuit() }}
          hasProject
          stepIndex={onboardingStep}
          setStepIndex={setOnboardingStep}
        />
      )}
    </div>
  )
}

export default App
