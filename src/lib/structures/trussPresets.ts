/**
 * Ready-made trusses for the structures workspace.
 *
 * These are the shapes a drafter copies from a span table: a footbridge girder,
 * a roof truss, a wall bracket. Geometry is given in metres and loading in
 * newtons, and every preset is checked by `truss.test.ts`-style determinacy
 * arithmetic (`m + r = 2j`) before it can be dropped, so a preset that arrives
 * as a mechanism is a build failure rather than a user's afternoon.
 */
import type { TrussMember, TrussModel, TrussNode } from './truss'

export interface TrussPreset {
  id: string
  name: string
  /** One line on what it is for, because "Pratt truss" is not a use case. */
  use: string
  /** Distance between the outer bearings, in metres. */
  span: number
  note: string
  model: TrussModel
}

/** Build the chord joints of a multi-panel girder at a fixed panel pitch. */
function chordRow(prefix: string, count: number, pitch: number, y: number): TrussNode[] {
  return Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}`, x: index * pitch, y }))
}

function member(id: string, from: string, to: string, area: number, material: TrussMember['material']): TrussMember {
  return { id, from, to, area, material }
}

/**
 * Pratt footbridge girder: six 2 m panels, rectangular outline with vertical end
 * posts, and diagonals that slope down towards midspan so every diagonal is in
 * tension under gravity load — the reason the Pratt was the standard cheap
 * bridge form. Chords 16 cm², web 8 cm² in S355; deck load 15 kN per interior
 * panel point, 8 kN at the bearings.
 */
function prattFootbridge(): TrussModel {
  const bottom = chordRow('b', 7, 2, 0)
  const top = chordRow('t', 7, 2, 2.5)
  const members: TrussMember[] = []

  for (let i = 0; i < 6; i += 1) {
    members.push(member(`bottom-${i}`, `b${i}`, `b${i + 1}`, 1.6e-3, 'steel-s355'))
    members.push(member(`top-${i}`, `t${i}`, `t${i + 1}`, 1.6e-3, 'steel-s355'))
  }
  for (let i = 0; i < 7; i += 1) {
    members.push(member(`post-${i}`, `b${i}`, `t${i}`, 8e-4, 'steel-s355'))
  }
  // Left half falls towards the centre; the right half mirrors it.
  members.push(member('diag-0', 't0', 'b1', 8e-4, 'steel-s355'))
  members.push(member('diag-1', 't1', 'b2', 8e-4, 'steel-s355'))
  members.push(member('diag-2', 't2', 'b3', 8e-4, 'steel-s355'))
  members.push(member('diag-3', 't4', 'b3', 8e-4, 'steel-s355'))
  members.push(member('diag-4', 't5', 'b4', 8e-4, 'steel-s355'))
  members.push(member('diag-5', 't6', 'b5', 8e-4, 'steel-s355'))

  return {
    nodes: [...bottom, ...top],
    members,
    supports: [
      { node: 'b0', holdsX: true, holdsY: true },
      { node: 'b6', holdsX: false, holdsY: true },
    ],
    loads: bottom.map((node, index) => ({
      node: node.id,
      fx: 0,
      fy: -(index === 0 || index === bottom.length - 1 ? 8e3 : 15e3),
    })),
  }
}

/**
 * Warren girder: five equilateral 2.4 m panels. The zigzag web is the minimum
 * member count that stays rigid once the top chord is present, which is why the
 * Warren is the lightest of the parallel-chord forms — and why it wants verticals
 * once the deck hangs off the bottom chord at panel points.
 */
function warrenGirder(): TrussModel {
  const pitch = 2.4
  // Equilateral: the apex stands over the panel midpoint at √3/2 × pitch.
  const depth = pitch * (Math.sqrt(3) / 2)
  const bottom = chordRow('b', 6, pitch, 0)
  const top: TrussNode[] = Array.from({ length: 5 }, (_, index) => ({
    id: `t${index + 1}`,
    x: (index + 0.5) * pitch,
    y: depth,
  }))
  const members: TrussMember[] = []

  for (let i = 0; i < 5; i += 1) {
    members.push(member(`bottom-${i}`, `b${i}`, `b${i + 1}`, 2e-3, 'steel-s355'))
  }
  for (let i = 0; i < 4; i += 1) {
    members.push(member(`top-${i}`, `t${i + 1}`, `t${i + 2}`, 2e-3, 'steel-s355'))
  }
  for (let i = 0; i < 5; i += 1) {
    members.push(member(`rise-${i}`, `b${i}`, `t${i + 1}`, 1e-3, 'steel-s355'))
    members.push(member(`fall-${i}`, `t${i + 1}`, `b${i + 1}`, 1e-3, 'steel-s355'))
  }

  return {
    nodes: [...bottom, ...top],
    members,
    supports: [
      { node: 'b0', holdsX: true, holdsY: true },
      { node: 'b5', holdsX: false, holdsY: true },
    ],
    loads: bottom.map((node, index) => ({
      node: node.id,
      fx: 0,
      fy: -(index === 0 || index === bottom.length - 1 ? 10e3 : 20e3),
    })),
  }
}

/**
 * King-post roof truss: the three-piece timber truss every pitched roof starts
 * from. 4 m span, 1.5 m rise, 40 × 30 mm C24 members, a 5 kN ridge load from the
 * purlins.
 *
 * The determinate answer is worth stating plainly because it surprises people:
 * a load applied *at* the ridge joint runs down the rafters into the wall plates
 * and the post carries nothing at all. The post earns its keep when the load
 * arrives at the middle of the tie — a ceiling, a tank — where it hangs that
 * joint from the ridge and works in tension. Both cases are asserted in
 * `trussPresets.test.ts` rather than smoothed over here.
 */
function kingPostRoof(): TrussModel {
  return {
    nodes: [
      { id: 'left-foot', x: 0, y: 0 },
      { id: 'tie-middle', x: 2, y: 0 },
      { id: 'right-foot', x: 4, y: 0 },
      { id: 'ridge', x: 2, y: 1.5 },
    ],
    members: [
      member('tie-left', 'left-foot', 'tie-middle', 1.2e-3, 'timber-c24'),
      member('tie-right', 'tie-middle', 'right-foot', 1.2e-3, 'timber-c24'),
      member('rafter-left', 'left-foot', 'ridge', 1.2e-3, 'timber-c24'),
      member('rafter-right', 'ridge', 'right-foot', 1.2e-3, 'timber-c24'),
      member('king-post', 'ridge', 'tie-middle', 1.2e-3, 'timber-c24'),
    ],
    supports: [
      { node: 'left-foot', holdsX: true, holdsY: true },
      { node: 'right-foot', holdsX: false, holdsY: true },
    ],
    loads: [{ node: 'ridge', fx: 0, fy: -5e3 }],
  }
}

/**
 * Canopy bracket: a horizontal boom to the wall plate and a diagonal strut under
 * it, the shape used for awnings and sign gantries. The boom is in tension, the
 * strut in compression, and the strut is the member that decides the section —
 * which is why it is the one sized well above its stress demand.
 */
function canopyBracket(): TrussModel {
  return {
    nodes: [
      { id: 'wall-low', x: 0, y: 0 },
      { id: 'wall-high', x: 0, y: 2 },
      { id: 'tip', x: 2, y: 2 },
    ],
    members: [
      member('boom', 'wall-high', 'tip', 1.5e-3, 'aluminium-6061'),
      member('strut', 'wall-low', 'tip', 3e-3, 'aluminium-6061'),
    ],
    supports: [
      { node: 'wall-high', holdsX: true, holdsY: true },
      { node: 'wall-low', holdsX: true, holdsY: true },
    ],
    loads: [{ node: 'tip', fx: 0, fy: -10e3 }],
  }
}

export const TRUSS_PRESETS: readonly TrussPreset[] = [
  {
    id: 'pratt-footbridge',
    name: 'Pratt footbridge girder',
    use: 'Six-panel pedestrian girder, deck hung off the bottom chord',
    span: 12,
    note: 'Diagonals fall towards midspan so they work in tension; 15 kN per panel point is a 1.2 m wide deck at 5 kN/m² plus self-weight.',
    model: prattFootbridge(),
  },
  {
    id: 'warren-girder',
    name: 'Warren girder',
    use: 'Five equilateral panels, the lightest parallel-chord web',
    span: 12,
    note: 'No web verticals: the zigzag plus the top chord is exactly rigid. Loads hang at the bottom panel points.',
    model: warrenGirder(),
  },
  {
    id: 'kingpost-roof',
    name: 'King-post roof truss',
    use: '4 m pitched roof in C24 softwood',
    span: 4,
    note: 'A load at the ridge joint runs straight down the rafters into the wall plates; the tie is what removes the outward thrust, and the post only carries a load hung on the middle of the tie.',
    model: kingPostRoof(),
  },
  {
    id: 'canopy-bracket',
    name: 'Canopy bracket',
    use: 'Aluminium awning bracket off a wall, 10 kN at the tip',
    span: 2,
    note: 'Boom in tension, strut in compression — the strut is sized for Euler buckling, not for stress.',
    model: canopyBracket(),
  },
]

export function trussPresetById(id: string): TrussPreset | undefined {
  return TRUSS_PRESETS.find((preset) => preset.id === id)
}

/** Joint count, member count and restraint count, for the determinacy read-out. */
export function trussCounts(model: TrussModel): { joints: number; members: number; restraints: number } {
  const restraints = model.supports.reduce(
    (sum, support) => sum + (support.holdsX ? 1 : 0) + (support.holdsY ? 1 : 0),
    0,
  )
  return { joints: model.nodes.length, members: model.members.length, restraints }
}

/**
 * Whether the member and restraint count can even hold the joints: for a pin-jointed
 * planar frame `m + r = 2j` is statically determinate, less is a mechanism and more
 * is redundant. It is a necessary condition, not a sufficient one — a truss can
 * satisfy the count and still be locally unstable — so the solver is the final word
 * and this only tells the user which way to look before running it.
 */
export function trussDeterminacy(
  model: TrussModel,
): { kind: 'determinate' | 'mechanism' | 'redundant'; members: number; restraints: number; joints: number } {
  const { joints, members, restraints } = trussCounts(model)
  const available = 2 * joints
  if (members + restraints < available) return { kind: 'mechanism', members, restraints, joints }
  if (members + restraints === available) return { kind: 'determinate', members, restraints, joints }
  return { kind: 'redundant', members, restraints, joints }
}
