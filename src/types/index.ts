/**
 * types/index.ts
 *
 * The shapes the sheet, the board and the solver agree on, so that a component
 * drawn on the canvas and the netlist built from it are the same object rather
 * than two dialects that drift.
 *
 * Components from Supabase carry `category: string`; the AI and domain services
 * carry `category: { id, name }`. CategoryLike accepts either, and
 * getCategoryName() / getCategoryId() are the only normalisation — use them
 * instead of `typeof c.category === 'string'` guards.
 */

// ── Category helpers ──────────────────────────────────────────────────────────

export type CategoryLike = string | { id: string; name: string }

export function getCategoryName(category: CategoryLike): string {
  if (typeof category === 'string') return category
  return category.name
}

export function getCategoryId(category: CategoryLike): string {
  if (typeof category === 'string') return category.toLowerCase().replace(/\s+/g, '_')
  return category.id
}

// ── Geometry ──────────────────────────────────────────────────────────────────

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

// ── Schematic drawing types ───────────────────────────────────────────────────

export interface Pin {
  id: string
  name: string
  x: number
  y: number
  type: 'input' | 'output' | 'io' | 'power' | 'ground' | 'passive' | 'nc'
  electricalType?: 'digital' | 'analog' | 'power' | 'ground'
}

export interface ComponentSymbol {
  width: number
  height: number
  paths: string[]
  circles?: Array<{ cx: number; cy: number; r: number }>
  rectangles?: Array<{ x: number; y: number; width: number; height: number }>
  text?: Array<{ x: number; y: number; text: string; size?: number }>
}

export interface ComponentProperties {
  [key: string]: string | number | boolean
}

export interface Component {
  id: string
  name: string
  category: string
  description?: string
  symbol: ComponentSymbol
  pins: Pin[]
  properties: ComponentProperties
  datasheet?: string
  manufacturer?: string
  partNumber?: string
  cost?: number
  availability?: 'available' | 'limited' | 'obsolete'
  tags?: string[]
}

export interface PlacedComponent {
  id: string
  componentId: string
  component: Component
  position: Point
  rotation: number
  scale: number
  reference: string
  properties: ComponentProperties
  locked?: boolean
  visible?: boolean
  selected?: boolean
}

export interface Wire {
  id: string
  points: Point[]
  netName?: string
  connectedPins: Array<{
    componentId: string
    pinId: string
  }>
  style?: {
    color?: string
    width?: number
    dashArray?: number[]
  }
  selected?: boolean
  current?: number // Current in Amperes
  voltage?: number // Voltage in Volts
}

/** The wire the domain and AI services pass around, which also carries a net id. */
export interface DomainWire {
  id: string
  points: Point[]
  netName?: string
  netId?: string
  connectedPins: Array<{ componentId: string; pinId: string }>
  style?: { color?: string; width?: number; dashArray?: number[] }
  selected?: boolean
  current?: number
  voltage?: number
}

export interface Net {
  id: string
  name: string
  connectedPins: Array<{
    componentId: string
    pinId: string
  }>
  wires: string[]
}

export interface Schematic {
  id: string
  name: string
  description?: string
  components: PlacedComponent[]
  wires: Wire[]
  nets: Net[]
  metadata: {
    created: string
    modified: string
    version: string
    author?: string
  }
  settings: {
    gridSize: number
    snapToGrid: boolean
    showGrid: boolean
    showPinNumbers: boolean
    showPinNames: boolean
    showNetNames: boolean
  }
}

// ── Simulation types ──────────────────────────────────────────────────────────

export interface SimulationNode {
  name: string
  voltage?: number
  current?: number
}

export interface SimulationWaveform {
  name: string
  type: 'voltage' | 'current' | 'power' | 'frequency'
  unit: string
  data: Array<{ x: number; y: number }>
  color?: string
}

export interface SimulationResult {
  id: string
  timestamp: number
  type: 'dc' | 'ac' | 'transient' | 'noise' | 'montecarlo'
  success: boolean
  error?: string
  nodes: SimulationNode[]
  waveforms: SimulationWaveform[]
  operatingPoint?: Record<string, number>
  convergenceInfo?: {
    iterations: number
    converged: boolean
    error?: number
  }
  statistics?: {
    simulationTime: number
    memoryUsage: number
    nodeCount: number
    elementCount: number
  }
}

export interface SimulationParameters {
  type: 'dc' | 'ac' | 'transient' | 'noise' | 'montecarlo'

  // Transient analysis
  startTime?: number
  stopTime?: number
  stepTime?: number
  maxStep?: number

  // AC analysis
  startFreq?: number
  stopFreq?: number
  pointsPerDecade?: number
  sweepType?: 'linear' | 'decade' | 'octave'

  // DC analysis
  source?: string
  startValue?: number
  stopValue?: number
  stepValue?: number

  // Noise analysis
  outputNode?: string
  inputSource?: string

  // Monte Carlo
  iterations?: number
  seed?: number

  // General
  temperature?: number
  abstol?: number
  reltol?: number
  vntol?: number
  chgtol?: number
}

// ── Assistant chat ────────────────────────────────────────────────────────────

export interface AIMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata?: {
    type?: 'component_suggestion' | 'circuit_analysis' | 'optimization' | 'general'
    components?: string[]
    confidence?: number
    actions?: string[]
  }
}

// ── Accounts ──────────────────────────────────────────────────────────────────

export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  /** Governance role from the deployment's `profiles` row; `user` means unassigned. */
  role: 'owner' | 'admin' | 'engineer' | 'viewer' | 'user'
}
