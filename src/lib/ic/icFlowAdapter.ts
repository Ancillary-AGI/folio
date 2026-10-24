/**
 * IC Flow Adapter — panel-facing wrappers over the lower-level IC design APIs.
 *
 * Maps a four-state digital netlist onto the SKY130 standard-cell library,
 * using the cell descriptors' real pin names (the library is not uniform:
 * NAND2's output is `Y`, AND2's is `X`). Wide gates are decomposed into a tree
 * of native cells so every emitted instance is a real library cell.
 */

import {
  synthesizeGates,
  type GatePrimitive,
  type SynthesizedModule,
} from './logicSynthesis'
import {
  generateDieFloorplan,
  type DieFloorplan,
} from './siliconFloorplan'
import { exportGdsBinary, type GdsLibrary, type GdsStructure, type GdsPolygon } from './gdsExport'
import type { DigitalNetlist, GateType } from '../simulation/digitalLogic'
import { STANDARD_PACKAGES, type PackageSpec } from './chipPackaging'
import { SKY130_CELLS, type StandardCellKind } from './standardCellLibrary'

// ── Re-exported panel-friendly types ─────────────────────────────────────────

export type SynthesisResult = SynthesizedModule & {
  cells: Array<{ name: string; area: number; delayPs?: number; driveStrength?: number }>
  totalArea: number
  criticalPathPs: number
  staticPowerUw?: number
  dynamicPowerMw?: number
}

export type FloorplanResult = DieFloorplan & {
  rows: number
  coreAreaUm2: number
}

export interface ChipPackage {
  id: string
  name: string
  description: string
  pinCount: number
  bodySize: string
  spec: PackageSpec
}

export type PortDirection = { name: string; direction: 'input' | 'output' }

// ── PACKAGE_TYPES array ───────────────────────────────────────────────────────

export const PACKAGE_TYPES: ChipPackage[] = Object.entries(STANDARD_PACKAGES).map(([id, spec]) => ({
  id,
  name: spec.name,
  description: `${spec.family} ${spec.leadCount}-lead, ${spec.bodyWidthMm}×${spec.bodyHeightMm} mm`,
  pinCount: spec.leadCount,
  bodySize: `${spec.bodyWidthMm}×${spec.bodyHeightMm} mm`,
  spec,
}))

// ── Gate → cell mapping ──────────────────────────────────────────────────────

const BINARY_CELL: Partial<Record<GateType, StandardCellKind>> = {
  AND: 'AND2',
  NAND: 'NAND2',
  OR: 'OR2',
  NOR: 'NOR2',
  XOR: 'XOR2',
  XNOR: 'XNOR2',
}

/**
 * How a wide gate reduces to two-input cells. NAND/NOR/XNOR cannot be folded
 * with their own inverting cell (NAND(NAND(a,b),c) is not NAND(a,b,c)), so they
 * reduce with the non-inverting cell and finish with one inverter.
 */
const WIDE_REDUCTION: Partial<Record<GateType, { reduce: StandardCellKind; invert: boolean }>> = {
  AND: { reduce: 'AND2', invert: false },
  OR: { reduce: 'OR2', invert: false },
  XOR: { reduce: 'XOR2', invert: false },
  NAND: { reduce: 'AND2', invert: true },
  NOR: { reduce: 'OR2', invert: true },
  XNOR: { reduce: 'XOR2', invert: true },
}

function inputPins(kind: StandardCellKind): string[] {
  return SKY130_CELLS[kind].pins.filter((pin) => pin.direction === 'input').map((pin) => pin.name)
}

function outputPin(kind: StandardCellKind): string {
  const pin = SKY130_CELLS[kind].pins.find((candidate) => candidate.direction === 'output')
  if (!pin) throw new Error(`Standard cell ${kind} has no output pin`)
  return pin.name
}

/** Build gate primitives with real cell pin names, decomposing wide gates. */
function mapGates(netlist: DigitalNetlist): GatePrimitive[] {
  const usedNets = new Set<string>()
  for (const gate of netlist.gates) {
    usedNets.add(gate.output)
    for (const input of gate.inputs) usedNets.add(input)
  }

  let serial = 0
  const freshNet = (): string => {
    let name = `__n${serial++}`
    while (usedNets.has(name)) name = `__n${serial++}`
    usedNets.add(name)
    return name
  }

  const primitives: GatePrimitive[] = []
  const addCell = (kind: StandardCellKind, inputs: string[], output: string): void => {
    const pins = inputPins(kind)
    if (pins.length !== inputs.length) {
      throw new Error(`${kind} expects ${pins.length} inputs, got ${inputs.length}`)
    }
    primitives.push({
      id: `G${primitives.length + 1}`,
      kind,
      inputs: Object.fromEntries(pins.map((pin, index) => [pin, inputs[index]])),
      outputs: { [outputPin(kind)]: output },
    })
  }

  const fold = (kind: StandardCellKind, nets: string[], output: string): void => {
    let carry = nets[0]
    for (let index = 1; index < nets.length; index += 1) {
      const isLast = index === nets.length - 1
      const target = isLast ? output : freshNet()
      addCell(kind, [carry, nets[index]], target)
      carry = target
    }
  }

  for (const gate of netlist.gates) {
    const { type, output } = gate
    const inputs = gate.inputs
    if (inputs.length === 0) {
      throw new Error(`Gate ${gate.id} has no inputs`)
    }
    if (type === 'NOT' || type === 'BUF') {
      addCell(type === 'NOT' ? 'INV' : 'CLKBUF', inputs, output)
      continue
    }

    const binary = BINARY_CELL[type]
    if (!binary) throw new Error(`Unsupported gate type ${type}`)

    if (type === 'NAND' && inputs.length === 3) {
      addCell('NAND3', inputs, output)
      continue
    }

    if (inputs.length === 1) {
      // One-input AND/OR/XOR are identities; their inverting forms are NOT.
      const inverting = type === 'NAND' || type === 'NOR' || type === 'XNOR'
      addCell(inverting ? 'INV' : 'CLKBUF', inputs, output)
      continue
    }

    if (inputs.length === 2) {
      addCell(binary, inputs, output)
      continue
    }

    const recipe = WIDE_REDUCTION[type]
    if (!recipe) throw new Error(`Unsupported gate type ${type}`)
    if (recipe.invert) {
      const treeOutput = freshNet()
      fold(recipe.reduce, inputs, treeOutput)
      addCell('INV', [treeOutput], output)
    } else {
      fold(recipe.reduce, inputs, output)
    }
  }

  return primitives
}

// ── synthesize adapter ────────────────────────────────────────────────────────

/**
 * Synthesize a digital netlist produced by the Verilog/VHDL parser into a
 * standard-cell module. When the design's ports are supplied they define the
 * primary I/O exactly; otherwise I/O is inferred from net drivers.
 */
export function synthesize(netlist: DigitalNetlist, ports?: PortDirection[]): SynthesisResult {
  const gates = mapGates(netlist)

  let primaryInputs: string[]
  let primaryOutputs: string[]
  if (ports && ports.length > 0) {
    primaryInputs = ports.filter((port) => port.direction === 'input').map((port) => port.name)
    primaryOutputs = ports.filter((port) => port.direction === 'output').map((port) => port.name)
  } else {
    const driven = new Set(netlist.gates.map((gate) => gate.output))
    const consumed = new Set(netlist.gates.flatMap((gate) => gate.inputs))
    primaryInputs = [...consumed].filter((net) => !driven.has(net))
    primaryOutputs = [...driven].filter((net) => !consumed.has(net))
  }

  const blank = {
    name: 'empty',
    instances: [],
    nets: new Map(),
    primaryInputs,
    primaryOutputs,
    metrics: {
      gateCount: 0, totalCellAreaUm2: 0, totalLeakagePowerUw: 0,
      estimatedDynamicPowerMwAt100Mhz: 0, criticalPathDelayPs: 0,
      maxOperatingFreqMhz: 0, criticalPath: [],
    },
    cells: [],
    totalArea: 0,
    criticalPathPs: 0,
    staticPowerUw: 0,
    dynamicPowerMw: 0,
  } satisfies SynthesisResult

  if (gates.length === 0) return blank

  const module = synthesizeGates('module', gates, primaryInputs, primaryOutputs)

  const cells = module.instances.map((instance) => ({
    name: instance.cell.kind,
    area: instance.cell.widthUm * instance.cell.heightUm,
    delayPs: instance.cell.intrinsicDelayPs,
    driveStrength: instance.cell.driveStrength,
  }))

  return {
    ...module,
    cells,
    totalArea: module.metrics.totalCellAreaUm2,
    criticalPathPs: module.metrics.criticalPathDelayPs,
    staticPowerUw: module.metrics.totalLeakagePowerUw,
    dynamicPowerMw: module.metrics.estimatedDynamicPowerMwAt100Mhz,
  }
}

// ── planFloorplan adapter ─────────────────────────────────────────────────────

export function planFloorplan(result: SynthesisResult): FloorplanResult {
  const fp = generateDieFloorplan(result.name ?? 'module', result.totalArea || 1, {
    inputs: result.primaryInputs,
    outputs: result.primaryOutputs,
  })
  return {
    ...fp,
    rows: fp.rowCount,
    coreAreaUm2: fp.coreWidthUm * fp.coreHeightUm,
  }
}

// ── generatePackageDescription ────────────────────────────────────────────────

export function generatePackageDescription(pkg: ChipPackage): string {
  const spec = pkg.spec
  return [
    `Package: ${spec.name}`,
    `Family: ${spec.family}`,
    `Leads: ${spec.leadCount}`,
    `Body: ${spec.bodyWidthMm} × ${spec.bodyHeightMm} × ${spec.bodyThicknessMm} mm`,
    `Pitch: ${spec.pitchMm} mm`,
    `Max die: ${spec.maxDieWidthUm} × ${spec.maxDieHeightUm} µm`,
    `θJC: ${spec.thermalResistanceJunctionToCaseCperW} °C/W`,
  ].join('\n')
}

// ── exportGDSII adapter ────────────────────────────────────────────────────────

/**
 * Build a GDSII library from the synthesis + floorplan results.
 *
 * Returns the real binary stream for download plus a human-readable summary
 * for the preview pane. Throws if the stream cannot be produced so the caller
 * can surface the failure instead of shipping a text file with a .gds name.
 */
export function exportGDSII(
  synth: SynthesisResult,
  fp: FloorplanResult,
): { binary: ArrayBuffer; text: string } {
  // Pack every cell row-by-row inside the floorplanned core. This is a
  // representative layout (no legaliser or router), but its extent matches the
  // reported die rather than an arbitrary fixed grid.
  const marginUm = Math.max(0, (fp.dieWidthUm - fp.coreWidthUm) / 2)
  const polygons: GdsPolygon[] = []
  let cursorX = marginUm
  let cursorY = marginUm
  let rowHeight = 0
  for (const instance of synth.instances) {
    const width = instance.cell.widthUm
    const height = instance.cell.heightUm
    if (cursorX > marginUm && cursorX + width > marginUm + fp.coreWidthUm) {
      cursorX = marginUm
      cursorY += rowHeight
      rowHeight = 0
    }
    const x = cursorX
    const y = cursorY
    polygons.push({
      layer: 68, // Metal1
      datatype: 0,
      pointsUm: [
        { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }, { x, y },
      ],
    })
    cursorX += width
    rowHeight = Math.max(rowHeight, height)
  }

  const structure: GdsStructure = {
    name: synth.name ?? 'MODULE',
    polygons,
  }

  const library: GdsLibrary = {
    name: `${synth.name ?? 'module'}.gds`,
    userUnitsUm: 1.0,
    databaseUnitsMeter: 1e-9,
    structures: [structure],
  }

  const bytes = exportGdsBinary(library)
  const binary = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  return {
    binary,
    text: [
      `GDSII stream`,
      `Module: ${synth.name ?? 'MODULE'}`,
      `Die: ${fp.dieWidthUm.toFixed(1)} × ${fp.dieHeightUm.toFixed(1)} µm`,
      `Cells: ${synth.cells.length}`,
      `Polygons: ${polygons.length}`,
      `Size: ${binary.byteLength} bytes`,
    ].join('\n'),
  }
}
