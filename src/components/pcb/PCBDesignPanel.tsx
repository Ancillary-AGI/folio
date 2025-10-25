import { useState, useCallback } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  X, 
  Layers, 
  Route, 
  Zap, 
  Grid3X3, 
  Eye, 
  EyeOff,
  Download,
  Upload,
  Settings,
  Ruler,
  RotateCcw,
  Move,
  MousePointer,
} from 'lucide-react';
import type { PlacedComponent, Wire, Point } from '../../types';

interface PCBDesignPanelProps {
  onClose: () => void;
  components?: PlacedComponent[];
  wires?: Wire[];
}

interface PCBLayer {
  id: string;
  name: string;
  type: 'signal' | 'power' | 'ground' | 'mechanical' | 'silkscreen' | 'soldermask' | 'paste';
  color: string;
  thickness: number;
  visible: boolean;
  locked: boolean;
}

interface PCBFootprint {
  id: string;
  name: string;
  pads: Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    shape: 'rectangle' | 'circle' | 'oval';
    drill?: number;
    type: 'through-hole' | 'smd';
  }>;
  outline: Point[];
  silkscreen: Point[];
}

interface PCBComponent {
  id: string;
  footprint: PCBFootprint;
  position: Point;
  rotation: number;
  layer: 'top' | 'bottom';
  reference: string;
  value: string;
}

interface PCBTrace {
  id: string;
  layer: string;
  width: number;
  points: Point[];
  netName: string;
  style: 'solid' | 'dashed';
}

interface PCBVia {
  id: string;
  position: Point;
  drillSize: number;
  padSize: number;
  netName: string;
  layers: string[];
}

interface DesignRule {
  id: string;
  name: string;
  type: 'clearance' | 'width' | 'via' | 'drill';
  value: number;
  unit: 'mm' | 'mil';
  enabled: boolean;
}

// PCB Canvas Component
function PCBCanvas({ 
  components, 
  traces, 
  vias, 
  boardSize, 
  selectedLayer 
}: { 
  components: PCBComponent[];
  traces: PCBTrace[];
  vias: PCBVia[];
  boardSize: { width: number; height: number };
  selectedLayer: string;
}) {
  return (
    <div className="w-full h-full bg-gray-900 relative overflow-hidden">
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${boardSize.width} ${boardSize.height}`}
        className="absolute inset-0"
      >
        {/* PCB Substrate */}
        <rect
          x="0"
          y="0"
          width={boardSize.width}
          height={boardSize.height}
          fill="#2D5A27"
          stroke="#1a4a1a"
          strokeWidth="0.5"
        />
        
        {/* Grid */}
        <defs>
          <pattern id="grid" width="5" height="5" patternUnits="userSpaceOnUse">
            <path d="M 5 0 L 0 0 0 5" fill="none" stroke="#3a5a3a" strokeWidth="0.2"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        
        {/* PCB Traces */}
        {traces.map(trace => (
          <g key={trace.id}>
            <polyline
              points={trace.points.map(p => `${p.x},${p.y}`).join(' ')}
              fill="none"
              stroke="#00FF00"
              strokeWidth={trace.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        ))}
        
        {/* PCB Vias */}
        {vias.map(via => (
          <g key={via.id}>
            <circle
              cx={via.position.x}
              cy={via.position.y}
              r={via.padSize / 2}
              fill="#FFD700"
              stroke="#CC9900"
              strokeWidth="0.1"
            />
            <circle
              cx={via.position.x}
              cy={via.position.y}
              r={via.drillSize / 2}
              fill="#000000"
            />
          </g>
        ))}
        
        {/* PCB Components */}
        {components.map(component => (
          <g key={component.id} transform={`translate(${component.position.x}, ${component.position.y}) rotate(${component.rotation})`}>
            {/* Component Body */}
            <rect
              x="-5"
              y="-2.5"
              width="10"
              height="5"
              fill={component.layer === 'top' ? '#2D5A87' : '#8B4513'}
              stroke="#1a3a5a"
              strokeWidth="0.2"
            />
            
            {/* Component Pads */}
            {component.footprint.pads.map(pad => (
              <rect
                key={pad.id}
                x={pad.x - pad.width / 2}
                y={pad.y - pad.height / 2}
                width={pad.width}
                height={pad.height}
                fill="#FFD700"
                stroke="#CC9900"
                strokeWidth="0.1"
              />
            ))}
            
            {/* Reference Designator */}
            <text
              x="0"
              y="-3"
              textAnchor="middle"
              fontSize="1.5"
              fill="white"
              fontFamily="monospace"
            >
              {component.reference}
            </text>
          </g>
        ))}
      </svg>
      
      {/* Layer indicator */}
      <div className="absolute top-4 left-4 bg-black/70 text-white px-2 py-1 rounded text-sm">
        Layer: {selectedLayer}
      </div>
    </div>
  );
}

export default function PCBDesignPanel({ onClose, components = [], wires = [] }: PCBDesignPanelProps) {
  const [pcbLayers] = useState<PCBLayer[]>([
    { id: 'top-signal', name: 'Top Signal', type: 'signal', color: '#FF0000', thickness: 0.035, visible: true, locked: false },
    { id: 'gnd', name: 'Ground', type: 'ground', color: '#00FF00', thickness: 0.035, visible: true, locked: false },
    { id: 'power', name: 'Power', type: 'power', color: '#0000FF', thickness: 0.035, visible: true, locked: false },
    { id: 'bottom-signal', name: 'Bottom Signal', type: 'signal', color: '#FFFF00', thickness: 0.035, visible: true, locked: false },
    { id: 'top-silkscreen', name: 'Top Silkscreen', type: 'silkscreen', color: '#FFFFFF', thickness: 0.01, visible: true, locked: false },
    { id: 'bottom-silkscreen', name: 'Bottom Silkscreen', type: 'silkscreen', color: '#FFFFFF', thickness: 0.01, visible: false, locked: false },
    { id: 'top-soldermask', name: 'Top Soldermask', type: 'soldermask', color: '#008000', thickness: 0.01, visible: true, locked: false },
    { id: 'bottom-soldermask', name: 'Bottom Soldermask', type: 'soldermask', color: '#008000', thickness: 0.01, visible: false, locked: false }
  ]);
  
  const [pcbComponents, setPcbComponents] = useState<PCBComponent[]>([]);
  const [pcbTraces, setPcbTraces] = useState<PCBTrace[]>([]);
  const [pcbVias] = useState<PCBVia[]>([]);
  const [selectedLayer, setSelectedLayer] = useState('top-signal');
  const [activeTool, setActiveTool] = useState<'select' | 'route' | 'via' | 'move'>('select');
  const [boardSize] = useState({ width: 100, height: 80 });
  const [designRules] = useState<DesignRule[]>([
    { id: 'min-trace-width', name: 'Minimum Trace Width', type: 'width', value: 0.1, unit: 'mm', enabled: true },
    { id: 'min-clearance', name: 'Minimum Clearance', type: 'clearance', value: 0.1, unit: 'mm', enabled: true },
    { id: 'min-via-size', name: 'Minimum Via Size', type: 'via', value: 0.2, unit: 'mm', enabled: true },
    { id: 'min-drill-size', name: 'Minimum Drill Size', type: 'drill', value: 0.15, unit: 'mm', enabled: true }
  ]);
  const [showDRC, setShowDRC] = useState(false);
  const [drcResults, setDrcResults] = useState<Array<{
    id: string;
    type: 'error' | 'warning';
    message: string;
    location: Point;
  }>>([]);

  // Initialize PCB components from schematic
  useState(() => {
    const initialPcbComponents: PCBComponent[] = components.map((comp, index) => ({
      id: comp.id,
      footprint: {
        id: `footprint-${comp.id}`,
        name: comp.component.name,
        pads: comp.component.pins.map((pin, pinIndex) => ({
          id: pin.id,
          x: pinIndex * 2.54 - (comp.component.pins.length - 1) * 1.27,
          y: 0,
          width: 1.5,
          height: 1.5,
          shape: 'rectangle' as const,
          drill: 0.8,
          type: 'through-hole' as const
        })),
        outline: [
          { x: -5, y: -2.5 },
          { x: 5, y: -2.5 },
          { x: 5, y: 2.5 },
          { x: -5, y: 2.5 }
        ],
        silkscreen: []
      },
      position: { x: index * 20, y: index * 15 },
      rotation: 0,
      layer: 'top',
      reference: comp.reference,
      value: comp.component.name
    }));
    
    setPcbComponents(initialPcbComponents);
  });

  const handleAutoRoute = useCallback(() => {
    // Simple auto-routing algorithm
    const newTraces: PCBTrace[] = [];
    
    wires.forEach((wire, index) => {
      if (wire.points.length >= 2) {
        const trace: PCBTrace = {
          id: `trace-${index}`,
          layer: selectedLayer,
          width: 0.2,
          points: wire.points,
          netName: wire.netName || `NET_${index}`,
          style: 'solid'
        };
        newTraces.push(trace);
      }
    });
    
    setPcbTraces(newTraces);
  }, [wires, selectedLayer]);

  const handleDRC = useCallback(() => {
    const results: Array<{
      id: string;
      type: 'error' | 'warning';
      message: string;
      location: Point;
    }> = [];
    
    // Check trace width violations
    pcbTraces.forEach(trace => {
      const minWidth = designRules.find(r => r.id === 'min-trace-width')?.value || 0.1;
      if (trace.width < minWidth) {
        results.push({
          id: `drc-${trace.id}`,
          type: 'error',
          message: `Trace width ${trace.width}mm is below minimum ${minWidth}mm`,
          location: trace.points[0]
        });
      }
    });
    
    // Check clearance violations
    for (let i = 0; i < pcbTraces.length; i++) {
      for (let j = i + 1; j < pcbTraces.length; j++) {
        const trace1 = pcbTraces[i];
        const trace2 = pcbTraces[j];
        
        // Simplified clearance check
        const minClearance = designRules.find(r => r.id === 'min-clearance')?.value || 0.1;
        const distance = Math.sqrt(
          Math.pow(trace1.points[0].x - trace2.points[0].x, 2) +
          Math.pow(trace1.points[0].y - trace2.points[0].y, 2)
        );
        
        if (distance < minClearance + trace1.width / 2 + trace2.width / 2) {
          results.push({
            id: `drc-clearance-${i}-${j}`,
            type: 'error',
            message: `Clearance violation between traces`,
            location: trace1.points[0]
          });
        }
      }
    }
    
    setDrcResults(results);
    setShowDRC(true);
  }, [pcbTraces, designRules]);

  const handleExportGerber = () => {
    // Generate Gerber files
    const gerberData = {
      layers: pcbLayers.filter(l => l.visible),
      components: pcbComponents,
      traces: pcbTraces,
      vias: pcbVias,
      boardSize,
      timestamp: new Date().toISOString()
    };
    
    const blob = new Blob([JSON.stringify(gerberData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pcb_gerber_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex">
        {/* PCB Viewport */}
        <div className="flex-1 relative">
          <PCBCanvas
            components={pcbComponents}
            traces={pcbTraces}
            vias={pcbVias}
            boardSize={boardSize}
            selectedLayer={selectedLayer}
          />

          {/* Tool Palette */}
          <div className="absolute top-4 left-4 flex flex-col gap-2">
            <Button
              variant={activeTool === 'select' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTool('select')}
            >
              <MousePointer className="w-4 h-4" />
            </Button>
            <Button
              variant={activeTool === 'route' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTool('route')}
            >
              <Route className="w-4 h-4" />
            </Button>
            <Button
              variant={activeTool === 'via' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTool('via')}
            >
              <Zap className="w-4 h-4" />
            </Button>
            <Button
              variant={activeTool === 'move' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setActiveTool('move')}
            >
              <Move className="w-4 h-4" />
            </Button>
          </div>

          {/* View Controls */}
          <div className="absolute top-4 right-4 flex gap-2">
            <Button variant="outline" size="sm">
              Top
            </Button>
            <Button variant="outline" size="sm">
              Bottom
            </Button>
            <Button variant="outline" size="sm">
              3D
            </Button>
          </div>

          {/* Status Bar */}
          <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm p-3 rounded-lg border border-border">
            <div className="text-sm space-y-1">
              <div>Board: {boardSize.width} × {boardSize.height} mm</div>
              <div>Layer: {pcbLayers.find(l => l.id === selectedLayer)?.name}</div>
              <div>Components: {pcbComponents.length}</div>
              <div>Traces: {pcbTraces.length}</div>
              <div>Vias: {pcbVias.length}</div>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="w-96 bg-card border-l border-border flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">PCB Design</h3>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Layer Stack */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Layer Stack
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pcbLayers.map(layer => (
                  <div
                    key={layer.id}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                      selectedLayer === layer.id 
                        ? 'bg-primary/10 border border-primary/20' 
                        : 'hover:bg-accent'
                    }`}
                    onClick={() => setSelectedLayer(layer.id)}
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="w-3 h-3 rounded" 
                        style={{ backgroundColor: layer.color }}
                      />
                      <span className="text-sm font-medium">{layer.name}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Toggle layer visibility
                        }}
                      >
                        {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Routing Tools */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Route className="w-4 h-4" />
                  Routing
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={handleAutoRoute}
                  className="w-full flex items-center gap-2"
                >
                  <RotateCcw className="w-4 h-4" />
                  Auto Route
                </Button>
                
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Trace Width (mm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    defaultValue="0.2"
                    className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Via Size (mm)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.2"
                    defaultValue="0.6"
                    className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                  />
                </div>
              </CardContent>
            </Card>

            {/* Design Rules */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Ruler className="w-4 h-4" />
                  Design Rules
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  onClick={handleDRC}
                  className="w-full flex items-center gap-2"
                >
                  <Grid3X3 className="w-4 h-4" />
                  Run DRC
                </Button>
                
                {showDRC && (
                  <div className="space-y-2">
                    <div className="text-xs font-medium">
                      DRC Results: {drcResults.length} issues
                    </div>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {drcResults.map(result => (
                        <div
                          key={result.id}
                          className={`p-2 rounded text-xs ${
                            result.type === 'error' 
                              ? 'bg-red-100 text-red-800 border border-red-200' 
                              : 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                          }`}
                        >
                          {result.message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="space-y-2">
                  {designRules.map(rule => (
                    <div key={rule.id} className="flex items-center justify-between text-xs">
                      <span>{rule.name}:</span>
                      <span>{rule.value} {rule.unit}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Export Options */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  Export
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  variant="outline"
                  onClick={handleExportGerber}
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-4 h-4" />
                  Export Gerber
                </Button>
                
                <Button
                  variant="outline"
                  className="w-full flex items-center gap-2"
                >
                  <Upload className="w-4 h-4" />
                  Export Pick & Place
                </Button>
                
                <Button
                  variant="outline"
                  className="w-full flex items-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  Export Drill Files
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}