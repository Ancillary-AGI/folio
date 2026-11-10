/**
 * Planar pin-jointed truss analysis by the direct stiffness method.
 *
 * This is the member-and-joint half of structural mechanics: the beam and shaft
 * closed forms in `../mechanical/structural` answer questions about one member,
 * and this answers questions about an assembly of them — the roof truss, the
 * bridge girder, the gantry frame. Each member is a two-force bar: it carries
 * axial force only, its ends are pin connections, and loads act at the joints.
 * That is the classical textbook model, and the checks here are written against
 * it, not against a guess.
 *
 * Conventions
 * -----------
 * - Metres, newtons and pascals throughout; the panel converts to kN and mm.
 * - Member force is positive in tension, negative in compression — the sign
 *   engineers draw on a lattice diagram.
 * - A joint held in a direction has that degree of freedom set to zero and its
 *   reaction recovered from the *unreduced* equation row, so the reactions are
 *   the solver's own numbers rather than a statics afterthought.
 *
 * Nothing is smoothed over: a model with a member that joins nothing, or a bar
 * of no length, throws; a structure that is a mechanism is reported with the
 * joint and axis that let it move, instead of a displacement field of zeroes.
 */
import { solveLinearSystem } from '../ml/linalg'

/** A joint. `x` and `y` are metres in a right-handed, in-plane frame. */
export interface TrussNode {
  id: string
  x: number
  y: number
}

/** A bar between two joints. */
export interface TrussMember {
  id: string
  /** Node id, not index: a preset stays readable when joints are added. */
  from: string
  to: string
  /** Cross-sectional area in m². */
  area: number
  material: TrussMaterialId
}

/** A restraint. Both faces false is a free joint and is not a support. */
export interface TrussSupport {
  node: string
  holdsX: boolean
  holdsY: boolean
}

/** A force applied at a joint, in newtons. */
export interface TrussLoad {
  node: string
  fx: number
  fy: number
}

export interface TrussModel {
  nodes: readonly TrussNode[]
  members: readonly TrussMember[]
  supports: readonly TrussSupport[]
  loads: readonly TrussLoad[]
}

export interface TrussMaterial {
  id: TrussMaterialId
  label: string
  /** Young's modulus in Pa. */
  elasticModulus: number
  /** Yield (or ultimate, for timber) strength in Pa, used for the utilisation check. */
  strength: number
  /** A one-line provenance note, because a material card the user cannot check is a claim. */
  source: string
}

export type TrussMaterialId = 'steel-s355' | 'aluminium-6061' | 'timber-c24'

/**
 * Published room-temperature values for the three material families a hobbyist
 * or a site engineer actually buys. `elasticModulus` for structural steel is
 * 200 GPa in every code (Eu3's 210 GPa differs by 5 % and is noted below);
 * 6061-T6 is quoted at 68.9 GPa / 276 MPa by the ASM handbook; C24 softwood is
 * EN 338 with E = 11 GPa and 24 MPa bending strength parallel to grain.
 */
export const TRUSS_MATERIALS: Readonly<Record<TrussMaterialId, TrussMaterial>> = {
  'steel-s355': {
    id: 'steel-s355',
    label: 'Structural steel S355',
    elasticModulus: 200e9,
    strength: 355e6,
    source: 'EN 10025 yield 355 MPa; E taken as 200 GPa',
  },
  'aluminium-6061': {
    id: 'aluminium-6061',
    label: 'Aluminium 6061-T6',
    elasticModulus: 68.9e9,
    strength: 276e6,
    source: 'ASM handbook: E 68.9 GPa, yield 276 MPa',
  },
  'timber-c24': {
    id: 'timber-c24',
    label: 'Softwood C24',
    elasticModulus: 11e9,
    strength: 24e6,
    source: 'EN 338 C24: E 11 GPa, bending 24 MPa parallel to grain',
  },
}

/** A joint's displacement, in metres. */
export interface TrussDisplacement {
  x: number
  y: number
}

export interface TrussReaction {
  x: number
  y: number
}

export interface TrussMemberDemand {
  /** Axial force in newtons; positive is tension. */
  force: number
  /** σ = F/A in pascals, signed like the force. */
  stress: number
  /** |σ| / strength. Above 1 means the bar is over its own capacity. */
  utilisation: number
  /** Slenderness `L / r`, `r = √(I/A)` for a circular bar of the same area. */
  slenderness: number
  /**
   * Euler buckling load for the bar treated as pin-ended with a solid circular
   * section of the same area, in newtons. `null` in tension, which cannot buckle.
   */
  bucklingLoad: number | null
}

export interface TrussResult {
  displacements: Readonly<Record<string, TrussDisplacement>>
  members: Readonly<Record<string, TrussMemberDemand>>
  reactions: Readonly<Record<string, TrussReaction>>
  /** Largest joint displacement from the origin of the loaded shape, in metres. */
  maxDisplacement: number
  /** Node id carrying that displacement, so the panel can point at it. */
  maxDisplacementNode: string
  /** Applied load and recovered reaction, per axis, for the closure read-out. */
  equilibrium: { appliedX: number; appliedY: number; reactionX: number; reactionY: number }
  /** Anything the model says that is not an error but the user should see. */
  notes: string[]
}

export interface TrussAnalysis {
  result: TrussResult | null
  error: string | null
}

const EPSILON = 1e-12

function fail(message: string): TrussAnalysis {
  return { result: null, error: message }
}

/** Throws for a model that is not a model at all, because no answer is meaningful. */
function assertWellFormed(model: TrussModel): ReadonlyMap<string, TrussNode> {
  const byId = new Map<string, TrussNode>()
  for (const node of model.nodes) {
    if (!node.id) throw new Error('Every truss joint needs an id.')
    if (byId.has(node.id)) throw new Error(`Duplicate joint id ${node.id}.`)
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) {
      throw new Error(`Joint ${node.id} has a non-finite coordinate.`)
    }
    byId.set(node.id, node)
  }
  if (byId.size < 2) throw new Error('A truss needs at least two joints.')
  for (const member of model.members) {
    const a = byId.get(member.from)
    const b = byId.get(member.to)
    if (!a || !b) throw new Error(`Member ${member.id} joins ${member.from} to ${member.to}; one of them is not a joint.`)
    if (member.from === member.to) throw new Error(`Member ${member.id} connects joint ${member.from} to itself.`)
    if (!Number.isFinite(member.area) || member.area <= 0) {
      throw new Error(`Member ${member.id} needs a positive cross-sectional area.`)
    }
    if (Math.hypot(b.x - a.x, b.y - a.y) < EPSILON) {
      throw new Error(`Member ${member.id} has no length: ${member.from} and ${member.to} are the same point.`)
    }
  }
  if (model.members.length === 0) throw new Error('A truss needs at least one member.')
  for (const support of model.supports) {
    if (!byId.has(support.node)) throw new Error(`Support names ${support.node}, which is not a joint.`)
    if (!support.holdsX && !support.holdsY) {
      throw new Error(`Support at ${support.node} holds nothing; remove it or name an axis.`)
    }
  }
  for (const load of model.loads) {
    if (!byId.has(load.node)) throw new Error(`Load names ${load.node}, which is not a joint.`)
  }
  return byId
}

/** Direction cosines of a member, from `from` towards `to`. */
function direction(a: TrussNode, b: TrussNode): { length: number; cos: number; sin: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  return { length, cos: dx / length, sin: dy / length }
}

/**
 * The 4×4 global stiffness of one bar, ordered [from·x, from·y, to·x, to·y].
 *
 * This is the standard transformed bar matrix `k · TᵀT` written out: with
 * `c = cosθ`, `s = sinθ` and `k = EA/L` the outer rows are the negative of the
 * inner cross terms, which is what makes the assembled matrix symmetric.
 */
function memberStiffness(member: TrussMember, a: TrussNode, b: TrussNode): number[][] {
  const { length, cos, sin } = direction(a, b)
  const modulus = TRUSS_MATERIALS[member.material].elasticModulus
  const k = (modulus * member.area) / length
  const xx = k * cos * cos
  const xy = k * cos * sin
  const yy = k * sin * sin
  return [
    [xx, xy, -xx, -xy],
    [xy, yy, -xy, -yy],
    [-xx, -xy, xx, xy],
    [-xy, -yy, xy, yy],
  ]
}

/**
 * Solve a planar pin-jointed truss.
 *
 * The global system is assembled over `2n` degrees of freedom, split into the
 * restrained and free sets, and the free block is solved. Reactions are then the
 * restrained rows of the *full* `K·u − f` residual, so equilibrium is checked
 * against the same numbers that produced the displacements rather than against a
 * separate statics pass that could disagree with it.
 */
export function solveTruss(model: TrussModel): TrussAnalysis {
  const byId = assertWellFormed(model)
  const nodes = model.nodes
  const dofOf = new Map<string, number>()
  nodes.forEach((node, index) => {
    dofOf.set(node.id, index * 2)
  })
  const size = nodes.length * 2

  const stiffness: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0))
  for (const member of model.members) {
    const a = byId.get(member.from) as TrussNode
    const b = byId.get(member.to) as TrussNode
    const local = memberStiffness(member, a, b)
    const indices = [
      dofOf.get(a.id) as number,
      (dofOf.get(a.id) as number) + 1,
      dofOf.get(b.id) as number,
      (dofOf.get(b.id) as number) + 1,
    ]
    for (const [row, r] of indices.entries()) {
      for (const [col, c] of indices.entries()) {
        stiffness[r][c] += local[row][col]
      }
    }
  }

  const force = new Array<number>(size).fill(0)
  const appliedX = model.loads.reduce((sum, load) => sum + load.fx, 0)
  const appliedY = model.loads.reduce((sum, load) => sum + load.fy, 0)
  for (const load of model.loads) {
    const row = dofOf.get(load.node) as number
    force[row] += load.fx
    force[row + 1] += load.fy
  }

  const restrained: boolean[] = new Array(size).fill(false)
  for (const support of model.supports) {
    const row = dofOf.get(support.node) as number
    if (support.holdsX) restrained[row] = true
    if (support.holdsY) restrained[row + 1] = true
  }
  const free: number[] = []
  for (let i = 0; i < size; i += 1) if (!restrained[i]) free.push(i)

  if (free.length === 0) return fail('Every degree of freedom is held, so nothing can move — remove a restraint.')

  const reduced = free.map((row) => free.map((col) => stiffness[row][col]))
  const reducedForce = free.map((row) => force[row])

  let freeDisplacements: number[]
  try {
    freeDisplacements = solveLinearSystem(reduced, reducedForce)
  } catch (error) {
    return fail(mechanismMessage(error, free, nodes))
  }

  const displacement = new Array<number>(size).fill(0)
  free.forEach((row, index) => {
    displacement[row] = freeDisplacements[index]
  })

  const reactions: Record<string, TrussReaction> = {}
  for (const node of nodes) {
    const row = dofOf.get(node.id) as number
    const heldX = restrained[row]
    const heldY = restrained[row + 1]
    if (!heldX && !heldY) continue
    const residual = (dof: number) => {
      let sum = 0
      for (let col = 0; col < size; col += 1) sum += stiffness[dof][col] * displacement[col]
      return sum - force[dof]
    }
    reactions[node.id] = {
      x: heldX ? residual(row) : 0,
      y: heldY ? residual(row + 1) : 0,
    }
  }

  const members: Record<string, TrussMemberDemand> = {}
  const notes: string[] = []
  for (const member of model.members) {
    const a = byId.get(member.from) as TrussNode
    const b = byId.get(member.to) as TrussNode
    const { length, cos, sin } = direction(a, b)
    const modulus = TRUSS_MATERIALS[member.material].elasticModulus
    const rowA = dofOf.get(a.id) as number
    const rowB = dofOf.get(b.id) as number
    const extension =
      (displacement[rowB] - displacement[rowA]) * cos +
      (displacement[rowB + 1] - displacement[rowA + 1]) * sin
    const forceValue = ((modulus * member.area) / length) * extension
    const stress = forceValue / member.area
    // A solid circular bar of the same area, so slenderness and the buckling
    // load mean something for a section the user has not specified further.
    const radius = Math.sqrt(member.area / Math.PI)
    const inertia = (Math.PI * radius ** 4) / 4
    const buckling = forceValue < 0
      ? (Math.PI ** 2 * modulus * inertia) / length ** 2
      : null
    if (buckling !== null && Math.abs(forceValue) > buckling) {
      notes.push(
        `${member.id} buckles before it yields: ${(Math.abs(forceValue) / 1e3).toFixed(1)} kN against an Euler load of ${(buckling / 1e3).toFixed(1)} kN.`,
      )
    }
    members[member.id] = {
      force: forceValue,
      stress,
      utilisation: Math.abs(stress) / TRUSS_MATERIALS[member.material].strength,
      slenderness: length / Math.sqrt(inertia / member.area),
      bucklingLoad: buckling,
    }
  }

  let maxDisplacement = 0
  let maxDisplacementNode = nodes[0].id
  const displacements: Record<string, TrussDisplacement> = {}
  for (const node of nodes) {
    const row = dofOf.get(node.id) as number
    const move = { x: displacement[row], y: displacement[row + 1] }
    displacements[node.id] = move
    const magnitude = Math.hypot(move.x, move.y)
    if (magnitude > maxDisplacement) {
      maxDisplacement = magnitude
      maxDisplacementNode = node.id
    }
  }

  const reactionX = Object.values(reactions).reduce((sum, r) => sum + r.x, 0)
  const reactionY = Object.values(reactions).reduce((sum, r) => sum + r.y, 0)

  if (Math.hypot(appliedX + reactionX, appliedY + reactionY) > 1e-6 * Math.max(1, Math.hypot(appliedX, appliedY))) {
    notes.push('Recovered reactions do not close on the applied load; the model is being loaded somewhere it is not held.')
  }

  return {
    result: {
      displacements,
      members,
      reactions,
      maxDisplacement,
      maxDisplacementNode,
      equilibrium: { appliedX, appliedY, reactionX, reactionY },
      notes,
    },
    error: null,
  }
}

/**
 * Turn a singular-matrix throw into a sentence about the structure.
 *
 * The reduced system's column is a free degree of freedom, so it names a joint
 * and an axis. A message that only says "singular" leaves the user hunting; this
 * points at the joint that is still able to move.
 */
function mechanismMessage(error: unknown, free: readonly number[], nodes: readonly TrussNode[]): string {
  const message = error instanceof Error ? error.message : String(error)
  const column = /column (\d+)/.exec(message)?.[1]
  const dof = column === undefined ? undefined : free[Number(column)]
  if (dof === undefined) {
    return `The truss is a mechanism — it can move without stretching anything. ${message}`
  }
  const node = nodes[Math.floor(dof / 2)]
  const axis = dof % 2 === 0 ? 'horizontal' : 'vertical'
  return `The truss is a mechanism: joint ${node.id} can still move ${axis}, so nothing holds it. Restrain it, or add the member that would.`
}

/** Distance between the two extreme joints, along X — the panel's deflection-scale denominator. */
export function trussSpan(nodes: readonly TrussNode[]): number {
  if (nodes.length === 0) return 0
  const xs = nodes.map((node) => node.x)
  return Math.max(...xs) - Math.min(...xs)
}

/** A multiple of the span a deflected shape is drawn at so it is visible but not grotesque. */
export function deflectionScale(maxDisplacement: number, span: number): number {
  if (!(maxDisplacement > 0) || !(span > 0)) return 1
  const target = span / 40
  const raw = target / maxDisplacement
  return Math.min(5000, Math.max(1, raw))
}

/** Member force in a readable unit, with tension named rather than implied by a sign. */
export function describeMemberForce(demand: TrussMemberDemand): string {
  const kilo = Math.abs(demand.force) / 1e3
  const kind = demand.force >= 0 ? 'tension' : 'compression'
  return `${kilo.toFixed(2)} kN ${kind}`
}
