import { describe, expect, it } from 'vitest'
import { spiceEngine, type CircuitNetlist, type Component } from './spiceEngine'
import {
  bjtBias,
  mosfetBias,
  mosfetRegion,
  opAmpLimiter,
  opAmpOutputRange,
  opAmpParameters,
  opAmpStage,
  type OpAmpOutputRange,
} from './semiconductors'
import {
  thermalVoltage,
  waveformValue,
  type BjtDevice,
  type MosfetDevice,
  type SourceWaveform,
} from './devices'

/**
 * Semiconductor and source-model tests.
 *
 * Every expectation here is either a closed-form result (a transistor equation
 * evaluated by hand, a limiter's asymptote, an integrator's slope) or a
 * consistency property of the model (beta, current conservation, region of
 * operation). None of them is "whatever the solver returned last time".
 */

const thermal = thermalVoltage(27)

const source = (
  name: string,
  nodes: [string, string],
  parameters: Record<string, string | number>,
): Component => ({ type: 'voltage_source', name, nodes, parameters })

const resistor = (name: string, nodes: [string, string], value: string | number): Component => ({
  type: 'resistor',
  name,
  nodes,
  parameters: { value },
})

const dc = (name: string, nodes: [string, string], value: string | number): Component =>
  source(name, nodes, { value })

const bjt = (
  name: string,
  nodes: [string, string, string],
  parameters: Record<string, string | number>,
): Component => ({ type: 'npn_transistor', name, nodes, parameters })

const pnp = (
  name: string,
  nodes: [string, string, string],
  parameters: Record<string, string | number>,
): Component => ({ type: 'pnp_transistor', name, nodes, parameters })

const mosfet = (
  name: string,
  nodes: [string, string, string] | [string, string, string, string],
  parameters: Record<string, string | number>,
): Component => ({ type: 'n_channel_mosfet', name, nodes, parameters })

/** A source carrying an explicit waveform, as the PULSE/SINE symbols do. */
const pulse = (
  name: string,
  nodes: [string, string],
  parameters: Record<string, string | number>,
): Component => ({ type: 'pulse_voltage_source', name, nodes, parameters })

const capacitor = (name: string, nodes: [string, string], value: string | number): Component => ({
  type: 'capacitor',
  name,
  nodes,
  parameters: { value },
})

const pmos = (
  name: string,
  nodes: [string, string, string],
  parameters: Record<string, string | number>,
): Component => ({ type: 'p_channel_mosfet', name, nodes, parameters })

const netlist = (components: Component[], analyses: CircuitNetlist['analyses']): CircuitNetlist => ({
  title: 'test',
  components,
  analyses,
})

const voltageAt = (result: { operatingPoint?: Record<string, number> }, node: string): number => {
  const value = result.operatingPoint?.[node]
  if (value === undefined) throw new Error(`node ${node} is missing from the operating point`)
  return value
}

describe('Gummel–Poon BJT', () => {
  /*
   * Common-emitter stage: 5 V through 220 kΩ into the base, 1 kΩ collector load.
   * Hand solution: Vbe ≈ 0.67 V, Ib ≈ (5 − 0.67)/220k ≈ 19.7 µA, Ic = 100·Ib
   * ≈ 1.97 mA, V(OUT) = 5 − 1.97 mA · 1 kΩ ≈ 3.03 V.
   */
  const amplifier = (model: Record<string, string | number>): CircuitNetlist =>
    netlist(
      [
        dc('VCC', ['VCC', '0'], 5),
        resistor('RB', ['VCC', 'B'], '220k'),
        resistor('RC', ['VCC', 'OUT'], '1k'),
        bjt('Q1', ['OUT', 'B', '0'], { is: '1e-14', bf: 100, ...model }),
      ],
      [{ type: 'dc' }],
    )

  it('biases an NPN in the active region with beta·Ib collector current', async () => {
    const result = await spiceEngine.simulate(amplifier({}))
    expect(result.success).toBe(true)
    expect(result.convergenceInfo?.converged).toBe(true)

    const collector = voltageAt(result, 'OUT')
    const base = voltageAt(result, 'B')
    const collectorCurrent = (5 - collector) / 1000
    const baseCurrent = (5 - base) / 220_000

    expect(collector).toBeCloseTo(3.03, 1)
    expect(base).toBeCloseTo(0.67, 1)
    // Beta is a model parameter, so this ratio must hold to solver accuracy.
    expect(collectorCurrent / baseCurrent).toBeCloseTo(100, 3)
    // Vbc < 0 is what "active region" means: base above collector voltage.
    expect(base - collector).toBeLessThan(0)
  })

  it('scales the collector current with BF', async () => {
    const low = await spiceEngine.simulate(amplifier({ bf: 50 }))
    const high = await spiceEngine.simulate(amplifier({ bf: 200 }))
    expect(low.success).toBe(true)
    expect(high.success).toBe(true)
    const ratio = (5 - voltageAt(high, 'OUT')) / (5 - voltageAt(low, 'OUT'))
    expect(ratio).toBeGreaterThan(3.5)
    expect(ratio).toBeLessThan(4.5)
  })

  it('raises the collector current with the Early effect, matching 1 + Vce/VAF', async () => {
    const ideal = await spiceEngine.simulate(amplifier({}))
    const early = await spiceEngine.simulate(amplifier({ vaf: 100 }))
    const idealCurrent = (5 - voltageAt(ideal, 'OUT')) / 1000
    const earlyCurrent = (5 - voltageAt(early, 'OUT')) / 1000
    /*
     * The Early factor applies to the transfer current at fixed Vbe, not to the
     * whole stage: stripping (1 + Vce/VAF) from the Early run — denominator
     * ~1.03 here — leaves the ideal current up to the Vbe shift the extra
     * collector current causes across RB, about 2 % in this stiff biasing.
     */
    const earlyVce = voltageAt(early, 'OUT')
    expect(earlyCurrent / (1 + earlyVce / 100)).toBeCloseTo(idealCurrent, 1)
  })

  it('is off when the base-emitter junction is not forward biased', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VCC', ['VCC', '0'], 5),
          resistor('RC', ['VCC', 'OUT'], '1k'),
          bjt('Q1', ['OUT', '0', '0'], { is: '1e-14', bf: 100 }),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    // Only the gmin path is left, so the collector floats up to the rail.
    expect(voltageAt(result, 'OUT')).toBeCloseTo(5, 3)
  })

  it('enters saturation when the base current is overdriven', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VCC', ['VCC', '0'], 5),
          resistor('RB', ['VCC', 'B'], '10k'),
          resistor('RC', ['VCC', 'OUT'], '1k'),
          bjt('Q1', ['OUT', 'B', '0'], { is: '1e-14', bf: 100 }),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    const collector = voltageAt(result, 'OUT')
    const base = voltageAt(result, 'B')
    const forcedBeta = (5 - collector) / 1000 / ((5 - base) / 10_000)
    // Saturated: the collector current is limited by RC, not by beta.
    expect(collector).toBeLessThan(0.3)
    expect(forcedBeta).toBeLessThan(20)
  })

  it('mirrors the equations for a PNP', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VCC', ['VCC', '0'], 5),
          resistor('RB', ['B', '0'], '220k'),
          resistor('RC', ['OUT', '0'], '1k'),
          pnp('Q1', ['OUT', 'B', 'VCC'], { is: '1e-14', bf: 100 }),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    const baseCurrent = voltageAt(result, 'B') / 220_000
    expect(voltageAt(result, 'OUT')).toBeCloseTo(1.97, 1)
    expect(voltageAt(result, 'OUT') / 1000 / baseCurrent).toBeCloseTo(100, 1)
  })
})

describe('Gummel–Poon parameters', () => {
  /*
   * bjtBias takes the intrinsic device rather than a netlist because it is the
   * direct unit under test: the netlist tests above already prove the solver
   * delivers the right junction voltages to it, so here it is evaluated at
   * known biases. The model card below is the SPICE default set that
   * parseBjtModel also starts from, written out in full so the test does not
   * depend on the netlist layer's defaults.
   */
  const intrinsic = (model: Record<string, number>): BjtDevice => ({
    kind: 'bjt',
    name: 'Q1',
    p: 'C',
    n: 'E',
    polarity: 'npn',
    c: 'C',
    b: 'B',
    e: 'E',
    cInt: 'C',
    bInt: 'B',
    eInt: 'E',
    model: {
      is: 1e-14,
      bf: 100,
      br: 1,
      nf: 1,
      nr: 1,
      vaf: Infinity,
      var: Infinity,
      ikf: Infinity,
      ikr: Infinity,
      ise: 0,
      ne: 1.5,
      isc: 0,
      nc: 2,
      cje: 0,
      vje: 0.75,
      mje: 0.33,
      cjc: 0,
      vjc: 0.75,
      mjc: 0.33,
      fc: 0.5,
      tf: 0,
      tr: 0,
      rb: 0,
      rc: 0,
      re: 0,
      ...model,
    },
  })
  it('produces beta·Ib collector current in the active region', () => {
    const bias = bjtBias(intrinsic({}), 0.7, 0, thermal)
    expect(bias.vbe).toBe(0.7)
    // The terminal currents must balance: what enters leaves.
    expect(bias.ic + bias.ib + bias.ie).toBeCloseTo(0, 15)
    // vbc = 0 still leaves cbc = is·(1 − 1) = 0, so Ic = bf·Ib up to that term.
    expect(bias.ic / bias.ib).toBeCloseTo(100, 9)
    // And the Jacobian is the physical slope: dI/dV = I/Vt for a pure exponential.
    expect(bias.dIcDVbe).toBeCloseTo(bias.ic / thermal, 6)
    expect(bias.dIbDVbe).toBeCloseTo(bias.ib / thermal, 6)
  })

  it('enters saturation symmetrically when both junctions conduct', () => {
    const saturated = bjtBias(intrinsic({}), 0.8, 0.7, thermal)
    /*
     * forwardArg = 0.8/0.0259 ≈ 31 stays below safeExp's clip at 40, so the
     * hand value below is the exact model equation: ic = transfer − cbc/br
     * with cbc = is·(exp(0.7/Vt) − 1) and br = 1.
     */
    const expForward = Math.exp(0.8 / thermal)
    const expReverse = Math.exp(0.7 / thermal)
    const transfer = 1e-14 * (expForward - expReverse)
    expect(saturated.ic).toBeCloseTo(transfer - (1e-14 * (expReverse - 1)) / 1, 9)
    // Both diodes on means the collector can no longer keep up with the base.
    expect(saturated.ic / saturated.ib).toBeLessThan(100)
    expect(saturated.ib).toBeGreaterThan(0)
  })

  it('raises the collector current with Vce, matching 1 + Vce/VAF', () => {
    const low = bjtBias(intrinsic({ vaf: 100 }), 0.7, -2, thermal)
    const high = bjtBias(intrinsic({ vaf: 100 }), 0.7, -5, thermal)
    /*
     * Early's own statement: ic = transfer/qb at fixed Vbe, with
     * qb = 1/(1 − Vbc/VAF) — denominators 1.02 and 1.05 here — so dividing the
     * factor out must give the same forward transfer current at both points.
     */
    expect(low.ic / 1.02).toBeCloseTo(high.ic / 1.05, 6)
  })

  it('rolls beta off at high current through the IKF corner', () => {
    const corner = bjtBias(intrinsic({ ikf: 0.01 }), 0.7, 0, thermal)
    const ideal = bjtBias(intrinsic({}), 0.7, 0, thermal)
    expect(corner.ib / ideal.ib).toBeCloseTo(1, 6)
    expect(corner.ic / ideal.ic).toBeLessThan(0.99)
  })
})

describe('level-1 MOSFET', () => {
  const model = { vto: 2, kp: 1e-3 }

  /*
   * Drain current in saturation is `KP/2·(Vgs − Vt)²·(1 + λ·Vds)`, so with
   * Vgs = 4 V and Vt = 2 V the overdrive is 2 V and Id = 2 mA at λ = 0.
   */
  it('saturates at the Schichman–Hodges drain current', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VDD', ['VDD', '0'], 10),
          dc('VG', ['G', '0'], 4),
          resistor('RD', ['VDD', 'D'], '1k'),
          mosfet('M1', ['D', 'G', '0'], model),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    // Id = 2 mA, so the 1 kΩ load drops 2 V.
    expect(voltageAt(result, 'D')).toBeCloseTo(8, 2)
  })

  it('runs in the triode region when the load is heavy', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VDD', ['VDD', '0'], 10),
          dc('VG', ['G', '0'], 4),
          resistor('RD', ['VDD', 'D'], '10k'),
          mosfet('M1', ['D', 'G', '0'], model),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    /*
     * Hand solution of Id·10k = 10 − Vds with
     * Id = KP·((Vgs−Vt)·Vds − Vds²/2):
     *   5·Vds² − 21·Vds + 10 = 0  →  Vds = 0.548 V.
     */
    expect(voltageAt(result, 'D')).toBeCloseTo(0.548, 2)
  })

  it('is off below the threshold voltage', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VDD', ['VDD', '0'], 10),
          dc('VG', ['G', '0'], 1),
          resistor('RD', ['VDD', 'D'], '1k'),
          mosfet('M1', ['D', 'G', '0'], model),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    expect(voltageAt(result, 'D')).toBeCloseTo(10, 3)
  })

  it('raises the threshold when the bulk is reverse biased', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VDD', ['VDD', '0'], 10),
          dc('VG', ['G', '0'], 4),
          dc('VB', ['B', '0'], -3),
          resistor('RD', ['VDD', 'D'], '1k'),
          mosfet('M1', ['D', 'G', '0', 'B'], { ...model, gamma: 0.5 }),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    /*
     * von = 2 + 0.5·(√3.6 − √0.6) = 2.561 V, overdrive 1.439 V,
     * Id = 0.5·1e-3·1.439² = 1.035 mA → V(D) = 10 − 1.035 = 8.965 V.
     */
    expect(voltageAt(result, 'D')).toBeCloseTo(8.965, 2)
  })

  it('mirrors the equations for a P-channel part', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VDD', ['VDD', '0'], 10),
          dc('VG', ['G', '0'], 6),
          resistor('RD', ['D', '0'], '1k'),
          pmos('M1', ['D', 'G', 'VDD'], { vto: -2, kp: 1e-3 }),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    // |Vgs| − |Vt| = 2 V again, so 2 mA flows from source to drain: V(D) = 2 V.
    expect(voltageAt(result, 'D')).toBeCloseTo(2, 2)
  })

  it('classifies the region of operation from the bias point', () => {
    const device: MosfetDevice = {
      kind: 'mosfet',
      name: 'M1',
      p: 'D',
      n: 'S',
      polarity: 'n',
      d: 'D',
      g: 'G',
      s: 'S',
      b: 'S',
      model: { vto: 2, kp: 1e-3, gamma: 0, phi: 0.6, lambda: 0, is: 1e-14, n: 1, cgs: 0, cgd: 0 },
    }
    expect(mosfetRegion(mosfetBias(device, 1, 5, 0, thermal))).toBe('cutoff')
    expect(mosfetRegion(mosfetBias(device, 4, 0.5, 0, thermal))).toBe('triode')
    expect(mosfetRegion(mosfetBias(device, 4, 5, 0, thermal))).toBe('saturation')
  })
})

describe('op-amp macromodel', () => {
  const opAmp = (name: string, nodes: string[], parameters: Record<string, string | number> = {}): Component => ({
    type: 'op_amp',
    name,
    nodes,
    parameters,
  })

  it('follows its input as a unity-gain buffer', async () => {
    const result = await spiceEngine.simulate(
      netlist([dc('V1', ['IN', '0'], 1), opAmp('U1', ['IN', 'OUT', 'OUT'])], [{ type: 'dc' }]),
    )
    expect(result.success).toBe(true)
    // A 100 dB amplifier following its own output: the error is V(out)/A.
    expect(voltageAt(result, 'OUT')).toBeCloseTo(1, 3)
  })

  it('inverts with a feedback network, giving −Rf/Rin', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('V1', ['IN', '0'], 0.5),
          resistor('RIN', ['IN', 'SUM'], '1k'),
          resistor('RF', ['SUM', 'OUT'], '10k'),
          opAmp('U1', ['0', 'SUM', 'OUT']),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    expect(voltageAt(result, 'OUT')).toBeCloseTo(-5, 2)
    // The summing node is a virtual earth.
    expect(Math.abs(voltageAt(result, 'SUM'))).toBeLessThan(0.01)
  })

  it('clamps the output at the supply rails', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('V1', ['IN', '0'], 2),
          resistor('RIN', ['IN', 'SUM'], '1k'),
          resistor('RF', ['SUM', 'OUT'], '10k'),
          opAmp('U1', ['0', 'SUM', 'OUT']),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    // −20 V is impossible on ±15 V rails with 1.5 V headroom: the output clamps.
    expect(voltageAt(result, 'OUT')).toBeGreaterThan(-14)
    expect(voltageAt(result, 'OUT')).toBeLessThan(-13)
  })

  it('follows a wired supply rail instead of the default', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VCC', ['V+', '0'], 5),
          dc('VEE', ['V-', '0'], -5),
          dc('V1', ['IN', '0'], 3),
          resistor('RIN', ['IN', 'SUM'], '1k'),
          resistor('RF', ['SUM', 'OUT'], '10k'),
          opAmp('U1', ['0', 'SUM', 'OUT', 'V+', 'V-']),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    // Ideal −30 V would need ±15 V rails; with ±5 V it stops near −3.5 V.
    expect(voltageAt(result, 'OUT')).toBeGreaterThan(-4)
    expect(voltageAt(result, 'OUT')).toBeLessThan(-3)
  })

  it('limits the slew rate to the part specification', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          pulse('V1', ['IN', '0'], { v1: 0, v2: 10, td: 0, tr: 1e-9, tf: 1e-9, pw: 1e-3, per: 2e-2 }),
          opAmp('U1', ['IN', 'OUT', 'OUT'], { slew: 1e6 }),
        ],
        [{ type: 'transient', stopTime: 5e-6, stepTime: 1e-8 }],
      ),
    )
    expect(result.success).toBe(true)
    const output = result.waveforms.find((waveform) => waveform.name === 'V(OUT)')
    expect(output).toBeDefined()
    // The step lands on exact multiples of dt, so a nearest sample is enough.
    const at = (time: number): number => {
      const point = output?.data.reduce((closest, sample) =>
        Math.abs(sample.x - time) < Math.abs(closest.x - time) ? sample : closest,
      )
      if (!point) throw new Error('the transient produced no samples')
      return point.y
    }
    /*
     * A step of 10 V is far beyond the linear input range, so the tail current
     * is saturated and the internal node ramps at I/C = the slew rate: 1 V/µs.
     * One microsecond in the output must therefore be about 1 V, not 10 V.
     */
    expect(Math.abs(at(1e-6) - 1)).toBeLessThan(0.1)
    expect(Math.abs(at(5e-6) - 5)).toBeLessThan(0.2)
  })
})

describe('op-amp stage math', () => {
  it('saturates smoothly and sets the slew rate from the stage current', () => {
    const range: OpAmpOutputRange = { low: -13.5, high: 13.5 }
    expect(opAmpLimiter(0, range).value).toBeCloseTo(0, 9)
    expect(opAmpLimiter(0, range).slope).toBeCloseTo(1, 9)
    // Half the rail distance is still mid-band: the follower is unity gain there.
    expect(opAmpLimiter(13.5 / 2, { low: -13.5, high: 13.5 }).slope).toBeCloseTo(1, 1)
    // The limiter is a hard ceiling with a smooth approach, never an overshoot.
    expect(opAmpLimiter(50, range).value).toBeLessThanOrEqual(13.5)
    expect(opAmpLimiter(-50, range).value).toBeGreaterThanOrEqual(-13.5)
    expect(Math.abs(opAmpLimiter(50, range).slope)).toBeLessThan(1e-6)

    const device = {
      kind: 'op-amp',
      name: 'U1',
      p: 'OUT',
      n: '0',
      inP: 'INP',
      inN: 'INN',
      out: 'OUT',
      vPlusFixed: 15,
      vMinusFixed: -15,
      internal: 'INT_U1_OUT',
      gain: 1e5,
      gbw: 1e6,
      slew: 5e5,
      rin: 2e6,
      rout: 50,
      dropout: 1.5,
    } as const
    const parameters = opAmpParameters(device)
    // The stage current and the internal capacitance are chosen together: the
    // ratio of the two *is* the slew rate of the part.
    expect(parameters.stageCurrent / parameters.internalCapacitance).toBeCloseTo(5e5, 6)
    // A large differential input saturates the stage at exactly that current.
    expect(opAmpStage(1e6, parameters).current).toBeCloseTo(parameters.stageCurrent, 9)
    // It never exceeds it, and the transconductance it presents collapses.
    expect(Math.abs(opAmpStage(-1e6, parameters).current)).toBeCloseTo(parameters.stageCurrent, 9)
    expect(opAmpStage(1e6, parameters).gm).toBeLessThan(opAmpStage(0, parameters).gm)
    // Rails come from the wired supplies where they exist, headroom included.
    expect(
      opAmpOutputRange({ ...device, vPlusNode: 'V+', vMinusNode: 'V-' }, new Map([['V+', 12], ['V-', -12]])),
    ).toEqual({ low: -10.5, high: 10.5 })
  })
})

describe('controlled sources', () => {
  const vcvs = (
    name: string,
    nodes: [string, string, string, string],
    gain: string | number,
  ): Component => ({ type: 'voltagecontrolledvoltagesource', name, nodes, parameters: { gain } })

  const vccs = (
    name: string,
    nodes: [string, string, string, string],
    gain: string | number,
  ): Component => ({ type: 'voltagecontrolledcurrentsource', name, nodes, parameters: { gain } })

  it('scales a VCVS output by its gain', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [dc('V1', ['C', '0'], 1), resistor('RL', ['OUT', '0'], '1k'), vcvs('E1', ['OUT', '0', 'C', '0'], 3)],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    expect(voltageAt(result, 'OUT')).toBeCloseTo(3, 6)
  })

  it('drives a transconductance into the load', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [dc('V1', ['C', '0'], 1), resistor('RL', ['OUT', '0'], '1k'), vccs('G1', ['0', 'OUT', 'C', '0'], 0.002)],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    // The VCCS pushes 2 mA from ground through itself into the 1 kΩ load: 2 V.
    expect(voltageAt(result, 'OUT')).toBeCloseTo(2, 6)
  })

  it('reverses the current when the control terminals are swapped', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [dc('V1', ['C', '0'], 1), resistor('RL', ['OUT', '0'], '1k'), vccs('G1', ['0', 'OUT', '0', 'C'], 0.002)],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    expect(voltageAt(result, 'OUT')).toBeCloseTo(-2, 6)
  })
})

describe('source waveforms', () => {
  it('evaluates PULSE phases like SPICE', () => {
    const pulse: SourceWaveform = {
      kind: 'pulse',
      v1: 0,
      v2: 5,
      td: 1e-6,
      tr: 1e-6,
      tf: 1e-6,
      pw: 2e-6,
      per: 10e-6,
    }
    expect(waveformValue(pulse, 0)).toBe(0)
    expect(waveformValue(pulse, 1e-6)).toBe(0)
    // The rise runs from td to td + tr: halfway up is halfway between v1 and v2.
    expect(waveformValue(pulse, 1.5e-6)).toBeCloseTo(2.5, 9)
    expect(waveformValue(pulse, 2e-6)).toBeCloseTo(5, 9)
    // The high time is measured from the end of the rise: still 5 V at 3 µs.
    expect(waveformValue(pulse, 3e-6)).toBeCloseTo(5, 9)
    // The fall runs from td + tr + pw to td + tr + pw + tf: 4.5 µs is mid-fall.
    expect(waveformValue(pulse, 4.5e-6)).toBeCloseTo(2.5, 9)
    // And after the fall the source is back at v1 until the next period.
    expect(waveformValue(pulse, 5e-6)).toBeCloseTo(0, 9)
    expect(waveformValue(pulse, 11e-6)).toBeCloseTo(0, 9)
  })

  it('evaluates SINE with offset, phase and damping', () => {
    // SPICE's phase is in degrees at t = td.
    expect(
      waveformValue({ kind: 'sine', vo: 1, va: 2, freq: 1000, theta: 0, phase: 0, td: 0 }, 0.00025),
    ).toBeCloseTo(3, 6)
    expect(
      waveformValue({ kind: 'sine', vo: 1, va: 2, freq: 1000, theta: 0, phase: 90, td: 0 }, 0),
    ).toBeCloseTo(3, 9)
    // A damping factor theta multiplies the amplitude by exp(−theta·t).
    const expected = 1 + 2 * Math.exp(-1000 * 0.00025)
    expect(
      waveformValue({ kind: 'sine', vo: 1, va: 2, freq: 1000, theta: 1000, phase: 0, td: 0 }, 0.00025),
    ).toBeCloseTo(expected, 9)
    // Before the delay a sine holds its offset, the same level t = 0 starts at.
    expect(
      waveformValue({ kind: 'sine', vo: 1, va: 2, freq: 1000, theta: 0, phase: 45, td: 1e-3 }, 0.5e-3),
    ).toBe(1)
  })

  it('charges an RC network from a PULSE source like the 1 − e^(−t/τ) curve', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          source('V1', ['IN', '0'], {
            type: 'pulse',
            v1: 0,
            v2: 1,
            td: 0,
            tr: 1e-12,
            tf: 1e-12,
            pw: 1,
            per: 2,
          }),
          resistor('R1', ['IN', 'OUT'], '1k'),
          capacitor('C1', ['OUT', '0'], '1u'),
        ],
        [{ type: 'transient', stopTime: 2e-3, stepTime: 10e-6 }],
      ),
    )
    expect(result.success).toBe(true)
    const output = result.waveforms.find((waveform) => waveform.name === 'V(OUT)')
    expect(output).toBeDefined()
    const at = (time: number): number => {
      const point = output?.data.reduce((closest, sample) =>
        Math.abs(sample.x - time) < Math.abs(closest.x - time) ? sample : closest,
      )
      if (!point) throw new Error('the transient produced no samples')
      return point.y
    }
    /*
     * R = 1 kΩ and C = 1 µF is a 1 ms time constant driven by a unit step, so
     * the analytic answer at one and two time constants is 1 − 1/e and
     * 1 − 1/e². Backward Euler at dt = τ/100 is within half a percent of it.
     */
    expect(Math.abs(at(1e-3) - (1 - 1 / Math.E))).toBeLessThan(0.01)
    expect(Math.abs(at(2e-3) - (1 - 1 / (Math.E * Math.E)))).toBeLessThan(0.01)
  })
})
