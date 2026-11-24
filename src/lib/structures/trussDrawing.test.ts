/**
 * The drawing maths behind the lattice sheet.
 *
 * A truss diagram is a projection, and a projection is where a drafter notices
 * the lie: a frame that renders upside down, a 12 m girder drawn as tall as it is
 * long, a joint that snaps to 1.2300000000000002 m. These tests are the reason
 * `TrussSheet` and the panel can share one set of helpers without each checking
 * the other's arithmetic.
 */
import { describe, expect, it } from 'vitest'
import type { TrussNode } from './truss'
import {
  deflectedNode,
  fitTrussView,
  forceLabel,
  forceToken,
  gridPitch,
  loadArrow,
  projectTruss,
  snapToGrid,
  unprojectTruss,
} from './trussDrawing'

const girder: TrussNode[] = [
  { id: 'a', x: 0, y: 0 },
  { id: 'b', x: 12, y: 0 },
]

/** A 4 × 3 m triangle: the span and the rise differ, so a bad aspect shows up. */
const gable: TrussNode[] = [
  { id: 'left', x: 0, y: 0 },
  { id: 'right', x: 4, y: 0 },
  { id: 'ridge', x: 2, y: 3 },
]

describe('truss view fitting', () => {
  it('scales the span into the width and leaves the padding clear at both ends', () => {
    const view = fitTrussView(girder, 900, 520, 28)
    expect(view.scale).toBeCloseTo((900 - 56) / 12, 6)
    const left = projectTruss(girder[0], view)
    const right = projectTruss(girder[1], view)
    expect(left.x).toBeCloseTo(28, 6)
    expect(right.x).toBeCloseTo(900 - 28, 6)
    // A flat frame sits on the vertical midline, not at the bottom of the sheet.
    // The clamp on a zero-height bounds is a millimetre of pixel, hence three places.
    expect(left.y).toBeCloseTo(260, 3)
    expect(right.y).toBeCloseTo(260, 3)
  })

  it('keeps the aspect ratio and centres on the tighter axis', () => {
    const view = fitTrussView(gable, 900, 520, 28)
    // Height binds: 464/3 px per metre against 844/4 for the width.
    expect(view.scale).toBeCloseTo(464 / 3, 6)
    expect(projectTruss(gable[2], view).y).toBeCloseTo(28, 6)
    expect(projectTruss(gable[0], view).y).toBeCloseTo(520 - 28, 6)
    expect(projectTruss(gable[0], view).x).toBeCloseTo((900 - view.scale * 4) / 2, 6)
    expect(projectTruss(gable[2], view).x).toBeCloseTo(450, 6)
  })

  it('puts Y up: a taller joint draws higher on the screen, not lower', () => {
    const view = fitTrussView(gable, 900, 520)
    expect(projectTruss(gable[2], view).y).toBeLessThan(projectTruss(gable[0], view).y)
  })

  it('shifts the drawing so a model offset from the origin still fills the sheet', () => {
    const offset: TrussNode[] = [
      { id: 'a', x: 100, y: 50 },
      { id: 'b', x: 108, y: 50 },
    ]
    const view = fitTrussView(offset, 900, 520, 28)
    expect(projectTruss(offset[0], view).x).toBeCloseTo(28, 6)
    expect(projectTruss(offset[1], view).x).toBeCloseTo(872, 6)
  })

  it('holds together for a degenerate model instead of dividing by zero', () => {
    const single: TrussNode[] = [{ id: 'only', x: 1, y: 1 }]
    const view = fitTrussView(single, 900, 520)
    expect(Number.isFinite(view.scale)).toBe(true)
    expect(view.scale).toBeGreaterThan(0)
    const empty = fitTrussView([], 900, 520)
    expect(Number.isFinite(empty.scale)).toBe(true)
    const point = projectTruss(single[0], view)
    expect(Number.isFinite(point.x)).toBe(true)
    expect(Number.isFinite(point.y)).toBe(true)
  })

  it('never returns a non-positive scale for a viewport smaller than the padding', () => {
    const view = fitTrussView(girder, 20, 20, 28)
    expect(view.scale).toBeCloseTo(1e-6, 12)
  })
})

describe('projection round trip', () => {
  it('brings a dragged point back to the model metres it came from', () => {
    const view = fitTrussView(gable, 900, 520, 28)
    for (const node of gable) {
      const back = unprojectTruss(projectTruss(node, view), view)
      expect(back.x).toBeCloseTo(node.x, 9)
      expect(back.y).toBeCloseTo(node.y, 9)
    }
  })

  it('flips the screen axis on the way back, so a drag upward raises the joint', () => {
    const view = fitTrussView(gable, 900, 520, 28)
    const above = unprojectTruss({ x: projectTruss(gable[0], view).x, y: projectTruss(gable[0], view).y - 100 }, view)
    expect(above.y).toBeGreaterThan(gable[0].y)
  })
})

describe('grid snapping', () => {
  it('snaps to the pitch, so a dragged joint lands on a buildable number', () => {
    expect(snapToGrid(1.23)).toBeCloseTo(1.25, 9)
    expect(snapToGrid(1.224)).toBeCloseTo(1.2, 9)
    expect(snapToGrid(-0.021)).toBeCloseTo(0, 9)
    expect(snapToGrid(0)).toBe(0)
  })

  it('honours a coarser pitch for a big frame', () => {
    expect(snapToGrid(7.31, 1)).toBeCloseTo(7, 9)
    expect(snapToGrid(7.31, 0.5)).toBeCloseTo(7.5, 9)
    expect(snapToGrid(7.62, 2.5)).toBeCloseTo(7.5, 9)
  })

  it('picks a pitch the sheet can subdivide in its head, following the extent', () => {
    // A 12 m girder gets metre bays; a 2 m bracket gets quarter-metre bays.
    expect(gridPitch(12)).toBe(1)
    expect(gridPitch(4)).toBeCloseTo(0.25, 9)
    expect(gridPitch(2)).toBeCloseTo(0.25, 9)
    expect(gridPitch(0.3)).toBeCloseTo(0.05, 9)
  })

  it('clamps at both ends instead of vanishing or turning into graph paper', () => {
    expect(gridPitch(0)).toBeCloseTo(0.05, 9)
    expect(gridPitch(-5)).toBeCloseTo(0.05, 9)
    // No step in the table keeps a 400 m span under 16 bays, so the coarsest wins.
    expect(gridPitch(400)).toBe(10)
    expect(gridPitch(200)).toBe(10)
    expect(gridPitch(12, 4)).toBe(5)
  })
})

describe('deflected shape', () => {
  it('multiplies the solved movement by the exaggeration', () => {
    const moved = deflectedNode({ id: 'a', x: 1, y: 2 }, { x: 0.001, y: -0.002 }, 100)
    expect(moved.x).toBeCloseTo(1.1, 9)
    expect(moved.y).toBeCloseTo(1.8, 9)
    expect(moved.id).toBe('a')
  })

  it('leaves a joint the solver never moved exactly where it was drawn', () => {
    const node: TrussNode = { id: 'a', x: 1, y: 2 }
    expect(deflectedNode(node, undefined, 100)).toBe(node)
    expect(deflectedNode(node, { x: 0, y: 0 }, 100)).toEqual(node)
  })
})

describe('load arrow', () => {
  const view = fitTrussView(gable, 900, 520, 28)

  it('draws a downward force downward on the screen', () => {
    const arrow = loadArrow(gable[2], 0, -5e3, view)!
    expect(arrow.to.x).toBeCloseTo(arrow.from.x, 6)
    expect(arrow.to.y).toBeGreaterThan(arrow.from.y)
  })

  it('points where the force points, including sideways', () => {
    const left = loadArrow(gable[0], -2e3, 0, view)!
    expect(left.to.x).toBeLessThan(left.from.x)
    expect(left.to.y).toBeCloseTo(left.from.y, 6)
    const diagonal = loadArrow(gable[0], 1e3, 1e3, view)!
    expect(diagonal.to.x).toBeGreaterThan(diagonal.from.x)
    // Screen y is inverted, so a positive (upward) force draws upward.
    expect(diagonal.to.y).toBeLessThan(diagonal.from.y)
  })

  it('keeps the head a readable length whatever the scale', () => {
    const tight = loadArrow(gable[0], 0, -1e3, { ...view, scale: 10 })!
    expect(Math.hypot(tight.to.x - tight.from.x, tight.to.y - tight.from.y)).toBeCloseTo(22, 6)
    const loose = loadArrow(gable[0], 0, -1e3, { ...view, scale: 5000 })!
    expect(Math.hypot(loose.to.x - loose.from.x, loose.to.y - loose.from.y)).toBeCloseTo(56, 6)
  })

  it('draws nothing for a zero load rather than an arrow of zero length', () => {
    expect(loadArrow(gable[0], 0, 0, view)).toBeNull()
  })
})

describe('force colour and label', () => {
  it('calls tension tension and compression compression', () => {
    expect(forceToken(20e3)).toBe('--force-tension')
    expect(forceToken(-20e3)).toBe('--force-compression')
    expect(forceLabel(20e3)).toBe('Tension')
    expect(forceLabel(-20e3)).toBe('Compression')
  })

  it('treats solver noise as a member carrying no force', () => {
    // The solver returns ~1e-12 N for a genuine zero-force bar.
    expect(forceToken(1e-12)).toBe('--force-neutral')
    expect(forceToken(-1e-7)).toBe('--force-neutral')
    expect(forceLabel(-1e-7)).toBe('No force')
    // Above the tolerance it is a real force and gets a real hue.
    expect(forceToken(1e-5)).toBe('--force-tension')
    expect(forceToken(-1e-5)).toBe('--force-compression')
  })

  it('never lets the sheet and the legend disagree about a sign', () => {
    for (const force of [0, 1e-12, 1e-5, 5e3, -5e3]) {
      expect(forceLabel(force), String(force)).toBe(
        forceToken(force) === '--force-tension'
          ? 'Tension'
          : forceToken(force) === '--force-compression'
            ? 'Compression'
            : 'No force',
      )
    }
  })
})
