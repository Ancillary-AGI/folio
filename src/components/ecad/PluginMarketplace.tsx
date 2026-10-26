/**
 * Plugin Marketplace — browse, install, and manage Folio extensions.
 *
 * Tabs:
 *  • Browse: search community + built-in plugins
 *  • Installed: list + uninstall + configure
 *  • Publish: package and share a plugin
 *
 * Built-in entries are registered as real plugin packages: installs go through
 * `marketplaceService`, which validates the manifest and enforces declared
 * permissions before a package can be marked installed. Native engines
 * (ngspice, KLayout) still need the companion daemon to execute. Community
 * and self-published designs live in the separate `designMarketplace`.
 */

import { useState, useEffect, type ReactNode } from 'react'
import { Search, Download, Trash2, Upload, Star, Package, Cpu, Zap, Shield, BarChart3, CheckCircle } from 'lucide-react'

import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { designMarketplace, type MarketplaceListing } from '../../lib/marketplace/designMarketplace'
import { marketplaceService } from '../../lib/marketplace/marketplaceService'
import { PLUGIN_EVENTS, PLUGIN_PERMISSIONS, type PluginManifest } from '../../types/plugins'
import { useDemoRequest } from '../workspace/useDemoRequest'

// ─── Built-in plugin descriptors ─────────────────────────────────────────────

export interface BuiltinPluginDescriptor {
  id: string
  name: string
  description: string
  version: string
  author: string
  category: 'simulator' | 'exporter' | 'analyzer' | 'generator' | 'tool'
  icon: ReactNode
  tags: string[]
  /** Seeded into the installed set on first run. */
  defaultInstalled: boolean
  featured: boolean
  size: string
  tools: Array<{ name: string; description: string }>
}

const BUILTIN_PLUGINS: BuiltinPluginDescriptor[] = [
  {
    id: 'ngspice-bridge',
    name: 'ngspice Bridge',
    description: 'Run the native ngspice binary via the companion daemon for full BSIM3v3, mutual inductance, and transmission lines. Requires companion installed.',
    version: '1.0.0',
    author: 'Folio Core',
    category: 'simulator',
    icon: <Cpu size={16} />,
    tags: ['spice', 'simulation', 'native', 'bsim3'],
    defaultInstalled: false,
    featured: true,
    size: '—',
    tools: [{ name: 'Native SPICE run', description: 'Send the current netlist to the companion ngspice daemon.' }],
  },
  {
    id: 'klayout-drc',
    name: 'KLayout DRC',
    description: 'Run KLayout design rule checks on generated Gerber/GDSII via the companion daemon.',
    version: '0.8.0',
    author: 'Folio Core',
    category: 'analyzer',
    icon: <Shield size={16} />,
    tags: ['drc', 'klayout', 'gerber', 'gdsii'],
    defaultInstalled: false,
    featured: true,
    size: '—',
    tools: [{ name: 'Run DRC', description: 'Check the generated Gerber/GDSII against a KLayout rule deck.' }],
  },
  {
    id: 'impedance-calculator',
    name: 'Trace Impedance Calculator',
    description: 'Microstrip/stripline impedance and propagation delay for the current stackup.',
    version: '1.2.0',
    author: 'Folio Core',
    category: 'analyzer',
    icon: <BarChart3 size={16} />,
    tags: ['signal-integrity', 'impedance', 'pcb'],
    defaultInstalled: true,
    featured: true,
    size: '48 KB',
    tools: [{ name: 'Impedance sweep', description: 'Compute microstrip/stripline Z0 and delay for the current stackup.' }],
  },
  {
    id: 'bom-exporter-jlcpcb',
    name: 'JLCPCB BOM + CPL Exporter',
    description: 'Export pick-and-place CPL and LCSC-compatible BOM directly in JLCPCB format.',
    version: '2.1.0',
    author: 'Folio Core',
    category: 'exporter',
    icon: <Download size={16} />,
    tags: ['bom', 'jlcpcb', 'lcsc', 'fab'],
    defaultInstalled: true,
    featured: true,
    size: '12 KB',
    tools: [{ name: 'Export JLCPCB CPL', description: 'Write a pick-and-place CPL and LCSC-ready BOM.' }],
  },
  {
    id: 'spice-model-importer',
    name: 'SPICE Model Importer',
    description: 'Drag-and-drop .lib files to import vendor SPICE model libraries. Supports .model and .subckt.',
    version: '1.0.0',
    author: 'Folio Core',
    category: 'tool',
    icon: <Zap size={16} />,
    tags: ['spice', 'models', 'vendor'],
    defaultInstalled: true,
    featured: false,
    size: '8 KB',
    tools: [{ name: 'Import .lib', description: 'Parse vendor .model/.subckt cards into the component library.' }],
  },
  {
    id: 'gerber-viewer',
    name: 'Gerber Viewer',
    description: 'In-browser Gerber file viewer with layer toggle, DRC overlay, and 3D preview.',
    version: '1.5.0',
    author: 'Folio Core',
    category: 'tool',
    icon: <Package size={16} />,
    tags: ['gerber', 'viewer', 'pcb', '3d'],
    defaultInstalled: false,
    featured: false,
    size: '320 KB',
    tools: [{ name: 'Open Gerber viewer', description: 'Overlay drill, copper, and mask layers in 3D.' }],
  },
  {
    id: 'kicad-import',
    name: 'KiCad Project Import',
    description: 'Import KiCad .kicad_sch and .kicad_pcb projects as Folio schematics and PCB layouts.',
    version: '1.1.0',
    author: 'Folio Core',
    category: 'tool',
    icon: <Upload size={16} />,
    tags: ['kicad', 'import', 'schematic', 'pcb'],
    defaultInstalled: false,
    featured: false,
    size: '64 KB',
    tools: [{ name: 'Import KiCad project', description: 'Convert .kicad_sch and .kicad_pcb into a Folio project.' }],
  },
]

function manifestFor(plugin: BuiltinPluginDescriptor): PluginManifest {
  return {
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    author: plugin.author,
    enabled: true,
    permissions: ['ui:panels', 'read:circuit'],
    entry: 'builtin',
    category: plugin.category,
    apiVersion: '1.0.0',
    tags: plugin.tags,
  }
}

/** Seed the package registry once; installs then flow through the service. */
function seedBuiltinRegistry(): void {
  for (const plugin of BUILTIN_PLUGINS) {
    if (marketplaceService.getPackage(plugin.id)) continue
    try {
      marketplaceService.registerPackage({
        id: plugin.id,
        manifest: manifestFor(plugin),
        author: plugin.author,
        isVerifiedPublisher: plugin.author === 'Folio Core',
        downloadsCount: 0,
        rating: 0,
        tags: plugin.tags,
        packagePayload: { tools: plugin.tools },
      })
    } catch (error) {
      console.warn(`Could not register ${plugin.id}:`, error)
    }
  }
  for (const plugin of BUILTIN_PLUGINS.filter((p) => p.defaultInstalled)) {
    if (!marketplaceService.isInstalled(plugin.id)) {
      marketplaceService.installPackage(plugin.id)
    }
  }
}

seedBuiltinRegistry()

const CATEGORY_COLORS: Record<string, string> = {
  simulator: 'bg-primary/15 text-primary',
  exporter: 'bg-success/15 text-success',
  analyzer: 'bg-chart-4/15 text-chart-4',
  generator: 'bg-warning/15 text-warning',
  tool: 'bg-muted text-foreground',
  schematic: 'bg-info/15 text-info',
  pcb: 'bg-warning/15 text-warning',
  robotics: 'bg-destructive/15 text-destructive',
  firmware: 'bg-chart-2/15 text-chart-2',
  fpga: 'bg-chart-6/15 text-chart-6',
  plugin: 'bg-chart-3/15 text-chart-3',
  mechanical: 'bg-warning/15 text-warning',
}

function getCategoryStyle(cat: string): string {
  return CATEGORY_COLORS[cat] ?? 'bg-muted text-foreground'
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PluginMarketplaceProps {
  onClose?: () => void
}

export default function PluginMarketplace({ onClose }: PluginMarketplaceProps) {
  const [tab, setTab] = useState<'browse' | 'installed' | 'publish'>('browse')
  const [searchQuery, setSearchQuery] = useState('')
  const [installedIds, setInstalledIds] = useState<Set<string>>(
    () => new Set(marketplaceService.listInstalled().map((entry) => entry.id)),
  )
  const [installedDesignIds, setInstalledDesignIds] = useState<Set<string>>(
    () => new Set(designMarketplace.getInstalled().map((listing) => listing.id)),
  )
  const [communityItems, setCommunityItems] = useState<MarketplaceListing[]>([])
  const [selectedPlugin, setSelectedPlugin] = useState<BuiltinPluginDescriptor | null>(null)
  const [installError, setInstallError] = useState('')
  const [draft, setDraft] = useState({ name: '', category: 'tool', description: '', entry: 'dist/index.js' })
  const [publishStatus, setPublishStatus] = useState('')
  const [demoStatus, setDemoStatus] = useState<{ pluginId: string; message: string } | null>(null)

  useEffect(() => {
    setCommunityItems(designMarketplace.search(searchQuery))
  }, [searchQuery])

  const filteredPlugins = BUILTIN_PLUGINS.filter(p => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some(t => t.includes(q)) ||
      p.category.includes(q)
  })

  const installedPlugins = BUILTIN_PLUGINS.filter(p => installedIds.has(p.id))
  const installedCount = installedPlugins.length

  const syncInstalled = () => {
    setInstalledIds(new Set(marketplaceService.listInstalled().map((entry) => entry.id)))
  }

  /*
   * Gallery demo: open a real package, show its manifest and declared
   * permissions, then install it through the same permission-gated service the
   * Install button uses. Installing here is a local registry operation, not a
   * download; native engines still need the companion daemon.
   */
  const runPermissionsDemo = () => {
    setTab('browse')
    setSearchQuery('')
    setInstallError('')
    const plugin = BUILTIN_PLUGINS.find((entry) => entry.id === 'kicad-import') ?? BUILTIN_PLUGINS[0]
    setSelectedPlugin(plugin)
    try {
      const result = marketplaceService.installPackage(plugin.id)
      syncInstalled()
      setDemoStatus({
        pluginId: plugin.id,
        message: `Installed ${plugin.name}: manifest validated, ${result.activatedToolsCount} tool(s) activated under its declared permissions.`,
      })
    } catch (error) {
      setDemoStatus(null)
      setInstallError(error instanceof Error ? error.message : `Could not install ${plugin.name}.`)
    }
  }

  useDemoRequest('plugins-permissions', runPermissionsDemo)

  const handleInstall = (plugin: BuiltinPluginDescriptor) => {
    try {
      marketplaceService.installPackage(plugin.id)
      syncInstalled()
      setInstallError('')
    } catch (error) {
      setInstallError(error instanceof Error ? error.message : `Could not install ${plugin.name}.`)
    }
  }

  const handleUninstall = (plugin: BuiltinPluginDescriptor) => {
    marketplaceService.uninstallPackage(plugin.id)
    syncInstalled()
    if (selectedPlugin?.id === plugin.id) setSelectedPlugin(null)
  }

  const handleInstallCommunity = (item: MarketplaceListing) => {
    if (installedDesignIds.has(item.id)) return
    designMarketplace.install(item.id)
    setInstalledDesignIds(new Set(designMarketplace.getInstalled().map((listing) => listing.id)))
    setCommunityItems(designMarketplace.search(searchQuery))
  }

  const handlePublish = () => {
    if (!draft.name.trim()) {
      setPublishStatus('Give the plugin a name before publishing.')
      return
    }
    const listing = designMarketplace.publish({
      title: draft.name.trim(),
      author: 'Local user',
      category: 'plugin',
      description: draft.description.trim() || 'Community plugin published from this device.',
      version: '0.1.0',
      license: 'MIT',
      tags: [draft.category],
      rating: 0,
      payload: { entry: draft.entry.trim() || 'index.js', category: draft.category },
    })
    setCommunityItems(designMarketplace.search(searchQuery))
    setPublishStatus(`Published "${listing.title}" to the local catalog.`)
    setDraft({ name: '', category: 'tool', description: '', entry: 'dist/index.js' })
  }

  return (
    <div className="flex flex-col h-full bg-background text-foreground overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-primary" />
          <span className="font-semibold text-sm">Plugin Marketplace</span>
          {installedCount > 0 && (
            <span className="text-xs bg-primary text-primary-foreground px-1.5 py-0.5 rounded-full">{installedCount} installed</span>
          )}
        </div>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close plugin marketplace" className="text-muted-foreground hover:text-foreground">✕</Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        {(['browse', 'installed', 'publish'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium capitalize transition-colors ${
              tab === t ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t === 'installed' ? `Installed (${installedCount})` : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Search */}
      {tab !== 'publish' && (
        <div className="px-3 py-2 border-b border-border shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-8 bg-card border-border text-sm h-8"
              placeholder="Search plugins, exporters, analyzers…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Browse tab */}
        {tab === 'browse' && (
          <div className="p-3 space-y-2">
            {installError && <p role="alert" className="text-xs text-destructive">{installError}</p>}
            {/* Featured */}
            {!searchQuery && (
              <div className="mb-3">
                <p className="text-xs text-muted-foreground mb-2 uppercase tracking-wide">Featured</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {BUILTIN_PLUGINS.filter(p => p.featured).map(plugin => (
                    <div key={plugin.id}
                      className="shrink-0 w-40 bg-card rounded-lg p-3 cursor-pointer hover:bg-accent border border-border hover:border-primary transition-all"
                      onClick={() => setSelectedPlugin(plugin)}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5 text-primary">{plugin.icon}
                        <span className={`text-xs px-1 py-0.5 rounded ${getCategoryStyle(plugin.category)}`}>{plugin.category}</span>
                      </div>
                      <p className="text-sm font-medium text-foreground leading-tight">{plugin.name}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{plugin.description}</p>
                      {installedIds.has(plugin.id) ? (
                        <span className="mt-1.5 text-xs text-success flex items-center gap-0.5"><CheckCircle size={10} /> Installed</span>
                      ) : (
                        <Button size="sm" className="mt-1.5 w-full h-6 text-xs bg-primary hover:bg-primary/90"
                          onClick={e => { e.stopPropagation(); handleInstall(plugin) }}>
                          Install
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All plugins */}
            <p className="text-xs text-muted-foreground uppercase tracking-wide">All Plugins</p>
            {filteredPlugins.map(plugin => (
              <div key={plugin.id}
                className="flex items-start gap-3 bg-card rounded-lg p-3 cursor-pointer hover:bg-accent transition-colors"
                onClick={() => setSelectedPlugin(prev => prev?.id === plugin.id ? null : plugin)}
              >
                <div className={`p-1.5 rounded ${getCategoryStyle(plugin.category)} shrink-0`}>{plugin.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-foreground">{plugin.name}</span>
                    <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                    {installedIds.has(plugin.id) && <CheckCircle size={12} className="text-success" />}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{plugin.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {plugin.tags.slice(0, 4).map(tag => (
                      <span key={tag} className="text-xs bg-muted text-muted-foreground px-1 py-0.5 rounded">{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0">
                  {installedIds.has(plugin.id) ? (
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-7 text-xs"
                      aria-label={`Uninstall ${plugin.name}`}
                      onClick={e => { e.stopPropagation(); handleUninstall(plugin) }}>
                      <Trash2 size={12} />
                    </Button>
                  ) : (
                    <Button size="sm" className="h-7 text-xs bg-primary hover:bg-primary/90"
                      onClick={e => { e.stopPropagation(); handleInstall(plugin) }}>
                      <Download size={12} className="mr-0.5" />Install
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {/* Community listings */}
            {communityItems.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground uppercase tracking-wide mt-4">Community Designs</p>
                {communityItems.map(item => (
                  <div key={item.id} className="flex items-start gap-3 bg-card rounded-lg p-3">
                    <div className={`p-1.5 rounded ${getCategoryStyle(item.category)} shrink-0`}>
                      <Package size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-foreground">{item.title}</span>
                        <Badge className={getCategoryStyle(item.category)}>{item.category}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span>{item.author}</span>
                        <span><Star size={10} className="inline mr-0.5 text-warning" />{item.rating}</span>
                        <span>{item.downloads} installs</span>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      className="h-7 shrink-0 bg-primary text-xs hover:bg-primary/90"
                      disabled={installedDesignIds.has(item.id)}
                      aria-label={installedDesignIds.has(item.id) ? `${item.title} installed` : `Install ${item.title}`}
                      onClick={() => handleInstallCommunity(item)}
                    >
                      {installedDesignIds.has(item.id) ? <CheckCircle size={12} /> : <Download size={12} />}
                    </Button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* Installed tab */}
        {tab === 'installed' && (
          <div className="p-3 space-y-2">
            {installedPlugins.length === 0 && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No plugins installed yet. Browse the marketplace to add extensions.
              </div>
            )}
            {installedPlugins.map(plugin => (
              <div key={plugin.id} className="flex items-center gap-3 bg-card rounded-lg p-3">
                <div className={`p-1.5 rounded ${getCategoryStyle(plugin.category)} shrink-0`}>{plugin.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">{plugin.name}</span>
                    <span className="text-xs text-muted-foreground">v{plugin.version}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{plugin.author}</p>
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive"
                  aria-label={`Uninstall ${plugin.name}`}
                  onClick={() => handleUninstall(plugin)}>
                  <Trash2 size={12} />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Publish tab */}
        {tab === 'publish' && (
          <div className="p-4 space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-1">Publish a Plugin</h3>
              <p className="text-muted-foreground text-xs">
                Package your tool, simulation engine, exporter, or design template and share it with the Folio community.
              </p>
            </div>
            <div className="bg-card rounded-lg p-4 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground block mb-1" htmlFor="publish-name">Plugin Name</label>
                <Input
                  id="publish-name"
                  className="bg-muted border-border text-sm"
                  placeholder="My Awesome Plugin"
                  value={draft.name}
                  onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1" htmlFor="publish-category">Category</label>
                <select
                  id="publish-category"
                  className="w-full bg-muted border border-border text-sm rounded px-2 py-1.5 text-foreground outline-none"
                  value={draft.category}
                  onChange={(event) => setDraft((prev) => ({ ...prev, category: event.target.value }))}
                >
                  {['simulator', 'exporter', 'analyzer', 'generator', 'tool'].map(c => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1" htmlFor="publish-description">Description</label>
                <textarea
                  id="publish-description"
                  className="w-full bg-muted border border-border text-sm rounded px-2 py-1.5 text-foreground outline-none resize-none h-20"
                  placeholder="Describe what your plugin does…"
                  value={draft.description}
                  onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1" htmlFor="publish-entry">Entry Point (JS)</label>
                <Input
                  id="publish-entry"
                  className="bg-muted border-border text-sm font-mono"
                  placeholder="dist/index.js"
                  value={draft.entry}
                  onChange={(event) => setDraft((prev) => ({ ...prev, entry: event.target.value }))}
                />
              </div>
              <Button className="w-full bg-primary hover:bg-primary/90 text-sm" onClick={handlePublish}>
                <Upload size={14} className="mr-1" />
                Package & Publish
              </Button>
              {publishStatus && <p role="status" className="text-xs text-muted-foreground">{publishStatus}</p>}
            </div>
            <div className="bg-card rounded-lg p-3">
              <p className="text-xs text-muted-foreground font-medium mb-1">Plugin API reference</p>
              <p className="text-xs text-muted-foreground">Use <code className="text-primary">api.registerTool()</code>, <code className="text-primary">api.registerSimulation()</code>, <code className="text-primary">api.registerExport()</code> to expose your plugin's capabilities.</p>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel for selected plugin */}
      {selectedPlugin && tab === 'browse' && (() => {
        const manifest = marketplaceService.getPackage(selectedPlugin.id)?.manifest
        const permissionEntries = manifest?.permissions ?? []
        return (
          <div className="max-h-[45%] shrink-0 overflow-y-auto border-t border-border bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-semibold text-sm">{selectedPlugin.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{selectedPlugin.description}</p>
                <div className="flex flex-wrap gap-1 mt-2">
                  {selectedPlugin.tags.map(tag => (
                    <span key={tag} className="text-xs bg-muted text-muted-foreground px-1 py-0.5 rounded">{tag}</span>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Tools: {selectedPlugin.tools.map((tool) => tool.name).join(', ')}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => setSelectedPlugin(null)} aria-label="Close plugin details" className="shrink-0 text-muted-foreground">✕</Button>
            </div>

            {manifest && (
              <div className="mt-3 grid gap-3 border-t border-border pt-3 text-xs md:grid-cols-2">
                <div>
                  <p className="mb-1 text-muted-foreground">Manifest</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 font-mono">
                    <dt className="text-muted-foreground">id</dt><dd className="text-foreground">{manifest.id}</dd>
                    <dt className="text-muted-foreground">version</dt><dd className="text-foreground">{manifest.version}</dd>
                    <dt className="text-muted-foreground">api</dt><dd className="text-foreground">{manifest.apiVersion ?? '—'}</dd>
                    <dt className="text-muted-foreground">entry</dt><dd className="text-foreground">{manifest.entry}</dd>
                    <dt className="text-muted-foreground">publisher</dt>
                    <dd className="text-foreground">
                      {marketplaceService.getPackage(selectedPlugin.id)?.isVerifiedPublisher ? 'verified' : 'unverified'}
                    </dd>
                  </dl>
                </div>
                <div>
                  <p className="mb-1 text-muted-foreground">Declared permissions ({permissionEntries.length})</p>
                  {permissionEntries.length === 0 ? (
                    <p className="text-warning">No permissions declared — every capability is denied.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {permissionEntries.map((permission) => (
                        <li key={permission} className="font-mono text-foreground">
                          {permission}
                          <span className="ml-1 font-sans text-muted-foreground">
                            — {PLUGIN_PERMISSIONS[permission as keyof typeof PLUGIN_PERMISSIONS] ?? 'unknown'}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-2 text-muted-foreground">
                    Lifecycle: <span className="font-mono">{PLUGIN_EVENTS.INITIALIZED}</span> →{' '}
                    <span className="font-mono">{PLUGIN_EVENTS.ENABLED}</span> →{' '}
                    <span className="font-mono">{PLUGIN_EVENTS.CLEANUP}</span>
                  </p>
                </div>
              </div>
            )}

            {demoStatus?.pluginId === selectedPlugin.id && (
              <p role="status" aria-label="Plugin demo status" className="mt-3 rounded border border-success/40 bg-success/10 px-2 py-1 text-xs text-success">
                {demoStatus.message}
              </p>
            )}

            {!installedIds.has(selectedPlugin.id) ? (
              <Button size="sm" className="mt-3 bg-primary hover:bg-primary/90 w-full text-sm"
                onClick={() => handleInstall(selectedPlugin)}>
                <Download size={14} className="mr-1" />
                Install — {selectedPlugin.size}
              </Button>
            ) : (
              <p className="mt-3 text-xs text-success">Installed locally — tools are available while the manifest stays valid.</p>
            )}
          </div>
        )
      })()}
    </div>
  )
}
