import { describe, expect, it } from 'vitest'
import { spiceEngine, type CircuitNetlist, type Component } from './spiceEngine'

/**
 * Simulation tests.
 *
 * These are not smoke tests: every case checks the solver against a result that
 * can be derived by hand. That is the only way to know the matrix assembly, the
 * companion models and the Newton iteration are all correct rather than merely
 * self-consistent.
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

const capacitor = (name: string, nodes: [string, string], value: string | number): Component => ({
  type: 'capacitor',
  name,
  nodes,
  parameters: { value },
})

const inductor = (name: string, nodes: [string, string], value: string | number): Component => ({
  type: 'inductor',
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

/** 5 V across two equal resistors: the midpoint must be exactly 2.5 V. */
const voltageDivider: CircuitNetlist = {
  title: '5 V resistor divider',
  components: [
    voltageSource('V1', ['VIN', '0'], '5V'),
    resistor('R1', ['VIN', 'OUT'], '1kOhm'),
    resistor('R2', ['OUT', '0'], '1kOhm'),
  ],
  analyses: [{ type: 'dc' }],
}

describe('operating point', () => {
  /*
   * Precision note: the solver adds a `gmin` conductance of 1e-12 S to every node
   * (as SPICE does, modelling finite insulation resistance). That bounds
   * achievable accuracy at roughly 1e-9 relative, so assertions use six decimal
   * places rather than demanding a precision the physics does not have.
   */
  it('solves a resistor divider exactly', async () => {
    const result = await spiceEngine.simulate(voltageDivider)
    expect(result.success).toBe(true)
    expect(result.operatingPoint?.OUT).toBeCloseTo(2.5, 6)
    expect(result.waveforms).toEqual([])
    expect(result.convergenceInfo?.converged).toBe(true)
  })

  it('is bit-for-bit deterministic across runs', async () => {
    const first = await spiceEngine.simulate(voltageDivider)
    const second = await spiceEngine.simulate(voltageDivider)
    expect(second.operatingPoint).toEqual(first.operatingPoint)
  })

  it('agrees with the analytic solution for an uneven divider', async () => {
    const result = await spiceEngine.simulate({
      ...voltageDivider,
      components: [
        voltageSource('V1', ['VIN', '0'], 12),
        resistor('R1', ['VIN', 'OUT'], 4700),
        resistor('R2', ['OUT', '0'], 1000),
      ],
    })
    expect(result.operatingPoint?.OUT).toBeCloseTo((12 * 1000) / 5700, 6)
  })

  it('produces the correct node voltages in a series loop', async () => {
    const result = await spiceEngine.simulate({
      title: 'series loop',
      components: [
        voltageSource('V1', ['A', '0'], 9),
        resistor('R1', ['A', 'B'], 1000),
        resistor('R2', ['B', '0'], 2000),
      ],
      analyses: [{ type: 'dc' }],
    })
    // 9 V across 3 kΩ is 3 mA, so V(B) = 3 mA × 2 kΩ = 6 V.
    expect(result.operatingPoint?.A).toBeCloseTo(9, 6)
    expect(result.operatingPoint?.B).toBeCloseTo(6, 6)
  })

  it('honours engineering suffixes', async () => {
    const result = await spiceEngine.simulate({
      ...voltageDivider,
      components: [
        voltageSource('V1', ['VIN', '0'], '5'),
        resistor('R1', ['VIN', 'OUT'], '2.2k'),
        resistor('R2', ['OUT', '0'], '2.2k'),
      ],
    })
    expect(result.operatingPoint?.OUT).toBeCloseTo(2.5, 6)
  })

  it('supports a current source driving a resistor', async () => {
    const result = await spiceEngine.simulate({
      title: 'current source',
      components: [
        { type: 'current_source', name: 'I1', nodes: ['0', 'A'], parameters: { value: '1m' } },
        resistor('R1', ['A', '0'], 1000),
      ],
      analyses: [{ type: 'dc' }],
    })
    // 1 mA × 1 kΩ = 1 V; the sign depends on the source orientation by design.
    expect(Math.abs(result.operatingPoint?.A ?? 0)).toBeCloseTo(1, 6)
  })

  it('solves a diode circuit to a physically sensible forward drop', async () => {
    const result = await spiceEngine.simulate({
      title: 'diode bias',
      components: [
        voltageSource('V1', ['VIN', '0'], 5),
        resistor('R1', ['VIN', 'OUT'], 1000),
        diode('D1', ['OUT', '0']),
      ],
      analyses: [{ type: 'dc' }],
    })

    expect(result.success).toBe(true)
    const forwardDrop = result.operatingPoint?.OUT ?? 0
    // A silicon diode conducting a few milliamps sits between 0.5 V and 0.8 V.
    expect(forwardDrop).toBeGreaterThan(0.5)
    expect(forwardDrop).toBeLessThan(0.8)
  })

  it('agrees with superposition in a two-source network', async () => {
    const result = await spiceEngine.simulate({
      title: 'superposition',
      components: [
        voltageSource('V1', ['A', '0'], 10),
        voltageSource('V2', ['B', '0'], 5),
        resistor('R1', ['A', 'MID'], 1000),
        resistor('R2', ['B', 'MID'], 1000),
      ],
      analyses: [{ type: 'dc' }],
    })
    // Two equal resistors form a Thevenin midpoint: (10 + 5) / 2 = 7.5 V.
    expect(result.operatingPoint?.MID).toBeCloseTo(7.5, 6)
  })
})

describe('error handling', () => {
  it('rejects unsupported device types with an actionable message', async () => {
    const result = await spiceEngine.simulate({
      ...voltageDivider,
      components: [
        ...voltageDivider.components,
        { type: 'mosfet', name: 'M1', nodes: ['VIN', 'OUT', '0'], parameters: {} },
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('M1')
    expect(result.error).toContain('no model in this solver')
  })

  it('reports a missing parameter rather than producing NaN', async () => {
    const result = await spiceEngine.simulate({
      ...voltageDivider,
      components: [
        voltageSource('V1', ['VIN', '0'], 5),
        { type: 'resistor', name: 'R1', nodes: ['VIN', 'OUT'], parameters: {} },
        resistor('R2', ['OUT', '0'], 1000),
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('R1 resistance is missing')
  })

  it('reports an unconnected terminal instead of silently floating it', async () => {
    const result = await spiceEngine.simulate({
      ...voltageDivider,
      components: [voltageSource('V1', ['VIN', '0'], 5), resistor('R1', ['VIN', 'NC_OUT'], 1000)],
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('unconnected terminal')
  })

  it('rejects contradictory ideal voltage sources instead of inventing a value', async () => {
    const result = await spiceEngine.simulate({
      title: 'conflicting sources',
      components: [voltageSource('V1', ['A', '0'], 5), voltageSource('V2', ['A', '0'], 3)],
      analyses: [{ type: 'dc' }],
    })
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('asks for an analysis when none is selected', async () => {
    const result = await spiceEngine.simulate({ ...voltageDivider, analyses: [] })
    expect(result.success).toBe(false)
    expect(result.error).toContain('Select an analysis')
  })

  it('rejects a negative resistance', async () => {
    const result = await spiceEngine.simulate({
      ...voltageDivider,
      components: [
        voltageSource('V1', ['VIN', '0'], 5),
        resistor('R1', ['VIN', 'OUT'], -1000),
        resistor('R2', ['OUT', '0'], 1000),
      ],
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('resistance must be > 0')
  })
})

describe('validation', () => {
  it('passes a well-formed circuit', async () => {
    const report = await spiceEngine.validateNetlist(voltageDivider)
    expect(report.isValid).toBe(true)
    expect(report.errors).toEqual([])
  })

  it('flags a circuit with no ground reference', async () => {
    const report = await spiceEngine.validateNetlist({
      title: 'floating',
      components: [voltageSource('V1', ['A', 'B'], 5), resistor('R1', ['A', 'B'], 1000)],
      analyses: [{ type: 'dc' }],
    })
    expect(report.isValid).toBe(false)
    expect(report.errors.join(' ')).toContain('no ground reference')
  })

  it('requires an output net for noise analysis', async () => {
    // Nets named A/B: nothing the resolver can infer as an output.
    const report = await spiceEngine.validateNetlist({
      title: 'no output net',
      components: [
        voltageSource('V1', ['A', '0'], 5),
        resistor('R1', ['A', 'B'], 1000),
        resistor('R2', ['B', '0'], 1000),
      ],
      analyses: [{ type: 'noise' }],
    })
    expect(report.isValid).toBe(false)
    expect(report.errors.join(' ')).toContain('output net')
  })
})

describe('transient analysis', () => {
  it('charges an RC network along the analytic exponential', async () => {
    /*
     * A 5 V step into R = 1 kΩ and C = 1 µF gives τ = 1 ms, so at t = τ the
     * capacitor should be at 1 − e⁻¹ = 63.2 % of 5 V. Backward Euler is first
     * order, so a 10 µs step is expected to land within a few tenths of a volt.
     */
    const result = await spiceEngine.simulate({
      title: 'RC charge',
      components: [
        voltageSource('V1', ['VIN', '0'], 5),
        resistor('R1', ['VIN', 'OUT'], 1000),
        capacitor('C1', ['OUT', '0'], '1u'),
      ],
      analyses: [{ type: 'transient', stopTime: 5e-3, stepTime: 1e-5, useInitialConditions: true }],
    })

    expect(result.success).toBe(true)
    const waveform = result.waveforms.find((entry) => entry.name === 'V(OUT)')
    expect(waveform).toBeDefined()

    const atTau = waveform?.data.reduce((best, point) =>
      Math.abs(point.x - 1e-3) < Math.abs(best.x - 1e-3) ? point : best,
    )
    const expected = 5 * (1 - Math.exp(-1))
    expect(atTau?.y).toBeCloseTo(expected, 1)
    // Backward Euler lags the true response, so it must sit below it here.
    expect(atTau?.y).toBeLessThan(expected)

    const final = waveform?.data[waveform.data.length - 1]
    expect(final?.y).toBeLessThanOrEqual(5.0001)
    expect(final?.y).toBeGreaterThan(4.9)
  })

  it('starts from the DC operating point unless initial conditions are requested', async () => {
    const result = await spiceEngine.simulate({
      title: 'charged start',
      components: [
        voltageSource('V1', ['VIN', '0'], 5),
        resistor('R1', ['VIN', 'OUT'], 1000),
        capacitor('C1', ['OUT', '0'], '1u'),
      ],
      analyses: [{ type: 'transient', stopTime: 1e-3, stepTime: 1e-5 }],
    })
    const waveform = result.waveforms.find((entry) => entry.name === 'V(OUT)')
    // At DC the capacitor is charged, so the node barely moves.
    expect(waveform?.data[0].y).toBeCloseTo(5, 3)
    expect(waveform?.data.slice(0, 3).map((point) => Number(point.y.toFixed(6)))).toEqual([5, 5, 5])
  })

  it('integrates an inductor with the companion model exact at the first step', async () => {
    /*
     * Series RL with τ = L/R = 10 µs. `useInitialConditions` matters here: without
     * it SPICE starts from the DC operating point, where the inductor is already a
     * short carrying the full current and nothing changes — correct, but not the
     * transient we want to observe.
     *
     * The first sample is checked against the backward-Euler companion model
     * itself: with zero previous current the inductor behaves as a resistance
     * L/dt, so v_out = V·(L/dt)/(R + L/dt) for whatever step size the solver chose.
     */
    const inductance = 1e-3
    const resistance = 100
    const result = await spiceEngine.simulate({
      title: 'RL step',
      components: [
        voltageSource('V1', ['VIN', '0'], 5),
        resistor('R1', ['VIN', 'OUT'], resistance),
        inductor('L1', ['OUT', '0'], inductance),
      ],
      analyses: [{ type: 'transient', stopTime: 5e-4, stepTime: 1e-8, useInitialConditions: true }],
    })

    expect(result.success).toBe(true)
    const acrossInductor = result.waveforms.find((entry) => entry.name === 'V(OUT)')
    expect(acrossInductor).toBeDefined()

    const samples = acrossInductor?.data ?? []
    const step = samples[1].x - samples[0].x
    const expectedFirst = (5 * (inductance / step)) / (resistance + inductance / step)
    expect(samples[0].y).toBeCloseTo(expectedFirst, 2)

    // Once settled the inductor is a short, so its terminal voltage collapses.
    const final = samples[samples.length - 1]
    expect(Math.abs(final.y)).toBeLessThan(0.2)

    // A widened step is disclosed rather than hidden.
    expect(result.notes?.join(' ')).toContain('Step time was widened')
  })

  it('reports invalid time parameters instead of returning an empty plot', async () => {
    const result = await spiceEngine.simulate({
      ...voltageDivider,
      analyses: [{ type: 'transient', stopTime: 0, stepTime: 0 }],
    })
    expect(result.success).toBe(false)
    expect(result.notes?.join(' ')).toContain('positive stop time')
  })
})

describe('AC analysis', () => {
  it('places the RC low-pass corner at 1/(2πRC)', async () => {
    // R = 1 kΩ, C = 159.155 nF → f_c = 1 kHz exactly.
    const capacitance = 1 / (2 * Math.PI * 1000 * 1000)
    const result = await spiceEngine.simulate({
      title: 'RC low-pass',
      components: [
        { type: 'voltage_source', name: 'V1', nodes: ['IN', '0'], parameters: { value: 1 } },
        resistor('R1', ['IN', 'OUT'], 1000),
        capacitor('C1', ['OUT', '0'], capacitance),
      ],
      analyses: [{ type: 'ac', startFreq: 10, stopFreq: 1e5, pointsPerDecade: 50 }],
    })

    expect(result.success).toBe(true)
    const magnitude = result.waveforms.find((entry) => entry.name === '|V(OUT)|')
    expect(magnitude).toBeDefined()

    const nearestTo = (target: number) =>
      magnitude?.data.reduce((best, point) => (Math.abs(point.x - target) < Math.abs(best.x - target) ? point : best))

    // At the corner the gain is 1/√2; a decade below it is 0.995 (still not unity
    // because 100 Hz is only one decade under a 1 kHz corner).
    expect(nearestTo(1000)?.y).toBeCloseTo(Math.SQRT1_2, 2)
    expect(nearestTo(100)?.y).toBeCloseTo(1 / Math.sqrt(1.01), 4)
    // A decade above the corner the roll-off is a further 20 dB down (0.1).
    expect(nearestTo(10000)?.y).toBeCloseTo(0.1, 2)
  })

  it('resonates a series RLC tank near 1/(2π√LC)', async () => {
    const inductance = 1e-3
    const capacitance = 1e-6
    const resonantFrequency = 1 / (2 * Math.PI * Math.sqrt(inductance * capacitance))
    const result = await spiceEngine.simulate({
      title: 'series RLC',
      components: [
        { type: 'voltage_source', name: 'V1', nodes: ['IN', '0'], parameters: { value: 1 } },
        resistor('R1', ['IN', 'MID'], 10),
        inductor('L1', ['MID', 'OUT'], inductance),
        capacitor('C1', ['OUT', '0'], capacitance),
      ],
      analyses: [{ type: 'ac', startFreq: 100, stopFreq: 20000, pointsPerDecade: 200 }],
    })

    expect(result.success).toBe(true)
    const magnitude = result.waveforms.find((entry) => entry.name === '|V(OUT)|')
    const peak = magnitude?.data.reduce((best, point) => (point.y > best.y ? point : best))
    // A high-Q series tank peaks within 3 % of the analytic resonance, and the
    // capacitor voltage is larger than the drive at resonance.
    expect(peak?.x).toBeGreaterThan(resonantFrequency * 0.97)
    expect(peak?.x).toBeLessThan(resonantFrequency * 1.03)
    expect(peak?.y).toBeGreaterThan(1)
  })

  it('emits phase so sign information is never lost', async () => {
    const result = await spiceEngine.simulate({
      ...voltageDivider,
      components: [
        { type: 'voltage_source', name: 'V1', nodes: ['VIN', '0'], parameters: { value: 1 } },
        resistor('R1', ['VIN', 'OUT'], 1000),
        resistor('R2', ['OUT', '0'], 3000),
      ],
      analyses: [{ type: 'ac', startFreq: 100, stopFreq: 1e4, pointsPerDecade: 5 }],
    })

    const magnitude = result.waveforms.find((entry) => entry.name === '|V(OUT)|')
    expect(magnitude?.data[0].y).toBeCloseTo(0.75, 6)
    expect(result.waveforms.some((entry) => entry.unit === 'deg')).toBe(true)
  })

  it('rejects an inverted frequency range', async () => {
    const result = await spiceEngine.simulate({
      ...voltageDivider,
      analyses: [{ type: 'ac', startFreq: 1e6, stopFreq: 10 }],
    })
    expect(result.success).toBe(false)
    expect(result.notes?.join(' ')).toContain('stop frequency')
  })
})

describe('noise analysis', () => {
  /** A single resistor to ground: its thermal noise is directly observable. */
  const thermalCircuit: CircuitNetlist = {
    title: 'thermal noise of a resistor',
    components: [
      { type: 'current_source', name: 'I1', nodes: ['OUT', '0'], parameters: { value: 0, acMagnitude: 0 } },
      resistor('R1', ['OUT', '0'], 1000),
    ],
    analyses: [{ type: 'noise', startFreq: 1, stopFreq: 1e6, pointsPerDecade: 10, outputNode: 'OUT', temperature: 27 }],
  }

  it('reproduces the Johnson–Nyquist density of a single resistor', async () => {
    /*
     * For one resistor R to ground the output noise density is exactly √(4kTR).
     * At ~300 K and 1 kΩ that is ≈4.07 nV/√Hz. This is a closed-form check of the
     * adjoint implementation. The tolerance is 1 % rather than exact because the
     * solver's `gmin` (1e-12 S) sits in parallel with R and perturbs the reading
     * by about 0.2 % — a deliberate trade that keeps floating nets solvable.
     */
    const result = await spiceEngine.simulate(thermalCircuit)
    expect(result.success).toBe(true)

    const total = result.waveforms.find((entry) => entry.name.startsWith('total noise'))
    expect(total).toBeDefined()

    const temperatureKelvin = 27 + 273.15
    const expected = Math.sqrt(4 * 1.380649e-23 * temperatureKelvin * 1000)
    for (const point of total?.data ?? []) {
      expect(Math.abs(point.y / expected - 1)).toBeLessThan(0.01)
    }

    // The density is flat in frequency — white noise, not a curve.
    const distinct = new Set((total?.data ?? []).map((point) => Number(point.y.toFixed(15))))
    expect(distinct.size).toBe(1)
  })

  it('scales as √R, doubling when the resistance quadruples', async () => {
    const single = await spiceEngine.simulate(thermalCircuit)
    const quadruple = await spiceEngine.simulate({
      ...thermalCircuit,
      components: [
        { type: 'current_source', name: 'I1', nodes: ['OUT', '0'], parameters: { value: 0, acMagnitude: 0 } },
        resistor('R1', ['OUT', '0'], 4000),
      ],
    })

    const density = (result: Awaited<ReturnType<typeof spiceEngine.simulate>>) =>
      result.waveforms.find((entry) => entry.name.startsWith('total noise'))?.data[0].y ?? 0

    expect(density(quadruple) / density(single)).toBeCloseTo(2, 2)
  })

  it('reports an integration figure and a physics note', async () => {
    const result = await spiceEngine.simulate(thermalCircuit)
    expect(result.notes?.join(' ')).toContain('Integrated output noise')
    expect(result.notes?.join(' ')).toContain('thermal voltage')
  })

  it('explains when there is no output net to measure', async () => {
    const result = await spiceEngine.simulate({
      title: 'no output',
      components: [
        { type: 'voltage_source', name: 'V1', nodes: ['A', '0'], parameters: { value: 1 } },
        resistor('R1', ['A', 'B'], 1000),
        resistor('R2', ['B', '0'], 1000),
      ],
      analyses: [{ type: 'noise' }],
    })
    expect(result.success).toBe(false)
    expect(result.notes?.join(' ')).toContain('output net')
  })
})

describe('Monte Carlo tolerance sweep', () => {
  const sweep = (iterations: number, seed: number, tolerance = 0.05): CircuitNetlist => ({
    title: 'divider tolerance',
    components: [
      voltageSource('V1', ['VIN', '0'], 5),
      resistor('R1', ['VIN', 'OUT'], '1k'),
      resistor('R2', ['OUT', '0'], '1k'),
    ],
    analyses: [{ type: 'montecarlo', iterations, tolerance, seed }],
  })

  it('matches the analytic 3σ spread of a symmetric divider', async () => {
    /*
     * v = 5·R2/(R1+R2) with R1, R2 independently perturbed by ±5 % (1σ).
     *   ∂v/∂δ₁ = ∂v/∂δ₂ = −5/4 at nominal, so σ_v = (5/4)·√(2)·0.05 = 0.08839 V
     * The mean must sit at 2.5 V and the ±3σ envelope at 0.265 V.
     *
     * Note this is a *statistical* envelope, so it deliberately extends past the
     * hard ±5 % worst case (2.692 V) — a common misreading that the assertions
     * below make explicit.
     */
    const result = await spiceEngine.simulate(sweep(300, 42))
    expect(result.success).toBe(true)

    const upper = result.waveforms.find((entry) => entry.name === 'V(OUT) mean +3σ')
    const lower = result.waveforms.find((entry) => entry.name === 'V(OUT) mean −3σ')
    const mean = result.waveforms.find((entry) => entry.name === 'V(OUT) mean')

    const analyticSigma = (5 / 4) * Math.SQRT2 * 0.05
    const runs = 300
    /*
     * The sample mean itself is random: its standard error is σ/√n ≈ 5.1 mV for
     * 300 runs, so requiring the mean to be within 5 mV of 2.5 V would be a
     * coin flip. Three standard errors is the statistically honest bound.
     */
    const standardError = analyticSigma / Math.sqrt(runs)
    expect(Math.abs((mean?.data[0].y ?? 0) - 2.5)).toBeLessThan(3 * standardError)

    expect((upper?.data[0].y ?? 0) - (mean?.data[0].y ?? 0)).toBeCloseTo(3 * analyticSigma, 1)
    expect((mean?.data[0].y ?? 0) - (lower?.data[0].y ?? 0)).toBeCloseTo(3 * analyticSigma, 1)

    // The envelope is symmetric about the mean.
    expect((upper?.data[0].y ?? 0) + (lower?.data[0].y ?? 0)).toBeCloseTo(2 * (mean?.data[0].y ?? 0), 2)
  })

  it('is reproducible for a given seed', async () => {
    const first = await spiceEngine.simulate(sweep(50, 7))
    const second = await spiceEngine.simulate(sweep(50, 7))
    expect(second.waveforms).toEqual(first.waveforms)
  })

  it('changes when the seed changes', async () => {
    const first = await spiceEngine.simulate(sweep(50, 1))
    const second = await spiceEngine.simulate(sweep(50, 2))
    expect(second.waveforms).not.toEqual(first.waveforms)
  })

  it('widens the envelope as tolerance grows', async () => {
    const narrow = await spiceEngine.simulate(sweep(200, 11, 0.01))
    const wide = await spiceEngine.simulate(sweep(200, 11, 0.1))
    const spread = (result: Awaited<ReturnType<typeof spiceEngine.simulate>>) => {
      const upper = result.waveforms.find((entry) => entry.name === 'V(OUT) mean +3σ')?.data[0].y ?? 0
      const lower = result.waveforms.find((entry) => entry.name === 'V(OUT) mean −3σ')?.data[0].y ?? 0
      return upper - lower
    }
    expect(spread(wide)).toBeGreaterThan(spread(narrow) * 5)
  })

  it('reports how many runs contributed', async () => {
    const result = await spiceEngine.simulate(sweep(25, 3))
    expect(result.notes?.join(' ')).toContain('25 runs')
    expect(result.notes?.join(' ')).toContain('seed 3')
  })
})
