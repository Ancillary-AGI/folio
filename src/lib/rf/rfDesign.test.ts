import { describe, expect, it } from 'vitest'
import { AntennaDesigner } from './antennaDesign'
import { RFCircuitDesigner } from './rfCircuitDesign'

const db = (value: { real: number; imag: number }) => 20 * Math.log10(Math.hypot(value.real, value.imag))

describe('Butterworth filter synthesis', () => {
  it('synthesizes a 5th-order low-pass with the correct -3 dB and stopband response', () => {
    const designer = new RFCircuitDesigner()
    const cutoff = 1e9
    const filter = designer.designLowPassFilter(cutoff, 5, 50)

    expect(filter.elements).toHaveLength(5)
    expect(filter.elements.map(element => element.role)).toEqual([
      'series', 'shunt', 'series', 'shunt', 'series',
    ])
    expect(filter.elements[0]).toMatchObject({ type: 'inductor', id: 'L1' })
    expect(filter.elements[1]).toMatchObject({ type: 'capacitor', id: 'C2' })

    const atCutoff = designer.calculateSParameters(filter, cutoff)
    expect(db(atCutoff.s21)).toBeCloseTo(-3.01, 1)

    const passband = designer.calculateSParameters(filter, cutoff * 0.1)
    expect(db(passband.s21)).toBeGreaterThan(-0.05)

    const stopband = designer.calculateSParameters(filter, cutoff * 2)
    expect(db(stopband.s21)).toBeCloseTo(-30.1, 0)

    // Lossless equal-termination network: reflected plus transmitted power is one.
    for (const frequency of [0.2e9, 0.7e9, 1e9, 1.4e9, 2.5e9]) {
      const s = designer.calculateSParameters(filter, frequency)
      const power = s.s11.real ** 2 + s.s11.imag ** 2 + s.s21.real ** 2 + s.s21.imag ** 2
      expect(power).toBeCloseTo(1, 9)
    }
  })

  it('synthesizes a high-pass with the mirrored response', () => {
    const designer = new RFCircuitDesigner()
    const cutoff = 1e6
    const filter = designer.designHighPassFilter(cutoff, 3, 50)

    // Odd branches become series capacitors; the even branch is a shunt inductor.
    expect(filter.elements[0]).toMatchObject({ type: 'capacitor', id: 'C1', role: 'series' })
    expect(filter.elements[1]).toMatchObject({ type: 'inductor', id: 'L2', role: 'shunt' })
    expect(filter.elements[2]).toMatchObject({ type: 'capacitor', id: 'C3', role: 'series' })

    const atCutoff = designer.calculateSParameters(filter, cutoff)
    expect(db(atCutoff.s21)).toBeCloseTo(-3.01, 1)

    const passband = designer.calculateSParameters(filter, cutoff * 10)
    expect(db(passband.s21)).toBeGreaterThan(-0.05)

    const stopband = designer.calculateSParameters(filter, cutoff * 0.5)
    expect(db(stopband.s21)).toBeLessThan(-15)
  })

  it('synthesizes a band-pass whose edges and center follow the prototype mapping', () => {
    const designer = new RFCircuitDesigner()
    const center = 1e9
    const bandwidth = 100e6
    const filter = designer.designBandPassFilter(center, bandwidth, 3, 50)

    expect(filter.elements).toHaveLength(6)
    const atCenter = designer.calculateSParameters(filter, center)
    expect(db(atCenter.s21)).toBeGreaterThan(-0.01)
    expect(Math.hypot(atCenter.s11.real, atCenter.s11.imag)).toBeLessThan(1e-6)

    // The LP prototype maps omega/omega0 - omega0/omega = +/-1 to these edges.
    const edgeFactor = (bandwidth / center + Math.sqrt((bandwidth / center) ** 2 + 4)) / 2
    for (const frequency of [center / edgeFactor, center * edgeFactor]) {
      const s = designer.calculateSParameters(filter, frequency)
      expect(db(s.s21)).toBeCloseTo(-3.01, 1)
    }

    const farStopband = designer.calculateSParameters(filter, center * 0.5)
    expect(db(farStopband.s21)).toBeLessThan(-20)

    const metrics = designer.calculatePerformanceMetrics(filter)
    expect(metrics.centerFrequency).toBe(center)
    expect(metrics.bandwidth).toBe(bandwidth)
    expect(metrics.gain).toBeGreaterThan(-0.01)
    expect(metrics.inputReturnLoss).toBeGreaterThan(40)
    expect(Number.isNaN(metrics.thirdOrderIntercept)).toBe(true)
  })

  it('rejects impossible filter specifications', () => {
    const designer = new RFCircuitDesigner()
    expect(() => designer.designLowPassFilter(0, 3)).toThrow(/Cutoff frequency/)
    expect(() => designer.designLowPassFilter(1e9, 0)).toThrow(/order/)
    expect(() => designer.designLowPassFilter(1e9, 9)).toThrow(/order/)
    expect(() => designer.designBandPassFilter(1e9, 2e9, 3)).toThrow(/Bandwidth/)
    expect(() => designer.designHighPassFilter(1e9, 3, -50)).toThrow(/impedance/)
  })
})

describe('two-port evaluation', () => {
  it('models a quarter-wave transmission line as matched through with -90 degrees', () => {
    const designer = new RFCircuitDesigner()
    const circuit = {
      id: 'line',
      name: 'Quarter-wave line',
      elements: [{
        id: 'TL1',
        type: 'transmission_line' as const,
        value: 50,
        frequency: 1e9,
        parameters: { lengthMeters: 0.0749481145, impedance: 50 },
      }],
      connections: [],
      ports: [
        { id: 'input', impedance: 50, type: 'input' as const },
        { id: 'output', impedance: 50, type: 'output' as const },
      ],
    }

    const s = designer.calculateSParameters(circuit, 1e9)
    expect(Math.hypot(s.s11.real, s.s11.imag)).toBeLessThan(1e-9)
    expect(Math.hypot(s.s21.real, s.s21.imag)).toBeCloseTo(1, 9)
    expect(Math.atan2(s.s21.imag, s.s21.real) * 180 / Math.PI).toBeCloseTo(-90, 6)
  })

  it('includes winding loss when a quality factor is given', () => {
    const designer = new RFCircuitDesigner()
    const circuit = {
      id: 'lossy',
      name: 'Lossy series inductor',
      elements: [{
        id: 'L1',
        type: 'inductor' as const,
        value: 10e-9,
        frequency: 1e9,
        qualityFactor: 10,
        parameters: {},
        role: 'series' as const,
      }],
      connections: [],
      ports: [
        { id: 'input', impedance: 50, type: 'input' as const },
        { id: 'output', impedance: 50, type: 'output' as const },
      ],
    }

    const s = designer.calculateSParameters(circuit, 1e9)
    expect(db(s.s21)).toBeLessThan(-1)
    expect(db(s.s21)).toBeGreaterThan(-6)
  })

  it('characterizes active templates from their stated parameters', () => {
    const designer = new RFCircuitDesigner()
    const amplifier = designer.designAmplifier(20, 2.4e9, 1.2, { outputThirdOrderInterceptDbm: 30 })
    const s = designer.calculateSParameters(amplifier, 2.4e9)
    expect(db(s.s21)).toBeCloseTo(20, 6)
    expect(Math.hypot(s.s11.real, s.s11.imag)).toBeCloseTo(Math.pow(10, -15 / 20), 6)

    const metrics = designer.calculatePerformanceMetrics(amplifier)
    expect(metrics.gain).toBeCloseTo(20, 6)
    expect(metrics.noiseFigure).toBeCloseTo(1.2, 6)
    expect(metrics.inputReturnLoss).toBeCloseTo(15, 6)
    expect(metrics.outputReturnLoss).toBeCloseTo(15, 6)
    expect(metrics.isolation).toBeCloseTo(20, 6)
    expect(metrics.thirdOrderIntercept).toBe(30)
    expect(Number.isFinite(metrics.stabilityFactor)).toBe(true)

    const mixer = designer.designMixer(2.4e9, 2.5e9, 100e6, { conversionLossDb: 7 })
    expect(designer.calculatePerformanceMetrics(mixer).gain).toBeCloseTo(-7, 6)
    expect(() => designer.designMixer(2.4e9, 2.5e9, 80e6)).toThrow(/inconsistent/)
  })

  it('does not invent performance for circuits without a model', () => {
    const designer = new RFCircuitDesigner()
    const bare = {
      id: 'bare',
      name: 'Bare circuit',
      elements: [],
      connections: [],
      ports: [
        { id: 'input', impedance: 50, type: 'input' as const },
        { id: 'output', impedance: 50, type: 'output' as const },
      ],
    }

    expect(() => designer.calculatePerformanceMetrics(bare)).toThrow(/design metadata/)
    const oscillator = designer.designOscillator(2.4e9)
    expect(() => designer.calculateSParameters(oscillator, 2.4e9)).toThrow(/oscillator/)
    expect(Number.isNaN(designer.calculatePerformanceMetrics(oscillator).gain)).toBe(true)
  })
})

describe('antenna synthesis', () => {
  it('sizes a half-wave dipole from the wavelength', () => {
    const designer = new AntennaDesigner()
    const antenna = designer.designDipole(300e6)
    expect(antenna.dimensions.length).toBeCloseTo(299792458 / 300e6 / 2, 9)
    // Numerically integrated directivity of the exact half-wave pattern:
    // 1.6409 → 2.1509 dBi, i.e. the textbook 2.15 dBi.
    expect(antenna.parameters.gain).toBeCloseTo(2.15, 2)
    expect(antenna.parameters.directivity).toBeCloseTo(antenna.parameters.gain, 9)
  })

  it('produces a finite dipole pattern with a broadside maximum and no NaNs', () => {
    const designer = new AntennaDesigner()
    const antenna = designer.designDipole(300e6)
    const pattern = designer.calculateRadiationPattern(antenna, 361)
    expect(pattern.gain).toHaveLength(361)
    const values = pattern.gain.map(point => point[0])
    expect(values.every(Number.isFinite)).toBe(true)
    expect(Math.max(...values)).toBeCloseTo(2.15, 1)
    expect(Math.min(...values)).toBeGreaterThanOrEqual(-60)
    expect(pattern.gain[180][0]).toBeCloseTo(2.15, 1)
  })

  it('synthesizes a physically plausible 2.4 GHz FR4 patch', () => {
    const designer = new AntennaDesigner()
    const patch = designer.designPatchAntenna(2.4e9, 1.6e-3, 4.4)
    expect(patch.dimensions.width * 1e3).toBeGreaterThan(35)
    expect(patch.dimensions.width * 1e3).toBeLessThan(42)
    expect(patch.dimensions.length * 1e3).toBeGreaterThan(26)
    expect(patch.dimensions.length * 1e3).toBeLessThan(33)
    expect(patch.dimensions.effectiveEpsilon).toBeGreaterThan(4)
    expect(patch.dimensions.effectiveEpsilon).toBeLessThan(4.4)

    const pattern = designer.calculateRadiationPattern(patch, 181)
    // The pattern is the two-slot aperture cut, so its peak is the integrated
    // aperture directivity (7.74 dBi for this geometry), not the fabricated
    // "gain: 6" constant this test used to pin.
    const values = pattern.gain.map(point => point[0])
    expect(Math.max(...values)).toBeCloseTo(patch.parameters.gain, 9)
    // E-plane -3 dB beamwidth of the derived aperture (~97 deg full width), so
    // 30 deg off boresight is inside the lobe and only ~1 dB down. The bound
    // follows from the computed patch.parameters.ePlaneBeamwidth.
    expect(values[30]).toBeLessThan(patch.parameters.gain)
    expect(values[30]).toBeGreaterThan(patch.parameters.gain - 2)
    expect(values[150]).toBe(-60)
  })

  it('builds exactly the requested Yagi element count and array weights', () => {
    const designer = new AntennaDesigner()
    const yagi = designer.designYagiUda(900e6, 5)
    expect(yagi.elements).toHaveLength(5)
    expect(yagi.amplitudeTaper).toHaveLength(5)
    expect(yagi.phaseTaper).toHaveLength(5)
    expect(yagi.elements[0].dimensions.length).toBeGreaterThan(yagi.elements[1].dimensions.length)

    const pattern = designer.calculateRadiationPattern(yagi, 181)
    expect(pattern.gain.every(point => Number.isFinite(point[0]))).toBe(true)
    const yagiPeak = Math.max(...pattern.gain.map(point => point[0]))
    // Five coherent elements add 10*log10(5) = 7.0 dB over one dipole.
    expect(yagiPeak).toBeGreaterThan(8)
    expect(yagiPeak).toBeLessThan(10)
  })

  it('resizes a short dipole to a reachable gain target', () => {
    const designer = new AntennaDesigner()
    const wavelength = 299792458 / 300e6
    const short = designer.designDipole(300e6, 0.2 * wavelength)
    expect(short.parameters.gain).toBeLessThan(1.9)

    // No bandwidth argument: the wire model has no reactance kernel, so it
    // refuses a bandwidth target instead of certifying one. See the next test.
    const optimized = designer.optimizeAntenna(short, 2.1)
    expect(optimized.dimensions.length).toBeGreaterThan(0.3 * wavelength)
    expect(optimized.parameters.gain).toBeCloseTo(2.1, 1)
    expect(optimized.parameters.directivity).toBeCloseTo(2.1, 1)
    expect(optimized.parameters.bandwidth).toBeNull()
    expect(optimized.parameters.vsWR).toBeNull()
  })

  it('rejects gain and bandwidth targets the wire model cannot reach', () => {
    const designer = new AntennaDesigner()
    const dipole = designer.designDipole(300e6)
    expect(() => designer.optimizeAntenna(dipole, 20, 10e6)).toThrow(/outside that range/)
    expect(() => designer.optimizeAntenna(dipole, 2.0, 100e6)).toThrow(/bandwidth/)
    expect(() => designer.optimizeAntenna(dipole, Number.NaN, 10e6)).toThrow(/finite target gain/)
  })

  it('refuses to optimise antenna types outside the wire model', () => {
    const designer = new AntennaDesigner()
    const patch = designer.designPatchAntenna(2.4e9, 1.6e-3, 4.4)
    expect(() => designer.optimizeAntenna(patch, 7, 50e6)).toThrow(/dipole\/monopole/)
  })

  it('rejects impossible antenna and array specifications', () => {
    const designer = new AntennaDesigner()
    expect(() => designer.designDipole(0)).toThrow(/frequency/)
    expect(() => designer.designPatchAntenna(2.4e9, 0, 4.4)).toThrow(/substrate/)
    expect(() => designer.designYagiUda(900e6, 1)).toThrow(/at least two/)
    expect(() => designer.designPhasedArray(2.4e9, 1)).toThrow(/at least two/)
  })
})
