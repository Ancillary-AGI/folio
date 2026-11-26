/**
 * NLP Service — intent matching and dispatch for typed and spoken commands.
 *
 * Architecture:
 *   • Multi-strategy intent matching (keyword bags, pattern templates, token overlap)
 *   • Intent handlers dispatch directly to Zustand stores (no stale-closure issues)
 *   • Handlers report `applied` so the assistant can say what really changed
 *   • ML model registry (typed records awaiting a real inference backend)
 *   • Predictive analytics from design context
 *
 * Speech recognition and synthesis live in `src/lib/voice`; this service only
 * decides what a phrase means and runs the matching action.
 */

import { getCategoryName, type Component, type Wire, type Net } from '../../types'
import type { WorkspaceMode } from '../../stores/useAppStore'
// Use a lazy getter so we don't create a circular import at module load time
const getAppStore = () => import('../../stores/useAppStore').then(m => m.useAppStore)

/** UI actions the menu owns; voice asks the shell to run them. */
export interface VoiceActionHooks {
  saveDesign?: () => Promise<{ applied: boolean; detail: string }> | { applied: boolean; detail: string }
  exportDesign?: (format: string) =>
    | Promise<{ applied: boolean; detail: string }>
    | { applied: boolean; detail: string }
}

// ─── Public types ─────────────────────────────────────────────────────────────

export interface VoiceCommand {
  id: string
  command: string
  intent: string
  entities: Record<string, unknown>
  confidence: number
  timestamp: number
}

export interface NLPIntent {
  name: string
  /** Keyword bags — the query must touch every bag; hit strength weights the score */
  keywords?: string[][]
  examples: string[]
  handler: (entities: Record<string, unknown>, rawText: string) => Promise<unknown>
}

export interface MLModel {
  id: string
  name: string
  type: 'classification' | 'regression' | 'clustering'
  trained: boolean
  accuracy: number
  features: string[]
  lastTrained: number
}

export interface SmartSuggestion {
  id: string
  type: 'component' | 'connection' | 'optimization' | 'fix'
  title: string
  description: string
  confidence: number
  metadata: Record<string, unknown>
}

export interface PredictiveInsight {
  id: string
  type: 'performance' | 'reliability' | 'cost' | 'timeline'
  title: string
  description: string
  confidence: number
  impact: 'low' | 'medium' | 'high'
  recommendation: string
  data: Record<string, unknown>
}

export interface NLPProcessResult {
  intent: string
  entities: Record<string, unknown>
  confidence: number
  /** Dispatched action result (if intent had a registered store handler) */
  dispatchResult?: unknown
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Lightweight tokeniser: lower-case, strip punctuation, split on whitespace */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1)
}

/** Bag-of-words overlap score between two token arrays */
function bagOverlap(queryTokens: string[], bagTokens: string[]): number {
  if (!bagTokens.length) return 0
  const querySet = new Set(queryTokens)
  const matches = bagTokens.filter(t => querySet.has(t)).length
  return matches / bagTokens.length
}

// ─── Workspace mode map ───────────────────────────────────────────────────────

const WORKSPACE_ALIASES: Record<string, WorkspaceMode> = {
  schematic: 'schematic', circuit: 'schematic', wiring: 'schematic',
  control: 'control', pid: 'control', bode: 'control', controller: 'control',
  motor: 'machines', motors: 'machines', generator: 'machines', machine: 'machines', stepper: 'machines', bldc: 'machines',
  grid: 'grid', transmission: 'grid', distribution: 'grid', feeder: 'grid', substation: 'grid', loadflow: 'grid',
  pcb: 'pcb', board: 'pcb', layout: 'pcb',
  mechanical: 'mechanical', cad: 'mechanical', '3d': 'mechanical',
  preview: 'preview3d', view: 'preview3d', ar: 'preview3d', vr: 'preview3d',
  arduino: 'embedded', embedded: 'embedded', programming: 'embedded', code: 'embedded',
  imaging: 'imaging', image: 'imaging', flash: 'imaging', sd: 'imaging', raspberry: 'imaging',
  fpga: 'fpga', hdl: 'fpga', verilog: 'fpga', vhdl: 'fpga',
  hil: 'hil', hardware: 'hil', testing: 'hil',
  robotics: 'robotics', robot: 'robotics', arm: 'robotics', kinematics: 'robotics',
  twin: 'twin', digital: 'twin', iiot: 'twin', fleet: 'twin',
  siem: 'siem', security: 'siem', threats: 'siem', compliance: 'siem',
  marketplace: 'marketplace', market: 'marketplace', plugins: 'marketplace',
  dashboard: 'dashboard', overview: 'dashboard', metrics: 'dashboard',
  convert: 'convert',
}

// ─── NLPService ───────────────────────────────────────────────────────────────

export class NLPService {
  private intents: Map<string, NLPIntent> = new Map()
  private voiceCommands: VoiceCommand[] = []
  private mlModels: Map<string, MLModel> = new Map()
  private actionHooks: VoiceActionHooks = {}

  constructor() {
    this.initializeIntents()
    this.initializeMLModels()
  }

  // ─── Voice control ──────────────────────────────────────────────────────────

  /** The shell registers the actions that only it can perform (save, export). */
  registerActionHooks(hooks: VoiceActionHooks): void {
    this.actionHooks = { ...this.actionHooks, ...hooks }
  }

  async processVoiceCommand(command: string): Promise<NLPProcessResult> {
    const result = await this.processNLP(command)
    const vc: VoiceCommand = {
      id: `vc_${Date.now()}`,
      command,
      intent: result.intent,
      entities: result.entities,
      confidence: result.confidence,
      timestamp: Date.now(),
    }
    this.voiceCommands.push(vc)
    if (this.voiceCommands.length > 200) this.voiceCommands = this.voiceCommands.slice(-200)
    return result
  }

  // ─── NLP processing ─────────────────────────────────────────────────────────

  async processNLP(text: string): Promise<NLPProcessResult> {
    const tokens = tokenize(text)
    let best: NLPProcessResult = { intent: 'unknown', entities: {}, confidence: 0 }

    for (const [name, intent] of this.intents) {
      const score = this.scoreIntent(tokens, intent)
      if (score.confidence > best.confidence) {
        best = { intent: name, ...score }
      }
    }

    // Dispatch to store if confidence is adequate
    if (best.confidence >= 0.35 && best.intent !== 'unknown') {
      const intent = this.intents.get(best.intent)
      if (intent) {
        try {
          best.dispatchResult = await intent.handler(best.entities, text)
        } catch (error) {
          /* A failed *mutation* must not be indistinguishable from "no handler
           * matched": the voice layer reads `dispatchResult.applied`, so an
           * undefined result makes a refused `add_component` sound like a
           * command it did not understand, and the reason is lost. Report the
           * failure through the same channel. */
          const message = error instanceof Error ? error.message : String(error)
          console.warn(`Intent handler '${best.intent}' failed:`, error)
          best.dispatchResult = { applied: false, detail: `That did not work: ${message}` }
        }
      }
    }

    return best
  }

  /** Synchronous version for tests and the AI chat panel */
  processCommand(text: string): { intent: string; entities: Record<string, unknown>; confidence: number } {
    const tokens = tokenize(text)
    let best = { intent: 'unknown', entities: {} as Record<string, unknown>, confidence: 0 }
    for (const [name, intent] of this.intents) {
      const score = this.scoreIntent(tokens, intent)
      if (score.confidence > best.confidence) best = { intent: name, ...score }
    }
    return best
  }

  // ─── Intent scoring ─────────────────────────────────────────────────────────

  private scoreIntent(
    tokens: string[],
    intent: NLPIntent,
  ): { confidence: number; entities: Record<string, unknown> } {
    let confidence = 0
    const entities: Record<string, unknown> = {}

    // Strategy 1: keyword-bag scoring (primary). A phrase must touch every
    // bag the intent declares; hit strength weights the result, so a short
    // phrase against a long bag ("place a mosfet") still dispatches while a
    // phrase that misses a whole bag stays below the dispatch threshold.
    if (intent.keywords && intent.keywords.length > 0) {
      const hits = intent.keywords.map((bag) => bagOverlap(tokens, bag))
      const coverage = hits.filter((hit) => hit > 0).length / intent.keywords.length
      const strength = Math.max(...hits)
      confidence = Math.max(confidence, coverage * (0.4 + 0.6 * strength))
    }

    // Strategy 2: example sentence similarity
    if (intent.examples) {
      for (const ex of intent.examples) {
        const exTokens = tokenize(ex)
        const sim = bagOverlap(tokens, exTokens)
        confidence = Math.max(confidence, sim * 0.9)
      }
    }

    return { confidence, entities }
  }

  // ─── Intent registration ─────────────────────────────────────────────────────

  registerIntent(intent: NLPIntent): void {
    this.intents.set(intent.name, intent)
  }

  private initializeIntents(): void {

    // ── Workspace navigation ──────────────────────────────────────────────────
    this.registerIntent({
      name: 'switch_workspace',
      keywords: [
        ['switch', 'open', 'go', 'navigate', 'show', 'view'],
        Object.keys(WORKSPACE_ALIASES),
      ],
      examples: [
        'switch to pcb', 'open siem dashboard', 'go to robotics', 'show me the fpga workspace',
        'navigate to digital twin', 'open the schematic editor',
      ],
      handler: async (_entities, raw) => {
        const tokens = tokenize(raw)
        const mode = tokens.map(t => WORKSPACE_ALIASES[t]).find(Boolean)
        if (mode) {
          const useAppStore = await getAppStore()
          useAppStore.getState().setWorkspaceMode(mode)
          return { applied: true, navigatedTo: mode, detail: `Opened the ${mode} workspace.` }
        }
        return { applied: false, detail: 'No workspace name in that phrase, so the view was left alone.' }
      },
    })

    // ── Add component ─────────────────────────────────────────────────────────
    this.registerIntent({
      name: 'add_component',
      keywords: [
        ['add', 'place', 'insert', 'create', 'put', 'drop'],
        ['resistor', 'capacitor', 'inductor', 'led', 'diode', 'transistor', 'mosfet', 'opamp', 'ic', 'microcontroller', 'sensor', 'relay', 'connector', 'crystal', 'oscillator', 'regulator', 'battery', 'fuse'],
      ],
      examples: [
        'add a resistor', 'place a 10k resistor', 'insert LED', 'add capacitor 100nF',
        'put an opamp', 'create a transistor', 'drop a voltage regulator',
      ],
      handler: async (_entities, raw) => {
        const { placeComponentFromText } = await import('../voice/designActions')
        return placeComponentFromText(raw)
      },
    })

    // ── Connect components ────────────────────────────────────────────────────
    this.registerIntent({
      name: 'connect_components',
      keywords: [
        ['connect', 'wire', 'link', 'join', 'route', 'attach'],
        ['to', 'and', 'with', 'pin', 'pad', 'node', 'net'],
      ],
      examples: [
        'connect R1 to LED1', 'wire pin 1 to pin 4', 'link resistor and capacitor',
        'join VCC net to power pin', 'route the signal to output',
      ],
      handler: async (_entities, raw) => {
        const { connectPartsFromText } = await import('../voice/designActions')
        return connectPartsFromText(raw)
      },
    })

    // ── Simulate circuit ──────────────────────────────────────────────────────
    this.registerIntent({
      name: 'simulate_circuit',
      keywords: [
        ['simulate', 'run', 'start', 'execute', 'test', 'analyse', 'analyze'],
        ['simulation', 'circuit', 'design', 'spice', 'transient', 'ac', 'dc', 'noise'],
      ],
      examples: [
        'run simulation', 'simulate the circuit', 'start AC analysis',
        'execute transient simulation', 'test the design', 'run SPICE',
      ],
      handler: async (_entities, raw) => {
        const tokens = tokenize(raw)
        const type = tokens.find(t => ['transient', 'ac', 'dc', 'noise', 'montecarlo'].includes(t)) || 'transient'
        const useAppStore = await getAppStore()
        const state = useAppStore.getState()
        if (!state.simulationPanelOpen) state.toggleSimulationPanel()
        return { applied: true, action: 'simulate', type, detail: `Opened the simulation panel for a ${type} study.` }
      },
    })

    // ── Optimise design ───────────────────────────────────────────────────────
    this.registerIntent({
      name: 'optimize_design',
      keywords: [
        ['optimize', 'optimise', 'improve', 'reduce', 'minimise', 'minimize', 'enhance', 'tune'],
        ['power', 'cost', 'performance', 'size', 'noise', 'heat', 'thermal', 'efficiency', 'speed'],
      ],
      examples: [
        'optimize for power', 'reduce power consumption', 'improve efficiency',
        'minimize cost', 'optimize thermal performance', 'reduce noise',
      ],
      handler: async () => {
        // No optimiser runs from a spoken command; say so instead of faking it.
        return {
          applied: false,
          detail: 'Voice cannot run the optimiser yet, so nothing changed. Ask Copilot or use the optimisation tools in the workspace.',
        }
      },
    })

    // ── Export design ─────────────────────────────────────────────────────────
    this.registerIntent({
      name: 'export_design',
      keywords: [
        ['export', 'save', 'download', 'generate', 'create', 'output'],
        ['gerber', 'netlist', 'pdf', 'png', 'json', 'bom', 'stl', 'obj', 'gcode', 'svg', 'file'],
      ],
      examples: [
        'export to gerber', 'save as PDF', 'generate netlist', 'export BOM',
        'download gerber files', 'create STL file', 'export design as JSON',
      ],
      handler: async (_entities, raw) => {
        const tokens = tokenize(raw)
        const formats = ['gerber', 'netlist', 'pdf', 'png', 'json', 'bom', 'stl', 'obj', 'gcode', 'svg']
        const format = tokens.find(t => formats.includes(t)) || 'json'
        const hook = this.actionHooks.exportDesign
        if (!hook) {
          return { applied: false, detail: 'Voice cannot start an export in this view. Use the Export menu instead.' }
        }
        try {
          return await hook(format)
        } catch (error) {
          return { applied: false, detail: `The export did not start (${error instanceof Error ? error.message : 'unknown error'}).` }
        }
      },
    })

    // ── AI analysis ───────────────────────────────────────────────────────────
    this.registerIntent({
      name: 'ai_analyze',
      keywords: [
        ['analyze', 'analyse', 'check', 'inspect', 'review', 'audit', 'diagnose', 'debug'],
        ['circuit', 'design', 'schematic', 'pcb', 'issues', 'errors', 'warnings', 'problems'],
      ],
      examples: [
        'analyze the circuit', 'check for issues', 'review the design',
        'debug schematic errors', 'audit the PCB', 'find problems',
      ],
      handler: async () => {
        const useAppStore = await getAppStore()
        const state = useAppStore.getState()
        if (!state.aiChatOpen) state.toggleAiChat()
        return { applied: true, action: 'ai_analyze', detail: 'Opened Copilot.' }
      },
    })

    // ── Undo / redo ───────────────────────────────────────────────────────────
    // Canvas history lives in the PROJECT store (component/wire snapshots).
    this.registerIntent({
      name: 'undo',
      keywords: [
        ['undo', 'revert', 'back', 'reverse'],
      ],
      examples: ['undo', 'undo last action', 'revert change', 'go back'],
      handler: async () => {
        const { useProjectStore } = await import('../../stores/useProjectStore')
        const project = useProjectStore.getState()
        if (!project.canUndo()) return { applied: false, detail: 'There is nothing to undo.' }
        project.undo()
        return { applied: true, action: 'undo', detail: 'Undid the last canvas change.' }
      },
    })

    this.registerIntent({
      name: 'redo',
      keywords: [
        ['redo', 'redo', 'forward', 'reapply'],
      ],
      examples: ['redo', 'redo last action', 'reapply change'],
      handler: async () => {
        const { useProjectStore } = await import('../../stores/useProjectStore')
        const project = useProjectStore.getState()
        if (!project.canRedo()) return { applied: false, detail: 'There is nothing to redo.' }
        project.redo()
        return { applied: true, action: 'redo', detail: 'Reapplied the undone change.' }
      },
    })

    // ── Save project ──────────────────────────────────────────────────────────
    this.registerIntent({
      name: 'save_project',
      keywords: [
        ['save', 'store', 'persist', 'commit', 'backup'],
        ['project', 'design', 'schematic', 'work', 'file'],
      ],
      examples: ['save the project', 'save my design', 'store changes', 'commit work'],
      handler: async () => {
        const hook = this.actionHooks.saveDesign
        if (!hook) return { applied: false, detail: 'No project is open, so there was nothing to save.' }
        try {
          return await hook()
        } catch (error) {
          return { applied: false, detail: `The save failed (${error instanceof Error ? error.message : 'unknown error'}).` }
        }
      },
    })

    // ── Security / SIEM ───────────────────────────────────────────────────────
    this.registerIntent({
      name: 'open_siem',
      keywords: [
        ['show', 'open', 'view', 'display', 'check'],
        ['security', 'siem', 'threats', 'alerts', 'compliance', 'audit'],
      ],
      examples: ['show security alerts', 'open SIEM', 'check compliance', 'view threats', 'show audit trail'],
      handler: async () => {
        const useAppStore = await getAppStore()
        useAppStore.getState().setWorkspaceMode('siem')
        return { applied: true, action: 'open_siem', detail: 'Opened the security workspace.' }
      },
    })

    // ── Describe the sheet ────────────────────────────────────────────────────
    this.registerIntent({
      name: 'describe_design',
      keywords: [
        ['what', 'describe', 'list', 'summarise', 'summarize', 'tell'],
        ['design', 'sheet', 'circuit', 'components', 'parts', 'wires', 'board'],
      ],
      examples: [
        'what is on the sheet', 'describe the design', 'list the components',
        'how many parts are there', 'what components are placed', 'tell me about the board',
      ],
      handler: async () => {
        const { useProjectStore } = await import('../../stores/useProjectStore')
        const useAppStore = await getAppStore()
        const project = useProjectStore.getState()
        const references = project.components.map(
          (component) => `${component.reference} ${component.component.name}`,
        )
        const head = `${project.components.length} part${project.components.length === 1 ? '' : 's'} and ${project.wires.length} wire${project.wires.length === 1 ? '' : 's'}`
        return {
          applied: false,
          detail:
            `The ${useAppStore.getState().workspaceMode} workspace has ${head}` +
            (references.length > 0 ? `: ${references.slice(0, 10).join(', ')}${references.length > 10 ? ', and more' : ''}.` : '. Nothing is placed yet.'),
        }
      },
    })

    // ── Turn the assistant's voice off ────────────────────────────────────────
    this.registerIntent({
      name: 'stop_voice',
      keywords: [
        ['stop', 'mute', 'silence', 'quiet', 'end'],
        ['listening', 'talking', 'speaking', 'voice', 'microphone', 'mic'],
      ],
      examples: [
        'stop listening', 'stop talking', 'be quiet', 'mute the microphone',
        'stop voice control', 'silence the assistant', 'turn the mic off',
      ],
      handler: async () => {
        // The conversation controller watches this intent and closes the
        // session; the handler itself only confirms.
        return { applied: true, detail: 'Voice off.' }
      },
    })
  }

  // ─── ML model registry ──────────────────────────────────────────────────────

  private initializeMLModels(): void {
    const models: MLModel[] = [
      {
        id: 'component_recommender',
        name: 'Component Recommendation Model',
        type: 'classification',
        trained: false,
        accuracy: 0,
        features: ['circuit_type', 'power_requirements', 'frequency', 'user_history'],
        lastTrained: 0,
      },
      {
        id: 'design_optimizer',
        name: 'Design Optimization Model',
        type: 'regression',
        trained: false,
        accuracy: 0,
        features: ['component_count', 'connection_complexity', 'power_consumption', 'thermal_profile'],
        lastTrained: 0,
      },
      {
        id: 'failure_predictor',
        name: 'Failure Prediction Model',
        type: 'regression',
        trained: false,
        accuracy: 0,
        features: ['operating_conditions', 'component_age', 'usage_patterns', 'environmental_factors'],
        lastTrained: 0,
      },
    ]
    models.forEach(m => this.mlModels.set(m.id, m))
  }

  async trainMLModel(modelId: string, trainingData: Array<Record<string, unknown>>): Promise<void> {
    // No training backend is bundled: record the dataset shape and mark the
    // model so callers can gate on it, without inventing an accuracy figure.
    const model = this.mlModels.get(modelId)
    if (!model) throw new Error(`Model not found: ${modelId}`)
    if (trainingData.length === 0) throw new Error(`No training samples for model '${modelId}'`)
    model.trained = true
    model.accuracy = 0
    model.features = Array.from(new Set(trainingData.flatMap((row) => Object.keys(row)))).slice(0, 16)
    model.lastTrained = Date.now()
  }

  async predictWithModel(modelId: string): Promise<{ prediction: number; confidence: number; features: string[] }> {
    // No inference backend is bundled: refuse to invent a prediction.
    const model = this.mlModels.get(modelId)
    if (!model || !model.trained) throw new Error(`Model '${modelId}' is not trained`)
    throw new Error(`Model '${modelId}' has no inference backend. Connect one before requesting predictions.`)
  }

  // ─── Smart suggestions ───────────────────────────────────────────────────────

  async generateSmartSuggestions(context: {
    components: Component[]
    wires: Wire[]
    nets: Net[]
    currentAction?: string
    userHistory?: string[]
  }): Promise<SmartSuggestion[]> {
    const suggestions: SmartSuggestion[] = []

    // 1. Bypass-cap check
    const ics = context.components.filter(c => {
      const cat = getCategoryName(c.category)
      return cat.toLowerCase().includes('ic') || cat.toLowerCase().includes('microcontroller')
    })
    const caps = context.components.filter(c => {
      const cat = getCategoryName(c.category)
      return cat.toLowerCase().includes('capacitor')
    })
    for (const ic of ics) {
      const hasBypass = caps.some(cap =>
        context.wires.some(w =>
          w.connectedPins.some(p => p.componentId === ic.id) &&
          w.connectedPins.some(p => p.componentId === cap.id),
        ),
      )
      if (!hasBypass) {
        suggestions.push({
          id: `bypass_${ic.id}`,
          type: 'component',
          title: `Add bypass cap near ${ic.name}`,
          description: `IC ${ic.name} has no local decoupling capacitor. Add a 100 nF ceramic cap between VCC and GND close to the power pin.`,
          confidence: 0.92,
          metadata: { targetId: ic.id },
        })
      }
    }

    // 2. Power-sensitive proximity warning
    const powerComps = context.components.filter(c => {
      const cat = getCategoryName(c.category)
      return cat.toLowerCase().includes('power') || cat.toLowerCase().includes('regulator')
    })
    const sensitiveComps = context.components.filter(c => {
      const cat = getCategoryName(c.category)
      return cat.toLowerCase().includes('adc') || cat.toLowerCase().includes('sensor')
    })
    if (powerComps.length > 0 && sensitiveComps.length > 0) {
      suggestions.push({
        id: 'layout_noise',
        type: 'optimization',
        title: 'Separate power from analog signals',
        description: 'Place sensitive analog/ADC components away from switching regulators to reduce noise coupling.',
        confidence: 0.82,
        metadata: { powerCount: powerComps.length, sensitiveCount: sensitiveComps.length },
      })
    }

    // 3. ML-based recommendation (only when a real backend prediction exists).
    // predictWithModel throws without a backend, so gate on accuracy > 0 and
    // skip silently rather than surfacing an error for an optional hint.
    const recommender = this.mlModels.get('component_recommender')
    if (recommender?.trained && recommender.accuracy > 0) {
      try {
        const pred = await this.predictWithModel('component_recommender')
        if (pred.prediction > 0.72) {
          suggestions.push({
            id: 'ml_recommend',
            type: 'component',
            title: 'ML-recommended: Voltage regulator',
            description: 'Based on your component selection history, a 3.3 V LDO regulator would complete this design.',
            confidence: pred.confidence,
            metadata: { model: 'component_recommender' },
          })
        }
      } catch {
        // No inference backend: the rule-based suggestions above still apply.
      }
    }

    return suggestions.sort((a, b) => b.confidence - a.confidence)
  }

  // ─── Predictive analytics ────────────────────────────────────────────────────

  async generatePredictiveInsights(projectData: {
    components: Component[]
    timeline?: unknown[]
    budget?: number
    requirements?: string[]
  }): Promise<PredictiveInsight[]> {
    const { components, budget } = projectData

    const insights: PredictiveInsight[] = []
    if (components.length === 0) return insights

    // Confidence below reports data coverage, not a model probability. An
    // insight is omitted entirely when no component supplies its number.
    const withPower = components.filter(c => typeof c.properties?.power === 'number')
    if (withPower.length > 0) {
      const powerW = withPower.reduce((sum, c) => sum + (c.properties.power as number), 0)
      insights.push({
        id: `insight_perf_${Date.now()}`,
        type: 'performance',
        title: 'Declared Power Draw',
        description: `Declared power totals ${powerW.toFixed(2)} W across ${withPower.length} of ${components.length} components.`,
        confidence: withPower.length / components.length,
        impact: powerW > 5 ? 'high' : 'low',
        recommendation: powerW > 5
          ? 'Add heatsink or reduce clock frequency to lower thermal output.'
          : 'No thermal action indicated by the declared power.',
        data: { powerW, declaredComponents: withPower.length, totalComponents: components.length },
      })
    }

    const withCost = components.filter(c => typeof c.properties?.cost === 'number')
    if (withCost.length > 0) {
      const costUsd = withCost.reduce((sum, c) => sum + (c.properties.cost as number), 0)
      const overBudget = typeof budget === 'number' && costUsd > budget
      insights.push({
        id: `insight_cost_${Date.now()}`,
        type: 'cost',
        title: 'Declared BOM Cost',
        description: `Declared component cost totals $${costUsd.toFixed(2)} across ${withCost.length} of ${components.length} components${
          typeof budget === 'number' ? ` (budget $${budget.toFixed(2)})` : ''
        }.`,
        confidence: withCost.length / components.length,
        impact: overBudget ? 'high' : 'low',
        recommendation: overBudget
          ? 'Swap premium components for commodity equivalents or raise the budget.'
          : 'Declared cost is within budget.',
        data: { costUsd, budget: budget ?? null, declaredComponents: withCost.length },
      })
    }

    const withMtbf = components.filter(
      c => typeof c.properties?.mtbfHours === 'number' && (c.properties.mtbfHours as number) > 0,
    )
    if (withMtbf.length === components.length) {
      const failureRate = withMtbf.reduce((sum, c) => sum + 1 / (c.properties.mtbfHours as number), 0)
      const mtbfH = 1 / failureRate
      insights.push({
        id: `insight_reliability_${Date.now()}`,
        type: 'reliability',
        title: 'Series Reliability Estimate',
        description: `Series constant-failure-rate estimate: ${Math.round(mtbfH).toLocaleString()} h from every component's declared MTBF.`,
        confidence: 1,
        impact: mtbfH < 10000 ? 'high' : 'low',
        recommendation: mtbfH < 10000
          ? 'Derate high-stress components or add redundancy to improve MTBF.'
          : 'Declared failure rates are acceptable.',
        data: { mtbfH, model: 'series-constant-failure-rate', declaredComponents: withMtbf.length },
      })
    }

    return insights
  }

  // ─── Accessors ───────────────────────────────────────────────────────────────

  getVoiceCommands(): VoiceCommand[] { return [...this.voiceCommands] }
  getMLModels(): MLModel[] { return Array.from(this.mlModels.values()) }
}

export const nlpService = new NLPService()
