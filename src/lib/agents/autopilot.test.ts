import { describe, expect, it } from 'vitest'
import { buildDemoBoard } from '../demo/demoBoard'
import { createMemoryCadRuntime, type CadRuntime } from './cadRuntime'
import { createCadToolset, type CadSimulationOutput } from './cadTools'
import { runAutopilot } from './autopilot'
import { parseSpiceValue } from '../simulation/devices'

const QUICK_TRANSIENT = { type: 'transient' as const, stopTime: 4e-3, stepTime: 1e-5 }

const boardRuntime = (): CadRuntime => {
  const board = buildDemoBoard()
  return createMemoryCadRuntime({ components: board.components, wires: board.wires })
}

const settledMeanAt = async (capacitance: number): Promise<number> => {
  const tools = createCadToolset(boardRuntime())
  await tools.invoke('cad.setProperty', {
    reference: 'C1',
    property: 'value',
    value: String(capacitance),
  })
  const simulation = (await tools.invoke('cad.simulate', {
    analysis: 'transient',
    parameters: JSON.stringify(QUICK_TRANSIENT),
  })) as CadSimulationOutput
  const waveform = simulation.waveforms.find((candidate) => candidate.name.toLowerCase() === 'v(out)')
  expect(waveform?.settled).toBeDefined()
  return waveform!.settled!.mean
}

const c1Value = (runtime: CadRuntime): number => {
  const capacitor = runtime.read().components.find((component) => component.reference === 'C1')!
  return parseSpiceValue(capacitor.properties['value'], 'C1.value')
}

const numeric = (value: string | number | boolean | undefined): number =>
  parseSpiceValue(value as string | number, 'C1.value')

/**
 * The search grid puts the last candidate at the top of the range. A target
 * that no grid point can hit makes the loop measure every point, so the winner
 * is mid-grid and the sheet ends the sweep on a worse value. The autopilot must
 * put the winner back before reporting.
 */
describe('autopilot restore semantics', () => {
  it('leaves the sheet on the winning candidate, not the last swept point', async () => {
    const lowMean = await settledMeanAt(158e-6)
    const highMean = await settledMeanAt(314e-6)
    const target = (lowMean + highMean) / 2
    const runtime = boardRuntime()

    const result = await runAutopilot({
      runtime,
      goal: {
        description: 'Land the settled output mean between two grid points.',
        analysis: QUICK_TRANSIENT,
        metric: { waveform: 'V(OUT)', statistic: 'mean', settled: true },
        target: { value: target, tolerance: 0 },
        knobs: [{ reference: 'C1', property: 'value', from: 2e-6, to: 470e-6, scale: 'log' }],
      },
      samplesPerKnob: 4,
      refineSteps: 0,
      maxIterations: 6,
    })

    expect(result.achieved).toBe(false)
    expect(result.best).toBeDefined()
    expect(result.reason).toMatch(/No candidate met the goal within \d+ measured iteration/)
    expect(result.reason).not.toMatch(/global optimum|guaranteed|proof of correctness/i)

    const bestValue = result.best!.knobValues['C1.value']
    const sweep = result.iterations.filter((iteration) => iteration.phase === 'sweep' && !iteration.error)
    expect(sweep).toHaveLength(4)
    const lastSwept = numeric(sweep[sweep.length - 1].knobValues['C1.value'])
    expect(lastSwept).toBeCloseTo(470e-6, 12)
    // The target sits between the middle grid points, so the winner cannot be
    // the last (largest) capacitor that the sweep finished on.
    expect(bestValue).toBeLessThan(lastSwept)

    const onSheet = c1Value(runtime)
    expect(Math.abs(onSheet - bestValue)).toBeLessThan(Math.abs(bestValue) * 1e-9)

    const restore = result.iterations.find((iteration) => iteration.phase === 'restore')
    expect(restore).toBeDefined()
    expect(restore!.best).toBe(true)
    expect(restore!.message).toMatch(/Restored the best iteration/)
    expect(restore!.schematicSvg).toContain('<svg')
    expect(restore!.waveformSvg).toContain('<svg')
    expect(result.iterations.filter((iteration) => iteration.phase !== 'restore' && iteration.best)).toHaveLength(1)

    // The reported final design is the sheet the caller is looking at.
    const finalCapacitor = result.finalDesign.components.find((component) => component.reference === 'C1')!
    expect(finalCapacitor.properties['value']).toBe(
      runtime.read().components.find((component) => component.reference === 'C1')!.properties['value'],
    )
  })

  it('honours restoreBest: false and leaves the sheet on the last candidate', async () => {
    const lowMean = await settledMeanAt(158e-6)
    const highMean = await settledMeanAt(314e-6)
    const runtime = boardRuntime()

    const result = await runAutopilot({
      runtime,
      goal: {
        description: 'Same unreachable target, without restoring.',
        analysis: QUICK_TRANSIENT,
        metric: { waveform: 'V(OUT)', statistic: 'mean', settled: true },
        target: { value: (lowMean + highMean) / 2, tolerance: 0 },
        knobs: [{ reference: 'C1', property: 'value', from: 2e-6, to: 470e-6, scale: 'log' }],
      },
      samplesPerKnob: 4,
      refineSteps: 0,
      maxIterations: 6,
      restoreBest: false,
    })

    expect(result.iterations.some((iteration) => iteration.phase === 'restore')).toBe(false)
    expect(c1Value(runtime)).toBeCloseTo(470e-6, 12)
    expect(result.best).toBeDefined()
  })

  it('reports a failed search honestly and gives the original design back', async () => {
    const runtime = boardRuntime()
    const before = runtime.read().components.find((component) => component.reference === 'C1')!.properties['value']
    const events: number[] = []

    const result = await runAutopilot({
      runtime,
      goal: {
        description: 'Measure a net that does not exist.',
        analysis: QUICK_TRANSIENT,
        metric: { waveform: 'V(NO_SUCH_NET)', statistic: 'peak' },
        direction: 'maximize',
        knobs: [{ reference: 'C1', property: 'value', from: 1e-6, to: 470e-6, scale: 'log' }],
      },
      samplesPerKnob: 3,
      refineSteps: 1,
      maxIterations: 6,
      onEvent: (iteration) => events.push(iteration.iteration),
    })

    expect(result.achieved).toBe(false)
    expect(result.best).toBeUndefined()
    expect(result.reason).toMatch(/No candidate could be solved and measured/)
    expect(result.reason).toMatch(/V\(NO_SUCH_NET\)/)
    expect(result.reason).toMatch(/original design was restored/)
    expect(events.length).toBe(result.iterations.length)

    const measured = result.iterations.filter((iteration) => iteration.phase !== 'restore')
    expect(measured.length).toBeGreaterThan(1)
    for (const iteration of measured) {
      expect(iteration.error).toMatch(/V\(NO_SUCH_NET\)/)
      expect(iteration.metric).toBeUndefined()
      expect(iteration.best).toBe(false)
    }
    const restore = result.iterations.find((iteration) => iteration.phase === 'restore')!
    expect(restore.message).toMatch(/Restored the original design/)
    expect(restore.best).toBe(false)

    const after = runtime.read().components.find((component) => component.reference === 'C1')!.properties['value']
    expect(after).toBe(before)
  })
})

describe('direction-only search coverage', () => {
  it('measures the full budget instead of stopping at the first improvement', async () => {
    const result = await runAutopilot({
      runtime: boardRuntime(),
      goal: {
        description: 'Minimise settled output ripple.',
        analysis: QUICK_TRANSIENT,
        metric: { waveform: 'V(OUT)', statistic: 'ripple', settled: true },
        direction: 'minimize',
        knobs: [{ reference: 'C1', property: 'value', from: 2e-6, to: 470e-6, scale: 'log' }],
      },
      samplesPerKnob: 4,
      refineSteps: 0,
      maxIterations: 8,
      restoreBest: false,
    })

    const sweep = result.iterations.filter((iteration) => iteration.phase === 'sweep' && !iteration.error)
    expect(sweep).toHaveLength(4)
    const metrics = sweep
      .map((iteration) => iteration.metric)
      .filter((metric): metric is number => metric !== undefined)
    expect(metrics.length).toBeGreaterThan(1)
    // The winner must be the minimum actually measured, not merely the first
    // candidate that beat the baseline.
    expect(result.best?.metric).toBeCloseTo(Math.min(...metrics), 12)
    expect(result.achieved).toBe(true)
    expect(result.reason).toMatch(/Improved/)
    expect(result.reason).toMatch(/not a proof of a global optimum/i)
  })
})
