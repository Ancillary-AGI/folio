import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { PcbScene, PcbSceneComponent, PcbScenePad, PcbSceneTraceSegment } from './pcbScene'

export interface PcbBoardGroupOptions {
  showPCB: boolean
  showTraces: boolean
  showComponents: boolean
  hiddenLayerIds: ReadonlySet<string>
  hiddenComponentIds: ReadonlySet<string>
  componentScale: number
  /** Soldermask lacquer chosen for the preview; defaults to the classic green. */
  maskColor?: PcbMaskColor
  /** Surface finish that sets the exposed-copper metal; defaults to ENIG. */
  padFinish?: PcbPadFinish
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
  green: { label: 'Green', baseColor: '#0b5c35', overlayColor: '#0d6b3e', roughness: 0.5, clearcoat: 0.3, clearcoatRoughness: 0.45 },
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

const BOARD_CORNER_MM = 2.2
const PAD_THICKNESS_MM = 0.045
const PAD_BOTTOM_EMBED_MM = 0.005
const MASK_OVERLAY_OPACITY = 0.46
/** Soldermask film thickness. Copper sits below this, pads break through it. */
const SOLDERMASK_MM = 0.025

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

function roundedBox(width: number, height: number, depth: number, radius = 0.1): RoundedBoxGeometry {
  const safeRadius = Math.max(0.001, Math.min(radius, width / 2, height / 2, depth / 2))
  return new RoundedBoxGeometry(Math.max(0.01, width), Math.max(0.01, height), Math.max(0.01, depth), 2, safeRadius)
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
  for (let index = 0; index < image.data.length; index += 4) {
    const value = 118 + Math.round(Math.random() * 38)
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
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, width), material)
  mesh.name = name
  mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2)
  mesh.rotation.y = -Math.atan2(dz, dx)
  mesh.castShadow = true
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
function createSilkscreenTexture(scene: PcbScene, side: 'top' | 'bottom'): THREE.CanvasTexture | null {  if (typeof document === 'undefined') return null
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
  context.font = `600 ${Math.max(9, mm(0.55))}px "Inter", "Segoe UI", Arial, sans-serif`

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

    if (component.category === 'ic' || component.category === 'connector') {
      // Package outline plus the pin-1 chamfer every assembly house expects.
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

  context.font = `700 ${Math.max(10, mm(0.62))}px "Inter", "Segoe UI", Arial, sans-serif`
  context.fillText('FOLIO', mm(3), mm(board.heightMm - 2.2))
  context.font = `500 ${Math.max(8, mm(0.42))}px "Inter", "Segoe UI", Arial, sans-serif`
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

function componentMaterial(component: PcbSceneComponent): THREE.Material {
  const base = new THREE.Color(component.color)
  switch (component.category) {
    case 'ic':
      return new THREE.MeshPhysicalMaterial({
        color: '#141414',
        roughness: 0.46,
        metalness: 0.06,
        clearcoat: 0.25,
        clearcoatRoughness: 0.5,
      })
    case 'semiconductor':
      return new THREE.MeshStandardMaterial({ color: '#161616', roughness: 0.5, metalness: 0.04 })
    case 'crystal':
      return new THREE.MeshStandardMaterial({ color: '#b9bdc4', roughness: 0.24, metalness: 0.88 })
    case 'connector':
      return new THREE.MeshStandardMaterial({ color: '#171717', roughness: 0.62, metalness: 0.02 })
    case 'capacitor':
      return new THREE.MeshStandardMaterial({ color: '#a9793f', roughness: 0.58, metalness: 0.04 })
    case 'inductor':
      return new THREE.MeshStandardMaterial({ color: '#2f3134', roughness: 0.5, metalness: 0.18 })
    default:
      return new THREE.MeshStandardMaterial({
        color: base,
        roughness: 0.52,
        metalness: 0.05,
      })
  }
}

function addTwoTerminalChip(
  model: THREE.Group,
  component: PcbSceneComponent,
  bodyMaterial: THREE.Material,
  terminalMaterial: THREE.Material,
): boolean {
  if (component.pads.length !== 2) return false
  const local = component.pads.map((pad) => toLocal(component, pad.position))
  const span = Math.hypot(local[1].x - local[0].x, local[1].z - local[0].z)
  if (span < 0.2) return false
  const padSize = component.pads[0]
  const alongX = Math.abs(local[1].x - local[0].x) >= Math.abs(local[1].z - local[0].z)
  const terminalLength = alongX ? padSize.widthMm : padSize.depthMm
  const terminalWidth = alongX ? padSize.depthMm : padSize.widthMm
  const bodyLength = Math.max(0.2, span - terminalLength * 0.85)
  const bodyWidth = Math.max(0.15, Math.min(
    alongX ? component.bodyDepthMm : component.bodyWidthMm,
    terminalWidth * 1.12,
  ))
  const height = component.bodyHeightMm
  const body = new THREE.Mesh(
    alongX
      ? roundedBox(bodyLength, height * 0.92, bodyWidth, Math.min(0.09, height * 0.25))
      : roundedBox(bodyWidth, height * 0.92, bodyLength, Math.min(0.09, height * 0.25)),
    bodyMaterial,
  )
  body.name = `body-${component.id}`
  body.position.y = 0
  body.castShadow = true
  model.add(body)

  for (const pad of local) {
    const terminal = new THREE.Mesh(
      alongX
        ? roundedBox(terminalLength, height * 0.98, bodyWidth, 0.05)
        : roundedBox(bodyWidth, height * 0.98, terminalLength, 0.05),
      terminalMaterial,
    )
    terminal.name = `terminal-${component.id}`
    terminal.position.set(pad.x, 0, pad.z)
    terminal.castShadow = true
    model.add(terminal)
  }
  return true
}

function addComponentBody(
  group: THREE.Group,
  component: PcbSceneComponent,
  material: THREE.Material,
  padMaterial: THREE.Material,
  leadMaterial: THREE.Material,
  scale: number,
): void {
  const model = new THREE.Group()
  model.name = `component-${component.id}`
  model.position.set(component.position.x, component.position.y, component.position.z)
  // Layout rotation is clockwise in board coordinates; a Y rotation in three.js
  // is counter-clockwise seen from above, so it takes the negative angle.
  model.rotation.y = -degToRad(component.rotationYDeg)
  model.scale.setScalar(scale)

  const width = component.bodyWidthMm
  const depth = component.bodyDepthMm
  const height = component.bodyHeightMm

  if (component.bodyShape === 'cylinder') {
    const radius = Math.min(width, depth) / 2
    const can = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 28), material)
    can.name = `body-${component.id}`
    can.castShadow = true
    model.add(can)
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.9, radius * 0.9, 0.05, 28),
      leadMaterial,
    )
    cap.position.y = height / 2 + 0.01
    model.add(cap)
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(radius * 0.22, height * 0.72, radius * 0.72),
      new THREE.MeshStandardMaterial({ color: '#dbe2e8', roughness: 0.5 }),
    )
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

  const chipLike =
    (component.category === 'resistor' || component.category === 'capacitor' || component.category === 'inductor') &&
    component.pads.length === 2
  if (chipLike) {
    const built = addTwoTerminalChip(model, component, material, leadMaterial)
    if (built) {
      group.add(model)
      return
    }
  }

  const bodyWidth = component.category === 'ic' ? width * 0.94 : width
  const bodyDepth = component.category === 'ic' ? depth * 0.94 : depth
  const radius = component.category === 'ic' ? 0.1 : 0.14
  const body = new THREE.Mesh(roundedBox(bodyWidth, height, bodyDepth, radius), material)
  body.name = `body-${component.id}`
  body.castShadow = true
  model.add(body)

  if (component.category === 'ic') {
    const dimple = new THREE.Mesh(
      new THREE.SphereGeometry(Math.min(0.22, Math.min(width, depth) * 0.06), 12, 8),
      new THREE.MeshStandardMaterial({ color: '#050505', roughness: 0.35 }),
    )
    dimple.position.set(-width / 2 + width * 0.13, height / 2 - 0.02, -depth / 2 + depth * 0.13)
    model.add(dimple)
  }

  if (component.category === 'semiconductor' && component.pads.length === 2) {
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.12, width * 0.09), height * 1.01, depth * 1.01),
      new THREE.MeshStandardMaterial({ color: '#c8cdd3', roughness: 0.35, metalness: 0.6 }),
    )
    band.position.x = width * 0.3
    model.add(band)
  }

  if (component.category === 'led') {
    const lens = new THREE.Mesh(
      new THREE.SphereGeometry(Math.min(width, depth) * 0.42, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshPhysicalMaterial({
        color: '#e11d48',
        emissive: '#e11d48',
        emissiveIntensity: 0.55,
        transmission: 0.35,
        thickness: 0.6,
        roughness: 0.18,
      }),
    )
    lens.position.y = height / 2
    model.add(lens)
  }

  if (component.category === 'switch') {
    const actuator = new THREE.Mesh(
      new THREE.CylinderGeometry(Math.min(width, depth) * 0.18, Math.min(width, depth) * 0.18, 0.5, 16),
      new THREE.MeshStandardMaterial({ color: '#c8cdd3', roughness: 0.4, metalness: 0.5 }),
    )
    actuator.position.y = height / 2 + 0.25
    model.add(actuator)
  }

  for (const pad of component.pads) {
    const local = toLocal(component, pad.position)
    if (component.category === 'connector') {
      const pin = new THREE.Mesh(
        new THREE.BoxGeometry(0.55, Math.max(0.8, height * 0.7), 0.55),
        padMaterial,
      )
      pin.position.set(local.x, height * 0.35, local.z)
      pin.castShadow = true
      model.add(pin)
      continue
    }
    if (component.category === 'ic' || component.category === 'semiconductor') {
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
 * One continuous flat ribbon per routed trace.
 *
 * Rendering each polyline segment as a capsule turns every vertex into a pinch
 * that reads as a chain of beads. A real trace is a flat-topped ribbon with the
 * same width through its corners, so the segments become overlapping boxes and
 * a copper disc fills each vertex.
 */
function buildTraceGeometry(
  segments: PcbSceneTraceSegment[],
  yMm: number,
  copperThicknessMm: number,
): THREE.BufferGeometry | null {
  if (segments.length === 0) return null
  const parts: THREE.BufferGeometry[] = []
  const y = yMm + copperThicknessMm / 2
  const boxed = new Set<string>()

  for (const segment of segments) {
    if (segment.lengthMm <= 0.01) continue
    const width = Math.max(0.08, segment.widthMm)
    const key = `${segment.start.x.toFixed(3)}:${segment.start.z.toFixed(3)}:${segment.end.x.toFixed(3)}:${segment.end.z.toFixed(3)}:${width}`
    if (boxed.has(key)) continue
    boxed.add(key)

    const box = new THREE.BoxGeometry(segment.lengthMm + width, copperThicknessMm, width)
    box.rotateY(degToRad(segment.rotationYDeg))
    box.translate(
      (segment.start.x + segment.end.x) / 2,
      y,
      (segment.start.z + segment.end.z) / 2,
    )
    parts.push(box)

    for (const point of [segment.start, segment.end]) {
      const joint = new THREE.CylinderGeometry(width / 2, width / 2, copperThicknessMm, 12)
      joint.translate(point.x, y, point.z)
      parts.push(joint)
    }
  }

  if (parts.length === 0) return null
  const merged = mergeGeometries(parts, false)
  for (const part of parts) part.dispose()
  if (!merged) return null
  merged.computeVertexNormals()
  return merged
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

  if (options.showPCB) {
    const relief = createMaskReliefTexture()
    const fr4 = new THREE.MeshStandardMaterial({ color: '#b3a06c', roughness: 0.86, metalness: 0.02 })
    const maskMaterial = new THREE.MeshPhysicalMaterial({
      color: mask.baseColor,
      roughness: mask.roughness,
      metalness: 0.03,
      clearcoat: mask.clearcoat,
      clearcoatRoughness: mask.clearcoatRoughness,
      bumpMap: relief ?? undefined,
      bumpScale: 0.35,
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
          roughness: mask.roughness * 0.92,
          metalness: 0.05,
          transparent: true,
          opacity: MASK_OVERLAY_OPACITY,
          depthWrite: false,
          clearcoat: mask.clearcoat + 0.15,
          clearcoatRoughness: mask.clearcoatRoughness * 0.9,
          bumpMap: relief ?? undefined,
          bumpScale: 0.3,
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
    const traceGroups = new Map<string, { layerId: string; segments: PcbSceneTraceSegment[] }>()
    for (const segment of scene.traces) {
      if (options.hiddenLayerIds.has(segment.layerId)) continue
      const key = `${segment.layerId}::${segment.traceId}`
      const entry = traceGroups.get(key) ?? { layerId: segment.layerId, segments: [] }
      entry.segments.push(segment)
      traceGroups.set(key, entry)
    }

    for (const [, entry] of traceGroups) {
      const layer = scene.layers.find((candidate) => candidate.id === entry.layerId)
      const thickness = layer?.thicknessMm ?? 0.035
      const geometry = buildTraceGeometry(
        entry.segments,
        layer?.yMm ?? entry.segments[0].start.y,
        thickness,
      )
      if (!geometry) continue
      const mesh = new THREE.Mesh(geometry, traceMaterialFor(entry.layerId))
      mesh.name = `trace-${entry.segments[0].traceId}`
      mesh.castShadow = true
      group.add(mesh)
    }

    for (const via of scene.vias) {
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(via.padDiameterMm / 2, via.padDiameterMm / 2, via.heightMm, 20),
        padMaterial,
      )
      barrel.name = `via-${via.id}`
      barrel.position.set(via.position.x, 0, via.position.z)
      barrel.castShadow = true
      group.add(barrel)

      const drill = new THREE.Mesh(
        new THREE.CylinderGeometry(via.drillDiameterMm / 2, via.drillDiameterMm / 2, via.heightMm + 0.08, 16),
        drillMaterial,
      )
      drill.name = `via-drill-${via.id}`
      drill.position.copy(barrel.position)
      group.add(drill)

      for (const side of [1, -1]) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(via.drillDiameterMm / 2, via.drillDiameterMm / 2 + 0.12, 24),
          new THREE.MeshStandardMaterial({ color: '#07351f', roughness: 0.5, side: THREE.DoubleSide }),
        )
        ring.name = `via-mask-${via.id}`
        ring.rotation.x = -Math.PI / 2
        ring.position.set(
          via.position.x,
          side * maskTopY,
          via.position.z,
        )
        ring.userData.excludeFromExport = true
        group.add(ring)
      }
    }
  }

  // Copper lands belong to the board, not to the component body toggle.
  if (options.showTraces || options.showComponents) {
    for (const component of scene.components) {
      if (options.hiddenComponentIds.has(component.id)) continue
      if (component.side !== 'top') continue
      for (const pad of component.pads) {
        addPad(group, pad, component.rotationYDeg, padMaterial, drillMaterial, padCenterY)
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
        options.componentScale,
      )
    }
  }

  group.updateMatrixWorld(true)
  return group
}

function addPad(
  group: THREE.Group,
  pad: PcbScenePad,
  rotationDeg: number,
  padMaterial: THREE.Material,
  drillMaterial: THREE.Material,
  centerY: number,
): void {
  let geometry: THREE.BufferGeometry
  if (pad.shape === 'circle') {
    geometry = new THREE.CylinderGeometry(pad.widthMm / 2, pad.widthMm / 2, PAD_THICKNESS_MM, 20)
  } else {
    const radius = Math.min(0.1, pad.widthMm * 0.25, pad.depthMm * 0.25, PAD_THICKNESS_MM * 0.45)
    geometry = roundedBox(pad.widthMm, PAD_THICKNESS_MM, pad.depthMm, radius)
  }
  const mesh = new THREE.Mesh(geometry, padMaterial)
  mesh.name = `pad-${pad.id}`
  mesh.position.set(pad.position.x, centerY, pad.position.z)
  mesh.rotation.y = degToRad(rotationDeg)
  mesh.castShadow = true
  group.add(mesh)

  if (pad.drillMm && pad.drillMm > 0) {
    // Open barrel seen from above: a dark disc flush with the copper land, not
    // a black peg poking out of the board.
    const drill = new THREE.Mesh(
      new THREE.CylinderGeometry(pad.drillMm / 2, pad.drillMm / 2, 0.008, 16),
      drillMaterial,
    )
    drill.name = `pad-drill-${pad.id}`
    drill.position.set(
      pad.position.x,
      centerY + PAD_THICKNESS_MM / 2 + 0.008,
      pad.position.z,
    )
    group.add(drill)
  }
}
