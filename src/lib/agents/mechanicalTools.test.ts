/**
 * Mechanical agent loop: observe → edit → analyse → observe, on the same store
 * the mechanical workspace renders. The numbers asserted here are the closed
 * forms a human sees in the panel, not a separate agent-only model.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { AgentHarness, type AgentBudget } from './agentHarness'
import { mechanicalTools, registerMechanicalTools } from './mechanicalTools'
import { captureMechanicalSnapshot, mechanicalToSvg } from './mechanicalSnapshot'
import { useProjectStore } from '../../stores/useProjectStore'
import { createDefaultMechanicalParts, type MechanicalPart } from '../mechanical/partModel'

interface ObservationResult {
  source: 'store'
  snapshot: ReturnType<typeof captureMechanicalSnapshot>
  svg: string
}

interface AnalyzeEntry {
  partId: string
  partName: string
  stressMPa?: number
  deflectionMm?: number
  safetyFactor?: number | null
  yields?: boolean
  naturalFrequenciesHz?: number[]
  bucklingLoadN?: number
  error?: string
}

const budget = (): AgentBudget => ({ maxCalls: 40, maxWallMs: 60_000, startedAt: Date.now() })
const allow = (): boolean => true

const call = async (
  h: AgentHarness,
  tool: string,
  args: Record<string, string | number | boolean> = {},
): Promise<unknown> => {
  const result = await h.call(tool, args, budget(), allow)
  if (result.error) throw new Error(result.error)
  return result.result
}

const liveParts = (): MechanicalPart[] => useProjectStore.getState().mechanicalParts

beforeEach(() => {
  useProjectStore.setState({ mechanicalParts: createDefaultMechanicalParts() })
})

describe('mechanical observation', () => {
  it('reports the default assembly in millimetres with closed-form analysis', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)

    const observed = (await call(h, 'mech.observe')) as ObservationResult
    expect(observed.source).toBe('store')
    expect(observed.snapshot.schema).toBe('folio.mechanical/1')
    expect(observed.snapshot.parts.map((part) => part.id)).toEqual(['beam-1', 'plate-1'])
    expect(observed.snapshot.summary.partCount).toBe(2)
    expect(observed.snapshot.summary.totalMassKg).toBeCloseTo(67.5, 6)
    expect(observed.snapshot.summary.materials).toEqual(['Aluminum 6061-T6'])
    expect(observed.snapshot.summary.highestStressMPa).toBeCloseTo(12, 6)
    expect(observed.snapshot.summary.lowestSafetyFactor).toBeCloseTo(23, 4)
    expect(observed.snapshot.summary.unfinishedParts).toBe(0)
    expect(observed.snapshot.warnings).toEqual([])

    const beam = observed.snapshot.parts[0]
    expect(beam.dimensionsMm).toEqual({ length: 2000, width: 100, height: 100 })
    expect(beam.support).toBe('fixed')
    expect(beam.loads.forceN).toBe(1000)
    expect(beam.analysis?.stressMPa).toBeCloseTo(12, 6)
    expect(beam.analysis?.deflectionMm).toBeCloseTo(4.6444, 3)
    expect(beam.analysis?.naturalFrequenciesHz?.length).toBe(4)
    expect(beam.analysis?.naturalFrequenciesHz?.[0]).toBeGreaterThan(0)
    expect(beam.analysis?.bucklingLoadN).toBeGreaterThan(0)

    const plate = observed.snapshot.parts[1]
    expect(plate.support).toBe('pinned')
    expect(plate.loads.pressurePa).toBe(10000)
    expect(plate.analysis?.stressMPa).toBeCloseTo(4.6875, 6)
    expect(plate.analysis?.yields).toBe(false)

    expect(observed.svg.startsWith('<svg')).toBe(true)
    expect(observed.svg).toContain('Mechanical assembly')
    expect(observed.svg).toContain('Main Beam')
    expect(observed.svg).toContain('Support Plate')
    expect(observed.svg).toContain('fixed')
    expect(observed.svg).toContain('pinned')
    expect(observed.svg).toContain('mm envelope')
    expect(observed.svg).not.toContain('undefined')
    expect(observed.svg).not.toContain('NaN')
  })

  it('filters to one part and refuses an unknown part', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)
    const single = (await call(h, 'mech.observe', { part: 'plate-1' })) as ObservationResult
    expect(single.snapshot.parts).toHaveLength(1)
    expect(single.snapshot.parts[0].id).toBe('plate-1')
    expect(single.svg).toContain('Support Plate')
    expect(single.svg).not.toContain('Main Beam')

    const missing = await h.call('mech.observe', { part: 'nope' }, budget(), allow)
    expect(missing.error).toMatch(/No mechanical part "nope"/)
  })

  it('reports unsupported parts as warnings instead of failing the observation', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)
    await call(h, 'mech.setSupport', { part: 'plate-1', support: 'free' })
    const observed = (await call(h, 'mech.observe')) as ObservationResult
    expect(observed.snapshot.parts[1].analysis).toBeNull()
    expect(observed.snapshot.summary.unfinishedParts).toBe(1)
    expect(observed.snapshot.warnings).toEqual([
      expect.objectContaining({ code: 'unsupported-part', partId: 'plate-1' }),
    ])
  })

  it('produces a deterministic drawing and an explicit empty state', () => {
    const parts = createDefaultMechanicalParts()
    expect(mechanicalToSvg(parts)).toBe(mechanicalToSvg(parts))
    const empty = mechanicalToSvg([])
    expect(empty).toContain('No parts')
    expect(captureMechanicalSnapshot([]).summary.partCount).toBe(0)
  })
})

describe('mechanical editing', () => {
  it('adds a steel beam with a support, load, and analysis', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)
    const added = (await call(h, 'mech.addPart', {
      name: 'Bracket',
      kind: 'beam',
      length: 1.5,
      width: 0.08,
      height: 0.12,
      x: 0.5,
      y: 0.25,
      z: 0,
      material: 'steel',
      support: 'pinned',
      forceN: 500,
    })) as { added: { part: { id: string; material: { key: string }; massKg: number; support: string; analysis: { stressMPa: number; safetyFactor: number } } }; parts: number }

    expect(added.parts).toBe(3)
    expect(added.added.part.id).toMatch(/^agent-beam-\d+$/)
    expect(added.added.part.material.key).toBe('steel')
    expect(added.added.part.massKg).toBeCloseTo(1.5 * 0.08 * 0.12 * 7850, 6)
    expect(added.added.part.support).toBe('pinned')
    expect(added.added.part.analysis.stressMPa).toBeGreaterThan(0)
    expect(added.added.part.analysis.safetyFactor).toBeGreaterThan(0)

    const parts = liveParts()
    expect(parts).toHaveLength(3)
    expect(parts[2].name).toBe('Bracket')
    expect(parts[2].loads.forces).toEqual([{ x: 0, y: -1, z: 0, magnitude: 500 }])

    const observed = (await call(h, 'mech.observe')) as ObservationResult
    expect(observed.svg).toContain('Bracket')
  })

  it('moves and rotates a part, keeping mass properties consistent', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)
    const moved = (await call(h, 'mech.movePart', {
      part: 'plate-1',
      x: 1.2,
      y: -0.04,
      z: 0.1,
      rotationZ: 15,
    })) as { part: { id: string; positionM: number[]; rotationDeg: number[]; massKg: number } }

    expect(moved.part.id).toBe('plate-1')
    expect(moved.part.positionM).toEqual([1.2, -0.04, 0.1])
    expect(moved.part.rotationDeg[2]).toBeCloseTo(15, 6)
    expect(moved.part.massKg).toBeCloseTo(13.5, 6)

    const stored = liveParts().find((part) => part.id === 'plate-1')
    expect(stored?.position).toEqual([1.2, -0.04, 0.1])
    expect(stored?.properties.centerOfMass).toEqual([1.2, -0.04, 0.1])
  })

  it('resizes a part and recomputes mass, inertia, stress, and deflection', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)
    const before = (await call(h, 'mech.analyze', { part: 'beam-1' })) as { analyses: AnalyzeEntry[] }
    expect(before.analyses[0].stressMPa).toBeCloseTo(12, 6)
    expect(before.analyses[0].deflectionMm).toBeCloseTo(4.6444, 3)

    const resized = (await call(h, 'mech.resizePart', {
      part: 'beam-1',
      height: 0.2,
      material: 'steel',
    })) as { part: { massKg: number; material: { key: string }; analysis: { stressMPa: number; deflectionMm: number; safetyFactor: number } } }
    expect(resized.part.material.key).toBe('steel')
    // 2 m × 0.1 m × 0.2 m at 7850 kg/m³.
    expect(resized.part.massKg).toBeCloseTo(314, 6)
    // Doubling the depth raises I by 8× but also doubles the extreme fibre, so
    // the same load produces quarter the stress; the stiffer steel reduces tip
    // deflection from 4.644 mm to 0.2 mm and raises the safety factor.
    expect(resized.part.analysis.stressMPa).toBeCloseTo(3, 6)
    expect(resized.part.analysis.deflectionMm).toBeCloseTo(0.2, 3)
    expect(resized.part.analysis.safetyFactor).toBeGreaterThan(23)
  })

  it('changes supports and loads with analysable feedback', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)
    const freed = (await call(h, 'mech.setSupport', { part: 'beam-1', support: 'free' })) as { analysable: boolean }
    expect(freed.analysable).toBe(false)
    const unfixed = (await call(h, 'mech.analyze', { part: 'beam-1' })) as { analyses: AnalyzeEntry[]; warnings: unknown[] }
    expect(unfixed.analyses[0].error).toMatch(/no support/)
    expect(unfixed.warnings).toHaveLength(1)

    const roller = (await call(h, 'mech.setSupport', { part: 'beam-1', support: 'roller' })) as { analysable: boolean }
    expect(roller.analysable).toBe(true)
    await call(h, 'mech.setSupport', { part: 'beam-1', support: 'fixed' })
    const doubled = (await call(h, 'mech.setLoad', { part: 'beam-1', forceN: 2000 })) as {
      part: { loads: { forceN: number }; analysis: { stressMPa: number } }
    }
    expect(doubled.part.loads.forceN).toBe(2000)
    expect(doubled.part.analysis.stressMPa).toBeCloseTo(24, 6)
  })

  it('drives a design loop until stress and deflection are acceptable', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)
    await call(h, 'mech.addPart', {
      name: 'Boom',
      kind: 'beam',
      length: 1,
      width: 0.04,
      height: 0.02,
      x: 0.5,
      y: 0,
      z: 0,
      material: 'steel',
      support: 'fixed',
      forceN: 500,
    })
    const id = liveParts()[2].id

    const first = (await call(h, 'mech.analyze', { part: id })) as { analyses: AnalyzeEntry[] }
    expect(first.analyses[0].stressMPa).toBeCloseTo(187.5, 4)
    expect(first.analyses[0].deflectionMm).toBeCloseTo(31.25, 3)
    const unacceptable = (entry: AnalyzeEntry): boolean =>
      (entry.safetyFactor ?? 0) < 1.5 || (entry.deflectionMm ?? 0) > 5
    expect(unacceptable(first.analyses[0])).toBe(true)

    // An agent's corrective edit: deepen the section, then re-observe.
    await call(h, 'mech.resizePart', { part: id, height: 0.04 })
    const second = (await call(h, 'mech.analyze', { part: id })) as { analyses: AnalyzeEntry[] }
    expect(second.analyses[0].stressMPa).toBeCloseTo(46.875, 4)
    expect(second.analyses[0].deflectionMm).toBeCloseTo(3.90625, 4)
    expect((second.analyses[0].safetyFactor ?? 0)).toBeGreaterThan(1.5)
    expect(unacceptable(second.analyses[0])).toBe(false)

    const observed = (await call(h, 'mech.observe', { part: id })) as ObservationResult
    expect(observed.snapshot.parts[0].dimensionsMm.height).toBe(40)
    expect(observed.snapshot.parts[0].analysis?.deflectionMm).toBeCloseTo(3.90625, 3)
  })
})

describe('mechanical sizing autopilot tool', () => {
  it('sizes the live beam and leaves the winning section in the store', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)

    const outcome = (await call(h, 'mech.autopilot', {
      part: 'beam-1',
      metric: 'mass',
      knobs: JSON.stringify([{ dimension: 'width', from: 0.05, to: 0.1 }]),
      samplesPerKnob: 3,
      maxIterations: 10,
      minSafetyFactor: 2,
      maxDeflectionMm: 10,
    })) as {
      achieved: boolean
      best?: { values: { width: number }; partMassKg: number; assemblySvg?: string }
      iterations: Array<{ phase: string; assemblySvg?: string }>
      search: { evaluated: number; note: string }
    }

    expect(outcome.achieved).toBe(true)
    expect(outcome.best?.values.width).toBeCloseTo(0.05, 9)
    expect(outcome.best?.partMassKg).toBeCloseTo(27, 6)
    expect(outcome.best?.assemblySvg).toContain('<svg')
    expect(outcome.search.note).toMatch(/not a global optimum/)
    // A tool response keeps the winner's drawing but not one SVG per candidate.
    expect(outcome.iterations.every((iteration) => iteration.assemblySvg === undefined)).toBe(true)
    expect(outcome.iterations.at(-1)?.phase).toBe('restore')
    expect(liveParts().find((part) => part.id === 'beam-1')?.properties.mass).toBeCloseTo(27, 6)
  })

  it('can include every iteration drawing for visual inspection', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)

    const outcome = (await call(h, 'mech.autopilot', {
      part: 'beam-1',
      knobs: JSON.stringify([{ dimension: 'width', from: 0.05, to: 0.1 }]),
      samplesPerKnob: 3,
      maxIterations: 8,
      includeDrawings: true,
    })) as { iterations: Array<{ assemblySvg?: string }> }

    expect(outcome.iterations.filter((iteration) => iteration.assemblySvg).length).toBeGreaterThan(1)
  })
})

describe('mechanical tool validation', () => {
  it('registers the design loop without a deletion tool', () => {
    const names = mechanicalTools().map((tool) => tool.name)
    expect(names).toEqual([
      'mech.observe',
      'mech.addPart',
      'mech.movePart',
      'mech.resizePart',
      'mech.setSupport',
      'mech.setLoad',
      'mech.analyze',
      'mech.autopilot',
    ])
    expect(names.some((name) => /delete|remove/i.test(name))).toBe(false)
  })

  it('refuses malformed parts and edits without touching the assembly', async () => {
    const h = new AgentHarness()
    registerMechanicalTools(h)
    const before = liveParts()

    const cases: Array<[string, Record<string, string | number | boolean>, RegExp]> = [
      ['mech.addPart', { name: 'X', kind: 'truss', length: 1, width: 0.1, height: 0.1 }, /kind must be "beam" or "plate"/],
      ['mech.addPart', { name: 'X', kind: 'beam', length: 0, width: 0.1, height: 0.1 }, /length \(metres\) must be a finite value > 0/],
      ['mech.addPart', { name: 'X', kind: 'beam', length: 1, width: 0.1, height: 0.1, material: 'unobtainium' }, /Unknown material/],
      ['mech.addPart', { name: 'X', kind: 'beam', length: 1, width: 0.1, height: 0.1, support: 'clamped' }, /support must be one of/],
      ['mech.addPart', { name: ' ', kind: 'beam', length: 1, width: 0.1, height: 0.1 }, /needs a part name/],
      ['mech.movePart', { part: 'ghost', x: 0, y: 0, z: 0 }, /No mechanical part "ghost"/],
      ['mech.resizePart', { part: 'beam-1' }, /at least one of length, width, height, or material/],
      ['mech.resizePart', { part: 'beam-1', width: -1 }, /width \(metres\) must be a finite value > 0/],
      ['mech.setSupport', { part: 'beam-1', support: 'welded' }, /support must be one of/],
      ['mech.setLoad', { part: 'beam-1' }, /at least one of forceN, pressurePa, or temperatureK/],
      ['mech.setLoad', { part: 'beam-1', pressurePa: -5 }, /pressurePa must be a finite value >= 0/],
      ['mech.analyze', { part: 'ghost' }, /No mechanical part "ghost"/],
      ['mech.autopilot', { part: ' ' }, /needs a part id/],
      ['mech.autopilot', { part: 'beam-1', metric: 'weight' }, /metric must be one of/],
      ['mech.autopilot', { part: 'beam-1', direction: 'up' }, /direction must be "minimize" or "maximize"/],
      ['mech.autopilot', { part: 'beam-1', knobs: 'not-json' }, /knobs must be valid JSON/],
      ['mech.autopilot', { part: 'beam-1', target: 3 }, /target and tolerance must be supplied together/],
      ['mech.autopilot', { part: 'beam-1', materials: 'unobtainium' }, /Unknown material/],
      [
        'mech.autopilot',
        { part: 'beam-1', knobs: JSON.stringify([{ dimension: 'width', from: 0.1, to: 0.1 }]) },
        /identical/,
      ],
    ]

    for (const [tool, args, pattern] of cases) {
      const result = await h.call(tool, args, budget(), allow)
      expect(result.error, `${tool} ${JSON.stringify(args)}`).toMatch(pattern)
    }
    expect(liveParts()).toEqual(before)
  })
})
