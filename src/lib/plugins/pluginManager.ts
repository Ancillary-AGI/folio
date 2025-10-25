import { Plugin, PluginAPI, PluginManifest, PluginContext } from '../../types/plugins'
import { EventEmitter } from 'events'

export interface PluginLoadResult {
  success: boolean
  plugin?: Plugin
  error?: string
}

export interface PluginRegistry {
  [pluginId: string]: Plugin
}

export class PluginManager extends EventEmitter {
  private plugins: PluginRegistry = {}
  private loadedPlugins: Set<string> = new Set()
  private pluginContexts: Map<string, PluginContext> = new Map()
  private api: PluginAPI

  constructor() {
    super()
    this.api = this.createPluginAPI()
    this.initializeBuiltInPlugins()
  }

  private createPluginAPI(): PluginAPI {
    return {
      // Component management
      addComponent: (component) => {
        this.emit('component:add', component)
      },
      removeComponent: (id) => {
        this.emit('component:remove', id)
      },
      updateComponent: (id, updates) => {
        this.emit('component:update', { id, updates })
      },

      // Circuit manipulation
      addWire: (wire) => {
        this.emit('wire:add', wire)
      },
      removeWire: (id) => {
        this.emit('wire:remove', id)
      },

      // Simulation
      runSimulation: async (parameters) => {
        return new Promise((resolve, reject) => {
          this.emit('simulation:run', { parameters, resolve, reject })
        })
      },

      // UI
      showNotification: (message, type = 'info') => {
        this.emit('ui:notification', { message, type })
      },
      openDialog: (content) => {
        this.emit('ui:dialog', content)
      },

      // Events
      on: (event, callback) => {
        this.on(event, callback)
      },
      off: (event, callback) => {
        this.off(event, callback)
      },
      emit: (event, data) => {
        this.emit(event, data)
      }
    }
  }

  private initializeBuiltInPlugins(): void {
    // Register built-in plugins
    this.registerBuiltInPlugin('circuit-validation', {
      id: 'circuit-validation',
      name: 'Circuit Validation',
      version: '1.0.0',
      description: 'Built-in circuit validation and design rule checking',
      author: 'Circuit CAD Team',
      enabled: true,
      permissions: ['read:circuit', 'validate:circuit'],
      entry: 'builtin://circuit-validation'
    })

    this.registerBuiltInPlugin('export-tools', {
      id: 'export-tools',
      name: 'Export Tools',
      version: '1.0.0',
      description: 'Enhanced export capabilities for various formats',
      author: 'Circuit CAD Team',
      enabled: true,
      permissions: ['read:circuit', 'export:circuit'],
      entry: 'builtin://export-tools'
    })

    this.registerBuiltInPlugin('simulation-extensions', {
      id: 'simulation-extensions',
      name: 'Simulation Extensions',
      version: '1.0.0',
      description: 'Extended simulation capabilities and analysis tools',
      author: 'Circuit CAD Team',
      enabled: true,
      permissions: ['read:circuit', 'simulate:circuit'],
      entry: 'builtin://simulation-extensions'
    })
  }

  private registerBuiltInPlugin(id: string, manifest: PluginManifest): void {
    const plugin: Plugin = {
      ...manifest,
      instance: null,
      context: this.createPluginContext(id),
      status: 'loaded'
    }
    
    this.plugins[id] = plugin
    this.loadedPlugins.add(id)
    this.pluginContexts.set(id, plugin.context)
  }

  private createPluginContext(pluginId: string): PluginContext {
    return {
      pluginId,
      sandbox: this.createSandbox(),
      permissions: this.plugins[pluginId]?.permissions || [],
      storage: new Map(),
      events: new EventEmitter()
    }
  }

  private createSandbox(): any {
    // Create a sandboxed environment for plugins
    const sandbox = {
      // Safe console methods
      console: {
        log: (...args: any[]) => console.log(`[Plugin]`, ...args),
        warn: (...args: any[]) => console.warn(`[Plugin]`, ...args),
        error: (...args: any[]) => console.error(`[Plugin]`, ...args)
      },
      
      // Safe Math and Date
      Math,
      Date,
      
      // Safe JSON
      JSON,
      
      // Safe Array and Object methods
      Array,
      Object,
      
      // Plugin API (will be injected)
      api: null as PluginAPI | null
    }

    return sandbox
  }

  async loadPlugin(manifest: PluginManifest, pluginCode?: string): Promise<PluginLoadResult> {
    try {
      // Validate manifest
      const validation = this.validateManifest(manifest)
      if (!validation.valid) {
        return {
          success: false,
          error: `Invalid manifest: ${validation.errors.join(', ')}`
        }
      }

      // Check if plugin is already loaded
      if (this.plugins[manifest.id]) {
        return {
          success: false,
          error: `Plugin ${manifest.id} is already loaded`
        }
      }

      // Create plugin context
      const context = this.createPluginContext(manifest.id)
      this.pluginContexts.set(manifest.id, context)

      // Load plugin code
      let instance: any = null
      if (pluginCode) {
        instance = await this.loadPluginCode(manifest, pluginCode, context)
      } else if (manifest.entry.startsWith('builtin://')) {
        instance = await this.loadBuiltInPlugin(manifest.entry)
      } else {
        // Load external plugin
        instance = await this.loadExternalPlugin(manifest.entry)
      }

      // Create plugin object
      const plugin: Plugin = {
        ...manifest,
        instance,
        context,
        status: 'loaded'
      }

      // Initialize plugin
      if (instance && typeof instance.init === 'function') {
        await this.safeExecute(() => instance.init(this.api, context), context)
      }

      // Register plugin
      this.plugins[manifest.id] = plugin
      this.loadedPlugins.add(manifest.id)

      // Emit plugin loaded event
      this.emit('plugin:loaded', plugin)

      return {
        success: true,
        plugin
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  private async loadPluginCode(manifest: PluginManifest, code: string, context: PluginContext): Promise<any> {
    // Create a sandboxed execution environment
    const sandbox = context.sandbox
    sandbox.api = this.api

    // Create a function that executes the plugin code in the sandbox
    const executeCode = new Function(
      'sandbox',
      `
      with (sandbox) {
        ${code}
        
        // Return the plugin object if it exists
        if (typeof module !== 'undefined' && module.exports) {
          return module.exports;
        }
        
        // Or return the global plugin object
        if (typeof Plugin !== 'undefined') {
          return Plugin;
        }
        
        return null;
      }
      `
    )

    return executeCode(sandbox)
  }

  private async loadBuiltInPlugin(entry: string): Promise<any> {
    const pluginType = entry.replace('builtin://', '')
    
    switch (pluginType) {
      case 'circuit-validation':
        return await import('./builtin/circuitValidation')
      case 'export-tools':
        return await import('./builtin/exportTools')
      case 'simulation-extensions':
        return await import('./builtin/simulationExtensions')
      default:
        throw new Error(`Unknown built-in plugin: ${pluginType}`)
    }
  }

  private async loadExternalPlugin(entry: string): Promise<any> {
    // Load external plugin from URL or local path
    try {
      const response = await fetch(entry)
      const code = await response.text()
      
      // Create a temporary context for loading
      const tempContext = this.createPluginContext('temp')
      return await this.loadPluginCode({ id: 'temp', name: '', version: '', description: '', author: '', enabled: true, permissions: [], entry }, code, tempContext)
    } catch (error) {
      throw new Error(`Failed to load external plugin: ${error}`)
    }
  }

  private validateManifest(manifest: PluginManifest): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    if (!manifest.id || typeof manifest.id !== 'string') {
      errors.push('Plugin ID is required and must be a string')
    }

    if (!manifest.name || typeof manifest.name !== 'string') {
      errors.push('Plugin name is required and must be a string')
    }

    if (!manifest.version || typeof manifest.version !== 'string') {
      errors.push('Plugin version is required and must be a string')
    }

    if (!manifest.description || typeof manifest.description !== 'string') {
      errors.push('Plugin description is required and must be a string')
    }

    if (!manifest.author || typeof manifest.author !== 'string') {
      errors.push('Plugin author is required and must be a string')
    }

    if (!Array.isArray(manifest.permissions)) {
      errors.push('Plugin permissions must be an array')
    }

    if (!manifest.entry || typeof manifest.entry !== 'string') {
      errors.push('Plugin entry point is required and must be a string')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  private async safeExecute<T>(fn: () => T | Promise<T>, context: PluginContext): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      this.emit('plugin:error', {
        pluginId: context.pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      throw error
    }
  }

  async unloadPlugin(pluginId: string): Promise<boolean> {
    const plugin = this.plugins[pluginId]
    if (!plugin) {
      return false
    }

    try {
      // Call plugin cleanup if available
      if (plugin.instance && typeof plugin.instance.cleanup === 'function') {
        await this.safeExecute(() => plugin.instance.cleanup(), plugin.context)
      }

      // Remove from registry
      delete this.plugins[pluginId]
      this.loadedPlugins.delete(pluginId)
      this.pluginContexts.delete(pluginId)

      // Emit plugin unloaded event
      this.emit('plugin:unloaded', pluginId)

      return true
    } catch (error) {
      this.emit('plugin:error', {
        pluginId,
        error: error instanceof Error ? error.message : 'Unknown error'
      })
      return false
    }
  }

  enablePlugin(pluginId: string): boolean {
    const plugin = this.plugins[pluginId]
    if (!plugin) {
      return false
    }

    plugin.enabled = true
    this.emit('plugin:enabled', plugin)
    return true
  }

  disablePlugin(pluginId: string): boolean {
    const plugin = this.plugins[pluginId]
    if (!plugin) {
      return false
    }

    plugin.enabled = false
    this.emit('plugin:disabled', plugin)
    return true
  }

  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins[pluginId]
  }

  getAllPlugins(): Plugin[] {
    return Object.values(this.plugins)
  }

  getEnabledPlugins(): Plugin[] {
    return Object.values(this.plugins).filter(plugin => plugin.enabled)
  }

  getPluginContext(pluginId: string): PluginContext | undefined {
    return this.pluginContexts.get(pluginId)
  }

  async executePluginMethod(pluginId: string, method: string, ...args: any[]): Promise<any> {
    const plugin = this.plugins[pluginId]
    if (!plugin || !plugin.enabled) {
      throw new Error(`Plugin ${pluginId} is not available or disabled`)
    }

    if (!plugin.instance || typeof plugin.instance[method] !== 'function') {
      throw new Error(`Method ${method} not found in plugin ${pluginId}`)
    }

    return await this.safeExecute(() => plugin.instance[method](...args), plugin.context)
  }

  // Plugin discovery and marketplace integration
  async discoverPlugins(query?: string): Promise<PluginManifest[]> {
    // This would integrate with a plugin marketplace/registry
    // For now, return empty array
    return []
  }

  async installPlugin(pluginId: string, version?: string): Promise<PluginLoadResult> {
    // This would download and install plugins from marketplace
    // For now, return error
    return {
      success: false,
      error: 'Plugin marketplace not yet implemented'
    }
  }

  // Cleanup
  dispose(): void {
    // Unload all plugins
    Object.keys(this.plugins).forEach(pluginId => {
      this.unloadPlugin(pluginId)
    })

    // Clear all data
    this.plugins = {}
    this.loadedPlugins.clear()
    this.pluginContexts.clear()

    // Remove all listeners
    this.removeAllListeners()
  }
}

// Export singleton instance
export const pluginManager = new PluginManager()
