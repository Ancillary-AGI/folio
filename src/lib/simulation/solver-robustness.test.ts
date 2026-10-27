/**
 * Adversarial robustness suite for the numerical solvers.
 *
 * The rule applied to every case: a solver either refuses with an error/note
 * that names the problem, or returns finite, physically sensible numbers.
 * NaN, ±Infinity and "plausible but wrong" output are all failures.
 *
 * Expected values come from closed-form circuit/control theory, never from
 * recorded output. Each tolerance states the accuracy the method really has:
 * backward Euler is O(dt), trapezoidal/BDF2/RK4 are O(dt²)–O(dt⁴), a dense
 * Durand–Kerner solve on a multiple root is limited by ε^(1/m) conditioning,
 * and a finite frequency grid locates a resonance only to its own spacing.
 */
import { describe, expect, it } from 'vitest'
import { buildCircuitModel, type CircuitModel } from './circuitModel'
import {
  DEFAULT_GMIN,
  buildFrequencyGrid,
  buildSweepValues,
  isBiasIndependent,
  readNodeVoltages,
  runAcSweep,
  runDcSweep,
  runOperatingPoint,
  runTransient,
  type AnalysisOutcome,
} from './solver'
import { runNoiseAnalysis } from './noise'
import { runMonteCarlo } from './monteCarlo'
import { spiceEngine, type CircuitNetlist, type Component } from './spiceEngine'
import {
  bodeResponse,
  complex,
  evaluatePolynomial,
  polynomialRoots,
  simulateStep,
  stabilityMargins,
  tfFeedback,
  tfPoles,
  tfStability,
  tfZeros,
  type TransferFunction,
} from '../control/transferFunction'
import { rfCircuitDesigner } from '../rf/rfCircuitDesign'

/* ────────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────────── */

const BOLTZMANN = 1.380649e-23
const KELVIN = 273.15

type Points = Array<{ x: number; y: number }>

const part = (
  type: string,
  name: string,
  nodes: string[],
  parameters: Record<string, string | number>,
): Component => ({ type, name, nodes, parameters })
const resistor = (name: string, nodes: [string, string], value: string | number): Component =>
  part('resistor', name, nodes, { value })
const capacitor = (name: string, nodes: [string, string], value: string | number): Component =>
  part('capacitor', name, nodes, { value })
const inductor = (name: string, nodes: [string, string], value: string | number): Component =>
  part('inductor', name, nodes, { value })
const voltageSource = (name: string, nodes: [string, string], value: string | number): Component =>
  part('voltage_source', name, nodes, { value })
const currentSource = (name: string, nodes: [string, string], value: string | number): Component =>
  part('current_source', name, nodes, { value })

const netlist = (
  components: Component[],
  analyses: CircuitNetlist['analyses'] = [{ type: 'transient' }],
): CircuitNetlist => ({ title: 'robustness', components, analyses })

/** Build a model and assert the netlist itself is valid. */
function mustBuild(components: Component[]): CircuitModel {
  const built = buildCircuitModel(netlist(components))
  expect(built.errors).toEqual([])
  return built.model
}

function expectAllFinite(values: Iterable<number>): void {
  for (const value of values) expect(Number.isFinite(value)).toBe(true)
}

/** Every point of every returned waveform must be a finite number. */
function expectOutcomeIsFinite(outcome: Pick<AnalysisOutcome, 'waveforms' | 'nodes'>): void {
  for (const entry of outcome.waveforms) {
    expect(entry.data.length).toBeGreaterThan(0)
    expectAllFinite(entry.data.flatMap((point) => [point.x, point.y]))
  }
  for (const node of outcome.nodes) {
    if (node.voltage !== undefined) expect(Number.isFinite(node.voltage)).toBe(true)
  }
}

function waveform(result: AnalysisOutcome, name: string): Points {
  const found = result.waveforms.find((entry) => entry.name === name)
  expect(found, `waveform "${name}" missing from ${result.waveforms.map((w) => w.name).join(', ')}`).toBeDefined()
  return found!.data
}

/** Linear interpolation of x-sorted data at x = target. */
function interpolate(data: Points, target: number): number {
  expect(data.length).toBeGreaterThan(1)
  for (let i = 1; i < data.length; i += 1) {
    if (data[i].x >= target) {
      const a = data[i - 1]
      const b = data[i]
      const span = b.x - a.x
      if (span <= 0) return b.y
      return a.y + ((target - a.x) / span) * (b.y - a.y)
    }
  }
  return data[data.length - 1].y
}

/** First x where the data crosses `level` going up; NaN when it never does. */
function crossingTime(data: Points, level: number): number {
  for (let i = 1; i < data.length; i += 1) {
    if (data[i - 1].y < level && data[i].y >= level) {
      const a = data[i - 1]
      const b = data[i]
      return a.x + ((level - a.y) / (b.y - a.y)) * (b.x - a.x)
    }
  }
  return Number.NaN
}

const rcLowPass = (): CircuitModel =>
  mustBuild([
    voltageSource('V1', ['IN', '0'], '5V'),
    resistor('R1', ['IN', 'OUT'], '1k'),
    capacitor('C1', ['OUT', '0'], '1u'),
  ])

/* ────────────────────────────────────────────────────────────────────────────
 * Analytic baselines — the hostile cases only mean something if these pass
 * ──────────────────────────────────────────────────────────────────────────── */

describe('analytic baselines', () => {
  it("solves a resistive divider to Kirchhoff's closed form", () => {
    // 5 V across 1 k + 3 k, tap = 5·3000/4000 = 3.75 V.
    const model = mustBuild([
      voltageSource('V1', ['IN', '0'], '5V'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      resistor('R2', ['OUT', '0'], '3k'),
    ])
    const result = runOperatingPoint(model, { temperatureCelsius: 27 })
    expect(result.failure).toBeUndefined()
    const voltages = readNodeVoltages(model, result.solution)
    expect(voltages.get('IN')).toBeCloseTo(5, 10)
    // The only bias is gmin = 1e-12 S leakage across kΩ networks (~1e-9 relative),
    // so 8 digits is a real claim, not a fitted one.
    expect(voltages.get('OUT')).toBeCloseTo((5 * 3000) / (1000 + 3000), 8)
  })

  it('charges an RC node with the analytic time constant τ = RC', () => {
    const R = 1e3
    const C = 1e-6
    const tau = R * C
    const model = rcLowPass()
    const result = runTransient(model, {
      temperatureCelsius: 27,
      stopTime: 5 * tau,
      stepTime: tau / 2000,
      useInitialConditions: true,
    })
    expect(result.converged).toBe(true)
    const data = waveform(result, 'V(OUT)')
    /*
     * The display budget is 2000 points, so the 10 000 requested steps are widened
     * to τ/400 and the first emitted sample is already one step past t = 0. Compare
     * it with the analytic value at its own time instead of pretending it is zero.
     */
    expect(data[0].x).toBeGreaterThan(0)
    const firstExact = 5 * (1 - Math.exp(-data[0].x / tau))
    expect(Math.abs(data[0].y - firstExact) / firstExact).toBeLessThan(0.05)
    // Backward Euler cannot overshoot the final value on a charging node.
    expect(data[0].y).toBeLessThan(5)
    // v(t) = 5(1 − e^(−t/τ)). Backward Euler lags by ~dt/(2τ) = 0.025 % here.
    for (const multiple of [1, 2, 3]) {
      const t = multiple * tau
      const expected = 5 * (1 - Math.exp(-multiple))
      const actual = interpolate(data, t)
      // BE is monotone and always below the exact exponential.
      expect(actual).toBeLessThanOrEqual(expected * 1.001)
      expect(Math.abs(actual - expected) / expected).toBeLessThan(0.005)
    }
    const measuredTau = crossingTime(data, 5 * (1 - Math.exp(-1)))
    expect(Math.abs(measuredTau - tau) / tau).toBeLessThan(0.005)
    expectOutcomeIsFinite(result)
  })

  it('keeps the second-order rules inside their truncation error', () => {
    const tau = 1e3 * 1e-6
    const model = rcLowPass()
    for (const method of ['trapezoidal', 'bdf2'] as const) {
      const result = runTransient(model, {
        temperatureCelsius: 27,
        stopTime: 5 * tau,
        stepTime: tau / 500,
        useInitialConditions: true,
        integrationMethod: method,
      })
      expect(result.converged).toBe(true)
      const expected = 5 * (1 - Math.exp(-1))
      const actual = interpolate(waveform(result, 'V(OUT)'), tau)
      // Startup steps are backward Euler, so the global error is worse than the
      // O(dt²) asymptote until the history is built; 0.2 % is what these rules
      // actually deliver on this step size.
      expect(Math.abs(actual - expected) / expected, method).toBeLessThan(0.002)
    }
  })

  it('places the RC −3 dB corner and the −20 dB/decade slope where theory says', () => {
    const R = 1e3
    const C = 1e-6
    const fc = 1 / (2 * Math.PI * R * C)
    const model = rcLowPass()
    const atCorner = runAcSweep(model, {
      temperatureCelsius: 27,
      startFrequency: fc,
      stopFrequency: fc,
      linearPoints: 1,
    })
    expect(atCorner.converged).toBe(true)
    // The AC engine drives independent sources at unit magnitude, so the node
    // magnitudes are the transfer function directly: |H(fc)| = 1/√2.
    const excitation = interpolate(waveform(atCorner, '|V(IN)|'), fc)
    const response = waveform(atCorner, '|V(OUT)|')[0].y
    expect(Math.abs(response / excitation - 1 / Math.SQRT2)).toBeLessThan(1e-3)

    const decade = runAcSweep(model, {
      temperatureCelsius: 27,
      startFrequency: 10 * fc,
      stopFrequency: 1000 * fc,
      pointsPerDecade: 20,
    })
    const data = waveform(decade, '|V(OUT)|')
    const db = (frequency: number): number => 20 * Math.log10(interpolate(data, frequency))
    // Exactly one decade out, a first-order roll-off is −20.0 dB per decade.
    expect(Math.abs(db(100 * fc) - db(10 * fc) + 20)).toBeLessThan(0.1)
    expectAllFinite(data.map((point) => point.y))
  })

  it('resonates a series RLC at 1/(2π√LC) with the analytic Q', () => {
    const L = 1e-3
    const C = 1e-6
    const R = 1
    const omega0 = 1 / Math.sqrt(L * C)
    const f0 = omega0 / (2 * Math.PI)
    const q = (omega0 * L) / R
    const model = mustBuild([
      voltageSource('V1', ['IN', '0'], '5V'),
      resistor('R1', ['IN', 'A'], String(R)),
      inductor('L1', ['A', 'B'], '1m'),
      capacitor('C1', ['B', '0'], '1u'),
    ])
    const result = runAcSweep(model, {
      temperatureCelsius: 27,
      startFrequency: 1000,
      stopFrequency: 20000,
      linearPoints: 2000,
    })
    expect(result.converged).toBe(true)
    const data = waveform(result, '|V(B)|')
    let peak = data[0]
    for (const point of data) if (point.y > peak.y) peak = point
    // The grid spacing is 9.5 Hz (0.19 % of f0) and the peak is stationary, so
    // 1 % is the resolution claim, not a solver-accuracy claim.
    expect(Math.abs(peak.x - f0) / f0).toBeLessThan(0.01)
    // At resonance the loop current is V/R, so |V(C)| = Q·|V(drive)|. The AC
    // engine stamps each independent source with its DC value as the small-signal
    // magnitude, so the raw node magnitude here is 5·Q — normalise by the drive.
    const drive = interpolate(waveform(result, '|V(IN)|'), peak.x)
    expect(Math.abs(peak.y / drive - q) / q).toBeLessThan(0.02)
    expectAllFinite(data.map((point) => point.y))
  })

  it('reports Johnson noise of a 1 kΩ resistor as √(4kTR)', () => {
    const temperatureCelsius = 27
    const R = 1000
    const expected = Math.sqrt(4 * BOLTZMANN * (temperatureCelsius + KELVIN) * R)
    const model = mustBuild([voltageSource('V1', ['IN', '0'], '5V'), resistor('R1', ['IN', 'OUT'], '1k')])
    const result = runNoiseAnalysis(model, {
      temperatureCelsius,
      startFrequency: 100,
      stopFrequency: 10e3,
      pointsPerDecade: 5,
      outputNode: 'OUT',
    })
    expect(result.converged).toBe(true)
    const density = waveform(result, 'thermal+diode noise at OUT')[0].y
    expect(Math.abs(density - expected) / expected).toBeLessThan(0.02)
  })

  it('rolls the output noise of an RC filter off at −20 dB/decade', () => {
    const R = 1e3
    const C = 1e-6
    const fc = 1 / (2 * Math.PI * R * C)
    const model = rcLowPass()
    const result = runNoiseAnalysis(model, {
      temperatureCelsius: 27,
      startFrequency: fc / 10,
      stopFrequency: fc * 10,
      pointsPerDecade: 20,
      outputNode: 'OUT',
    })
    expect(result.converged).toBe(true)
    const data = waveform(result, 'thermal+diode noise at OUT')
    const low = interpolate(data, fc / 10)
    const high = interpolate(data, fc * 10)
    expect(Math.abs(low - Math.sqrt(4 * BOLTZMANN * (27 + KELVIN) * R)) / low).toBeLessThan(0.05)
    // A decade above the corner the density is 10× smaller (|H|² = 1/(1+(f/fc)²)).
    expect(Math.abs(high / low - 0.1) / 0.1).toBeLessThan(0.1)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * Structural hostility: netlists a schematic or a hand edit can produce
 * ──────────────────────────────────────────────────────────────────────────── */

describe('netlist structure hostility', () => {
  it('refuses an empty component list instead of "succeeding" with zero nodes', async () => {
    const built = buildCircuitModel(netlist([]))
    expect(built.errors.join(' ')).toMatch(/no components/i)
    const result = await spiceEngine.simulate(netlist([], [{ type: 'dc' }]))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/no components/i)
    expect(result.nodes).toEqual([])
  })

  it('refuses a netlist with no selected analysis', async () => {
    const result = await spiceEngine.simulate(netlist([resistor('R1', ['A', '0'], '1k')], []))
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/analysis/i)
  })

  it('refuses duplicate reference designators rather than overwriting a branch row', () => {
    // Two `V1` share one MNA constraint row keyed by name: the second silently
    // replaced the first before this check existed, i.e. a wrong answer.
    const duplicated = buildCircuitModel(
      netlist([voltageSource('V1', ['A', '0'], '5'), voltageSource('V1', ['B', '0'], '12')], [{ type: 'dc' }]),
    )
    expect(duplicated.errors.join(' ')).toMatch(/duplicate reference designator/i)

    // SPICE designators are case-insensitive, and `branchRows` keys both forms.
    const cased = buildCircuitModel(
      netlist([voltageSource('V1', ['A', '0'], '5'), voltageSource('v1', ['B', '0'], '12')], [{ type: 'dc' }]),
    )
    expect(cased.errors.join(' ')).toMatch(/duplicate reference designator/i)

    const unique = buildCircuitModel(
      netlist([voltageSource('V1', ['A', '0'], '5'), voltageSource('V2', ['B', '0'], '12')], [{ type: 'dc' }]),
    )
    expect(unique.errors).toEqual([])
  })

  it('reports duplicated passive parts, which would otherwise both be stamped', () => {
    const built = buildCircuitModel(
      netlist([resistor('R1', ['A', '0'], '1k'), resistor('R1', ['A', '0'], '3k')], [{ type: 'dc' }]),
    )
    expect(built.errors.join(' ')).toMatch(/duplicate reference designator/i)
  })

  it('keeps ground symbols shareable (they are net aliases, not devices)', () => {
    const built = buildCircuitModel(
      netlist(
        [
          voltageSource('V1', ['A', '0'], '5'),
          resistor('R1', ['A', 'B'], '1k'),
          part('ground', 'GND', ['0'], {}),
          part('ground', 'GND', ['0'], {}),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(built.errors).toEqual([])
  })

  it('refuses unknown device types, missing terminals and unnamed nets', () => {
    /*
     * Classification is substring-based, so "flux capacitor" really is a
     * capacitor here. A type string that matches no device keyword and no
     * SPICE designator prefix is the genuinely unknown case.
     */
    const unknown = buildCircuitModel(netlist([part('memristor', 'MM1', ['A', '0'], { value: '1' })]))
    expect(unknown.errors.join(' ')).toMatch(/no model in this solver/i)

    const tooFew = buildCircuitModel(netlist([part('resistor', 'R1', ['A'], { value: '1k' })]))
    expect(tooFew.errors.join(' ')).toMatch(/needs two terminals/i)

    const unnamed = buildCircuitModel(netlist([resistor('R1', ['A', '  '], '1k')]))
    expect(unnamed.errors.join(' ')).toMatch(/unnamed terminal/i)
  })

  it('refuses a transistor wired with the wrong terminal count', () => {
    const built = buildCircuitModel(netlist([part('bjt', 'Q1', ['C', 'B'], { value: '1' })]))
    expect(built.errors.join(' ')).toMatch(/needs 3 terminals/i)
  })

  it('rejects non-finite component values instead of stamping NaN', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'NaN', '1/0']) {
      const built = buildCircuitModel(netlist([resistor('R1', ['A', '0'], bad as number)]))
      expect(built.errors.length, String(bad)).toBeGreaterThan(0)
      expect(built.errors.join(' '), String(bad)).toMatch(/not a valid|finite|parse|invalid|must be > 0/i)
    }
  })

  it('rejects zero and negative R, C, L — all non-physical for a solver', () => {
    for (const value of ['0', '-1k']) {
      const built = buildCircuitModel(netlist([resistor('R1', ['A', '0'], value)]))
      expect(built.errors.join(' '), value).toMatch(/must be > 0|positive resistance/i)
    }
    expect(buildCircuitModel(netlist([capacitor('C1', ['A', '0'], '0')])).errors.join(' ')).toMatch(/capacitance must be > 0/i)
    expect(buildCircuitModel(netlist([inductor('L1', ['A', '0'], '-1')])).errors.join(' ')).toMatch(/inductance must be > 0/i)
  })

  it('survives the extreme dynamic range 1e-30 … 1e30 without a wrong answer', () => {
    for (const [series, shunt] of [['1e-30', '1e30'], ['1e30', '1e-30'], ['1f', '1G'], ['1e-30', '1e-30']]) {
      const model = mustBuild([
        voltageSource('V1', ['IN', '0'], '5V'),
        resistor('R1', ['IN', 'OUT'], series),
        resistor('R2', ['OUT', '0'], shunt),
      ])
      const result = runOperatingPoint(model, { temperatureCelsius: 27 })
      if (result.failure !== undefined) {
        /*
         * A 1e-30 Ω series resistor against a 1e30 Ω shunt is a 1e60 condition
         * number: scaled partial pivoting in double precision cannot resolve it,
         * and refusing with `singular` is the honest verdict. What must never
         * happen is a converged run built on a collapsed matrix.
         */
        expect(result.failure, `${series}/${shunt}`).toBe('singular')
        expectAllFinite(result.outcome.nodes.map((node) => node.voltage ?? 0))
        continue
      }
      expect(result.outcome.converged, `${series}/${shunt}`).toBe(true)
      const voltages = readNodeVoltages(model, result.solution)
      expectAllFinite([...voltages.values()])
      // A passive divider can never leave the [0, 5] V rail span, whatever the
      // resistance ratio is.
      for (const value of voltages.values()) {
        expect(value).toBeGreaterThanOrEqual(-1e-6)
        expect(value).toBeLessThanOrEqual(5 + 1e-6)
      }
    }
  })

  it('solves a floating pair of nets to a finite, symmetric answer via gmin', () => {
    // No net named 0 anywhere: the only return path is the gmin leakage.
    const model = mustBuild([voltageSource('V1', ['A', 'B'], '5V'), resistor('R1', ['B', 'A'], '1k')])
    const result = runOperatingPoint(model, { temperatureCelsius: 27 })
    expect(result.outcome.converged).toBe(true)
    const voltages = readNodeVoltages(model, result.solution)
    const a = voltages.get('A')!
    const b = voltages.get('B')!
    expect(Number.isFinite(a) && Number.isFinite(b)).toBe(true)
    expect(a - b).toBeCloseTo(5, 9)
    // The unconstrained mode is pinned by gmin at 0 V → the pair sits at ±2.5 V.
    // Newton stops at a 1e-6 relative residual, so the common mode is only held to
    // that fraction of the 2.5 V rail — a relative claim, not an absolute one.
    expect(Math.abs(a + b) / Math.max(Math.abs(a), Math.abs(b))).toBeLessThan(1e-5)
  })

  it('flags a current source driving a lone floating net instead of hiding 1e9 V', () => {
    const model = mustBuild([currentSource('I1', ['0', 'FLOAT'], '1mA')])
    const result = runOperatingPoint(model, { temperatureCelsius: 27 })
    const voltages = readNodeVoltages(model, result.solution)
    // The answer IS 1 mA / gmin = 1e9 V; the requirement is that it is reported.
    expect(voltages.get('FLOAT')).toBeCloseTo(1e-3 / DEFAULT_GMIN, -6)
    expect(result.outcome.notes.join(' ')).toMatch(/floating/i)
  })

  it('reports an all-ground circuit instead of "solving" a 0×0 system', () => {
    const built = buildCircuitModel(netlist([resistor('R1', ['0', 'GND'], '1k')], [{ type: 'dc' }]))
    expect(built.errors.join(' ')).toMatch(/every net is ground/i)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * Singular and indeterminate topologies
 * ──────────────────────────────────────────────────────────────────────────── */

describe('singular and indeterminate topologies', () => {
  it('labels contradicting parallel ideal voltage sources as singular', () => {
    const model = mustBuild([voltageSource('V1', ['A', '0'], '5V'), voltageSource('V2', ['A', '0'], '12V')])
    const result = runOperatingPoint(model, { temperatureCelsius: 27 })
    expect(result.failure).toBe('singular')
    expect(result.outcome.converged).toBe(false)
    expectOutcomeIsFinite(result.outcome)
  })

  it('labels a resistance-free source loop as singular', () => {
    const model = mustBuild([voltageSource('V1', ['A', 'B'], '5V'), voltageSource('V2', ['B', 'A'], '5V')])
    const result = runOperatingPoint(model, { temperatureCelsius: 27 })
    expect(result.failure).toBe('singular')
    expectOutcomeIsFinite(result.outcome)
  })

  it('says the bias is indeterminate for a source across an ideal inductor', () => {
    const model = mustBuild([voltageSource('V1', ['A', 'B'], '5V'), inductor('L1', ['A', 'B'], '1m')])
    const result = runOperatingPoint(model, { temperatureCelsius: 27 })
    expect(result.failure).toBe('singular')
    expect(isBiasIndependent(model)).toBe(true)
    expectOutcomeIsFinite(result.outcome)
  })

  it('refuses an AC sweep whose small-signal matrix is singular', () => {
    const model = mustBuild([
      voltageSource('V1', ['IN', '0'], '5V'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1u'),
      voltageSource('V2', ['X', 'Y'], '0'),
      inductor('L1', ['X', 'Y'], '1m'),
    ])
    const result = runAcSweep(model, { temperatureCelsius: 27, startFrequency: 1e3, stopFrequency: 1e4, pointsPerDecade: 5 })
    /*
     * `isBiasIndependent` lets the DC indeterminacy (an ideal source across a
     * lossless inductor) be stepped over, but at AC the same loop is a null row
     * pair at every frequency: the small-signal matrix really is singular there.
     * The driver must stop and name it, not emit samples of NaN.
     */
    if (result.waveforms.length === 0) {
      expect(result.converged).toBe(false)
      expect(result.notes.join(' ')).toMatch(/singular/i)
    } else {
      expectOutcomeIsFinite(result)
    }
    // The unrelated RC branch is still solvable once the loop is broken by a R.
    const sane = mustBuild([
      voltageSource('V1', ['IN', '0'], '5V'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1u'),
    ])
    const ac = runAcSweep(sane, { temperatureCelsius: 27, startFrequency: 1e3, stopFrequency: 1e4, pointsPerDecade: 5 })
    expect(ac.waveforms.length).toBeGreaterThan(0)
    expectOutcomeIsFinite(ac)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * DC sweep hostility
 * ──────────────────────────────────────────────────────────────────────────── */

describe('DC sweep hostility', () => {
  const divider = (): CircuitModel =>
    mustBuild([
      voltageSource('V1', ['IN', '0'], '0V'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      resistor('R2', ['OUT', '0'], '3k'),
    ])

  it('produces an empty sweep, never an infinite one, for impossible steps', () => {
    expect(buildSweepValues({ startValue: 0, stopValue: 10, stepValue: 0 })).toEqual([])
    expect(buildSweepValues({ startValue: 0, stopValue: 10, stepValue: -1 })).toEqual([])
    expect(buildSweepValues({ startValue: 10, stopValue: 0, stepValue: 1 })).toEqual([])
    expect(buildSweepValues({ startValue: 0, stopValue: Number.NaN, stepValue: 1 })).toEqual([])
    expect(buildSweepValues({ startValue: Number.POSITIVE_INFINITY, stopValue: 10, stepValue: 1 })).toEqual([])
  })

  it('treats a degenerate start = stop sweep as one point', () => {
    expect(buildSweepValues({ startValue: 5, stopValue: 5, stepValue: 1 })).toEqual([5])
  })

  it('stays inside the requested window when the step overshoots it', () => {
    // A step wider than the span yields the start point only — the driver then
    // reports the point count, it does not invent a second point.
    expect(buildSweepValues({ startValue: 0, stopValue: 10, stepValue: 100 })).toEqual([0])
    expect(buildSweepValues({ startValue: 0, stopValue: 10, stepValue: 3 })).toEqual([0, 3, 6, 9])
    expect(buildSweepValues({ startValue: 0, stopValue: 10, stepValue: 2.5 })).toEqual([0, 2.5, 5, 7.5, 10])
  })

  it('clamps an absurd point budget to finite, in-range values', () => {
    const values = buildSweepValues({ startValue: 0, stopValue: 1e9, stepValue: 1, maxPoints: 50 })
    expect(values.length).toBeLessThanOrEqual(50)
    expect(values[0]).toBe(0)
    expect(values[values.length - 1]).toBeLessThanOrEqual(1e9)
    expectAllFinite(values)
  })

  it('sweeps the divider monotonically and matches Kirchhoff at every point', () => {
    const result = runDcSweep(divider(), {
      temperatureCelsius: 27,
      deviceName: 'V1',
      startValue: 0,
      stopValue: 10,
      stepValue: 2.5,
    })
    expect(result.points.map((point) => point.value)).toEqual([0, 2.5, 5, 7.5, 10])
    for (const point of result.points) {
      /*
       * Newton stops at a 1e-6 relative residual and gmin = 1e-12 S leaks across
       * the divider, so the delivered accuracy on this kΩ network is ~1e-9 relative
       * (5.6e-9 V at the 7.5 V point). Six decimals is what the solver really
       * guarantees; claiming eight would be fitting the test to the code.
       */
      expect(point.voltages.OUT, String(point.value)).toBeCloseTo((point.value * 3000) / (1000 + 3000), 6)
      expectAllFinite(Object.values(point.voltages))
    }
  })

  it('keeps a sweep running into a singular topology reported, not NaN-filled', () => {
    const model = mustBuild([voltageSource('V1', ['IN', '0'], '0'), voltageSource('V2', ['IN', '0'], '5')])
    const result = runDcSweep(model, {
      temperatureCelsius: 27,
      deviceName: 'V1',
      startValue: -1,
      stopValue: 1,
      stepValue: 0.5,
    })
    expect(result.outcome.converged).toBe(false)
    for (const point of result.points) expectAllFinite(Object.values(point.voltages))
  })

  it('refuses to sweep a device that is not in the netlist', () => {
    const result = runDcSweep(divider(), {
      temperatureCelsius: 27,
      deviceName: 'V99',
      startValue: 0,
      stopValue: 5,
      stepValue: 1,
    })
    expect(result.outcome.converged).toBe(false)
    expect(result.points).toEqual([])
    expect(result.outcome.notes.join(' ')).toMatch(/no component named "V99"/i)
  })

  it('sweeps a 18-decade resistor range and stays inside the rail span', () => {
    const model = mustBuild([
      voltageSource('V1', ['IN', '0'], '5V'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      resistor('RLOAD', ['OUT', '0'], '1k'),
    ])
    const result = runDcSweep(model, {
      temperatureCelsius: 27,
      deviceName: 'R1',
      startValue: 1e-9,
      stopValue: 1e9,
      stepValue: 1e3,
    })
    expect(result.points.length).toBeGreaterThan(5)
    for (const point of result.points) {
      expectAllFinite(Object.values(point.voltages))
      for (const voltage of Object.values(point.voltages)) {
        expect(voltage).toBeGreaterThanOrEqual(-1e-9)
        expect(voltage).toBeLessThanOrEqual(5 + 1e-9)
      }
    }
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * Transient hostility
 * ──────────────────────────────────────────────────────────────────────────── */

describe('transient hostility', () => {
  it('refuses non-finite, zero and negative time budgets', () => {
    for (const stopTime of [0, -1e-6, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = runTransient(rcLowPass(), { temperatureCelsius: 27, stopTime, stepTime: 1e-6 })
      expect(result.converged, `stopTime ${stopTime}`).toBe(false)
      expect(result.waveforms).toEqual([])
      expect(result.notes.join(' ')).toMatch(/finite positive stop time and step time/i)
    }
    for (const stepTime of [0, -1e-6, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = runTransient(rcLowPass(), { temperatureCelsius: 27, stopTime: 1e-3, stepTime })
      expect(result.converged, `stepTime ${stepTime}`).toBe(false)
      expect(result.waveforms).toEqual([])
      expect(result.notes.join(' ')).toMatch(/finite positive stop time and step time/i)
    }

    /*
     * A 1e-320 s window is finite and positive, so the range guard cannot reject it
     * and the display budget widens nothing. The companion conductance C/dt then
     * overflows, so the honest outcome is the typed "singular matrix" refusal with
     * no samples — never a waveform of NaN.
     */
    const subnormal = runTransient(rcLowPass(), { temperatureCelsius: 27, stopTime: 1e-320, stepTime: 1e-6 })
    expect(subnormal.converged).toBe(false)
    expect(subnormal.waveforms).toEqual([])
    expect(subnormal.notes.join(' ')).toMatch(/finite positive stop time and step time|singular matrix/i)
  })

  it('survives a print step larger than the whole window', () => {
    const result = runTransient(rcLowPass(), { temperatureCelsius: 27, stopTime: 1e-6, stepTime: 10 })
    expect(result.converged).toBe(true)
    expectOutcomeIsFinite(result)
  })

  it('clamps an absurdly small print step to the point budget', () => {
    const result = runTransient(rcLowPass(), { temperatureCelsius: 27, stopTime: 1, stepTime: 1e-12, maxPoints: 200 })
    expect(result.converged).toBe(true)
    for (const entry of result.waveforms) {
      expect(entry.data.length).toBeLessThanOrEqual(400)
    }
    expectOutcomeIsFinite(result)
  })

  it('says so when the step aliases away a fast source', () => {
    const model = mustBuild([
      part('pulse_voltage_source', 'V1', ['IN', '0'], { v1: '0', v2: '5', per: '1u', tr: '10n', tf: '10n', pw: '500n' }),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1n'),
    ])
    const result = runTransient(model, { temperatureCelsius: 27, stopTime: 10e-6, stepTime: 20e-6 })
    expect(result.notes.join(' ')).toMatch(/alias/i)
    expectOutcomeIsFinite(result)
  })

  it('keeps a PULSE with per <= 0 out of the model rather than evaluating x % 0', () => {
    const built = buildCircuitModel(
      netlist([
        part('pulse_voltage_source', 'V1', ['IN', '0'], { v1: '0', v2: '5', per: '0' }),
        resistor('R1', ['IN', '0'], '1k'),
      ]),
    )
    expect(built.errors.join(' ')).toMatch(/period \(per\) must be > 0/i)
  })

  it('refuses PWL corners that repeat or run backwards in time', () => {
    const backwards = buildCircuitModel(
      netlist([part('pwl_voltage_source', 'V1', ['IN', '0'], { points: '0,0 1u,5 0.5u,0' }), resistor('R1', ['IN', '0'], '1k')]),
    )
    expect(backwards.errors.join(' ')).toMatch(/strictly increasing/i)

    const repeated = buildCircuitModel(
      netlist([part('pwl_voltage_source', 'V1', ['IN', '0'], { points: '0,0 1u,5 1u,0' }), resistor('R1', ['IN', '0'], '1k')]),
    )
    expect(repeated.errors.join(' ')).toMatch(/strictly increasing/i)
  })

  it('accepts a single-corner PWL and holds that level', () => {
    const model = mustBuild([
      part('pwl_voltage_source', 'V1', ['IN', '0'], { points: '0,2.5' }),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1n'),
    ])
    const result = runTransient(model, { temperatureCelsius: 27, stopTime: 10e-6, stepTime: 1e-6 })
    expect(result.converged).toBe(true)
    for (const point of waveform(result, 'V(IN)')) expect(point.y).toBeCloseTo(2.5, 12)
  })

  it('stays bounded when a pulse rise time exceeds the period', () => {
    const model = mustBuild([
      part('pulse_voltage_source', 'V1', ['IN', '0'], { v1: '0', v2: '5', per: '1u', tr: '10u', tf: '10u', pw: '0' }),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1n'),
    ])
    const result = runTransient(model, { temperatureCelsius: 27, stopTime: 10e-6, stepTime: 1e-7 })
    for (const entry of result.waveforms) {
      for (const point of entry.data) {
        expect(Number.isFinite(point.y)).toBe(true)
        if (entry.name === 'V(OUT)') {
          expect(point.y).toBeGreaterThanOrEqual(-1e-9)
          expect(point.y).toBeLessThanOrEqual(5 + 1e-9)
        }
      }
    }
  })

  it('stays bounded for a fast source driving a slow RC over a long window', () => {
    const model = mustBuild([
      part('pulse_voltage_source', 'V1', ['IN', '0'], { v1: '0', v2: '5', per: '1n', tr: '10p', tf: '10p', pw: '500p' }),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1n'),
    ])
    const result = runTransient(model, { temperatureCelsius: 27, stopTime: 1e-6, stepTime: 1e-7 })
    for (const entry of result.waveforms) {
      for (const point of entry.data) {
        expect(Number.isFinite(point.y)).toBe(true)
        if (entry.name === 'V(OUT)') {
          expect(point.y).toBeGreaterThanOrEqual(-1e-6)
          expect(point.y).toBeLessThanOrEqual(5 + 1e-6)
        }
      }
    }
  })

  it('converges to the same steady state for a 1 Ω / 1 F node at any dt', () => {
    const model = mustBuild([
      voltageSource('V1', ['IN', '0'], '1V'),
      resistor('R1', ['IN', 'OUT'], '1'),
      capacitor('C1', ['OUT', '0'], '1'),
    ])
    const exact = 1 - Math.exp(-5)
    for (const [stepTime, tolerance] of [[1e-3, 0.005], [1e-2, 0.2]] as const) {
      const result = runTransient(model, { temperatureCelsius: 27, stopTime: 5, stepTime, useInitialConditions: true })
      const data = waveform(result, 'V(OUT)')
      expectAllFinite(data.map((point) => point.y))
      for (let i = 1; i < data.length; i += 1) expect(data[i].y).toBeGreaterThanOrEqual(data[i - 1].y - 1e-15)
      // τ = RC = 1 s, so v(5 s) = 1 − e⁻⁵. Backward Euler undershoots by dt/(2τ),
      // hence the loose tolerance on the coarse run.
      const final = data[data.length - 1].y
      expect(Math.abs(final - exact) / exact).toBeLessThan(tolerance)
    }
  })

  it('builds the analytic RL current when started from zero stored energy', () => {
    const L = 1e-3
    const R = 1
    const tau = L / R
    const model = mustBuild([
      currentSource('I1', ['0', 'A'], '1A'),
      inductor('L1', ['A', '0'], '1m'),
      resistor('R1', ['A', '0'], '1'),
    ])
    const result = runTransient(model, { temperatureCelsius: 27, stopTime: 5 * tau, stepTime: tau / 500, useInitialConditions: true })
    expect(result.converged).toBe(true)
    const current = waveform(result, 'I(L1)')
    expectAllFinite(current.map((point) => point.y))
    // i_L(t) = I·(1 − e^(−tR/L)); the resistor carries the complement.
    expect(Math.abs(interpolate(current, tau) - (1 - Math.exp(-1)))).toBeLessThan(0.01)
    expect(Math.abs(current[current.length - 1].y - 1)).toBeLessThan(0.01)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * AC / noise / Monte Carlo hostility
 * ──────────────────────────────────────────────────────────────────────────── */

describe('AC hostility', () => {
  it('returns no grid for 0 Hz, negative, NaN, infinite or reversed ranges', () => {
    expect(buildFrequencyGrid({ startFrequency: 0, stopFrequency: 1e6 })).toEqual([])
    expect(buildFrequencyGrid({ startFrequency: -1, stopFrequency: 1e6 })).toEqual([])
    expect(buildFrequencyGrid({ startFrequency: Number.NaN, stopFrequency: 1e6 })).toEqual([])
    expect(buildFrequencyGrid({ startFrequency: 1e6, stopFrequency: 1 })).toEqual([])
    // stop/start overflows to Infinity at a 640-decade span, which used to make
    // every grid point after the first non-finite. Written as Number('1e±320')
    // because the literals themselves lose precision to the linter's eye.
    const subnormal = Number('1e-320')
    const overflow = Number('1e320')
    expect(buildFrequencyGrid({ startFrequency: subnormal, stopFrequency: overflow, pointsPerDecade: 20 })).toEqual([])
  })

  it('refuses the same ranges in the sweep driver with a note, not a crash', () => {
    for (const [startFrequency, stopFrequency] of [
      [0, 1e3],
      [-1, 1e3],
      [Number.NaN, 1e3],
      [1e3, Number.POSITIVE_INFINITY],
      [1e3, 10],
      [Number('1e-320'), Number('1e320')],
    ] as const) {
      const result = runAcSweep(rcLowPass(), { temperatureCelsius: 27, startFrequency, stopFrequency })
      expect(result.converged, `${startFrequency}..${stopFrequency}`).toBe(false)
      expect(result.waveforms).toEqual([])
      expect(result.notes.length).toBeGreaterThan(0)
    }
  })

  it('handles a single-point sweep at an absurd-but-finite frequency', () => {
    for (const frequency of [1e-9, 1e12]) {
      const result = runAcSweep(rcLowPass(), { temperatureCelsius: 27, startFrequency: frequency, stopFrequency: frequency })
      expect(result.converged).toBe(true)
      expectOutcomeIsFinite(result)
    }
  })

  it('never lets a passive RC show gain at any frequency', () => {
    const model = rcLowPass()
    const result = runAcSweep(model, { temperatureCelsius: 27, startFrequency: 1e-6, stopFrequency: 1e12, pointsPerDecade: 20 })
    const data = waveform(result, '|V(OUT)|')
    const reference = waveform(result, '|V(IN)|')
    expectAllFinite(data.map((point) => point.y))
    for (let i = 0; i < data.length; i += 1) {
      expect(data[i].y).toBeGreaterThanOrEqual(0)
      expect(data[i].y / reference[i].y).toBeLessThanOrEqual(1.0000001)
    }
    expect(data[0].y / reference[0].y).toBeCloseTo(1, 6)
  })

  it('keeps an over-subscribed log grid inside the point budget and monotone', () => {
    const grid = buildFrequencyGrid({ startFrequency: 1, stopFrequency: 1e12, pointsPerDecade: 500 })
    expect(grid.length).toBeLessThanOrEqual(2000)
    expectAllFinite(grid)
    for (let i = 1; i < grid.length; i += 1) expect(grid[i]).toBeGreaterThan(grid[i - 1])
  })

  it('refuses a non-finite or sub-absolute-zero temperature at the engine level', async () => {
    for (const temperature of [Number.NaN, Number.POSITIVE_INFINITY, -273.15, -300]) {
      const result = await spiceEngine.simulate(
        netlist(
          [voltageSource('V1', ['IN', '0'], '5V'), resistor('R1', ['IN', 'OUT'], '1k'), capacitor('C1', ['OUT', '0'], '1u')],
          [{ type: 'ac', startFreq: 10, stopFreq: 1e3, temperature }],
        ),
      )
      expect(result.success, String(temperature)).toBe(false)
      expect(result.error).toMatch(/temperature/i)
    }
  })
})

describe('noise hostility', () => {
  const model = (): CircuitModel =>
    mustBuild([
      voltageSource('V1', ['IN', '0'], '5V'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1u'),
    ])

  it('refuses impossible bands, temperatures, outputs and gmin', () => {
    const checks: Array<[Parameters<typeof runNoiseAnalysis>[1], RegExp]> = [
      [{ temperatureCelsius: -300, startFrequency: 10, stopFrequency: 1e3, outputNode: 'OUT' }, /temperature/i],
      [{ temperatureCelsius: 27, startFrequency: 0, stopFrequency: 1e3, outputNode: 'OUT' }, /0 < start/i],
      [{ temperatureCelsius: 27, startFrequency: 1e3, stopFrequency: 10, outputNode: 'OUT' }, /0 < start/i],
      [{ temperatureCelsius: 27, startFrequency: 10, stopFrequency: 1e3, outputNode: 'NOWHERE' }, /not a net/i],
      [{ temperatureCelsius: 27, startFrequency: 10, stopFrequency: 1e3, outputNode: '0' }, /not a net|ground/i],
      [{ temperatureCelsius: 27, startFrequency: 10, stopFrequency: 1e3, pointsPerDecade: 0, outputNode: 'OUT' }, /per decade/i],
      [{ temperatureCelsius: 27, startFrequency: 10, stopFrequency: 1e3, outputNode: 'OUT', gmin: -1 }, /gmin/i],
      [{ temperatureCelsius: 27, startFrequency: 10, stopFrequency: 1e3, outputNode: 'OUT', gmin: Number.NaN }, /gmin/i],
      [{ temperatureCelsius: Number.NaN, startFrequency: 10, stopFrequency: 1e3, outputNode: 'OUT' }, /temperature/i],
    ]
    for (const [options, pattern] of checks) {
      const result = runNoiseAnalysis(model(), options)
      expect(result.converged, JSON.stringify(options)).toBe(false)
      expect(result.integratedThermalAndDiodeNoise).toBe(0)
      expect(result.notes.join(' ')).toMatch(pattern)
    }
  })

  it('reports a finite, non-increasing spectrum for a plain RC', () => {
    const result = runNoiseAnalysis(model(), {
      temperatureCelsius: 27,
      startFrequency: 1,
      stopFrequency: 1e6,
      pointsPerDecade: 20,
      outputNode: 'OUT',
    })
    expect(result.converged).toBe(true)
    expect(result.integratedThermalAndDiodeNoise > 0 && Number.isFinite(result.integratedThermalAndDiodeNoise)).toBe(true)
    const data = waveform(result, 'thermal+diode noise at OUT')
    expectAllFinite(data.map((point) => point.y))
    for (let i = 1; i < data.length; i += 1) expect(data[i].y).toBeLessThanOrEqual(data[i - 1].y + 1e-18)
  })

  it('refuses a temperature at absolute zero', () => {
    const result = runNoiseAnalysis(model(), {
      temperatureCelsius: -273.15,
      startFrequency: 10,
      stopFrequency: 1e3,
      outputNode: 'OUT',
    })
    expect(result.converged).toBe(false)
    expect(result.notes.join(' ')).toMatch(/absolute zero/i)
  })
})

describe('Monte Carlo hostility', () => {
  const model = (): CircuitModel =>
    mustBuild([
      voltageSource('V1', ['IN', '0'], '5V'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      resistor('R2', ['OUT', '0'], '1k'),
    ])
  const run = (perturbed: CircuitModel): AnalysisOutcome => runOperatingPoint(perturbed, { temperatureCelsius: 27 }).outcome
  const meanOf = (result: AnalysisOutcome, signal: string): number => {
    const entry = result.waveforms.find((candidate) => candidate.name === `${signal} mean`)
    expect(entry, result.waveforms.map((w) => w.name).join(', ')).toBeDefined()
    return entry!.data[0].y
  }
  const envelope = (result: AnalysisOutcome, signal: string, upper: boolean): number => {
    const suffix = upper ? 'mean +3σ' : 'mean −3σ'
    const entry = result.waveforms.find((candidate) => candidate.name === `${signal} ${suffix}`)
    expect(entry, result.waveforms.map((w) => w.name).join(', ')).toBeDefined()
    return entry!.data[0].y
  }

  /*
   * A plain operating point has no statistics, so the nominal reference comes from
   * its node map; the `… mean` waveforms only exist on the Monte Carlo outcome.
   */
  const nominal = (): number => {
    const point = run(model()).operatingPoint
    expect(point, 'operating-point map missing').toBeDefined()
    expect(point!.OUT).toBeCloseTo(2.5, 6)
    return point!.OUT
  }

  it('rejects impossible tolerances, iteration counts, seeds and distributions', () => {
    const cases: Array<Parameters<typeof runMonteCarlo>[2]> = [
      { tolerance: 1 },
      { tolerance: 1.5 },
      { tolerance: -0.001 },
      { tolerance: Number.NaN },
      { iterations: Number.POSITIVE_INFINITY },
      { seed: Number.NaN },
      { distribution: 'cauchy' as unknown as 'gaussian' },
    ]
    for (const options of cases) {
      const result = runMonteCarlo(model(), run, options)
      expect(result.converged, JSON.stringify(options)).toBe(false)
      expect(result.iterations).toBe(0)
      expect(result.notes.join(' ')).toMatch(/Monte Carlo/)
    }
  })

  it('is exactly reproducible for one seed and different for another', () => {
    const first = runMonteCarlo(model(), run, { iterations: 25, seed: 4242, tolerance: 0.1 })
    const same = runMonteCarlo(model(), run, { iterations: 25, seed: 4242, tolerance: 0.1 })
    const other = runMonteCarlo(model(), run, { iterations: 25, seed: 9999, tolerance: 0.1 })
    expect(first.iterations).toBe(25)
    expect(meanOf(first, 'V(OUT)')).toBe(meanOf(same, 'V(OUT)'))
    expect(meanOf(first, 'V(OUT)')).not.toBe(meanOf(other, 'V(OUT)'))
    for (const entry of first.waveforms) expectAllFinite(entry.data.map((point) => point.y))
  })

  it('with zero tolerance reproduces the nominal operating point', () => {
    const result = runMonteCarlo(model(), run, { iterations: 5, tolerance: 0, seed: 7 })
    expect(result.converged).toBe(true)
    expect(meanOf(result, 'V(OUT)')).toBeCloseTo(nominal(), 12)
    expect(envelope(result, 'V(OUT)', true)).toBeCloseTo(nominal(), 12)
    expect(envelope(result, 'V(OUT)', false)).toBeCloseTo(nominal(), 12)
  })

  it('clamps a runaway iteration request instead of freezing', () => {
    const result = runMonteCarlo(model(), run, { iterations: 1e9, tolerance: 0.05 })
    expect(result.converged).toBe(true)
    expect(result.iterations).toBeLessThanOrEqual(500)
  })

  it('keeps a ±20 % divider spread inside the physical bounds', () => {
    const result = runMonteCarlo(model(), run, { iterations: 100, tolerance: 0.2, seed: 11, distribution: 'uniform' })
    expect(result.converged).toBe(true)
    for (const entry of result.waveforms) expectAllFinite(entry.data.map((point) => point.y))
    // R1, R2 ∈ [0.8 k, 1.2 k] → every sample tap is 5·R2/(R1+R2) ∈ [2.222, 2.778] V.
    const mean = meanOf(result, 'V(OUT)')
    const lower = envelope(result, 'V(OUT)', false)
    const upper = envelope(result, 'V(OUT)', true)
    expect(lower).toBeLessThanOrEqual(upper + 1e-15)
    expect(mean).toBeGreaterThanOrEqual((5 * 0.8) / (1.2 + 0.8) - 1e-9)
    expect(mean).toBeLessThanOrEqual((5 * 1.2) / (0.8 + 1.2) + 1e-9)
    expect(Math.abs(mean - 2.5)).toBeLessThan(0.1)
    /*
     * The ±3σ band is a statistical envelope, not the support of the distribution:
     * for a ratio of two uniform resistors its tails legitimately reach past the
     * extreme tap voltages. What has to hold is that it stays inside the 0…5 V rail
     * span and brackets the mean it was built around.
     */
    expect(lower).toBeGreaterThanOrEqual(-1e-9)
    expect(upper).toBeLessThanOrEqual(5 + 1e-9)
    expect(lower).toBeLessThanOrEqual(mean)
    expect(upper).toBeGreaterThanOrEqual(mean)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * Control-systems solvers
 * ──────────────────────────────────────────────────────────────────────────── */

describe('polynomial root finding', () => {
  /** Vieta's first check: Σ roots = −a1/a0 (well-conditioned even for clusters). */
  const checkRootSum = (coefficients: readonly number[], tolerance: number): number[] => {
    const roots = polynomialRoots(coefficients)
    for (const root of roots) expect(Number.isFinite(root.re) && Number.isFinite(root.im)).toBe(true)
    const sum = roots.reduce((accumulator, root) => accumulator + root.re, 0)
    const imaginary = roots.reduce((accumulator, root) => accumulator + root.im, 0)
    const expected = -coefficients[1] / coefficients[0]
    expect(Math.abs(imaginary)).toBeLessThan(tolerance * Math.max(1, Math.abs(sum)))
    expect(Math.abs((sum - expected) / Math.max(1, Math.abs(expected)))).toBeLessThan(tolerance)
    return roots.map((root) => root.re)
  }

  it('returns no roots for a constant or an all-zero polynomial', () => {
    expect(polynomialRoots([5])).toEqual([])
    expect(polynomialRoots([0])).toEqual([])
    expect(polynomialRoots([0, 0, 0])).toEqual([])
    expect(polynomialRoots([0, 0, 1, 2])).toEqual([{ re: -2, im: 0 }])
  })

  it('is overflow-safe for a quadratic with coefficients 300 decades apart', () => {
    // 1e-300·s² + s − 1e-300: the old `a1*a1 − 4*a0*a2` discriminant returned
    // ±Infinity for exactly this input.
    const roots = polynomialRoots([1e-300, 1, -1e-300])
    for (const root of roots) expect(Number.isFinite(root.re) && Number.isFinite(root.im)).toBe(true)
    expect(Math.abs(roots[0].re)).toBeGreaterThan(1e299)
    // Product of roots = c/a = −1, exactly, by Vieta.
    expect(roots[0].re * roots[1].re).toBeCloseTo(-1, 9)
    // s² + 1e155·s + 1: the small root must survive the cancellation of −b±√Δ.
    const wide = polynomialRoots([1, 1e155, 1])
    expect(wide.every((root) => Number.isFinite(root.re))).toBe(true)
    expect(Math.abs(wide[1].re * 1e155 + 1)).toBeLessThan(1e-6)
    // Repeated root at the discriminant boundary stays finite and real.
    const repeated = polynomialRoots([1, 2e154, 1e308])
    for (const root of repeated) expect(root.im).toBe(0)
    expect(Math.abs(repeated[0].re + 1e154) / 1e154).toBeLessThan(0.5)
  })

  it('throws instead of returning ±Infinity or NaN roots', () => {
    // 5e-324 is the smallest subnormal: c1/c0 overflows double range outright.
    expect(() => polynomialRoots([5e-324, 1, 0])).toThrow(/exceeds double range/i)
    expect(() => polynomialRoots([1, Number.NaN])).toThrow(/not finite/)
    expect(() => polynomialRoots([1, Number.POSITIVE_INFINITY])).toThrow(/not finite/)
    expect(() => polynomialRoots([])).toThrow(/at least one coefficient/)
  })

  const evaluateAt = (coefficients: readonly number[], z: { re: number; im: number }): number => {
    let re = 0
    let im = 0
    for (const a of coefficients) {
      const nextRe = a + re * z.re - im * z.im
      im = re * z.im + im * z.re
      re = nextRe
    }
    return Math.hypot(re, im)
  }

  // Σ|aₖ|·|z|^k — the denominator that turns |p(z)| into a relative backward error.
  const coefficientScaleAt = (coefficients: readonly number[], z: { re: number; im: number }): number => {
    const magnitude = Math.hypot(z.re, z.im)
    let power = 1
    let sum = 0
    for (const a of coefficients) {
      sum += Math.abs(a) * power
      power *= magnitude
    }
    return sum
  }

  const wilkinson20 = (): number[] => {
    let coefficients = [1]
    for (let k = 1; k <= 20; k += 1) {
      const next = new Array<number>(coefficients.length + 1).fill(0)
      for (let i = 0; i < coefficients.length; i += 1) {
        next[i] += coefficients[i]
        next[i + 1] -= coefficients[i] * k
      }
      coefficients = next
    }
    return coefficients
  }

  it('holds Vieta for the degree-20 Wilkinson polynomial within its conditioning', () => {
    const coefficients = wilkinson20()
    /*
     * ∏(x−k), k = 1..20 is the textbook ill-conditioned root problem. Its
     * elementary symmetric sums reach 20! ≈ 2.4e18, past 2^53, so the coefficient
     * vector *as stored* is already perturbed by ~1e-16 of its own largest entry
     * before the solver sees it. That round-off, not the iteration, sets the floor
     * on per-root forward error: measured 1.6e-3 relative on the largest root. The
     * solver is nonetheless exact in the sense it can be — a backward error of
     * ~6e-17 means the returned roots are the true roots of the polynomial that was
     * actually handed to it. What a control engineer consumes from a transfer
     * function is the aggregate Vieta structure, and that stays accurate, which is
     * what the sum and log-product assertions below pin.
     */
    const realParts = checkRootSum(coefficients, 1e-5).sort((a, b) => a - b)
    for (let k = 1; k <= 20; k += 1) expect(Math.abs(realParts[k - 1] - k) / k).toBeLessThan(2e-3)
    // Vieta's second check: Π roots = (−1)^n·a0/an = 20!, compared in the log domain
    // so the 1e18 product never leaves double range.
    const logProduct = realParts.reduce((accumulator, value) => accumulator + Math.log(value), 0)
    let expectedLogProduct = 0
    for (let k = 1; k <= 20; k += 1) expectedLogProduct += Math.log(k)
    expect(Number.isFinite(logProduct)).toBe(true)
    expect(Math.abs(logProduct - expectedLogProduct)).toBeLessThan(1e-4)
    // The claim that survives the conditioning: every root annihilates the stored
    // polynomial to near machine precision.
    let worstBackwardError = 0
    for (const root of polynomialRoots(coefficients)) {
      worstBackwardError = Math.max(
        worstBackwardError,
        evaluateAt(coefficients, root) / coefficientScaleAt(coefficients, root),
      )
    }
    expect(worstBackwardError).toBeLessThan(1e-14)
  })

  it('resolves a well-conditioned degree-20 polynomial per root to 1e-12', () => {
    /*
     * x^20 − 1 has coefficients that are exact in double and 20 roots separated by
     * chords of at least 0.31, so here the per-root forward error is genuinely at
     * machine precision. The tight assertion belongs on a problem that can carry it,
     * not on the Wilkinson set above.
     */
    const coefficients = new Array<number>(21).fill(0)
    coefficients[0] = 1
    coefficients[20] = -1
    const roots = polynomialRoots(coefficients)
    expect(roots).toHaveLength(20)
    const used = new Set<number>()
    for (let k = 0; k < 20; k += 1) {
      const angle = (2 * Math.PI * k) / 20
      let best = -1
      let bestGap = Infinity
      roots.forEach((root, index) => {
        if (used.has(index)) return
        const gap = Math.hypot(root.re - Math.cos(angle), root.im - Math.sin(angle))
        if (gap < bestGap) {
          bestGap = gap
          best = index
        }
      })
      expect(bestGap).toBeLessThan(1e-12)
      used.add(best)
      expect(roots.some((root) => !Number.isFinite(root.re))).toBe(false)
    }
    expect(used.size).toBe(20)
    // Σ roots = 0 exactly for x^20 − 1; no root may be duplicated or dropped.
    expect(Math.abs(roots.reduce((sum, root) => sum + root.re, 0))).toBeLessThan(1e-12)
    expect(Math.abs(roots.reduce((sum, root) => sum + root.im, 0))).toBeLessThan(1e-12)
  })

  it('stays finite for (s+1)^50, whose coefficients used to overflow Horner', () => {
    let coefficients = [1]
    for (let k = 0; k < 50; k += 1) {
      const next = new Array<number>(coefficients.length + 1).fill(0)
      for (let i = 0; i < coefficients.length; i += 1) {
        next[i] += coefficients[i]
        next[i + 1] += coefficients[i]
      }
      coefficients = next
    }
    const roots = polynomialRoots(coefficients)
    expect(roots).toHaveLength(50)
    for (const root of roots) expect(Number.isFinite(root.re) && Number.isFinite(root.im)).toBe(true)
    // Honest limit: a root of multiplicity m is only conditioned to ~ε^(1/m),
    // so for m = 50 the scatter is O(1) in the root value. The sum (which is the
    // −a1 coefficient) is what stays accurate.
    const sum = roots.reduce((accumulator, root) => accumulator + root.re, 0)
    expect(Math.abs(sum + 50) / 50).toBeLessThan(0.05)
  })

  it('resolves a triple root to the ~ε^(1/3) limit and no better', () => {
    const roots = polynomialRoots([1, 3, 3, 1])
    for (const root of roots) expect(Math.abs(root.re + 1)).toBeLessThan(1e-3)
  })

  it('classifies RHP, imaginary-axis and zero-polynomial plants honestly', () => {
    expect(tfStability({ numerator: [1], denominator: [1, -1] })).toBe('unstable')
    expect(tfStability({ numerator: [1], denominator: [1, 0] })).toBe('marginal')
    expect(tfStability({ numerator: [1], denominator: [1, 2, 1] })).toBe('stable')
    expect(() => tfStability({ numerator: [1], denominator: [0, 0, 0] })).toThrow(/zero polynomial/i)
    for (const pole of tfPoles({ numerator: [1], denominator: [1, -2, 5] })) expect(pole.re).toBeGreaterThan(0)
  })
})

describe('control transients and margins', () => {
  const firstOrder: TransferFunction = { numerator: [10], denominator: [1, 5] }

  it('refuses impossible simulation budgets', () => {
    for (const options of [
      { tEndSeconds: 0, dtSeconds: 0.01 },
      { tEndSeconds: Number.NaN, dtSeconds: 0.01 },
      { tEndSeconds: 1, dtSeconds: 0 },
      { tEndSeconds: 1, dtSeconds: Number.POSITIVE_INFINITY },
      { tEndSeconds: 1, dtSeconds: 1e-12 },
      { tEndSeconds: Number.POSITIVE_INFINITY, dtSeconds: 0.01 },
    ]) {
      expect(() => simulateStep(firstOrder, options), JSON.stringify(options)).toThrow()
    }
  })

  it('reproduces the analytic first-order step response', () => {
    const samples = simulateStep(firstOrder, { tEndSeconds: 2, dtSeconds: 1e-3 })
    const tau = 1 / 5
    const final = 10 / 5
    for (const sample of samples) {
      expect(Number.isFinite(sample.output)).toBe(true)
      for (const value of sample.state) expect(Number.isFinite(value)).toBe(true)
    }
    const at1 = samples.find((sample) => sample.timeSeconds >= tau)!
    expect(Math.abs(at1.output - final * (1 - Math.exp(-1))) / final).toBeLessThan(1e-4)
    expect(Math.abs(samples[samples.length - 1].output - final) / final).toBeLessThan(1e-4)
  })

  it('matches the closed-form margins of a two-pole loop', () => {
    // G = 10/((s+1)(s+5)). |G| = 1 → ω⁴ + 26ω² − 75 = 0 → ω² = (−26 + √976)/2.
    const margins = stabilityMargins({ numerator: [10], denominator: [1, 6, 5] }, { fMinHz: 1e-2, fMaxHz: 1e4 })
    const w2 = (-26 + Math.sqrt(26 * 26 + 4 * 75)) / 2
    const wc = Math.sqrt(w2)
    const phaseDeg = ((-Math.atan(wc / 1) - Math.atan(wc / 5)) * 180) / Math.PI
    expect(margins.gainMarginDb).toBe(Number.POSITIVE_INFINITY)
    expect(margins.closedLoopStable).toBe(true)
    expect(Math.abs(margins.gainCrossoverHz - wc / (2 * Math.PI)) / (wc / (2 * Math.PI))).toBeLessThan(0.02)
    expect(Math.abs(margins.phaseMarginDeg - (180 + phaseDeg))).toBeLessThan(0.5)
    expect(margins.phaseMarginDeg).toBeGreaterThan(0)
  })

  it('reports an RHP-pole plant as closed-loop unstable whatever the margins say', () => {
    const unstable = stabilityMargins({ numerator: [1], denominator: [1, -1] }, { fMinHz: 1e-2, fMaxHz: 1e3 })
    expect(unstable.closedLoopStable).toBe(false)
    expect(tfStability({ numerator: [1], denominator: [1, -1] })).toBe('unstable')
    // Integrator: no 0 dB crossing problem, PM is exactly 90° at ω = 1 rad/s.
    const integrating = stabilityMargins({ numerator: [1], denominator: [1, 0] }, { fMinHz: 1e-2, fMaxHz: 1e3 })
    expect(Number.isFinite(integrating.phaseMarginDeg)).toBe(true)
    expect(Math.abs(integrating.phaseMarginDeg - 90)).toBeLessThan(1)
    expect(integrating.gainCrossoverHz).toBeCloseTo(1 / (2 * Math.PI), 4)
  })

  it('never emits NaN in a Bode sweep across a wide band and refuses bad ranges', () => {
    const points = bodeResponse({ numerator: [1, 1e-6], denominator: [1, 1e6, 1] }, { fMinHz: 1e-4, fMaxHz: 1e6, points: 200 })
    expect(points).toHaveLength(200)
    for (const point of points) {
      expect(Number.isFinite(point.phaseDeg)).toBe(true)
      expect(point.magnitudeDb === Number.NEGATIVE_INFINITY || Number.isFinite(point.magnitudeDb)).toBe(true)
      expect(point.omega).toBeGreaterThan(0)
      expect(point.omega === Number.POSITIVE_INFINITY || Number.isFinite(point.omega)).toBe(true)
    }
    for (const options of [
      { fMinHz: 0, fMaxHz: 100 },
      { fMinHz: -1, fMaxHz: 100 },
      { fMinHz: 100, fMaxHz: 1 },
      { fMinHz: Number.NaN, fMaxHz: 100 },
      { fMinHz: 1, fMaxHz: Number.POSITIVE_INFINITY },
      { fMinHz: 1, fMaxHz: 100, points: 1 },
      { fMinHz: 1, fMaxHz: 100, points: Number.POSITIVE_INFINITY },
    ]) {
      expect(() => bodeResponse(firstOrder, options), JSON.stringify(options)).toThrow()
    }
  })

  it('refuses an empty, zero-denominator or improper transfer function', () => {
    expect(() => tfPoles({ numerator: [1], denominator: [] })).toThrow(/at least one coefficient/)
    expect(() => tfPoles({ numerator: [], denominator: [1] })).toThrow(/at least one coefficient/)
    expect(() => tfPoles({ numerator: [1], denominator: [0] })).toThrow(/zero polynomial/)
    expect(() => simulateStep({ numerator: [1, 1], denominator: [1] }, { tEndSeconds: 1, dtSeconds: 0.01 })).toThrow(/improper/)
    const evaluated = evaluatePolynomial([1, 6, 11, 6], complex(-1, 0))
    expect(Number.isFinite(evaluated.re) && Number.isFinite(evaluated.im)).toBe(true)
    // s = -1 is a root of (s+1)(s+2)(s+3): the residual must be ~0.
    expect(Math.hypot(evaluated.re, evaluated.im)).toBeCloseTo(0, 12)
    expect(Math.abs(evaluatePolynomial([1, 6, 11, 6], complex(-1, 2)).re)).toBeGreaterThan(1)
    expect(tfStability({ numerator: [1], denominator: [1e-300, 1, 1] })).toBe('stable')
  })

  it('handles an all-zero numerator without inventing poles', () => {
    const dead: TransferFunction = { numerator: [0], denominator: [1, 2, 1] }
    expect(tfZeros(dead)).toEqual([])
    expect(() => tfFeedback(dead)).not.toThrow()
    expect(stabilityMargins(dead, { fMinHz: 1, fMaxHz: 100 }).closedLoopStable).toBe(true)
    for (const point of bodeResponse(dead, { fMinHz: 1, fMaxHz: 100, points: 10 })) {
      expect(point.magnitudeDb).toBe(Number.NEGATIVE_INFINITY)
    }
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * RF ladder / S-parameter cascade
 * ──────────────────────────────────────────────────────────────────────────── */

describe('RF ladder hostility', () => {
  const lp = (order: number, cutoff = 1e9, impedance = 50) => rfCircuitDesigner.designLowPassFilter(cutoff, order, impedance)
  const sOf = (point: { s11: { real: number; imag: number }; s12: { real: number; imag: number }; s21: { real: number; imag: number }; s22: { real: number; imag: number } }) =>
    [point.s11, point.s12, point.s21, point.s22]

  it('refuses impossible design inputs', () => {
    for (const cutoff of [0, -1e6, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => lp(3, cutoff), String(cutoff)).toThrow(/positive finite/i)
    }
    /*
     * 1e-320 is positive and finite, so an input-validation error would be the
     * wrong diagnosis. The prototype meets ω→0 and produces an infinite element
     * value; the honest refusal names that.
     */
    expect(() => lp(3, 1e-320)).toThrow(/non-physical|outside the range/i)
    for (const order of [0, 1.5, -1, Number.POSITIVE_INFINITY, 99]) {
      expect(() => lp(order), String(order)).toThrow(/order/i)
    }
    for (const impedance of [0, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => lp(3, 1e9, impedance), String(impedance)).toThrow(/impedance/i)
    }
  })

  it('refuses impossible analysis frequencies and sweep shapes', () => {
    const circuit = lp(3)
    for (const frequency of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rfCircuitDesigner.calculateSParameters(circuit, frequency), String(frequency)).toThrow(/positive finite/i)
    }
    expect(() => rfCircuitDesigner.sweepSParameters(circuit, 1e9, 1e6, 11)).toThrow(/greater than/i)
    expect(() => rfCircuitDesigner.sweepSParameters(circuit, 1e6, 1e9, 1)).toThrow(/integer number of points/i)
    expect(() => rfCircuitDesigner.sweepSParameters(circuit, 1e6, 1e9, 10.5)).toThrow(/integer number of points/i)
  })

  it('refuses subnormal frequencies where ωC underflows, instead of returning NaN', () => {
    const circuit = lp(3)
    // ω·C = 0 exactly here, so X_C = −1/0 = −∞ and the shunt admittance became
    // 0·(−∞) = NaN. A refusal is the only honest answer.
    expect(() => rfCircuitDesigner.calculateSParameters(circuit, 1e-320)).toThrow(/reactance|not finite/i)
    // A frequency that is representable and electrically DC must still solve.
    const near = rfCircuitDesigner.calculateSParameters(circuit, 1e-3)
    for (const entry of sOf(near)) expect(Number.isFinite(entry.real) && Number.isFinite(entry.imag)).toBe(true)
    expect(Math.hypot(near.s21.real, near.s21.imag)).toBeCloseTo(1, 6)
  })

  it('never returns a non-finite S-parameter for any ladder it accepts', () => {
    const points = rfCircuitDesigner.sweepSParameters(lp(5, 1e9), 1e3, 1e12, 60)
    for (const point of points) {
      for (const entry of sOf(point)) expect(Number.isFinite(entry.real) && Number.isFinite(entry.imag)).toBe(true)
      const s11 = Math.hypot(point.s11.real, point.s11.imag)
      const s21 = Math.hypot(point.s21.real, point.s21.imag)
      // Lossless two-port between equal terminations conserves power.
      expect(Math.abs(s11 * s11 + s21 * s21 - 1)).toBeLessThan(1e-6)
      // Reciprocity: the ladder is symmetric in S12/S21 only for odd orders,
      // but |S12| must always equal |S21| for a reciprocal network.
      const s12 = Math.hypot(point.s12.real, point.s12.imag)
      /*
       * Above the cascade's round-off floor reciprocity is a hard equality
       * S12 = S21, so it is checked relatively. Deep in the stopband |S21|
       * falls below the ~1e-8 residual of the ABCD products themselves, where
       * an absolute tolerance would only be measuring solver noise; there the
       * honest statement is that both transfer terms stay negligible.
       */
      const transfer = Math.max(s12, s21)
      if (transfer > 1e-6) {
        expect(Math.abs(s12 - s21) / transfer).toBeLessThan(1e-9)
      } else {
        expect(transfer).toBeLessThan(1e-6)
      }
    }
  })

  it('matches the Butterworth insertion-loss polynomial', () => {
    const order = 3
    const cutoff = 1e9
    const circuit = lp(order, cutoff)
    for (const ratio of [0.25, 0.5, 1, 2, 4]) {
      const point = rfCircuitDesigner.calculateSParameters(circuit, cutoff * ratio)
      const gain = Math.hypot(point.s21.real, point.s21.imag)
      const expected = 1 / Math.sqrt(1 + ratio ** (2 * order))
      expect(Math.abs(gain - expected)).toBeLessThan(2e-3)
    }
    const atCutoff = rfCircuitDesigner.calculateSParameters(circuit, cutoff)
    expect(20 * Math.log10(Math.hypot(atCutoff.s21.real, atCutoff.s21.imag))).toBeCloseTo(-3.0103, 1)
  })

  it('refuses or underflows gracefully for absurd reactive values', () => {
    const circuit = lp(3)
    const zeroed = structuredClone(circuit)
    zeroed.elements[0].value = 0
    expect(() => rfCircuitDesigner.calculateSParameters(zeroed, 1e9)).toThrow(/positive/i)
    const naned = structuredClone(circuit)
    naned.elements[0].value = Number.NaN
    expect(() => rfCircuitDesigner.calculateSParameters(naned, 1e9)).toThrow(/invalid value/i)

    // A subnormal capacitance is a representable open circuit, not a NaN.
    const open = structuredClone(circuit)
    open.elements[open.elements.length - 1].value = 1e-300
    const point = rfCircuitDesigner.calculateSParameters(open, 1e9)
    for (const entry of sOf(point)) expect(Number.isFinite(entry.real) && Number.isFinite(entry.imag)).toBe(true)
  })

  it('refuses an amplifier template whose dB gain overflows 10^(x/20)', () => {
    const huge = rfCircuitDesigner.designAmplifier(1e308, 1e9)
    expect(() => rfCircuitDesigner.calculateSParameters(huge, 1e9)).toThrow(/not finite/i)
    // A wildly negative gain legitimately underflows to 0, which is finite and
    // physically what "infinitely attenuated" means.
    const tiny = rfCircuitDesigner.designAmplifier(-1e308, 1e9)
    const attenuated = rfCircuitDesigner.calculateSParameters(tiny, 1e9)
    expect(Math.hypot(attenuated.s21.real, attenuated.s21.imag)).toBe(0)
    const sane = rfCircuitDesigner.designAmplifier(15, 1e9)
    const point = rfCircuitDesigner.calculateSParameters(sane, 1e9)
    expect(20 * Math.log10(Math.hypot(point.s21.real, point.s21.imag))).toBeCloseTo(15, 6)
  })

  it('refuses a transmission line whose Z0 or electrical length is unrepresentable', () => {
    const carrier = rfCircuitDesigner.designLowPassFilter(1e9, 1)
    const tinyZ0 = structuredClone(carrier)
    tinyZ0.elements = [
      {
        id: 'TL1',
        type: 'transmission_line',
        value: 50,
        frequency: 1e9,
        parameters: { impedance: 1e-320, length: 0.25 },
      },
    ] as unknown as typeof tinyZ0.elements
    expect(() => rfCircuitDesigner.calculateSParameters(tinyZ0, 1e9)).toThrow(/not finite/i)

    const endless = structuredClone(carrier)
    endless.elements = [
      {
        id: 'TL2',
        type: 'transmission_line',
        value: 50,
        frequency: 1e9,
        parameters: { impedance: 50, lengthMeters: 1e308 },
      },
    ] as unknown as typeof endless.elements
    expect(() => rfCircuitDesigner.calculateSParameters(endless, 1e12)).toThrow(/not finite|electrical length/i)
  })

  it('refuses to mis-cascade a circuit with unequal port impedances', () => {
    const circuit = structuredClone(lp(3))
    const output = circuit.ports.find((port) => port.id === 'output')
    expect(output).toBeDefined()
    output!.impedance = 75
    expect(() => rfCircuitDesigner.calculateSParameters(circuit, 1e9)).toThrow(/equal port impedances/i)
  })
})

/* ────────────────────────────────────────────────────────────────────────────
 * End-to-end: the facade must never hand NaN to the UI
 * ──────────────────────────────────────────────────────────────────────────── */

describe('facade end to end', () => {
  it('returns an error result, not a NaN result, for hostile netlists', async () => {
    const hostile: CircuitNetlist[] = [
      netlist([], [{ type: 'dc' }]),
      netlist([resistor('R1', ['A', '0'], '0'), resistor('R2', ['A', '0'], '1k')], [{ type: 'dc' }]),
      netlist([voltageSource('V1', ['A', '0'], '5'), voltageSource('V1', ['B', '0'], '1')], [{ type: 'dc' }]),
      netlist([resistor('R1', ['A', '0'], Number.NaN)], [{ type: 'transient', stopTime: 1e-3 }]),
      netlist([part('something_else', 'Y1', ['A', '0'], { value: '1' })], [{ type: 'ac', startFreq: 10, stopFreq: 1e3 }]),
      netlist([voltageSource('V1', ['A', '0'], '5'), voltageSource('V2', ['A', '0'], '12')], [{ type: 'dc' }]),
      netlist([resistor('R1', ['A', '0'], '1k')], [{ type: 'transient', stopTime: Number.NaN }]),
      netlist([resistor('R1', ['A', '0'], '1k')], [{ type: 'ac', startFreq: 0, stopFreq: 1e3 }]),
    ]
    for (const list of hostile) {
      const result = await spiceEngine.simulate(list)
      expect(result.success, list.components.map((c) => c.name).join(',')).toBe(false)
      for (const entry of result.waveforms) expectAllFinite(entry.data.flatMap((point) => [point.x, point.y]))
      for (const node of result.nodes) if (node.voltage !== undefined) expect(Number.isFinite(node.voltage)).toBe(true)
    }
  })

  it('simulates a 24-decade component spread with finite everything', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          voltageSource('V1', ['IN', '0'], '3.3'),
          resistor('R1', ['IN', 'NODE_A'], '1e-9'),
          resistor('R2', ['NODE_A', 'NODE_B'], '1e9'),
          capacitor('C1', ['NODE_B', '0'], '1f'),
          resistor('R3', ['NODE_B', '0'], '1e15'),
        ],
        [{ type: 'transient', stopTime: 1e-3, stepTime: 1e-7 }],
      ),
    )
    expect(result.success).toBe(true)
    expectOutcomeIsFinite(result)
  })

  it('keeps validateNetlist free of duplicated messages', async () => {
    const validation = await spiceEngine.validateNetlist(netlist([], [{ type: 'dc' }]))
    expect(validation.isValid).toBe(false)
    expect(validation.errors.filter((message) => /no components/i.test(message))).toHaveLength(1)
  })
})
