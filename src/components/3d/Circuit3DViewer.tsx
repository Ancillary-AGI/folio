import { useRef, useEffect, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
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
import { downloadFile } from '../../lib/exportUtils';
import { STLExporter } from '../../lib/3d/stlExporter';
import { objExporter } from '../../lib/3d/objExporter';
import { arvrPreviewService } from '../../lib/arvr/arvrPreview';
import { buildPcbScene, type PcbScene } from '../../lib/pcb/pcbScene';

interface XRSessionLike {
  addEventListener(type: 'end', listener: () => void): void;
}

interface XRSystemLike {
  requestSession(
    mode: 'immersive-ar' | 'immersive-vr',
    init?: { optionalFeatures?: string[] },
  ): Promise<XRSessionLike>;
}

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

type ComponentShape =
  | { kind: 'box'; size: [number, number, number] }
  | { kind: 'cylinder'; radiusTop: number; radiusBottom: number; height: number; segments: number };

/** Shared geometry spec so the rendered scene and the exporters can never drift apart. */
const COMPONENT_SHAPES: Record<string, ComponentShape> = {
  resistor: { kind: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 2, segments: 8 },
  capacitor: { kind: 'cylinder', radiusTop: 0.7, radiusBottom: 0.7, height: 1.5, segments: 8 },
  ic: { kind: 'box', size: [2, 0.3, 1] },
  led: { kind: 'cylinder', radiusTop: 0.3, radiusBottom: 0.3, height: 1, segments: 8 },
  transistor: { kind: 'box', size: [0.8, 0.5, 0.6] },
  // Realistic SMD bodies (mm-ish units): 0805 chip, SOT-23, pin header, crystal.
  passive: { kind: 'box', size: [2.0, 0.6, 1.25] },
  semiconductor: { kind: 'box', size: [2.9, 0.8, 2.4] },
  microcontroller: { kind: 'box', size: [7, 1, 7] },
  connector: { kind: 'box', size: [5.08, 2.5, 2.54] },
  timing: { kind: 'box', size: [11, 3, 4.5] },
  power: { kind: 'cylinder', radiusTop: 0.5, radiusBottom: 0.5, height: 1, segments: 12 },
};

const DEFAULT_SHAPE: ComponentShape = { kind: 'box', size: [1, 0.5, 1] };

function geometryFor(type: string): THREE.BufferGeometry {
  const shape = COMPONENT_SHAPES[type] ?? DEFAULT_SHAPE;
  return shape.kind === 'box'
    ? new THREE.BoxGeometry(...shape.size)
    : new THREE.CylinderGeometry(shape.radiusTop, shape.radiusBottom, shape.height, shape.segments);
}

// Component 3D representations — brightness follows the live frame.
function Component3DModel({ component, glow = 0 }: { component: Component3D; glow?: number }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geometry = useMemo(() => geometryFor(component.type), [component.type]);

  useFrame((state) => {
    if (meshRef.current) {
      // Add subtle animation for selected components
      meshRef.current.rotation.y = Math.sin(state.clock.elapsedTime) * 0.1;
    }
  });

  if (!component.visible) return null;

  return (
    <mesh
      ref={meshRef}
      position={component.position}
      rotation={component.rotation}
      scale={component.scale}
      geometry={geometry}
    >
      <meshStandardMaterial
        color={component.color}
        emissive={component.color}
        emissiveIntensity={glow * 0.9}
      />
    </mesh>
  );
}

// PCB Board representation — demo board is a real 60x53 mm FR-4 stackup.
function PCBBoard({ layers }: { layers: PCBLayer[] }) {
  return (
    <group>
      {layers.map((layer, index) => (
        layer.visible && (
          <mesh key={layer.name} position={[0, -index * layer.thickness, 0]}>
            <boxGeometry args={[60, layer.thickness, 53]} />
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

interface BoardGroupOptions {
  showPCB: boolean;
  showTraces: boolean;
  showComponents: boolean;
  hiddenLayerIds: ReadonlySet<string>;
  hiddenComponentIds: ReadonlySet<string>;
  componentScale: number;
}

/**
 * Real routed-board geometry in scene units (millimetres, Y up). The viewport
 * and the STL/OBJ exporters both consume this group, so what is exported is
 * exactly what is displayed: outline, traces per copper layer, via barrels,
 * footprint pads and component bodies.
 */
function buildBoardGroup(scene: PcbScene, options: BoardGroupOptions): THREE.Group {
  const group = new THREE.Group();
  group.name = 'pcb-layout';
  const { board } = scene;
  const copperMaterial = new THREE.MeshStandardMaterial({
    color: '#c8873a',
    metalness: 0.75,
    roughness: 0.35,
  });

  if (options.showPCB) {
    const substrate = new THREE.Mesh(
      new THREE.BoxGeometry(board.widthMm, board.thicknessMm, board.heightMm),
      new THREE.MeshStandardMaterial({ color: '#1b4d2e', roughness: 0.85, metalness: 0.05 }),
    );
    substrate.name = 'pcb-substrate';
    group.add(substrate);

    for (const layer of scene.layers) {
      if (layer.kind === 'copper' || options.hiddenLayerIds.has(layer.id)) continue;
      const surface = new THREE.Mesh(
        new THREE.BoxGeometry(board.widthMm, layer.thicknessMm, board.heightMm),
        new THREE.MeshStandardMaterial({
          color: layer.color,
          transparent: true,
          opacity: layer.kind === 'mask' ? 0.22 : 0.4,
          roughness: 0.6,
          depthWrite: false,
        }),
      );
      surface.name = `layer-${layer.id}`;
      surface.position.y = layer.yMm;
      group.add(surface);
    }
  }

  if (options.showTraces) {
    for (const segment of scene.traces) {
      if (options.hiddenLayerIds.has(segment.layerId)) continue;
      const layer = scene.layers.find((entry) => entry.id === segment.layerId);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(segment.lengthMm, layer?.thicknessMm ?? 0.035, segment.widthMm),
        copperMaterial,
      );
      mesh.name = `trace-${segment.id}`;
      mesh.position.set(
        (segment.start.x + segment.end.x) / 2,
        segment.start.y,
        (segment.start.z + segment.end.z) / 2,
      );
      mesh.rotation.y = (segment.rotationYDeg * Math.PI) / 180;
      group.add(mesh);
    }

    for (const via of scene.vias) {
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(via.padDiameterMm / 2, via.padDiameterMm / 2, via.heightMm, 16),
        copperMaterial,
      );
      barrel.name = `via-${via.id}`;
      barrel.position.set(via.position.x, 0, via.position.z);
      group.add(barrel);

      const drill = new THREE.Mesh(
        new THREE.CylinderGeometry(via.drillDiameterMm / 2, via.drillDiameterMm / 2, via.heightMm + 0.02, 12),
        new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.9 }),
      );
      drill.position.copy(barrel.position);
      group.add(drill);
    }
  }

  if (options.showComponents) {
    const scale = options.componentScale;
    for (const component of scene.components) {
      if (options.hiddenComponentIds.has(component.id)) continue;
      const bodyGeometry = component.bodyShape === 'cylinder'
        ? new THREE.CylinderGeometry(component.bodyWidthMm / 2, component.bodyWidthMm / 2, component.bodyHeightMm, 20)
        : new THREE.BoxGeometry(component.bodyWidthMm, component.bodyHeightMm, component.bodyDepthMm);
      const body = new THREE.Mesh(
        bodyGeometry,
        new THREE.MeshStandardMaterial({ color: component.color, roughness: 0.55, metalness: 0.1 }),
      );
      body.name = `component-${component.id}`;
      body.position.set(component.position.x, component.position.y, component.position.z);
      body.rotation.y = (component.rotationYDeg * Math.PI) / 180;
      if (component.bodyShape === 'cylinder' && component.bodyDepthMm > 0) {
        body.scale.set(1, 1, component.bodyDepthMm / component.bodyWidthMm);
      }
      if (scale !== 1) body.scale.multiplyScalar(scale);
      group.add(body);

      for (const pad of component.pads) {
        const padGeometry = pad.shape === 'circle'
          ? new THREE.CylinderGeometry(pad.widthMm / 2, pad.widthMm / 2, 0.035, 12)
          : new THREE.BoxGeometry(pad.widthMm, 0.035, pad.depthMm);
        const padMesh = new THREE.Mesh(padGeometry, copperMaterial);
        padMesh.name = `pad-${pad.id}`;
        padMesh.position.set(pad.position.x, pad.position.y, pad.position.z);
        padMesh.rotation.y = (component.rotationYDeg * Math.PI) / 180;
        group.add(padMesh);
      }
    }
  }

  group.updateMatrixWorld(true);
  return group;
}

const VIEW_POSITIONS: Record<string, [number, number, number]> = {
  iso: [1, 1, 1],
  top: [0, 1.4, 0.001],
  front: [0, 0.35, 1],
  side: [1, 0.35, 0],
};

// Camera controller — the canonical viewpoints are unit vectors scaled to the
// board so a 100 mm board is framed the same way a 50 mm one is.
function CameraController({
  view,
  zoom,
  reframe,
  radius,
}: {
  view: string;
  zoom: number;
  reframe: number;
  radius: number;
}) {
  const { camera } = useThree();

  useEffect(() => {
    const base = VIEW_POSITIONS[view] ?? VIEW_POSITIONS.iso;
    const distance = (radius * 1.9) / zoom;
    camera.position.set(base[0] * distance, base[1] * distance, base[2] * distance);
    camera.lookAt(0, 0, 0);
  }, [view, zoom, reframe, radius, camera]);

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
  const pcbLayout = useProjectStore((s) => s.pcbLayout);
  const liveFrame = useProjectStore((s) => s.liveFrame);
  const [currentView, setCurrentView] = useState('iso');
  const [showGrid, setShowGrid] = useState(true);
  const [showComponents, setShowComponents] = useState(true);
  const [showTraces, setShowTraces] = useState(true);
  const [showPCB, setShowPCB] = useState(true);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [hiddenComponentIds, setHiddenComponentIds] = useState<string[]>([]);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [reframe, setReframe] = useState(0);
  const [shadows, setShadows] = useState(true);
  const [pixelRatio, setPixelRatio] = useState(1);
  const [componentScale, setComponentScale] = useState(1);
  const [xrStatus, setXrStatus] = useState('');
  const [xrBusy, setXrBusy] = useState(false);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);

  // The routed layout wins: it is the only representation that matches the
  // copper the fab package contains. The schematic projection below is a
  // preview for boards that have not been placed/routed yet.
  const pcbSceneState = useMemo(() => {
    if (!pcbLayout) return { scene: null as PcbScene | null, error: null as string | null };
    try {
      return { scene: buildPcbScene(pcbLayout), error: null };
    } catch (error) {
      return {
        scene: null,
        error: error instanceof Error ? error.message : 'The PCB layout could not be read.',
      };
    }
  }, [pcbLayout]);
  const scene = pcbSceneState.scene;

  const hiddenLayerSet = useMemo(() => new Set(hiddenLayerIds), [hiddenLayerIds]);
  const hiddenComponentSet = useMemo(() => new Set(hiddenComponentIds), [hiddenComponentIds]);
  const boardGroup = useMemo(
    () => scene === null
      ? null
      : buildBoardGroup(scene, {
        showPCB,
        showTraces,
        showComponents,
        hiddenLayerIds: hiddenLayerSet,
        hiddenComponentIds: hiddenComponentSet,
        componentScale,
      }),
    [scene, showPCB, showTraces, showComponents, hiddenLayerSet, hiddenComponentSet, componentScale],
  );

  const boardRadius = scene
    ? Math.max(scene.board.widthMm, scene.board.heightMm) * 0.5
    : 30;
  const gridSize = scene
    ? Math.max(scene.board.widthMm, scene.board.heightMm) * 1.4
    : 50;

  // Convert 2D components to 3D — the board fills the viewport (60x53 mm
  // centred at the origin), so canvas (0..800, 0..500) maps onto it and
  // parts far outside the canvas clamp to the edge instead of vanishing.
  const components3D: Component3D[] = components.map((comp, index) => ({
    id: comp.id,
    position: [
      Math.min(30, Math.max(-30, (comp.x / 800) * 60 - 30)),
      1 + index * 0.05,
      Math.min(26.5, Math.max(-26.5, (comp.y / 500) * 53 - 26.5)),
    ],
    rotation: [0, comp.rotation * Math.PI / 180, 0],
    scale: [componentScale, componentScale, componentScale],
    type: comp.component.category,
    color: getComponentColor(comp.component.category),
    visible: !hiddenComponentIds.includes(comp.id),
  }));

  // PCB layers (state, so the layer eye-toggles actually hide geometry)
  const [pcbLayers, setPcbLayers] = useState<PCBLayer[]>([
    { name: 'Substrate', color: '#2d5016', thickness: 1.6, visible: true, opacity: 0.8 },
    { name: 'Bottom Copper', color: '#b87333', thickness: 0.035, visible: true, opacity: 0.9 },
    { name: 'Solder Mask', color: '#0f4c0f', thickness: 0.025, visible: true, opacity: 0.7 },
    { name: 'Top Copper', color: '#b87333', thickness: 0.035, visible: true, opacity: 0.9 },
    { name: 'Silkscreen', color: '#ffffff', thickness: 0.01, visible: true, opacity: 1.0 }
  ]);

  // Convert 2D wires to 3D traces on the same clamped board mapping.
  const traces3D = wires.map(wire => ({
    id: wire.id,
    points: wire.points.map(p => [
      Math.min(30, Math.max(-30, (p.x / 800) * 60 - 30)),
      2.1, // Above PCB surface
      Math.min(26.5, Math.max(-26.5, (p.y / 500) * 53 - 26.5))
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

  const handleToggleLayer = (layerName: string) => {
    setPcbLayers(layers =>
      layers.map(layer =>
        layer.name === layerName ? { ...layer, visible: !layer.visible } : layer
      )
    );
  };

  const handleToggleSceneLayer = (layerId: string) => {
    setHiddenLayerIds(ids =>
      ids.includes(layerId)
        ? ids.filter(id => id !== layerId)
        : [...ids, layerId]
    );
  };

  const handleToggleComponent = (componentId: string) => {
    setHiddenComponentIds(ids =>
      ids.includes(componentId)
        ? ids.filter(id => id !== componentId)
        : [...ids, componentId]
    );
  };

  const layerRows = scene
    ? scene.layers.map(layer => ({
      key: layer.id,
      label: layer.name,
      color: layer.color,
      visible: !hiddenLayerSet.has(layer.id),
      toggle: () => handleToggleSceneLayer(layer.id),
    }))
    : pcbLayers.map(layer => ({
      key: layer.name,
      label: layer.name,
      color: layer.color,
      visible: layer.visible,
      toggle: () => handleToggleLayer(layer.name),
    }));

  const componentRows = scene
    ? scene.components.map(component => ({
      key: component.id,
      label: `${component.reference} · ${component.footprintName}`,
      color: component.color,
      visible: !hiddenComponentIds.includes(component.id),
      toggle: () => handleToggleComponent(component.id),
      onBoard: component.onBoard,
    }))
    : components3D.map(component => ({
      key: component.id,
      label: component.type,
      color: component.color,
      visible: component.visible,
      toggle: () => handleToggleComponent(component.id),
      onBoard: true,
    }));

  /**
   * Rebuild the visible scene as a standalone THREE.Scene so every export path
   * (STL, OBJ, image) sees exactly what the viewport shows.
   */
  const buildExportScene = (): THREE.Scene => {
    const scene = new THREE.Scene();

    if (boardGroup) {
      scene.add(boardGroup.clone(true));
      scene.updateMatrixWorld(true);
      return scene;
    }

    if (showPCB) {
      pcbLayers.forEach((layer, index) => {
        if (!layer.visible) return;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(60, layer.thickness, 53));
        mesh.name = `layer-${layer.name}`;
        mesh.position.set(0, -index * layer.thickness, 0);
        scene.add(mesh);
      });
    }

    if (showComponents) {
      components3D.forEach(comp => {
        if (!comp.visible) return;
        const mesh = new THREE.Mesh(geometryFor(comp.type));
        mesh.name = `component-${comp.id}`;
        mesh.position.set(...comp.position);
        mesh.rotation.set(...comp.rotation);
        scene.add(mesh);
      });
    }

    if (showTraces) {
      traces3D.forEach(trace => {
        if (trace.points.length < 2) return;
        const curve = new THREE.CatmullRomCurve3(
          trace.points.map(p => new THREE.Vector3(...p))
        );
        const mesh = new THREE.Mesh(
          new THREE.TubeGeometry(curve, trace.points.length * 2, 0.1, 8, false)
        );
        mesh.name = `trace-${trace.id}`;
        scene.add(mesh);
      });
    }

    scene.updateMatrixWorld(true);
    return scene;
  };

  const handleExportSTL = () => {
    const stl = STLExporter.exportScene(buildExportScene());
    downloadFile(
      typeof stl === 'string' ? stl : new TextDecoder().decode(stl),
      'circuit_3d.stl',
      'model/stl'
    );
  };

  const handleExportOBJ = () => {
    const scene = buildExportScene();
    const meshes: Array<{ name: string; vertices: Array<{ x: number; y: number; z: number }>; faces: number[][] }> = [];

    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) || !object.geometry) return;
      const position = object.geometry.getAttribute('position');
      if (!position) return;

      const vertices: Array<{ x: number; y: number; z: number }> = [];
      for (let i = 0; i < position.count; i++) {
        const vertex = new THREE.Vector3()
          .fromBufferAttribute(position, i)
          .applyMatrix4(object.matrixWorld);
        vertices.push({ x: vertex.x, y: vertex.y, z: vertex.z });
      }

      const faces: number[][] = [];
      const index = object.geometry.getIndex();
      if (index) {
        for (let i = 0; i + 2 < index.count; i += 3) {
          faces.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
        }
      } else {
        for (let i = 0; i + 2 < position.count; i += 3) {
          faces.push([i, i + 1, i + 2]);
        }
      }

      meshes.push({ name: object.name || 'mesh', vertices, faces });
    });

    const result = objExporter.exportMeshes(meshes, 'circuit');
    downloadFile(result.obj, 'circuit_3d.obj', 'text/plain');
    downloadFile(result.mtl, 'model.mtl', 'text/plain');
  };

  const handleExportImage = () => {
    const canvas = glRef.current?.domElement;
    if (!canvas) return;
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'circuit_3d.png';
    link.click();
  };

  /**
   * Hand the live renderer to a real immersive session. The service decides
   * whether WebXR exists; if the browser has it, we request the session and
   * attach it to the same `gl` — no second renderer, no fake "preview mode".
   */
  const enterXR = async (mode: 'ar' | 'vr') => {
    const preview = arvrPreviewService.createSession(mode);
    if (!preview.supported) {
      setXrStatus(preview.message);
      return;
    }
    const gl = glRef.current;
    if (!gl) {
      setXrStatus('Renderer is still initialising.');
      return;
    }
    try {
      setXrBusy(true);
      const xr = (navigator as unknown as { xr?: XRSystemLike }).xr;
      if (!xr) throw new Error('WebXR is unavailable.');
      const session = await xr.requestSession(
        mode === 'vr' ? 'immersive-vr' : 'immersive-ar',
        { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] },
      );
      await (gl.xr as unknown as { setSession: (session: XRSessionLike) => Promise<void> }).setSession(session);
      setXrStatus(`${mode.toUpperCase()} session started · ${preview.tracking} tracking.`);
      session.addEventListener('end', () => setXrStatus('Session ended — back to the orbit camera.'));
    } catch (error) {
      setXrStatus(error instanceof Error ? error.message : 'Could not start the XR session.');
    } finally {
      setXrBusy(false);
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-background">
      <div className="flex h-full w-full flex-col overflow-hidden bg-card lg:flex-row">
        {/* 3D Viewport */}
        <div className="relative min-h-0 min-w-0 flex-1">
          <Canvas
            shadows={shadows}
            dpr={pixelRatio}
            camera={{ position: [15, 15, 15], fov: 50 }}
            gl={{ preserveDrawingBuffer: true }}
            onCreated={({ gl }) => { glRef.current = gl; }}
            style={{ background: 'linear-gradient(to bottom, #87CEEB, #E0F6FF)' }}
          >
            <CameraController view={currentView} zoom={zoom} reframe={reframe} radius={boardRadius} />
            <Lighting />
            
            {showGrid && (
              <Grid args={[gridSize, gridSize]} cellSize={5} sectionSize={25} fadeDistance={gridSize * 2} />
            )}

            {boardGroup ? (
              <primitive object={boardGroup} />
            ) : (
              <>
                {showPCB && <PCBBoard layers={pcbLayers} />}

                {showComponents && components3D.map(comp => (
                  <Component3DModel
                    key={comp.id}
                    component={comp}
                    glow={liveFrame ? Math.max(0, ...Object.values(liveFrame.glow)) * 0.5 : 0}
                  />
                ))}

                {showTraces && traces3D.map(trace => (
                  <Trace3D key={trace.id} points={trace.points} />
                ))}
              </>
            )}
            
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
                onClick={() => { setCurrentView('iso'); setZoom(1); }}
                title="Reset View" aria-label="Reset View"
              >
                <Home className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setZoom(z => Math.min(4, z * 1.25))}
                title="Zoom In" aria-label="Zoom In"
              >
                <ZoomIn className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setZoom(z => Math.max(0.25, z / 1.25))}
                title="Zoom Out" aria-label="Zoom Out"
              >
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setReframe(n => n + 1)}
                title="Reset Rotation" aria-label="Reset Rotation"
              >
                <RotateCcw className="w-4 h-4" />
              </Button>
            </div>
          </div>

          {/* Info Overlay */}
          <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur-sm p-3 rounded-lg border border-border">
            <div className="text-sm space-y-1">
              <div>Components: {scene ? scene.counts.components : components3D.length}</div>
              <div>Traces: {scene ? scene.counts.segments : traces3D.length}</div>
              {scene && <div>Board: {scene.board.widthMm} × {scene.board.heightMm} mm · {scene.counts.copperLayers} copper</div>}
              {scene && <div>Vias: {scene.counts.vias} · Pads: {scene.counts.pads}</div>}
              <div>View: {currentView.toUpperCase()}</div>
            </div>
          </div>
        </div>

        {/* Control Panel */}
        <div className="flex max-h-[45%] w-full flex-shrink-0 flex-col border-t border-border bg-card lg:max-h-none lg:w-80 lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between p-4 border-b border-border">
            <h3 className="font-semibold text-foreground">3D Viewer</h3>
            <Button variant="ghost" size="icon" aria-label="Close 3D viewer" onClick={onClose}>
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
                    aria-label={showGrid ? 'Hide grid' : 'Show grid'}
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
                    aria-label={showComponents ? 'Hide components' : 'Show components'}
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
                    aria-label={showTraces ? 'Hide traces' : 'Show traces'}
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
                    aria-label={showPCB ? 'Hide PCB' : 'Show PCB'}
                    className="h-6 w-6"
                  >
                    {showPCB ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Board source / layout warnings */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Board source</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                {scene ? (
                  <>
                    <p>Routed layout · {scene.board.widthMm} × {scene.board.heightMm} mm · {scene.counts.copperLayers} copper layers</p>
                    <p>{scene.counts.traces} routed traces ({scene.counts.segments} segments), {scene.counts.vias} vias, {scene.counts.pads} pads.</p>
                    {scene.warnings.length > 0 && (
                      <ul className="space-y-1 text-destructive">
                        {scene.warnings.slice(0, 6).map((warning) => (
                          <li key={`${warning.code}-${warning.elementId ?? warning.message}`}>{warning.message}</li>
                        ))}
                        {scene.warnings.length > 6 && <li>…and {scene.warnings.length - 6} more.</li>}
                      </ul>
                    )}
                  </>
                ) : (
                  <p>
                    {pcbSceneState.error
                      ? `The PCB layout is invalid: ${pcbSceneState.error}`
                      : 'No routed PCB yet — showing schematic placement on a 60 × 53 mm preview board. Open the PCB panel to place and route the design.'}
                  </p>
                )}
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
                {layerRows.map(layer => (
                  <div
                    key={layer.key}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer transition-colors ${
                      selectedLayer === layer.key ? 'bg-primary/10' : 'hover:bg-accent'
                    }`}
                    onClick={() => setSelectedLayer(layer.key)}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded border"
                        style={{ backgroundColor: layer.color }}
                      />
                      <span className="text-xs">{layer.label}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        layer.toggle();
                      }}
                      aria-label={layer.visible ? `Hide ${layer.label} layer` : `Show ${layer.label} layer`}
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
                {componentRows.map(component => (
                  <div
                    key={component.key}
                    className="flex items-center justify-between p-2 rounded hover:bg-accent cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded"
                        style={{ backgroundColor: component.color }}
                      />
                      <span className="text-xs">{component.label}</span>
                      {!component.onBoard && <span className="text-[10px] text-destructive">off-board</span>}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5"
                      aria-label={component.visible ? `Hide ${component.label}` : `Show ${component.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        component.toggle();
                      }}
                    >
                      {component.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
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
                  onClick={handleExportSTL}
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-3 h-3" />
                  Export STL
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportOBJ}
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-3 h-3" />
                  Export OBJ
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportImage}
                  className="w-full flex items-center gap-2"
                >
                  <Download className="w-3 h-3" />
                  Export Image
                </Button>
              </CardContent>
            </Card>

            {/* XR Preview */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">AR / VR Preview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={xrBusy}
                    onClick={() => void enterXR('ar')}
                  >
                    Enter AR
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    disabled={xrBusy}
                    onClick={() => void enterXR('vr')}
                  >
                    Enter VR
                  </Button>
                </div>
                <p role="status" className="text-xs text-muted-foreground">
                  {xrStatus || (arvrPreviewService.isWebXRAvailable()
                    ? 'WebXR available — the current scene becomes the immersive view.'
                    : 'WebXR is not available in this browser; the orbit viewer remains active.')}
                </p>
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
                  <label className="text-xs font-medium" htmlFor="render-resolution">Render resolution</label>
                  <select
                    id="render-resolution"
                    className="w-full mt-1 px-2 py-1 text-xs border border-input rounded"
                    value={pixelRatio}
                    onChange={(event) => setPixelRatio(parseFloat(event.target.value))}
                  >
                    <option value={0.75}>Low (0.75×)</option>
                    <option value={1}>Medium (1×)</option>
                    <option value={1.5}>High (1.5×)</option>
                    <option value={2}>Ultra (2×)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium" htmlFor="component-scale">Component scale</label>
                  <input
                    id="component-scale"
                    type="range"
                    min="0.5"
                    max="2"
                    step="0.1"
                    value={componentScale}
                    onChange={(event) => setComponentScale(parseFloat(event.target.value))}
                    className="w-full mt-1"
                  />
                  <div className="text-xs text-muted-foreground">{componentScale.toFixed(1)}×</div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs">Shadows</span>
                  <input
                    type="checkbox"
                    checked={shadows}
                    onChange={(event) => setShadows(event.target.checked)}
                    className="rounded"
                    aria-label="Shadows"
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}