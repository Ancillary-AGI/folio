import { describe, expect, it } from 'vitest'
import {
  BOARD_MARGIN_MM,
  applyPlacement,
  packageExtentMm,
  planPlacement,
  previewPlacement,
  usableBoardRect,
  type PlaceablePart,
  type PlacementPlan,
} from './placement'
import type { PcbSceneInput } from './pcbScene'

/** A 0805 two-pin part, which is what the planner resolves an extent from. */
const part = (
  reference: string,
  x: number,
  y: number,
  overrides: Partial<PlaceablePart> = {},
): PlaceablePart => ({
  id: `id-${reference}`,
  reference,
  x,
  y,
  rotation: 0,
  footprint: '0805',
  category: 'passive',
  pinCount: 2,
  ...overrides,
})

const layout = (overrides: Partial<PcbSceneInput> = {}): PcbSceneInput => ({
  widthMm: 40,
  heightMm: 30,
  thicknessMm: 1.6,
  layers: [],
  traces: [],
  vias: [],
  components: [],
  ...overrides,
})

describe('packageExtentMm', () => {
  it('swaps width and depth for a quarter turn', () => {
    const straight = part('R1', 0, 0, { rotation: 0 })
    const turned = part('R1', 0, 0, { rotation: 90 })
    const a = packageExtentMm(straight)
    const b = packageExtentMm(turned)
    expect(b.halfWidth).toBe(a.halfDepth)
    expect(b.halfDepth).toBe(a.halfWidth)
  })

  it('a half turn keeps the same extent', () => {
    const straight = packageExtentMm(part('R1', 0, 0, { rotation: 0 }))
    const flipped = packageExtentMm(part('R1', 0, 0, { rotation: 180 }))
    expect(flipped.halfWidth).toBe(straight.halfWidth)
    expect(flipped.halfDepth).toBe(straight.halfDepth)
  })
})

describe('usableBoardRect', () => {
  it('insets the outline by the board margin', () => {
    expect(usableBoardRect(layout())).toEqual({
      minX: BOARD_MARGIN_MM,
      minY: BOARD_MARGIN_MM,
      maxX: 40 - BOARD_MARGIN_MM,
      maxY: 30 - BOARD_MARGIN_MM,
    })
  })

  it('is null without an outline', () => {
    expect(usableBoardRect(null)).toBeNull()
  })
})

describe('planPlacement', () => {
  it('moves only the part that actually collides', () => {
    const plan = planPlacement({
      components: [part('R1', 20, 15), part('R2', 20.2, 15.1)],
      layout: layout(),
    })
    /* R1 already fits, so it stays exactly where the designer put it. Only the
     * overlapping part moves — a re-place must not rearrange a layout the user
     * is happy with. */
    expect(plan.moves.map((move) => move.reference)).toEqual(['R2'])
    expect(plan.held.find((entry) => entry.reference === 'R1')?.reason).toBe('already in place')
  })

  it('leaves a part that already fits where it is', () => {
    const plan = planPlacement({
      components: [part('R1', 20, 15)],
      layout: layout(),
    })
    expect(plan.noop).toBe(true)
    expect(plan.held.map((entry) => entry.reason)).toContain('already in place')
  })

  it('never moves a locked part, and treats it as an obstacle', () => {
    const plan = planPlacement({
      components: [part('R1', 20, 15, { locked: true }), part('R2', 20.1, 15.1)],
      layout: layout(),
    })
    expect(plan.moves.map((move) => move.reference)).toEqual(['R2'])
    expect(plan.held.find((entry) => entry.reference === 'R1')?.reason).toBe('locked')
  })

  it('honours an explicit selection', () => {
    /* R2 is the only selected part and it overlaps the locked R1, so it must
     * move. R3 is not selected and is left untouched. */
    const plan = planPlacement({
      components: [
        part('R1', 20, 15, { locked: true }),
        part('R2', 20.2, 15.1),
        part('R3', 5, 5),
      ],
      layout: layout(),
      only: ['id-R2'],
    })
    expect(plan.moves.map((move) => move.reference)).toEqual(['R2'])
    expect(plan.held.find((entry) => entry.reference === 'R3')?.reason).toBe('not selected')
  })

  it('keeps every part inside the outline and clear of keepouts', () => {
    const plan = planPlacement({
      components: [part('R1', 1, 1), part('R2', 2, 2), part('R3', 39, 29)],
      layout: layout({
        keepouts: [{ id: 'k1', x: 10, y: 10, widthMm: 10, depthMm: 10, layers: [] }],
      }),
    })
    expect(plan.unplaced).toEqual([])
    for (const move of plan.moves) {
      expect(move.to.x).toBeGreaterThanOrEqual(BOARD_MARGIN_MM)
      expect(move.to.y).toBeGreaterThanOrEqual(BOARD_MARGIN_MM)
      expect(move.to.x).toBeLessThanOrEqual(40 - BOARD_MARGIN_MM)
      expect(move.to.y).toBeLessThanOrEqual(30 - BOARD_MARGIN_MM)
      // Nothing lands inside the 10–20 mm keepout square.
      const inside = move.to.x > 10 && move.to.x < 20 && move.to.y > 10 && move.to.y < 20
      expect(inside).toBe(false)
    }
  })

  it('snaps destinations to the grid', () => {
    const grid = 0.5
    const plan = planPlacement({
      components: [part('R1', 0, 0), part('R2', 0.1, 0.1)],
      layout: layout(),
      gridMm: grid,
    })
    for (const move of plan.moves) {
      expect(move.to.x / grid).toBeCloseTo(Math.round(move.to.x / grid), 10)
      expect(move.to.y / grid).toBeCloseTo(Math.round(move.to.y / grid), 10)
    }
  })

  it('reports parts it cannot fit instead of stacking them', () => {
    /* A board barely bigger than the margin has no usable area, so every part is
     * reported rather than dropped on top of the others. */
    const plan = planPlacement({
      components: [part('R1', 10, 10)],
      layout: layout({ widthMm: 4, heightMm: 4 }),
    })
    expect(plan.moves).toEqual([])
    expect(plan.unplaced.map((entry) => entry.reference)).toEqual(['R1'])
  })

  it('reports a missing outline rather than inventing one', () => {
    const plan = planPlacement({ components: [part('R1', 0, 0)], layout: null })
    expect(plan.unplaced.map((entry) => entry.reference)).toEqual(['R1'])
    expect(plan.unplaced[0]?.reason).toMatch(/no board outline/)
    expect(plan.noop).toBe(true)
  })

  it('totals the distance travelled', () => {
    const plan = planPlacement({
      components: [part('R1', 5, 5), part('R2', 5.2, 5.2)],
      layout: layout(),
    })
    const summed = plan.moves.reduce((total, move) => total + move.distanceMm, 0)
    expect(plan.totalDistanceMm).toBeCloseTo(summed, 10)
  })
})

describe('placement rules', () => {
  it('holds a part against an edge', () => {
    const plan = planPlacement({
      components: [part('R1', 20, 15)],
      layout: layout(),
      rules: [{ kind: 'edge', components: ['id-R1'], edge: 'left', offsetMm: 0 }],
    })
    const move = plan.moves.find((entry) => entry.componentId === 'id-R1')
    expect(move).toBeDefined()
    expect(move!.to.x).toBeCloseTo(BOARD_MARGIN_MM + 1, 6)
  })

  it('locks a part so nothing moves it', () => {
    const plan = planPlacement({
      components: [part('R1', 30, 20), part('R2', 30.2, 20.2)],
      layout: layout(),
      rules: [{ kind: 'lock', components: ['id-R1'] }],
    })
    expect(plan.moves.map((entry) => entry.componentId)).toEqual(['id-R2'])
    expect(plan.held.find((entry) => entry.componentId === 'id-R1')?.reason).toBe('locked by rule')
  })

  it('snaps parts to a grid', () => {
    const plan = planPlacement({
      components: [part('R1', 10.13, 20.27)],
      layout: layout(),
      rules: [{ kind: 'grid', components: ['id-R1'], pitchMm: 2.5 }],
    })
    expect(plan.moves[0]?.to.x).toBeCloseTo(10, 6)
    expect(plan.moves[0]?.to.y).toBeCloseTo(20, 6)
  })

  it('aligns parts on an axis', () => {
    const plan = planPlacement({
      components: [part('R1', 10, 10), part('R2', 30, 22)],
      layout: layout(),
      rules: [{ kind: 'align', components: ['id-R1', 'id-R2'], axis: 'y' }],
    })
    const r2 = plan.moves.find((entry) => entry.componentId === 'id-R2')
    expect(r2?.to.y).toBeCloseTo(10, 6)
  })

  it('refuses a rule that would place a part where it does not fit', () => {
    const plan = planPlacement({
      components: [part('R1', 10, 10)],
      layout: layout(),
      rules: [{ kind: 'edge', components: ['id-R1'], edge: 'left', offsetMm: -50 }],
    })
    expect(plan.unplaced.map((entry) => entry.reference)).toContain('R1')
    expect(plan.moves).toEqual([])
  })

  it('reserves a rule-placed part so the free pack cannot overlap it', () => {
    const plan = planPlacement({
      // R2 starts exactly where the rule will put R1, so it has to move.
      components: [part('R1', 20, 15), part('R2', 2.5, 15)],
      layout: layout(),
      rules: [{ kind: 'edge', components: ['id-R1'], edge: 'left', offsetMm: 0 }],
    })
    const r1 = plan.moves.find((entry) => entry.componentId === 'id-R1')
    const r2 = plan.moves.find((entry) => entry.componentId === 'id-R2')
    expect(r1).toBeDefined()
    expect(r2).toBeDefined()
    // R2 must clear R1's reserved spot by more than the two half-widths. The
    // packer takes the first free slot, which may be along either axis.
    const dx = r2!.to.x - r1!.to.x
    const dy = r2!.to.y - r1!.to.y
    expect(Math.hypot(dx, dy)).toBeGreaterThan(2)
  })
})

describe('previewPlacement', () => {
  it('reports what a plan would do without changing anything', () => {
    const components = [part('R1', 5, 5), part('R2', 5.2, 5.2)]
    const before = JSON.stringify(components)
    const preview = previewPlacement({ components, layout: layout() })
    expect(JSON.stringify(components)).toBe(before) // no mutation
    expect(preview.impact.moving).toBe(preview.plan.moves.length)
    expect(preview.impact.staying).toBe(components.length - preview.plan.moves.length)
    expect(preview.impact.safe).toBe(true)
  })

  it('flags a plan that would leave parts unplaced as unsafe', () => {
    const preview = previewPlacement({
      components: [part('R1', 10, 10)],
      layout: layout({ widthMm: 4, heightMm: 4 }),
    })
    expect(preview.plan.unplaced).toHaveLength(1)
    expect(preview.impact.safe).toBe(false)
  })

  it('reports the longest single move', () => {
    const preview = previewPlacement({
      components: [part('R1', 2, 2), part('R2', 3, 3)],
      layout: layout({ widthMm: 80, heightMm: 80 }),
    })
    const longest = Math.max(...preview.plan.moves.map((move) => move.distanceMm))
    expect(preview.impact.longestMoveMm).toBeCloseTo(longest, 10)
  })
})

describe('applyPlacement', () => {
  it('moves the planned parts and leaves the rest alone', () => {
    const components = [part('R1', 5, 5), part('R2', 5.2, 5.2), part('R3', 30, 25)]
    const plan = planPlacement({ components, layout: layout() })
    const result = applyPlacement(components, plan)

    const moved = result.components.find((entry) => entry.reference === 'R2')!
    const move = plan.moves.find((entry) => entry.componentId === moved.id)!
    expect(moved.x).toBe(move.to.x)
    expect(moved.y).toBe(move.to.y)

    // A part that was not in the plan is byte-identical.
    const untouched = result.components.find((entry) => entry.reference === 'R3')!
    expect(untouched).toEqual(components.find((entry) => entry.reference === 'R3'))
    expect(result.applied).toBe(plan.moves.length)
  })

  it('rejects a stale plan rather than applying it blindly', () => {
    // The operator moved R2 after previewing; applying the old plan would undo it.
    const original = [part('R1', 5, 5), part('R2', 5.2, 5.2)]
    const plan = planPlacement({ components: original, layout: layout() })
    const changed = [original[0]!, { ...original[1]!, x: 12, y: 12 }]
    expect(() => applyPlacement(changed, plan, { expected: plan })).toThrow(/stale/)
  })

  it('accepts a plan that still matches the board', () => {
    const components = [part('R1', 5, 5), part('R2', 5.2, 5.2)]
    const plan = planPlacement({ components, layout: layout() })
    expect(() => applyPlacement(components, plan, { expected: plan })).not.toThrow()
  })

  it('is a no-op for an empty plan', () => {
    const components = [part('R1', 20, 15)]
    const plan: PlacementPlan = {
      moves: [],
      held: [{ componentId: 'id-R1', reference: 'R1', reason: 'already in place' }],
      unplaced: [],
      totalDistanceMm: 0,
      noop: true,
    }
    const result = applyPlacement(components, plan)
    expect(result.applied).toBe(0)
    expect(result.components).toEqual(components)
  })
})