// Core application types
export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

// Component and Circuit Types
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

// Legacy interface for compatibility with PropertiesPanel
export interface ComponentInstance {
  id: string
  reference: string
  component: {
    name: string
    category: string
    pins: Array<{
      id: string
      name: string
      type: string
    }>
  }
  properties: Record<string, string | number | boolean>
  x: number
  y: number
  rotation?: number
  locked?: boolean
  visible?: boolean
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

export interface Net {
  id: string
  name: string
  connectedPins: Array<{
    componentId: string
    pinId: string
  }>
  wires: string[]
}

// Schematic and Project Types
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

export interface Project {
  id: string
  name: string
  description?: string
  schematics: Schematic[]
  libraries: string[]
  metadata: {
    created: string
    modified: string
    version: string
    author?: string
    tags?: string[]
  }
  settings: {
    defaultUnits: 'metric' | 'imperial'
    defaultVoltage: number
    defaultCurrent: number
  }
}

// Simulation Types
export interface SimulationModel {
  type: string
  parameters: Record<string, number | string>
}

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

// AI and MCP Types
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

export interface ComponentSuggestion {
  component: string
  reason: string
  confidence: number
  alternatives: Array<{
    component: string
    reason: string
    confidence: number
  }>
  cost?: number
  availability?: string
}

export interface CircuitAnalysis {
  issues: Array<{
    type: 'error' | 'warning' | 'info'
    message: string
    suggestion?: string
    componentId?: string
    severity: 'low' | 'medium' | 'high'
  }>
  optimizations: Array<{
    type: 'performance' | 'cost' | 'power' | 'reliability' | 'size'
    description: string
    impact: 'low' | 'medium' | 'high'
    implementation: string
    estimatedSavings?: number
  }>
  metrics: {
    estimatedCost?: number
    estimatedPower?: number
    componentCount: number
    netCount: number
    complexity: 'simple' | 'moderate' | 'complex'
  }
}

export interface MCPTool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
}

export interface MCPResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

// UI and Application Types
export interface Theme {
  name: string
  colors: {
    background: string
    foreground: string
    primary: string
    secondary: string
    accent: string
    muted: string
    border: string
    // Circuit-specific
    wire: string
    component: string
    pin: string
    grid: string
    selection: string
  }
}

export interface ViewportState {
  zoom: number
  pan: Point
  canvasSize: Size
  gridSize: number
  snapToGrid: boolean
  showGrid: boolean
}

export interface SelectionState {
  components: string[]
  wires: string[]
  area?: Bounds
}

export interface ToolState {
  activeTool: 'select' | 'wire' | 'component' | 'text' | 'measure' | 'delete'
  selectedComponent?: Component
  wireInProgress?: {
    points: Point[]
    currentPoint?: Point
  }
}

// Export and Import Types
export interface ExportOptions {
  format: 'png' | 'svg' | 'pdf' | 'netlist' | 'json' | 'gerber'
  resolution?: number
  includeGrid?: boolean
  includeAnnotations?: boolean
  colorScheme?: 'color' | 'monochrome'
}

export interface ImportResult {
  success: boolean
  error?: string
  components?: PlacedComponent[]
  wires?: Wire[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any
}

// Plugin and Extension Types
export interface Plugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
  permissions: string[]
  entry: string
}

export interface PluginAPI {
  // Component management
  addComponent: (component: Component) => void
  removeComponent: (id: string) => void
  updateComponent: (id: string, updates: Partial<Component>) => void
  
  // Circuit manipulation
  addWire: (wire: Wire) => void
  removeWire: (id: string) => void
  
  // Simulation
  runSimulation: (parameters: SimulationParameters) => Promise<SimulationResult>
  
  // UI
  showNotification: (message: string, type?: 'info' | 'warning' | 'error') => void
  openDialog: (content: React.ReactNode) => void
  
  // Events
  on: (event: string, callback: (...args: unknown[]) => void) => void
  off: (event: string, callback: (...args: unknown[]) => void) => void
  emit: (event: string, data?: unknown) => void
}

// Validation and Testing Types
export interface ValidationRule {
  id: string
  name: string
  description: string
  severity: 'error' | 'warning' | 'info'
  check: (schematic: Schematic) => ValidationResult[]
}

export interface ValidationResult {
  ruleId: string
  severity: 'error' | 'warning' | 'info'
  message: string
  componentId?: string
  wireId?: string
  suggestion?: string
}

export interface TestCase {
  id: string
  name: string
  description: string
  inputs: Record<string, number>
  expectedOutputs: Record<string, number>
  tolerance?: number
}

export interface TestResult {
  testCaseId: string
  passed: boolean
  actualOutputs: Record<string, number>
  error?: string
}

// Collaboration Types
export interface User {
  id: string
  name: string
  email: string
  avatar?: string
  role: 'owner' | 'editor' | 'viewer'
}

export interface CollaborativeUser extends User {
  color: string
  isActive: boolean
  lastSeen: number
  cursor?: Point
  selection?: { start: Point; end: Point }
}

export interface CollaborationSession {
  id: string
  projectId: string
  users: User[]
  changes: Array<{
    id: string
    userId: string
    timestamp: number
    type: 'component_added' | 'component_removed' | 'component_moved' | 'wire_added' | 'wire_removed'
    data: Record<string, unknown>
  }>
}

export interface Comment {
  id: string
  userId: string
  position: Point
  content: string
  timestamp: number
  resolved?: boolean
  replies?: Comment[]
}