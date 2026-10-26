/**
 * Board-coordinate -> scene-coordinate conversion for the 3D PCB preview.
 *
 * The 3D viewer used to draw schematic widgets on a fixed 60 x 53 mm slab.
 * This module turns the board the designer actually routed (outline, copper
 * layers, traces, vias, footprint bodies) into millimetre geometry the
 * renderer and the STL/OBJ exporters can both consume, so the preview cannot
 * drift from the layout. Board X/Y map to scene X/Z (Y is up), centred on the
 * origin, and every warning names the element that falls outside the outline
 * instead of silently clamping it.
 */
import { resolveFootprint } from '../manufacturing/footprintLibrary'

export interface PcbSceneInputLayer {
  id: string
  name: string
  /** `copper` layers carry traces; mask/silk only contribute surfaces. */
  kind: 'copper' | 'mask' | 'silk'
  color: string
  visible?: boolean
  thicknessMm?: number
  side?: 'top' | 'bottom'
}

export interface PcbSceneInputTrace {
  id: string
  net: string
  layerId: string
  widthMm: number
  points: Array<{ x: number; y: number }>
}

export interface PcbSceneInputVia {
  id: string
  net?: string
  x: number
  y: number
  padDiameterMm: number
  drillDiameterMm: number
}

export interface PcbSceneInputComponent {
  id: string
  reference: string
  /** Footprint id, footprint name, or component category — resolved in that order. */
  footprint: string
  category?: string
  /** Board coordinates in millimetres, origin at the top-left of the outline. */
  x: number
  y: number
  rotationDeg?: number
  side?: 'top' | 'bottom'
}

export interface PcbSceneInput {
  widthMm: number
  heightMm: number
  thicknessMm: number
  copperThicknessMm?: number
  layers: PcbSceneInputLayer[]
  traces: PcbSceneInputTrace[]
  vias: PcbSceneInputVia[]
  components: PcbSceneInputComponent[]
}

export interface PcbSceneVec3 {
  x: number
  y: number
  z: number
}

export interface PcbSceneBoard {
  widthMm: number
  heightMm: number
  thicknessMm: number
  /** Scene-space centre of the substrate. */
  center: PcbSceneVec3
  topSurfaceYMm: number
  bottomSurfaceYMm: number
}

export interface PcbSceneLayer {
  id: string
  name: string
  kind: 'copper' | 'mask' | 'silk'
  color: string
  visible: boolean
  thicknessMm: number
  /** Scene Y where the layer's mid-plane sits. */
  yMm: number
  /** Cosmetic layers only: which board face the film sits on. */
  side?: 'top' | 'bottom'
}

export interface PcbSceneTraceSegment {
  id: string
  traceId: string
  net: string
  layerId: string
  widthMm: number
  lengthMm: number
  start: PcbSceneVec3
  end: PcbSceneVec3
  /** Rotation about +Y that aligns a length-along-X box with the segment. */
  rotationYDeg: number
}

export interface PcbSceneVia {
  id: string
  net: string
  position: PcbSceneVec3
  padDiameterMm: number
  drillDiameterMm: number
  /** Via barrels span the full board thickness plus copper. */
  heightMm: number
}

export interface PcbScenePad {
  id: string
  shape: 'circle' | 'rectangle' | 'oval'
  position: PcbSceneVec3
  widthMm: number
  depthMm: number
  drillMm?: number
}

export interface PcbSceneComponent {
  id: string
  reference: string
  footprintId: string
  footprintName: string
  category: string
  side: 'top' | 'bottom'
  position: PcbSceneVec3
  rotationYDeg: number
  bodyWidthMm: number
  bodyDepthMm: number
  bodyHeightMm: number
  bodyShape: 'box' | 'cylinder'
  color: string
  pads: PcbScenePad[]
  onBoard: boolean
}

export interface PcbSceneWarning {
  code:
    | 'trace-outside-board'
    | 'via-outside-board'
    | 'component-outside-board'
    | 'unknown-footprint'
    | 'empty-board'
  message: string
  elementId?: string
}

export interface PcbScene {
  board: PcbSceneBoard
  layers: PcbSceneLayer[]
  traces: PcbSceneTraceSegment[]
  vias: PcbSceneVia[]
  components: PcbSceneComponent[]
  warnings: PcbSceneWarning[]
  counts: {
    copperLayers: number
    traces: number
    segments: number
    vias: number
    components: number
    pads: number
  }
}

/** Body height above the board per footprint family (mm). */
const CATEGORY_BODY_HEIGHT_MM: Record<string, number> = {
  resistor: 0.55,
  capacitor: 0.8,
  semiconductor: 1.0,
  ic: 1.6,
  connector: 2.6,
  inductor: 1.2,
  crystal: 0.9,
  switch: 2.0,
}

const COMPONENT_COLORS: Record<string, string> = {
  resistor: '#2b2b2b',
  capacitor: '#8a6d3b',
  semiconductor: '#1f1f1f',
  ic: '#111111',
  connector: '#c9a227',
  inductor: '#4a4a4a',
  crystal: '#9aa0a6',
  switch: '#555555',
}

const EPSILON_MM = 1e-6

function assertPositive(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number, got ${value}.`)
  }
}

function insideBoard(x: number, y: number, width: number, height: number): boolean {
  return (
    x >= -EPSILON_MM &&
    y >= -EPSILON_MM &&
    x <= width + EPSILON_MM &&
    y <= height + EPSILON_MM
  )
}

/**
 * Assign scene Y to every declared layer. Copper stacks outward from the
 * substrate; the first declared copper layer is the top copper, the last is
 * the bottom copper, and inner layers are distributed between them (mirrored
 * for odd counts so a single inner layer lands at the mid-plane).
 */
export function stackLayers(
  layers: PcbSceneInputLayer[],
  thicknessMm: number,
  copperThicknessMm: number,
): PcbSceneLayer[] {
  const substrateHalf = thicknessMm / 2
  const copper = layers.filter((layer) => layer.kind === 'copper')
  const copperCount = copper.length
  const placed = new Map<string, number>()

  copper.forEach((layer, index) => {
    const thickness = layer.thicknessMm ?? copperThicknessMm
    if (copperCount === 1) {
      placed.set(layer.id, substrateHalf + thickness / 2)
      return
    }
    // index 0 -> top, last -> bottom, remainder spread uniformly through the
    // board. Position is expressed as a fraction from top to bottom.
    const fraction = index / (copperCount - 1)
    placed.set(layer.id, substrateHalf - fraction * (thicknessMm + copperThicknessMm) + thickness / 2)
  })

  let maskTopY = substrateHalf + copperThicknessMm
  let maskBottomY = -substrateHalf - copperThicknessMm

  // Cosmetic films are stacked by material, not by declaration order: every
  // mask goes on the copper, then silkscreen is printed on the outermost mask.
  // Reading the array front-to-back let a silk listed before its mask float
  // 25 um above the mask with a gap under it.
  const cosmeticY = new Map<string, number>()
  for (const layer of layers) {
    if (layer.kind !== 'mask') continue
    const thickness = layer.thicknessMm ?? 0.025
    const bottom = layer.side === 'bottom'
    const yMm = bottom
      ? maskBottomY - thickness / 2
      : maskTopY + thickness / 2
    cosmeticY.set(layer.id, yMm)
    if (bottom) maskBottomY = yMm - thickness / 2
    else maskTopY = yMm + thickness / 2
  }
  let silkTopY = maskTopY
  let silkBottomY = maskBottomY
  for (const layer of layers) {
    if (layer.kind !== 'silk') continue
    const thickness = layer.thicknessMm ?? 0.01
    const bottom = layer.side === 'bottom'
    const yMm = bottom
      ? silkBottomY - thickness / 2
      : silkTopY + thickness / 2
    cosmeticY.set(layer.id, yMm)
    if (bottom) silkBottomY = yMm - thickness / 2
    else silkTopY = yMm + thickness / 2
  }

  return layers.map((layer) => {
    const thickness = layer.thicknessMm ?? (
      layer.kind === 'copper' ? copperThicknessMm : layer.kind === 'mask' ? 0.025 : 0.01
    )
    let yMm: number
    if (layer.kind === 'copper') {
      yMm = placed.get(layer.id) ?? substrateHalf + thickness / 2
    } else {
      yMm = cosmeticY.get(layer.id) ?? (layer.side === 'bottom' ? -substrateHalf : substrateHalf)
    }
    return {
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      color: layer.color,
      visible: layer.visible ?? true,
      thicknessMm: thickness,
      yMm,
      side: layer.side ?? (layer.kind === 'copper' ? (yMm < 0 ? 'bottom' : 'top') : undefined),
    }
  })
}

/** Build millimetre scene geometry from a routed board. */
export function buildPcbScene(input: PcbSceneInput): PcbScene {
  assertPositive(input.widthMm, 'Board width')
  assertPositive(input.heightMm, 'Board height')
  assertPositive(input.thicknessMm, 'Board thickness')

  const width = input.widthMm
  const height = input.heightMm
  const thickness = input.thicknessMm
  const copperThickness = input.copperThicknessMm ?? 0.035
  if (!Number.isFinite(copperThickness) || copperThickness <= 0) {
    throw new Error(`Copper thickness must be positive, got ${copperThickness}.`)
  }

  const warnings: PcbSceneWarning[] = []
  const layers = stackLayers(input.layers, thickness, copperThickness)
  const layerById = new Map(layers.map((layer) => [layer.id, layer]))

  const toScene = (x: number, y: number, yMm = 0): PcbSceneVec3 => ({
    x: x - width / 2,
    y: yMm,
    z: y - height / 2,
  })

  const traces: PcbSceneTraceSegment[] = []
  for (const trace of input.traces) {
    const layer = layerById.get(trace.layerId)
    if (!layer || layer.kind !== 'copper') {
      // A trace on a layer that is not copper cannot be manufactured; report
      // it rather than drawing copper in mid-air.
      warnings.push({
        code: 'trace-outside-board',
        elementId: trace.id,
        message: `Trace ${trace.id} references non-copper layer "${trace.layerId}" and is not drawn.`,
      })
      continue
    }
    const widthMm = Number.isFinite(trace.widthMm) && trace.widthMm > 0 ? trace.widthMm : 0.2
    for (let index = 0; index + 1 < trace.points.length; index += 1) {
      const from = trace.points[index]
      const to = trace.points[index + 1]
      if (!Number.isFinite(from.x) || !Number.isFinite(from.y) || !Number.isFinite(to.x) || !Number.isFinite(to.y)) {
        warnings.push({
          code: 'trace-outside-board',
          elementId: trace.id,
          message: `Trace ${trace.id} has a non-finite point and is not drawn.`,
        })
        continue
      }
      if (
        !insideBoard(from.x, from.y, width, height) ||
        !insideBoard(to.x, to.y, width, height)
      ) {
        warnings.push({
          code: 'trace-outside-board',
          elementId: trace.id,
          message: `Trace ${trace.id} extends outside the ${width} x ${height} mm outline.`,
        })
      }
      const dx = to.x - from.x
      const dz = to.y - from.y
      const lengthMm = Math.hypot(dx, dz)
      if (lengthMm <= EPSILON_MM) continue
      traces.push({
        id: `${trace.id}-${index}`,
        traceId: trace.id,
        net: trace.net,
        layerId: trace.layerId,
        widthMm,
        lengthMm,
        start: toScene(from.x, from.y, layer.yMm),
        end: toScene(to.x, to.y, layer.yMm),
        rotationYDeg: (-Math.atan2(dz, dx) * 180) / Math.PI,
      })
    }
  }

  const vias: PcbSceneVia[] = input.vias
    .filter((via) => {
      if (!Number.isFinite(via.x) || !Number.isFinite(via.y)) {
        warnings.push({
          code: 'via-outside-board',
          elementId: via.id,
          message: `Via ${via.id} has a non-finite position and is not drawn.`,
        })
        return false
      }
      if (!insideBoard(via.x, via.y, width, height)) {
        warnings.push({
          code: 'via-outside-board',
          elementId: via.id,
          message: `Via ${via.id} lies outside the ${width} x ${height} mm outline.`,
        })
      }
      return true
    })
    .map((via) => ({
      id: via.id,
      net: via.net ?? '',
      position: toScene(via.x, via.y, 0),
      padDiameterMm: Number.isFinite(via.padDiameterMm) && via.padDiameterMm > 0 ? via.padDiameterMm : 0.6,
      drillDiameterMm: Number.isFinite(via.drillDiameterMm) && via.drillDiameterMm > 0 ? via.drillDiameterMm : 0.3,
      heightMm: thickness + copperThickness * 2,
    }))

  const components: PcbSceneComponent[] = input.components.map((component) => {
    const footprint = resolveFootprint(component.footprint, component.category)
    if (!footprint) {
      warnings.push({
        code: 'unknown-footprint',
        elementId: component.id,
        message: `No footprint "${component.footprint}" for ${component.reference}; using a 2 x 1 mm body.`,
      })
    }
    const bodyWidth = footprint?.dimensions.width ?? 2
    const bodyDepth = footprint?.dimensions.height ?? 1
    const category = footprint?.category ?? component.category ?? 'ic'
    const bodyHeight = footprint?.bodyHeightMm ?? CATEGORY_BODY_HEIGHT_MM[category] ?? 1.0
    const side = component.side ?? 'top'
    const rotationDeg = component.rotationDeg ?? 0
    const radians = (rotationDeg * Math.PI) / 180
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    const onBoard = insideBoard(component.x, component.y, width, height)
    if (!onBoard) {
      warnings.push({
        code: 'component-outside-board',
        elementId: component.id,
        message: `${component.reference} sits outside the ${width} x ${height} mm outline.`,
      })
    }

    const surfaceY = side === 'top'
      ? thickness / 2 + copperThickness
      : -thickness / 2 - copperThickness
    const centerY = surfaceY + (side === 'top' ? bodyHeight / 2 : -bodyHeight / 2)

    const pads: PcbScenePad[] = (footprint?.pads ?? []).map((pad) => {
      const px = pad.position.x * cos - pad.position.y * sin
      const py = pad.position.x * sin + pad.position.y * cos
      return {
        id: `${component.id}-${pad.id}`,
        shape: pad.shape,
        position: toScene(component.x + px, component.y + py, surfaceY),
        widthMm: pad.size.width,
        depthMm: pad.size.height,
        drillMm: pad.drillDiameter,
      }
    })

    return {
      id: component.id,
      reference: component.reference,
      footprintId: footprint?.id ?? component.footprint,
      footprintName: footprint?.name ?? component.footprint,
      category,
      side,
      position: toScene(component.x, component.y, centerY),
      rotationYDeg: rotationDeg,
      bodyWidthMm: bodyWidth,
      bodyDepthMm: bodyDepth,
      bodyHeightMm: bodyHeight,
      bodyShape: category === 'capacitor' && bodyWidth > 4 ? 'cylinder' : 'box',
      color: COMPONENT_COLORS[category] ?? '#4b5563',
      pads,
      onBoard,
    }
  })

  if (
    input.traces.length === 0 &&
    input.vias.length === 0 &&
    input.components.length === 0
  ) {
    warnings.push({
      code: 'empty-board',
      message: 'The board outline has no routed copper, vias or components yet.',
    })
  }

  return {
    board: {
      widthMm: width,
      heightMm: height,
      thicknessMm: thickness,
      center: { x: 0, y: 0, z: 0 },
      topSurfaceYMm: thickness / 2,
      bottomSurfaceYMm: -thickness / 2,
    },
    layers,
    traces,
    vias,
    components,
    warnings,
    counts: {
      copperLayers: layers.filter((layer) => layer.kind === 'copper').length,
      traces: input.traces.length,
      segments: traces.length,
      vias: vias.length,
      components: components.length,
      pads: components.reduce((total, component) => total + component.pads.length, 0),
    },
  }
}
