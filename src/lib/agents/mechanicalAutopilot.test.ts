/**
 * Mechanical sizing loop: a real search over the live assembly model.
 *
 * The expected numbers are the closed-form cantilever values (12 MPa and
 * 4.644 mm for the 2 m × 100 mm × 100 mm aluminium beam), so these tests fail
 * if the search reports a section it did not actually analyse.
 */
import { describe, expect, it } from 'vitest'
import {
  runMechanicalAutopilot,
  type MechanicalAutopilotGoal,
  type MechanicalAutopilotRuntime,
} from './mechanicalAutopilot'
import { createDefaultMechanicalParts, type MechanicalPart } from '../mechanical/partModel'

interface Harness {
  runtime: MechanicalAutopilotRuntime
  parts: () => MechanicalPart[]
}

const harness = (initial: MechanicalPart[] = createDefaultMechanicalParts()): Harness => {
  let state = initial
  return {
    runtime: {
      read: () => state,
      write: (next) => {
        state = next
      },
    },
    parts: () => state,
  }
}

const widthGoal = (overrides: Partial<MechanicalAutopilotGoal> = {}): MechanicalAutopilotGoal => ({
  part: 'beam-1',
  metric: 'mass',
  direction: 'minimize',
  knobs: [{ dimension: 'width', from: 0.05, to: 0.15, scale: 'linear' }],
  ...overrides,
})

describe('mechanical sizing autopilot', () => {
  it('finds the lightest beam that still meets deflection and strength limits', async () => {
    const bench = harness()
    const outcome = await runMechanicalAutopilot({
      runtime: bench.runtime,
      goal: widthGoal({
        constraints: { minSafetyFactor: 2, maxDeflectionMm: 10 },
      }),
      samplesPerKnob: 5,
      maxIterations: 20,
    })

    expect(outcome.achieved).toBe(true)
    expect(outcome.baselineMetric).toBeCloseTo(54, 6)
    expect(outcome.best?.partMassKg).toBeCloseTo(27, 6)
    expect(outcome.best?.values.width).toBeCloseTo(0.05, 9)
    expect(outcome.best?.analysis.deflectionMm).toBeCloseTo(9.2889, 3)
    expect(outcome.best?.analysis.safetyFactor).toBeCloseTo(11.5, 3)
    expect(outcome.reason).toMatch(/Improved part mass from 54 kg to 27 kg/)
    expect(outcome.reason).toMatch(/not a proof of a global optimum/)

    // Every measured candidate carries its own drawing, so the loop has visual
    // evidence rather than only a final snapshot.
    for (const iteration of outcome.iterations) {
      if (iteration.error) continue
      expect(iteration.assemblySvg).toContain('<svg')
    }
    expect(outcome.iterations[0].phase).toBe('baseline')
    expect(outcome.iterations.at(-1)?.phase).toBe('restore')
    expect(outcome.iterations.at(-1)?.best).toBe(true)
    expect(outcome.iterations.filter((iteration) => iteration.best).length).toBeGreaterThanOrEqual(1)

    // The winner is left on the live assembly.
    const beam = bench.parts().find((part) => part.id === 'beam-1')
    expect(beam?.dimensions.width).toBeCloseTo(0.05, 9)
    expect(beam?.properties.mass).toBeCloseTo(27, 6)
  })

  it('rejects a lighter candidate that violates the deflection limit', async () => {
    const bench = harness()
    const outcome = await runMechanicalAutopilot({
      runtime: bench.runtime,
      goal: widthGoal({ constraints: { maxDeflectionMm: 8 } }),
      samplesPerKnob: 5,
      maxIterations: 20,
    })

    expect(outcome.achieved).toBe(true)
    // The grid's best feasible point is 75 mm; local refinement then finds the
    // lighter 62.5 mm section, which still deflects 7.43 mm.
    expect(outcome.best?.values.width).toBeCloseTo(0.0625, 9)
    expect(outcome.best?.partMassKg).toBeCloseTo(33.75, 6)
    expect(outcome.best?.analysis.deflectionMm).toBeCloseTo(7.4311, 3)
    const lightest = outcome.iterations.find((iteration) => iteration.values.width === 0.05)
    expect(lightest?.constraintFailures.join(' ')).toMatch(/Tip deflection 9\.\d+ mm exceeds 8 mm/)
    expect(lightest?.best).toBe(false)
  })

  it('sweeps materials and keeps the lightest feasible one', async () => {
    const bench = harness()
    const outcome = await runMechanicalAutopilot({
      runtime: bench.runtime,
      goal: widthGoal({
        knobs: [
          { dimension: 'width', from: 0.09, to: 0.11, scale: 'linear' },
          { dimension: 'height', from: 0.09, to: 0.11, scale: 'linear' },
        ],
        materials: ['steel', 'aluminum'],
        constraints: { minSafetyFactor: 1, maxDeflectionMm: 20 },
      }),
      samplesPerKnob: 3,
      maxIterations: 40,
    })

    expect(outcome.search.gridCandidates).toBe(18)
    expect(outcome.search.truncated).toBe(false)
    expect(outcome.best?.values.material).toBe('aluminum')
    expect(outcome.best?.part.materialKey).toBe('aluminum')
    expect(outcome.iterations.some((iteration) => iteration.values.material === 'steel')).toBe(true)
    expect(outcome.best?.partMassKg).toBeCloseTo(43.74, 6)
  })

  it('meets an explicit deflection target and stops once it is inside tolerance', async () => {
    const bench = harness()
    const outcome = await runMechanicalAutopilot({
      runtime: bench.runtime,
      goal: widthGoal({
        metric: 'deflection',
        target: { value: 6, tolerance: 0.4 },
        knobs: [{ dimension: 'width', from: 0.05, to: 0.1, scale: 'linear' }],
      }),
      samplesPerKnob: 6,
      maxIterations: 20,
    })

    expect(outcome.achieved).toBe(true)
    expect(outcome.best?.values.width).toBeCloseTo(0.08, 9)
    expect(Math.abs((outcome.best?.metric ?? 0) - 6)).toBeLessThanOrEqual(0.4)
    expect(outcome.reason).toMatch(/Target met: tip deflection/)
    expect(outcome.iterations.at(-1)?.phase).toBe('sweep')
  })

  it('reports truncation when the grid is larger than the budget', async () => {
    const bench = harness()
    const outcome = await runMechanicalAutopilot({
      runtime: bench.runtime,
      goal: widthGoal({
        knobs: [
          { dimension: 'width', from: 0.09, to: 0.11, scale: 'linear' },
          { dimension: 'height', from: 0.09, to: 0.11, scale: 'linear' },
        ],
        materials: ['steel', 'aluminum', 'titanium'],
      }),
      samplesPerKnob: 5,
      maxIterations: 10,
    })

    expect(outcome.search.gridCandidates).toBe(75)
    expect(outcome.search.truncated).toBe(true)
    expect(outcome.iterations.filter((iteration) => iteration.phase !== 'restore').length).toBeLessThanOrEqual(10)
    expect(outcome.reason).toMatch(/sampled at \d+ points/)
  })

  it('restores the original assembly when no candidate can be measured', async () => {
    const initial = createDefaultMechanicalParts()
    const unloaded = initial.map((part) =>
      part.id === 'beam-1'
        ? { ...part, loads: { ...part.loads, forces: [], pressure: 0 } }
        : part,
    )
    const bench = harness(unloaded)
    const outcome = await runMechanicalAutopilot({
      runtime: bench.runtime,
      goal: widthGoal({ metric: 'safetyFactor' }),
      samplesPerKnob: 3,
      maxIterations: 10,
    })

    expect(outcome.achieved).toBe(false)
    expect(outcome.best).toBeUndefined()
    expect(outcome.reason).toMatch(/No candidate could be measured/)
    expect(outcome.reason).toMatch(/original assembly was restored/)
    expect(bench.parts()).toEqual(unloaded)
  })

  it('stops when the caller aborts without claiming improvement', async () => {
    const bench = harness()
    const controller = new AbortController()
    controller.abort()
    const outcome = await runMechanicalAutopilot({
      runtime: bench.runtime,
      goal: widthGoal(),
      signal: controller.signal,
      maxIterations: 20,
    })

    expect(outcome.achieved).toBe(false)
    expect(outcome.reason).toMatch(/Stopped by the caller/)
    expect(outcome.search.evaluated).toBe(1)
  })

  it('refuses malformed goals before touching the assembly', async () => {
    const bench = harness()
    const before = bench.parts()
    const cases: Array<[MechanicalAutopilotGoal, RegExp]> = [
      [{ part: 'ghost' }, /No mechanical part "ghost"/],
      [widthGoal({ materials: ['unobtainium'] }), /Unknown material "unobtainium"/],
      [
        widthGoal({
          knobs: [
            { dimension: 'width', from: 0.09, to: 0.11 },
            { dimension: 'width', from: 0.05, to: 0.15 },
          ],
        }),
        /tuned twice/,
      ],
      [widthGoal({ knobs: [{ dimension: 'width', from: 0, to: 0.1 }] }), /bounds must be finite and > 0/],
      [widthGoal({ target: { value: 1, tolerance: 0 } }), /positive tolerance/],
    ]

    for (const [goal, pattern] of cases) {
      await expect(
        runMechanicalAutopilot({ runtime: bench.runtime, goal, maxIterations: 10 }),
      ).rejects.toThrow(pattern)
    }
    expect(bench.parts()).toBe(before)
  })

  it('refuses an unsupported part before searching', async () => {
    const bench = harness()
    bench.runtime.write(
      bench.parts().map((part) =>
        part.id === 'beam-1'
          ? {
              ...part,
              constraints: {
                ...part.constraints,
                fixed: false,
                pinned: false,
                roller: false,
              },
            }
          : part,
      ),
    )
    await expect(
      runMechanicalAutopilot({ runtime: bench.runtime, goal: widthGoal(), maxIterations: 10 }),
    ).rejects.toThrow(/has no support/)
  })
})
