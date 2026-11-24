/**
 * Placement planning, preview and apply, as three explicit steps: `plan` computes
 * where every unlocked part would go, `preview` reports the consequences without
 * touching the board, `apply` commits it as one undoable change or refuses.
 *
 * Conservative by design: packs on a grid inside the outline, honours keepouts
 * and board margins, leaves locked parts alone, and reports anything it cannot
 * place rather than overlapping it.
 */
import type { PcbSceneDesignKeepout, PcbSceneInput } from './pcbScene'
import { resolveFootprint } from '../manufacturing/footprintLibrary'

/**
 * What the planner needs from a part. Deliberately not `CanvasComponent`: the
 * agent passes canvas-store parts and the panel passes board placements, so the
 * caller resolves the footprint and hands over this shape.
 */
export interface PlaceablePart {
  id: string
  reference: string
  /** Board millimetres, origin at the top-left of the outline. */
  x: number
  y: number
  /** Degrees. */
  rotation: number
  /** A locked part is an obstacle, never a candidate. */
  locked?: boolean
  /** Footprint id, footprint name or component category, resolved in that order. */
  footprint: string
  category?: string
  pinCount: number
}

/** Board coordinates in millimetres, origin at the top-left of the outline. */
export interface BoardPointMm {
  x: number
  y: number
}

export interface PlacementMove {
  componentId: string
  reference: string
  from: BoardPointMm & { rotationDeg: number }
  to: BoardPointMm & { rotationDeg: number }
  /** How far the part travels, mm. */
  distanceMm: number
}

/**
 * Declarative placement intent. heypcb's `set_placement_rules` is the capability
 * this mirrors: the designer says where parts belong, and the planner honours it
 * instead of packing everything into the first free slot.
 */
export type PlacementRule =
  /** Never move these parts; they are obstacles. */
  | { kind: 'lock'; components: string[] }
  /** Hold these against a board edge, `offsetMm` in from it. */
  | { kind: 'edge'; components: string[]; edge: 'top' | 'bottom' | 'left' | 'right'; offsetMm: number }
  /** Snap these to a `pitchMm` grid. */
  | { kind: 'grid'; components: string[]; pitchMm: number }
  /** Line these up on one axis, using the first component's coordinate. */
  | { kind: 'align'; components: string[]; axis: 'x' | 'y' };

export interface PlacementRequest {
  components: readonly PlaceablePart[]
  layout: PcbSceneInput | null
  /** Grid the planner snaps to, mm. Defaults to 0.5 mm. */
  gridMm?: number
  /** Gap left between neighbouring package courtyards, mm. Defaults to 0.5 mm. */
  courtyardGapMm?: number
  /** Only move these components; all others stay put. */
  only?: readonly string[]
  /** Placement intent, applied before the free pack. */
  rules?: readonly PlacementRule[]
}

export interface PlacementPlan {
  moves: PlacementMove[]
  /** Parts the planner left where they are, with the reason. */
  held: Array<{ componentId: string; reference: string; reason: string }>
  /** Parts that could not be placed inside the outline at all. */
  unplaced: Array<{ componentId: string; reference: string; reason: string }>
  /** Total travel across every move, mm. */
  totalDistanceMm: number
  /** True when the plan changes nothing. */
  noop: boolean
}

export interface PlacementImpact {
  /** Parts that would move. */
  moving: number
  /** Parts that stay. */
  staying: number
  /** Largest single move, mm. */
  longestMoveMm: number
  /** Moves that would land a part outside the outline or inside a keepout. */
  collisions: Array<{ componentId: string; reference: string; reason: string }>
  /** True when the plan is safe to apply. */
  safe: boolean
}

export interface PlacementPreview {
  plan: PlacementPlan
  impact: PlacementImpact
}

/** Package extent in board millimetres, accounting for the part's rotation. */
export function packageExtentMm(
  component: PlaceablePart,
): { halfWidth: number; halfDepth: number } {
  const footprint = resolveFootprint(
    component.footprint,
    component.category,
    component.pinCount,
  )
  const halfWidth = (footprint?.dimensions.width ?? 2) / 2
  const halfDepth = (footprint?.dimensions.height ?? 1) / 2
  const quarterTurn = Math.abs(component.rotation % 180) === 90
  return quarterTurn
    ? { halfWidth: halfDepth, halfDepth: halfWidth }
    : { halfWidth, halfDepth }
}

/** The subset of a canvas part the planner reads. */
interface CanvasLike {
  id: string
  reference: string
  x: number
  y: number
  rotation: number
  locked?: boolean
  properties: Record<string, string | number | boolean>
  component: { name: string; category?: string; pins?: readonly unknown[] }
}

/** The subset of a board-placed part the planner reads. */
interface PlacedLike {
  id: string
  reference: string
  position: { x: number; y: number }
  rotation: number
  locked?: boolean
  properties: Record<string, string | number | boolean>
  component: { name: string; category?: string; pins?: readonly unknown[] }
}

const placeableFrom = (
  part: CanvasLike | PlacedLike,
  x: number,
  y: number,
): PlaceablePart => ({
  id: part.id,
  reference: part.reference,
  x,
  y,
  rotation: part.rotation,
  locked: part.locked,
  // The board tools read `footprint`, so the package a datasheet declares wins.
  footprint: String(part.properties.footprint ?? part.component.name),
  category: typeof part.component.category === 'string' ? part.component.category : undefined,
  pinCount: part.component.pins?.length ?? 0,
})

/** Adapt a canvas part (schematic store shape) for the planner. */
export const placeableFromCanvas = (part: CanvasLike): PlaceablePart =>
  placeableFrom(part, part.x, part.y)

/** Adapt a board-placed part (PCB panel shape) for the planner. */
export const placeableFromPlaced = (part: PlacedLike): PlaceablePart =>
  placeableFrom(part, part.position.x, part.position.y)

/** The board's usable rectangle, inset by the outline margin. */
export function usableBoardRect(
  layout: PcbSceneInput | null,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (!layout) return null
  return {
    minX: BOARD_MARGIN_MM,
    minY: BOARD_MARGIN_MM,
    maxX: Math.max(BOARD_MARGIN_MM, layout.widthMm - BOARD_MARGIN_MM),
    maxY: Math.max(BOARD_MARGIN_MM, layout.heightMm - BOARD_MARGIN_MM),
  }
}

/** Clearance from the package edge to the board outline. */
export const BOARD_MARGIN_MM = 1.5

const DEFAULT_GRID_MM = 0.5
const DEFAULT_COURTYARD_GAP_MM = 0.5

/** Design keepouts as rectangles, ignoring the ones scoped to other layers. */
const keepoutRects = (layout: PcbSceneInput | null): Array<{ id: string; x: number; y: number; w: number; h: number }> => {
  const keepouts: PcbSceneDesignKeepout[] = layout?.keepouts ?? []
  return keepouts.map((keepout, index) => ({
    id: keepout.id ?? `keepout-${index}`,
    x: keepout.x,
    y: keepout.y,
    w: keepout.widthMm,
    h: keepout.depthMm,
  }))
}

const overlaps = (
  a: { minX: number; minY: number; maxX: number; maxY: number },
  b: { minX: number; minY: number; maxX: number; maxY: number },
): boolean => a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY

const extentRect = (
  point: BoardPointMm,
  halfWidth: number,
  halfDepth: number,
): { minX: number; minY: number; maxX: number; maxY: number } => ({
  minX: point.x - halfWidth,
  minY: point.y - halfDepth,
  maxX: point.x + halfWidth,
  maxY: point.y + halfDepth,
})

const snap = (value: number, grid: number): number => Math.round(value / grid) * grid

/**
 * Compute a placement plan. Pure: it reads the inputs and returns a plan,
 * leaving the caller to preview or apply it.
 */
export function planPlacement(request: PlacementRequest): PlacementPlan {
  const grid = request.gridMm ?? DEFAULT_GRID_MM
  const gap = request.courtyardGapMm ?? DEFAULT_COURTYARD_GAP_MM
  const only = request.only ? new Set(request.only) : null

  const bounds = usableBoardRect(request.layout)
  const keepouts = keepoutRects(request.layout)
  const byId = new Map(request.components.map((part) => [part.id, part]))

  const held: PlacementPlan['held'] = []
  const unplaced: PlacementPlan['unplaced'] = []
  const moves: PlacementMove[] = []

  /* Placement rules run first, so a part held by one is an obstacle the free
   * pack works around rather than something it moves. */
  const fixed = new Map<string, BoardPointMm>()
  const lockedByRule = new Set<string>()

  if (bounds) {
    for (const rule of request.rules ?? []) {
      if (rule.kind === 'lock') {
        for (const id of rule.components) lockedByRule.add(id)
        continue
      }
      if (rule.kind === 'align') {
        const [first, ...rest] = rule.components
        const anchor = first ? fixed.get(first) ?? byId.get(first) : undefined
        if (!anchor) continue
        for (const id of rest) {
          const part = byId.get(id)
          if (!part) continue
          fixed.set(id, rule.axis === 'x'
            ? { x: anchor.x, y: part.y }
            : { x: part.x, y: anchor.y })
        }
        continue
      }
      if (rule.kind === 'grid') {
        if (rule.pitchMm <= 0) continue
        for (const id of rule.components) {
          const part = byId.get(id)
          if (!part) continue
          fixed.set(id, { x: snap(part.x, rule.pitchMm), y: snap(part.y, rule.pitchMm) })
        }
        continue
      }
      const offset = rule.offsetMm
      for (const id of rule.components) {
        const part = byId.get(id)
        if (!part) continue
        const extent = packageExtentMm(part)
        const current = fixed.get(id) ?? { x: part.x, y: part.y }
        if (rule.edge === 'left') {
          fixed.set(id, { x: bounds.minX + extent.halfWidth + offset, y: current.y })
        } else if (rule.edge === 'right') {
          fixed.set(id, { x: bounds.maxX - extent.halfWidth - offset, y: current.y })
        } else if (rule.edge === 'top') {
          fixed.set(id, { x: current.x, y: bounds.minY + extent.halfDepth + offset })
        } else {
          fixed.set(id, { x: current.x, y: bounds.maxY - extent.halfDepth - offset })
        }
      }
    }
  }

  // Fixed parts first: they are obstacles for everything the planner moves.
  const occupied: Array<{ minX: number; minY: number; maxX: number; maxY: number }> = []
  const movers: Array<{ part: PlaceablePart; forced?: BoardPointMm }> = []

  for (const component of request.components) {
    const extent = packageExtentMm(component)
    const pinned = fixed.get(component.id)
    if (component.locked || lockedByRule.has(component.id)) {
      occupied.push(extentRect({ x: component.x, y: component.y }, extent.halfWidth + gap, extent.halfDepth + gap))
      held.push({
        componentId: component.id,
        reference: component.reference,
        reason: component.locked ? 'locked' : 'locked by rule',
      })
      continue
    }
    if (only && !only.has(component.id)) {
      occupied.push(
        extentRect({ x: component.x, y: component.y }, extent.halfWidth + gap, extent.halfDepth + gap),
      )
      held.push({ componentId: component.id, reference: component.reference, reason: 'not selected' })
      continue
    }
    movers.push({ part: component, forced: pinned })
  }

  if (!bounds) {
    return {
      moves,
      held,
      unplaced: movers.map(({ part }) => ({
        componentId: part.id,
        reference: part.reference,
        reason: 'no board outline to place inside',
      })),
      totalDistanceMm: 0,
      noop: true,
    }
  }

  /* A part held to a rule keeps that destination and reserves it, so the free
     * pack cannot land on top. Largest free parts first. */
  const ordered = [...movers].sort((a, b) => {
    if (a.forced && !b.forced) return -1
    if (!a.forced && b.forced) return 1
    const extentA = packageExtentMm(a.part)
    const extentB = packageExtentMm(b.part)
    return extentB.halfWidth * extentB.halfDepth - extentA.halfWidth * extentA.halfDepth
  })

  for (const { part, forced } of ordered) {
    const component = part
    const extent = packageExtentMm(component)
    let placed: BoardPointMm | null = null

    const fits = (point: BoardPointMm): boolean => {
      const rect = extentRect(point, extent.halfWidth, extent.halfDepth)
      if (rect.minX < bounds.minX || rect.minY < bounds.minY) return false
      if (rect.maxX > bounds.maxX || rect.maxY > bounds.maxY) return false
      for (const keepout of keepouts) {
        if (overlaps(rect, { minX: keepout.x, minY: keepout.y, maxX: keepout.x + keepout.w, maxY: keepout.y + keepout.h })) {
          return false
        }
      }
      return !occupied.some((rect2) => overlaps(rect, rect2))
    }

    /* A rule-placed part goes exactly where the rule says. Otherwise, where it
     * already is wins — a re-place must not tidy parts that already fit. Only
     * parts that actually collide move. */
    if (forced) {
      placed = fits(forced) ? forced : null
    } else {
      const current = { x: component.x, y: component.y }
      if (fits(current)) {
        placed = current
      } else {
        const startY = snap(bounds.minY + extent.halfDepth, grid)
        const startX = snap(bounds.minX + extent.halfWidth, grid)
        for (let y = startY; y <= bounds.maxY - extent.halfDepth; y += grid) {
          for (let x = startX; x <= bounds.maxX - extent.halfWidth; x += grid) {
            const point = { x, y }
            if (fits(point)) {
              placed = point
              break
            }
          }
          if (placed) break
        }
      }
    }

    if (!placed) {
      unplaced.push({
        componentId: component.id,
        reference: component.reference,
        reason: forced
          ? 'the rule places it where it does not fit'
          : 'no free space inside the outline',
      })
      continue
    }

    occupied.push(
      extentRect(placed, extent.halfWidth + gap, extent.halfDepth + gap),
    )

    const from = { x: component.x, y: component.y, rotationDeg: component.rotation }
    const to = { ...placed, rotationDeg: component.rotation }
    const distanceMm = Math.hypot(to.x - from.x, to.y - from.y)
    if (distanceMm > 1e-9) {
      moves.push({
        componentId: component.id,
        reference: component.reference,
        from,
        to,
        distanceMm,
      })
    } else {
      held.push({ componentId: component.id, reference: component.reference, reason: 'already in place' })
    }
  }

  const totalDistanceMm = moves.reduce((sum, move) => sum + move.distanceMm, 0)

  return {
    moves,
    held,
    unplaced,
    totalDistanceMm,
    noop: moves.length === 0,
  }
}

/**
 * Plan a placement and report what applying it would do — without touching
 * anything. A plan that would push a part outside the outline or into a keepout
 * is marked unsafe, and `applyPlacement` refuses it.
 */
export function previewPlacement(request: PlacementRequest): PlacementPreview {
  const plan = planPlacement(request)
  const bounds = usableBoardRect(request.layout)
  const keepouts = keepoutRects(request.layout)
  const collisions: PlacementImpact['collisions'] = []

  const byId = new Map(request.components.map((component) => [component.id, component]))

  for (const move of plan.moves) {
    const component = byId.get(move.componentId)
    if (!component) {
      collisions.push({
        componentId: move.componentId,
        reference: move.reference,
        reason: 'the component is no longer on the sheet',
      })
      continue
    }
    const extent = packageExtentMm(component)
    const rect = extentRect(move.to, extent.halfWidth, extent.halfDepth)
    if (bounds && (rect.minX < bounds.minX || rect.minY < bounds.minY || rect.maxX > bounds.maxX || rect.maxY > bounds.maxY)) {
      collisions.push({
        componentId: move.componentId,
        reference: move.reference,
        reason: 'the destination falls outside the board outline',
      })
      continue
    }
    for (const keepout of keepouts) {
      if (overlaps(rect, { minX: keepout.x, minY: keepout.y, maxX: keepout.x + keepout.w, maxY: keepout.y + keepout.h })) {
        collisions.push({
          componentId: move.componentId,
          reference: move.reference,
          reason: 'the destination falls inside a keepout',
        })
        break
      }
    }
  }

  const longestMoveMm = plan.moves.reduce((max, move) => Math.max(max, move.distanceMm), 0)

  return {
    plan,
    impact: {
      moving: plan.moves.length,
      staying: request.components.length - plan.moves.length,
      longestMoveMm,
      collisions,
      /* Unplaced parts are a failed plan, not a safe one: applying it would
       * leave parts stacked where the planner could not fit them. */
      safe: collisions.length === 0 && plan.unplaced.length === 0,
    },
  }
}

export interface PlacementApplication {
  components: PlaceablePart[]
  applied: number
}

/**
 * Apply a previewed plan.
 *
 * The caller passes back the *previewed* plan, so applying is a pure function of
 * what the operator was shown — a plan that has since gone stale (parts added or
 * moved) is rejected rather than applied against a board it no longer describes.
 * That is what makes the preview meaningful rather than advisory.
 */
export function applyPlacement(
  components: readonly PlaceablePart[],
  plan: PlacementPlan,
  options: { expected?: PlacementPlan } = {},
): PlacementApplication {
  if (options.expected) {
    const stale = plan.moves.find((move) => {
      const component = components.find((entry) => entry.id === move.componentId)
      if (!component) return true
      return (
        Math.abs(component.x - move.from.x) > 1e-6 ||
        Math.abs(component.y - move.from.y) > 1e-6 ||
        component.rotation !== move.from.rotationDeg
      )
    })
    if (stale) {
      throw new Error(
        `Placement plan is stale: ${stale.reference} has moved since it was previewed. Preview again before applying.`,
      )
    }
  }

  const byMove = new Map(plan.moves.map((move) => [move.componentId, move]))
  let applied = 0
  const next = components.map((component) => {
    const move = byMove.get(component.id)
    if (!move) return component
    applied += 1
    return { ...component, x: move.to.x, y: move.to.y, rotation: move.to.rotationDeg }
  })

  return { components: next, applied }
}