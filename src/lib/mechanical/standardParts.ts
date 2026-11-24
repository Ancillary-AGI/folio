/**
 * Standard mechanical parts, in the sizes engineers actually buy.
 *
 * Every row carries the standard it comes from and the dimensions that standard
 * publishes — thread size, across-flats, width series, bore/OD/width. Nothing
 * here is invented: where a standard gives a choice the row names the series it
 * took, and where the solid model can only draw a box the row says what is
 * omitted and `envelopeExcess` states, in percent, what the box costs in mass.
 *
 * Dimensions are millimetres in the tables and metres everywhere the store and
 * the analyser read them, so `buildStandardPartSolids` is the only place the two
 * can disagree.
 */
import {
  buildPart,
  constraintsFor,
  type MechanicalPart,
  type MechanicalPartKind,
} from './partModel'
import { requireMaterial } from './materials'

const MM = 0.001

export type PartFamily =
  | 'bolt'
  | 'screw'
  | 'nut'
  | 'washer'
  | 'bearing'
  | 'shaft'
  | 'gear'
  | 'pulley'
  | 'hollow section'
  | 'extrusion'
  | 'spring'
  | 'plate'
  | 'rail'
  | 'motor'
  | 'standoff'
  | 'pin'

/**
 * The real cross-section of a solid, so its true volume can be compared with
 * the rectangular prism the viewport and the analyser use.
 * - `box` — rectangular section.
 * - `round` — circular section, diameter = the box's width (and height).
 * - `hex` — hexagon measured across flats.
 * `holeMm` drills a coaxial circular bore through any of them.
 */
export type SolidShape = 'box' | 'round' | 'hex'

/** One rectangular solid of a part, in millimetres, offset from the part origin. */
export interface StandardSolid {
  /** Suffix appended to the part id so each solid stays individually selectable. */
  suffix: string
  kind: MechanicalPartKind
  /** Length (the span axis), width and height in millimetres. */
  box: [number, number, number]
  /** Offset of this solid's centre from the part origin, millimetres. */
  offset: [number, number, number]
  shape?: SolidShape
  /** Coaxial bore diameter, millimetres. */
  holeMm?: number
}

export interface StandardPart {
  id: string
  name: string
  family: PartFamily
  /** The standard that fixes the dimensions, e.g. `ISO 4014`. */
  standard: string
  /** What a drawing or a BOM would call it: `M6×20`, `608-2RS`, `20×20×2`. */
  spec: string
  materialKey: string
  solids: StandardSolid[]
  /** What the box model omits, in words. */
  note?: string
  tags: string[]
}

/* ---------------------------------------------------------------- *
 * True volume of one solid
 * ---------------------------------------------------------------- */

/** Cross-sectional area perpendicular to the span axis, square millimetres. */
function sectionArea(solid: StandardSolid): number {
  const [, width, height] = solid.box
  const hole = ((solid.holeMm ?? 0) ** 2) * (Math.PI / 4)
  switch (solid.shape ?? 'box') {
    case 'box':
      return width * height - hole
    case 'round':
      // width = height = diameter for every round row in this catalogue.
      return (Math.PI / 4) * width * height - hole
    case 'hex':
      // A hexagon measured across flats: (√3/2)·s².
      return (Math.sqrt(3) / 2) * width * height - hole
  }
}

/** Envelope volume of one solid, cubic millimetres. */
export function solidEnvelopeVolumeMm3(solid: StandardSolid): number {
  const [length, width, height] = solid.box
  return length * width * height
}

/** The part's real material volume, cubic millimetres, from its published sections. */
export function partTrueVolumeMm3(part: StandardPart): number {
  return part.solids.reduce((total, solid) => total + sectionArea(solid) * solid.box[0], 0)
}

/**
 * How much heavier the drawn solids are than the parts they stand for, as a
 * fraction — `0.273` for a round bar, whose box envelope is 4/π of the cylinder.
 * Zero when the model is exact, and the dock prints it either way.
 */
export function envelopeExcess(part: StandardPart): number {
  const envelope = part.solids.reduce((total, solid) => total + solidEnvelopeVolumeMm3(solid), 0)
  const trueVolume = partTrueVolumeMm3(part)
  if (trueVolume <= 0) return 0
  return envelope / trueVolume - 1
}

/** `0.273…` → `'27.3%'`. */
export function formatExcess(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`
}

/* ---------------------------------------------------------------- *
 * Row builders
 * ---------------------------------------------------------------- */

/** Hex bolt: ISO 4014 gives the across-flats `s` and head height `k`. */
function bolt(threadMm: number, lengthMm: number, acrossFlatsMm: number, headKmm: number): StandardPart {
  return {
    id: `bolt-m${threadMm}x${lengthMm}`,
    name: `Hex bolt M${threadMm}×${lengthMm}`,
    family: 'bolt',
    standard: 'ISO 4014',
    spec: `M${threadMm}×${lengthMm}`,
    materialKey: 'steel',
    solids: [
      { suffix: 'shank', kind: 'beam', box: [lengthMm, threadMm, threadMm], offset: [0, 0, 0], shape: 'round' },
      { suffix: 'head', kind: 'plate', box: [headKmm, acrossFlatsMm, acrossFlatsMm], offset: [lengthMm / 2 + headKmm / 2, 0, 0], shape: 'hex' },
    ],
    note: `Shank Ø${threadMm} full thread; head across flats ${acrossFlatsMm}, height ${headKmm}.`,
    tags: ['fastener', 'threaded', `m${threadMm}`],
  }
}

/** ISO 4762 socket head cap screw: head diameter and height follow the thread. */
function capScrew(threadMm: number, lengthMm: number, headDiaMm: number, headKmm: number): StandardPart {
  return {
    id: `screw-m${threadMm}x${lengthMm}`,
    name: `Socket head cap screw M${threadMm}×${lengthMm}`,
    family: 'screw',
    standard: 'ISO 4762',
    spec: `M${threadMm}×${lengthMm}`,
    materialKey: 'steel',
    solids: [
      { suffix: 'shank', kind: 'beam', box: [lengthMm, threadMm, threadMm], offset: [0, 0, 0], shape: 'round' },
      { suffix: 'head', kind: 'plate', box: [headKmm, headDiaMm, headDiaMm], offset: [lengthMm / 2 + headKmm / 2, 0, 0], shape: 'round' },
    ],
    note: `Head Ø${headDiaMm}×${headKmm}, socket head for a 1.5–5 mm hex key by size.`,
    tags: ['fastener', 'socket', `m${threadMm}`],
  }
}

/** ISO 4032 hex nut: across-flats `s`, height `m`. */
function nut(threadMm: number, acrossFlatsMm: number, heightMm: number): StandardPart {
  return {
    id: `nut-m${threadMm}`,
    name: `Hex nut M${threadMm}`,
    family: 'nut',
    standard: 'ISO 4032',
    spec: `M${threadMm}`,
    materialKey: 'steel',
    solids: [
      { suffix: 'body', kind: 'plate', box: [heightMm, acrossFlatsMm, acrossFlatsMm], offset: [0, 0, 0], shape: 'hex', holeMm: threadMm },
    ],
    note: `Across flats ${acrossFlatsMm}, height ${heightMm}; the bore is taken as a Ø${threadMm} plain hole, so the thread flanks are not counted.`,
    tags: ['fastener', 'threaded', `m${threadMm}`],
  }
}

/** ISO 7093-1 series 200 form A washer: bore d1, outer d, thickness s. */
function washer(threadMm: number, boreMm: number, outerMm: number, thicknessMm: number): StandardPart {
  return {
    id: `washer-m${threadMm}`,
    name: `Plain washer M${threadMm}`,
    family: 'washer',
    standard: 'ISO 7093-1 (series 200, form A)',
    spec: `M${threadMm} Ø${outerMm}`,
    materialKey: 'steel',
    solids: [
      { suffix: 'body', kind: 'plate', box: [thicknessMm, outerMm, outerMm], offset: [0, 0, 0], shape: 'round', holeMm: boreMm },
    ],
    note: `Bore Ø${boreMm}, outer Ø${outerMm}, thickness ${thicknessMm}.`,
    tags: ['fastener', 'shim', `m${threadMm}`],
  }
}

/** DIN 627 / ISO 15 deep-groove ball bearing, sealed: bore d, OD D, width B. */
function bearing(code: string, boreMm: number, outerMm: number, widthMm: number): StandardPart {
  return {
    id: `bearing-${code.toLowerCase()}`,
    name: `Deep-groove bearing ${code}-2RS`,
    family: 'bearing',
    standard: 'DIN 627-1 / ISO 15 width series',
    spec: `${boreMm}×${outerMm}×${widthMm}`,
    materialKey: 'steel',
    solids: [
      { suffix: 'ring', kind: 'plate', box: [widthMm, outerMm, outerMm], offset: [0, 0, 0], shape: 'round', holeMm: boreMm },
    ],
    note: `Bore Ø${boreMm}, OD Ø${outerMm}, width ${widthMm}. Drawn as the race envelope: the balls and cage are not counted, so the bearing is still heavier than the finished part.`,
    tags: ['bearing', 'rotating', code.toLowerCase()],
  }
}

/** ISO 286 h9 turned stock. */
function roundBar(diameterMm: number, lengthMm: number, materialKey: string, code: string): StandardPart {
  return {
    id: `shaft-${code}`,
    name: `Round bar Ø${diameterMm}×${lengthMm}`,
    family: 'shaft',
    standard: 'ISO 286 h9',
    spec: `Ø${diameterMm}×${lengthMm}`,
    materialKey,
    solids: [
      { suffix: 'bar', kind: 'beam', box: [lengthMm, diameterMm, diameterMm], offset: [0, 0, 0], shape: 'round' },
    ],
    note: `Turned stock Ø${diameterMm} h9, measured length ${lengthMm}.`,
    tags: ['shaft', 'stock', `d${diameterMm}`],
  }
}

/** Spur gear blank: module `m`, `teeth` teeth, 20° pressure angle. */
function spurGear(moduleMm: number, teeth: number, faceWidthMm: number, materialKey: string): StandardPart {
  const pitch = moduleMm * teeth
  const outer = moduleMm * (teeth + 2)
  return {
    id: `gear-m${moduleMm}z${teeth}`,
    name: `Spur gear m${moduleMm} z${teeth}`,
    family: 'gear',
    standard: '20° pressure angle, ISO module series',
    spec: `m${moduleMm} z${teeth} Ø${outer}`,
    materialKey,
    solids: [
      { suffix: 'blank', kind: 'plate', box: [faceWidthMm, outer, outer], offset: [0, 0, 0], shape: 'round' },
    ],
    note: `Pitch circle Ø${pitch.toFixed(2)}, tip Ø${outer}, face width ${faceWidthMm}. Drawn as a solid tip cylinder: the teeth are not cut and no bore is specified, so it is heavier than the blank.`,
    tags: ['gear', 'transmission', `m${moduleMm}`, `z${teeth}`],
  }
}

/** GT2 timing pulley: 2 mm pitch belt; the tooth count sets the pitch diameter. */
function gt2Pulley(teeth: number, faceWidthMm: number, boreMm: number): StandardPart {
  const pitch = (2 * teeth) / Math.PI
  const outer = pitch + 1
  return {
    id: `pulley-gt2-${teeth}t`,
    name: `GT2 pulley ${teeth}T`,
    family: 'pulley',
    standard: 'Gates GT2, 2 mm pitch',
    spec: `${teeth}T bore ${boreMm}`,
    materialKey: 'aluminum',
    solids: [
      { suffix: 'body', kind: 'plate', box: [faceWidthMm, outer, outer], offset: [0, 0, 0], shape: 'round', holeMm: boreMm },
    ],
    note: `Pitch Ø${pitch.toFixed(2)}, tip Ø${outer.toFixed(1)}, face ${faceWidthMm}, bore Ø${boreMm}.`,
    tags: ['belt', 'pulley', 'gt2', 'transmission'],
  }
}

/**
 * Square hollow section as four walls, so the mass the analyser reports is the
 * tube's mass and not a solid bar's.
 */
function squareTube(
  id: string,
  label: string,
  outerMm: number,
  wallMm: number,
  lengthMm: number,
  materialKey: string,
  family: PartFamily,
  standard: string,
  tags: string[],
  note?: string,
): StandardPart {
  const inner = outerMm - 2 * wallMm
  const face = (sign: 1 | -1): StandardSolid => ({
    suffix: sign > 0 ? 'face+' : 'face-',
    kind: 'plate',
    box: [lengthMm, outerMm, wallMm],
    offset: [0, 0, (sign * (inner + wallMm)) / 2],
  })
  const web = (sign: 1 | -1): StandardSolid => ({
    suffix: sign > 0 ? 'web+' : 'web-',
    kind: 'plate',
    box: [lengthMm, wallMm, inner],
    offset: [0, (sign * (inner + wallMm)) / 2, 0],
  })
  return {
    id,
    name: `${label}×${lengthMm}`,
    family,
    standard,
    spec: `${outerMm}×${outerMm}×${wallMm}`,
    materialKey,
    solids: [face(1), face(-1), web(1), web(-1)],
    note,
    tags,
  }
}

/** NEMA stepper: square face, body length, Ø shaft. */
function nemaMotor(size: 17 | 23 | 24, faceMm: number, lengthMm: number, shaftMm: number): StandardPart {
  return {
    id: `motor-nema${size}`,
    name: `NEMA ${size} stepper, ${lengthMm} mm body`,
    family: 'motor',
    standard: 'NEMA 14-2014 mounting faces',
    spec: `${faceMm}□×${lengthMm}`,
    materialKey: 'steel',
    solids: [
      { suffix: 'body', kind: 'plate', box: [lengthMm, faceMm, faceMm], offset: [0, 0, 0] },
      { suffix: 'shaft', kind: 'beam', box: [24, shaftMm, shaftMm], offset: [lengthMm / 2 + 12, 0, 0], shape: 'round' },
    ],
    note: `Face ${faceMm} mm square with the standard bolt circle, body ${lengthMm} mm, Ø${shaftMm} shaft 24 mm long. Phase current and holding torque belong to the machine model in the Machines workspace.`,
    tags: ['motor', 'stepper', 'nema', `nema${size}`],
  }
}

/* ---------------------------------------------------------------- *
 * The catalogue
 * ---------------------------------------------------------------- */

const BOLTS: StandardPart[] = [
  bolt(3, 10, 5.5, 2.0),
  bolt(4, 12, 7.0, 2.8),
  bolt(5, 16, 8.0, 3.5),
  bolt(6, 20, 10.0, 4.0),
  bolt(8, 25, 13.0, 5.3),
  bolt(10, 40, 16.0, 6.4),
  bolt(12, 50, 18.0, 7.5),
]

const SCREWS: StandardPart[] = [
  capScrew(3, 12, 5.5, 3.0),
  capScrew(4, 16, 7.0, 4.0),
  capScrew(5, 20, 8.5, 5.0),
  capScrew(6, 25, 10.0, 6.0),
  capScrew(8, 30, 13.0, 8.0),
]

const NUTS: StandardPart[] = [
  nut(3, 5.5, 2.4),
  nut(4, 7.0, 4.0),
  nut(5, 8.0, 4.0),
  nut(6, 10.0, 5.2),
  nut(8, 13.0, 6.4),
  nut(10, 17.0, 8.0),
  nut(12, 18.0, 10.0),
]

const WASHERS: StandardPart[] = [
  washer(3, 3.2, 7.0, 0.5),
  washer(4, 4.3, 9.0, 0.8),
  washer(5, 5.3, 10.0, 1.0),
  washer(6, 6.4, 12.0, 1.6),
  washer(8, 8.4, 16.0, 2.0),
  washer(10, 10.5, 20.0, 2.0),
]

const BEARINGS: StandardPart[] = [
  bearing('MR104', 4, 10, 4),
  bearing('624', 4, 13, 5),
  bearing('625', 5, 14, 5),
  bearing('626', 6, 19, 6),
  bearing('608', 8, 22, 7),
  bearing('627', 7, 22, 7),
  bearing('628', 8, 24, 8),
  bearing('6200', 10, 30, 9),
  bearing('6201', 12, 32, 10),
  bearing('6202', 15, 35, 11),
  bearing('6203', 17, 40, 12),
  bearing('6204', 20, 47, 14),
  bearing('6205', 25, 52, 15),
  bearing('6206', 30, 62, 16),
  bearing('6208', 40, 80, 18),
]

const SHAFTS: StandardPart[] = [
  roundBar(5, 150, 'aluminum', 'al-5-150'),
  roundBar(6, 200, 'aluminum', 'al-6-200'),
  roundBar(8, 250, 'aluminum', 'al-8-250'),
  roundBar(10, 300, 'aluminum', 'al-10-300'),
  roundBar(12, 300, 'steel', 'st-12-300'),
  roundBar(16, 500, 'steel', 'st-16-500'),
  roundBar(20, 500, 'steel', 'st-20-500'),
]

const PINS: StandardPart[] = [
  {
    id: 'pin-m6x30',
    name: 'Dowel pin Ø6×30',
    family: 'pin',
    standard: 'ISO 2338 h6',
    spec: 'Ø6×30',
    materialKey: 'steel',
    solids: [{ suffix: 'pin', kind: 'beam', box: [30, 6, 6], offset: [0, 0, 0], shape: 'round' }],
    note: 'Ground unhardened pin, h6 at nominal Ø6.',
    tags: ['pin', 'location'],
  },
  {
    id: 'pin-m8x40',
    name: 'Dowel pin Ø8×40',
    family: 'pin',
    standard: 'ISO 2338 h6',
    spec: 'Ø8×40',
    materialKey: 'steel',
    solids: [{ suffix: 'pin', kind: 'beam', box: [40, 8, 8], offset: [0, 0, 0], shape: 'round' }],
    note: 'Ground unhardened pin, h6 at nominal Ø8.',
    tags: ['pin', 'location'],
  },
]

const GEARS: StandardPart[] = [
  spurGear(0.5, 20, 6, 'nylon'),
  spurGear(1, 20, 10, 'nylon'),
  spurGear(1, 40, 10, 'aluminum'),
  spurGear(1.5, 30, 15, 'steel'),
  spurGear(2, 25, 20, 'steel'),
]

const PULLEYS: StandardPart[] = [
  gt2Pulley(16, 10, 5),
  gt2Pulley(20, 10, 5),
  gt2Pulley(36, 11, 8),
]

const SPRINGS: StandardPart[] = [
  {
    id: 'spring-8-20',
    name: 'Compression spring Ø8×20',
    family: 'spring',
    standard: 'general purpose, music wire',
    spec: 'Ø8×20, wire 0.8',
    materialKey: 'steel',
    solids: [{ suffix: 'coil', kind: 'beam', box: [20, 8, 8], offset: [0, 0, 0] }],
    note: 'Free length 20 mm, wire Ø0.8, OD Ø8. Drawn as the coil envelope: neither the rate nor the envelope mass describes a real spring, so analyse it as a placeholder, not as a spring.',
    tags: ['spring', 'compression'],
  },
  {
    id: 'spring-10-25',
    name: 'Compression spring Ø10×25',
    family: 'spring',
    standard: 'general purpose, music wire',
    spec: 'Ø10×25, wire 1.0',
    materialKey: 'steel',
    solids: [{ suffix: 'coil', kind: 'beam', box: [25, 10, 10], offset: [0, 0, 0] }],
    note: 'Free length 25 mm, wire Ø1.0, OD Ø10. The spring rate is not modelled.',
    tags: ['spring', 'compression'],
  },
]

const STRUCTURE: StandardPart[] = [
  squareTube('shs-20-2', 'Square hollow section 20×20×2', 20, 2, 500, 'aluminum', 'hollow section', 'EN 10219, four walls', ['structure', 'tube', 'shs']),
  squareTube('shs-25-2.5', 'Square hollow section 25×25×2.5', 25, 2.5, 600, 'steel', 'hollow section', 'EN 10219, four walls', ['structure', 'tube', 'shs']),
  squareTube(
    'ext-2020',
    'T-slot extrusion 2020',
    20,
    2,
    300,
    'aluminum',
    'extrusion',
    '20 series, 6 mm slot',
    ['structure', 'extrusion', '2020', 't-slot'],
    'Four 2 mm walls. The 6 mm slots and the internal web are omitted, so this section is lighter and softer in shear than the real profile.',
  ),
  squareTube(
    'ext-4040',
    'T-slot extrusion 4040',
    40,
    3,
    500,
    'aluminum',
    'extrusion',
    '40 series, 10 mm slot',
    ['structure', 'extrusion', '4040', 't-slot'],
    'Four 3 mm walls; 10 mm slots and the web are omitted.',
  ),
  {
    id: 'rail-ts35-200',
    name: 'DIN rail TS35×15, 200 mm',
    family: 'rail',
    standard: 'EN 60715 TS35',
    spec: '35×15×1.5',
    materialKey: 'steel',
    solids: [
      { suffix: 'back', kind: 'plate', box: [200, 35, 1.5], offset: [0, 0, -15 / 2 + 0.75] },
      { suffix: 'lip+', kind: 'plate', box: [200, 1.5, 15], offset: [0, 35 / 2 - 0.75, 0] },
      { suffix: 'lip-', kind: 'plate', box: [200, 1.5, 15], offset: [0, -(35 / 2 - 0.75), 0] },
    ],
    note: 'Top-hat section drawn as a channel: the return lips that a housing clip snaps into are omitted.',
    tags: ['din', 'rail', 'enclosure'],
  },
]

const PLATES: StandardPart[] = [
  {
    id: 'plate-al-100-2',
    name: 'Aluminium sheet 100×100×2',
    family: 'plate',
    standard: '6061-T6 sheet',
    spec: '100×100×2',
    materialKey: 'aluminum',
    solids: [{ suffix: 'sheet', kind: 'plate', box: [100, 100, 2], offset: [0, 0, 0] }],
    tags: ['sheet', 'plate', 'bracket'],
  },
  {
    id: 'plate-al-150-3',
    name: 'Aluminium plate 150×150×3',
    family: 'plate',
    standard: '6061-T6 plate',
    spec: '150×150×3',
    materialKey: 'aluminum',
    solids: [{ suffix: 'plate', kind: 'plate', box: [150, 150, 3], offset: [0, 0, 0] }],
    tags: ['plate', 'base'],
  },
  {
    id: 'plate-st-200-5',
    name: 'Steel plate 200×100×5',
    family: 'plate',
    standard: 'A36 mill plate',
    spec: '200×100×5',
    materialKey: 'steel',
    solids: [{ suffix: 'plate', kind: 'plate', box: [200, 100, 5], offset: [0, 0, 0] }],
    tags: ['plate', 'base', 'ground'],
  },
  {
    id: 'plate-abs-120-4',
    name: 'ABS plate 120×80×4',
    family: 'plate',
    standard: 'machined stock',
    spec: '120×80×4',
    materialKey: 'abs',
    solids: [{ suffix: 'plate', kind: 'plate', box: [120, 80, 4], offset: [0, 0, 0] }],
    tags: ['plate', 'polymer', 'prototype'],
  },
]

const STANDOFFS: StandardPart[] = [
  {
    id: 'standoff-m25-6',
    name: 'Hex standoff M2.5×6',
    family: 'standoff',
    standard: 'PCB spacer, hex brass',
    spec: 'M2.5×6',
    materialKey: 'brass',
    solids: [{ suffix: 'body', kind: 'plate', box: [6, 5, 5], offset: [0, 0, 0], shape: 'hex', holeMm: 2.5 }],
    note: 'Female-female spacer, 6 mm body across flats 5; the M2.5 bores at each end are not modelled.',
    tags: ['pcb', 'standoff', 'spacer'],
  },
  {
    id: 'standoff-m3-10',
    name: 'Hex standoff M3×10',
    family: 'standoff',
    standard: 'PCB spacer, hex brass',
    spec: 'M3×10',
    materialKey: 'brass',
    solids: [{ suffix: 'body', kind: 'plate', box: [10, 5.5, 5.5], offset: [0, 0, 0], shape: 'hex', holeMm: 3 }],
    tags: ['pcb', 'standoff', 'spacer'],
  },
  {
    id: 'standoff-m3-nylon-11',
    name: 'Nylon standoff M3×11',
    family: 'standoff',
    standard: 'PCB spacer, hex nylon',
    spec: 'M3×11',
    materialKey: 'nylon',
    solids: [{ suffix: 'body', kind: 'plate', box: [11, 6, 6], offset: [0, 0, 0], shape: 'hex', holeMm: 3 }],
    tags: ['pcb', 'standoff', 'insulating'],
  },
]

const MOTORS: StandardPart[] = [
  nemaMotor(17, 42.4, 48, 5),
  nemaMotor(23, 56.4, 56, 6.35),
  nemaMotor(24, 60.4, 63.5, 8),
]

export const STANDARD_PARTS: readonly StandardPart[] = [
  ...BOLTS,
  ...SCREWS,
  ...NUTS,
  ...WASHERS,
  ...BEARINGS,
  ...SHAFTS,
  ...PINS,
  ...GEARS,
  ...PULLEYS,
  ...SPRINGS,
  ...STRUCTURE,
  ...PLATES,
  ...STANDOFFS,
  ...MOTORS,
]

export function standardPartById(id: string): StandardPart | undefined {
  return STANDARD_PARTS.find(part => part.id === id)
}

/* ---------------------------------------------------------------- *
 * Placement
 * ---------------------------------------------------------------- */

/**
 * Where the next dropped part lands, in metres.
 *
 * The viewport has no screen-to-world pick (the camera is not exposed to the
 * panel), so a drop cannot claim the pixel it was released on. Instead each part
 * takes the next free cell of a regular grid, which keeps repeated drops apart
 * and makes the assembly position reproducible: the same drop order always
 * gives the same coordinates.
 */
export function nextPlacementOrigin(
  existing: readonly MechanicalPart[],
  options: { pitchM?: number; perRow?: number } = {},
): [number, number, number] {
  const pitch = options.pitchM ?? 0.12
  const perRow = options.perRow ?? 6
  const slot = existing.length
  return [(slot % perRow) * pitch - 0.3, 0, Math.floor(slot / perRow) * pitch]
}

/**
 * Ids for a placed row's solids. The row's own id is the stem, so two drops of
 * the same part still produce distinct, readable ids.
 */
export function uniquePartIds(
  taken: ReadonlySet<string>,
  stem: string,
  suffixes: readonly string[],
): string[] {
  const ids: string[] = []
  let attempt = 0
  for (const suffix of suffixes) {
    let id = `${stem}-${suffix}`
    attempt += 1
    while (taken.has(id) || ids.includes(id)) {
      attempt += 1
      id = `${stem}-${suffix}-${attempt}`
    }
    ids.push(id)
  }
  return ids
}

/**
 * Turn a catalogue row into store-ready parts.
 *
 * `idFor` is supplied by the caller because part ids have to be unique inside
 * one assembly, and only the assembly knows what it already holds.
 */
export function buildStandardPartSolids(
  part: StandardPart,
  options: {
    idFor: (suffix: string, index: number) => string
    origin: [number, number, number]
    support?: 'fixed' | 'pinned' | 'roller' | 'free'
  },
): MechanicalPart[] {
  // A typo in `materialKey` would otherwise become steel without saying so.
  requireMaterial(part.materialKey)
  const constraints = constraintsFor(options.support ?? 'free')
  return part.solids.map((solid, index) => {
    const [length, width, height] = solid.box
    return buildPart({
      id: options.idFor(solid.suffix, index),
      name: index === 0 ? part.name : `${part.name} (${solid.suffix})`,
      kind: solid.kind,
      dimensions: { length: length * MM, width: width * MM, height: height * MM },
      position: [
        options.origin[0] + solid.offset[0] * MM,
        options.origin[1] + solid.offset[1] * MM,
        options.origin[2] + solid.offset[2] * MM,
      ],
      materialKey: part.materialKey,
      constraints,
    })
  })
}

/** A dock row reduced to the solids it carries — metres, exactly as written. */
export interface SolidRow {
  id: string
  name: string
  materialKey: string
  support: 'fixed' | 'pinned' | 'roller' | 'free'
  solids: Array<{
    suffix: string
    kind: MechanicalPartKind
    dimensions: { length: number; width: number; height: number }
    offset: [number, number, number]
  }>
}

/**
 * Drop a dock row into an assembly.
 *
 * The row carries its own geometry, so placement does not have to hope the
 * catalogue still holds the id the drag was built from — a row dragged from a
 * stale tab drops the shape it showed, or the material lookup fails loudly.
 */
export function placeSolidRow(row: SolidRow, existing: readonly MechanicalPart[]): MechanicalPart[] {
  requireMaterial(row.materialKey)
  const origin = nextPlacementOrigin(existing)
  const taken = new Set(existing.map((part) => part.id))
  const ids = uniquePartIds(taken, row.id, row.solids.map((solid) => solid.suffix))
  const constraints = constraintsFor(row.support)
  return row.solids.map((solid, index) =>
    buildPart({
      id: ids[index],
      name: index === 0 ? row.name : `${row.name} (${solid.suffix})`,
      kind: solid.kind,
      dimensions: solid.dimensions,
      position: [origin[0] + solid.offset[0], origin[1] + solid.offset[1], origin[2] + solid.offset[2]],
      materialKey: row.materialKey,
      constraints,
    }),
  )
}
