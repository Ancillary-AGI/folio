/**
 * NLP Service — Natural language processing, voice control, and intent dispatch.
 *
 * Architecture:
 *   • Real browser SpeechRecognition API for voice input
 *   • Multi-strategy intent matching (keyword bags, pattern templates, token overlap)
 *   • Intent handlers dispatch directly to Zustand stores (no stale-closure issues)
 *   • ML model registry (typed records awaiting a real inference backend)
 *   • Predictive analytics from design context
 */

import { getCategoryName, type Component, type Wire, type Net } from '../../types'
import type { WorkspaceMode } from '../../stores/useAppStore'
// Use a lazy getter so we don't create a circular import at module load time
const getAppStore = () => import('../../stores/useAppStore').then(m => m.useAppStore)

interface SpeechRecognitionResultEventLike {
  results: ArrayLike<ArrayLike<{ transcript: string }>>
}
interface SpeechRecognitionErrorEventLike { error: string }
interface SpeechRecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null
  start(): void
  stop(): void
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

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
  /** Keyword bags — ANY token from a bag touching the query boosts confidence */
  keywords?: string[][]
  /** Old-style pattern strings kept for backwards compatibility */
  patterns?: string[]
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

/** Naive entity extractor — finds the token immediately after trigger words */
function extractEntity(tokens: string[], triggers: string[]): string | undefined {
  for (let i = 0; i < tokens.length - 1; i++) {
    if (triggers.includes(tokens[i])) return tokens[i + 1]
  }
  return undefined
}

// ─── Workspace mode map ───────────────────────────────────────────────────────

const WORKSPACE_ALIASES: Record<string, WorkspaceMode> = {
  schematic: 'schematic', circuit: 'schematic', wiring: 'schematic',
  pcb: 'pcb', board: 'pcb', layout: 'pcb',
  mechanical: 'mechanical', cad: 'mechanical', '3d': 'mechanical',
  preview: 'preview3d', view: 'preview3d', ar: 'preview3d', vr: 'preview3d',
  arduino: 'embedded', embedded: 'embedded', programming: 'embedded', code: 'embedded',
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
  private isListening = false
  private recognition: SpeechRecognitionLike | null = null

  constructor() {
    this.initializeIntents()
    this.initializeMLModels()
  }

  // ─── Voice control ──────────────────────────────────────────────────────────

  async startVoiceListening(): Promise<void> {
    const speechWindow = window as Window & { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor }
    const SR = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition
    if (!SR) throw new Error('SpeechRecognition not supported in this browser')

    if (this.recognition) {
      try { this.recognition.stop() } catch { /* ignore */ }
    }

    this.recognition = new SR()
    this.recognition.continuous = false
    this.recognition.interimResults = false
    this.recognition.lang = 'en-US'
    this.recognition.maxAlternatives = 1

    this.recognition.onstart = () => { this.isListening = true }
    this.recognition.onend = () => { this.isListening = false }
    this.recognition.onerror = (e) => {
      this.isListening = false
      console.warn('SpeechRecognition error:', e.error)
    }
    this.recognition.onresult = (event) => {
      const transcript: string = event.results[event.results.length - 1][0].transcript
      this.processVoiceCommand(transcript).catch(console.error)
    }

    this.recognition.start()
  }

  stopVoiceListening(): void {
    if (this.recognition) {
      try { this.recognition.stop() } catch { /* ignore */ }
      this.recognition = null
    }
    this.isListening = false
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
        } catch (e) {
          console.warn(`Intent handler '${best.intent}' failed:`, e)
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

    // Strategy 1: keyword-bag scoring (primary)
    if (intent.keywords) {
      let totalScore = 0
      for (const bag of intent.keywords) {
        totalScore = Math.max(totalScore, bagOverlap(tokens, bag))
      }
      confidence = Math.max(confidence, totalScore)
    }

    // Strategy 2: pattern-template matching (legacy support)
    if (intent.patterns) {
      for (const pattern of intent.patterns) {
        const patternTokens = tokenize(pattern.replace(/\{[^}]+\}/g, '___'))
        const overlap = bagOverlap(tokens, patternTokens.filter(t => t !== '___'))
        confidence = Math.max(confidence, overlap * 0.85) // slight discount vs keyword bags

        // Entity extraction from patterns
        const entityMatches = [...pattern.matchAll(/\{([^}]+)\}/g)]
        for (const m of entityMatches) {
          const entityName = m[1]
          const idx = patternTokens.indexOf('___')
          if (idx >= 0 && idx < tokens.length) entities[entityName] = tokens[idx]
        }
      }
    }

    // Strategy 3: example sentence similarity
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
          return { navigatedTo: mode }
        }
        return null
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
        const tokens = tokenize(raw)
        const componentTypes = ['resistor', 'capacitor', 'inductor', 'led', 'diode', 'transistor', 'mosfet', 'opamp', 'ic', 'sensor']
        const componentType = tokens.find(t => componentTypes.includes(t)) || extractEntity(tokens, ['add', 'place', 'insert', 'create'])
        return { action: 'add_component', type: componentType }
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
        const tokens = tokenize(raw)
        const toIdx = tokens.indexOf('to')
        const andIdx = tokens.indexOf('and')
        const splitIdx = toIdx >= 0 ? toIdx : andIdx
        const from = splitIdx > 0 ? tokens.slice(1, splitIdx).join(' ') : undefined
        const to = splitIdx >= 0 ? tokens.slice(splitIdx + 1).join(' ') : undefined
        return { action: 'connect', from, to }
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
        useAppStore.getState().toggleSimulationPanel()
        return { action: 'simulate', type }
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
      handler: async (_entities, raw) => {
        const tokens = tokenize(raw)
        const targets = ['power', 'cost', 'performance', 'size', 'noise', 'thermal']
        const target = tokens.find(t => targets.includes(t)) || 'general'
        return { action: 'optimize', target }
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
        return { action: 'export', format }
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
        useAppStore.getState().toggleAiChat()
        return { action: 'ai_analyze' }
      },
    })

    // ── Undo / redo ───────────────────────────────────────────────────────────
    this.registerIntent({
      name: 'undo',
      keywords: [
        ['undo', 'revert', 'back', 'reverse'],
      ],
      examples: ['undo', 'undo last action', 'revert change', 'go back'],
      handler: async () => {
        const useAppStore = await getAppStore()
        useAppStore.getState().undo()
        return { action: 'undo' }
      },
    })

    this.registerIntent({
      name: 'redo',
      keywords: [
        ['redo', 'redo', 'forward', 'reapply'],
      ],
      examples: ['redo', 'redo last action', 'reapply change'],
      handler: async () => {
        const useAppStore = await getAppStore()
        useAppStore.getState().redo()
        return { action: 'redo' }
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
        return { action: 'save' }
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
        return { action: 'open_siem' }
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
    const { components, budget = 100, requirements = [] } = projectData

    const powerW = components.reduce((sum, c) => {
      const p = typeof c.properties?.power === 'number' ? c.properties.power : 0
      return sum + p + 0.05 // 50 mW quiescent baseline per component
    }, 0)

    const costUsd = components.reduce((sum, c) => {
      const p = typeof c.properties?.cost === 'number' ? c.properties.cost : 0.5
      return sum + p
    }, 0)

    const mtbfH = 50000 / Math.max(1, Math.sqrt(components.length))

    return [
      {
        id: `insight_perf_${Date.now()}`,
        type: 'performance',
        title: 'Performance Forecast',
        description: `Estimated power draw: ${powerW.toFixed(2)} W — ${powerW > 5 ? 'consider active cooling' : 'passive cooling adequate'}.`,
        confidence: 0.78,
        impact: powerW > 5 ? 'high' : 'low',
        recommendation: powerW > 5 ? 'Add heatsink or reduce clock frequency to lower thermal output.' : 'Design is thermally safe.',
        data: { powerW },
      },
      {
        id: `insight_cost_${Date.now()}`,
        type: 'cost',
        title: 'Cost Estimate',
        description: `BOM cost: ~$${costUsd.toFixed(2)} — ${costUsd > budget ? 'OVER budget' : 'within budget'}.`,
        confidence: 0.72,
        impact: costUsd > budget ? 'high' : 'low',
        recommendation: costUsd > budget ? 'Swap premium components for commodity equivalents.' : 'Cost is acceptable.',
        data: { costUsd, budget },
      },
      {
        id: `insight_reliability_${Date.now()}`,
        type: 'reliability',
        title: 'Reliability Prediction',
        description: `Estimated MTBF: ${Math.round(mtbfH).toLocaleString()} h (${Math.round(mtbfH / 8760)} yr).`,
        confidence: 0.65,
        impact: mtbfH < 10000 ? 'high' : 'low',
        recommendation: mtbfH < 10000 ? 'Derate high-stress components to improve MTBF.' : 'Reliability is acceptable.',
        data: { mtbfH },
      },
      {
        id: `insight_timeline_${Date.now()}`,
        type: 'timeline',
        title: 'Timeline Estimate',
        description: `Complexity suggests ${Math.round(components.length * 1.5 + (requirements.length * 3))} dev-days.`,
        confidence: 0.60,
        impact: components.length > 50 ? 'high' : 'medium',
        recommendation: components.length > 50 ? 'Break design into modules for parallel development.' : 'Timeline is manageable.',
        data: { componentCount: components.length, requirementCount: requirements.length },
      },
    ]
  }

  // ─── Accessors ───────────────────────────────────────────────────────────────

  getVoiceCommands(): VoiceCommand[] { return [...this.voiceCommands] }
  getMLModels(): MLModel[] { return Array.from(this.mlModels.values()) }
  isVoiceListening(): boolean { return this.isListening }
}

export const nlpService = new NLPService()
