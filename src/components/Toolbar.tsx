import { useState } from 'react';
import { 
  MousePointer, 
  Move, 
  RotateCw, 
  Copy, 
  Trash2, 
  ZoomIn, 
  ZoomOut, 
  Maximize, 
  Grid3X3,
  Ruler,
  Type,
  Zap,
  Undo,
  Redo,
  Save,
  Play,
  Pause,
  Square,
  Circle,
  Minus,
  ChevronDown,
  Settings
} from 'lucide-react';
import { Button } from './ui/button';
import { useAppStore } from '../stores/useAppStore';

interface ToolbarProps {
  onToolChange: (tool: string) => void;
  onAction: (action: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  isSimulating: boolean;
}

interface ToolGroup {
  name: string;
  tools: Array<{
    id: string;
    name: string;
    icon: React.ReactNode;
    shortcut?: string;
    description: string;
  }>;
}

export default function Toolbar({ onToolChange, onAction, canUndo, canRedo, isSimulating }: ToolbarProps) {
  const { activeTool, setActiveTool, viewport, setZoom } = useAppStore();
  const [showToolGroups, setShowToolGroups] = useState(false);

  const toolGroups: ToolGroup[] = [
    {
      name: 'Selection',
      tools: [
        { id: 'select', name: 'Select', icon: <MousePointer className="w-4 h-4" />, shortcut: 'V', description: 'Select and move components' },
        { id: 'move', name: 'Move', icon: <Move className="w-4 h-4" />, shortcut: 'M', description: 'Move selected items' },
        { id: 'rotate', name: 'Rotate', icon: <RotateCw className="w-4 h-4" />, shortcut: 'R', description: 'Rotate selected components' },
      ]
    },
    {
      name: 'Drawing',
      tools: [
        { id: 'wire', name: 'Wire', icon: <Zap className="w-4 h-4" />, shortcut: 'W', description: 'Draw wires between components' },
        { id: 'line', name: 'Line', icon: <Minus className="w-4 h-4" />, shortcut: 'L', description: 'Draw annotation lines' },
        { id: 'rectangle', name: 'Rectangle', icon: <Square className="w-4 h-4" />, shortcut: 'Shift+R', description: 'Draw rectangles' },
        { id: 'circle', name: 'Circle', icon: <Circle className="w-4 h-4" />, shortcut: 'C', description: 'Draw circles' },
        { id: 'text', name: 'Text', icon: <Type className="w-4 h-4" />, shortcut: 'T', description: 'Add text annotations' },
      ]
    },
    {
      name: 'Measurement',
      tools: [
        { id: 'measure', name: 'Measure', icon: <Ruler className="w-4 h-4" />, shortcut: 'Shift+M', description: 'Measure distances' },
      ]
    }
  ];

  const handleToolSelect = (toolId: string) => {
    setActiveTool(toolId as unknown);
    onToolChange(toolId);
  };

  const handleZoom = (direction: 'in' | 'out' | 'fit') => {
    switch (direction) {
      case 'in':
        setZoom(viewport.zoom * 1.2);
        break;
      case 'out':
        setZoom(viewport.zoom / 1.2);
        break;
      case 'fit':
        setZoom(1);
        onAction('fit-to-screen');
        break;
    }
  };

  return (
    <div className="bg-card border-b border-border p-2">
      <div className="flex items-center gap-1">
        {/* File Operations */}
        <div className="flex items-center gap-1 pr-2 border-r border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAction('save')}
            title="Save (Ctrl+S)"
            className="h-8 w-8"
          >
            <Save className="w-4 h-4" />
          </Button>
        </div>

        {/* Undo/Redo */}
        <div className="flex items-center gap-1 px-2 border-r border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAction('undo')}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="h-8 w-8"
          >
            <Undo className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAction('redo')}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="h-8 w-8"
          >
            <Redo className="w-4 h-4" />
          </Button>
        </div>

        {/* Main Tools */}
        <div className="flex items-center gap-1 px-2 border-r border-border">
          {toolGroups[0].tools.map((tool) => (
            <Button
              key={tool.id}
              variant={activeTool === tool.id ? 'default' : 'ghost'}
              size="icon"
              onClick={() => handleToolSelect(tool.id)}
              title={`${tool.name} (${tool.shortcut})`}
              className="h-8 w-8"
            >
              {tool.icon}
            </Button>
          ))}
          
          {/* More Tools Dropdown */}
          <div className="relative">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowToolGroups(!showToolGroups)}
              className="h-8 w-8"
            >
              <ChevronDown className="w-4 h-4" />
            </Button>
            
            {showToolGroups && (
              <div className="absolute top-full left-0 mt-1 bg-card border border-border rounded-lg shadow-lg z-50 min-w-48">
                {toolGroups.slice(1).map((group) => (
                  <div key={group.name} className="p-2">
                    <div className="text-xs font-medium text-muted-foreground mb-2 px-2">
                      {group.name}
                    </div>
                    <div className="space-y-1">
                      {group.tools.map((tool) => (
                        <Button
                          key={tool.id}
                          variant={activeTool === tool.id ? 'default' : 'ghost'}
                          size="sm"
                          onClick={() => {
                            handleToolSelect(tool.id);
                            setShowToolGroups(false);
                          }}
                          className="w-full justify-start gap-2 h-8"
                        >
                          {tool.icon}
                          <span className="flex-1 text-left">{tool.name}</span>
                          {tool.shortcut && (
                            <span className="text-xs text-muted-foreground">{tool.shortcut}</span>
                          )}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Edit Operations */}
        <div className="flex items-center gap-1 px-2 border-r border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAction('copy')}
            title="Copy (Ctrl+C)"
            className="h-8 w-8"
          >
            <Copy className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAction('delete')}
            title="Delete (Del)"
            className="h-8 w-8"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>

        {/* View Controls */}
        <div className="flex items-center gap-1 px-2 border-r border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleZoom('in')}
            title="Zoom In (+)"
            className="h-8 w-8"
          >
            <ZoomIn className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleZoom('out')}
            title="Zoom Out (-)"
            className="h-8 w-8"
          >
            <ZoomOut className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => handleZoom('fit')}
            title="Fit to Screen (F)"
            className="h-8 w-8"
          >
            <Maximize className="w-4 h-4" />
          </Button>
          
          {/* Zoom Level Display */}
          <div className="px-2 py-1 text-xs bg-muted rounded min-w-16 text-center">
            {Math.round(viewport.zoom * 100)}%
          </div>
        </div>

        {/* Grid and Snap Controls */}
        <div className="flex items-center gap-1 px-2 border-r border-border">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAction('toggle-grid')}
            title="Toggle Grid (G)"
            className="h-8 w-8"
          >
            <Grid3X3 className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAction('toggle-rulers')}
            title="Toggle Rulers"
            className="h-8 w-8"
          >
            <Ruler className="w-4 h-4" />
          </Button>
        </div>

        {/* Simulation Controls */}
        <div className="flex items-center gap-1 px-2">
          <Button
            variant={isSimulating ? 'destructive' : 'default'}
            size="icon"
            onClick={() => onAction(isSimulating ? 'stop-simulation' : 'start-simulation')}
            title={isSimulating ? 'Stop Simulation' : 'Start Simulation'}
            className="h-8 w-8"
          >
            {isSimulating ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </Button>
        </div>

        {/* Settings */}
        <div className="flex items-center gap-1 ml-auto">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => onAction('open-settings')}
            title="Settings"
            className="h-8 w-8"
          >
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Tool Info Bar */}
      {activeTool && (
        <div className="mt-2 px-2 py-1 bg-muted/30 rounded text-xs text-muted-foreground">
          {toolGroups
            .flatMap(group => group.tools)
            .find(tool => tool.id === activeTool)?.description || 'Tool selected'}
        </div>
      )}
    </div>
  );
}