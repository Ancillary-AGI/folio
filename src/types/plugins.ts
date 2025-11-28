// Plugin System Types and Interfaces

export interface PluginManifest {
  id: string
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
  permissions: string[]
  entry: string
  dependencies?: PluginDependency[]
  minAppVersion?: string
  maxAppVersion?: string
  tags?: string[]
  icon?: string
  homepage?: string
  repository?: string
  license?: string
}

export interface PluginDependency {
  id: string
  version: string
  optional?: boolean
}

export interface PluginSandbox {
  execute: (code: string, context: Record<string, unknown>) => unknown
  createContext: (permissions: string[]) => Record<string, unknown>
  validateCode: (code: string) => { valid: boolean; errors: string[] }
}

export interface EventEmitter {
  on: (event: string, callback: (...args: unknown[]) => void) => void
  off: (event: string, callback: (...args: unknown[]) => void) => void
  emit: (event: string, data?: unknown) => void
}

export interface PluginContext {
  pluginId: string
  sandbox: PluginSandbox
  permissions: string[]
  storage: Map<string, unknown>
  events: EventEmitter
}

export interface PluginInstance {
  init?: (api: PluginAPI, context: PluginContext) => Promise<void> | void
  cleanup?: () => Promise<void> | void
  [key: string]: unknown
}

export interface Plugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  enabled: boolean
  permissions: string[]
  entry: string
  dependencies?: PluginDependency[]
  minAppVersion?: string
  maxAppVersion?: string
  tags?: string[]
  icon?: string
  homepage?: string
  repository?: string
  license?: string
  instance?: PluginInstance
  context?: PluginContext
  status: 'loading' | 'loaded' | 'error' | 'disabled'
  error?: string
}

export interface CircuitComponent {
  id: string
  type: string
  position: { x: number; y: number }
  properties: Record<string, unknown>
}

export interface CircuitWire {
  id: string
  from: { componentId: string; pinId: string }
  to: { componentId: string; pinId: string }
  points: Array<{ x: number; y: number }>
}

export interface SimulationParameters {
  duration: number
  timeStep: number
  initialConditions: Record<string, unknown>
}

export interface SimulationResult {
  success: boolean
  data: Record<string, unknown>
  errors: string[]
}

export interface PluginAPI {
  // Component management
  addComponent: (component: CircuitComponent) => void
  removeComponent: (id: string) => void
  updateComponent: (id: string, updates: Partial<CircuitComponent>) => void

  // Circuit manipulation
  addWire: (wire: CircuitWire) => void
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


// Plugin Event Types
export interface PluginEvent {
  type: string
  pluginId: string
  data?: unknown
  timestamp: number
}

// Plugin Storage
export interface PluginStorage {
  get: (key: string) => unknown
  set: (key: string, value: unknown) => void
  remove: (key: string) => void
  clear: () => void
  keys: () => string[]
}

// Plugin Permissions
export const PLUGIN_PERMISSIONS = {
  // Circuit permissions
  'read:circuit': 'Read circuit data',
  'write:circuit': 'Modify circuit data',
  'delete:circuit': 'Delete circuit elements',
  
  // Component permissions
  'read:components': 'Read component library',
  'write:components': 'Add/modify components',
  'delete:components': 'Delete components',
  
  // Simulation permissions
  'simulate:circuit': 'Run circuit simulations',
  'read:simulation': 'Read simulation results',
  
  // Export permissions
  'export:circuit': 'Export circuit designs',
  'import:circuit': 'Import circuit designs',
  
  // UI permissions
  'ui:notifications': 'Show notifications',
  'ui:dialogs': 'Open dialogs',
  'ui:panels': 'Add UI panels',
  
  // Network permissions
  'network:fetch': 'Make network requests',
  'network:websocket': 'Use WebSocket connections',
  
  // File permissions
  'file:read': 'Read local files',
  'file:write': 'Write local files',
  
  // System permissions
  'system:storage': 'Access persistent storage',
  'system:events': 'Listen to system events'
} as const

export type PluginPermission = keyof typeof PLUGIN_PERMISSIONS

// Plugin Marketplace Types
export interface PluginMarketplace {
  plugins: PluginManifest[]
  categories: string[]
  featured: string[]
  trending: string[]
  search: (query: string) => Promise<PluginManifest[]>
  getPlugin: (id: string) => Promise<PluginManifest | null>
  install: (id: string, version?: string) => Promise<boolean>
  uninstall: (id: string) => Promise<boolean>
  update: (id: string) => Promise<boolean>
}

export interface PluginCategory {
  id: string
  name: string
  description: string
  icon?: string
  plugins: string[]
}

// Plugin Development Types
export interface PluginDevelopmentKit {
  createManifest: (config: Partial<PluginManifest>) => PluginManifest
  validateManifest: (manifest: PluginManifest) => { valid: boolean; errors: string[] }
  buildPlugin: (sourcePath: string, outputPath: string) => Promise<void>
  testPlugin: (pluginPath: string) => Promise<{ success: boolean; errors: string[] }>
  packagePlugin: (pluginPath: string, outputPath: string) => Promise<void>
}

// Plugin Hooks and Extensions
export interface PluginHook {
  name: string
  pluginId: string
  callback: (...args: unknown[]) => unknown
  priority?: number
}

export interface PluginExtension {
  type: 'component' | 'tool' | 'panel' | 'menu' | 'shortcut'
  pluginId: string
  data: unknown
}

// Plugin Security
export interface PluginSecurityPolicy {
  allowNetwork: boolean
  allowFileAccess: boolean
  allowSystemAccess: boolean
  maxMemoryUsage: number
  maxExecutionTime: number
  allowedDomains: string[]
  blockedDomains: string[]
}


// Plugin Lifecycle Events
export const PLUGIN_EVENTS = {
  LOADED: 'plugin:loaded',
  UNLOADED: 'plugin:unloaded',
  ENABLED: 'plugin:enabled',
  DISABLED: 'plugin:disabled',
  ERROR: 'plugin:error',
  INITIALIZED: 'plugin:initialized',
  CLEANUP: 'plugin:cleanup'
} as const

export type PluginEventType = typeof PLUGIN_EVENTS[keyof typeof PLUGIN_EVENTS]
