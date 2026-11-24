import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import {
  SolidBuilder,
  buildRibbonGeometry,
  circleSection,
  rectSection,
  roundedRectSection,
  type RibbonPath,
} from '../3d/prismGeometry'
import { BOARD_CORNER_MM, type PcbScene, type PcbSceneComponent, type PcbScenePad, type PcbScenePour, type PcbSceneTraceSegment } from './pcbScene'
import { applyOutlineShading, restoreSolidMaterials, type ShadingMode } from '../3d/outline'

export interface PcbBoardGroupOptions {
  showPCB: boolean
  showTraces: boolean
  showComponents: boolean
  hiddenLayerIds: ReadonlySet<string>
  hiddenComponentIds: ReadonlySet<string>
  /**
   * Body exaggeration applied to each part about its own centre. Geometry does
   * not depend on it — see `applyComponentScale`, which moves the transform
   * instead of rebuilding the board.
   */
  componentScale?: number
  /** Soldermask lacquer chosen for the preview; defaults to the classic green. */
  maskColor?: PcbMaskColor
  /** Surface finish that sets the exposed-copper metal; defaults to ENIG. */
  padFinish?: PcbPadFinish
  /**
   * `outline` trades the shaded board for its crease wire, the reading used to
   * check geometry — a trace under a connector, a via inside a keepout, which
   * pad a part's body really hides. Default is the shaded solid.
   */
  shading?: ShadingMode
}

export type PcbMaskColor = 'green' | 'blue' | 'red' | 'black' | 'white' | 'purple'

export type PcbPadFinish = 'enig' | 'hasl' | 'osp'

export interface PcbMaskSpec {
  label: string
  /** Coat colour on the slab faces and edges. */
  baseColor: string
  /** Slightly lifted colour of the film laid over the copper. */
  overlayColor: string
  roughness: number
  clearcoat: number
  clearcoatRoughness: number
}

/**
 * Soldermask is a pigmented epoxy, not paint: the hue comes from the pigment,
 * the sheen from the cure. Matte black is deliberately rougher with almost no
 * clearcoat — the finish most assembly houses use to hide weave texture.
 */
export const SOLDERMASK_SPECS: Record<PcbMaskColor, PcbMaskSpec> = {
  green: { label: 'Green', baseColor: '#084a2a', overlayColor: '#0a5732', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.45 },
  blue: { label: 'Blue', baseColor: '#123a5c', overlayColor: '#14486e', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.45 },
  red: { label: 'Red', baseColor: '#5c1414', overlayColor: '#6e1717', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.45 },
  black: { label: 'Matte black', baseColor: '#101214', overlayColor: '#121518', roughness: 0.68, clearcoat: 0.12, clearcoatRoughness: 0.6 },
  white: { label: 'White', baseColor: '#d8d9cf', overlayColor: '#e4e5da', roughness: 0.54, clearcoat: 0.28, clearcoatRoughness: 0.5 },
  purple: { label: 'Purple', baseColor: '#3a1f5c', overlayColor: '#47256e', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.45 },
}

export interface PcbPadFinishSpec {
  label: string
  color: string
  metalness: number
  roughness: number
  note: string
}

/**
 * Pad finishes differ in what the eye sees: gold over nickel (ENIG), a bright
 * reflowed tin-lead-free alloy (HASL), or bare copper protected by an organic
 * layer (OSP). These are preview metals; the fab package does not encode them.
 */
export const PAD_FINISH_SPECS: Record<PcbPadFinish, PcbPadFinishSpec> = {
  enig: {
    label: 'ENIG (gold over nickel)',
    color: '#c9a24a',
    metalness: 0.55,
    roughness: 0.55,
    note: 'Satin gold; flat lands for fine pitch.',
  },
  hasl: {
    label: 'HASL (lead-free)',
    color: '#d5d9dd',
    metalness: 0.72,
    roughness: 0.4,
    note: 'Bright silver alloy with slightly domed lands.',
  },
  osp: {
    label: 'OSP (bare copper)',
    color: '#b87333',
    metalness: 0.45,
    roughness: 0.62,
    note: 'Copper tone under a thin organic coat.',
  },
}

const PAD_THICKNESS_MM = 0.045
const PAD_BOTTOM_EMBED_MM = 0.005
const MASK_OVERLAY_OPACITY = 0.46
/** Soldermask film thickness. Copper sits below this, pads break through it. */
const SOLDERMASK_MM = 0.025
/** A keepaway is drawn as the dielectric that replaces the copper, not a void. */
const KEEPOUT_DIELECTRIC = '#07351f'
/** How far a keepaway plug has to stand proud of the plane to cover it cleanly. */
const KEEPOUT_PROUD_MM = 0.004

/**
 * The e-CAD catalog's moulded-package groups.
 *
 * The dock files an op-amp as `amplifier`, a sensor as `sensor` and a regulator
 * as `regulator`; each is still a moulded body with leads and a pin-1 end, so the
 * 3-D builder keys that shape off this list instead of the single word `ic`. A
 * category absent from it is drawn as whatever generic body its footprint gives.
 */
const MOULDED_PACKAGE_CATEGORIES = new Set([
  'ic',
  'interface',
  'amplifier',
  'converter',
  'reference',
  'regulator',
  'sensor',
  'microcontroller',
  'memory',
  'semiconductor',
])

function isMouldedPackage(category: string): boolean {
  return MOULDED_PACKAGE_CATEGORIES.has(category)
}

/**
 * Shapes shared by every part of the same size.
 *
 * A board is made of repeats: the laptop mainboard has 615 copper lands, and
 * before this cache existed each one got its own geometry — 3 375 constructor
 * calls, 3 M vertices and an 88 s build that froze the tab. Shapes are keyed by
 * their exact millimetres, so a shared shape is indistinguishable from a private
 * one, and the cache stops taking entries once it holds a few thousand so an
 * unusual board cannot grow it without bound.
 */
const sharedShapes = new Map<string, THREE.BufferGeometry>()
const SHAPE_CACHE_LIMIT = 4096

/**
 * A millimetre value as a cache key: 0.1 um resolution, which is far finer than
 * any footprint declares and coarse enough that float noise cannot make two
 * identical lands ask for two geometries.
 */
function mm(value: number): string {
  return value.toFixed(4)
}

function cachedShape(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  const existing = sharedShapes.get(key)
  if (existing) return existing
  const shape = make()
  if (sharedShapes.size < SHAPE_CACHE_LIMIT) {
    sharedShapes.set(key, shape)
    // A cached shape outlives the group that first asked for it, so the group
    // must not dispose it.
    shape.userData.shared = true
  }
  return shape
}

/** A unit cube, scaled per mesh: every straight lead and pin shares this one. */
function unitBox(): THREE.BufferGeometry {
  return cachedShape('unit-box', () => new THREE.BoxGeometry(1, 1, 1))
}

function prismShape(key: string, section: ReturnType<typeof circleSection>, heightMm: number): THREE.BufferGeometry {
  return cachedShape(key, () => {
    const builder = new SolidBuilder()
    builder.prism(section, -heightMm / 2, heightMm / 2)
    const geometry = builder.geometry()
    return geometry ?? new THREE.BufferGeometry()
  })
}

/** A straight-sided cylinder, centred on the origin, at the resolution asked for. */
function circleShape(radius: number, heightMm: number, sides: number): THREE.BufferGeometry {
  return prismShape(`circle|${mm(radius)}|${mm(heightMm)}|${sides}`, circleSection(radius, sides), heightMm)
}

/** A dome (top half of a sphere) or a whole sphere, shared per radius. */
function sphereShape(radius: number, dome: boolean): THREE.BufferGeometry {
  return cachedShape(`sphere|${mm(radius)}|${dome ? 'dome' : 'full'}`, () => new THREE.SphereGeometry(
    radius,
    20,
    dome ? 14 : 8,
    0,
    Math.PI * 2,
    0,
    dome ? Math.PI / 2 : Math.PI,
  ))
}

/**
 * A rectangular slab from the shared unit cube.
 *
 * Scale lives on the transform, so a board's hundreds of bands, pins and castellated
 * pads cost one geometry between them. Exporters read `matrixWorld`, which includes
 * the scale, so the solid that leaves the app is the size it looks.
 */
function boxMesh(width: number, height: number, depth: number, material: THREE.Material, name: string): THREE.Mesh {
  const mesh = new THREE.Mesh(unitBox(), material)
  mesh.name = name
  mesh.scale.set(width, height, depth)
  return mesh
}

/**
 * Finishes shared by every part of the same kind and hue.
 *
 * Materials repeat the way shapes do: 56 packages on the mainboard use eight
 * distinct finishes, and each private material is another shader program the
 * renderer has to bind. What varies between rebuilds (mask, copper, artwork)
 * stays private to the group, because those are derived from the options.
 */
const sharedMaterials = new Map<string, THREE.Material>()

function cachedMaterial(key: string, make: () => THREE.Material): THREE.Material {
  const existing = sharedMaterials.get(key)
  if (existing) return existing
  const material = make()
  if (sharedMaterials.size < SHAPE_CACHE_LIMIT) {
    material.userData.shared = true
    sharedMaterials.set(key, material)
  }
  return material
}

/** The satin colour of a moulded band, dome or plating tab — one per colour. */
function decoMaterial(color: string, roughness: number, metalness = 0): THREE.Material {
  return cachedMaterial(
    `deco|${color}|${roughness}|${metalness}`,
    () => new THREE.MeshStandardMaterial({ color, roughness, metalness }),
  )
}

/**
 * Add a finished buffer to the board, or nothing at all when the pass that
 * built it had nothing to draw.
 */
function addBuiltMesh(
  group: THREE.Group,
  geometry: THREE.BufferGeometry | null,
  name: string,
  material: THREE.Material,
  flags: { receiveShadow?: boolean; excludeFromExport?: boolean } = {},
): void {
  if (!geometry) return
  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = name
  if (flags.receiveShadow) mesh.receiveShadow = true
  if (flags.excludeFromExport) mesh.userData.excludeFromExport = true
  group.add(mesh)
}

/**
 * Release what a rebuilt group owns.
 *
 * The preview rebuilds whenever a layer is hidden, the mask changes or a slider
 * moves, and the old geometry stayed on the GPU because three.js does not dispose
 * what it did not create. Shared shapes and their materials are the cache's, so
 * only the group's private shapes, materials and textures are released.
 */
export function disposePcbGroup(group: THREE.Group): void {
  // An outline-shaded group parks its real finishes on `userData`, out of reach
  // of the walk below, so they would outlive the board that made them. Put the
  // pointers back where the walk can see them first.
  restoreSolidMaterials(group)
  const released = new Set<THREE.BufferGeometry | THREE.Material>()
  group.traverse((object) => {
    const mesh = object as THREE.Mesh
    if (!mesh.isMesh) return
    if (!mesh.geometry.userData.shared && !released.has(mesh.geometry)) {
      released.add(mesh.geometry)
      mesh.geometry.dispose()
    }
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (material.userData.shared || released.has(material)) continue
      released.add(material)
      for (const slot of ['map', 'bumpMap', 'alphaMap'] as const) {
        const texture = (material as THREE.MeshStandardMaterial)[slot]
        if (texture) texture.dispose()
      }
      material.dispose()
    }
  })
}

/** Shapes are built in the XY plane and extruded along +Z. */
function roundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2))
  const x = -width / 2
  const y = -height / 2
  const shape = new THREE.Shape()
  shape.moveTo(x + r, y)
  shape.lineTo(x + width - r, y)
  shape.quadraticCurveTo(x + width, y, x + width, y + r)
  shape.lineTo(x + width, y + height - r)
  shape.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  shape.lineTo(x + r, y + height)
  shape.quadraticCurveTo(x, y + height, x, y + height - r)
  shape.lineTo(x, y + r)
  shape.quadraticCurveTo(x, y, x + r, y)
  return shape
}

/** Rounded board slab centred on X/Z with its mid-plane at Y = 0. */
function boardSlabGeometry(width: number, height: number, thickness: number): THREE.ExtrudeGeometry {
  const bevel = Math.min(0.09, thickness * 0.12)
  const depth = Math.max(0.01, thickness - bevel * 2)
  const geometry = new THREE.ExtrudeGeometry(roundedRectShape(width, height, BOARD_CORNER_MM), {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 18,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, -depth / 2, 0)
  geometry.computeVertexNormals()
  return geometry
}

function flatRoundedGeometry(width: number, height: number): THREE.ShapeGeometry {
  return new THREE.ShapeGeometry(roundedRectShape(width, height, BOARD_CORNER_MM), 18)
}

/**
 * The copper of a poured plane: its outline, no holes.
 *
 * A plane is a rounded rectangle — the board's own corner radius, reduced
 * concentrically by the margin the scene declares — so it is the same kind of
 * solid as the land it keeps its distance from: a prism, shared by every plane of
 * those millimetres. It used to be an extrusion of a shape with hundreds of holes
 * in its outline, and triangulating that boundary is what held the tab for 83
 * seconds on a board with six planes.
 */
function pourPlaneShape(pour: PcbScenePour, thickness: number): THREE.BufferGeometry {
  return cachedShape(
    `pour|${mm(pour.widthMm)}|${mm(pour.depthMm)}|${mm(pour.cornerRadiusMm)}|${mm(thickness)}`,
    () => {
      const builder = new SolidBuilder()
      builder.prism(
        roundedRectSection(pour.widthMm, pour.depthMm, pour.cornerRadiusMm, 4),
        -thickness / 2,
        thickness / 2,
      )
      return builder.geometry() ?? new THREE.BufferGeometry()
    },
  )
}

/**
 * The clearance around every keepaway, as the dielectric that takes the copper's
 * place there.
 *
 * This used to be holes cut out of the plane's own outline. Cutting them is an
 * ear-clipping triangulation of the whole boundary at once, and a plane whose
 * keepaways run to several hundred took tens of seconds. One small prism per
 * clearance costs arithmetic and reads the same: the hole is the colour of the
 * laminate, not of the copper.
 */
function pourKeepoutGeometry(pour: PcbScenePour, thickness: number): THREE.BufferGeometry | null {
  if (pour.holes.length === 0) return null
  const builder = new SolidBuilder()
  const bottom = pour.yMm - thickness / 2 - KEEPOUT_PROUD_MM
  const top = pour.yMm + thickness / 2 + KEEPOUT_PROUD_MM
  for (const hole of pour.holes) {
    const section = hole.shape === 'circle'
      ? circleSection(Math.max(0.05, Math.min(hole.widthMm, hole.depthMm) / 2), 12)
      : rectSection(hole.widthMm, hole.depthMm)
    builder.prism(section, bottom, top, { x: hole.x, z: hole.z })
  }
  return builder.geometry()
}

function roundedBox(width: number, height: number, depth: number, radius = 0.1): THREE.BufferGeometry {
  const safeRadius = Math.max(0.001, Math.min(radius, width / 2, height / 2, depth / 2))
  const size = [width, height, depth].map((value) => Math.max(0.01, value))
  return cachedShape(
    `rbox|${size.map(mm).join(',')}|${mm(safeRadius)}`,
    () => new RoundedBoxGeometry(size[0], size[1], size[2], 2, safeRadius),
  )
}

function copperColor(layerColor: string): THREE.Color {
  // The layer palette is an editor convention (red / orange). Pull it toward
  // metallic copper so the render reads as a board, not a neon diagram, while
  // keeping enough hue separation to tell the layers apart.
  const base = new THREE.Color(layerColor)
  if (!Number.isFinite(base.r) || !Number.isFinite(base.g) || !Number.isFinite(base.b)) {
    return new THREE.Color('#b87333')
  }
  return base.lerp(new THREE.Color('#b87333'), 0.62)
}

/**
 * Fine-grain surface relief for the soldermask. A perfectly smooth slab reads
 * as plastic; a few percent of roughness variation is what makes the light
 * break up like a real coated board.
 */
function createMaskReliefTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  let canvas: HTMLCanvasElement
  try {
    canvas = document.createElement('canvas')
  } catch {
    return null
  }
  canvas.width = 128
  canvas.height = 128
  let context: CanvasRenderingContext2D | null = null
  try {
    context = canvas.getContext('2d')
  } catch {
    return null
  }
  if (!context) return null
  const image = context.createImageData(128, 128)
  // Deterministic grain: the same board must render identically on every reload
  // and device, so the mask cannot depend on Math.random().
  let seed = 0x9e3779b9
  const noise = (): number => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  for (let index = 0; index < image.data.length; index += 4) {
    const value = 118 + Math.round(noise() * 38)
    image.data[index] = value
    image.data[index + 1] = value
    image.data[index + 2] = value
    image.data[index + 3] = 255
  }
  context.putImageData(image, 0, 0)
  const texture = new THREE.CanvasTexture(canvas)
  texture.wrapS = THREE.RepeatWrapping
  texture.wrapT = THREE.RepeatWrapping
  texture.repeat.set(14, 14)
  texture.colorSpace = THREE.NoColorSpace
  return texture
}

function degToRad(degrees: number): number {
  return (degrees * Math.PI) / 180
}

function toLocal(component: PcbSceneComponent, world: { x: number; z: number }): { x: number; z: number } {
  const dx = world.x - component.position.x
  const dz = world.z - component.position.z
  const angle = degToRad(component.rotationYDeg)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  // Board rotation is clockwise seen from above, which is -Y in three.js.
  // This is the inverse of that rotation, so a part's terminals land on the
  // pad positions the layout placed.
  return { x: dx * cos + dz * sin, z: -dx * sin + dz * cos }
}

function addLead(
  parent: THREE.Object3D,
  from: { x: number; y: number; z: number },
  to: { x: number; y: number; z: number },
  width: number,
  height: number,
  material: THREE.Material,
  name: string,
): void {
  const dx = to.x - from.x
  const dz = to.z - from.z
  const length = Math.hypot(dx, dz)
  if (length < 0.01) return
  // One unit cube, scaled and turned: a board's leads are the same shape dozens
  // of times over, and a geometry each would be the expensive part.
  const mesh = new THREE.Mesh(unitBox(), material)
  mesh.name = name
  mesh.scale.set(length, height, width)
  mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2)
  mesh.rotation.y = -Math.atan2(dz, dx)
  parent.add(mesh)
}

/**
 * Clear silkscreen where it would land on exposed copper, the way a fab clips
 * artwork at pad openings. Without this, reference designators and cathode bars
 * print across pads, which reads as a rendering fault.
 */
function clipSilkscreenAtPads(
  context: CanvasRenderingContext2D,
  scene: PcbScene,
  scale: number,
): void {
  const { board } = scene
  context.save()
  context.globalCompositeOperation = 'destination-out'
  context.fillStyle = '#000000'
  for (const component of scene.components) {
    if (!component.onBoard) continue
    const cx = (component.position.x + board.widthMm / 2) * scale
    const cy = (component.position.z + board.heightMm / 2) * scale
    const angle = degToRad(component.rotationYDeg)
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    context.save()
    context.translate(cx, cy)
    context.rotate(angle)
    for (const pad of component.pads) {
      const dx = pad.position.x - component.position.x
      const dz = pad.position.z - component.position.z
      const localX = dx * cos + dz * sin
      const localZ = -dx * sin + dz * cos
      const clearance = 0.08 * scale
      const width = pad.widthMm * scale + clearance * 2
      const depth = pad.depthMm * scale + clearance * 2
      context.fillRect(localX * scale - width / 2, localZ * scale - depth / 2, width, depth)
    }
    context.restore()
  }
  context.restore()
}

/** Silkscreen artwork painted onto a transparent canvas and mapped to the board. */
function createSilkscreenTexture(scene: PcbScene, side: 'top' | 'bottom'): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null
  const { board } = scene
  const scale = Math.min(30, 2048 / Math.max(board.widthMm, board.heightMm))
  let canvas: HTMLCanvasElement
  try {
    canvas = document.createElement('canvas')
  } catch {
    return null
  }
  canvas.width = Math.max(64, Math.round(board.widthMm * scale))
  canvas.height = Math.max(64, Math.round(board.heightMm * scale))
  let context: CanvasRenderingContext2D | null = null
  try {
    context = canvas.getContext('2d')
  } catch {
    return null
  }
  if (!context) return null

  if (side === 'bottom') {
    context.translate(canvas.width, 0)
    context.scale(-1, 1)
  }

  const mm = (value: number) => value * scale
  const white = 'rgba(246, 248, 246, 0.94)'
  context.strokeStyle = white
  context.fillStyle = white
  context.lineWidth = Math.max(1.5, mm(0.12))
  context.lineCap = 'round'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.font = `600 ${Math.max(9, mm(0.55))}px "Archivo", "Segoe UI", Arial, sans-serif`

  for (const component of scene.components) {
    if (!component.onBoard) continue
    const cx = mm(component.position.x + board.widthMm / 2)
    const cy = mm(component.position.z + board.heightMm / 2)
    const width = mm(component.bodyWidthMm)
    const depth = mm(component.bodyDepthMm)
    const gap = mm(0.2)
    const twoTerminal = component.pads.length === 2
    const padsAlongX = twoTerminal
      && Math.abs(component.pads[1].position.x - component.pads[0].position.x)
        >= Math.abs(component.pads[1].position.z - component.pads[0].position.z)

    context.save()
    context.translate(cx, cy)
    context.rotate(degToRad(component.rotationYDeg))

    if (component.category === 'connector' || component.pads.length > 2) {
      // Package outline plus the pin-1 chamfer every assembly house expects. A
      // connector wants it at any pad count; anything else earns it by having
      // more than two leads, which is when the body has an orientation at all.
      context.strokeRect(-width / 2 - gap, -depth / 2 - gap, width + gap * 2, depth + gap * 2)
      context.beginPath()
      context.arc(-width / 2 - gap / 2, -depth / 2 - gap / 2, mm(0.22), 0, Math.PI * 2)
      context.fill()
    } else if (twoTerminal && padsAlongX) {
      // Chip parts: two long lines clear of the end terminals.
      const inset = Math.min(width * 0.18, mm(0.35))
      context.beginPath()
      context.moveTo(-width / 2 + inset, -depth / 2 - gap)
      context.lineTo(width / 2 - inset, -depth / 2 - gap)
      context.moveTo(-width / 2 + inset, depth / 2 + gap)
      context.lineTo(width / 2 - inset, depth / 2 + gap)
      context.stroke()
    } else if (twoTerminal) {
      const inset = Math.min(depth * 0.18, mm(0.35))
      context.beginPath()
      context.moveTo(-width / 2 - gap, -depth / 2 + inset)
      context.lineTo(-width / 2 - gap, depth / 2 - inset)
      context.moveTo(width / 2 + gap, -depth / 2 + inset)
      context.lineTo(width / 2 + gap, depth / 2 - inset)
      context.stroke()
    } else {
      context.strokeRect(-width / 2 - gap, -depth / 2 - gap, width + gap * 2, depth + gap * 2)
    }

    if (component.category === 'semiconductor' && twoTerminal) {
      // Cathode bar on the silk, matching the banded body.
      const barX = (padsAlongX ? 1 : 0) * (width / 2 - mm(0.35))
      const barZ = (padsAlongX ? 0 : 1) * (depth / 2 - mm(0.35))
      context.lineWidth = Math.max(2, mm(0.22))
      context.beginPath()
      if (padsAlongX) {
        context.moveTo(barX, -depth / 2)
        context.lineTo(barX, depth / 2)
      } else {
        context.moveTo(-width / 2, barZ)
        context.lineTo(width / 2, barZ)
      }
      context.stroke()
      context.lineWidth = Math.max(1.5, mm(0.12))
    }

    if (component.category === 'capacitor' && component.bodyShape === 'cylinder') {
      // Polarity mark for the can.
      const mark = Math.min(width, depth) * 0.18
      context.beginPath()
      context.moveTo(-mark, 0)
      context.lineTo(mark, 0)
      context.moveTo(0, -mark)
      context.lineTo(0, mark)
      context.stroke()
    }
    context.restore()

    // Reference designator, kept outside the body and clear of the board edge.
    const label = component.reference
    const above = cy - depth / 2 - mm(0.62)
    const below = cy + depth / 2 + mm(1.15)
    const placeBelow = above < mm(0.8)
    context.fillText(label, cx, placeBelow ? below : above)
  }

  context.font = `700 ${Math.max(10, mm(0.62))}px "Archivo", "Segoe UI", Arial, sans-serif`
  context.fillText('FOLIO', mm(3), mm(board.heightMm - 2.2))
  context.font = `500 ${Math.max(8, mm(0.42))}px "Archivo", "Segoe UI", Arial, sans-serif`
  context.fillText('REV A', mm(3), mm(board.heightMm - 1.2))
  context.textAlign = 'right'
  context.fillText(
    `${board.widthMm} × ${board.heightMm} mm · FR-4 · 1 oz`,
    mm(board.widthMm - 2.5),
    mm(board.heightMm - 1.2),
  )

  clipSilkscreenAtPads(context, scene, scale)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 4
  texture.needsUpdate = true
  return texture
}

/**
 * The footprint category chooses the *finish* — matte epoxy, satin metal,
 * brushed can — and the part's own colour chooses the *hue* within it.
 * Hard-coding both made every IC, diode and connector the same near-black lump,
 * so a 46-part board read as one grey mass instead of a populated design.
 */
function componentMaterial(component: PcbSceneComponent): THREE.Material {
  const hue = new THREE.Color(component.color)
  const key = `body|${component.category}|${hue.getHexString()}`
  switch (component.category) {
    case 'ic':
      return cachedMaterial(key, () => new THREE.MeshPhysicalMaterial({
        color: hue,
        roughness: 0.46,
        metalness: 0.06,
        clearcoat: 0.25,
        clearcoatRoughness: 0.5,
      }))
    case 'semiconductor':
      return cachedMaterial(key, () => new THREE.MeshStandardMaterial({ color: hue, roughness: 0.5, metalness: 0.04 }))
    case 'crystal':
      return cachedMaterial(key, () => new THREE.MeshStandardMaterial({ color: hue, roughness: 0.24, metalness: 0.88 }))
    case 'connector':
      return cachedMaterial(key, () => new THREE.MeshStandardMaterial({ color: hue, roughness: 0.62, metalness: 0.02 }))
    case 'capacitor':
      return cachedMaterial(key, () => new THREE.MeshStandardMaterial({ color: hue, roughness: 0.58, metalness: 0.04 }))
    case 'inductor':
      return cachedMaterial(key, () => new THREE.MeshStandardMaterial({ color: hue, roughness: 0.5, metalness: 0.18 }))
    case 'switch':
      // Tact switches are metal-dome parts, not plastic chips.
      return cachedMaterial(key, () => new THREE.MeshStandardMaterial({ color: hue, roughness: 0.42, metalness: 0.45 }))
    default:
      return cachedMaterial(key, () => new THREE.MeshStandardMaterial({
        color: hue,
        roughness: 0.52,
        metalness: 0.05,
      }))
  }
}

/**
 * Two-land SMD chip: one moulded body with a metal terminal wrapped around each
 * end, sitting on its lands. Diodes and LEDs belong here too — their packages
 * *are* two-terminal chips, and giving them the same end metal is what
 * separates a 1N5817 from an anonymous black block.
 */
const CHIP_LIKE_CATEGORIES = new Set(['resistor', 'capacitor', 'inductor', 'semiconductor', 'led'])

interface ChipShape {
  /** Body extent in the part's local frame, and which local axis the lands lie on. */
  spanXMm: number
  spanZMm: number
  padAxis: 'x' | 'z'
  /** Length of each end terminal along the pad axis — decorations sit just inside it. */
  capMm: number
}

function addTwoTerminalChip(
  model: THREE.Group,
  component: PcbSceneComponent,
  bodyMaterial: THREE.Material,
  terminalMaterial: THREE.Material,
): ChipShape | null {
  if (component.pads.length !== 2) return null
  const local = component.pads.map((pad) => toLocal(component, pad.position))
  const span = Math.hypot(local[1].x - local[0].x, local[1].z - local[0].z)
  if (span < 0.2) return null
  const padSize = component.pads[0]
  const alongX = Math.abs(local[1].x - local[0].x) >= Math.abs(local[1].z - local[0].z)
  const landAlongMm = alongX ? padSize.widthMm : padSize.depthMm
  const landAcrossMm = alongX ? padSize.depthMm : padSize.widthMm
  // The moulding is the package's declared body length, which on a real chip
  // overhangs the inner edge of each land. Falling back to the land span keeps a
  // part whose footprint declares no body from shrinking to nothing.
  const declared = alongX ? component.bodyWidthMm : component.bodyDepthMm
  const bodyLength = Math.max(0.2, span, declared)
  const bodyWidth = Math.max(0.15, Math.min(
    alongX ? component.bodyDepthMm : component.bodyWidthMm,
    landAcrossMm * 1.12,
  ))
  const height = component.bodyHeightMm
  const box = (lengthMm: number, widthMm: number, radiusMm: number) =>
    alongX
      ? roundedBox(lengthMm, height, widthMm, radiusMm)
      : roundedBox(widthMm, height, lengthMm, radiusMm)

  const body = new THREE.Mesh(box(bodyLength, bodyWidth, Math.min(0.09, height * 0.25)), bodyMaterial)
  body.name = `body-${component.id}`
  body.castShadow = true
  model.add(body)

  // End metal: a cap on each end, proud of the moulding by a hair so the two
  // materials never share a face and z-fight at grazing angles.
  const capLength = Math.min(landAlongMm * 0.8, bodyLength * 0.26)
  for (const sign of [1, -1]) {
    const terminal = new THREE.Mesh(
      alongX
        ? roundedBox(capLength, height * 1.02, bodyWidth * 1.02, Math.min(0.06, height * 0.2))
        : roundedBox(bodyWidth * 1.02, height * 1.02, capLength, Math.min(0.06, height * 0.2)),
      terminalMaterial,
    )
    terminal.name = `terminal-${component.id}`
    terminal.position.set(
      alongX ? sign * (bodyLength - capLength) / 2 : 0,
      0,
      alongX ? 0 : sign * (bodyLength - capLength) / 2,
    )
    terminal.castShadow = true
    model.add(terminal)
  }
  return {
    spanXMm: alongX ? bodyLength : bodyWidth,
    spanZMm: alongX ? bodyWidth : bodyLength,
    padAxis: alongX ? 'x' : 'z',
    capMm: capLength,
  }
}

function addComponentBody(
  group: THREE.Group,
  component: PcbSceneComponent,
  material: THREE.Material,
  padMaterial: THREE.Material,
  leadMaterial: THREE.Material,
): void {
  const model = new THREE.Group()
  model.name = `component-${component.id}`
  model.position.set(component.position.x, component.position.y, component.position.z)
  // Layout rotation is clockwise in board coordinates; a Y rotation in three.js
  // is counter-clockwise seen from above, so it takes the negative angle.
  model.rotation.y = -degToRad(component.rotationYDeg)

  const width = component.bodyWidthMm
  const depth = component.bodyDepthMm
  const height = component.bodyHeightMm

  // A mounting hole declares no moulding: its 6 mm land and 3.2 mm drill are the
  // whole part. Building a box of height 0 here produced a zero-volume shell that
  // z-fought with the mask under it.
  if (height <= 0.001) {
    group.add(model)
    return
  }

  if (component.bodyShape === 'cylinder') {
    const radius = Math.min(width, depth) / 2
    const can = new THREE.Mesh(circleShape(radius, height, 28), material)
    can.name = `body-${component.id}`
    can.castShadow = true
    model.add(can)
    const cap = new THREE.Mesh(circleShape(radius * 0.9, 0.05, 28), leadMaterial)
    cap.position.y = height / 2 + 0.01
    model.add(cap)
    const stripe = boxMesh(radius * 0.22, height * 0.72, radius * 0.72, decoMaterial('#dbe2e8', 0.5), 'stripe')
    stripe.position.set(radius * 0.82, 0, 0)
    model.add(stripe)
    for (const pad of component.pads) {
      const local = toLocal(component, pad.position)
      addLead(
        model,
        { x: local.x, y: -height / 2 + 0.25, z: local.z },
        { x: local.x, y: -height / 2, z: local.z },
        0.35,
        Math.max(0.3, -component.position.y + height / 2 + 0.25),
        leadMaterial,
        `lead-${pad.id}`,
      )
    }
    group.add(model)
    return
  }

  // Body footprint in the part's local frame, and which axis its lands sit on.
  // The decorations below (cathode band, lens, actuator) hang off these, so a
  // rotated part gets them on the right face instead of the nominal one.
  let footXMm = width
  let footZMm = depth
  let padAxis: 'x' | 'z' = width >= depth ? 'x' : 'z'
  let capMm = 0
  let chipBuilt = false

  if (CHIP_LIKE_CATEGORIES.has(component.category) && component.pads.length === 2) {
    const chip = addTwoTerminalChip(model, component, material, leadMaterial)
    if (chip) {
      footXMm = chip.spanXMm
      footZMm = chip.spanZMm
      padAxis = chip.padAxis
      capMm = chip.capMm
      chipBuilt = true
    }
  }

  if (!chipBuilt) {
    const moulded = isMouldedPackage(component.category)
    const boxWidth = moulded ? width * 0.94 : width
    const boxDepth = moulded ? depth * 0.94 : depth
    const radius = moulded ? 0.1 : 0.14
    const body = new THREE.Mesh(roundedBox(boxWidth, height, boxDepth, radius), material)
    body.name = `body-${component.id}`
    body.castShadow = true
    model.add(body)
  }

  if (isMouldedPackage(component.category)) {
    const dimple = new THREE.Mesh(
      sphereShape(Math.min(0.22, Math.min(width, depth) * 0.06), false),
      decoMaterial('#050505', 0.35),
    )
    dimple.position.set(-width / 2 + width * 0.13, height / 2 - 0.02, -depth / 2 + depth * 0.13)
    model.add(dimple)
  }

  if (component.category === 'semiconductor' && component.pads.length === 2) {
    // Cathode band: a painted ring just inside the cathode-end terminal, proud of
    // the body on both other axes so it never shares a face with the moulding.
    const bandThick = Math.max(0.1, Math.min(footXMm, footZMm) * 0.18)
    const band = padAxis === 'x'
      ? boxMesh(bandThick, height * 1.03, footZMm * 1.03, decoMaterial('#dde3e9', 0.32, 0.55), 'band')
      : boxMesh(footXMm * 1.03, height * 1.03, bandThick, decoMaterial('#dde3e9', 0.32, 0.55), 'band')
    const half = (padAxis === 'x' ? footXMm : footZMm) / 2
    const centre = half - capMm - bandThick / 2
    if (padAxis === 'x') band.position.x = centre
    else band.position.z = centre
    model.add(band)
  }

  if (component.category === 'led') {
    // The die colour *is* the part colour: a red, green, amber and blue LED on
    // one board have to read as four parts, and a lens that self-illuminates is
    // what makes a populated board look switched-on rather than moulded.
    const hue = new THREE.Color(component.color)
    const lens = new THREE.Mesh(
      sphereShape(Math.min(footXMm, footZMm) * 0.42, true),
      cachedMaterial(`lens|${hue.getHexString()}`, () => new THREE.MeshPhysicalMaterial({
        color: hue,
        emissive: hue,
        emissiveIntensity: 0.75,
        transmission: 0.35,
        thickness: 0.6,
        roughness: 0.18,
      })),
    )
    lens.position.y = height / 2
    model.add(lens)
  }

  if (component.category === 'switch') {
    const actuator = new THREE.Mesh(
      circleShape(Math.min(width, depth) * 0.18, 0.5, 16),
      decoMaterial('#c8cdd3', 0.4, 0.5),
    )
    actuator.position.y = height / 2 + 0.25
    model.add(actuator)
  }

  for (const pad of component.pads) {
    const local = toLocal(component, pad.position)
    if (component.category === 'connector') {
      const pin = boxMesh(0.55, Math.max(0.8, height * 0.7), 0.55, padMaterial, 'pin')
      pin.position.set(local.x, height * 0.35, local.z)
      pin.castShadow = true
      model.add(pin)
      continue
    }
    if (isMouldedPackage(component.category)) {
      const onXSide = Math.abs(local.x) > Math.abs(local.z)
      if (onXSide) {
        const inner = Math.sign(local.x || 1) * (width / 2 - 0.05)
        addLead(
          model,
          { x: local.x, y: -height / 2 + 0.06, z: local.z },
          { x: inner, y: -height / 2 + 0.06, z: local.z },
          Math.min(0.32, pad.depthMm * 0.62),
          0.12,
          leadMaterial,
          `lead-${pad.id}`,
        )
      } else {
        const inner = Math.sign(local.z || 1) * (depth / 2 - 0.05)
        addLead(
          model,
          { x: local.x, y: -height / 2 + 0.06, z: local.z },
          { x: local.x, y: -height / 2 + 0.06, z: inner },
          Math.min(0.32, pad.widthMm * 0.62),
          0.12,
          leadMaterial,
          `lead-${pad.id}`,
        )
      }
    }
  }

  group.add(model)
}

/**
 * One continuous mitred ribbon for a whole copper layer.
 *
 * Rendering each polyline segment as a capsule turns every vertex into a pinch
 * that reads as a chain of beads, and asking three.js to build 9 107 boxes plus
 * twice that many joint cylinders cost 7.5 s and 1.6 M vertices on the laptop
 * mainboard. A layer of copper is one buffer written in one pass instead: the
 * flat-topped ribbon a trace really is, at the width the rule declares.
 */
function layerCopperGeometry(
  paths: RibbonPath[],
  yMm: number,
  copperThicknessMm: number,
): THREE.BufferGeometry | null {
  // The copper sits on its layer plane and rises to the height the stackup
  // declares, the same placement the segment boxes had.
  return buildRibbonGeometry(paths, yMm, yMm + copperThicknessMm)
}

/**
 * Chain the scene's segments back into the centre lines the router laid.
 *
 * `buildPcbScene` emits a trace as one segment per pair of consecutive points, in
 * order, so a trace's polyline is recovered by joining a segment whose start is
 * where the last one ended. A break — a lifted and re-laid net, a trace rebuilt
 * after a move — starts a new ribbon rather than stretching one across the gap.
 */
function ribbonPathsByLayer(
  segments: PcbSceneTraceSegment[],
  hiddenLayerIds: ReadonlySet<string>,
): Map<string, RibbonPath[]> {
  const byLayer = new Map<string, RibbonPath[]>()
  const open = new Map<string, { end: { x: number; z: number }; path: RibbonPath }>()
  for (const segment of segments) {
    if (hiddenLayerIds.has(segment.layerId)) continue
    const key = `${segment.layerId}::${segment.traceId}`
    const started = open.get(key)
    const continuous =
      started !== undefined &&
      Math.abs(started.end.x - segment.start.x) < 1e-6 &&
      Math.abs(started.end.z - segment.start.z) < 1e-6
    if (!started || !continuous) {
      const path: RibbonPath = {
        points: [{ x: segment.start.x, z: segment.start.z }, { x: segment.end.x, z: segment.end.z }],
        widthMm: Math.max(0.08, segment.widthMm),
      }
      open.set(key, { end: { x: segment.end.x, z: segment.end.z }, path })
      const paths = byLayer.get(segment.layerId)
      if (paths) paths.push(path)
      else byLayer.set(segment.layerId, [path])
      continue
    }
    started.path.points.push({ x: segment.end.x, z: segment.end.z })
    started.end = { x: segment.end.x, z: segment.end.z }
  }
  return byLayer
}

/**
 * Grow or shrink every part about its own centre without rebuilding the board.
 *
 * The size slider exists because a schematic-scale circuit is a few millimetres
 * tall, so the parts need exaggerating to be seen. Scaling the whole group would
 * slide them off the lands they sit on, so it is applied to each part's own
 * transform instead — which is a loop over the children, not the 3 375 geometry
 * allocations a rebuild would cost on every frame of a drag.
 */
export function applyComponentScale(group: THREE.Group, scale: number): void {
  for (const child of group.children) {
    if (child.name.startsWith('component-')) child.scale.setScalar(scale)
  }
  group.updateMatrixWorld(true)
}

/** Build the complete routed board: substrate, copper, parts and artwork. */
export function buildPcbGroup(scene: PcbScene, options: PcbBoardGroupOptions): THREE.Group {
  const group = new THREE.Group()
  group.name = 'pcb-layout'
  const { board } = scene

  // Satin ENIG, not a mirror: a fully metallic, low-roughness pad under a
  // punctual key light produces a single blown-white hotspot on whichever pad
  // happens to sit at the reflection angle, while its twin stays gold.
  const finish = PAD_FINISH_SPECS[options.padFinish ?? 'enig']
  const mask = SOLDERMASK_SPECS[options.maskColor ?? 'green']
  const padMaterial = new THREE.MeshStandardMaterial({
    color: finish.color,
    metalness: finish.metalness,
    roughness: finish.roughness,
    envMapIntensity: 0.8,
  })
  const leadMaterial = new THREE.MeshStandardMaterial({
    color: '#c6ccd3',
    metalness: 0.6,
    roughness: 0.5,
    envMapIntensity: 0.7,
  })
  const drillMaterial = new THREE.MeshStandardMaterial({ color: '#0b0d0e', roughness: 0.85 })
  const traceMaterials = new Map<string, THREE.MeshStandardMaterial>()
  const traceMaterialFor = (layerId: string): THREE.MeshStandardMaterial => {
    const existing = traceMaterials.get(layerId)
    if (existing) return existing
    const layerColor = scene.layers.find((entry) => entry.id === layerId)?.color ?? '#b87333'
    const material = new THREE.MeshStandardMaterial({
      color: copperColor(layerColor),
      metalness: 0.74,
      roughness: 0.42,
    })
    traceMaterials.set(layerId, material)
    return material
  }

  const topCopper = scene.layers.find((layer) => layer.kind === 'copper' && layer.side !== 'bottom')
  const topMask = scene.layers.find((layer) => layer.kind === 'mask' && layer.side !== 'bottom')
  const maskTopY = board.topSurfaceYMm
    + (topCopper?.thicknessMm ?? 0.035)
    + (topMask?.thicknessMm ?? SOLDERMASK_MM)

  // Copper lands break through the mask. Embedding the land slightly and
  // leaving its face clearly proud of the cosmetic films keeps depth ordering
  // deterministic instead of relying on 10 um separations a depth buffer
  // cannot resolve at preview zoom.
  const padCenterY = maskTopY - PAD_BOTTOM_EMBED_MM + PAD_THICKNESS_MM / 2

  const bottomCopper = scene.layers.find((layer) => layer.kind === 'copper' && layer.side === 'bottom')
  const bottomMask = scene.layers.find((layer) => layer.kind === 'mask' && layer.side === 'bottom')
  const maskBottomY = board.bottomSurfaceYMm
    - (bottomCopper?.thicknessMm ?? 0.035)
    - (bottomMask?.thicknessMm ?? SOLDERMASK_MM)
  const padCenterYBottom = maskBottomY + PAD_BOTTOM_EMBED_MM - PAD_THICKNESS_MM / 2

  if (options.showPCB) {
    const relief = createMaskReliefTexture()
    const fr4 = new THREE.MeshStandardMaterial({ color: '#b3a06c', roughness: 0.86, metalness: 0.02 })
    const maskMaterial = new THREE.MeshPhysicalMaterial({
      color: mask.baseColor,
      roughness: mask.roughness,
      metalness: 0.03,
      clearcoat: mask.clearcoat,
      clearcoatRoughness: mask.clearcoatRoughness,
      // The studio environment is what lights the copper and the mouldings, but a
      // full-strength reflection turns a large board into a mirror-green wash. Mask
      // is a pigmented lacquer: it should catch a broad, dim sheen, not a highlight.
      envMapIntensity: 0.45,
      // Only a browser that gave us a canvas has relief to lay down; three warns
      // on an explicitly undefined texture.
      ...(relief ? { bumpMap: relief, bumpScale: 0.35 } : {}),
    })
    const substrate = new THREE.Mesh(boardSlabGeometry(board.widthMm, board.heightMm, board.thicknessMm), [maskMaterial, fr4])
    substrate.name = 'pcb-substrate'
    substrate.receiveShadow = true
    substrate.castShadow = true
    group.add(substrate)

    if (topMask && !options.hiddenLayerIds.has(topMask.id)) {
      const overlay = new THREE.Mesh(
        flatRoundedGeometry(board.widthMm - 0.2, board.heightMm - 0.2),
        new THREE.MeshPhysicalMaterial({
          color: mask.overlayColor,
          roughness: Math.min(0.72, mask.roughness * 1.1),
          metalness: 0.05,
          transparent: true,
          opacity: MASK_OVERLAY_OPACITY,
          depthWrite: false,
          // This film covers the whole board, so its clearcoat is the one the eye
          // reads. Stacking it *on top of* the substrate's own coat doubles the
          // highlight into a bright blob; matching the base keeps the finish even
          // where copper breaks through.
          clearcoat: mask.clearcoat * 0.6,
          clearcoatRoughness: Math.min(0.7, mask.clearcoatRoughness * 1.25),
          envMapIntensity: 0.4,
          ...(relief ? { bumpMap: relief, bumpScale: 0.3 } : {}),
        }),
      )
      overlay.name = 'soldermask-overlay'
      overlay.rotation.x = -Math.PI / 2
      overlay.position.y = maskTopY
      overlay.userData.excludeFromExport = true
      group.add(overlay)
    }

    const silkLayer = scene.layers.find((layer) => layer.kind === 'silk')
    if (silkLayer && !options.hiddenLayerIds.has(silkLayer.id)) {
      const texture = createSilkscreenTexture(scene, 'top')
      if (texture) {
        const artwork = new THREE.Mesh(
          new THREE.PlaneGeometry(board.widthMm, board.heightMm),
          new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            alphaTest: 0.02,
            depthWrite: false,
            toneMapped: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
          }),
        )
        artwork.name = 'silkscreen-top'
        artwork.rotation.x = -Math.PI / 2
        artwork.position.y = silkLayer.yMm + silkLayer.thicknessMm / 2
        artwork.renderOrder = 2
        artwork.userData.excludeFromExport = true
        group.add(artwork)
      }
    }
  }

  if (options.showTraces) {
    // Poured planes first: their copper sits at the layer plane and the routed
    // segments and vias land on top of it, exactly as they do on the board.
    const dielectricMaterial = new THREE.MeshStandardMaterial({
      color: KEEPOUT_DIELECTRIC,
      roughness: 0.5,
    })
    for (const pour of scene.pours) {
      if (options.hiddenLayerIds.has(pour.layerId)) continue
      const layer = scene.layers.find((candidate) => candidate.id === pour.layerId)
      const thickness = layer?.thicknessMm ?? 0.035
      const plane = new THREE.Mesh(pourPlaneShape(pour, thickness), traceMaterialFor(pour.layerId))
      plane.name = `pour-${pour.id}`
      plane.position.y = pour.yMm
      plane.receiveShadow = true
      group.add(plane)
      addBuiltMesh(
        group,
        pourKeepoutGeometry(pour, thickness),
        `pour-keepouts-${pour.id}`,
        dielectricMaterial,
        { excludeFromExport: true },
      )
    }

    for (const [layerId, paths] of ribbonPathsByLayer(scene.traces, options.hiddenLayerIds)) {
      const layer = scene.layers.find((candidate) => candidate.id === layerId)
      addBuiltMesh(
        group,
        layerCopperGeometry(paths, layer?.yMm ?? 0, layer?.thicknessMm ?? 0.035),
        `trace-copper-${layerId}`,
        traceMaterialFor(layerId),
        { receiveShadow: true },
      )
    }

    // One buffer each for every barrel, drill and mask opening on the board. The
    // mainboard stitches 485 vias: as individual meshes that was 1 940 draw calls
    // and 970 copies of one material for three shapes.
    if (scene.vias.length > 0) {
      const barrels = new SolidBuilder()
      const drills = new SolidBuilder()
      const openingsTop = new SolidBuilder()
      const openingsBottom = new SolidBuilder()
      for (const via of scene.vias) {
        const center = { x: via.position.x, z: via.position.z }
        barrels.prism(
          circleSection(via.padDiameterMm / 2, 20),
          -via.heightMm / 2,
          via.heightMm / 2,
          center,
        )
        drills.prism(
          circleSection(via.drillDiameterMm / 2, 16),
          -(via.heightMm + 0.08) / 2,
          (via.heightMm + 0.08) / 2,
          center,
        )
        // The mask opening the drill leaves in the film, on each face's own mask
        // height. Mirroring the top film onto the bottom put it in the wrong place
        // on a stackup whose outer layers are not symmetric.
        const openingRadius = via.drillDiameterMm / 2 + 0.12
        const section = circleSection(openingRadius, 12)
        openingsTop.prism(section, maskTopY - 0.004, maskTopY + 0.004, center)
        openingsBottom.prism(section, maskBottomY - 0.004, maskBottomY + 0.004, center)
      }
      addBuiltMesh(group, barrels.geometry(), 'via-barrels', padMaterial, { receiveShadow: true })
      addBuiltMesh(group, drills.geometry(), 'via-drills', drillMaterial)
      addBuiltMesh(group, openingsTop.geometry(), 'via-mask-openings-top', dielectricMaterial, {
        excludeFromExport: true,
      })
      addBuiltMesh(group, openingsBottom.geometry(), 'via-mask-openings-bottom', dielectricMaterial, {
        excludeFromExport: true,
      })
    }
  }

  // Copper lands belong to the board, not to the component body toggle.
  if (options.showTraces || options.showComponents) {
    for (const component of scene.components) {
      if (options.hiddenComponentIds.has(component.id)) continue
      const onTop = component.side !== 'bottom'
      for (const pad of component.pads) {
        addPad(
          group,
          pad,
          component.rotationYDeg,
          padMaterial,
          drillMaterial,
          onTop ? padCenterY : padCenterYBottom,
          onTop ? 1 : -1,
        )
      }
    }
  }

  if (options.showComponents) {
    for (const component of scene.components) {
      if (options.hiddenComponentIds.has(component.id)) continue
      addComponentBody(
        group,
        component,
        componentMaterial(component),
        padMaterial,
        leadMaterial,
      )
    }
  }

  applyComponentScale(group, options.componentScale ?? 1)
  // Shading belongs to what the options describe, so a group asked for as an
  // outline already is one when it is handed over. The viewer swaps the whole
  // group rather than remembering to paint the replacement.
  if (options.shading === 'outline') applyOutlineShading(group)
  return group
}

function addPad(
  group: THREE.Group,
  pad: PcbScenePad,
  rotationDeg: number,
  padMaterial: THREE.Material,
  drillMaterial: THREE.Material,
  centerY: number,
  /** +1 for a top-side land (barrel opening faces up), -1 for a bottom-side one. */
  face = 1,
): void {
  // A land's shape is a shared shape: the mainboard's 615 copper lands come from
  // a few dozen distinct footprints, and each of them used to carry its own
  // geometry and its own entry in the shadow map for 45 um of thickness.
  let geometry: THREE.BufferGeometry
  if (pad.shape === 'circle') {
    geometry = circleShape(pad.widthMm / 2, PAD_THICKNESS_MM, 20)
  } else {
    const radius = Math.min(0.1, pad.widthMm * 0.25, pad.depthMm * 0.25, PAD_THICKNESS_MM * 0.45)
    geometry = roundedBox(pad.widthMm, PAD_THICKNESS_MM, pad.depthMm, radius)
  }
  const mesh = new THREE.Mesh(geometry, padMaterial)
  mesh.name = `pad-${pad.id}`
  mesh.position.set(pad.position.x, centerY, pad.position.z)
  mesh.rotation.y = degToRad(rotationDeg)
  group.add(mesh)

  if (pad.drillMm && pad.drillMm > 0) {
    // Open barrel seen from above: a dark disc flush with the copper land, not
    // a black peg poking out of the board.
    const drill = new THREE.Mesh(
      circleShape(pad.drillMm / 2, 0.008, 16),
      drillMaterial,
    )
    drill.name = `pad-drill-${pad.id}`
    drill.position.set(
      pad.position.x,
      centerY + face * (PAD_THICKNESS_MM / 2 + 0.008),
      pad.position.z,
    )
    group.add(drill)
  }
}
