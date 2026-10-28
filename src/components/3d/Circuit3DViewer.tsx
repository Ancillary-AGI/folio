import { useRef, useEffect, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
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
import {
  buildPcbGroup,
  PAD_FINISH_SPECS,
  SOLDERMASK_SPECS,
  type PcbMaskColor,
  type PcbPadFinish,
} from '../../lib/pcb/pcb3dModel';

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

const VIEW_POSITIONS: Record<string, [number, number, number]> = {
  iso: [1, 1, 1],
  top: [0, 1.4, 0.001],
  front: [0, 0.35, 1],
  side: [1, 0.35, 0],
};

const CAMERA_FOV_DEG = 42;
const CAMERA_FIT_MARGIN = 1.25;

/** Axis-aligned box in scene millimeters: centre plus half extents. */
interface Framing {
  center: [number, number, number];
  half: [number, number, number];
}

interface OrbitLikeControls {
  target: THREE.Vector3;
  update: () => void;
}

/**
 * Distance needed to fit `frame` on screen for a given view and aspect ratio.
 * Using the projected half extents (instead of a bounding sphere) keeps a wide,
 * shallow circuit filling a wide viewport rather than shrinking to a dot.
 */
function fitDistance(frame: Framing, view: string, aspect: number): number {
  const direction = new THREE.Vector3(...(VIEW_POSITIONS[view] ?? VIEW_POSITIONS.iso)).normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction);
  // Looking straight down makes world-up parallel to the view direction.
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0);
  else right.normalize();
  const up = new THREE.Vector3().crossVectors(direction, right).normalize();
  const [halfX, halfY, halfZ] = frame.half;
  const halfWidth = Math.abs(halfX * right.x) + Math.abs(halfY * right.y) + Math.abs(halfZ * right.z);
  const halfHeight = Math.abs(halfX * up.x) + Math.abs(halfY * up.y) + Math.abs(halfZ * up.z);
  const tanHalfFov = Math.tan((CAMERA_FOV_DEG * Math.PI) / 360);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1.6;
  return Math.max(
    5,
    Math.max(halfWidth / (tanHalfFov * safeAspect), halfHeight / tanHalfFov) * CAMERA_FIT_MARGIN + 1,
  );
}

// Camera controller — the canonical viewpoints are unit vectors scaled to the
// framed box, and OrbitControls' target follows it so zoom stays centred on
// the circuit instead of drifting around the board origin.
function CameraController({
  view,
  zoom,
  reframe,
  frame,
}: {
  view: string;
  zoom: number;
  reframe: number;
  frame: Framing;
}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls) as OrbitLikeControls | null;
  const size = useThree((state) => state.size) as { width: number; height: number } | undefined;
  const [centerX, centerY, centerZ] = frame.center;
  const [halfX, halfY, halfZ] = frame.half;

  useEffect(() => {
    const aspect = size && size.height > 0 ? size.width / size.height : 1.6;
    const distance = fitDistance({ center: [centerX, centerY, centerZ], half: [halfX, halfY, halfZ] }, view, aspect) / zoom;
    const base = new THREE.Vector3(...(VIEW_POSITIONS[view] ?? VIEW_POSITIONS.iso)).normalize();
    camera.position.set(
      centerX + base.x * distance,
      centerY + base.y * distance,
      centerZ + base.z * distance,
    );
    camera.lookAt(centerX, centerY, centerZ);
    if (controls) {
      controls.target.set(centerX, centerY, centerZ);
      controls.update();
    }
  }, [view, zoom, reframe, centerX, centerY, centerZ, halfX, halfY, halfZ, camera, controls, size]);

  return null;
}

// Lighting setup: a soft studio key/fill/rim plus the environment map from the
// canvas. Punctual lights alone leave a metallic pad either flat or blown to
// white at the mirror angle; the room capture gives every metal a broad
// reflection to pick up instead.
function Lighting() {
  return (
    <>
      <hemisphereLight args={['#dbeafe', '#1b2029', 0.5]} />
      <ambientLight intensity={0.16} />
      <directionalLight
        position={[28, 44, 24]}
        intensity={1.7}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-90}
        shadow-camera-right={90}
        shadow-camera-top={90}
        shadow-camera-bottom={-90}
        shadow-camera-near={1}
        shadow-camera-far={220}
        shadow-bias={-0.0004}
      />
      <directionalLight position={[-30, 20, -24]} intensity={0.6} color="#cfe3ff" />
      <pointLight position={[0, 22, 0]} intensity={0.2} distance={180} />
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
  const [frameMode, setFrameMode] = useState<'board' | 'circuit'>('circuit');
  const [shadows, setShadows] = useState(true);
  const [pixelRatio, setPixelRatio] = useState(1.5);
  const [componentScale, setComponentScale] = useState(1);
  const [maskColor, setMaskColor] = useState<PcbMaskColor>('green');
  const [padFinish, setPadFinish] = useState<PcbPadFinish>('enig');
  const [xrStatus, setXrStatus] = useState('');
  const [xrBusy, setXrBusy] = useState(false);
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const environmentRef = useRef<{ texture: THREE.Texture; generator: THREE.PMREMGenerator } | null>(null);

  useEffect(() => () => {
    environmentRef.current?.texture.dispose();
    environmentRef.current?.generator.dispose();
    environmentRef.current = null;
  }, []);

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
      : buildPcbGroup(scene, {
        showPCB,
        showTraces,
        showComponents,
        hiddenLayerIds: hiddenLayerSet,
        hiddenComponentIds: hiddenComponentSet,
        componentScale,
        maskColor,
        padFinish,
      }),
    [scene, showPCB, showTraces, showComponents, hiddenLayerSet, hiddenComponentSet, componentScale, maskColor, padFinish],
  );

  // A schematic-scale circuit on a 100 x 80 mm outline is a few millimetres
  // tall: framing the board alone makes the parts sub-pixel. Frame the routed
  // content by default and keep the whole outline one click away.
  const boardFrame = useMemo<Framing>(() => {
    if (!scene) return { center: [0, 0, 0], half: [30, 1, 26.5] };
    return {
      center: [0, 0, 0],
      half: [scene.board.widthMm / 2, scene.board.thicknessMm / 2 + 2, scene.board.heightMm / 2],
    };
  }, [scene]);

  const circuitFrame = useMemo<Framing | null>(() => {
    if (!scene) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    let minY = -scene.board.thicknessMm / 2;
    let maxY = scene.board.thicknessMm / 2;
    const include = (x: number, z: number, radius: number) => {
      minX = Math.min(minX, x - radius);
      maxX = Math.max(maxX, x + radius);
      minZ = Math.min(minZ, z - radius);
      maxZ = Math.max(maxZ, z + radius);
    };
    for (const component of scene.components) {
      include(
        component.position.x,
        component.position.z,
        Math.max(component.bodyWidthMm, component.bodyDepthMm) / 2,
      );
      for (const pad of component.pads) {
        include(pad.position.x, pad.position.z, Math.max(pad.widthMm, pad.depthMm) / 2);
      }
      minY = Math.min(minY, component.position.y - component.bodyHeightMm / 2);
      maxY = Math.max(maxY, component.position.y + component.bodyHeightMm / 2);
    }
    for (const trace of scene.traces) {
      include(trace.start.x, trace.start.z, trace.widthMm / 2);
      include(trace.end.x, trace.end.z, trace.widthMm / 2);
    }
    for (const via of scene.vias) {
      include(via.position.x, via.position.z, via.padDiameterMm / 2);
    }
    if (!Number.isFinite(minX)) return null;
    return {
      center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
      half: [
        Math.max((maxX - minX) / 2, 1),
        Math.max((maxY - minY) / 2, 1),
        Math.max((maxZ - minZ) / 2, 1),
      ],
    };
  }, [scene]);

  const framing = useMemo<Framing>(
    () => (frameMode === 'circuit' && circuitFrame ? circuitFrame : boardFrame),
    [frameMode, circuitFrame, boardFrame],
  );

  const gridSize = scene
    ? Math.max(scene.board.widthMm, scene.board.heightMm) * 1.4
    : 50;

  // Every toggle rebuilds the group; dispose the replaced GPU buffers so a long
  // review session does not accumulate one board per click. Disposal happens
  // only when a *new* group takes over, never on mount/unmount, so React's
  // strict-mode double effect cannot free the geometry that is still on screen.
  const previousBoardGroup = useRef<THREE.Group | null>(null);
  useEffect(() => {
    const previous = previousBoardGroup.current;
    previousBoardGroup.current = boardGroup;
    if (!previous || previous === boardGroup) return;
    previous.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.LineSegments)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) material.dispose();
    });
  }, [boardGroup]);

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
      if (object.userData.excludeFromExport) return;
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
            camera={{ position: [28, 22, 28], fov: CAMERA_FOV_DEG }}
            gl={{ preserveDrawingBuffer: true, antialias: true }}
            onCreated={({ gl, scene: threeScene }) => {
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 1.08;
              gl.outputColorSpace = THREE.SRGBColorSpace;
              glRef.current = gl;
              environmentRef.current?.texture.dispose();
              environmentRef.current?.generator.dispose();
              environmentRef.current = null;
              let generator: THREE.PMREMGenerator | null = null;
              try {
                // A captured room gives the gold pads and part bodies broad
                // reflections instead of one punctual specular hotspot.
                generator = new THREE.PMREMGenerator(gl);
                const texture = generator.fromScene(new RoomEnvironment(), 0.04).texture;
                threeScene.environment = texture;
                threeScene.environmentIntensity = 0.4;
                environmentRef.current = { texture, generator };
              } catch (error) {
                generator?.dispose();
                console.warn('PCB environment map unavailable:', error);
              }
            }}
            style={{ background: 'linear-gradient(160deg, #0b1220 0%, #19212d 52%, #2c3545 100%)' }}
          >
            <CameraController view={currentView} zoom={zoom} reframe={reframe} frame={framing} />
            <Lighting />

            {showGrid && (
              <Grid
                position={[0, -1.15, 0]}
                args={[gridSize, gridSize]}
                cellSize={5}
                sectionSize={25}
                cellColor="#2b3648"
                sectionColor="#46566e"
                fadeDistance={gridSize * 1.6}
                infiniteGrid
              />
            )}
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.05, 0]} receiveShadow>
              <planeGeometry args={[gridSize * 2, gridSize * 2]} />
              <shadowMaterial transparent opacity={0.24} />
            </mesh>

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
              makeDefault
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

            <div className="flex gap-2">
              <Button
                variant={frameMode === 'circuit' && circuitFrame ? 'default' : 'outline'}
                size="sm"
                disabled={!circuitFrame}
                onClick={() => { setFrameMode('circuit'); setZoom(1); }}
                title="Frame the placed components and routed copper"
              >
                Circuit
              </Button>
              <Button
                variant={frameMode === 'board' || !circuitFrame ? 'default' : 'outline'}
                size="sm"
                onClick={() => { setFrameMode('board'); setZoom(1); }}
                title="Frame the whole board outline"
              >
                Board
              </Button>
            </div>
          </div>

          {/* Info Overlay — compact, over the sky rather than the board */}
          <div className="absolute right-4 top-4 rounded-md border border-border bg-card/80 px-2.5 py-1.5 text-[11px] leading-4 text-muted-foreground backdrop-blur-sm">
            <div>Components: {scene ? scene.counts.components : components3D.length}</div>
            <div>Traces: {scene ? scene.counts.segments : traces3D.length}</div>
            {scene && <div>Board: {scene.board.widthMm} × {scene.board.heightMm} mm · {scene.counts.copperLayers} copper</div>}
            {scene && <div>Vias: {scene.counts.vias} · Pads: {scene.counts.pads}</div>}
            <div>View: {currentView.toUpperCase()} · {framing === circuitFrame ? 'circuit' : 'board'}</div>
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

            {/* Board appearance — how the fabricated board is expected to look */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Board appearance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <span className="text-xs font-medium">Soldermask</span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Soldermask colour">
                    {(Object.keys(SOLDERMASK_SPECS) as PcbMaskColor[]).map((id) => {
                      const spec = SOLDERMASK_SPECS[id]
                      const active = maskColor === id
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setMaskColor(id)}
                          aria-label={`${spec.label} soldermask`}
                          aria-pressed={active}
                          title={spec.label}
                          className={`h-7 w-7 rounded-full border-2 transition-transform ${
                            active ? 'scale-110 border-primary ring-2 ring-primary/30' : 'border-border hover:scale-105'
                          }`}
                          style={{ backgroundColor: spec.overlayColor }}
                        />
                      )
                    })}
                  </div>
                </div>
                <div>
                  <label className="text-xs font-medium" htmlFor="pad-finish">Pad finish</label>
                  <select
                    id="pad-finish"
                    value={padFinish}
                    onChange={(event) => setPadFinish(event.target.value as PcbPadFinish)}
                    className="mt-1 w-full rounded border border-input bg-background px-2 py-1 text-xs"
                  >
                    {(Object.keys(PAD_FINISH_SPECS) as PcbPadFinish[]).map((id) => (
                      <option key={id} value={id}>{PAD_FINISH_SPECS[id].label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                    {PAD_FINISH_SPECS[padFinish].note} Appearance is a preview; the fabrication package does
                    not encode mask colour or finish.
                  </p>
                </div>
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