/**
 * Plugin System for Platform Extensibility
 * Provides API for creating and managing plugins
 */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  entryPoint: string;
  apiVersion: string;
  dependencies?: string[];
  permissions?: string[];
  hooks?: string[];
}

export interface PluginContext {
  api: PluginAPI;
  config: Record<string, unknown>;
  storage: PluginStorage;
}

export interface PluginComponent {
  render: (props: Record<string, unknown>) => unknown;
  name: string;
}

export interface PluginSimulator {
  simulate: (config: Record<string, unknown>) => Promise<Record<string, unknown>>;
  name: string;
}

export interface PluginExporter {
  export: (data: Record<string, unknown>, options: Record<string, unknown>) => Promise<unknown>;
  name: string;
}

export interface PluginAPI {
  registerTool(tool: PluginTool): void;
  registerComponent(type: string, component: PluginComponent): void;
  registerSimulation(engine: string, simulator: PluginSimulator): void;
  registerExport(format: string, exporter: PluginExporter): void;
  registerHook(hook: string, handler: (...args: unknown[]) => unknown): void;
  subscribe(event: string, handler: (...args: unknown[]) => void): void;
  publish(event: string, ...args: unknown[]): void;
  getService(name: string): unknown;
}

export interface PluginTool {
  id: string;
  name: string;
  icon?: string;
  category: string;
  handler: (context: PluginContext) => void | Promise<void>;
  shortcuts?: string[];
}

export interface PluginStorage {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  clear(): void;
}

export interface Plugin {
  manifest: PluginManifest;
  context: PluginContext;
  load(): Promise<void>;
  unload(): Promise<void>;
  execute(command: string, ...args: unknown[]): Promise<unknown>;
}

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private tools: Map<string, PluginTool> = new Map();
  private hooks: Map<string, Array<(...args: unknown[]) => unknown>> = new Map();
  private events: Map<string, Array<(...args: unknown[]) => void>> = new Map();
  private services: Map<string, unknown> = new Map();
  private storage: Map<string, Map<string, unknown>> = new Map();

  constructor() {
    this.initializeCoreServices();
  }

  private initializeCoreServices(): void {
    // Register core services that plugins can access
    // This would include access to existing services like aiService, collaborationService, etc.
  }

  async loadPlugin(manifest: PluginManifest, pluginFactory: (context: PluginContext) => Plugin): Promise<void> {
    if (this.plugins.has(manifest.id)) {
      throw new Error(`Plugin ${manifest.id} is already loaded`);
    }

    // Create plugin storage
    this.storage.set(manifest.id, new Map());

    // Create plugin context
    const context: PluginContext = {
      api: this.createPluginAPI(manifest.id),
      config: {},
      storage: this.createPluginStorage(manifest.id)
    };

    // Create plugin instance
    const plugin = pluginFactory(context);
    plugin.manifest = manifest;
    plugin.context = context;

    // Load plugin
    await plugin.load();

    // Register plugin
    this.plugins.set(manifest.id, plugin);

    console.log(`Plugin ${manifest.id} loaded successfully`);
  }

  async unloadPlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} is not loaded`);
    }

    // Unload plugin
    await plugin.unload();

    // Remove plugin tools
    const toolsToRemove: string[] = [];
    this.tools.forEach((tool, id) => {
      if (tool.id.startsWith(pluginId + ':')) {
        toolsToRemove.push(id);
      }
    });
    toolsToRemove.forEach(id => this.tools.delete(id));

    // Remove plugin hooks - implementation would filter handlers by plugin ID

    // Remove plugin
    this.plugins.delete(pluginId);
    this.storage.delete(pluginId);

    console.log(`Plugin ${pluginId} unloaded successfully`);
  }

  private createPluginAPI(pluginId: string): PluginAPI {
    return {
      registerTool: (tool: PluginTool) => {
        const toolId = `${pluginId}:${tool.id}`;
        this.tools.set(toolId, { ...tool, id: toolId });
        console.log(`Tool ${toolId} registered by plugin ${pluginId}`);
      },

      registerComponent: (type: string, component: PluginComponent) => {
        // Register component type
        console.log(`Component type ${type} registered by plugin ${pluginId}`, component);
      },

      registerSimulation: (engine: string, simulator: PluginSimulator) => {
        // Register simulation engine
        console.log(`Simulation engine ${engine} registered by plugin ${pluginId}`, simulator);
      },

      registerExport: (format: string, exporter: PluginExporter) => {
        // Register export format
        console.log(`Export format ${format} registered by plugin ${pluginId}`, exporter);
      },

      registerHook: (hook: string, handler: (...args: unknown[]) => unknown) => {
        if (!this.hooks.has(hook)) {
          this.hooks.set(hook, []);
        }
        this.hooks.get(hook)!.push(handler);
        console.log(`Hook ${hook} registered by plugin ${pluginId}`);
      },

      subscribe: (event: string, handler: (...args: unknown[]) => void) => {
        if (!this.events.has(event)) {
          this.events.set(event, []);
        }
        this.events.get(event)!.push(handler);
        console.log(`Plugin ${pluginId} subscribed to event ${event}`);
      },

      publish: (event: string, ...args: unknown[]) => {
        const handlers = this.events.get(event) || [];
        handlers.forEach(handler => {
          try {
            handler(...args);
          } catch (error) {
            console.error(`Error in event handler for ${event}:`, error);
          }
        });
      },

      getService: (name: string) => {
        return this.services.get(name);
      }
    };
  }

  private createPluginStorage(pluginId: string): PluginStorage {
    const storage = this.storage.get(pluginId) || new Map();

    return {
      get: (key: string) => {
        return storage.get(key);
      },
      set: (key: string, value: unknown) => {
        storage.set(key, value);
      },
      delete: (key: string) => {
        storage.delete(key);
      },
      clear: () => {
        storage.clear();
      }
    };
  }

  async executeHook(hook: string, ...args: unknown[]): Promise<unknown[]> {
    const handlers = this.hooks.get(hook) || [];
    const results: unknown[] = [];

    for (const handler of handlers) {
      try {
        const result = await handler(...args);
        results.push(result);
      } catch (error) {
        console.error(`Error executing hook ${hook}:`, error);
      }
    }

    return results;
  }

  publishEvent(event: string, ...args: unknown[]): void {
    const handlers = this.events.get(event) || [];
    handlers.forEach(handler => {
      try {
        handler(...args);
      } catch (error) {
        console.error(`Error in event handler for ${event}:`, error);
      }
    });
  }

  registerService(name: string, service: unknown): void {
    this.services.set(name, service);
  }

  getTool(toolId: string): PluginTool | undefined {
    return this.tools.get(toolId);
  }

  getAllTools(): PluginTool[] {
    return Array.from(this.tools.values());
  }

  getPlugin(pluginId: string): Plugin | undefined {
    return this.plugins.get(pluginId);
  }

  getAllPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  getLoadedPlugins(): Plugin[] {
    return this.getAllPlugins();
  }

  async executePluginCommand(pluginId: string, command: string, ...args: unknown[]): Promise<unknown> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} is not loaded`);
    }

    return await plugin.execute(command, ...args);
  }

  // Event emitter methods for App.tsx compatibility
  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    const handlers = this.events.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event: string, ...args: unknown[]): void {
    this.publishEvent(event, ...args);
  }

  removeAllListeners(): void {
    this.events.clear();
  }

  // Install plugin method for tests
  async installPlugin(manifest: PluginManifest): Promise<void> {
    const pluginFactory = (context: PluginContext) => new BasePlugin(manifest, context);
    await this.loadPlugin(manifest, pluginFactory);
  }
}

export const pluginManager = new PluginManager();

// Example plugin implementation
export class BasePlugin implements Plugin {
  manifest: PluginManifest;
  context: PluginContext;

  constructor(manifest: PluginManifest, context: PluginContext) {
    this.manifest = manifest;
    this.context = context;
  }

  async load(): Promise<void> {
    // Plugin initialization
    console.log(`Loading plugin ${this.manifest.id}`);
  }

  async unload(): Promise<void> {
    // Plugin cleanup
    console.log(`Unloading plugin ${this.manifest.id}`);
  }

  async execute(command: string, ...args: unknown[]): Promise<unknown> {
    // Execute plugin command
    console.log(`Executing command ${command} in plugin ${this.manifest.id}`, args);
    return undefined;
  }
}

