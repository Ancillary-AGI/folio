import { useState } from 'react';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  X, 
  Wrench, 
  RotateCcw, 
  Download,
  Layers,
  Eye,
  EyeOff,
  Zap,
  BarChart3
} from 'lucide-react';

interface MechanicalDesignPanelProps {
  onClose: () => void;
}

interface MechanicalComponent {
  id: string;
  name: string;
  type: 'beam' | 'plate' | 'shell' | 'solid' | 'joint' | 'constraint';
  geometry: {
    position: [number, number, number];
    rotation: [number, number, number];
    dimensions: { length: number; width: number; height: number };
  };
  material: string;
  properties: {
    mass: number;
    volume: number;
    centerOfMass: [number, number, number];
    momentOfInertia: [number, number, number];
  };
  loads: {
    forces: Array<{ x: number; y: number; z: number; magnitude: number }>;
    moments: Array<{ x: number; y: number; z: number; magnitude: number }>;
    pressure: number;
    temperature: number;
  };
  constraints: {
    fixed: boolean;
    pinned: boolean;
    roller: boolean;
    displacement: { x: boolean; y: boolean; z: boolean };
    rotation: { x: boolean; y: boolean; z: boolean };
  };
}

interface AnalysisResult {
  displacement: Array<{ nodeId: string; x: number; y: number; z: number }>;
  stress: Array<{ nodeId: string; vonMises: number; principal: [number, number, number] }>;
  strain: Array<{ nodeId: string; x: number; y: number; z: number }>;
  naturalFrequencies: number[];
  buckling: { criticalLoad: number; mode: number };
  fatigue: { cycles: number; safetyFactor: number };
}

// Mechanical Component Visualization
function MechanicalComponentView({ 
  components, 
  selectedComponent 
}: { 
  components: MechanicalComponent[];
  selectedComponent: string;
}) {
  return (
    <div className="w-full h-full bg-gray-900 relative overflow-hidden flex items-center justify-center">
      <svg
        width="400"
        height="300"
        viewBox="0 0 400 300"
        className="border border-gray-600"
      >
        {/* Grid */}
        <defs>
          <pattern id="mech-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#444" strokeWidth="0.5"/>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#mech-grid)" />
        
        {/* Components */}
        {components.map((component, index) => {
          const x = 50 + index * 80;
          const y = 150;
          const isSelected = component.id === selectedComponent;
          
          return (
            <g key={component.id}>
              {/* Component representation */}
              {component.type === 'beam' && (
                <rect
                  x={x - 30}
                  y={y - 5}
                  width={60}
                  height={10}
                  fill={isSelected ? '#3B82F6' : '#6B7280'}
                  stroke={isSelected ? '#1D4ED8' : '#374151'}
                  strokeWidth="2"
                />
              )}
              
              {component.type === 'plate' && (
                <rect
                  x={x - 25}
                  y={y - 15}
                  width={50}
                  height={30}
                  fill={isSelected ? '#10B981' : '#6B7280'}
                  stroke={isSelected ? '#047857' : '#374151'}
                  strokeWidth="2"
                />
              )}
              
              {component.type === 'solid' && (
                <rect
                  x={x - 20}
                  y={y - 20}
                  width={40}
                  height={40}
                  fill={isSelected ? '#F59E0B' : '#6B7280'}
                  stroke={isSelected ? '#D97706' : '#374151'}
                  strokeWidth="2"
                />
              )}
              
              {/* Forces visualization */}
              {component.loads.forces.map((force, forceIndex) => (
                <g key={forceIndex}>
                  <line
                    x1={x}
                    y1={y}
                    x2={x + force.x * 20}
                    y2={y + force.y * 20}
                    stroke="#EF4444"
                    strokeWidth="2"
                    markerEnd="url(#arrowhead)"
                  />
                </g>
              ))}
              
              {/* Component label */}
              <text
                x={x}
                y={y + 35}
                textAnchor="middle"
                fontSize="10"
                fill="white"
                fontFamily="monospace"
              >
                {component.name}
              </text>
            </g>
          );
        })}
        
        {/* Arrow marker definition */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="9"
            refY="3.5"
            orient="auto"
          >
            <polygon
              points="0 0, 10 3.5, 0 7"
              fill="#EF4444"
            />
          </marker>
        </defs>
      </svg>
      
      <div className="absolute top-4 left-4 bg-black/70 text-white px-2 py-1 rounded text-sm">
        Mechanical Analysis View
      </div>
    </div>
  );
}

export default function MechanicalDesignPanel({ onClose }: MechanicalDesignPanelProps) {
  const [components] = useState<MechanicalComponent[]>([
    {
      id: 'beam-1',
      name: 'Main Beam',
      type: 'beam',
      geometry: {
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        dimensions: { length: 2, width: 0.1, height: 0.1 }
      },
      material: 'aluminum',
      properties: {
        mass: 0.54,
        volume: 0.02,
        centerOfMass: [1, 0, 0],
        momentOfInertia: [0.001, 0.18, 0.18]
      },
      loads: {
        forces: [{ x: 0, y: -1, z: 0, magnitude: 1000 }],
        moments: [],
        pressure: 0,
        temperature: 293.15
      },
      constraints: {
        fixed: true,
        pinned: false,
        roller: false,
        displacement: { x: true, y: true, z: true },
        rotation: { x: true, y: true, z: true }
      }
    },
    {
      id: 'plate-1',
      name: 'Support Plate',
      type: 'plate',
      geometry: {
        position: [1, -0.5, 0],
        rotation: [0, 0, 0],
        dimensions: { length: 0.5, width: 0.5, height: 0.02 }
      },
      material: 'aluminum',
      properties: {
        mass: 0.135,
        volume: 0.005,
        centerOfMass: [1, -0.5, 0],
        momentOfInertia: [0.0001, 0.0001, 0.0001]
      },
      loads: {
        forces: [],
        moments: [],
        pressure: 10000,
        temperature: 293.15
      },
      constraints: {
        fixed: false,
        pinned: true,
        roller: false,
        displacement: { x: false, y: true, z: false },
        rotation: { x: true, y: false, z: true }
      }
    }
  ]);
  
  const [selectedComponent, setSelectedComponent] = useState<string>('beam-1');
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisType, setAnalysisType] = useState<'static' | 'modal' | 'thermal' | 'fatigue'>('static');

  const handleRunAnalysis = async () => {
    setIsAnalyzing(true);
    
    try {
      // Simulate analysis
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const mockResult: AnalysisResult = {
        displacement: [
          { nodeId: 'beam-1', x: 0.001, y: -0.005, z: 0 },
          { nodeId: 'plate-1', x: 0, y: -0.002, z: 0 }
        ],
        stress: [
          { nodeId: 'beam-1', vonMises: 45.2, principal: [50.1, 25.3, -5.2] },
          { nodeId: 'plate-1', vonMises: 12.8, principal: [15.2, 8.4, -2.1] }
        ],
        strain: [
          { nodeId: 'beam-1', x: 0.0002, y: -0.0008, z: 0 },
          { nodeId: 'plate-1', x: 0, y: -0.0003, z: 0 }
        ],
        naturalFrequencies: [125.5, 387.2, 892.1, 1456.8],
        buckling: { criticalLoad: 15000, mode: 1 },
        fatigue: { cycles: 1000000, safetyFactor: 2.5 }
      };
      
      setAnalysisResult(mockResult);
    } catch (error) {
      console.error('Analysis failed:', error);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleExportResults = () => {
    if (!analysisResult) return;
    
    const report = {
      timestamp: new Date().toISOString(),
      analysisType,
      components: components.length,
      results: analysisResult
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mechanical_analysis_${Date.now()}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const selectedComponentData = components.find(c => c.id === selectedComponent);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex">
        {/* Visualization Area */}
        <div className="flex-1 relative">
          <MechanicalComponentView
            components={components}
            selectedComponent={selectedComponent}
          />

          {/* Tool Palette */}
          <div className="absolute top-4 left-4 flex flex-col gap-2">
            <div className="flex gap-2">
              <Button variant="outline" size="sm">
                Front
              </Button>
              <Button variant="outline" size="sm">
                Side
              </Button>
              <Button variant="outline" size="sm">
                Top
              </Button>
              <Button variant="outline" size="sm">
                Iso
              </Button>
            </div>
          </div>

          {/* Analysis Status */}
          <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm p-3 rounded-lg border border-border">
            <div className="text-sm space-y-1">
              <div>Components: {components.length}</div>
              <div>Analysis: {analysisType}</div>
              <div>Status: {isAnalyzing ? 'Running...' : 'Ready'}</div>
              {analysisResult && (
                <div>Max Stress: {Math.max(...analysisResult.stress.map(s => s.vonMises)).toFixed(1)} MPa</div>
              )}
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="w-96 bg-card border-l border-border flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">Mechanical Design</h3>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Analysis Controls */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Wrench className="w-4 h-4" />
                  Analysis
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Analysis Type
                  </label>
                  <select
                    value={analysisType}
                    onChange={(e) => setAnalysisType(e.target.value as 'static' | 'modal' | 'thermal' | 'fatigue')}
                    className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background"
                  >
                    <option value="static">Static Structural</option>
                    <option value="modal">Modal Analysis</option>
                    <option value="thermal">Thermal Analysis</option>
                    <option value="fatigue">Fatigue Analysis</option>
                  </select>
                </div>
                
                <Button
                  onClick={handleRunAnalysis}
                  disabled={isAnalyzing}
                  className="w-full flex items-center gap-2"
                >
                  {isAnalyzing ? (
                    <>
                      <RotateCcw className="w-4 h-4 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <Zap className="w-4 h-4" />
                      Run Analysis
                    </>
                  )}
                </Button>
                
                {analysisResult && (
                  <Button
                    variant="outline"
                    onClick={handleExportResults}
                    className="w-full flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    Export Results
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Component List */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Components</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {components.map(component => (
                  <div
                    key={component.id}
                    className={`p-2 rounded cursor-pointer transition-colors ${
                      selectedComponent === component.id 
                        ? 'bg-primary/10 border border-primary/20' 
                        : 'hover:bg-accent'
                    }`}
                    onClick={() => setSelectedComponent(component.id)}
                  >
                    <div className="font-medium text-sm">{component.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {component.type} - {component.material}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Component Properties */}
            {selectedComponentData && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">Properties</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs space-y-2">
                    <div className="flex justify-between">
                      <span>Mass:</span>
                      <span>{selectedComponentData.properties.mass.toFixed(3)} kg</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Volume:</span>
                      <span>{selectedComponentData.properties.volume.toFixed(6)} m³</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Material:</span>
                      <span className="capitalize">{selectedComponentData.material}</span>
                    </div>
                  </div>
                  
                  <div>
                    <div className="text-xs font-medium mb-1">Loads</div>
                    <div className="text-xs space-y-1">
                      <div>Forces: {selectedComponentData.loads.forces.length}</div>
                      <div>Moments: {selectedComponentData.loads.moments.length}</div>
                      <div>Pressure: {selectedComponentData.loads.pressure} Pa</div>
                      <div>Temperature: {(selectedComponentData.loads.temperature - 273.15).toFixed(1)}°C</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Analysis Results */}
            {analysisResult && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Results
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-xs space-y-2">
                    <div>
                      <div className="font-medium mb-1">Stress Analysis</div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span>Max von Mises:</span>
                          <span>{Math.max(...analysisResult.stress.map(s => s.vonMises)).toFixed(1)} MPa</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Safety Factor:</span>
                          <span className="text-green-600">2.5</span>
                        </div>
                      </div>
                    </div>
                    
                    <div>
                      <div className="font-medium mb-1">Displacement</div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span>Max Displacement:</span>
                          <span>{Math.max(...analysisResult.displacement.map(d => 
                            Math.sqrt(d.x*d.x + d.y*d.y + d.z*d.z)
                          )).toFixed(3)} mm</span>
                        </div>
                      </div>
                    </div>
                    
                    {analysisType === 'modal' && (
                      <div>
                        <div className="font-medium mb-1">Natural Frequencies</div>
                        <div className="space-y-1">
                          {analysisResult.naturalFrequencies.slice(0, 3).map((freq, index) => (
                            <div key={index} className="flex justify-between">
                              <span>Mode {index + 1}:</span>
                              <span>{freq.toFixed(1)} Hz</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Display Options */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  Display
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Show Loads</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                  >
                    <Eye className="w-3 h-3" />
                  </Button>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">Show Constraints</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                  >
                    <Eye className="w-3 h-3" />
                  </Button>
                </div>
                
                <div className="flex items-center justify-between">
                  <span className="text-sm">Show Stress</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                  >
                    <EyeOff className="w-3 h-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}