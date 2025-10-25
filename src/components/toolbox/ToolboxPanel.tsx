import React, { useState } from 'react'
import { toolboxManager } from '../../lib/toolbox/toolboxManager'
import { ToolboxComponent } from '../../types/toolbox'
import { Button } from '../ui/button'
import {
  Wrench,
  CircuitBoard,
  Bot,
  Code,
  Cog,
  Atom,
  Users,
  Search,
  Grid3X3,
  List
} from 'lucide-react'

interface ToolboxPanelProps {
  onComponentSelect: (component: ToolboxComponent) => void
  onToolSelect: (toolId: string) => void
}

const toolboxIcons = {
  electronics: CircuitBoard,
  mechanics: Cog,
  robotics: Bot,
  programming: Code,
  simulation: Atom,
  collaboration: Users
}


export default function ToolboxPanel({ onComponentSelect, onToolSelect }: ToolboxPanelProps) {
  const [activeToolbox, setActiveToolbox] = useState<string>('electronics')
  const [searchQuery, setSearchQuery] = useState('')
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')

  const toolboxes = toolboxManager.getAllToolboxes()
  const activeToolboxData = toolboxManager.getToolbox(activeToolbox)
  const allComponents = toolboxManager.getToolboxComponents(activeToolbox)

  // Filter components based on search and category
  const filteredComponents = allComponents.filter(component => {
    const matchesSearch = component.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         component.category.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesCategory = selectedCategory === 'all' || component.category === selectedCategory
    return matchesSearch && matchesCategory
  })

  // Get unique categories for filtering
  const categories = ['all', ...Array.from(new Set(allComponents.map(c => c.category)))]

  const handleComponentDragStart = (e: React.DragEvent, component: ToolboxComponent) => {
    e.dataTransfer.setData('componentId', component.id)
    e.dataTransfer.setData('toolboxId', activeToolbox)
    e.dataTransfer.effectAllowed = 'copy'
  }

  return (
    <div className="w-80 bg-card border-r border-border flex flex-col h-full">
      {/* Toolbox Selector */}
      <div className="p-4 border-b border-border">
        <h3 className="text-lg font-semibold text-foreground mb-3">Toolboxes</h3>
        <div className="grid grid-cols-2 gap-2">
          {toolboxes.map(toolbox => {
            const Icon = toolboxIcons[toolbox.category]
            return (
              <button
                key={toolbox.id}
                onClick={() => setActiveToolbox(toolbox.id)}
                className={`p-3 rounded-lg border transition-all ${
                  activeToolbox === toolbox.id
                    ? 'border-primary bg-primary/10'
                    : 'border-border hover:border-primary/50'
                }`}
              >
                <Icon className="w-6 h-6 mx-auto mb-2 text-foreground" />
                <div className="text-xs font-medium text-center">{toolbox.name}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Search and Filters */}
      <div className="p-4 border-b border-border space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search components..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          />
        </div>

        <div className="flex items-center justify-between">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="flex-1 mr-2 px-3 py-2 border border-border rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          >
            {categories.map(category => (
              <option key={category} value={category}>
                {category === 'all' ? 'All Categories' : category.charAt(0).toUpperCase() + category.slice(1)}
              </option>
            ))}
          </select>

          <div className="flex border border-border rounded-lg">
            <button
              onClick={() => setViewMode('grid')}
              className={`p-2 ${viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              <Grid3X3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`p-2 ${viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Component Library */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h4 className="font-semibold text-foreground">
              {activeToolboxData?.name} Components
            </h4>
            <span className="px-2 py-1 bg-secondary text-secondary-foreground text-xs rounded-full">
              {filteredComponents.length}
            </span>
          </div>

          {filteredComponents.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Wrench className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No components found</p>
              <p className="text-sm">Try adjusting your search or filters</p>
            </div>
          ) : (
            <div className={
              viewMode === 'grid'
                ? 'grid grid-cols-2 gap-3'
                : 'space-y-2'
            }>
              {filteredComponents.map(component => (
                <div
                  key={component.id}
                  draggable
                  onDragStart={(e) => handleComponentDragStart(e, component)}
                  onClick={() => onComponentSelect(component)}
                  className={`${
                    viewMode === 'grid'
                      ? 'p-3 border border-border rounded-lg hover:border-primary hover:bg-accent cursor-pointer transition-all'
                      : 'p-3 border border-border rounded-lg hover:border-primary hover:bg-accent cursor-pointer transition-all flex items-center space-x-3'
                  }`}
                >
                  {viewMode === 'grid' ? (
                    <>
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center mb-2">
                        <CircuitBoard className="w-4 h-4 text-primary" />
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium text-foreground truncate">
                          {component.name}
                        </div>
                        <span className="px-2 py-1 border border-border text-xs rounded mt-1 inline-block">
                          {component.category}
                        </span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="w-8 h-8 bg-primary/10 rounded-lg flex items-center justify-center flex-shrink-0">
                        <CircuitBoard className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-foreground truncate">
                          {component.name}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {component.category} • {component.type}
                        </div>
                      </div>
                      <span className="px-2 py-1 border border-border text-xs rounded flex-shrink-0">
                        {component.ports.length} ports
                      </span>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Tools Section */}
      {activeToolboxData?.tools && activeToolboxData.tools.length > 0 && (
        <div className="p-4 border-t border-border">
          <h4 className="font-semibold text-foreground mb-3">Tools</h4>
          <div className="space-y-2">
            {activeToolboxData.tools.map(tool => (
              <Button
                key={tool.id}
                variant="outline"
                size="sm"
                className="w-full justify-start"
                onClick={() => onToolSelect(tool.id)}
              >
                <Wrench className="w-4 h-4 mr-2" />
                {tool.name}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}