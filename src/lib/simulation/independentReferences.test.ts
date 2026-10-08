import { describe, expect, it } from 'vitest'
import { spiceEngine, type CircuitNetlist, type Component } from './spiceEngine'
import {
  referenceBjtCollectorCurrent,
  referenceCommonEmitter,
  referenceJfetDrainCurrent,
  referenceMosfetDrainCurrent,
  referenceOpAmpOutput,
  referenceRcStep,
  referenceSineDivider,
} from './independentReferences'

/**
 * Giant 1, slice 1 — the solver against independent references.
 *
 * `semiconductors.test.ts` proves each device model is self-consistent and
 * `goldenVectors.test.ts` proves the solver is deterministic. Neither proves
 * the solver agrees with the physics. This file closes that gap: every
 * expectation compares a full `spiceEngine.simulate` run against a closed-form
 * answer computed by `independentReferences.ts`, which shares no code with
 * the solver (no Newton iteration, no stamps, no matrices).
 *
 * Where the two models deliberately differ (textbook Ebers–Moll here versus
 * Gummel–Poon base charge in the solver), the tolerance budget admits it and
 * the test asserts on the quantities that must agree anyway.
 */

const source = (
  name: string,
  nodes: [string, string],
  parameters: Record<string, string | number>,
): Component => ({ type: 'voltage_source', name, nodes, parameters })

const dc = (name: string, nodes: [string, string], value: string | number): Component =>
  source(name, nodes, { value })

const resistor = (name: string, nodes: [string, string], value: string | number): Component => ({
  type: 'resistor',
  name,
  nodes,
  parameters: { value },
})

const bjt = (
  name: string,
  nodes: [string, string, string],
  parameters: Record<string, string | number>,
): Component => ({ type: 'npn_transistor', name, nodes, parameters })

const mosfet = (
  name: string,
  nodes: [string, string, string],
  parameters: Record<string, string | number>,
): Component => ({ type: 'n_channel_mosfet', name, nodes, parameters })

const netlist = (components: Component[], analyses: CircuitNetlist['analyses']): CircuitNetlist => ({
  title: 'independent-reference',
  components,
  analyses,
})

const voltageAt = (result: { operatingPoint?: Record<string, number> }, node: string): number => {
  const value = result.operatingPoint?.[node]
  if (value === undefined) throw new Error(`node ${node} is missing from the operating point`)
  return value
}

describe('independent references — BJT common-emitter', () => {
  /*
   * Fixed 2N3904-like card with the high-order terms switched off, so the
   * solver stamps the same textbook model the reference computes: infinite
   * Early voltages, no rolloff, no leakage, no series resistance.
   */
  const IDEAL_NPN = {
    is: '1e-14',
    bf: 100,
    br: 1,
    nf: 1,
    nr: 1,
    vaf: '1e12',
    var: '1e12',
    ikf: '1e12',
    ikr: '1e12',
    ise: 0,
    isc: 0,
    rb: 0,
    rc: 0,
    re: 0,
  }

  const stage = (rb: string, rc: string, extra: Record<string, string | number> = {}) =>
    netlist(
      [
        dc('VCC', ['VCC', '0'], 5),
        resistor('RB', ['VCC', 'B'], rb),
        resistor('RC', ['VCC', 'OUT'], rc),
        bjt('Q1', ['OUT', 'B', '0'], { ...IDEAL_NPN, ...extra }),
      ],
      [{ type: 'dc' }],
    )

  it('lands the bias point on the closed-form fixed-point answer', async () => {
    const reference = referenceCommonEmitter(5, 220_000, 1_000, 1e-14, 100)
    const result = await spiceEngine.simulate(stage('220k', '1k'))
    expect(result.success).toBe(true)

    // Textbook model on both sides here: tight band, 2 % / 2 mV.
    expect(Math.abs(voltageAt(result, 'B') - reference.base)).toBeLessThanOrEqual(
      Math.max(2e-3, Math.abs(reference.base) * 0.02),
    )
    expect(Math.abs(voltageAt(result, 'OUT') - reference.collector)).toBeLessThanOrEqual(
      Math.max(2e-3, Math.abs(reference.collector) * 0.02),
    )
  })

  it('carries beta from base to collector current at the solved bias', async () => {
    const result = await spiceEngine.simulate(stage('220k', '1k'))
    expect(result.success).toBe(true)

    const base = voltageAt(result, 'B')
    const collector = voltageAt(result, 'OUT')
    const ib = (5 - base) / 220_000
    const ic = (5 - collector) / 1_000

    // The collector current the reference equation gives AT the solved
    // junction voltages must equal the current the resistors actually pass.
    const vce = collector
    const equation = referenceBjtCollectorCurrent(base, vce, 1e-14, 1e12)
    expect(Math.abs(ic - equation) / Math.max(ic, 1e-12)).toBeLessThan(0.02)
    // And it must be beta times the base current — the definition of beta.
    expect(ic / ib).toBeCloseTo(100, 2)
  })

  it('tracks the Early slope when VAF is finite', async () => {
    const flat = await spiceEngine.simulate(stage('220k', '1k'))
    // Same stage, Early voltage finite: Vce ≈ 3 V so (1 + Vce/60) ≈ 1.05.
    const early = await spiceEngine.simulate(stage('220k', '1k', { vaf: 60 }))
    expect(flat.success).toBe(true)
    expect(early.success).toBe(true)

    const flatCurrent = (5 - voltageAt(flat, 'OUT')) / 1_000
    const earlyCurrent = (5 - voltageAt(early, 'OUT')) / 1_000
    const earlyVce = voltageAt(early, 'OUT')
    const predicted = flatCurrent * (1 + earlyVce / 60)
    // The Vbe shift across RB absorbs part of the rise; allow 5 %.
    expect(Math.abs(earlyCurrent - predicted) / predicted).toBeLessThan(0.05)
  })

  it('saturates the stock 2N3904 card on the reference load line', async () => {
    // 10 kΩ base drive into the real card: the reference load line can pass
    // at most 5 mA through RC, while β·Ib asks for far more — saturation.
    const result = await spiceEngine.simulate(stage('10k', '1k', { type: '2N3904' }))
    expect(result.success).toBe(true)
    const collector = voltageAt(result, 'OUT')
    expect(collector).toBeLessThan(0.3)
    // A saturated switch still sits above the rails: physical, not railed.
    expect(collector).toBeGreaterThan(0)
  })
})

describe('independent references — MOSFET common-source', () => {
  /*
   * Explicit level-1 card with the body effect and gate leakage switched off,
   * so the stamped model is the square law the reference computes: the only
   * intentional difference is the solver's own voltage clamping, which moves
   * nothing at these biases.
   */
  const IDEAL_NMOS = {
    vto: 2,
    kp: 1e-3,
    gamma: 0,
    phi: 0.6,
    lambda: 0,
    is: 0,
    cgs: 0,
    cgd: 0,
  }

  const stage = (rd: string, extra: Record<string, string | number> = {}) =>
    netlist(
      [
        dc('VDD', ['VDD', '0'], 10),
        dc('VG', ['G', '0'], 4),
        resistor('RD', ['VDD', 'D'], rd),
        mosfet('M1', ['D', 'G', '0'], { ...IDEAL_NMOS, ...extra }),
      ],
      [{ type: 'dc' }],
    )

  it('lands the drain on the square-law load line', async () => {
    // Overdrive 2 V: saturation current KP/2·4 = 2 mA into 1 kΩ drops 2 V.
    const predicted = 10 - referenceMosfetDrainCurrent(4, 8, 2, 1e-3, 0) * 1_000
    const result = await spiceEngine.simulate(stage('1k'))
    expect(result.success).toBe(true)
    expect(Math.abs(voltageAt(result, 'D') - predicted)).toBeLessThanOrEqual(
      Math.max(2e-3, Math.abs(predicted) * 0.02),
    )
  })

  it('solves the triode intersection the reference iterates to', async () => {
    // 10 kΩ cannot support 2 mA: the operating point is the intersection of
    // the load line with the triode curve. Fixed-point iteration has a
    // spurious attractor past the rail (the square law is not valid for the
    // negative Vds the iteration visits), so bisect g(vds) = VDD − Id·RD − vds
    // on [0, VDD]: the drain current rises monotonically in vds, so the root
    // is unique there and bisection cannot miss it.
    const residual = (candidate: number): number =>
      10 - referenceMosfetDrainCurrent(4, candidate, 2, 1e-3, 0) * 10_000 - candidate
    let low = 0
    let high = 10
    for (let pass = 0; pass < 200; pass += 1) {
      const mid = (low + high) / 2
      if (residual(mid) > 0) low = mid
      else high = mid
    }
    const vds = (low + high) / 2
    const result = await spiceEngine.simulate(stage('10k'))
    expect(result.success).toBe(true)
    expect(Math.abs(voltageAt(result, 'D') - vds)).toBeLessThanOrEqual(
      Math.max(2e-3, Math.abs(vds) * 0.02),
    )
  })

  it('cuts the device off below threshold on the reference curve', async () => {
    const off = netlist(
      [
        dc('VDD', ['VDD', '0'], 10),
        dc('VG', ['G', '0'], 1),
        resistor('RD', ['VDD', 'D'], '1k'),
        mosfet('M1', ['D', 'G', '0'], IDEAL_NMOS),
      ],
      [{ type: 'dc' }],
    )
    const result = await spiceEngine.simulate(off)
    expect(result.success).toBe(true)
    // Reference says zero current: the drain must sit at the rail.
    expect(referenceMosfetDrainCurrent(1, 10, 2, 1e-3, 0)).toBe(0)
    expect(voltageAt(result, 'D')).toBeCloseTo(10, 3)
  })
})

describe('independent references — transients against the textbook curves', () => {
  const capacitor = (name: string, nodes: [string, string], value: string | number): Component => ({
    type: 'capacitor',
    name,
    nodes,
    parameters: { value },
  })

  const pulse = (
    name: string,
    nodes: [string, string],
    parameters: Record<string, string | number>,
  ): Component => ({ type: 'pulse_voltage_source', name, nodes, parameters })

  const waveformAt = (
    result: { waveforms: Array<{ name: string; data: Array<{ x: number; y: number }> }> },
    name: string,
    time: number,
  ): number => {
    const waveform = result.waveforms.find((candidate) => candidate.name === name)
    if (!waveform) throw new Error(`the transient produced no ${name} waveform`)
    return waveform.data.reduce((closest, sample) =>
      Math.abs(sample.x - time) < Math.abs(closest.x - time) ? sample : closest,
    ).y
  }

  it('tracks the RC exponential when a PULSE charges the network', async () => {
    const expected1ms = referenceRcStep(1e-3, 5, 1e-3)
    const expected2ms = referenceRcStep(2e-3, 5, 1e-3)
    const result = await spiceEngine.simulate(
      netlist(
        [
          pulse('V1', ['IN', '0'], {
            type: 'pulse', v1: 0, v2: 5, td: 0, tr: 1e-9, tf: 1e-9, pw: 5e-3, per: 1e-2,
          }),
          resistor('R1', ['IN', 'OUT'], '10k'),
          capacitor('C1', ['OUT', '0'], '100n'),
        ],
        [{ type: 'transient', stopTime: 3e-3, stepTime: 1e-5 }],
      ),
    )
    expect(result.success).toBe(true)
    expect(Math.abs(waveformAt(result, 'V(OUT)', 1e-3) - expected1ms)).toBeLessThan(0.1)
    expect(Math.abs(waveformAt(result, 'V(OUT)', 2e-3) - expected2ms)).toBeLessThan(0.1)
  })

  it('switches a BJT stage with a PULSE and settles at both rails', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VCC', ['VCC', '0'], 5),
          pulse('V1', ['IN', '0'], {
            type: 'pulse', v1: 0, v2: 5, td: 1e-5, tr: 1e-8, tf: 1e-8, pw: 1e-5, per: 4e-5,
          }),
          resistor('RB', ['IN', 'B'], '10k'),
          resistor('RC', ['VCC', 'OUT'], '1k'),
          bjt('Q1', ['OUT', 'B', '0'], { is: '1e-14', bf: 100 }),
        ],
        [{ type: 'transient', stopTime: 4e-5, stepTime: 1e-7 }],
      ),
    )
    expect(result.success).toBe(true)
    expect(waveformAt(result, 'V(OUT)', 1e-6)).toBeGreaterThan(4.9)
    expect(waveformAt(result, 'V(OUT)', 2e-5)).toBeLessThan(0.3)
    expect(waveformAt(result, 'V(OUT)', 3.5e-5)).toBeGreaterThan(4.5)
  })

  it('follows a SINE through a divider with phase-exact tracking', async () => {
    // 1 kHz sine, 2 V peak, into a 1 kΩ/1 kΩ divider: the tap is the half wave.
    const result = await spiceEngine.simulate(
      netlist(
        [
          source('VG', ['IN', '0'], {
            type: 'sine', vo: 0, va: 2, freq: 1000, theta: 0, phase: 0, td: 0,
          }),
          resistor('R1', ['IN', 'MID'], '1k'),
          resistor('R2', ['MID', '0'], '1k'),
        ],
        [{ type: 'transient', stopTime: 1e-3, stepTime: 1e-5 }],
      ),
    )
    expect(result.success).toBe(true)
    // Quarter period: peak half-wave = +1 V. Three quarters: −1 V.
    expect(
      Math.abs(waveformAt(result, 'V(MID)', 250e-6) - referenceSineDivider(250e-6, 1, 1000, 0)),
    ).toBeLessThan(0.05)
    expect(
      Math.abs(waveformAt(result, 'V(MID)', 750e-6) - referenceSineDivider(750e-6, 1, 1000, 0)),
    ).toBeLessThan(0.05)
  })
})

describe('independent references — op-amp and JFET operating points', () => {
  const opAmp = (
    name: string,
    nodes: string[],
    parameters: Record<string, string | number> = {},
  ): Component => ({ type: 'op_amp', name, nodes, parameters })

  const jfet = (
    name: string,
    nodes: [string, string, string],
    parameters: Record<string, string | number>,
  ): Component => ({ type: 'n_channel_jfet', name, nodes, parameters })

  it('inverts with minus Rf over Rin and clamps where the reference says', async () => {
    const linear = await spiceEngine.simulate(
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
    expect(linear.success).toBe(true)
    expect(voltageAt(linear, 'OUT')).toBeCloseTo(referenceOpAmpOutput(0.5, -10, 15, -15, 1.5), 1)

    const railed = await spiceEngine.simulate(
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
    expect(railed.success).toBe(true)
    expect(voltageAt(railed, 'OUT')).toBeCloseTo(referenceOpAmpOutput(2, -10, 15, -15, 1.5), 0)
  })

  it('biases a self-biased JFET stage on the square-law curve', async () => {
    const result = await spiceEngine.simulate(
      netlist(
        [
          dc('VDD', ['VDD', '0'], 12),
          resistor('RG', ['G', '0'], '1MEG'),
          resistor('RS', ['S', '0'], '1k'),
          resistor('RD', ['VDD', 'D'], '2.2k'),
          jfet('J1', ['D', 'G', 'S'], { beta: '1.1e-3', vto: '-3' }),
        ],
        [{ type: 'dc' }],
      ),
    )
    expect(result.success).toBe(true)
    const sourceVoltage = voltageAt(result, 'S')
    const drainVoltage = voltageAt(result, 'D')
    const vgs = -sourceVoltage
    const referenceCurrent = referenceJfetDrainCurrent(
      vgs, drainVoltage - sourceVoltage, 10e-3, -3, 0,
    )
    const actualCurrent = sourceVoltage / 1_000
    expect(Math.abs(actualCurrent - referenceCurrent) / Math.max(actualCurrent, 1e-9)).toBeLessThan(0.1)
    expect(drainVoltage).toBeGreaterThan(1)
    expect(drainVoltage).toBeLessThan(12)
  })
})
