/**
 * Schematic sheet -> physical board.
 *
 * The PCB panel and the agent tools must place and route the same board, or an
 * agent's "route" would produce copper the human cannot see. This module owns
 * that pipeline: schematic units to board millimetres, the auto-sized outline,
 * net extraction, the autorouter configuration, and the conversion of the
 * router's output to the `PcbSceneInput` the 2D canvas and 3D preview consume.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import type { Net, PlacedComponent, Wire } from '../../types'
import { resolveFootprint } from '../manufacturing/footprintLibrary'
import {
  autoroute,
  buildRouterPads,
  type RouterConfig,
  type RouterPad,
  type RouterResult,
} from '../manufacturing/autorouter'
import type { PcbSceneInput, PcbSceneInputLayer } from './pcbScene'

/** Schematic drawing units per board millimetre. */
export const SCHEMATIC_UNITS_PER_MM = 10
/** Clearance between the package extent and the board outline. */
export const BOARD_MARGIN_MM = 5

/** Grid and rule set shared by the panel's button and `eda.route`. */
export const BOARD_ROUTER_DEFAULTS = {
  gridMm: 0.5,
  minTraceWidthMm: 0.2,
  minSpacingMm: 0.2,
  viaDrillMm: 0.3,
  viaPadMm: 0.6,
  viaPenalty: 8,
} as const

export const BOARD_SCENE_LAYERS: PcbSceneInputLayer[] = [
  { id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000', visible: true, thicknessMm: 0.035, side: 'top' },
  { id: 'in1-cu', name: 'Inner 1 (GND)', kind: 'copper', color: '#009900', visible: true, thicknessMm: 0.035, side: 'top' },
  { id: 'in2-cu', name: 'Inner 2 (PWR)', kind: 'copper', color: '#0000cc', visible: true, thicknessMm: 0.035, side: 'top' },
  { id: 'bot-cu', name: 'Bottom Copper', kind: 'copper', color: '#ffaa00', visible: true, thicknessMm: 0.035, side: 'bottom' },
  { id: 'top-silk', name: 'Top Silkscreen', kind: 'silk', color: '#ffffff', visible: true, thicknessMm: 0.01, side: 'top' },
  { id: 'top-mask', name: 'Top Soldermask', kind: 'mask', color: '#008800', visible: true, thicknessMm: 0.01, side: 'top' },
  { id: 'bot-mask', name: 'Bottom Soldermask', kind: 'mask', color: '#004400', visible: false, thicknessMm: 0.01, side: 'bottom' },
]

export interface PackageBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface BoardSize {
  width: number
  height: number
}

export interface BoardPlacement {
  components: PlacedComponent[]
  size: BoardSize
}

/** Outline of every real package, rotated footprint included. Ground
 *  symbols annotate a net and have no body, so they do not grow the board. */
export function packageBounds(components: readonly PlacedComponent[]): PackageBounds | null {
  const packages = components.filter((component) => component.component.name !== 'Ground')
  if (packages.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const placedPart of packages) {
    const footprint = resolveFootprint(
      String(placedPart.properties.footprint ?? placedPart.component.name),
      typeof placedPart.component.category === 'string' ? placedPart.component.category : undefined,
    )
    const halfWidth = (footprint?.dimensions.width ?? 2) / 2
    const halfDepth = (footprint?.dimensions.height ?? 1) / 2
    const quarterTurn = ((placedPart.rotation % 180) + 180) % 180 === 90
    const extentX = quarterTurn ? halfDepth : halfWidth
    const extentY = quarterTurn ? halfWidth : halfDepth
    minX = Math.min(minX, placedPart.position.x - extentX)
    maxX = Math.max(maxX, placedPart.position.x + extentX)
    minY = Math.min(minY, placedPart.position.y - extentY)
    maxY = Math.max(maxY, placedPart.position.y + extentY)
  }
  return { minX, minY, maxX, maxY }
}

/**
 * Outline for a schematic that has never been laid out: the smallest
 * rectangular board that holds every real package, with routing room around
 * it. A 100 x 80 default would leave a five-part circuit marooned in one
 * corner and give the 3D preview an empty green field.
 */
export function autoBoardSize(components: readonly PlacedComponent[]): BoardSize {
  const bounds = packageBounds(components)
  if (!bounds) return { width: 100, height: 80 }
  // 8 mm keeps silkscreen and a ground pour clear of the outline; 5 mm
  // increments match the way board outlines are normally specified.
  const roundUp = (value: number) => Math.ceil(value / 5) * 5
  return {
    width: Math.max(40, roundUp(bounds.maxX - bounds.minX + 8)),
    height: Math.max(20, roundUp(bounds.maxY - bounds.minY + 8)),
  }
}

/** Map the live sheet onto board millimetres and centre it in its outline.
 *  Ground symbols annotate a net; they have no package and must not become a
 *  placed part, a router pad, or a fab BOM line. */
export function placeSchematicOnBoard(
  components: readonly CanvasComponent[],
  sizeOverride?: BoardSize,
): BoardPlacement {
  const mapped: PlacedComponent[] = components
    .filter((component) => component.component.name !== 'Ground')
    .map((component) => ({
    id: component.id,
    componentId: component.componentId,
    component: {
      id: component.component.id ?? component.componentId,
      name: component.component.name,
      category: typeof component.component.category === 'string' ? component.component.category : 'passive',
      symbol: component.component.symbol_data,
      pins: component.component.pins,
      properties: component.properties,
    },
    position: {
      x: component.x / SCHEMATIC_UNITS_PER_MM + BOARD_MARGIN_MM,
      y: component.y / SCHEMATIC_UNITS_PER_MM + BOARD_MARGIN_MM,
    },
    rotation: component.rotation,
    // Symbol geometry is drawn at 10 schematic units per millimetre; the
    // placement was already converted, so the pin offsets must follow.
    scale: 1 / SCHEMATIC_UNITS_PER_MM,
    reference: component.reference,
    properties: component.properties,
  }))
  const bounds = packageBounds(mapped)
  if (!bounds) return { components: mapped, size: sizeOverride ?? { width: 100, height: 80 } }
  const size = sizeOverride ?? autoBoardSize(mapped)
  const dx = (size.width - (bounds.maxX - bounds.minX)) / 2 - bounds.minX
  const dy = (size.height - (bounds.maxY - bounds.minY)) / 2 - bounds.minY
  return {
    components: mapped.map((component) => ({
      ...component,
      position: { x: component.position.x + dx, y: component.position.y + dy },
    })),
    size,
  }
}

/**
 * The board a routed layout describes, with the sheet's symbol and BOM data
 * kept intact. Positions come from the layout, never from the schematic
 * mapping, so every exported pad lands on the copper the user sees.
 */
export function placeFromRoutedLayout(
  components: readonly CanvasComponent[],
  layout: PcbSceneInput,
): BoardPlacement {
  const placement = placeSchematicOnBoard(components)
  const byId = new Map(layout.components.map((component) => [component.id, component]))
  const byReference = new Map(layout.components.map((component) => [component.reference, component]))
  return {
    components: placement.components.map((component) => {
      const routed = byId.get(component.id) ?? byReference.get(component.reference)
      if (!routed) return component
      return {
        ...component,
        position: { x: routed.x, y: routed.y },
        rotation: routed.rotationDeg ?? component.rotation,
      }
    }),
    size: { width: layout.widthMm, height: layout.heightMm },
  }
}

/** Nets named by the sheet's wires, the same grouping the router consumes. */
export function netsFromWires(wires: readonly CanvasWire[]): Net[] {
  const netsById = new Map<string, Net>()
  wires.forEach((wire, index) => {
    const id = wire.netName || `NET${index}`
    const net = netsById.get(id) ?? { id, name: id, connectedPins: [], wires: [] }
    net.connectedPins.push(...(wire.connectedPins ?? []))
    net.wires.push(wire.id)
    netsById.set(id, net)
  })
  return Array.from(netsById.values())
}

export interface BoardRouting {
  nets: Net[]
  pads: RouterPad[]
  result: RouterResult
}

/** Route the placed board with the shared grid and rule defaults. */
export function routePlacedBoard(
  components: readonly PlacedComponent[],
  wires: readonly CanvasWire[],
  size: BoardSize,
  overrides: Partial<RouterConfig> = {},
): BoardRouting {
  const nets = netsFromWires(wires)
  const pads = buildRouterPads([...components], nets)
  const result = autoroute(pads, {
    boardWidthMm: size.width,
    boardHeightMm: size.height,
    layers: ['F.Cu', 'B.Cu'],
    ...BOARD_ROUTER_DEFAULTS,
    ...overrides,
  })
  return { nets, pads, result }
}

/** Router output in board coordinates -> the scene the canvas and 3D read. */
export function sceneFromRouting(
  components: readonly PlacedComponent[],
  size: BoardSize,
  routing: BoardRouting,
): PcbSceneInput {
  return {
    widthMm: size.width,
    heightMm: size.height,
    thicknessMm: 1.6,
    copperThicknessMm: 0.035,
    layers: BOARD_SCENE_LAYERS.map((layer) => ({ ...layer })),
    traces: routing.result.traces.map((trace, index) => ({
      id: `trace_${index}`,
      net: trace.netId,
      layerId: trace.layerId === 'B.Cu' ? 'bot-cu' : 'top-cu',
      widthMm: trace.widthMm,
      points: trace.points.map((point) => ({ ...point })),
    })),
    vias: routing.result.vias.map((via, index) => ({
      id: `via_${index}`,
      net: via.netId,
      x: via.x,
      y: via.y,
      padDiameterMm: via.padMm,
      drillDiameterMm: via.drillMm,
    })),
    components: components.map((component) => ({
      id: component.id,
      reference: component.reference,
      footprint: String(component.properties.footprint ?? component.component.name),
      category: typeof component.component.category === 'string' ? component.component.category : undefined,
      x: component.position.x,
      y: component.position.y,
      rotationDeg: component.rotation,
      side: 'top',
    })),
  }
}

export interface RoutedCopper {
  id: string
  points: Array<{ x: number; y: number }>
  width: number
  netName?: string
}

/** Routed copper as `Wire`s, the shape the fab exporter gates and emits. */
export function wiresFromRoutedTraces(traces: readonly RoutedCopper[]): Wire[] {
  return traces.map((trace) => ({
    id: trace.id,
    points: trace.points.map((point) => ({ ...point })),
    netName: trace.netName,
    connectedPins: [],
    style: { width: trace.width },
  }))
}

export interface RoutedViaCopper {
  x: number
  y: number
  drillDiameterMm: number
  padDiameterMm: number
  netName?: string
}
