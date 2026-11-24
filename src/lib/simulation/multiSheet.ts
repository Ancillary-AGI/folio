/**
 * Multi-sheet netlisting (top of the Not-implemented list).
 *
 * Sheets are canvases netlisted together: components keep sheet-unique
 * ids, but wires carrying the same global net label (off-sheet connector
 * `OUT`, port `VCC`) union across sheets. Local nets stay sheet-private
 * via a sheet prefix, so `N_abc` on sheet 1 never collides with sheet 2.
 * Duplicate reference designators across sheets are rejected — two `R1`
 * would silently merge into one SPICE device.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import type { CircuitNetlist, SimulationParameters } from './spiceEngine'
import { buildCircuitNetlist } from './netlistBuilder'

export interface SchematicSheet {
  name: string
  components: CanvasComponent[]
  wires: CanvasWire[]
}

const GLOBAL_PREFIXES = ['OUT', 'IN', 'VCC', 'VDD', 'VEE', 'GND', 'GNDA', 'GNDD', 'NET_']

const isGlobalNet = (netName: string): boolean => {
  const upper = netName.trim().toUpperCase()
  return GLOBAL_PREFIXES.some((prefix) => upper === prefix || upper.startsWith(`${prefix}_`) || upper.startsWith(`${prefix}-`))
}

/** Netlist every sheet as one circuit, stitching global labels across sheets. */
export function buildMultiSheetNetlist(
  title: string,
  sheets: SchematicSheet[],
  analysis: SimulationParameters,
): CircuitNetlist {
  const references = new Map<string, string>()
  for (const sheet of sheets) {
    for (const component of sheet.components) {
      const owner = references.get(component.reference)
      if (owner && owner !== sheet.name) {
        throw new Error(`Duplicate reference ${component.reference} on sheets ${owner} and ${sheet.name} — rename one.`)
      }
      references.set(component.reference, sheet.name)
    }
  }
  // Remap: global labels pass through; local labels and anonymous wires
  // gain a sheet prefix so same-named locals never merge across sheets.
  const remappedWires: CanvasWire[] = []
  const remappedComponents: CanvasComponent[] = []
  sheets.forEach((sheet, index) => {
    const tag = `S${index + 1}`
    for (const component of sheet.components) {
      remappedComponents.push({ ...component, id: `${tag}_${component.id}` })
    }
    for (const wire of sheet.wires) {
      const global = wire.netName?.trim() ? isGlobalNet(wire.netName) : false
      remappedWires.push({
        ...wire,
        id: `${tag}_${wire.id}`,
        netName: wire.netName?.trim() ? (global ? wire.netName : `${tag}_${wire.netName}`) : wire.netName,
        connectedPins: wire.connectedPins.map((connection) => ({
          componentId: `${tag}_${connection.componentId}`,
          pinId: connection.pinId,
        })),
      })
    }
  })
  return buildCircuitNetlist(title, remappedComponents, remappedWires, analysis)
}
