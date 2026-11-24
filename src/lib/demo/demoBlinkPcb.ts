/**
 * Routed LED-flasher board used by the PCB, 3D and fab stages of the demo.
 *
 * Same contract as the rectifier board: the geometry is not hand-drawn — it
 * takes the tested PUT relaxation-oscillator netlist, scales the symbol pins
 * into board millimetres and runs the real A* autorouter. The resulting
 * traces, vias and placements are expressed as a `PcbSceneInput`, so the
 * 3-D viewer, STL export and fabrication preview all describe the same copper.
 *
 * Board: 80 × 45 mm, 2 layers, grid 0.5 mm. The schematic extent is
 * x 0..660, y 80..460 grid units; scaled by 0.1 mm/unit that is a 63 × 38 mm
 * placement band, centred on this outline.
 */
import type { Net, PlacedComponent } from '../../types'
import type { CanvasComponent } from '../../stores/useProjectStore'
import type { PcbSceneInput } from '../pcb/pcbScene'
import { autoroute, buildRouterPads, type RouterConfig } from '../manufacturing/autorouter'
import { buildBlinkBoard } from './demoBlinkBoard'

export const DEMO_BLINK_PCB_BOARD = {
  widthMm: 80,
  heightMm: 45,
  thicknessMm: 1.6,
  copperThicknessMm: 0.035,
  marginMm: 5,
} as const

/** Schematic symbols are drawn on a 10-unit-per-millimetre grid. */
const MM_PER_SCHEMATIC_UNIT = 0.1
/** Left edge of the placement band, centred horizontally. */
const X_OFFSET_MM = 5
/** Top of the 38 mm placement band, centred vertically. */
const Y_OFFSET_MM = 3.5

export interface DemoPcbTrace {
  id: string
  net: string
  layerId: string
  widthMm: number
  points: Array<{ x: number; y: number }>
}

export interface DemoPcbVia {
  id: string
  net: string
  x: number
  y: number
  drillMm: number
  padMm: number
}

export interface DemoPcb {
  board: typeof DEMO_BLINK_PCB_BOARD
  scene: PcbSceneInput
  traces: DemoPcbTrace[]
  vias: DemoPcbVia[]
  summary: {
    routedNets: number
    totalNets: number
    unrouted: string[]
    vias: number
    traceLengthMm: number
  }
}

function toPlacedComponent(component: CanvasComponent): PlacedComponent {
  return {
    id: component.id,
    componentId: component.componentId,
    component: component.component as unknown as PlacedComponent['component'],
    position: {
      x: component.x * MM_PER_SCHEMATIC_UNIT + X_OFFSET_MM,
      y: (component.y - 80) * MM_PER_SCHEMATIC_UNIT + Y_OFFSET_MM,
    },
    rotation: component.rotation,
    scale: MM_PER_SCHEMATIC_UNIT,
    reference: component.reference,
    properties: component.properties,
  }
}

/** Group wires by net name — one electrical net can be drawn as several wires. */
function netsFromWires(components: CanvasComponent[], wires: ReturnType<typeof buildBlinkBoard>['wires']): Net[] {
  const nets = new Map<string, Net>()
  wires.forEach((wire, index) => {
    const id = wire.netName || `NET${index}`
    const net = nets.get(id) ?? { id, name: id, connectedPins: [], wires: [] }
    net.connectedPins.push(...wire.connectedPins)
    net.wires.push(wire.id)
    nets.set(id, net)
  })
  // Keep only pins that still exist on the sheet.
  const placedIds = new Set(components.map((component) => component.id))
  return Array.from(nets.values()).map((net) => ({
    ...net,
    connectedPins: net.connectedPins.filter((pin) => placedIds.has(pin.componentId)),
  }))
}

export function buildBlinkPcb(): DemoPcb {
  const schematic = buildBlinkBoard()
  // A ground symbol is a net annotation, not a physical part: it has no
  // footprint and must not become a router pad, a 3-D body or a BOM line.
  const components = schematic.components
    .filter((component) => component.component.name !== 'Ground')
    .map(toPlacedComponent)
  const nets = netsFromWires(schematic.components, schematic.wires)
  const pads = buildRouterPads(components, nets)

  const config: RouterConfig = {
    boardWidthMm: DEMO_BLINK_PCB_BOARD.widthMm,
    boardHeightMm: DEMO_BLINK_PCB_BOARD.heightMm,
    layers: ['F.Cu', 'B.Cu'],
    gridMm: 0.5,
    minTraceWidthMm: 0.3,
    minSpacingMm: 0.25,
    viaDrillMm: 0.3,
    viaPadMm: 0.6,
    viaPenalty: 8,
  }
  const routed = autoroute(pads, config)

  const traces: DemoPcbTrace[] = routed.traces.map((trace, index) => ({
    id: `blink-trace-${index}`,
    net: trace.netId,
    layerId: trace.layerId === 'B.Cu' ? 'bot-cu' : 'top-cu',
    widthMm: trace.widthMm,
    points: trace.points,
  }))
  const vias: DemoPcbVia[] = routed.vias.map((via, index) => ({
    id: `blink-via-${index}`,
    net: via.netId,
    x: via.x,
    y: via.y,
    drillMm: via.drillMm,
    padMm: via.padMm,
  }))

  const scene: PcbSceneInput = {
    widthMm: DEMO_BLINK_PCB_BOARD.widthMm,
    heightMm: DEMO_BLINK_PCB_BOARD.heightMm,
    thicknessMm: DEMO_BLINK_PCB_BOARD.thicknessMm,
    copperThicknessMm: DEMO_BLINK_PCB_BOARD.copperThicknessMm,
    layers: [
      { id: 'top-cu', name: 'Top Copper', kind: 'copper', color: '#cc0000', side: 'top' },
      { id: 'bot-cu', name: 'Bottom Copper', kind: 'copper', color: '#ffaa00', side: 'bottom' },
      { id: 'top-silk', name: 'Top Silkscreen', kind: 'silk', color: '#ffffff', side: 'top' },
      { id: 'top-mask', name: 'Top Soldermask', kind: 'mask', color: '#008800', side: 'top' },
      { id: 'bot-mask', name: 'Bottom Soldermask', kind: 'mask', color: '#004400', side: 'bottom' },
    ],
    traces: traces.map((trace) => ({
      id: trace.id,
      net: trace.net,
      layerId: trace.layerId,
      widthMm: trace.widthMm,
      points: trace.points,
    })),
    vias: vias.map((via) => ({
      id: via.id,
      net: via.net,
      x: via.x,
      y: via.y,
      padDiameterMm: via.padMm,
      drillDiameterMm: via.drillMm,
    })),
    components: components.map((component) => ({
      id: component.id,
      reference: component.reference,
      footprint: String(component.properties.footprint ?? component.component.name),
      category: component.component.category,
      x: component.position.x,
      y: component.position.y,
      rotationDeg: component.rotation,
      side: 'top',
    })),
  }

  return {
    board: DEMO_BLINK_PCB_BOARD,
    scene,
    traces,
    vias,
    summary: {
      routedNets: routed.stats.routedNets,
      totalNets: routed.stats.totalNets,
      unrouted: routed.unrouted,
      vias: routed.stats.totalVias,
      traceLengthMm: routed.stats.totalTraceLength,
    },
  }
}
