import { useState } from 'react'
import { Package, RefreshCw, Wrench, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { pluginManager } from '../../lib/plugins/pluginManager'

interface PluginPanelProps { onClose: () => void }

export default function PluginPanel({ onClose }: PluginPanelProps) {
  const [, setRevision] = useState(0)
  const plugins = pluginManager.getLoadedPlugins()
  const tools = pluginManager.getAllTools()
  const refresh = () => setRevision(value => value + 1)
  return <Card className="flex h-full flex-col rounded-none border-y-0 border-r-0">
    <CardHeader className="flex flex-row items-center justify-between border-b border-border py-3"><CardTitle className="flex items-center gap-2 text-sm"><Package className="h-4 w-4" />Extensions</CardTitle><div className="flex gap-1"><Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh extensions"><RefreshCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close extensions"><X className="h-4 w-4" /></Button></div></CardHeader>
    <CardContent className="flex-1 space-y-5 overflow-y-auto p-4">
      <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Loaded plugins ({plugins.length})</h3>{plugins.length ? <div className="space-y-2">{plugins.map(plugin => <div key={plugin.manifest.id} className="rounded-md border border-border p-3"><p className="text-sm font-medium">{plugin.manifest.name}</p><p className="mt-1 text-xs text-muted-foreground">v{plugin.manifest.version} · {plugin.manifest.author}</p><p className="mt-2 text-xs text-muted-foreground">{plugin.manifest.description}</p></div>)}</div> : <p className="text-sm text-muted-foreground">No local plugins are loaded.</p>}</section>
      <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Registered tools ({tools.length})</h3>{tools.length ? <div className="space-y-2">{tools.map(tool => <div key={tool.id} className="flex items-center gap-2 rounded-md border border-border p-2"><Wrench className="h-3.5 w-3.5 text-primary" /><span className="text-sm">{tool.name}</span></div>)}</div> : <p className="text-sm text-muted-foreground">Plugin-provided tools appear here after registration.</p>}</section>
    </CardContent>
  </Card>
}
