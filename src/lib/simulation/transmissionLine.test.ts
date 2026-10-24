import { describe, expect, it } from 'vitest'
import { spiceEngine, type CircuitNetlist, type Component } from './spiceEngine'
import { microstripEffectiveEr, tdFromGeometry, z0FromGeometry } from './transmissionLine'

/**
 * Transmission-line tests.
 *
 * Each case is checked against the closed-form behaviour of a lossless line:
 * an ideal wire at DC, a Z0-terminated delay, a doubling at an open end, and
 * the exact half-wave limits. A lumped approximation would fail the reflection
 * and half-wave cases even though it might pass a simple through test.
 */

const TD = 1e-9
const Z0 = 50

const source = (v2: number, riseTime = 1e-12): Component => ({
  type: 'pulse_voltage_source',
  name: 'V1',
  nodes: ['IN', '0'],
  parameters: { v1: 0, v2, td: 0, tr: riseTime, tf: riseTime, pw: 1e-6, per: 2e-6 },
})

const seriesResistor = (ohms: number): Component => ({
  type: 'resistor',
  name: 'RS',
  nodes: ['IN', 'P1'],
  parameters: { value: ohms },
})

const line = (overrides: Record<string, string | number> = {}): Component => ({
  type: 'transmission_line',
  name: 'T1',
  nodes: ['P1', '0', 'P2', '0'],
  parameters: { z0: Z0, td: TD, ...overrides },
})

const load = (ohms: number, node = 'P2'): Component => ({
  type: 'resistor',
  name: 'RL',
  nodes: [node, '0'],
  parameters: { value: ohms },
})

const dc = (components: Component[]): CircuitNetlist => ({
  title: 'transmission line',
  components,
  analyses: [{ type: 'dc' }],
})

describe('DC behaviour', () => {
  it('is an ideal through wire when both returns share ground', async () => {
    const result = await spiceEngine.simulate(
      dc([
        { type: 'voltage_source', name: 'V1', nodes: ['P1', '0'], parameters: { value: 5 } },
        line(),
        load(1000),
      ]),
    )

    expect(result.success, result.error).toBe(true)
    expect(result.operatingPoint?.P2).toBeCloseTo(5, 6)
  })

  it('derives z0 and td from microstrip geometry when both are omitted', async () => {
    const result = await spiceEngine.simulate(
      dc([
        { type: 'voltage_source', name: 'V1', nodes: ['P1', '0'], parameters: { value: 5 } },
        {
          type: 'transmission_line',
          name: 'T1',
          nodes: ['P1', '0', 'P2', '0'],
          parameters: { widthMm: 3, heightMm: 1.6, er: 4.3, lengthMm: 50 },
        },
        load(1000),
      ]),
    )

    expect(result.success, result.error).toBe(true)
    expect(result.operatingPoint?.P2).toBeCloseTo(5, 6)
  })

  it('rejects a line that shorts both positive terminals together', async () => {
    const result = await spiceEngine.simulate(
      dc([
        {
          type: 'transmission_line',
          name: 'T1',
          nodes: ['IN', '0', 'IN', '0'],
          parameters: { z0: 50, td: '1ns' },
        },
      ]),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('both positive terminals')
  })

  it('reports a missing delay instead of guessing one', async () => {
    const result = await spiceEngine.simulate(
      dc([
        {
          type: 'transmission_line',
          name: 'T1',
          nodes: ['P1', '0', 'P2', '0'],
          parameters: { z0: 50 },
        },
      ]),
    )

    expect(result.success).toBe(false)
    expect(result.error).toContain('propagation delay')
  })
})

describe('transient behaviour', () => {
  /*
   * Source impedance and load both equal Z0. The launched wave is
   * Vs/2; a matched load absorbs it, so the far end settles at Vs/2 after the
   * one-way delay and never rings. The solver reduces its step to td/4, which
   * is why the arrival is observed one sample after the exact td.
   */
  it('delays a matched wave by td and settles at half the source amplitude', async () => {
    const result = await spiceEngine.simulate({
      title: 'matched line',
      components: [source(1), seriesResistor(Z0), line(), load(Z0)],
      analyses: [{ type: 'transient', stopTime: 6e-9, stepTime: 1e-9 }],
    })

    expect(result.success).toBe(true)
    const out = result.waveforms.find((waveform) => waveform.name === 'V(P2)')
    expect(out).toBeDefined()
    expect(out?.data[0].y).toBeCloseTo(0, 9)
    expect(out?.data[out.data.length - 1].y).toBeCloseTo(0.5, 3)

    const firstArrival = out?.data.find((point) => point.y > 0.25)?.x ?? Infinity
    expect(firstArrival).toBeGreaterThan(TD)
    expect(firstArrival).toBeLessThanOrEqual(TD + 2 * (TD / 4) + 1e-18)
    expect(result.notes?.some((note) => note.includes('line delay'))).toBe(true)
  })

  it('doubles the wave at an open end', async () => {
    // No load: the far port is terminated only by its own open circuit, so the
    // reflected wave adds to the incident one and the end reads 2·Vs/2 = Vs.
    const result = await spiceEngine.simulate({
      title: 'open line',
      components: [source(1), seriesResistor(Z0), line()],
      analyses: [{ type: 'transient', stopTime: 8e-9, stepTime: 1e-9 }],
    })

    expect(result.success).toBe(true)
    const out = result.waveforms.find((waveform) => waveform.name === 'V(P2)')
    expect(out).toBeDefined()
    expect(out?.data[0].y).toBeCloseTo(0, 9)
    expect(out?.data[out.data.length - 1].y).toBeCloseTo(1, 3)
  })
})

describe('AC behaviour', () => {
  const acNetlist = (components: Component[], frequency: number): CircuitNetlist => ({
    title: 'AC line',
    components,
    analyses: [{ type: 'ac', startFreq: frequency, stopFreq: frequency, pointsPerDecade: 2 }],
  })

  it('is flat at 0.5 V into a matched load at every measured frequency', async () => {
    for (const frequency of [1e8, 2.5e8, 5e8, 1e9]) {
      const result = await spiceEngine.simulate(
        acNetlist(
          [
            { type: 'voltage_source', name: 'V1', nodes: ['IN', '0'], parameters: { value: 0, acMagnitude: 1 } },
            seriesResistor(Z0),
            line({ td: '1ns' }),
            load(Z0),
          ],
          frequency,
        ),
      )

      expect(result.error).toBeUndefined()
      expect(result.success).toBe(true)
      const out = result.waveforms.find((waveform) => waveform.name === '|V(P2)|')
      expect(out?.data[0].y).toBeCloseTo(0.5, 6)
      const input = result.waveforms.find((waveform) => waveform.name === '|V(P1)|')
      expect(input?.data[0].y).toBeCloseTo(0.5, 6)
    }
  })

  it('inverts the voltage at a half-wave and leaves the input open', async () => {
    // At θ = π an open-ended half-wave line reflects with inversion: the input
    // draws no current (v1 = Vs) and the far end sits at −Vs.
    const result = await spiceEngine.simulate(
      acNetlist(
        [
          { type: 'voltage_source', name: 'V1', nodes: ['IN', '0'], parameters: { value: 0, acMagnitude: 1 } },
          seriesResistor(Z0),
          line({ td: '1ns' }),
        ],
        5e8,
      ),
    )

    expect(result.success).toBe(true)
    expect(result.waveforms.find((waveform) => waveform.name === '|V(P1)|')?.data[0].y).toBeCloseTo(1, 6)
    expect(result.waveforms.find((waveform) => waveform.name === '|V(P2)|')?.data[0].y).toBeCloseTo(1, 6)
  })

  it('turns an open quarter-wave stub into a voltage maximum and a short at the input', async () => {
    // Zin = Z0²/∞ = 0 at θ = π/2: v1 = 0 and the open end carries the full
    // standing-wave maximum of 1 V (the source drives 1/50 A through RS).
    const result = await spiceEngine.simulate(
      acNetlist(
        [
          { type: 'voltage_source', name: 'V1', nodes: ['IN', '0'], parameters: { value: 0, acMagnitude: 1 } },
          seriesResistor(Z0),
          line({ td: '1ns' }),
        ],
        2.5e8,
      ),
    )

    expect(result.success).toBe(true)
    expect(result.waveforms.find((waveform) => waveform.name === '|V(P1)|')?.data[0].y).toBeLessThan(1e-6)
    expect(result.waveforms.find((waveform) => waveform.name === '|V(P2)|')?.data[0].y).toBeCloseTo(1, 6)
  })
})

describe('model and export', () => {
  it('exports a SPICE T card with the resolved impedance and delay', () => {
    const deck = spiceEngine.generateSPICENetlist(dc([line({ z0: 50, td: '1ns' })]))
    expect(deck).toContain('T1 P1 0 P2 0 Z0=50 TD=1ns')
  })

  it('computes microstrip impedance and delay in the range a 50 Ω design expects', () => {
    const effective = microstripEffectiveEr(3, 1.6, 4.3)
    expect(effective).toBeGreaterThan(1)
    expect(effective).toBeLessThan(4.3)
    expect(z0FromGeometry(3, 1.6, 4.3)).toBeGreaterThan(45)
    expect(z0FromGeometry(3, 1.6, 4.3)).toBeLessThan(60)
    expect(tdFromGeometry(50, effective)).toBeCloseTo(3.01e-10, 12)
  })

  it('rejects unphysical geometry instead of returning NaN', () => {
    expect(() => microstripEffectiveEr(0, 1.6, 4.3)).toThrow()
    expect(() => microstripEffectiveEr(3, 0, 4.3)).toThrow()
    expect(() => microstripEffectiveEr(3, 1.6, 0.9)).toThrow()
    expect(() => tdFromGeometry(-1, 4.3)).toThrow()
  })
})
