import { useCallback, useRef, useEffect, useState, useMemo, type ChangeEvent, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { RangeControl } from '../ui/range-control';
import { cn } from '../../lib/utils';
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
  Upload,
  X,
  Box,
  Cpu,
  FileStack,
  MonitorPlay,
  Palette,
} from 'lucide-react';
import { useProjectStore } from '../../stores/useProjectStore';
import { useEnclosureStore } from '../../stores/useEnclosureStore';
import { downloadFile } from '../../lib/exportUtils';
import { STLExporter } from '../../lib/3d/stlExporter';
import { objExporter } from '../../lib/3d/objExporter';
import { MeshImportError, readMeshFile, shellProblem } from '../../lib/3d/meshMeasure';
import { buildEnclosureShell, type EnclosureShell } from '../../lib/3d/enclosureShell';
import { fitFrameDistance, unionFrames, type Framing } from '../../lib/3d/framing';
import { parseObj } from '../../lib/3d/objImporter';
import { parseStl } from '../../lib/3d/stlImporter';
import { arvrPreviewService } from '../../lib/arvr/arvrPreview';
import { buildPcbScene, type PcbScene } from '../../lib/pcb/pcbScene';
import { assessEnclosureFit, contentEnvelope, stackEnvelope, tightestSide, type EnclosureFit } from '../../lib/pcb/enclosureFit';
import {
  applyComponentScale,
  buildPcbGroup,
  disposePcbGroup,
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

interface OrbitLikeControls {
  target: THREE.Vector3;
  update: () => void;
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
    const viewport = size ?? { width: 16, height: 10 };
    const base = new THREE.Vector3(...(VIEW_POSITIONS[view] ?? VIEW_POSITIONS.iso));
    const framed: Framing = { center: [centerX, centerY, centerZ], half: [halfX, halfY, halfZ] };
    const distance = fitFrameDistance(framed, base, viewport, CAMERA_FOV_DEG) / zoom;
    const direction = base.normalize();
    camera.position.set(
      centerX + direction.x * distance,
      centerY + direction.y * distance,
      centerZ + direction.z * distance,
    );
    camera.lookAt(centerX, centerY, centerZ);
    if (controls) {
      controls.target.set(centerX, centerY, centerZ);
      controls.update();
    }
  }, [view, zoom, reframe, centerX, centerY, centerZ, halfX, halfY, halfZ, camera, controls, size]);

  return null;
}

/* The viewport HUD. These sit over a rendered board, so they read as one
   floating bar of controls rather than a grid of separate boxes: the active
   control carries the accent, everything else stays quiet until hovered. */
const hudItem = (active: boolean) =>
  cn(
    'h-7 shrink-0 rounded-lg px-2.5 text-[11px] font-semibold uppercase tracking-wide transition-colors',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
    active
      ? 'bg-primary text-primary-foreground shadow-sm'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  );

const hudIcon =
  'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background';

/**
 * A layer or object switch. The eye icon alone made state something you had to
 * read; a filled track and tinted row say it at a glance, and the swatch ties
 * the row to the copper or moulding it controls.
 */
function VisibilityRow({
  label,
  on,
  onToggle,
  swatch,
  note,
}: {
  label: string;
  on: boolean;
  onToggle: () => void;
  swatch?: string;
  note?: ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onToggle}
      className={cn(
        'flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-left text-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
        on
          ? 'border-primary/35 bg-primary/10 text-foreground'
          : 'border-border bg-background/40 text-muted-foreground hover:bg-accent',
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {swatch && (
          <span
            aria-hidden="true"
            className={cn('cad-swatch h-2.5 w-2.5 shrink-0 rounded-full ring-1 ring-inset ring-black/25', !on && 'opacity-40')}
            style={{ backgroundColor: swatch }}
          />
        )}
        <span className="truncate font-medium">{label}</span>
        {note}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'relative h-4 w-7 shrink-0 rounded-full transition-colors',
          on ? 'bg-primary' : 'bg-muted-foreground/35',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-3 w-3 rounded-full bg-card shadow transition-all',
            on ? 'left-3.5' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}

/**
 * One read-out in the strip along the bottom of the viewport. A `div` inside a
 * `dl` is the spec's way of grouping a term with its value, and the group is
 * what stays together when the strip wraps on a narrow viewport.
 */
function Stat({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums" data-testid={`hud-${label}`}>
        <span className={accent ? 'text-info' : 'text-foreground'}>{value}</span>
        {hint && <span className="text-muted-foreground"> · {hint}</span>}
      </dd>
    </div>
  );
}

/**
 * A panel section heading. The glyph and its hue are the only way to tell nine
 * near-identical cards apart at a glance, so each one carries a different accent.
 */
function SectionTitle({ icon: Icon, tone, children }: {
  icon: typeof Eye;
  tone: 'primary' | 'info' | 'success' | 'warning';
  children: ReactNode;
}) {
  const tones = {
    primary: 'text-primary',
    info: 'text-info',
    success: 'text-success',
    warning: 'text-warning',
  } as const;
  return (
    <CardTitle className="flex items-center gap-2 text-sm">
      <Icon className={cn('h-3.5 w-3.5 shrink-0', tones[tone])} aria-hidden="true" />
      {children}
    </CardTitle>
  );
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

/** Millimetres to the precision a fit decision is made at, without false padding. */
function millimetres(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded === 0 ? 0 : rounded} mm`;
}

/** The yes/no, named to the side it belongs to. */
function fitVerdict(fit: EnclosureFit): string {
  const side = tightestSide(fit).side;
  return fit.fits
    ? `Board fits — ${millimetres(fit.tightestMm)} left at the ${side}`
    : `Board does not fit — ${millimetres(-fit.tightestMm)} past the ${side}`;
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
  const [hiddenComponentIds, setHiddenComponentIds] = useState<string[]>([]);
  const [hiddenLayerIds, setHiddenLayerIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(1);
  const [reframe, setReframe] = useState(0);
  const [frameMode, setFrameMode] = useState<'board' | 'circuit'>('circuit');
  const [shadows, setShadows] = useState(true);
  // Start at the display's own density (capped at 2× so a 5K panel does not
  // quadruple the fragment cost) instead of a fixed 1.5 that softens on HiDPI.
  const [pixelRatio, setPixelRatio] = useState(() => {
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    return dpr >= 2 ? 2 : dpr >= 1.5 ? 1.5 : 1;
  });
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

  const projectId = useProjectStore((s) => s.currentProject?.id ?? null);
  const enclosure = useEnclosureStore((s) => s.enclosure);
  const setEnclosure = useEnclosureStore((s) => s.setEnclosure);
  const [showEnclosure, setShowEnclosure] = useState(true);
  const [enclosureError, setEnclosureError] = useState<string | null>(null);
  const enclosureInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (enclosure && enclosure.projectId !== projectId) setEnclosure(null);
  }, [enclosure, projectId, setEnclosure]);

  // No routed layout, no stack to size against: the panel says so instead of
  // comparing the shell with a board it has not seen.
  const enclosureFit = useMemo<EnclosureFit | null>(
    () => (enclosure && scene ? assessEnclosureFit(stackEnvelope(scene), enclosure.mesh) : null),
    [enclosure, scene],
  );

  const importEnclosure = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset first so choosing the same file again still fires a change event.
    event.target.value = '';
    if (!file) return;
    setEnclosureError(null);
    try {
      const buffer = await readMeshFile(file);
      const mesh = /\.obj$/i.test(file.name) ? parseObj(buffer) : parseStl(buffer);
      setEnclosure({ name: file.name, mesh, projectId });
    } catch (error) {
      setEnclosureError(
        error instanceof MeshImportError
          ? error.message
          : `Could not read "${file.name}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [setEnclosure, projectId]);

  // The shell's own defects travel with the numbers: an open mesh has no inside,
  // so the envelope comparison is reported as what it is instead of as a verdict.
  const shellDefect = enclosure ? shellProblem(enclosure.mesh) : null;
  const enclosureVerdict = enclosureFit ? fitVerdict(enclosureFit) : null;

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
        maskColor,
        padFinish,
      }),
    [scene, showPCB, showTraces, showComponents, hiddenLayerSet, hiddenComponentSet, maskColor, padFinish],
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
    const content = contentEnvelope(scene);
    if (content.empty) return null;
    return {
      center: [
        (content.minX + content.maxX) / 2,
        (content.minY + content.maxY) / 2,
        (content.minZ + content.maxZ) / 2,
      ],
      half: [
        Math.max((content.maxX - content.minX) / 2, 1),
        Math.max((content.maxY - content.minY) / 2, 1),
        Math.max((content.maxZ - content.minZ) / 2, 1),
      ],
    };
  }, [scene]);

  // A case that is bigger than the board has to be on screen with it, or the
  // import looks like it did nothing. The shell is drawn centred on the board
  // centre, so its frame is the extent the shell object reports about the origin.
  const shell = useMemo(
    () => (enclosure && showEnclosure ? buildEnclosureShell(enclosure.mesh) : null),
    [enclosure, showEnclosure],
  );

  const shellFrame = useMemo<Framing | null>(
    () => (shell ? { center: [0, 0, 0], half: shell.half } : null),
    [shell],
  );

  const framing = useMemo<Framing>(() => {
    const base = frameMode === 'circuit' && circuitFrame ? circuitFrame : boardFrame;
    return shellFrame ? unionFrames(base, shellFrame) : base;
  }, [frameMode, circuitFrame, boardFrame, shellFrame]);

  const framingMode = frameMode === 'circuit' && circuitFrame ? 'circuit' : 'board';

  const gridSize = scene
    ? Math.max(scene.board.widthMm, scene.board.heightMm) * 1.4
    : 50;

  // Every toggle rebuilds the group; release the replaced buffers so a long
  // review session does not accumulate one board per click. Release happens
  // only when a *new* group takes over, never on mount/unmount, so React's
  // strict-mode double effect cannot free the geometry that is still on screen.
  // Shapes and finishes repeated across rebuilds are shared and stay alive.
  const previousBoardGroup = useRef<THREE.Group | null>(null);
  useEffect(() => {
    const previous = previousBoardGroup.current;
    previousBoardGroup.current = boardGroup;
    if (!previous || previous === boardGroup) return;
    disposePcbGroup(previous);
  }, [boardGroup]);

  // Same rule for the shell: a replaced case frees the old one's buffers, an
  // unmount leaves the object that was just on screen alone.
  const previousShell = useRef<EnclosureShell | null>(null);
  useEffect(() => {
    const previous = previousShell.current;
    previousShell.current = shell;
    if (!previous || previous === shell) return;
    previous.dispose();
  }, [shell]);

  // The size slider scales each part about its own centre, which is a transform,
  // not a geometry question: rebuilding a 56-part board's buffers to move a
  // slider is what made the preview stop answering.
  useEffect(() => {
    if (boardGroup) applyComponentScale(boardGroup, componentScale);
  }, [boardGroup, componentScale]);

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

            {shell && <primitive object={shell.group} />}
            
            <OrbitControls
              makeDefault
              enablePan={true}
              enableZoom={true}
              enableRotate={true}
              maxPolarAngle={Math.PI}
            />
          </Canvas>

          {/* View Controls Overlay — one floating bar. The board is the subject
              here, so the chrome stays out of the sky it is drawn over. */}
          <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
            <div className="pointer-events-auto flex flex-wrap items-center gap-1 rounded-xl border border-border/70 bg-card/85 p-1 shadow-lg backdrop-blur-md">
              {(['iso', 'top', 'front', 'side'] as const).map(view => (
                <button
                  key={view}
                  type="button"
                  onClick={() => setCurrentView(view)}
                  aria-pressed={currentView === view}
                  className={hudItem(currentView === view)}
                >
                  {view}
                </button>
              ))}

              <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />

              <button
                type="button"
                onClick={() => { setFrameMode('circuit'); setZoom(1) }}
                aria-pressed={frameMode === 'circuit' && Boolean(circuitFrame)}
                disabled={!circuitFrame}
                title="Frame the placed components and routed copper"
                className={cn(hudItem(frameMode === 'circuit' && Boolean(circuitFrame)), 'disabled:pointer-events-none disabled:opacity-40')}
              >
                Circuit
              </button>
              <button
                type="button"
                onClick={() => { setFrameMode('board'); setZoom(1) }}
                aria-pressed={frameMode === 'board' || !circuitFrame}
                title="Frame the whole board outline"
                className={hudItem(frameMode === 'board' || !circuitFrame)}
              >
                Board
              </button>

              <span className="mx-1 h-5 w-px shrink-0 bg-border" aria-hidden="true" />

              <button
                type="button"
                onClick={() => { setCurrentView('iso'); setZoom(1); }}
                title="Reset View" aria-label="Reset View"
                className={hudIcon}
              >
                <Home className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(z => Math.min(4, z * 1.25))}
                title="Zoom In" aria-label="Zoom In"
                className={hudIcon}
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setZoom(z => Math.max(0.25, z / 1.25))}
                title="Zoom Out" aria-label="Zoom Out"
                className={hudIcon}
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setReframe(n => n + 1)}
                title="Reset Rotation" aria-label="Reset Rotation"
                className={hudIcon}
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
          {/* Info strip — the numbers that change when the design changes. It
              runs along the bottom edge rather than over the board: a card in
              the top-right sat on top of half the copper on a 245 mm mainboard,
              and the one thing worth looking at was the thing it hid. */}
          <dl className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-baseline gap-x-4 gap-y-0.5 rounded-lg border border-border/40 bg-background/75 px-2.5 py-1 text-[11px] leading-4 shadow-sm backdrop-blur-sm">
            <Stat label="Parts" value={String(scene ? scene.counts.components : components3D.length)} />
            <Stat label="Traces" value={String(scene ? scene.counts.segments : traces3D.length)} />
            {scene && (
              <Stat
                label="Board"
                value={`${scene.board.widthMm} × ${scene.board.heightMm} mm`}
                hint={`${scene.counts.copperLayers} copper`}
              />
            )}
            {scene && <Stat label="Vias" value={String(scene.counts.vias)} hint={`${scene.counts.pads} pads`} />}
            <Stat label="View" value={currentView.toUpperCase()} hint={framingMode} accent />
          </dl>
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
            {/* Enclosure */}
            <Card data-testid="enclosure-card">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <SectionTitle icon={Box} tone="info">Enclosure</SectionTitle>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[11px]"
                      onClick={() => enclosureInputRef.current?.click()}
                      title="Import an STL or OBJ enclosure shell (millimetres)"
                    >
                      <Upload className="w-3 h-3" />
                      Import
                    </Button>
                    {enclosure && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => { setEnclosure(null); setEnclosureError(null); }}
                        aria-label="Remove enclosure shell"
                        title="Remove enclosure shell"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <input
                  ref={enclosureInputRef}
                  type="file"
                  accept=".stl,.obj,model/stl,application/sla,text/plain"
                  /*
                   * Screen-reader only rather than `display: none`, so the file
                   * picker is a reachable control in its own right: a keyboard or
                   * screen-reader user meets "Choose an enclosure file to import"
                   * and can act on it, instead of a button that silently opens an
                   * operating-system dialog they cannot see. The Import button
                   * still forwards its click here for pointer users.
                   */
                  className="sr-only"
                  tabIndex={0}
                  aria-label="Choose an enclosure file to import"
                  onChange={event => { void importEnclosure(event); }}
                />
                {enclosureError && (
                  <p role="alert" className="text-destructive">{enclosureError}</p>
                )}
                {!enclosure && (
                  <p className="text-muted-foreground">
                    No shell imported. An STL or OBJ enclosure is drawn around the board and measured
                    against it; it never enters the fab package, the router or the exports.
                  </p>
                )}
                {enclosure && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-foreground" title={enclosure.name}>{enclosure.name}</span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => setShowEnclosure(value => !value)}
                      aria-label={showEnclosure ? 'Hide enclosure shell' : 'Show enclosure shell'}
                      title={showEnclosure ? 'Hide enclosure shell' : 'Show enclosure shell'}
                    >
                      {showEnclosure ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                    </Button>
                  </div>
                )}
                {enclosure && enclosureFit && (
                  <div className="space-y-2">
                    {shellDefect === null ? (
                      <p className={enclosureFit.fits ? 'text-success' : 'text-destructive'}>
                        {enclosureVerdict}
                      </p>
                    ) : (
                      <p className="text-warning">
                        {`${enclosureVerdict}. ${shellDefect} — these figures compare outer boxes, so they are not an assembly proof.`}
                      </p>
                    )}
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
                      <dt>Cavity</dt>
                      <dd className="text-right tabular-nums">
                        {millimetres(enclosureFit.cavityMm.width)} × {millimetres(enclosureFit.cavityMm.depth)} × {millimetres(enclosureFit.cavityMm.height)}
                      </dd>
                      <dt>Board stack</dt>
                      <dd className="text-right tabular-nums">
                        {millimetres(enclosureFit.stackMm.width)} × {millimetres(enclosureFit.stackMm.depth)} × {millimetres(enclosureFit.stackMm.height)}
                      </dd>
                      <dt>Wall room</dt>
                      <dd className="text-right tabular-nums">
                        {millimetres(enclosureFit.clearanceMm.negX)}/{millimetres(enclosureFit.clearanceMm.posX)} ×{' '}
                        {millimetres(enclosureFit.clearanceMm.negZ)}/{millimetres(enclosureFit.clearanceMm.posZ)}
                      </dd>
                      <dt>Lid / floor</dt>
                      <dd className="text-right tabular-nums">
                        {millimetres(enclosureFit.clearanceMm.posY)} / {millimetres(enclosureFit.clearanceMm.negY)}
                      </dd>
                    </dl>
                    <p className="text-muted-foreground">
                      Centred by bounding box; ribs, bosses and cut-outs in the model are not measured.
                    </p>
                  </div>
                )}
                {enclosure && !enclosureFit && (
                  <p className="text-muted-foreground">
                    The shell is drawn at its own size. The fit needs a routed board layout — until then
                    the board stack is unknown.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* Visibility Controls */}
            <Card>
              <CardHeader className="pb-3">
                <SectionTitle icon={Eye} tone="primary">Visibility</SectionTitle>
              </CardHeader>
              <CardContent className="grid gap-1.5 sm:grid-cols-2">
                <VisibilityRow label="Grid" on={showGrid} onToggle={() => setShowGrid(!showGrid)} swatch="#5b7cb8" />
                <VisibilityRow label="Components" on={showComponents} onToggle={() => setShowComponents(!showComponents)} swatch="#1f2126" />
                <VisibilityRow label="Traces" on={showTraces} onToggle={() => setShowTraces(!showTraces)} swatch="#d9a441" />
                <VisibilityRow label="PCB" on={showPCB} onToggle={() => setShowPCB(!showPCB)} swatch="#0a5732" />
              </CardContent>
            </Card>

            {/* Board source / layout warnings */}
            <Card>
              <CardHeader className="pb-3">
                <SectionTitle icon={FileStack} tone="success">Board source</SectionTitle>
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
                <SectionTitle icon={Layers} tone="info">PCB Layers</SectionTitle>
              </CardHeader>
              <CardContent className="grid gap-1.5">
                {layerRows.map(layer => (
                  <VisibilityRow
                    key={layer.key}
                    label={layer.label}
                    on={layer.visible}
                    onToggle={layer.toggle}
                    swatch={layer.color}
                  />
                ))}
              </CardContent>
            </Card>

            {/* Board appearance — how the fabricated board is expected to look */}
            <Card>
              <CardHeader className="pb-3">
                <SectionTitle icon={Palette} tone="warning">Board appearance</SectionTitle>
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
                          className={`cad-swatch h-7 w-7 rounded-full border-2 transition-transform ${
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
                <SectionTitle icon={Cpu} tone="primary">Components</SectionTitle>
              </CardHeader>
              <CardContent className="max-h-52 space-y-1.5 overflow-y-auto">
                {componentRows.map(component => (
                  <VisibilityRow
                    key={component.key}
                    label={component.label}
                    on={component.visible}
                    onToggle={component.toggle}
                    swatch={component.color}
                    note={component.onBoard ? null : <span className="text-[10px] text-destructive">off-board</span>}
                  />
                ))}
              </CardContent>
            </Card>

            {/* Export Options */}
            <Card>
              <CardHeader className="pb-3">
                <SectionTitle icon={Download} tone="warning">Export</SectionTitle>
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
                <SectionTitle icon={MonitorPlay} tone="info">AR / VR Preview</SectionTitle>
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
                <SectionTitle icon={Settings} tone="primary">Settings</SectionTitle>
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
                <RangeControl
                  id="component-scale"
                  label="Component scale"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={componentScale}
                  onValueChange={setComponentScale}
                  format={(value) => `${value.toFixed(1)}×`}
                />
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