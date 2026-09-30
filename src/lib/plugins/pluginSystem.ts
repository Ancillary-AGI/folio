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
  private components: Map<string, PluginComponent> = new Map();
  private simulators: Map<string, PluginSimulator> = new Map();
  private exporters: Map<string, PluginExporter> = new Map();
  private hooks: Map<string, Array<{ pluginId: string; handler: (...args: unknown[]) => unknown }>> = new Map();
  private events: Map<string, Array<(...args: unknown[]) => void>> = new Map();
  private services: Map<string, unknown> = new Map();
  private storage: Map<string, Map<string, unknown>> = new Map();

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

    // Remove plugin tools and other registrations (components, simulators,
    // exports) — all are keyed with a `${pluginId}:` prefix.
    const prefix = `${pluginId}:`;
    for (const map of [this.tools, this.components, this.simulators, this.exporters]) {
      for (const key of Array.from(map.keys())) {
        if (key.startsWith(prefix)) map.delete(key);
      }
    }

    // Remove this plugin's hook handlers
    for (const [hook, entries] of Array.from(this.hooks.entries())) {
      const remaining = entries.filter(entry => entry.pluginId !== pluginId);
      if (remaining.length === 0) this.hooks.delete(hook);
      else this.hooks.set(hook, remaining);
    }

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
        this.components.set(`${pluginId}:${type}`, component);
        console.log(`Component type ${pluginId}:${type} registered by plugin ${pluginId}`);
      },

      registerSimulation: (engine: string, simulator: PluginSimulator) => {
        this.simulators.set(`${pluginId}:${engine}`, simulator);
        console.log(`Simulation engine ${pluginId}:${engine} registered by plugin ${pluginId}`);
      },

      registerExport: (format: string, exporter: PluginExporter) => {
        this.exporters.set(`${pluginId}:${format}`, exporter);
        console.log(`Export format ${pluginId}:${format} registered by plugin ${pluginId}`);
      },

      registerHook: (hook: string, handler: (...args: unknown[]) => unknown) => {
        if (!this.hooks.has(hook)) {
          this.hooks.set(hook, []);
        }
        this.hooks.get(hook)!.push({ pluginId, handler });
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

    for (const { handler } of handlers) {
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

  getComponent(type: string): PluginComponent | undefined {
    return this.components.get(type);
  }

  getSimulator(engine: string): PluginSimulator | undefined {
    return this.simulators.get(engine);
  }

  getExporter(format: string): PluginExporter | undefined {
    return this.exporters.get(format);
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

  /** Default: no initialisation. Subclasses override for real setup. */
  async load(): Promise<void> {
    // Intentionally a no-op — PluginManager logs load success around this call.
  }

  /** Default: no cleanup. Subclasses override to release resources. */
  async unload(): Promise<void> {
    // Intentionally a no-op — PluginManager logs unload around this call.
  }

  async execute(command: string, ...args: unknown[]): Promise<unknown> {
    // Fail closed: plugins must override `execute`; returning undefined would
    // silently pretend the command ran.
    throw new Error(
      `Plugin ${this.manifest.id} does not implement command "${command}" (received ${args.length} argument(s)).`
    );
  }
}

