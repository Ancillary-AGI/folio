import { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, Box, Cylinder } from '@react-three/drei';
import * as THREE from 'three';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { 
  RotateCcw, 
  ZoomIn, 
  ZoomOut, 
  Home, 
  Eye, 
  EyeOff, 
  Layers, 
  Download,
  Settings,
  X
} from 'lucide-react';
import { useProjectStore } from '../../stores/useProjectStore';

interface Circuit3DViewerProps {
  onClose: () => void;
}

interface Component3D {
  id: string;
  position: [number, number, number];
  rotation: [number, number, number];
  scale: [number, number, number];
  type: string;
  color: string;
  visible: boolean;
}

interface PCBLayer {
  name: string;
  color: string;
  thickness: number;
  visible: boolean;
  opacity: number;
}

// Component 3D representations
function Component3DModel({ component }: { component: Component3D }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      // Add subtle animation for selected components
      meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime) * 0.1;
    }
  });

  const getComponentGeometry = () => {
    switch (component.type) {
      case 'resistor':
        return <Cylinder args={[0.5, 0.5, 2, 8]} />;
      case 'capacitor':
        return <Cylinder args={[0.7, 0.7, 1.5, 8]} />;
      case 'ic':
        return <Box args={[2, 0.3, 1]} />;
      case 'led':
        return <Cylinder args={[0.3, 0.3, 1, 8]} />;
      case 'transistor':
        return <Box args={[0.8, 0.5, 0.6]} />;
      default:
        return <Box args={[1, 0.5, 1]} />;
    }
  };

  if (!component.visible) return null;

  return (
    <mesh
      ref={meshRef}
      position={component.position}
      rotation={component.rotation}
      scale={component.scale}
    >
      {getComponentGeometry()}
      <meshStandardMaterial color={component.color} />
    </mesh>
  );
}

// PCB Board representation
function PCBBoard({ layers }: { layers: PCBLayer[] }) {
  return (
    <group>
      {layers.map((layer, index) => (
        layer.visible && (
          <mesh key={layer.name} position={[0, -index * layer.thickness, 0]}>
            <boxGeometry args={[20, layer.thickness, 15]} />
            <meshStandardMaterial 
              color={layer.color} 
              transparent 
              opacity={layer.opacity}
            />
          </mesh>
        )
      ))}
    </group>
  );
}

// Trace/Wire representation
function Trace3D({ 
  points, 
  width = 0.1, 
  color = '#00ff00' 
}: { 
  points: Array<[number, number, number]>; 
  width?: number; 
  color?: string; 
}) {
  const geometry = new THREE.TubeGeometry(
    new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p))),
    points.length * 2,
    width,
    8,
    false
  );

  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color={color} />
    </mesh>
  );
}

// Camera controller
function CameraController({
  view
}: {
  view: string;
}) {
  const { camera } = useThree();

  useEffect(() => {
    switch (view) {
      case 'top':
        camera.position.set(0, 20, 0);
        camera.lookAt(0, 0, 0);
        break;
      case 'front':
        camera.position.set(0, 5, 20);
        camera.lookAt(0, 0, 0);
        break;
      case 'side':
        camera.position.set(20, 5, 0);
        camera.lookAt(0, 0, 0);
        break;
      case 'iso':
        camera.position.set(15, 15, 15);
        camera.lookAt(0, 0, 0);
        break;
    }
  }, [view, camera]);

  return null;
}

// Lighting setup
function Lighting() {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight 
        position={[10, 10, 5]} 
        intensity={1} 
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <pointLight position={[-10, -10, -10]} intensity={0.5} />
    </>
  );
}

export default function Circuit3DViewer({ onClose }: Circuit3DViewerProps) {
  const { components, wires } = useProjectStore();
  const [currentView, setCurrentView] = useState('iso');
  const [showGrid, setShowGrid] = useState(true);
  const [showComponents, setShowComponents] = useState(true);
  const [showTraces, setShowTraces] = useState(true);
  const [showPCB, setShowPCB] = useState(true);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  
  // Convert 2D components to 3D
  const components3D: Component3D[] = components.map((comp, index) => ({
    id: comp.id,
    position: [
      (comp.x - 400) / 20, // Scale and center
      1 + index * 0.1, // Stack components slightly
      (comp.y - 300) / 20
    ],
    rotation: [0, comp.rotation * Math.PI / 180, 0],
    scale: [1, 1, 1],
    type: comp.component.category,
    color: getComponentColor(comp.component.category),
    visible: true
  }));

  // PCB layers
  const pcbLayers: PCBLayer[] = [
    { name: 'Substrate', color: '#2d5016', thickness: 1.6, visible: true, opacity: 0.8 },
    { name: 'Bottom Copper', color: '#b87333', thickness: 0.035, visible: true, opacity: 0.9 },
    { name: 'Solder Mask', color: '#0f4c0f', thickness: 0.025, visible: true, opacity: 0.7 },
    { name: 'Top Copper', color: '#b87333', thickness: 0.035, visible: true, opacity: 0.9 },
    { name: 'Silkscreen', color: '#ffffff', thickness: 0.01, visible: true, opacity: 1.0 }
  ];

  // Convert 2D wires to 3D traces
  const traces3D = wires.map(wire => ({
    id: wire.id,
    points: wire.points.map(p => [
      (p.x - 400) / 20,
      2.1, // Above PCB surface
      (p.y - 300) / 20
    ] as [number, number, number])
  }));

  function getComponentColor(category: string): string {
    const colors: Record<string, string> = {
      'passive': '#8B4513',
      'semiconductor': '#2F4F4F',
      'ic': '#000000',
      'power': '#FF4500',
      'connector': '#FFD700',
      'switch': '#808080',
      'sensor': '#4169E1',
      'display': '#00CED1',
      'communication': '#9370DB',
      'microcontroller': '#006400',
      'memory': '#8A2BE2',
      'actuator': '#DC143C',
      'timing': '#FF69B4',
      'test': '#A0A0A0'
    };
    return colors[category] || '#696969';
  }

  const handleExport3D = () => {
    // Export 3D model (STL, OBJ, etc.)
    console.log('Exporting 3D model...');
  };

  const handleToggleLayer = (layerName: string) => {
    // Toggle layer visibility
    console.log('Toggling layer:', layerName);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl w-full max-w-7xl h-[90vh] flex">
        {/* 3D Viewport */}
        <div className="flex-1 relative">
          <Canvas
            shadows
            camera={{ position: [15, 15, 15], fov: 50 }}
            style={{ background: 'linear-gradient(to bottom, #87CEEB, #E0F6FF)' }}
          >
            <CameraController view={currentView} />
            <Lighting />
            
            {showGrid && <Grid args={[50, 50]} />}
            
            {showPCB && <PCBBoard layers={pcbLayers} />}
            
            {showComponents && components3D.map(comp => (
              <Component3DModel key={comp.id} component={comp} />
            ))}
            
            {showTraces && traces3D.map(trace => (
              <Trace3D key={trace.id} points={trace.points} />
            ))}
            
            <OrbitControls 
              enablePan={true}
              enableZoom={true}
              enableRotate={true}
              maxPolarAngle={Math.PI}
            />
          </Canvas>

          {/* View Controls Overlay */}
          <div className="absolute top-4 left-4 flex flex-col gap-2">
            <div className="flex gap-2">
              {['iso', 'top', 'front', 'side'].map(view => (
                <Button
                  key={view}
                  variant={currentView === view ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setCurrentView(view)}
                  className="capitalize"
                >
                  {view}
                </Button>
              ))}
            </div>
            
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setCurrentView('iso')}
                title="Reset View"
              >
                <Home className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                title="Reset Rotation"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Info Overlay */}
          <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm p-3 rounded-lg border border-border">
            <div className="text-sm space-y-1">
              <div>Components: {components3D.length}</div>
              <div>Traces: {traces3D.length}</div>
              <div>View: {currentView.toUpperCase()}</div>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="w-80 bg-card border-l border-border flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">3D Viewer</h3>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Visibility Controls */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Visibility</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm">Grid</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowGrid(!showGrid)}
                    className="h-6 w-6"
                  >
                    {showGrid ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Components</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowComponents(!showComponents)}
                    className="h-6 w-6"
                  >
                    {showComponents ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">Traces</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowTraces(!showTraces)}
                    className="h-6 w-6"
                  >
                    {showTraces ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm">PCB</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setShowPCB(!showPCB)}
                    className="h-6 w-6"
                  >
                    {showPCB ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* PCB Layers */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Layers className="w-4 h-4" />
                  PCB Layers
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {pcbLayers.map(layer => (
                  <div
                    key={layer.name}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                      selectedLayer === layer.name ? 'bg-primary/10' : 'hover:bg-accent'
                    }`}
                    onClick={() => setSelectedLayer(layer.name)}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded border"
                        style={{ backgroundColor: layer.color }}
                      />
                      <span className="text-xs">{layer.name}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleLayer(layer.name);
                      }}
                      className="h-5 w-5"
                    >
                      {layer.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Component List */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Components</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 max-h-40 overflow-y-auto">
                {components3D.map(comp => (
                  <div
                    key={comp.id}
                    className="flex items-center justify-between p-2 rounded hover:bg-accent cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: comp.color }}
                      />
                      <span className="text-xs">{comp.type}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                    >
                      {comp.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Export Options */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Export</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExport3D}
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-3 h-3" />
                  Export STL
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-3 h-3" />
                  Export OBJ
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-3 h-3" />
                  Export Image
                </Button>
              </CardContent>
            </Card>

            {/* Settings */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Settings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <label className="text-xs font-medium">Rendering Quality</label>
                  <select className="w-full mt-1 px-2 py-1 text-xs border border-input rounded">
                    <option>Low</option>
                    <option>Medium</option>
                    <option>High</option>
                    <option>Ultra</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium">Component Scale</label>
                  <input
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    defaultValue="1"
                    className="w-full mt-1"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Shadows</span>
                  <input type="checkbox" defaultChecked className="rounded" />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Anti-aliasing</span>
                  <input type="checkbox" defaultChecked className="rounded" />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}