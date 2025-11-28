// Domain-specific types for better type safety and organization

// ===== AUTHENTICATION TYPES =====
export interface User {
  id: string
  email: string
  name: string
  avatar?: string
  role: 'admin' | 'user' | 'viewer'
  preferences: UserPreferences
  createdAt: Date
  lastLoginAt: Date
}

export interface UserPreferences {
  theme: 'light' | 'dark' | 'system'
  language: string
  timezone: string
  notifications: NotificationSettings
}

export interface NotificationSettings {
  email: boolean
  push: boolean
  projectUpdates: boolean
  collaboration: boolean
}

// ===== PROJECT MANAGEMENT TYPES =====
export interface Project {
  id: string
  name: string
  description: string
  ownerId: string
  collaborators: Collaborator[]
  settings: ProjectSettings
  metadata: ProjectMetadata
  createdAt: Date
  updatedAt: Date
}

export interface Collaborator {
  userId: string
  role: 'owner' | 'editor' | 'viewer'
  permissions: Permission[]
  invitedAt: Date
  joinedAt?: Date
}

export interface Permission {
  resource: 'project' | 'schematic' | 'simulation' | 'component'
  actions: ('read' | 'write' | 'delete' | 'share')[]
}

export interface ProjectSettings {
  visibility: 'private' | 'team' | 'public'
  allowComments: boolean
  requireApproval: boolean
  autoSave: boolean
  versionControl: boolean
}

export interface ProjectMetadata {
  tags: string[]
  category: string
  license?: string
  version: string
  thumbnail?: string
}

// ===== SCHEMATIC TYPES =====
export interface Schematic {
  id: string
  projectId: string
  name: string
  description?: string
  components: PlacedComponent[]
  wires: Wire[]
  nets: Net[]
  sheets: Sheet[]
  settings: SchematicSettings
  metadata: SchematicMetadata
}

export interface Sheet {
  id: string
  name: string
  components: PlacedComponent[]
  wires: Wire[]
  bounds: Bounds
  scale: number
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
  locked: boolean
  visible: boolean
  selected: boolean
}

export interface Component {
  id: string
  name: string
  category: ComponentCategory
  description?: string
  symbol: ComponentSymbol
  pins: Pin[]
  properties: ComponentProperties
  footprint?: Footprint
  datasheet?: string
  manufacturer?: Manufacturer
  partNumber?: string
  cost?: Price
  availability: Availability
  tags: string[]
  metadata: ComponentMetadata
}

export interface ComponentCategory {
  id: string
  name: string
  parentId?: string
  icon?: string
  color?: string
}

export interface ComponentSymbol {
  width: number
  height: number
  paths: string[]
  circles?: Circle[]
  rectangles?: Rectangle[]
  text?: TextElement[]
  pins: SymbolPin[]
}

export interface SymbolPin {
  id: string
  position: Point
  orientation: 'left' | 'right' | 'top' | 'bottom'
  length: number
  name?: string
  number?: string
}

export interface Pin {
  id: string
  name: string
  number: string
  position: Point
  type: PinType
  electricalType: ElectricalType
  connected: boolean
}

export type PinType = 'input' | 'output' | 'bidirectional' | 'passive' | 'power' | 'ground' | 'nc'
export type ElectricalType = 'digital' | 'analog' | 'power' | 'ground' | 'rf' | 'mixed'

export interface ComponentProperties {
  [key: string]: PropertyValue
}

export type PropertyValue = string | number | boolean | Point | Range

export interface Range {
  min: number
  max: number
  unit?: string
}

export interface Footprint {
  id: string
  name: string
  pads: Pad[]
  dimensions: Dimensions
  mounting: MountingType
  library: string
}

export interface Pad {
  id: string
  shape: 'circle' | 'rectangle' | 'oval' | 'polygon'
  position: Point
  size: Size
  drillDiameter?: number
  layers: Layer[]
  netId?: string
}

export type MountingType = 'through-hole' | 'surface-mount' | 'mixed'

export interface Manufacturer {
  id: string
  name: string
  website?: string
  contact?: ContactInfo
}

export interface Price {
  currency: string
  amount: number
  quantity: number
  supplier?: string
  lastUpdated: Date
}

export interface Availability {
  status: 'available' | 'limited' | 'obsolete' | 'discontinued'
  quantity?: number
  leadTime?: string
  suppliers: Supplier[]
}

export interface Supplier {
  name: string
  partNumber: string
  url?: string
  stock: number
}

export interface ComponentMetadata {
  createdAt: Date
  updatedAt: Date
  author: string
  version: string
  license?: string
  tags: string[]
}

// ===== WIRE AND NET TYPES =====
export interface Wire {
  id: string
  points: Point[]
  netId?: string
  connectedPins: WireConnection[]
  style: WireStyle
  selected: boolean
  locked: boolean
}

export interface WireConnection {
  componentId: string
  pinId: string
  position: Point
}

export interface WireStyle {
  color: string
  width: number
  dashArray?: number[]
  opacity: number
}

export interface Net {
  id: string
  name: string
  class: NetClass
  connectedPins: NetConnection[]
  wires: string[]
  properties: NetProperties
}

export interface NetConnection {
  componentId: string
  pinId: string
  position: Point
}

export interface NetClass {
  id: string
  name: string
  color: string
  priority: number
  clearance: number
  trackWidth: number
  viaDiameter: number
}

export interface NetProperties {
  voltage?: number
  current?: number
  impedance?: number
  frequency?: number
  critical: boolean
}

// ===== PCB TYPES =====
export interface PCB {
  id: string
  name: string
  projectId: string
  dimensions: Dimensions
  layers: Layer[]
  components: PCBComponent[]
  traces: Trace[]
  vias: Via[]
  zones: Zone[]
  designRules: DesignRules
  settings: PCBSettings
  metadata: PCBMetadata
}

export interface Layer {
  id: string
  name: string
  type: LayerType
  thickness: number
  material: string
  color?: string
  visible: boolean
  enabled: boolean
}

export type LayerType = 'copper' | 'solder_mask' | 'silk_screen' | 'drill' | 'dielectric'

export interface PCBComponent {
  id: string
  componentId: string
  footprintId: string
  position: Point
  rotation: number
  side: 'top' | 'bottom'
  locked: boolean
  properties: ComponentProperties
}

export interface Trace {
  id: string
  netId: string
  layerId: string
  width: number
  points: Point[]
  clearance: number
  locked: boolean
}

export interface Via {
  id: string
  position: Point
  diameter: number
  drillDiameter: number
  layers: string[]
  netId?: string
  type: ViaType
}

export type ViaType = 'through' | 'blind' | 'buried'

export interface Zone {
  id: string
  netId?: string
  layerId: string
  outline: Point[]
  fillStyle: FillStyle
  clearance: number
  connected: boolean
}

export interface FillStyle {
  type: 'solid' | 'hatch' | 'none'
  density?: number
  orientation?: number
}

export interface DesignRules {
  minTraceWidth: number
  minTraceSpacing: number
  minViaDiameter: number
  minViaDrillDiameter: number
  minPadDiameter: number
  minHoleDiameter: number
  copperThickness: number
  solderMaskClearance: number
  silkScreenClearance: number
  electricalClearance: ClearanceRules
}

export interface ClearanceRules {
  copperToCopper: number
  copperToPad: number
  padToPad: number
  viaToVia: number
  viaToTrace: number
}

export interface PCBSettings {
  units: 'mm' | 'mil' | 'inch'
  gridSize: number
  snapToGrid: boolean
  showGrid: boolean
  showRatsnest: boolean
  showDRC: boolean
  autoroute: boolean
}

export interface PCBMetadata {
  createdAt: Date
  updatedAt: Date
  author: string
  version: string
  revision: string
  description?: string
}

// ===== SIMULATION TYPES =====
export interface Simulation {
  id: string
  name: string
  type: SimulationType
  schematicId: string
  parameters: SimulationParameters
  results: SimulationResult[]
  status: SimulationStatus
  progress: number
  createdAt: Date
  completedAt?: Date
}

export type SimulationType = 'dc' | 'ac' | 'transient' | 'noise' | 'montecarlo' | 'thermal' | 'mechanical'

export interface SimulationParameters {
  [key: string]: SimulationParameter
}

export interface SimulationParameter {
  value: number | string | boolean
  unit?: string
  description?: string
  min?: number
  max?: number
  step?: number
}

export interface SimulationResult {
  id: string
  simulationId: string
  timestamp: Date
  data: SimulationData
  waveforms: Waveform[]
  operatingPoint?: OperatingPoint
  convergence: ConvergenceInfo
  statistics: SimulationStatistics
}

export interface SimulationData {
  nodes: NodeResult[]
  elements: ElementResult[]
  measurements: Measurement[]
}

export interface NodeResult {
  nodeId: string
  voltage?: number
  current?: number
  temperature?: number
  stress?: number
  strain?: number
}

export interface ElementResult {
  elementId: string
  power?: number
  energy?: number
  resistance?: number
  capacitance?: number
  inductance?: number
}

export interface Measurement {
  name: string
  value: number
  unit: string
  tolerance?: number
}

export interface Waveform {
  name: string
  type: WaveformType
  unit: string
  data: Point[]
  color: string
  visible: boolean
}

export type WaveformType = 'voltage' | 'current' | 'power' | 'temperature' | 'frequency' | 'phase'

export interface OperatingPoint {
  [nodeId: string]: {
    voltage?: number
    current?: number
    power?: number
  }
}

export interface ConvergenceInfo {
  iterations: number
  converged: boolean
  residual: number
  error?: string
}

export interface SimulationStatistics {
  simulationTime: number
  memoryUsage: number
  nodeCount: number
  elementCount: number
  convergenceRate: number
}

export type SimulationStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

// ===== COMMON GEOMETRY TYPES =====
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

export interface Dimensions {
  width: number
  height: number
  depth?: number
}

export interface Circle {
  center: Point
  radius: number
}

export interface Rectangle {
  position: Point
  size: Size
}

export interface TextElement {
  position: Point
  text: string
  size: number
  rotation?: number
  anchor?: 'start' | 'middle' | 'end'
}

// ===== UI AND APPLICATION TYPES =====
export interface Viewport {
  zoom: number
  pan: Point
  bounds: Bounds
  gridSize: number
  snapToGrid: boolean
  showGrid: boolean
  showRulers: boolean
}

export interface Selection {
  type: 'single' | 'multiple' | 'area'
  items: SelectionItem[]
  bounds?: Bounds
}

export interface SelectionItem {
  type: 'component' | 'wire' | 'trace' | 'via' | 'zone'
  id: string
  position: Point
}

export interface Tool {
  id: string
  name: string
  icon: string
  category: ToolCategory
  shortcut?: string
  enabled: boolean
}

export type ToolCategory = 'selection' | 'drawing' | 'placement' | 'measurement' | 'simulation'

export interface ApplicationSettings {
  theme: 'light' | 'dark' | 'system'
  language: string
  units: 'metric' | 'imperial'
  gridSize: number
  snapToGrid: boolean
  autoSave: boolean
  autoSaveInterval: number
  showTooltips: boolean
  showAnimations: boolean
  performance: PerformanceSettings
}

export interface PerformanceSettings {
  maxUndoSteps: number
  canvasResolution: number
  simulationPrecision: number
  enableHardwareAcceleration: boolean
}

// ===== ERROR AND VALIDATION TYPES =====
export interface ValidationError {
  id: string
  type: ErrorType
  severity: ErrorSeverity
  message: string
  location?: ErrorLocation
  suggestion?: string
  ruleId?: string
}

export type ErrorType = 'schematic' | 'pcb' | 'simulation' | 'electrical' | 'mechanical' | 'thermal'
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical'

export interface ErrorLocation {
  fileId?: string
  componentId?: string
  elementId?: string
  position?: Point
  sheetId?: string
}

export interface ValidationRule {
  id: string
  name: string
  description: string
  category: string
  severity: ErrorSeverity
  enabled: boolean
  check: (context: ValidationContext) => ValidationError[]
}

export interface ValidationContext {
  schematic?: Schematic
  pcb?: PCB
  simulation?: Simulation
  settings?: ApplicationSettings
}

// ===== COLLABORATION TYPES =====
export interface CollaborationSession {
  id: string
  projectId: string
  participants: Participant[]
  activeUsers: string[]
  changes: Change[]
  cursors: Cursor[]
  selections: UserSelection[]
  createdAt: Date
  lastActivity: Date
}

export interface Participant {
  userId: string
  role: 'owner' | 'editor' | 'viewer'
  joinedAt: Date
  lastSeen: Date
  active: boolean
}

export interface Change {
  id: string
  userId: string
  timestamp: Date
  type: ChangeType
  target: ChangeTarget
  before?: unknown
  after?: unknown
  description: string
}

export type ChangeType = 'create' | 'update' | 'delete' | 'move' | 'rotate' | 'connect' | 'disconnect'
export type ChangeTarget = 'component' | 'wire' | 'trace' | 'via' | 'zone' | 'net' | 'simulation'

export interface Cursor {
  userId: string
  position: Point
  visible: boolean
}

export interface UserSelection {
  userId: string
  items: SelectionItem[]
  bounds?: Bounds
}

// ===== UTILITY TYPES =====
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>

// Note: Using TypeScript's built-in Required<T> type

export type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}

// ===== CONTACT AND ORGANIZATION TYPES =====
export interface ContactInfo {
  email?: string
  phone?: string
  address?: Address
  website?: string
}

export interface Address {
  street: string
  city: string
  state: string
  postalCode: string
  country: string
}

export interface Organization {
  id: string
  name: string
  type: 'manufacturer' | 'supplier' | 'distributor' | 'university' | 'research' | 'other'
  contact: ContactInfo
  description?: string
  logo?: string
}

// ===== EXPORT AND IMPORT TYPES =====
export interface ExportOptions {
  format: ExportFormat
  includeLayers?: string[]
  resolution?: number
  quality?: number
  includeMetadata: boolean
  compress: boolean
}

export type ExportFormat = 'pdf' | 'png' | 'svg' | 'gerber' | 'netlist' | 'json' | 'step' | 'iges'

export interface ImportResult {
  success: boolean
  errors: string[]
  warnings: string[]
  data: {
    schematic?: Schematic
    pcb?: PCB
    components?: Component[]
    libraries?: ComponentLibrary[]
  }
}

export interface ComponentLibrary {
  id: string
  name: string
  description?: string
  components: Component[]
  categories: ComponentCategory[]
  version: string
  author: string
  createdAt: Date
  updatedAt: Date
}

// ===== SCHEMATIC SETTINGS =====
export interface SchematicSettings {
  units: 'mm' | 'mil' | 'inch'
  gridSize: number
  snapToGrid: boolean
  showGrid: boolean
  showRulers: boolean
  showPinNumbers: boolean
  showPinNames: boolean
  showNetNames: boolean
  showComponentValues: boolean
  backgroundColor: string
  gridColor: string
  selectionColor: string
}

export interface SchematicMetadata {
  createdAt: Date
  updatedAt: Date
  author: string
  version: string
  revision: string
  description?: string
  tags: string[]
}