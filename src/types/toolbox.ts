// Toolbox System Types
export interface Toolbox {
  id: string
  name: string
  description: string
  icon: string
  category: 'electronics' | 'mechanics' | 'robotics' | 'programming' | 'simulation' | 'collaboration'
  version: string
  enabled: boolean
  components: ToolboxComponent[]
  tools: ToolboxTool[]
  simulations: ToolboxSimulation[]
}

export interface ToolboxComponent {
  id: string
  name: string
  type: 'electronic' | 'mechanical' | 'robotic' | 'software'
  category: string
  symbol?: ComponentSymbol
  model3d?: string
  properties: Record<string, unknown>
  ports: ComponentPort[]
}

export interface ComponentPort {
  id: string
  name: string
  type: 'digital' | 'analog' | 'pwm' | 'serial' | 'i2c' | 'spi' | 'power' | 'ground' | 'mechanical'
  direction: 'input' | 'output' | 'bidirectional'
  position: Point
}

export interface ToolboxTool {
  id: string
  name: string
  description: string
  icon: string
  category: 'design' | 'analysis' | 'programming' | 'deployment'
  action: (context: ToolContext) => Promise<ToolResult>
  ui?: React.ComponentType<ToolProps>
}

export interface ToolContext {
  project: Project
  selection: SelectionState
  canvas: CanvasState
  user: User
}

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
  ui?: React.ReactNode
}

export interface ToolProps {
  context: ToolContext
  onResult: (result: ToolResult) => void
}

export interface ToolboxSimulation {
  id: string
  name: string
  type: 'circuit' | 'mechanical' | 'thermal' | 'fluid' | 'electromagnetic' | 'multiphysics'
  engine: 'spice' | 'fem' | 'cfd' | 'custom'
  parameters: SimulationParameters
  results: SimulationResult[]
}

// Robotics Toolbox Types
export interface RoboticComponent {
  id: string
  type: 'sensor' | 'actuator' | 'controller' | 'power' | 'communication'
  model: string
  specifications: {
    voltage?: number
    current?: number
    interface?: string
    dimensions?: Size
    weight?: number
  }
  kinematics?: KinematicModel
  dynamics?: DynamicModel
}

export interface KinematicModel {
  type: 'serial' | 'parallel' | 'mobile' | 'hybrid'
  joints: Joint[]
  links: Link[]
  baseFrame: Frame
  toolFrame: Frame
}

export interface Joint {
  id: string
  type: 'revolute' | 'prismatic' | 'spherical' | 'planar'
  axis: Vector3
  limits: {
    min: number
    max: number
    velocity?: number
    acceleration?: number
  }
  position: Point
}

export interface Link {
  id: string
  mass: number
  inertia: Matrix3x3
  centerOfMass: Vector3
  geometry?: MeshGeometry
}

export interface Frame {
  position: Vector3
  orientation: Quaternion
}

export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Quaternion {
  w: number
  x: number
  y: number
  z: number
}

export interface Matrix3x3 {
  m11: number
  m12: number
  m13: number
  m21: number
  m22: number
  m23: number
  m31: number
  m32: number
  m33: number
}

export interface MeshGeometry {
  type: 'box' | 'cylinder' | 'sphere' | 'mesh'
  dimensions?: Size
  radius?: number
  mesh?: string // URL to STL/OBJ file
}

export interface DynamicModel {
  friction: {
    viscous: number
    coulomb: number
  }
  motor: {
    torque: number
    speed: number
    efficiency: number
  }
}

// Visual Programming Types
export interface CodeBlock {
  id: string
  type: 'function' | 'variable' | 'control' | 'operator' | 'io' | 'sensor' | 'actuator'
  name: string
  category: string
  icon: string
  inputs: CodePort[]
  outputs: CodePort[]
  parameters: CodeParameter[]
  code: string
  position: Point
  connections: CodeConnection[]
}

export interface CodePort {
  id: string
  name: string
  type: 'number' | 'string' | 'boolean' | 'array' | 'object' | 'any'
  direction: 'input' | 'output'
  position: Point
  connected: boolean
}

export interface CodeParameter {
  id: string
  name: string
  type: 'number' | 'string' | 'boolean' | 'select' | 'color'
  value: unknown
  options?: string[]
  min?: number
  max?: number
  step?: number
}

export interface CodeConnection {
  id: string
  fromBlock: string
  fromPort: string
  toBlock: string
  toPort: string
  path: Point[]
}

export interface CodeProgram {
  id: string
  name: string
  description: string
  blocks: CodeBlock[]
  targetBoard: BoardType
  generatedCode: string
  compiled: boolean
  uploaded: boolean
}

// Board Programming Types
export interface BoardType {
  id: string
  name: string
  manufacturer: string
  architecture: 'avr' | 'arm' | 'esp32' | 'rp2040' | 'stm32'
  pins: BoardPin[]
  specifications: {
    flash: number
    ram: number
    clock: number
    voltage: number
  }
  supportedLanguages: string[]
  compilers: CompilerConfig[]
}

export interface BoardPin {
  number: number
  name: string
  type: 'digital' | 'analog' | 'pwm' | 'interrupt' | 'serial' | 'i2c' | 'spi' | 'power' | 'ground'
  capabilities: string[]
  position: Point
}

export interface CompilerConfig {
  language: string
  compiler: string
  flags: string[]
  libraries: string[]
  framework?: string
}

export interface CompilationResult {
  success: boolean
  binary?: Uint8Array
  hex?: string
  size: number
  errors: string[]
  warnings: string[]
}

export interface UploadResult {
  success: boolean
  message: string
  time: number
}

// Mechanical Design Types
export interface MechanicalComponent {
  id: string
  name: string
  type: 'structural' | 'fastener' | 'bearing' | 'gear' | 'motor' | 'sensor'
  geometry: MeshGeometry
  material: Material
  constraints: MechanicalConstraint[]
  properties: Record<string, unknown>
}

export interface Material {
  name: string
  density: number
  youngsModulus: number
  poissonRatio: number
  yieldStrength: number
  ultimateStrength: number
  thermalConductivity: number
  specificHeat: number
  color?: number
}

export interface MechanicalConstraint {
  type: 'fixed' | 'revolute' | 'prismatic' | 'spherical' | 'planar'
  position: Vector3
  orientation: Quaternion
  limits?: {
    min: number
    max: number
  }
}

// Multi-Physics Simulation Types
export interface MultiPhysicsSimulation {
  id: string
  name: string
  domains: PhysicsDomain[]
  couplings: DomainCoupling[]
  boundaryConditions: BoundaryCondition[]
  materials: Material[]
  mesh: Mesh
  solver: SolverConfig
}

export interface PhysicsDomain {
  id: string
  type: 'structural' | 'thermal' | 'fluid' | 'electromagnetic' | 'acoustic'
  equations: string[]
  variables: string[]
  geometry: MeshGeometry
}

export interface DomainCoupling {
  domain1: string
  domain2: string
  type: 'thermal-structural' | 'fluid-structural' | 'electro-thermal' | 'magneto-mechanical'
  interface: string
}

export interface BoundaryCondition {
  id: string
  type: 'displacement' | 'force' | 'temperature' | 'heat_flux' | 'velocity' | 'pressure' | 'voltage' | 'current'
  value: number | string
  location: string
}

export interface Mesh {
  elements: MeshElement[]
  nodes: MeshNode[]
  quality: MeshQuality
}

export interface MeshElement {
  id: number
  type: 'tetrahedron' | 'hexahedron' | 'triangle' | 'quadrilateral'
  nodes: number[]
  material: string
}

export interface MeshNode {
  id: number
  position: Vector3
  boundary?: boolean
}

export interface MeshQuality {
  aspectRatio: number
  skewness: number
  orthogonality: number
}

export interface SolverConfig {
  type: 'direct' | 'iterative' | 'multigrid'
  tolerance: number
  maxIterations: number
  preconditioner?: string
  timeStep?: number
  endTime?: number
}

// Canvas State for Toolboxes
export interface CanvasState {
  components: unknown[] // Will be properly typed when integrated
  wires: unknown[]
  codeBlocks: CodeBlock[]
  mechanicalParts: MechanicalComponent[]
  zoom: number
  pan: Point
  gridSize: number
  snapToGrid: boolean
}

// Import existing types
import { ComponentSymbol, Point, Size, Project, SelectionState, SimulationParameters, SimulationResult, User } from './index'