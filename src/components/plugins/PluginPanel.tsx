import React, { useState, useEffect } from 'react'
import { 
  Settings, 
  Download, 
  Upload, 
  Trash2, 
  Play, 
  Pause, 
  RefreshCw,
  Search,
  Filter,
  Grid,
  List,
  Package,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info
} from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { pluginManager } from '../../lib/plugins/pluginManager'
import { Plugin, PluginManifest } from '../../types/plugins'

interface PluginPanelProps {
  onClose: () => void
}

export default function PluginPanel({ onClose }: PluginPanelProps) {
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    loadPlugins()
    
    // Listen for plugin events
    const handlePluginLoaded = () => loadPlugins()
    const handlePluginUnloaded = () => loadPlugins()
    const handlePluginEnabled = () => loadPlugins()
    const handlePluginDisabled = () => loadPlugins()

    pluginManager.on('plugin:loaded', handlePluginLoaded)
    pluginManager.on('plugin:unloaded', handlePluginUnloaded)
    pluginManager.on('plugin:enabled', handlePluginEnabled)
    pluginManager.on('plugin:disabled', handlePluginDisabled)

    return () => {
      pluginManager.off('plugin:loaded', handlePluginLoaded)
      pluginManager.off('plugin:unloaded', handlePluginUnloaded)
      pluginManager.off('plugin:enabled', handlePluginEnabled)
      pluginManager.off('plugin:disabled', handlePluginDisabled)
    }
  }, [])

  const loadPlugins = () => {
    const allPlugins = pluginManager.getAllPlugins()
    setPlugins(allPlugins)
  }

  const filteredPlugins = plugins.filter(plugin => {
    const matchesSearch = plugin.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         plugin.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         plugin.author.toLowerCase().includes(searchQuery.toLowerCase())
    
    const matchesCategory = filterCategory === 'all' || 
                           plugin.tags?.includes(filterCategory) ||
                           plugin.id.includes(filterCategory)
    
    return matchesSearch && matchesCategory
  })

  const handleEnablePlugin = async (pluginId: string) => {
    setIsLoading(true)
    try {
      pluginManager.enablePlugin(pluginId)
    } catch (error) {
      console.error('Failed to enable plugin:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDisablePlugin = async (pluginId: string) => {
    setIsLoading(true)
    try {
      pluginManager.disablePlugin(pluginId)
    } catch (error) {
      console.error('Failed to disable plugin:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleUninstallPlugin = async (pluginId: string) => {
    if (!confirm(`Are you sure you want to uninstall "${plugins.find(p => p.id === pluginId)?.name}"?`)) {
      return
    }

    setIsLoading(true)
    try {
      await pluginManager.unloadPlugin(pluginId)
    } catch (error) {
      console.error('Failed to uninstall plugin:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleInstallPlugin = async () => {
    // This would open a file picker or plugin marketplace
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,.js'
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (file) {
        try {
          const content = await file.text()
          const manifest = JSON.parse(content)
          await pluginManager.loadPlugin(manifest, content)
        } catch (error) {
          console.error('Failed to install plugin:', error)
        }
      }
    }
    input.click()
  }

  const getPluginStatusIcon = (plugin: Plugin) => {
    switch (plugin.status) {
      case 'loaded':
        return <CheckCircle className="w-4 h-4 text-green-500" />
      case 'error':
        return <XCircle className="w-4 h-4 text-red-500" />
      case 'loading':
        return <RefreshCw className="w-4 h-4 text-blue-500 animate-spin" />
      case 'disabled':
        return <Pause className="w-4 h-4 text-gray-500" />
      default:
        return <Info className="w-4 h-4 text-gray-500" />
    }
  }

  const getPluginStatusText = (plugin: Plugin) => {
    switch (plugin.status) {
      case 'loaded':
        return plugin.enabled ? 'Enabled' : 'Disabled'
      case 'error':
        return 'Error'
      case 'loading':
        return 'Loading'
      case 'disabled':
        return 'Disabled'
      default:
        return 'Unknown'
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" />
            <h2 className="text-xl font-semibold text-foreground">Plugin Manager</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleInstallPlugin}>
              <Upload className="w-4 h-4 mr-2" />
              Install Plugin
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <XCircle className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex h-[calc(90vh-120px)]">
          {/* Sidebar */}
          <div className="w-80 border-r border-border p-4 overflow-y-auto">
            {/* Search and Filters */}
            <div className="space-y-4">
              <div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search plugins..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-input rounded-md bg-background"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Category
                </label>
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background"
                >
                  <option value="all">All Categories</option>
                  <option value="simulation">Simulation</option>
                  <option value="export">Export</option>
                  <option value="validation">Validation</option>
                  <option value="ui">UI Extensions</option>
                  <option value="analysis">Analysis</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant={viewMode === 'grid' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('grid')}
                >
                  <Grid className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                >
                  <List className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Plugin List */}
            <div className="mt-6">
              <h3 className="text-sm font-medium text-foreground mb-3">
                Installed Plugins ({filteredPlugins.length})
              </h3>
              <div className="space-y-2">
                {filteredPlugins.map((plugin) => (
                  <div
                    key={plugin.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      selectedPlugin?.id === plugin.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:border-primary/50'
                    }`}
                    onClick={() => setSelectedPlugin(plugin)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        {getPluginStatusIcon(plugin)}
                        <div>
                          <div className="font-medium text-sm">{plugin.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {getPluginStatusText(plugin)}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        {plugin.enabled ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDisablePlugin(plugin.id)
                            }}
                          >
                            <Pause className="w-3 h-3" />
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={(e) => {
                              e.stopPropagation()
                              handleEnablePlugin(plugin.id)
                            }}
                          >
                            <Play className="w-3 h-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Main Content */}
          <div className="flex-1 p-6 overflow-y-auto">
            {selectedPlugin ? (
              <div className="space-y-6">
                {/* Plugin Header */}
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-2xl font-semibold text-foreground">
                      {selectedPlugin.name}
                    </h3>
                    <p className="text-muted-foreground mt-1">
                      {selectedPlugin.description}
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
                      <span>by {selectedPlugin.author}</span>
                      <span>v{selectedPlugin.version}</span>
                      {selectedPlugin.license && <span>License: {selectedPlugin.license}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {getPluginStatusIcon(selectedPlugin)}
                    <span className="text-sm font-medium">
                      {getPluginStatusText(selectedPlugin)}
                    </span>
                  </div>
                </div>

                {/* Plugin Actions */}
                <div className="flex items-center gap-2">
                  {selectedPlugin.enabled ? (
                    <Button
                      variant="outline"
                      onClick={() => handleDisablePlugin(selectedPlugin.id)}
                      disabled={isLoading}
                    >
                      <Pause className="w-4 h-4 mr-2" />
                      Disable
                    </Button>
                  ) : (
                    <Button
                      onClick={() => handleEnablePlugin(selectedPlugin.id)}
                      disabled={isLoading}
                    >
                      <Play className="w-4 h-4 mr-2" />
                      Enable
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => handleUninstallPlugin(selectedPlugin.id)}
                    disabled={isLoading}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Uninstall
                  </Button>
                </div>

                {/* Plugin Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Basic Info */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Basic Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div>
                        <label className="text-sm font-medium text-foreground">Plugin ID</label>
                        <p className="text-sm text-muted-foreground font-mono">{selectedPlugin.id}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground">Version</label>
                        <p className="text-sm text-muted-foreground">{selectedPlugin.version}</p>
                      </div>
                      <div>
                        <label className="text-sm font-medium text-foreground">Author</label>
                        <p className="text-sm text-muted-foreground">{selectedPlugin.author}</p>
                      </div>
                      {selectedPlugin.homepage && (
                        <div>
                          <label className="text-sm font-medium text-foreground">Homepage</label>
                          <a
                            href={selectedPlugin.homepage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-primary hover:underline"
                          >
                            {selectedPlugin.homepage}
                          </a>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Permissions */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg">Permissions</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {selectedPlugin.permissions.map((permission) => (
                          <div
                            key={permission}
                            className="flex items-center gap-2 text-sm"
                          >
                            <CheckCircle className="w-4 h-4 text-green-500" />
                            <span className="text-muted-foreground">{permission}</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Dependencies */}
                  {selectedPlugin.dependencies && selectedPlugin.dependencies.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Dependencies</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          {selectedPlugin.dependencies.map((dep) => (
                            <div
                              key={dep.id}
                              className="flex items-center justify-between text-sm"
                            >
                              <span className="text-muted-foreground">{dep.id}</span>
                              <span className="text-muted-foreground">v{dep.version}</span>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Tags */}
                  {selectedPlugin.tags && selectedPlugin.tags.length > 0 && (
                    <Card>
                      <CardHeader>
                        <CardTitle className="text-lg">Tags</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="flex flex-wrap gap-2">
                          {selectedPlugin.tags.map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-1 bg-secondary text-secondary-foreground rounded-md text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* Error Display */}
                {selectedPlugin.error && (
                  <Card className="border-red-200 bg-red-50">
                    <CardHeader>
                      <CardTitle className="text-lg text-red-800 flex items-center gap-2">
                        <AlertTriangle className="w-5 h-5" />
                        Error
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <p className="text-red-700">{selectedPlugin.error}</p>
                    </CardContent>
                  </Card>
                )}
              </div>
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <Package className="w-16 h-16 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-foreground mb-2">
                    Select a Plugin
                  </h3>
                  <p className="text-muted-foreground">
                    Choose a plugin from the sidebar to view its details and manage its settings.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
