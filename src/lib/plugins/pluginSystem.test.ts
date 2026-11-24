import { describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../../types/plugins'
import { PluginManager, type Plugin, type PluginContext } from './pluginSystem'

const manifest = (permissions: string[]): PluginManifest => ({
  id: 'acme-tools',
  name: 'ACME Tools',
  version: '1.0.0',
  description: 'Probe tools for the plugin host',
  author: 'ACME',
  enabled: true,
  permissions,
  entry: 'index.js',
  apiVersion: '1.0.0',
})

const pluginThatRegisters = (
  declared: PluginManifest,
  onLoad: (context: PluginContext) => void,
) => (context: PluginContext): Plugin => ({
  manifest: declared,
  context,
  load: async () => onLoad(context),
  unload: async () => {},
  execute: async () => undefined,
})

describe('PluginManager permission gate', () => {
  it('loads a plugin that declares the capability it uses and unloads its tools', async () => {
    const manager = new PluginManager()
    const declared = manifest(['ui:panels', 'system:events'])
    await manager.loadPlugin(
      declared,
      pluginThatRegisters(declared, (context) => {
        context.api.registerTool({ id: 'probe', name: 'Probe', category: 'test', handler: () => {} })
      }),
    )

    expect(manager.getAllTools().map((tool) => tool.id)).toEqual(['acme-tools:probe'])

    await manager.unloadPlugin('acme-tools')
    expect(manager.getAllTools()).toHaveLength(0)
    expect(manager.getAllPlugins()).toHaveLength(0)
  })

  it('stops delivering events to a plugin once it is unloaded', async () => {
    /* Event subscriptions used to be stored without an owner, so
     * `unloadPlugin` removed tools, components, hooks and storage but left the
     * subscription in place â€” an unloaded plugin kept receiving events. */
    const manager = new PluginManager()
    const declared = manifest(['ui:panels', 'system:events'])
    let received = 0
    await manager.loadPlugin(
      declared,
      pluginThatRegisters(declared, (context) => {
        context.api.subscribe('sheet:changed', () => { received += 1 })
      }),
    )

    manager.publishEvent('sheet:changed')
    expect(received).toBe(1)

    await manager.unloadPlugin('acme-tools')
    manager.publishEvent('sheet:changed')
    expect(received).toBe(1)
  })

  it('rolls back registrations from a plugin whose load threw', async () => {
    /* A plugin that throws part-way through `load()` has already registered
     * tools and subscriptions. It never entered `plugins`, so `unloadPlugin`
     * refuses it and those registrations fire for the rest of the session. */
    const manager = new PluginManager()
    const declared = manifest(['ui:panels', 'system:events'])
    let received = 0

    await expect(manager.loadPlugin(
      declared,
      (context): Plugin => ({
        manifest: declared,
        context,
        load: async () => {
          context.api.registerTool({ id: 'orphan', name: 'Orphan', category: 'test', handler: () => {} })
          context.api.subscribe('sheet:changed', () => { received += 1 })
          throw new Error('boom')
        },
        unload: async () => {},
        execute: async () => undefined,
      }),
    )).rejects.toThrow(/boom/)

    expect(manager.getAllTools()).toHaveLength(0)
    manager.publishEvent('sheet:changed')
    expect(received).toBe(0)
    // And the id is free to load again.
    await manager.loadPlugin(declared, pluginThatRegisters(declared, () => {}))
    expect(manager.getAllPlugins()).toHaveLength(1)
  })

  it('refuses registration from a plugin that never declared the capability', async () => {
    const manager = new PluginManager()
    const undeclared = manifest([])

    await expect(manager.loadPlugin(
      undeclared,
      pluginThatRegisters(undeclared, (context) => {
        context.api.registerTool({ id: 'probe', name: 'Probe', category: 'test', handler: () => {} })
      }),
    )).rejects.toThrow(/acme-tools.*registerTool.*ui:panels/)
    expect(manager.getAllTools()).toHaveLength(0)
  })

  it('rejects a malformed manifest before the plugin factory runs', async () => {
    const manager = new PluginManager()
    const malformed = { ...manifest([]), entry: '', version: 'v1' }
    const factory = vi.fn(pluginThatRegisters(malformed, () => {}))

    await expect(manager.loadPlugin(malformed, factory))
      .rejects.toThrow(/Invalid plugin manifest acme-tools: version must be semver \(x\.y\.z\); entry must be a non-empty string/)
    expect(factory).not.toHaveBeenCalled()
    expect(manager.getAllPlugins()).toHaveLength(0)
  })

  it('grants every declared capability through the plugin API', async () => {
    const manager = new PluginManager()
    const declared = manifest([
      'ui:panels', 'write:components', 'simulate:circuit', 'export:circuit', 'system:events',
    ])

    await manager.loadPlugin(declared, pluginThatRegisters(declared, (context) => {
      context.api.registerTool({ id: 't', name: 'T', category: 'test', handler: () => {} })
      context.api.registerComponent('probe', { name: 'Probe', render: () => null })
      context.api.registerSimulation('probe', { name: 'Probe', simulate: async () => ({}) })
      context.api.registerExport('probe', { name: 'Probe', export: async () => null })
      context.api.registerHook('after-simulate', () => undefined)
      context.api.publish('project:opened')
    }))

    expect(manager.getAllTools()).toHaveLength(1)
    expect(manager.getComponent('acme-tools:probe')).toBeDefined()
    expect(manager.getSimulator('acme-tools:probe')).toBeDefined()
    expect(manager.getExporter('acme-tools:probe')).toBeDefined()
  })

  it('denies event publishing without the system:events capability', async () => {
    const manager = new PluginManager()
    const bare = manifest([])

    await expect(manager.loadPlugin(bare, pluginThatRegisters(bare, (context) => {
      context.api.publish('project:opened')
    }))).rejects.toThrow(/without permission system:events/)
    expect(manager.getAllPlugins()).toHaveLength(0)
  })
})
