/**
 * Bridge from the drawn schematic to the deterministic symbolic verifier.
 *
 * The verifier is intentionally canvas-agnostic; this adapter performs the
 * same netlisting the simulator uses and maps each node index back to its
 * symbol pin, so ERC reasons about the circuit that will be simulated rather
 * than a parallel re-implementation of connectivity.
 */
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import type { Component } from '../supabase'
import { buildCircuitNetlist, orderedTerminalPins } from '../simulation/netlistBuilder'
import {
  verifyCircuitTopology,
  type CircuitNode,
  type SymbolicVerificationResult,
} from './symbolicVerifier'

type PinKind = CircuitNode['pins'][number]['pinKind']

const PIN_KIND: Record<Component['pins'][number]['type'], PinKind> = {
  input: 'input',
  output: 'output',
  io: 'bidirectional',
  power: 'power',
  ground: 'ground',
  passive: 'passive',
  nc: 'passive',
}

/** Group the drawn circuit into verification nodes keyed by SPICE node name. */
export function schematicVerificationNodes(
  components: CanvasComponent[],
  wires: CanvasWire[],
): CircuitNode[] {
  const netlist = buildCircuitNetlist('ERC', components, wires, { type: 'dc' })
  const placedByReference = new Map(components.map((placed) => [placed.reference, placed]))
  const nodes = new Map<string, CircuitNode>()

  for (const device of netlist.components) {
    const placed = placedByReference.get(device.name)
    if (!placed) throw new Error(`Netlist component ${device.name} is not on the sheet.`)
    const pins = orderedTerminalPins(placed.component)
    device.nodes.forEach((nodeName, index) => {
      const pin = pins[index]
      if (!pin) throw new Error(`${device.name}: node ${nodeName} has no matching terminal.`)
      // Explicit no-connect pins are intentional and must not raise ERC noise.
      if (pin.type === 'nc') return
      const node = nodes.get(nodeName) ?? { id: nodeName, netName: nodeName, pins: [] }
      node.pins.push({ componentId: device.name, pinId: pin.id, pinKind: PIN_KIND[pin.type] })
      nodes.set(nodeName, node)
    })
  }

  return [...nodes.values()]
}

/** Run the full symbolic ERC over the drawn schematic. */
export function verifySchematic(
  components: CanvasComponent[],
  wires: CanvasWire[],
): SymbolicVerificationResult {
  return verifyCircuitTopology(schematicVerificationNodes(components, wires))
}
