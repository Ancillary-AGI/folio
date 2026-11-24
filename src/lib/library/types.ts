/**
 * The contract between the library dock and the workspaces that consume it.
 *
 * Every domain in Folio places things, but the things are not the same: a
 * schematic drops a symbol, the CAD viewport drops a solid, the control panel
 * cascades a transfer function, the firmware panel inserts a snippet. Rather
 * than giving each panel its own ad-hoc drag payload, one item shape carries a
 * `kind` and the payload that kind implies, and a panel declares which kinds it
 * accepts. A drop of the wrong kind is refused with a reason instead of being
 * swallowed.
 */
import type { PartDimensions, MechanicalPartKind } from '../mechanical/partModel'
import type { PowerBus, PowerBranch, FeederNode } from '../power/loadFlow'
import type { RobotArchitectureId } from '../robotics/robotLibrary'
import type { BiologicalScale } from '../biology/scales'

/**
 * Every kind the dock can carry, written once as a value.
 *
 * `LibraryKind` is read off this tuple rather than the other way round on
 * purpose. Two receivers need the kinds at runtime — `drag.ts` decides whether a
 * dropped payload is one of ours at all, and `dropZone.ts` names each kind in a
 * refusal sentence — and a second hand-written list is how the structures rows
 * came to be swallowed on the drop: a list that falls behind the union refuses
 * silently what the compiler happily accepts.
 */
export const LIBRARY_KINDS = [
  /** A schematic/PCB symbol already held in the project's part list. */
  'component',
  /** An ISO/DIN standard part reduced to the envelope solids the viewport draws. */
  'solid',
  'robot-element',
  'tf-block',
  'rf-element',
  'machine',
  'grid-element',
  'snippet',
  /** A published vendor SPICE `.model` card, for the solver's model deck. */
  'model-card',
  /** A standard truss form, for the structures workspace's lattice editor. */
  'truss',
  /** A complete biological model, for the biology workspace's scale rail. */
  'bio-model',
] as const

export type LibraryKind = typeof LIBRARY_KINDS[number]

export interface MechanicalSolidPayload {
  /** The standard the row claims, e.g. `ISO 4014`. */
  standard: string
  /** One or more prisms; a bolt is a shank plus a head, a bearing is one ring. */
  solids: Array<{
    suffix: string
    kind: MechanicalPartKind
    dimensions: PartDimensions
    /** Metres, relative to the placement origin. */
    offset: [number, number, number]
  }>
  materialKey: string
  support: 'fixed' | 'pinned' | 'roller' | 'free'
  /** How far the envelope overshoots the true volume, stated not hidden. */
  envelopeNote?: string
}

export interface RobotElementPayload {
  /**
   * The robotics engine only solves serial chains, so a row places a complete
   * architecture the panel can build and forward-kinematic, not a lone joint
   * that no solver would accept.
   */
  architecture: RobotArchitectureId
}

export interface ControlBlockPayload {
  numerator: number[]
  denominator: number[]
  /** The symbolic form the row shows, e.g. `1/(τs+1)`. */
  form: string
}

export interface RFElementPayload {
  /**
   * Which link-budget input the row drives. The budget is a single-hop model
   * with transmit/receive feed losses, a receiver noise figure and antenna
   * gains, so a row can only ever set one of those — and `role` says which.
   */
  role: 'antenna' | 'lna' | 'cable' | 'attenuator' | 'filter' | 'amplifier'
  /** dB value written to the field named by `role`. */
  valueDb: number
  /** `rx` or `tx` for the roles that have two sides (cable, antenna). */
  side?: 'rx' | 'tx'
  note: string
}

export interface MachinePayload {
  /** The simulator's own family tab, so a drop lands on a solvable machine. */
  family: 'dc-motor' | 'dc-generator' | 'bldc' | 'stepper'
  /** Id of the preset the simulator switches to. */
  presetId: string
}

export interface GridElementPayload {
  role: 'bus' | 'branch' | 'feeder-node'
  bus?: Partial<PowerBus>
  branch?: Partial<PowerBranch>
  feederNode?: Partial<FeederNode>
  /**
   * The conductor that joins a dropped feeder node to the node ahead of it.
   * Without it a drop would have to invent an impedance.
   */
  section?: { resistanceOhm: number; reactanceOhm: number; lengthKm: number }
}

export interface CodeSnippetPayload {
  /** The editor language the snippet is written for. */
  language: 'verilog' | 'systemverilog' | 'vhdl' | 'c' | 'cpp'
  text: string
}

export interface ComponentPayload {
  componentId: string
}

export interface ModelCardPayload {
  /** The manufacturer's part number the card is named for, e.g. `2N3904`. */
  device: string
  /** Whose model it is, since a row has to say where the numbers came from. */
  manufacturer: string
  /** The model type the deck parses: NPN, PNP, NMOS, PMOS, NJF, PJF or D. */
  modelType: 'NPN' | 'PNP' | 'NMOS' | 'PMOS' | 'NJF' | 'PJF' | 'D'
  /** The raw `.model` line, dropped into the deck verbatim. */
  spiceText: string
  /** Datasheet URL, when the entry carries one. */
  datasheetUrl?: string
}

/**
 * A standard truss form for the structures workspace.
 *
 * The row places the whole frame, not one bar: a lone member has no solution, so
 * the only drop the lattice editor can honour is a model its solver already
 * closes on its load.
 */
export interface TrussPayload {
  presetId: string
}

/**
 * A biological model for the biology workspace.
 *
 * A row places a whole model, never one equation: each of the six scales is a
 * solver that needs a complete parameter set to produce a number, and a lone
 * rate constant has no solution to show. `scale` says which view the panel must
 * open, because the same workspace holds a mitochondrial lump and a capillary
 * bed and only one of them is on screen at a time.
 */
export interface BioModelPayload {
  scale: BiologicalScale
  /** Id of the preset the panel switches to — a preset id from the model's own registry. */
  presetId: string
}

/**
 * `kind` and `payload` are paired, so a panel that switches on `item.kind` gets
 * the matching payload type from the compiler instead of a cast. `Distribute` is
 * what makes that happen: a conditional type over a naked parameter splits the
 * union into one member per kind, which is what TypeScript narrows on.
 */
export type PayloadFor<K extends LibraryKind> =
  K extends 'component' ? ComponentPayload
  : K extends 'solid' ? MechanicalSolidPayload
  : K extends 'robot-element' ? RobotElementPayload
  : K extends 'tf-block' ? ControlBlockPayload
  : K extends 'rf-element' ? RFElementPayload
  : K extends 'machine' ? MachinePayload
  : K extends 'grid-element' ? GridElementPayload
  : K extends 'snippet' ? CodeSnippetPayload
  : K extends 'model-card' ? ModelCardPayload
  : K extends 'truss' ? TrussPayload
  : K extends 'bio-model' ? BioModelPayload
  : never

export interface LibraryItemOf<K extends LibraryKind> {
  /** Namespaced and stable: `mech-M6x20`, `ip-fifo-16x256`. */
  id: string
  kind: K
  name: string
  /** The sticky header the row is filed under in the dock. */
  category: string
  /** Short right-aligned readout: `M6×20`, `4.7 nH`, `18 dB`. */
  spec?: string
  description?: string
  /**
   * Detail shown in the row's tooltip but not searched — pin geometry and
   * default properties for a symbol, the tolerance stack for a fit.
   */
  detail?: string
  tags?: string[]
  payload: PayloadFor<K>
}

type Distribute<K extends LibraryKind> = K extends unknown ? LibraryItemOf<K> : never

/** Any row in any domain's catalog. */
export type LibraryItem = Distribute<LibraryKind>
