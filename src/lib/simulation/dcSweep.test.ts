import { describe, expect, it } from 'vitest'
import { spiceEngine, type CircuitNetlist, type Component, type SimulationParameters } from './spiceEngine'
import { buildSweepValues } from './solver'

/**
 * DC sweep tests.
 *
 * The sweep is the analysis a user reaches for when they want a curve, so the
 * checks here are about the two things that can silently go wrong with one:
 * the step grid (which must be SPICE's, including its direction rule) and the
 * claim that each point is a genuine solve rather than an interpolation. The
 * second is asserted the only way it can be — by solving the same circuit once
 * as a single operating point and demanding the identical number.
 *
 * Tolerances are tight because a linear network's sweep point is exact
 * arithmetic: anything looser would let an approximation in unnoticed.
 */

const resistor = (name: string, nodes: [string, string], value: string | number): Component => ({
  type: 'resistor',
  name,
  nodes,
  parameters: { value },
})

const voltageSource = (name: string, nodes: [string, string], value: string | number): Component => ({
  type: 'voltage_source',
  name,
  nodes,
  parameters: { value },
})

const diode = (name: string, nodes: [string, string]): Component => ({
  type: 'diode',
  name,
  nodes,
  parameters: { saturationCurrent: '1e-14', emissionCoefficient: 1 },
})

/** Every waveform of a run, keyed by name (`V(OUT)`, `I(V1)`). */
const waveformsOf = (result: { waveforms: Array<{ name: string; data: Array<{ x: number; y: number }> }> }) =>
  new Map(result.waveforms.map((waveform) => [waveform.name, waveform.data]))

/** Value of a waveform at exactly `x`, or `undefined` when that point is missing. */
const at = (
  result: { waveforms: Array<{ name: string; data: Array<{ x: number; y: number }> }> },
  name: string,
  x: number,
): number => {
  const data = waveformsOf(result).get(name)
  if (!data) throw new Error(`the run produced no ${name} waveform`)
  const point = data.find((sample) => Math.abs(sample.x - x) < 1e-9)
  if (!point) throw new Error(`${name} has no point at ${x}`)
  return point.y
}

const sweep = async (
  components: Component[],
  parameters: Partial<SimulationParameters>,
): Promise<Awaited<ReturnType<typeof spiceEngine.simulate>>> => {
  const netlist: CircuitNetlist = {
    title: 'dc sweep',
    components,
    analyses: [{ type: 'dc-sweep', ...parameters }],
  }
  return spiceEngine.simulate(netlist)
}

describe('buildSweepValues', () => {
  it('counts points the way SPICE does, including the endpoint', () => {
    expect(buildSweepValues({ startValue: 0, stopValue: 5, stepValue: 1 })).toEqual([0, 1, 2, 3, 4, 5])
    expect(buildSweepValues({ startValue: 0, stopValue: 1, stepValue: 0.25 })).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('stops before overshooting when the interval is not a whole number of steps', () => {
    // 0, 2, 4 — 5 is not reached, and is not invented as a final point.
    expect(buildSweepValues({ startValue: 0, stopValue: 5, stepValue: 2 })).toEqual([0, 2, 4])
  })

  it('takes the direction from the sign of the step', () => {
    expect(buildSweepValues({ startValue: 5, stopValue: 3, stepValue: -1 })).toEqual([5, 4, 3])
  })

  it('treats a step whose sign disagrees with the interval as an empty sweep', () => {
    expect(buildSweepValues({ startValue: 0, stopValue: 5, stepValue: -1 })).toEqual([])
    expect(buildSweepValues({ startValue: 5, stopValue: 0, stepValue: 1 })).toEqual([])
  })

  it('rejects a zero or non-finite step rather than looping forever', () => {
    expect(buildSweepValues({ startValue: 0, stopValue: 5, stepValue: 0 })).toEqual([])
    expect(buildSweepValues({ startValue: 0, stopValue: Number.POSITIVE_INFINITY, stepValue: 1 })).toEqual([])
    expect(buildSweepValues({ startValue: Number.NaN, stopValue: 5, stepValue: 1 })).toEqual([])
  })

  it('caps the point count and lands exactly on the stop value', () => {
    const capped = buildSweepValues({ startValue: 0, stopValue: 100, stepValue: 0.001, maxPoints: 11 })
    expect(capped).toHaveLength(11)
    const full = buildSweepValues({ startValue: 0, stopValue: 1, stepValue: 0.1 })
    expect(full[full.length - 1]).toBe(1)
  })
})

describe('DC sweep', () => {
  /*
   * A resistive divider: V(OUT) = V1·R2/(R1+R2) exactly, so every sweep point
   * has a closed form to check against rather than another simulation.
   */
  const divider = (): Component[] => [
    voltageSource('V1', ['IN', '0'], 0),
    resistor('R1', ['IN', 'OUT'], 1000),
    resistor('R2', ['OUT', '0'], 2000),
  ]

  it('follows the closed-form divider curve across the whole range', async () => {
    const result = await sweep(divider(), {
      sweepSource: 'V1',
      sweepStart: 0,
      sweepStop: 5,
      sweepStep: 1,
    })

    expect(result.success).toBe(true)
    const data = waveformsOf(result).get('V(OUT)')
    expect(data).toBeDefined()
    expect(data).toHaveLength(6)
    /*
     * The closed form is the ideal divider; the solver adds `gmin` (1e-12 S) to
     * every node on purpose, modelling the finite insulation resistance of a
     * real board (see `stampGmin`). That leaks V(OUT)·gmin into the divider, so
     * the honest comparison is a few parts in 1e9, not machine epsilon — and
     * asserting tighter would only be asserting that gmin is absent.
     */
    for (const point of data ?? []) {
      expect(point.y).toBeCloseTo((point.x * 2) / 3, 7)
    }
  })

  it('solves the same equations a single operating point does', async () => {
    /*
     * The load-bearing invariant: a sweep point and a standalone operating point
     * of the same circuit must agree, because both go through the same `stampDc`
     * with the same override path. If a sweep ever grew its own faster or
     * "close enough" path, this is the test that would catch it.
     */
    const swept = await sweep(divider(), {
      sweepSource: 'V1',
      sweepStart: 0,
      sweepStop: 5,
      sweepStep: 1,
    })

describe('DC sweep of a nonlinear device', () => {
  /*
   * 5 V through 1 kΩ into a diode — the classic forward I–V measurement. This is
   * where a sweep earns its keep: the curve bends, so the points cannot be
   * interpolated from the endpoints.
   */
  const forwardBias = (): Component[] => [
    voltageSource('V1', ['IN', '0'], 0),
    resistor('R1', ['IN', 'OUT'], 1000),
    diode('D1', ['OUT', '0']),
  ]

  it('traces a monotonic forward diode curve', async () => {
    const result = await sweep(forwardBias(), {
      sweepSource: 'V1',
      sweepStart: 0,
      sweepStop: 0.8,
      sweepStep: 0.1,
    })

    expect(result.success).toBe(true)
    const data = waveformsOf(result).get('V(OUT)')
    expect(data).toHaveLength(9)
    const values = (data ?? []).map((point) => point.y)

    // A forward-biased junction can only drop more voltage as it is driven
    // harder, and it starts from nothing at zero drive.
    expect(values[0]).toBeCloseTo(0, 12)
    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]).toBeGreaterThanOrEqual(values[index - 1] - 1e-12)
    }
    // It is a diode: by 0.8 V of drive the drop is a forward drop, not a divider.
    expect(values[values.length - 1]).toBeGreaterThan(0.5)
    expect(values[values.length - 1]).toBeLessThan(0.8)
  })

  it('satisfies Kirchhoff at every point of the curve', async () => {
    /*
     * The current the source delivers must equal the current the resistor
     * carries, computed independently as (V1 − V(OUT))/R1. Comparing against a
     * KCL identity rather than against another simulation means a swept
     * conductance or a stale companion would show up here as a mismatch.
     *
     * Magnitudes are compared because the sign of a source's branch current is a
     * convention; the physics is that the two currents are the same current.
     */
    const result = await sweep(forwardBias(), {
      sweepSource: 'V1',
      sweepStart: 0,
      sweepStop: 0.8,
      sweepStep: 0.1,
    })

    for (let volts = 0; volts <= 0.8001; volts += 0.1) {
      const sweepValue = Number(volts.toFixed(1))
      const out = at(result, 'V(OUT)', sweepValue)
      const diodeCurrent = Math.abs(at(result, 'I(V1)', sweepValue))
      const resistorCurrent = (sweepValue - out) / 1000
      expect(Math.abs(diodeCurrent - resistorCurrent), `at V1 = ${sweepValue}`).toBeLessThan(1e-9)
    }
  })
})

describe('DC sweep of the temperature', () => {
  /*
   * Temperature is SPICE's other `.dc` target and the one that needs no
   * schematic change to be useful: it answers "how much does this bias move over
   * the operating range?".
   *
   * Folio's diode card carries IS and N only — there is no IS(T) or EG in the
   * model — so the thermal voltage is the whole temperature dependence here, and
   * the expectation is derived from that rather than from a datasheet curve:
   * at a fixed current, Vf = n·Vt·ln(I/IS + 1) scales with Vt. Modelling the
   * forbidden-gap term would change this number and is a model change, not a
   * solver one.
   */
  const biasedDiode = (): Component[] => [
    voltageSource('V1', ['IN', '0'], 5),
    resistor('R1', ['IN', 'OUT'], 10000),
    diode('D1', ['OUT', '0']),
  ]

  it('scales the forward drop with the thermal voltage', async () => {
    const result = await sweep(biasedDiode(), {
      sweepSource: 'TEMP',
      sweepStart: 0,
      sweepStop: 100,
      sweepStep: 50,
    })

    expect(result.success).toBe(true)
    const cold = at(result, 'V(OUT)', 0)
    const hot = at(result, 'V(OUT)', 100)

    expect(hot).toBeGreaterThan(cold)
    const thermalRatio = (100 + 273.15) / (0 + 273.15)
    // The current moves slightly with the drop, so this is a ratio check rather
    // than an equality: the diode's own Vt scaling is the effect under test.
    expect(hot / cold).toBeCloseTo(thermalRatio, 1)
  })

  it('reports a temperature axis in degrees, and leaves the schematic alone', async () => {
    const result = await sweep(biasedDiode(), {
      sweepSource: 'TEMP',
      sweepStart: 25,
      sweepStop: 75,
      sweepStep: 25,
    })

    const data = waveformsOf(result).get('V(OUT)')
    expect((data ?? []).map((point) => point.x)).toEqual([25, 50, 75])
  })
})

describe('DC sweep diagnostics', () => {
  it('names an unknown component instead of returning the same curve twice', async () => {
    const result = await sweep(
      [voltageSource('V1', ['IN', '0'], 5), resistor('R1', ['IN', '0'], 1000)],
      { sweepSource: 'V9', sweepStart: 0, sweepStop: 1, sweepStep: 0.5 },
    )

    expect(result.success).toBe(false)
    expect(result.error ?? result.notes?.join(' ') ?? '').toContain('V9')
  })

  it('refuses a sweep whose step never reaches the stop value', async () => {
    const result = await sweep(
      [voltageSource('V1', ['IN', '0'], 5), resistor('R1', ['IN', '0'], 1000)],
      { sweepSource: 'V1', sweepStart: 0, sweepStop: 5, sweepStep: -1 },
    )

    expect(result.success).toBe(false)
  })

  it('exports a `.dc` card that a SPICE tool can read back', async () => {
    const netlist: CircuitNetlist = {
      title: 'export',
      components: [voltageSource('V1', ['IN', '0'], 5), resistor('R1', ['IN', '0'], 1000)],
      analyses: [{ type: 'dc-sweep', sweepSource: 'V1', sweepStart: 0, sweepStop: 5, sweepStep: 1 }],
    }

    expect(spiceEngine.generateSPICENetlist(netlist)).toContain('.dc V1 0 5 1')
  })
})

    const single = await spiceEngine.simulate({
      title: 'operating point',
      components: [voltageSource('V1', ['IN', '0'], 5), ...divider().slice(1)],
      analyses: [{ type: 'dc' }],
    })

    expect(single.success).toBe(true)
    expect(at(swept, 'V(OUT)', 5)).toBeCloseTo(single.operatingPoint?.OUT ?? Number.NaN, 12)
  })
})
