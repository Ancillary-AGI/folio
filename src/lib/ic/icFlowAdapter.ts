/**
 * IC Flow Adapter — convenience wrappers over the lower-level IC design APIs.
 *
 * The panel imports from here to get clean, panel-friendly types without having
 * to understand every detail of the underlying engines.
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
import type { DigitalNetlist } from '../simulation/digitalLogic'
import { STANDARD_PACKAGES, type PackageSpec } from './chipPackaging'

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

// ── PACKAGE_TYPES array ───────────────────────────────────────────────────────

export const PACKAGE_TYPES: ChipPackage[] = Object.entries(STANDARD_PACKAGES).map(([id, spec]) => ({
  id,
  name: spec.name,
  description: `${spec.family} ${spec.leadCount}-lead, ${spec.bodyWidthMm}×${spec.bodyHeightMm} mm`,
  pinCount: spec.leadCount,
  bodySize: `${spec.bodyWidthMm}×${spec.bodyHeightMm} mm`,
  spec,
}))

// ── synthesize adapter ────────────────────────────────────────────────────────

/**
 * Synthesize a digital netlist produced by the Verilog parser into a
 * standard-cell module, then add the panel-friendly `.cells` / `.totalArea` /
 * `.criticalPathPs` surface.
 */
export function synthesize(netlist: DigitalNetlist, _lib: unknown): SynthesisResult {
  // Build a minimal gate list from the digital netlist
  const gates: GatePrimitive[] = netlist.gates.map((g, i) => ({
    id: `G${i}`,
    kind: g.type as GatePrimitive['kind'],
    inputs: Object.fromEntries(g.inputs.map((inp, j) => [`A${j}`, inp])),
    outputs: { Z: g.output },
  }))

  const inputs = new Set<string>()
  const outputs = new Set<string>()
  for (const g of netlist.gates) {
    for (const inp of g.inputs) inputs.add(inp)
    outputs.add(g.output)
  }
  // Primary inputs are those used as inputs but never as gate outputs
  const primaryInputs = Array.from(inputs).filter(n => !outputs.has(n))
  const primaryOutputs = Array.from(outputs).filter(n => !Array.from(inputs).has(n))

  // Fallback if the netlist is empty
  if (gates.length === 0) {
    return {
      name: 'empty',
      instances: [],
      nets: new Map(),
      primaryInputs: [],
      primaryOutputs: [],
      metrics: {
        gateCount: 0, totalCellAreaUm2: 0, totalLeakagePowerUw: 0,
        estimatedDynamicPowerMwAt100Mhz: 0, criticalPathDelayPs: 0,
        maxOperatingFreqMhz: 0, criticalPath: [],
      },
      cells: [],
      totalArea: 0,
      criticalPathPs: 1,
      staticPowerUw: 0,
      dynamicPowerMw: 0,
    }
  }

  const module = synthesizeGates('module', gates, primaryInputs, primaryOutputs)

  const cells = module.instances.map(inst => ({
    name: inst.cell.kind,
    area: inst.cell.widthUm * inst.cell.heightUm,
    delayPs: undefined as number | undefined,
    driveStrength: inst.cell.driveStrength ?? 1,
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
  const signals = {
    inputs: result.primaryInputs,
    outputs: result.primaryOutputs,
  }
  const fp = generateDieFloorplan(result.name ?? 'module', result.totalArea || 1, signals)
  return {
    ...fp,
    rows: fp.rowCount,
    coreAreaUm2: fp.coreWidthUm * fp.coreHeightUm,
  }
}

// ── generatePackageDescription ────────────────────────────────────────────────

export function generatePackageDescription(pkg: ChipPackage): string {
  const s = pkg.spec
  return [
    `Package: ${s.name}`,
    `Family: ${s.family}`,
    `Leads: ${s.leadCount}`,
    `Body: ${s.bodyWidthMm} × ${s.bodyHeightMm} × ${s.bodyThicknessMm} mm`,
    `Pitch: ${s.pitchMm} mm`,
    `Max die: ${s.maxDieWidthUm} × ${s.maxDieHeightUm} µm`,
    `θJC: ${s.thermalResistanceJunctionToCaseCperW} °C/W`,
  ].join('\n')
}

// ── exportGDSII adapter ────────────────────────────────────────────────────────

/**
 * Build a GDSII library from the synthesis + floorplan results, then
 * base64-encode the binary stream so it can be previewed as text.
 */
export function exportGDSII(
  synth: SynthesisResult,
  fp: FloorplanResult,
): string {
  try {
    // Build minimal polygon set from the cell instances
    const polygons: GdsPolygon[] = synth.instances.slice(0, 50).map((inst, i) => {
      const col = i % 10
      const row = Math.floor(i / 10)
      const x = col * inst.cell.widthUm
      const y = row * inst.cell.heightUm
      const w = inst.cell.widthUm
      const h = inst.cell.heightUm
      return {
        layer: 68, // Metal1
        datatype: 0,
        pointsUm: [
          { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }, { x, y },
        ],
      }
    })

    const structure: GdsStructure = {
      name: synth.name ?? 'MODULE',
      polygons,
    }

    const lib: GdsLibrary = {
      name: `${synth.name ?? 'module'}.gds`,
      userUnitsUm: 1.0,
      databaseUnitsMeter: 1e-9,
      structures: [structure],
    }

    const binary = exportGdsBinary(lib)
    // Convert to base64 for display/download
    const hex = Array.from(binary).map(b => b.toString(16).padStart(2, '0')).join('')
    return [
      `* GDSII Binary Stream`,
      `* Module: ${synth.name ?? 'MODULE'}`,
      `* Die: ${fp.dieWidthUm.toFixed(1)} × ${fp.dieHeightUm.toFixed(1)} µm`,
      `* Cells: ${synth.cells.length}`,
      `* Structures: ${lib.structures.length}`,
      `* Size: ${binary.length} bytes`,
      ``,
      `HEX:${hex.slice(0, 256)}…`,
    ].join('\n')
  } catch (err) {
    return `* GDSII export: ${err instanceof Error ? err.message : String(err)}`
  }
}
