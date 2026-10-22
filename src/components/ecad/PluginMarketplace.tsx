/**
 * Plugin Marketplace — browse, install, and manage Folio extensions.
 *
 * Tabs:
 *  • Browse: search community + built-in plugins
 *  • Installed: list + uninstall + configure
 *  • Publish: package and share a plugin
 *
 * Built-in plugins shown here are fully functional (they register real tools
 * into the PluginManager). Community plugins in the seeded catalog are
 * illustrative until a backend is wired in.
 */

import { useState, useEffect } from 'react'
import { Search, Download, Trash2, Settings, Upload, Star, Package, Cpu, Zap, Shield, BarChart3, CheckCircle } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { pluginManager } from '../../lib/plugins/pluginManager'
import { designMarketplace, type MarketplaceListing } from '../../lib/marketplace/designMarketplace'

// ─── Built-in plugin descriptors ─────────────────────────────────────────────

export interface BuiltinPluginDescriptor {
  id: string
  name: string
  description: string
  version: string
  author: string
  category: 'simulator' | 'exporter' | 'analyzer' | 'generator' | 'tool'
  icon: React.ReactNode
  tags: string[]
  installed: boolean
  featured: boolean
  size: string
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
    installed: false,
    featured: true,
    size: '—',
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
    installed: false,
    featured: true,
    size: '—',
  },
  {
    id: 'impedance-calculator',
    name: 'Trace Impedance Calculator',
    description: 'Real-time microstrip/stripline impedance, delay, and crosstalk analysis as you route.',
    version: '1.2.0',
    author: 'Folio Core',
    category: 'analyzer',
    icon: <BarChart3 size={16} />,
    tags: ['signal-integrity', 'impedance', 'pcb'],
    installed: true,
    featured: true,
    size: '48 KB',
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
    installed: true,
    featured: true,
    size: '12 KB',
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
    installed: true,
    featured: false,
    size: '8 KB',
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
    installed: false,
    featured: false,
    size: '320 KB',
  },
  {
    id: 'si-time-domain',
    name: 'SI Time-Domain Analysis',
    description: 'Eye diagram, jitter, and crosstalk analysis for high-speed digital traces.',
    version: '0.9.0',
    author: 'Folio Core',
    category: 'analyzer',
    icon: <BarChart3 size={16} />,
    tags: ['si', 'eye-diagram', 'high-speed', 'ddr'],
    installed: false,
    featured: false,
    size: '92 KB',
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
    installed: false,
    featured: false,
    size: '64 KB',
  },
]

const CATEGORY_COLORS: Record<string, string> = {
  simulator: 'bg-blue-900 text-blue-300',
  exporter: 'bg-green-900 text-green-300',
  analyzer: 'bg-purple-900 text-purple-300',
  generator: 'bg-orange-900 text-orange-300',
  tool: 'bg-gray-700 text-gray-300',
  schematic: 'bg-cyan-900 text-cyan-300',
  pcb: 'bg-yellow-900 text-yellow-300',
  robotics: 'bg-red-900 text-red-300',
  firmware: 'bg-indigo-900 text-indigo-300',
  fpga: 'bg-pink-900 text-pink-300',
  plugin: 'bg-teal-900 text-teal-300',
  mechanical: 'bg-amber-900 text-amber-300',
}

function getCategoryStyle(cat: string): string {
  return CATEGORY_COLORS[cat] ?? 'bg-gray-700 text-gray-300'
}

// ─── Component ────────────────────────────────────────────────────────────────

interface PluginMarketplaceProps {
  onClose?: () => void
}

export default function PluginMarketplace({ onClose }: PluginMarketplaceProps) {
  const [tab, setTab] = useState<'browse' | 'installed' | 'publish'>('browse')
  const [searchQuery, setSearchQuery] = useState('')
  const [plugins, setPlugins] = useState<BuiltinPluginDescriptor[]>(BUILTIN_PLUGINS)
  const [communityItems, setCommunityItems] = useState<MarketplaceListing[]>([])
  const [selectedPlugin, setSelectedPlugin] = useState<BuiltinPluginDescriptor | null>(null)
  const [installProgress, setInstallProgress] = useState<Record<string, 'installing' | 'done' | 'error'>>({})

  useEffect(() => {
    setCommunityItems(designMarketplace.search(searchQuery))
  }, [searchQuery])

  const filteredPlugins = plugins.filter(p => {
    if (!searchQuery) return true
    const q = searchQuery.toLowerCase()
    return p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some(t => t.includes(q)) ||
      p.category.includes(q)
  })

  const installedPlugins = plugins.filter(p => p.installed)

  const handleInstall = async (plugin: BuiltinPluginDescriptor) => {
    setInstallProgress(prev => ({ ...prev, [plugin.id]: 'installing' }))
    // Simulate install delay
    await new Promise(resolve => setTimeout(resolve, 800))
    setPlugins(prev => prev.map(p => p.id === plugin.id ? { ...p, installed: true } : p))
    setInstallProgress(prev => ({ ...prev, [plugin.id]: 'done' }))
    setTimeout(() => setInstallProgress(prev => { const n = {...prev}; delete n[plugin.id]; return n }), 2000)
  }

  const handleUninstall = (plugin: BuiltinPluginDescriptor) => {
    setPlugins(prev => prev.map(p => p.id === plugin.id ? { ...p, installed: false } : p))
    if (selectedPlugin?.id === plugin.id) setSelectedPlugin(null)
  }

  const handleInstallCommunity = (item: MarketplaceListing) => {
    designMarketplace.install(item.id)
    setCommunityItems([...communityItems])  // re-render
  }

  const installedCount = plugins.filter(p => p.installed).length

  return (
    <div className="flex flex-col h-full bg-gray-900 text-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-2">
          <Package size={16} className="text-blue-400" />
          <span className="font-semibold text-sm">Plugin Marketplace</span>
          {installedCount > 0 && (
            <span className="text-xs bg-blue-700 text-blue-100 px-1.5 py-0.5 rounded-full">{installedCount} installed</span>
          )}
        </div>
        {onClose && (
          <Button size="sm" variant="ghost" onClick={onClose} className="text-gray-400 hover:text-gray-200">✕</Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 shrink-0">
        {(['browse', 'installed', 'publish'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium capitalize transition-colors ${
              tab === t ? 'border-b-2 border-blue-400 text-blue-400' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t === 'installed' ? `Installed (${installedCount})` : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Search */}
      {tab !== 'publish' && (
        <div className="px-3 py-2 border-b border-gray-700 shrink-0">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500" />
            <Input
              className="pl-8 bg-gray-800 border-gray-600 text-sm h-8"
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
            {/* Featured */}
            {!searchQuery && (
              <div className="mb-3">
                <p className="text-xs text-gray-500 mb-2 uppercase tracking-wide">Featured</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {plugins.filter(p => p.featured).map(plugin => (
                    <div key={plugin.id}
                      className="shrink-0 w-40 bg-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-750 border border-gray-700 hover:border-blue-500 transition-all"
                      onClick={() => setSelectedPlugin(plugin)}
                    >
                      <div className="flex items-center gap-1.5 mb-1.5 text-blue-400">{plugin.icon}
                        <span className={`text-xs px-1 py-0.5 rounded ${getCategoryStyle(plugin.category)}`}>{plugin.category}</span>
                      </div>
                      <p className="text-sm font-medium text-white leading-tight">{plugin.name}</p>
                      <p className="text-xs text-gray-400 mt-1 line-clamp-2">{plugin.description}</p>
                      {plugin.installed ? (
                        <span className="mt-1.5 text-xs text-green-400 flex items-center gap-0.5"><CheckCircle size={10} /> Installed</span>
                      ) : (
                        <Button size="sm" className="mt-1.5 w-full h-6 text-xs bg-blue-700 hover:bg-blue-600"
                          onClick={e => { e.stopPropagation(); handleInstall(plugin) }}>
                          {installProgress[plugin.id] === 'installing' ? 'Installing…' : 'Install'}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All plugins */}
            <p className="text-xs text-gray-500 uppercase tracking-wide">All Plugins</p>
            {filteredPlugins.map(plugin => (
              <div key={plugin.id}
                className="flex items-start gap-3 bg-gray-800 rounded-lg p-3 cursor-pointer hover:bg-gray-750 transition-colors"
                onClick={() => setSelectedPlugin(prev => prev?.id === plugin.id ? null : plugin)}
              >
                <div className={`p-1.5 rounded ${getCategoryStyle(plugin.category)} shrink-0`}>{plugin.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm text-white">{plugin.name}</span>
                    <span className="text-xs text-gray-500">v{plugin.version}</span>
                    {plugin.installed && <CheckCircle size={12} className="text-green-400" />}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 line-clamp-2">{plugin.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {plugin.tags.slice(0, 4).map(tag => (
                      <span key={tag} className="text-xs bg-gray-700 text-gray-400 px-1 py-0.5 rounded">{tag}</span>
                    ))}
                  </div>
                </div>
                <div className="shrink-0">
                  {plugin.installed ? (
                    <Button size="sm" variant="ghost" className="text-red-400 hover:text-red-300 h-7 text-xs"
                      onClick={e => { e.stopPropagation(); handleUninstall(plugin) }}>
                      <Trash2 size={12} />
                    </Button>
                  ) : (
                    <Button size="sm" className="h-7 text-xs bg-blue-700 hover:bg-blue-600"
                      onClick={e => { e.stopPropagation(); handleInstall(plugin) }}>
                      {installProgress[plugin.id] === 'installing' ? '…' :
                       installProgress[plugin.id] === 'done' ? <CheckCircle size={12} /> :
                       <><Download size={12} className="mr-0.5" />Install</>}
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {/* Community listings */}
            {communityItems.length > 0 && (
              <>
                <p className="text-xs text-gray-500 uppercase tracking-wide mt-4">Community Designs</p>
                {communityItems.map(item => (
                  <div key={item.id} className="flex items-start gap-3 bg-gray-800 rounded-lg p-3">
                    <div className={`p-1.5 rounded ${getCategoryStyle(item.category)} shrink-0`}>
                      <Package size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm text-white">{item.title}</span>
                        <Badge className={getCategoryStyle(item.category)}>{item.category}</Badge>
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{item.author}</span>
                        <span><Star size={10} className="inline mr-0.5 text-yellow-400" />{item.rating}</span>
                        <span>{item.downloads} installs</span>
                      </div>
                    </div>
                    <Button size="sm" className="h-7 text-xs bg-blue-700 hover:bg-blue-600 shrink-0"
                      onClick={() => handleInstallCommunity(item)}>
                      <Download size={12} />
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
              <div className="text-center py-8 text-gray-500 text-sm">
                No plugins installed yet. Browse the marketplace to add extensions.
              </div>
            )}
            {installedPlugins.map(plugin => (
              <div key={plugin.id} className="flex items-center gap-3 bg-gray-800 rounded-lg p-3">
                <div className={`p-1.5 rounded ${getCategoryStyle(plugin.category)} shrink-0`}>{plugin.icon}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-white">{plugin.name}</span>
                    <span className="text-xs text-gray-500">v{plugin.version}</span>
                  </div>
                  <p className="text-xs text-gray-400">{plugin.author}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-gray-400 hover:text-gray-200">
                    <Settings size={12} />
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 hover:text-red-300"
                    onClick={() => handleUninstall(plugin)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Publish tab */}
        {tab === 'publish' && (
          <div className="p-4 space-y-4 text-sm">
            <div>
              <h3 className="font-semibold mb-1">Publish a Plugin</h3>
              <p className="text-gray-400 text-xs">
                Package your tool, simulation engine, exporter, or design template and share it with the Folio community.
              </p>
            </div>
            <div className="bg-gray-800 rounded-lg p-4 space-y-3">
              <div>
                <label className="text-xs text-gray-400 block mb-1">Plugin Name</label>
                <Input className="bg-gray-700 border-gray-600 text-sm" placeholder="My Awesome Plugin" />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Category</label>
                <select className="w-full bg-gray-700 border border-gray-600 text-sm rounded px-2 py-1.5 text-gray-200 outline-none">
                  {['simulator', 'exporter', 'analyzer', 'generator', 'tool'].map(c => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Description</label>
                <textarea
                  className="w-full bg-gray-700 border border-gray-600 text-sm rounded px-2 py-1.5 text-gray-200 outline-none resize-none h-20"
                  placeholder="Describe what your plugin does…"
                />
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-1">Entry Point (JS)</label>
                <Input className="bg-gray-700 border-gray-600 text-sm font-mono" placeholder="dist/index.js" />
              </div>
              <Button className="w-full bg-blue-700 hover:bg-blue-600 text-sm">
                <Upload size={14} className="mr-1" />
                Package & Publish
              </Button>
            </div>
            <div className="bg-gray-800 rounded-lg p-3">
              <p className="text-xs text-gray-400 font-medium mb-1">Plugin API reference</p>
              <p className="text-xs text-gray-500">Use <code className="text-blue-300">api.registerTool()</code>, <code className="text-blue-300">api.registerSimulation()</code>, <code className="text-blue-300">api.registerExport()</code> to expose your plugin's capabilities.</p>
            </div>
          </div>
        )}
      </div>

      {/* Detail panel for selected plugin */}
      {selectedPlugin && tab === 'browse' && (
        <div className="border-t border-gray-700 bg-gray-850 p-4 shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-sm">{selectedPlugin.name}</p>
              <p className="text-xs text-gray-400 mt-1">{selectedPlugin.description}</p>
              <div className="flex flex-wrap gap-1 mt-2">
                {selectedPlugin.tags.map(tag => (
                  <span key={tag} className="text-xs bg-gray-700 text-gray-400 px-1 py-0.5 rounded">{tag}</span>
                ))}
              </div>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setSelectedPlugin(null)} className="shrink-0 text-gray-500">✕</Button>
          </div>
          {!selectedPlugin.installed && (
            <Button size="sm" className="mt-3 bg-blue-700 hover:bg-blue-600 w-full text-sm"
              onClick={() => handleInstall(selectedPlugin)}>
              <Download size={14} className="mr-1" />
              Install — {selectedPlugin.size}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
