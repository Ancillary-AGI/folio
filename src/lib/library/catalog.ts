/**
 * Per-domain library catalogs.
 *
 * The dock never invents a part. Each catalog is built from data the domain
 * already uses for its own calculations — the mechanical standard tables feed
 * the same dimensions the analyser reads, the machine rows are the presets the
 * simulator switches between, the code rows are snippets the elaborator accepts.
 * A row that could not be placed by something in the app is not in a catalog.
 */
import type { Component } from '../supabase'
import {
  STANDARD_PARTS,
  envelopeExcess,
  formatExcess,
  type PartFamily,
  type StandardPart,
} from '../mechanical/standardParts'
import { requireMaterial } from '../mechanical/materials'
import {
  BLDC_PRESETS,
  DC_MACHINE_PRESETS,
  STEPPER_PRESETS,
} from '../electronics/machineDynamics'
import type { LibraryItem, LibraryItemOf, LibraryKind } from './types'
import { VENDOR_MODEL_CATALOG } from '../simulation/vendorModels'
import { TRUSS_PRESETS, trussCounts, trussDeterminacy } from '../structures/trussPresets'
import { solveTruss } from '../structures/truss'
import { bioModelRows } from '../biology/models'
import {
  controlCatalog,
  gridCatalog,
  rfCatalog,
  robotCatalog,
  snippetCatalog,
} from './elementCatalogs'

/**
 * What each part category is called in the dock.
 *
 * The stored category is a machine key (`microcontroller`, `semiconductor`);
 * the group header is what a person reads while scanning for a part, so it
 * names the family the way a supplier's catalogue does. An unknown key —
 * a part the user drew themselves — keeps its own label rather than being
 * filed under a guess.
 */
const ELECTRICAL_CATEGORY_LABELS: Readonly<Record<string, string>> = {
  actuator: 'Motors & actuators',
  amplifier: 'Amplifiers & comparators',
  connector: 'Connectors',
  converter: 'ADCs & DACs',
  ic: 'Logic & analog ICs',
  interface: 'Interfaces & drivers',
  memory: 'Memory',
  microcontroller: 'Microcontrollers',
  passive: 'Passives',
  power: 'Power',
  protection: 'Protection',
  regulator: 'Regulators & converters',
  reference: 'Voltage references',
  semiconductor: 'Diodes & transistors',
  sensor: 'Sensors',
  switch: 'Switches & relays',
  test: 'Test points',
  timing: 'Crystals & oscillators',
}

/** `schematic` and `pcb` place the project's own parts list. */
export function electricalCatalog(components: readonly Component[]): LibraryItemOf<'component'>[] {
  return components.map((component, index) => {
    const id = component.id ?? ''
    // The datasheet identity — MPN, maker, package — is what a designer searches
    // for and checks before dropping, so it goes in the readout and the tags.
    // A symbol drawn without one of them simply shows fewer fields.
    const pkg = component.default_properties.package
    const packageLabel = typeof pkg === 'string' ? pkg : ''
    const readout = [packageLabel, `${component.pins.length}p`].filter(Boolean).join(' · ')
    const sourcing = [component.manufacturer, component.part_number, packageLabel].filter(Boolean).join(' ')
    return {
      id: id || `component-${index}`,
      kind: 'component' as const,
      name: component.name,
      category: ELECTRICAL_CATEGORY_LABELS[component.category] ?? component.category,
      spec: readout,
      description: component.description,
      // Pin geometry and default attributes belong in the tooltip, not in the
      // search index: they are how you check a symbol before dropping it.
      detail: [
        sourcing ? `source: ${sourcing}` : '',
        component.datasheet_url ? `datasheet: ${component.datasheet_url}` : '',
        component.pins.length > 0
          ? `pins: ${component.pins.map((pin) => `${pin.name}@(${pin.x},${pin.y})`).join(' ')}`
          : 'no pins',
        Object.keys(component.default_properties).length > 0
          ? `defaults: ${Object.entries(component.default_properties).map(([key, value]) => `${key}=${String(value)}`).join(' ')}`
          : '',
      ].filter(Boolean).join(' — '),
      tags: Array.from(new Set([
        ...(component.tags ?? []),
        component.part_number ?? '',
        packageLabel.toLowerCase(),
      ].filter(Boolean))),
      payload: { componentId: id },
    }
  })
}

const FAMILY_LABELS: Readonly<Record<PartFamily, string>> = {
  bolt: 'Bolts',
  screw: 'Socket screws',
  nut: 'Nuts',
  washer: 'Washers',
  bearing: 'Ball bearings',
  shaft: 'Round bar',
  gear: 'Spur gears',
  pulley: 'Timing pulleys',
  'hollow section': 'Hollow sections',
  extrusion: 'T-slot extrusion',
  spring: 'Springs',
  plate: 'Plate & sheet',
  rail: 'DIN rail',
  motor: 'Stepper motors',
  standoff: 'PCB standoffs',
  pin: 'Dowel pins',
}

function mechanicalRow(part: StandardPart): LibraryItemOf<'solid'> {
  const excess = envelopeExcess(part)
  // The envelope penalty is stated, not hidden: a user who drops a bearing into
  // an assembly must be able to see why its mass reads heavier than the catalogue.
  const penalty = excess > 0
    ? ` Drawn as ${part.solids.length === 1 ? 'one envelope solid' : `${part.solids.length} envelope solids`}, ${formatExcess(excess)} heavier than the part.`
    : ''
  return {
    id: part.id,
    kind: 'solid',
    name: part.name,
    category: FAMILY_LABELS[part.family],
    spec: part.spec,
    description: `${part.standard}. ${requireMaterial(part.materialKey).name}. ${part.note ?? ''}${penalty}`.replace(/\s+/g, ' ').trim(),
    tags: [...part.tags, part.family],
    payload: {
      standard: part.standard,
      solids: part.solids.map(solid => ({
        suffix: solid.suffix,
        kind: solid.kind,
        dimensions: { length: solid.box[0] / 1000, width: solid.box[1] / 1000, height: solid.box[2] / 1000 },
        offset: [solid.offset[0] / 1000, solid.offset[1] / 1000, solid.offset[2] / 1000],
      })),
      materialKey: part.materialKey,
      support: 'free',
      envelopeNote: part.note,
    },
  }
}

export function mechanicalCatalog(): LibraryItemOf<'solid'>[] {
  return STANDARD_PARTS.map(mechanicalRow)
}

/**
 * Standard truss forms for the structures workspace.
 *
 * A row is only a row if the stiffness solver closes on it: each preset is
 * counted for determinacy and solved here, so the dock cannot offer a frame that
 * the panel would drop and then report as a mechanism. A form that stops passing
 * that check disappears from the dock rather than shipping a broken drop.
 */
export function trussCatalog(): LibraryItemOf<'truss'>[] {
  const rows: LibraryItemOf<'truss'>[] = []
  for (const preset of TRUSS_PRESETS) {
    const analysis = solveTruss(preset.model)
    if (!analysis.result) continue
    const { joints, members, restraints } = trussCounts(preset.model)
    rows.push({
      id: `truss-${preset.id}`,
      kind: 'truss',
      name: preset.name,
      category: 'Standard frames',
      spec: `${joints} joints · ${members} bars`,
      description: `${preset.use}. ${preset.note}`,
      detail: `${preset.span} m span, ${restraints} restraints, statically ${trussDeterminacy(preset.model).kind}.`,
      tags: ['truss', 'frame', 'structure'],
      payload: { presetId: preset.id },
    })
  }
  return rows
}

/**
 * Every model the biology workspace can load.
 *
 * The rows come out of `bioModelRows()`, which is built from the same preset
 * registries the panel switches on, so a dock row cannot name a model the solver
 * has never heard of. `spec` quotes inputs only — species counts, conductances,
 * compartment counts — never a result, because the result is what the run
 * produces and a library row is not where it should be asserted.
 */
export function bioCatalog(): LibraryItemOf<'bio-model'>[] {
  return bioModelRows().map((row) => ({
    id: `bio-${row.id}`,
    kind: 'bio-model',
    name: row.name,
    category: row.category,
    spec: row.spec,
    description: row.description,
    detail: `Modelled at the ${row.scale} scale.`,
    tags: ['biology', row.scale],
    payload: { scale: row.scale, presetId: row.id },
  }))
}

/** The model types the deck's parser accepts, taken from the card's own text. */
const MODEL_TYPES = ['NPN', 'PNP', 'NMOS', 'PMOS', 'NJF', 'PJF', 'D'] as const

const CATEGORY_WORDS: Record<string, string> = {
  bjt: 'Bipolar transistors',
  mosfet: 'MOSFETs',
  jfet: 'JFETs',
  diode: 'Diodes',
}

/**
 * Published vendor `.model` cards for the simulator's model deck.
 *
 * The rows are the same cards the design-margin checks and the datasheet
 * importer already look up, so a drop cannot introduce a device the app knows
 * nothing about. Only single-card categories are listed: the op-amp, regulator
 * and timer entries are `.SUBCKT` blocks, and the deck parses `.model` lines, so
 * a subcircuit row would be refused the moment it landed.
 */
export function modelCardCatalog(): LibraryItemOf<'model-card'>[] {
  const rows: LibraryItemOf<'model-card'>[] = []
  for (const entry of VENDOR_MODEL_CATALOG.values()) {
    const categoryWord = CATEGORY_WORDS[entry.category]
    if (!categoryWord) continue
    const typeWord = entry.spiceText.match(/^\.model\s+\S+\s+(\w+)/)?.[1] ?? ''
    const modelType = (MODEL_TYPES as readonly string[]).includes(typeWord)
      ? (typeWord as (typeof MODEL_TYPES)[number])
      : null
    // A card the deck cannot read is not a row, whatever the catalog claims.
    if (!modelType) continue
    const rating = [
      entry.ratings?.vceo !== undefined ? `${Math.abs(entry.ratings.vceo)} V` : '',
      entry.ratings?.vds !== undefined ? `${Math.abs(entry.ratings.vds)} V` : '',
      entry.ratings?.vbr !== undefined ? `${Math.abs(entry.ratings.vbr)} V` : '',
      entry.ratings?.ic !== undefined ? `${entry.ratings.ic} A` : '',
      entry.ratings?.id !== undefined ? `${entry.ratings.id} A` : '',
    ].filter(Boolean).join(' · ')
    rows.push({
      id: `model-${entry.name.toUpperCase()}`,
      kind: 'model-card',
      name: entry.name,
      category: categoryWord,
      spec: rating || entry.manufacturer,
      description: `${entry.description} — ${entry.manufacturer}`,
      detail: [entry.spiceText, entry.footprint ? `footprint ${entry.footprint}` : '', entry.datasheetUrl ?? '']
        .filter(Boolean)
        .join(' — '),
      tags: entry.tags,
      payload: {
        device: entry.name,
        manufacturer: entry.manufacturer,
        modelType,
        spiceText: entry.spiceText,
        datasheetUrl: entry.datasheetUrl,
      },
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Which workspace shows a dock, what it is called, and what its panel places.
 *
 * `accepts` is derived from the rows themselves, so a catalog cannot claim to
 * serve a kind its panel would refuse — the drop zones use the same list to
 * decide whether a drag is welcome.
 */
export interface DomainLibrary {
  label: string
  placeholder: string
  hint: string
  items: LibraryItem[]
  accepts: readonly LibraryKind[]
}

const kindsIn = (items: readonly LibraryItem[]): LibraryKind[] => {
  const seen: LibraryKind[] = []
  for (const item of items) if (!seen.includes(item.kind)) seen.push(item.kind)
  return seen
}

function library(label: string, placeholder: string, hint: string, items: LibraryItem[]): DomainLibrary {
  return { label, placeholder, hint, items, accepts: kindsIn(items) }
}

export function libraryForMode(
  mode: string,
  components: readonly Component[],
): DomainLibrary | null {
  switch (mode) {
    case 'schematic':
      return library(
        'Component library',
        'Search parts…',
        'Drag onto the sheet · click to arm',
        electricalCatalog(components),
      )
    case 'pcb':
      return library(
        'Board parts',
        'Search sheet parts…',
        'Drag onto the board · click to arm',
        electricalCatalog(components),
      )
    case 'mechanical':
      return library(
        'Mechanical parts',
        'Search ISO and DIN parts…',
        'Drag into the viewport · click to arm',
        mechanicalCatalog(),
      )
    case 'machines':
      return library(
        'Machines',
        'Search machines…',
        'Drop on the simulator to load a machine',
        machineCatalog(),
      )
    case 'simulation':
      return library(
        'Device models',
        'Search 2N3904, 1N4148, BS170…',
        'Drop on the model deck to give the solver the manufacturer’s card',
        modelCardCatalog(),
      )
    case 'control':
      return library(
        'Control blocks',
        'Search transfer functions…',
        'Drop on the plant card to replace its transfer function',
        controlCatalog(),
      )
    case 'rf':
      return library(
        'Link elements',
        'Search antennas, feeds and LNAs…',
        'Drop on the link budget to set the input it drives',
        rfCatalog(),
      )
    case 'grid':
      return library(
        'Grid elements',
        'Search buses, lines and transformers…',
        'Drop on the case table to extend the network',
        gridCatalog(),
      )
    case 'robotics':
      return library(
        'Robot architectures',
        'Search arms and gantries…',
        'Drop on the workspace to build the mechanism',
        robotCatalog(),
      )
    case 'hdl':
      return library(
        'HDL blocks',
        'Search modules and entities…',
        'Drop in the editor to insert the source at the caret',
        snippetCatalog().filter(row => row.payload.language !== 'c' && row.payload.language !== 'cpp'),
      )
    /*
     * The FPGA flow elaborates the same HDL the editor does, so its dock offers
     * the same rows and its source box takes the same drops.
     */
    case 'fpga':
      return library(
        'HDL blocks',
        'Search modules and entities…',
        'Drop in the source to insert the block at the caret',
        snippetCatalog().filter(row => row.payload.language !== 'c' && row.payload.language !== 'cpp'),
      )
    case 'embedded':
      return library(
        'Firmware',
        'Search sketches and drivers…',
        'Drop in the editor to insert the source at the caret',
        snippetCatalog().filter(row => row.payload.language === 'c' || row.payload.language === 'cpp'),
      )
    case 'structures':
      return library(
        'Standard trusses',
        'Search Pratt, Warren, king-post…',
        'Drop on the sheet to load a frame the solver already closes on',
        trussCatalog(),
      )
    case 'biology':
      return library(
        'Life models',
        'Search enzyme, mitochondrion, cable, infusion…',
        'Drop on the workspace to load a model the solver can run',
        bioCatalog(),
      )
    default:
      return null
  }
}

/** The machine rows are the simulator's own presets: dropping one switches the
 * workspace to that family and preset, so what lands on the sheet is a machine
 * the panel can actually solve. */
export function machineCatalog(): LibraryItemOf<'machine'>[] {
  const rows: LibraryItemOf<'machine'>[] = [
    ...DC_MACHINE_PRESETS.map(preset => ({
      id: `machine-dc-${preset.id}`,
      kind: 'machine' as const,
      name: preset.name,
      category: 'Brushed DC',
      spec: `${preset.parameters.resistanceOhm} Ω · ${preset.parameters.torqueConstantNmPerA.toFixed(3)} N·m/A`,
      description: preset.note,
      tags: ['dc', 'motor'],
      payload: { family: 'dc-motor' as const, presetId: preset.id },
    })),
    ...BLDC_PRESETS.map(preset => ({
      id: `machine-bldc-${preset.id}`,
      kind: 'machine' as const,
      name: preset.name,
      category: 'Brushless DC',
      spec: `${preset.parameters.phaseResistanceOhm} Ω · ${preset.parameters.polePairs} pole pairs`,
      description: preset.note,
      tags: ['bldc', 'motor'],
      payload: { family: 'bldc' as const, presetId: preset.id },
    })),
    ...STEPPER_PRESETS.map(preset => ({
      id: `machine-stepper-${preset.id}`,
      kind: 'machine' as const,
      name: preset.name,
      category: 'Steppers',
      spec: `${preset.parameters.holdingTorqueNm} N·m · ${((preset.parameters.stepAngleRad * 180) / Math.PI).toFixed(1)}°/step`,
      description: preset.note,
      tags: ['stepper', 'motor'],
      payload: { family: 'stepper' as const, presetId: preset.id },
    })),
  ]
  return rows
}
