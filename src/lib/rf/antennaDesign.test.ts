import { describe, expect, it } from 'vitest'
import { AntennaDesigner } from './antennaDesign'

const GHz = 1e9

describe('AntennaDesigner elements', () => {
  it('computes the half-wave dipole directivity from its far field', () => {
    const designer = new AntennaDesigner()
    const dipole = designer.designDipole(GHz)
    expect(dipole.parameters.wavelength).toBeCloseTo(0.299792458, 9)
    expect(dipole.parameters.directivity).toBeCloseTo(2.15, 2)
    // Lossless wire model: gain equals directivity.
    expect(dipole.parameters.gain).toBeCloseTo(dipole.parameters.directivity, 9)
    expect(dipole.parameters.efficiency).toBe(100)
  })

  it('adds 3 dB for a quarter-wave monopole over a ground plane', () => {
    const designer = new AntennaDesigner()
    const monopole = designer.designMonopole(GHz)
    expect(monopole.parameters.directivity).toBeCloseTo(5.161, 2)
    expect(monopole.dimensions.groundPlaneRadius).toBeCloseTo(0.299792458 / 4, 9)
  })

  it('rejects invalid frequencies and geometries', () => {
    const designer = new AntennaDesigner()
    expect(() => designer.designDipole(0)).toThrow(/positive finite/)
    expect(() => designer.designDipole(NaN)).toThrow(/positive finite/)
    expect(() => designer.designDipole(GHz, -1)).toThrow(/positive finite/)
    expect(() => designer.designDipole(GHz, 0)).toThrow(/positive finite/)
    expect(() => designer.designDipole(GHz, NaN)).toThrow(/positive finite/)
    expect(() => designer.designMonopole(GHz, -1)).toThrow(/positive/)
    expect(() => designer.designMonopole(GHz, 0)).toThrow(/positive/)
    expect(() => designer.designMonopole(GHz, NaN)).toThrow(/positive/)
    expect(() => designer.designMonopole(GHz, 0.1, 0)).toThrow(/positive/)
    expect(() => designer.designMonopole(GHz, 0.1, NaN)).toThrow(/positive/)
    expect(() => designer.designPatchAntenna(GHz, 0, 4.4)).toThrow(/positive substrate/)
    expect(() => designer.designPatchAntenna(GHz, 1e-3, 0.5)).toThrow(/dielectric/)
  })

  it('derives patch dimensions from the dominant TM010 mode', () => {
    const designer = new AntennaDesigner()
    const patch = designer.designPatchAntenna(2.45 * GHz, 1.6e-3, 4.4)
    expect(patch.dimensions.width).toBeGreaterThan(0)
    expect(patch.dimensions.length).toBeGreaterThan(0)
    // Fringing makes the physical patch shorter than the dielectric half-wave.
    expect(patch.dimensions.length).toBeLessThan(0.5 * patch.parameters.wavelength / Math.sqrt(patch.dimensions.effectiveEpsilon))
    expect(patch.parameters.efficiency).toBe(70)
  })

  it('builds Yagi and phased arrays with the requested element count', () => {
    const designer = new AntennaDesigner()
    const yagi = designer.designYagiUda(GHz, 5)
    expect(yagi.elements).toHaveLength(5)
    expect(yagi.elements[0].dimensions.length).toBeCloseTo(yagi.elements[0].parameters.wavelength * 0.55, 9)
    expect(yagi.spacing.dx).toBeCloseTo(yagi.elements[0].parameters.wavelength / 4, 9)

    const linear = designer.designPhasedArray(GHz, 4)
    expect(linear.elements).toHaveLength(4)
    expect(linear.elements[0].position.x).toBeCloseTo(-linear.elements[3].position.x, 9)
    expect(Math.max(...linear.amplitudeTaper)).toBeCloseTo(1, 9)
    expect(linear.amplitudeTaper[0]).toBeCloseTo(linear.amplitudeTaper[3], 9)

    expect(() => designer.designYagiUda(GHz, 1)).toThrow(/at least two/)
    expect(() => designer.designPhasedArray(GHz, 1)).toThrow(/at least two/)
  })
})

describe('AntennaDesigner patterns', () => {
  it('places a dipole null on axis and its peak broadside', () => {
    const designer = new AntennaDesigner()
    const dipole = designer.designDipole(GHz)
    const pattern = designer.calculateRadiationPattern(dipole, 360)
    const axis = pattern.gain[0][0]
    const broadside = pattern.gain[180][0]
    expect(axis).toBe(-60)
    expect(broadside).toBeCloseTo(dipole.parameters.gain, 9)
  })

  it('uses the element length and normalises to its own peak', () => {
    const designer = new AntennaDesigner()
    const wavelength = 299792458 / GHz
    const fullWave = designer.designDipole(GHz, wavelength)
    const pattern = designer.calculateRadiationPattern(fullWave, 181)

    // The pattern peak is the quoted directivity, not 6 dB above it.
    expect(pattern.gain[90][0]).toBeCloseTo(fullWave.parameters.gain, 2)

    // Full-wave far field is 4.771 dB down at 60 degrees; the half-wave shape
    // would only be 1.76 dB down, so this pins the length-aware pattern.
    const theta = (pattern.theta[60] * Math.PI) / 180
    const fixedPower = ((Math.cos(Math.PI * Math.cos(theta)) - Math.cos(Math.PI)) / Math.sin(theta)) ** 2
    expect(pattern.gain[60][0]).toBeCloseTo(
      10 * Math.log10(fixedPower / 4) + fullWave.parameters.gain,
      9,
    )
  })

  it('gives a patch its stated 60-degree half-power beamwidth', () => {
    const designer = new AntennaDesigner()
    const patch = designer.designPatchAntenna(2.45 * GHz, 1.6e-3, 4.4)
    const pattern = designer.calculateRadiationPattern(patch, 360)
    // Patch θ is measured from boresight: peak at 0, -3 dB at 30 degrees.
    const boresight = pattern.gain[0][0]
    expect(boresight).toBeCloseTo(patch.parameters.gain, 9)
    expect(pattern.gain[60][0]).toBeCloseTo(boresight - 3.0103, 4)
  })

  it('keeps a monopole pattern in the upper hemisphere', () => {
    const designer = new AntennaDesigner()
    const monopole = designer.designMonopole(GHz)
    const pattern = designer.calculateRadiationPattern(monopole, 360)
    expect(pattern.gain[180][0]).toBeCloseTo(monopole.parameters.directivity, 9)
    // Below the ground plane the pattern is zero and clamps to the -60 dB floor.
    expect(pattern.gain[300][0]).toBe(-60)
  })

  it('rejects under-sampled patterns', () => {
    const designer = new AntennaDesigner()
    const dipole = designer.designDipole(GHz)
    expect(() => designer.calculateRadiationPattern(dipole, 1)).toThrow(/two angular samples/)
    expect(() => designer.calculateRadiationPattern(dipole, 2.5)).toThrow(/two angular samples/)
  })
})

describe('AntennaDesigner optimisation', () => {
  it('finds a dipole length that meets a reachable gain target', () => {
    const designer = new AntennaDesigner()
    const dipole = designer.designDipole(GHz)
    const optimized = designer.optimizeAntenna(dipole, 2.15, 50e6)
    const length = optimized.dimensions.length ?? 0
    expect(length).toBeGreaterThan(0.3 * dipole.parameters.wavelength)
    expect(length).toBeLessThan(0.8 * dipole.parameters.wavelength)
    expect(optimized.parameters.gain).toBeCloseTo(2.15, 1)
  })

  it('rejects unreachable gain, excessive bandwidth and non-wire antennas', () => {
    const designer = new AntennaDesigner()
    const dipole = designer.designDipole(GHz)
    expect(() => designer.optimizeAntenna(dipole, 30, 50e6)).toThrow(/outside that range/)
    expect(() => designer.optimizeAntenna(dipole, 2.15, 500e6)).toThrow(/bandwidth/)
    expect(() => designer.optimizeAntenna(dipole, 2.15, 0)).toThrow(/positive bandwidth/)
    const patch = designer.designPatchAntenna(GHz, 1.6e-3, 4.4)
    expect(() => designer.optimizeAntenna(patch, 6, 50e6)).toThrow(/dipole\/monopole/)
  })
})
