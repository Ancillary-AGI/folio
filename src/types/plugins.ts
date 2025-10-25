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

export interface PluginContext {
  pluginId: string
  sandbox: any
  permissions: string[]
  storage: Map<string, any>
  events: EventEmitter
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
  instance?: any
  context?: PluginContext
  status: 'loading' | 'loaded' | 'error' | 'disabled'
  error?: string
}

export interface PluginAPI {
  // Component management
  addComponent: (component: any) => void
  removeComponent: (id: string) => void
  updateComponent: (id: string, updates: Partial<any>) => void
  
  // Circuit manipulation
  addWire: (wire: any) => void
  removeWire: (id: string) => void
  
  // Simulation
  runSimulation: (parameters: any) => Promise<any>
  
  // UI
  showNotification: (message: string, type?: 'info' | 'warning' | 'error') => void
  openDialog: (content: React.ReactNode) => void
  
  // Events
  on: (event: string, callback: (...args: any[]) => void) => void
  off: (event: string, callback: (...args: any[]) => void) => void
  emit: (event: string, data?: any) => void
}

export interface PluginInstance {
  init?: (api: PluginAPI, context: PluginContext) => Promise<void> | void
  cleanup?: () => Promise<void> | void
  [key: string]: any
}

// Plugin Event Types
export interface PluginEvent {
  type: string
  pluginId: string
  data?: any
  timestamp: number
}

// Plugin Storage
export interface PluginStorage {
  get: (key: string) => any
  set: (key: string, value: any) => void
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
  callback: (...args: any[]) => any
  priority?: number
}

export interface PluginExtension {
  type: 'component' | 'tool' | 'panel' | 'menu' | 'shortcut'
  pluginId: string
  data: any
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

export interface PluginSandbox {
  execute: (code: string, context: any) => any
  createContext: (permissions: string[]) => any
  validateCode: (code: string) => { valid: boolean; errors: string[] }
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
