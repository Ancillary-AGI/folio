import { describe, expect, it } from 'vitest'
import {
  ENCLOSURE_ROLE,
  describeEnclosureVerdict,
  enclosureVerdict,
} from './enclosureVerdict'
import { buildPcbScene } from './pcbScene'
import { boxMeshObj } from '../3d/meshFixtures'
import { parseObj } from '../3d/objImporter'
import type { PcbSceneInput } from './pcbScene'

const baseLayout = (overrides: Partial<PcbSceneInput> = {}): PcbSceneInput => ({
  widthMm: 40,
  heightMm: 30,
  thicknessMm: 1.6,
  layers: [],
  traces: [],
  vias: [],
  components: [],
  ...overrides,
})

const enclosure = (width: number, height: number, depth: number, projectId: string | null = 'p1') => ({
  name: 'box',
  projectId,
  mesh: parseObj(boxMeshObj(width, height, depth)),
})

const scene = (layout: PcbSceneInput) => buildPcbScene(layout)

describe('enclosureVerdict', () => {
  it('reports a fit with no blockers', () => {
    const verdict = enclosureVerdict(scene(baseLayout()), enclosure(120, 40, 90), 'p1')
    expect(verdict).not.toBeNull()
    expect(verdict?.fits).toBe(true)
    expect(verdict?.blockers).toEqual([])
    expect(verdict?.tightestSide).toBeTruthy()
    expect(verdict?.cavityMm.width).toBeCloseTo(120, 6)
  })

  it('names the face the stack breaks out of', () => {
    // 88 mm wide against a 40 mm board: the walls are the problem.
    const verdict = enclosureVerdict(scene(baseLayout()), enclosure(20, 40, 90), 'p1')
    expect(verdict?.fits).toBe(false)
    expect(verdict?.tightestMm).toBeLessThan(0)
    expect(verdict?.blockers[0]).toMatch(/breaks out of the/)
  })

  it('returns null when the enclosure belongs to another project', () => {
    // Showing another project's shell around this board would be a lie.
    const verdict = enclosureVerdict(scene(baseLayout()), enclosure(120, 40, 90, 'other'), 'p1')
    expect(verdict).toBeNull()
  })

  it('returns null when there is no enclosure', () => {
    expect(enclosureVerdict(scene(baseLayout()), null, 'p1')).toBeNull()
    expect(enclosureVerdict(scene(baseLayout()), undefined, 'p1')).toBeNull()
  })

  it('states its own limits in the role text', () => {
    expect(ENCLOSURE_ROLE).toMatch(/Not copper/)
    expect(ENCLOSURE_ROLE).toMatch(/bounding boxes/)
  })

  it('treats an empty blocker list as the pass condition', () => {
    const verdict = enclosureVerdict(scene(baseLayout()), enclosure(120, 40, 90), 'p1')
    const summary = describeEnclosureVerdict(verdict!)
    expect(summary).toMatch(/^Fits:/)
    expect(summary).toMatch(/inside a/)
  })

  it('summarises a failure with the blocking face', () => {
    const verdict = enclosureVerdict(scene(baseLayout()), enclosure(20, 40, 90), 'p1')
    const summary = describeEnclosureVerdict(verdict!)
    expect(summary).toMatch(/^Does not fit:/)
  })

  it('reports stack and cavity dimensions consistently', () => {
    const layout = baseLayout({ widthMm: 40, heightMm: 30 })
    const verdict = enclosureVerdict(scene(layout), enclosure(120, 40, 90), 'p1')
    // The stack is at least the board outline it must fit inside.
    expect(verdict!.stackMm.width).toBeGreaterThanOrEqual(40)
    expect(verdict!.stackMm.depth).toBeGreaterThanOrEqual(30)
    expect(verdict!.cavityMm.width).toBeGreaterThan(verdict!.stackMm.width)
  })
})