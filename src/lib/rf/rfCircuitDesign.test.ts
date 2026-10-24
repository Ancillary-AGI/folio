import { describe, expect, it } from 'vitest'
import { RFCircuitDesigner, type ScatteringParameters } from './rfCircuitDesign'

const mag = (value: { real: number; imag: number }) => Math.hypot(value.real, value.imag)
const db = (value: { real: number; imag: number }) => 20 * Math.log10(Math.max(mag(value), 1e-15))

const F0 = 100e6

describe('RFCircuitDesigner filters', () => {
  it('synthesises a 3rd-order Butterworth low-pass with a -3 dB cutoff', () => {
    const designer = new RFCircuitDesigner()
    const filter = designer.designLowPassFilter(F0, 3)
    expect(filter.elements.map(element => element.type)).toEqual(['inductor', 'capacitor', 'inductor'])

    const passband = designer.calculateSParameters(filter, F0 / 1000)
    expect(mag(passband.s21)).toBeCloseTo(1, 6)
    expect(mag(passband.s11)).toBeLessThan(1e-6)

    const cutoff = designer.calculateSParameters(filter, F0)
    expect(db(cutoff.s21)).toBeCloseTo(-3.01, 2)
    expect(db(cutoff.s11)).toBeCloseTo(-3.01, 2)

    const stopband = designer.calculateSParameters(filter, F0 * 10)
    expect(db(stopband.s21)).toBeLessThan(-55)
  })

  it('synthesises a high-pass filter with the mirror response', () => {
    const designer = new RFCircuitDesigner()
    const filter = designer.designHighPassFilter(F0, 3)
    expect(filter.elements.map(element => element.type)).toEqual(['capacitor', 'inductor', 'capacitor'])

    expect(mag(designer.calculateSParameters(filter, F0 / 1000).s21)).toBeLessThan(1e-3)
    expect(db(designer.calculateSParameters(filter, F0).s21)).toBeCloseTo(-3.01, 2)
    expect(mag(designer.calculateSParameters(filter, F0 * 100).s21)).toBeCloseTo(1, 6)
  })

  it('synthesises a band-pass filter that passes its centre', () => {
    const designer = new RFCircuitDesigner()
    const filter = designer.designBandPassFilter(F0, 10e6, 3)
    expect(filter.elements).toHaveLength(6)

    const centre = designer.calculateSParameters(filter, F0)
    expect(mag(centre.s21)).toBeGreaterThan(0.999)
    const low = designer.calculateSParameters(filter, F0 / 3)
    expect(db(low.s21)).toBeLessThan(-20)
    const high = designer.calculateSParameters(filter, F0 * 3)
    expect(db(high.s21)).toBeLessThan(-20)
  })

  it('rejects invalid filter specifications', () => {
    const designer = new RFCircuitDesigner()
    expect(() => designer.designLowPassFilter(0, 3)).toThrow(/positive finite/)
    expect(() => designer.designLowPassFilter(F0, 0)).toThrow(/order/)
    expect(() => designer.designLowPassFilter(F0, 9)).toThrow(/order/)
    expect(() => designer.designLowPassFilter(F0, 2.5)).toThrow(/order/)
    expect(() => designer.designLowPassFilter(F0, 3, 0)).toThrow(/impedance/)
    expect(() => designer.designBandPassFilter(F0, F0, 3)).toThrow(/smaller than the center/)
    expect(() => designer.designBandPassFilter(F0, -1e6, 3)).toThrow(/Bandwidth/)
  })
})

describe('RFCircuitDesigner sweeps and metrics', () => {
  it('sweeps logarithmically with the requested point count', () => {
    const designer = new RFCircuitDesigner()
    const filter = designer.designLowPassFilter(F0, 3)
    const sweep = designer.sweepSParameters(filter, F0 / 10, F0 * 10, 11)
    expect(sweep).toHaveLength(11)
    expect(sweep[0].frequency).toBeCloseTo(F0 / 10, 3)
    expect(sweep[10].frequency).toBeCloseTo(F0 * 10, 3)
    for (let index = 1; index < sweep.length; index += 1) {
      expect(sweep[index].frequency).toBeGreaterThan(sweep[index - 1].frequency)
    }
    expect(() => designer.sweepSParameters(filter, F0 * 10, F0, 11)).toThrow(/greater/)
    expect(() => designer.sweepSParameters(filter, F0 / 10, F0, 1)).toThrow(/points/)
  })

  it('reports cutoff gain, loss-derived noise figure and design bandwidth', () => {
    const designer = new RFCircuitDesigner()
    const filter = designer.designLowPassFilter(F0, 3)
    const metrics = designer.calculatePerformanceMetrics(filter)
    expect(metrics.gain).toBeCloseTo(-3.01, 2)
    expect(metrics.noiseFigure).toBeCloseTo(3.01, 2)
    expect(metrics.inputReturnLoss).toBeCloseTo(3.01, 2)
    expect(metrics.bandwidth).toBe(F0)
    expect(metrics.centerFrequency).toBe(F0)
  })

  it('characterises the amplifier template from its stated magnitudes', () => {
    const designer = new RFCircuitDesigner()
    const amplifier = designer.designAmplifier(12, 2.4e9, 1.5, {
      isolationDb: 25,
      inputReturnLossDb: 12,
      outputReturnLossDb: 14,
      outputThirdOrderInterceptDbm: 20,
    })
    const s = designer.calculateSParameters(amplifier, 2.4e9) as ScatteringParameters
    expect(db(s.s21)).toBeCloseTo(12, 9)
    expect(db(s.s12)).toBeCloseTo(-25, 9)
    expect(db(s.s11)).toBeCloseTo(-12, 9)
    expect(db(s.s22)).toBeCloseTo(-14, 9)

    const metrics = designer.calculatePerformanceMetrics(amplifier)
    expect(metrics.gain).toBe(12)
    expect(metrics.noiseFigure).toBe(1.5)
    expect(metrics.isolation).toBe(25)
    expect(metrics.thirdOrderIntercept).toBe(20)
  })

  it('refuses to model an oscillator as a two-port', () => {
    const designer = new RFCircuitDesigner()
    const oscillator = designer.designOscillator(2.4e9, 10)
    expect(() => designer.calculateSParameters(oscillator, 2.4e9)).toThrow(/oscillator/)
    const metrics = designer.calculatePerformanceMetrics(oscillator)
    expect(Number.isNaN(metrics.gain)).toBe(true)
    expect(metrics.centerFrequency).toBe(2.4e9)
  })
})

describe('RFCircuitDesigner model guards', () => {
  it('rejects unequal port impedances instead of assuming one reference', () => {
    const designer = new RFCircuitDesigner()
    const filter = designer.designLowPassFilter(F0, 3)
    filter.ports[1].impedance = 75
    expect(() => designer.calculateSParameters(filter, F0)).toThrow(/equal port impedances/)
  })

  it('rejects an invalid physical transmission-line length', () => {
    const designer = new RFCircuitDesigner()
    const filter = designer.designLowPassFilter(F0, 1)
    filter.elements.push({
      id: 'TL1',
      type: 'transmission_line',
      value: 50,
      frequency: F0,
      parameters: { lengthMeters: -1, impedance: 50 },
      role: 'series',
    })
    expect(() => designer.calculateSParameters(filter, F0)).toThrow(/physical length/)
  })

  it('rejects non-finite third-order intercept templates', () => {
    const designer = new RFCircuitDesigner()
    expect(() =>
      designer.designAmplifier(10, F0, 2, { outputThirdOrderInterceptDbm: Number.NaN }),
    ).toThrow(/third-order intercept/)
    expect(() =>
      designer.designMixer(F0, F0 + 10e6, 10e6, { inputThirdOrderInterceptDbm: Infinity }),
    ).toThrow(/third-order intercept/)
  })
})
