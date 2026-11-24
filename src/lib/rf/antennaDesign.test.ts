import { describe, expect, it } from 'vitest'
import { AntennaDesigner } from './antennaDesign'

const GHz = 1e9
const C = 299792458

type ApertureInternals = {
  /**
   * Reaches the private aperture integrators so the hemisphere quadrature can be
   * pinned against an analytic limit, and against monotonicity in width/length
   * at fixed frequency, which the public designers cannot vary independently.
   */
  patchDirectivityLinear: (width: number, length: number, wavelength: number) => number
  patchAperturePower: (width: number, length: number, wavelength: number) => (theta: number, phi: number) => number
}

/** Bound to the instance: these read other private integrators through `this`. */
function internals(designer: AntennaDesigner): ApertureInternals {
  const privates = designer as unknown as {
    patchDirectivityLinear(this: unknown, width: number, length: number, wavelength: number): number
    patchAperturePower(this: unknown, width: number, length: number, wavelength: number): (theta: number, phi: number) => number
  }
  return {
    patchDirectivityLinear: (width, length, wavelength) =>
      privates.patchDirectivityLinear.call(designer, width, length, wavelength),
    patchAperturePower: (width, length, wavelength) =>
      privates.patchAperturePower.call(designer, width, length, wavelength),
  }
}

describe('wire antennas: radiation resistance from the far field', () => {
  it('matches the Balanis half-wave anchors: 73 ohm and 2.15 dBi within 0.5%', () => {
    const designer = new AntennaDesigner()
    const dipole = designer.designDipole(GHz)
    expect(dipole.parameters.wavelength).toBeCloseTo(0.299792458, 9)
    // Rr = 60 * int_0^pi g^2 sin(theta) d theta = 73.13 ohm for L = lambda/2.
    // The published value is 73 ohm, so 0.5% covers the rounding of the anchor.
    expect(dipole.parameters.impedance).toBeCloseTo(73, 0)
    expect(Math.abs(dipole.parameters.impedance - 73) / 73).toBeLessThan(0.005)
    // D = 1.641 linear (2.1509 dBi), Balanis's half-wave directivity.
    const directivityLinear = 10 ** (dipole.parameters.directivity / 10)
    expect(Math.abs(directivityLinear - 1.641) / 1.641).toBeLessThan(0.005)
    expect(dipole.parameters.directivity).toBeCloseTo(2.1509, 3)
    // Lossless wire model: gain equals directivity.
    expect(dipole.parameters.gain).toBeCloseTo(dipole.parameters.directivity, 9)
    expect(dipole.parameters.efficiency).toBe(100)
    expect(dipole.parameters.assumptions).toContain('loss-free-efficiency')
  })

  it('derives the quarter-wave monopole resistance as half the dipole by image theory', () => {
    const designer = new AntennaDesigner()
    const monopole = designer.designMonopole(GHz)
    const dipole = designer.designDipole(GHz)
    // 36.5 ohm (Balanis) is Rr(lambda/2 dipole)/2, not a constant to hardcode.
    expect(monopole.parameters.impedance).toBeCloseTo(dipole.parameters.impedance / 2, 9)
    expect(Math.abs(monopole.parameters.impedance - 36.5) / 36.5).toBeLessThan(0.005)
    expect(monopole.parameters.directivity).toBeCloseTo(dipole.parameters.directivity + 10 * Math.log10(2), 9)
    expect(monopole.parameters.directivity).toBeCloseTo(5.161, 2)
  })

  it('reproduces the short-dipole 20*pi^2*(L/lambda)^2 law, which the feed-referred resistance must give', () => {
    const designer = new AntennaDesigner()
    const wavelength = C / (300 * 1e6)
    // A 0.05 lambda dipole is well inside the infinitesimal limit; the textbook
    // (triangular-current) radiation resistance referred to the feed current is
    // 20*pi^2*(L/lambda)^2 = 0.4935 ohm. Referring to the standing-wave maximum
    // instead would give an (L/lambda)^4 number orders of magnitude off.
    // The 0.5% bound is the physical residual: a sinusoidal current on a finite
    // 0.05 lambda wire is not quite the triangular current of the limit, so the
    // computed 0.4951 ohm must not be pinned to more digits than the anchor means.
    const short = designer.designDipole(300 * 1e6, 0.05 * wavelength)
    const infinitesimal = 20 * Math.PI ** 2 * 0.05 ** 2
    expect(Math.abs(short.parameters.impedance - infinitesimal) / infinitesimal).toBeLessThan(0.005)
    expect(short.parameters.ePlaneBeamwidth).toBeCloseTo(90, 0)
  })

  it('gives the published 78 degree half-wave and 90 degree short-dipole beamwidths', () => {
    const designer = new AntennaDesigner()
    const wavelength = C / GHz
    const dipole = designer.designDipole(GHz)
    // Balanis: half-wave dipole HPBW 78 degrees, infinitesimal dipole 90 degrees.
    expect(dipole.parameters.ePlaneBeamwidth).toBeCloseTo(78, 0)
    const short = designer.designDipole(GHz, 0.02 * wavelength)
    expect(short.parameters.ePlaneBeamwidth).toBeCloseTo(90, 0)
    // A wire pattern is azimuthally symmetric, so it has no H-plane lobe to quote.
    expect(dipole.parameters.hPlaneBeamwidth).toBeNull()
    expect(dipole.parameters.notModeled.hPlaneBeamwidth).toBe('azimuthally-symmetric-pattern')
  })

  it('refuses a resistance at the feed current null instead of reporting infinity', () => {
    const designer = new AntennaDesigner()
    const wavelength = C / GHz
    // A full-wave centre-fed dipole is fed at a current null: the thin-wire
    // model's input resistance diverges there.
    expect(() => designer.designDipole(GHz, wavelength)).toThrow(/current null/)
  })

  it('returns null, not a constant, for wire bandwidth and VSWR with a machine-readable reason', () => {
    const designer = new AntennaDesigner()
    const dipole = designer.designDipole(GHz)
    expect(dipole.parameters.bandwidth).toBeNull()
    expect(dipole.parameters.vsWR).toBeNull()
    expect(dipole.parameters.notModeled.bandwidth).toBe('reactance-not-modeled')
    expect(dipole.parameters.notModeled.vsWR).toBe('no-complex-input-impedance')
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
})

describe('patch antenna: two-slot aperture model', () => {
  it('derives the TM010 geometry and a few-hundred-ohm edge resistance, not a matched 50 ohm', () => {
    const designer = new AntennaDesigner()
    const patch = designer.designPatchAntenna(2.45 * GHz, 1.6e-3, 4.4)
    expect(patch.dimensions.width).toBeGreaterThan(0)
    expect(patch.dimensions.length).toBeGreaterThan(0)
    // Fringing makes the physical patch shorter than the dielectric half-wave.
    expect(patch.dimensions.length).toBeLessThan(0.5 * patch.parameters.wavelength / Math.sqrt(patch.dimensions.effectiveEpsilon))
    // The old design published a fabricated "50 ohms (matched)". The edge of a
    // patch is a few hundred ohms; literature values for typical patches sit in
    // the 200-500 ohm band, and this is a bound rather than an exact anchor
    // because R = 45/(W/lambda0)^2/S1 depends on the derived width, not a
    // universal constant.
    expect(patch.parameters.impedance).toBeGreaterThan(200)
    expect(patch.parameters.impedance).toBeLessThan(500)
    // Recomputed independently from the published geometry.
    const wavelength = patch.parameters.wavelength
    const k0h = 2 * Math.PI * patch.dimensions.height / wavelength
    const s1 = 1 + (k0h ** 2) / 2 - (k0h ** 4) / 24
    const g1 = ((patch.dimensions.width / wavelength) ** 2 * s1) / 90
    expect(patch.parameters.impedance).toBeCloseTo(1 / (2 * g1), 9)
    // The inset is derived to transform that resistance to 50 ohm, so the panel
    // can show a real feed position instead of the old arbitrary L/4.
    const inset = patch.dimensions.feedOffset
    expect(inset).toBeGreaterThan(0)
    expect(inset).toBeLessThan(patch.dimensions.length / 2)
    expect(patch.parameters.impedance * Math.cos(Math.PI * inset / patch.dimensions.length) ** 2).toBeCloseTo(50, 6)
  })

  it('keeps the low-permittivity patch in the published 200-300 ohm edge-resistance band', () => {
    const designer = new AntennaDesigner()
    // epsr = 2.2 gives W/lambda0 = 0.395, the geometry the "typical patch is
    // 200-300 ohm at the edge" statements refer to.
    const patch = designer.designPatchAntenna(2.4 * GHz, 1.57e-3, 2.2)
    expect(patch.parameters.impedance).toBeGreaterThan(200)
    expect(patch.parameters.impedance).toBeLessThan(320)
  })

  it('integrates the aperture directivity to the analytic vanishing-slot limit 480/101', () => {
    const designer = new AntennaDesigner()
    const { patchDirectivityLinear } = internals(designer)
    // W, L -> 0 leaves only the ground-plane obliquity and the transversality
    // projection: D = 4*pi / (pi*101/120) = 480/101 exactly (6.77 dBi). This
    // pins the hemisphere quadrature itself, independent of any geometry.
    expect(patchDirectivityLinear(1e-12, 1e-12, 0.1)).toBeCloseTo(480 / 101, 6)
  })

  it('reports a literature-range directivity for a real FR4 patch and no invented bandwidth', () => {
    const designer = new AntennaDesigner()
    const patch = designer.designPatchAntenna(2.4 * GHz, 1.6e-3, 4.4)
    // Published rectangular-patch directivity is 5-9 dBi. This is a bound, not
    // an exact anchor: D depends on the derived W/lambda0 and L/lambda0.
    expect(patch.parameters.directivity).toBeGreaterThan(5)
    expect(patch.parameters.directivity).toBeLessThan(9)
    // Loss-free aperture: the efficiency is an assumption, and gain follows it.
    expect(patch.parameters.efficiency).toBe(100)
    expect(patch.parameters.gain).toBeCloseTo(patch.parameters.directivity, 9)
    expect(patch.parameters.assumptions).toEqual(
      expect.arrayContaining(['loss-free-efficiency', 'mutual-slot-conductance-neglected']),
    )
    expect(patch.parameters.bandwidth).toBeNull()
    expect(patch.parameters.vsWR).toBeNull()
    expect(patch.parameters.notModeled.bandwidth).toBe('cavity-q-not-modeled')
  })

  it('restricts the slot model to the range its series is valid in', () => {
    const designer = new AntennaDesigner()
    // k0*h above ~0.75 leaves the truncated S1 series.
    expect(() => designer.designPatchAntenna(2.4 * GHz, 15e-3, 2.2)).toThrow(/electrically thick/)
    // W/lambda0 = 0.5*sqrt(2/(epsr+1)) falls monotonically with epsr, so the 0.5
    // ceiling is only reached at epsr = 1: no legal TM010 design can pass it. The
    // guard is kept because a future geometry change must fail loudly rather than
    // extrapolate the neglected mutual conductance.
    const air = designer.designPatchAntenna(2.4 * GHz, 0.4e-3, 1)
    expect(air.dimensions.width / air.parameters.wavelength).toBeLessThanOrEqual(0.5)
    expect(() => designer.designPatchAntenna(2.4 * GHz, 0.4e-3, 0.99)).toThrow(/dielectric constant/)
  })

  it('makes the beamwidth follow the aperture: a wider patch has a narrower H-plane beam', () => {
    const designer = new AntennaDesigner()
    const { patchAperturePower } = internals(designer)
    const wavelength = 0.1
    const length = 0.024 * wavelength

    const hPlaneWidth = (width: number): number => {
      const pattern = patchAperturePower(width, length, wavelength)
      const peak = pattern(0, Math.PI / 2)
      let lo = 0
      let hi = Math.PI / 2
      for (let step = 0; step < 60; step += 1) {
        const mid = (lo + hi) / 2
        if (pattern(mid, Math.PI / 2) / peak > 0.5) lo = mid
        else hi = mid
      }
      return (lo + hi) * 90 / Math.PI
    }
    // Half-power angle from boresight shrinks monotonically as the width grows.
    expect(hPlaneWidth(0.2 * wavelength)).toBeLessThan(hPlaneWidth(0.1 * wavelength))
    expect(hPlaneWidth(0.4 * wavelength)).toBeLessThan(hPlaneWidth(0.2 * wavelength))

    // And through the public API: the lower-permittivity design has both the
    // wider patch and the narrower beams.
    const fr4 = designer.designPatchAntenna(2.4 * GHz, 1.6e-3, 4.4)
    const rogers = designer.designPatchAntenna(2.4 * GHz, 1.57e-3, 2.2)
    expect(rogers.dimensions.width).toBeGreaterThan(fr4.dimensions.width)
    expect(rogers.dimensions.length).toBeGreaterThan(fr4.dimensions.length)
    expect(rogers.parameters.hPlaneBeamwidth!).toBeLessThan(fr4.parameters.hPlaneBeamwidth!)
    expect(rogers.parameters.ePlaneBeamwidth!).toBeLessThan(fr4.parameters.ePlaneBeamwidth!)
    expect(rogers.parameters.directivity).toBeGreaterThan(fr4.parameters.directivity)
  })

  it('drops the forced 60 degree beamwidth in favour of the aperture numbers', () => {
    const designer = new AntennaDesigner()
    const patch = designer.designPatchAntenna(2.45 * GHz, 1.6e-3, 4.4)
    expect(patch.parameters.ePlaneBeamwidth).toBeGreaterThan(70)
    expect(patch.parameters.ePlaneBeamwidth).toBeLessThan(130)
    // The two principal cuts differ, which the single forced cos^n exponent
    // could never express: the smaller aperture extent is the broader plane.
    expect(patch.parameters.hPlaneBeamwidth!).toBeLessThan(patch.parameters.ePlaneBeamwidth!)
  })
})

describe('AntennaDesigner arrays', () => {
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
    const wavelength = C / GHz
    const fullWave = designer.designDipole(GHz, 0.9 * wavelength)
    const pattern = designer.calculateRadiationPattern(fullWave, 181)

    // The pattern peak is the quoted directivity, not 6 dB above it.
    expect(pattern.gain[90][0]).toBeCloseTo(fullWave.parameters.gain, 2)

    // 0.9 lambda far field at 60 degrees, from the length-aware expression; the
    // half-wave shape would give a different depth, so this pins the length.
    // The lobe still peaks broadside for L < 1.5 lambda, where the normalising
    // value is g(broadside) = 1 - cos(kL/2).
    const theta = (pattern.theta[60] * Math.PI) / 180
    const half = Math.PI * 0.9
    const fixedPower = ((Math.cos(half * Math.cos(theta)) - Math.cos(half)) / Math.sin(theta)) ** 2
    const broadsidePower = (1 - Math.cos(half)) ** 2
    expect(pattern.gain[60][0]).toBeCloseTo(
      10 * Math.log10(fixedPower / broadsidePower) + fullWave.parameters.gain,
      6,
    )
  })

  it('draws the patch cut from the same aperture the beamwidth numbers come from', () => {
    const designer = new AntennaDesigner()
    const patch = designer.designPatchAntenna(2.45 * GHz, 1.6e-3, 4.4)
    const pattern = designer.calculateRadiationPattern(patch, 721)
    // Patch theta is measured from boresight: peak at index 0.
    const boresight = pattern.gain[0][0]
    expect(boresight).toBeCloseTo(patch.parameters.gain, 9)
    // The plotted -3 dB crossing has to agree with the reported beamwidth; the
    // old model forced 60 degrees by construction and could not be checked.
    const halfBeam = patch.parameters.ePlaneBeamwidth! / 2
    const step = 180 / 721
    const index = Math.round(halfBeam / step)
    expect(pattern.gain[index][0]).toBeCloseTo(boresight - 3, 1)
    // Grazing is well below the peak, which the cos^n hack never produced.
    expect(pattern.gain[359][0]).toBeLessThan(boresight - 8)
  })

  it('keeps a monopole pattern above the ground plane and peaked at the horizon', () => {
    const designer = new AntennaDesigner()
    const monopole = designer.designMonopole(GHz)
    const pattern = designer.calculateRadiationPattern(monopole, 360)
    // The quarter-wave monopole peaks at the horizon (theta = 90 degrees).
    expect(pattern.gain[180][0]).toBeCloseTo(monopole.parameters.gain, 9)
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
    const optimized = designer.optimizeAntenna(dipole, 2.15)
    const length = optimized.dimensions.length ?? 0
    expect(length).toBeGreaterThan(0.3 * dipole.parameters.wavelength)
    expect(length).toBeLessThan(0.8 * dipole.parameters.wavelength)
    expect(optimized.parameters.gain).toBeCloseTo(2.15, 1)
    // Re-optimising must not resurrect a bandwidth number the model cannot back.
    expect(optimized.parameters.bandwidth).toBeNull()
    expect(optimized.parameters.vsWR).toBeNull()
    expect(optimized.parameters.impedance).toBeCloseTo(73, 0)
  })

  it('refuses bandwidth targets it cannot certify, and non-wire antennas', () => {
    const designer = new AntennaDesigner()
    const dipole = designer.designDipole(GHz)
    expect(() => designer.optimizeAntenna(dipole, 30, 50e6)).toThrow(/outside that range/)
    expect(() => designer.optimizeAntenna(dipole, 2.15, 500e6)).toThrow(/bandwidth/)
    expect(() => designer.optimizeAntenna(dipole, 2.15, 0)).toThrow(/positive bandwidth/)
    const patch = designer.designPatchAntenna(GHz, 1.6e-3, 4.4)
    expect(() => designer.optimizeAntenna(patch, 6, 50e6)).toThrow(/dipole\/monopole/)
  })

  it('keeps the monopole geometry consistent through the optimiser', () => {
    const designer = new AntennaDesigner()
    const monopole = designer.designMonopole(GHz)
    const optimized = designer.optimizeAntenna(monopole, 5.15)
    const height = optimized.dimensions.height ?? 0
    expect(optimized.parameters.directivity).toBeCloseTo(5.15, 1)
    // The 5.15 dBi target is 0.01 dB under the quarter-wave value, so the retuned
    // height is a hair short of lambda/4 and the feed resistance sits a few
    // percent under the 36.5 ohm anchor. Near resonance R changes ~3% per 0.01 dB
    // of directivity, so 5% is the bound the anchor actually supports.
    expect(Math.abs(optimized.parameters.impedance - 36.5) / 36.5).toBeLessThan(0.05)
    // Non-fabrication check: the optimised element and a directly designed element
    // of the same height must report the same numbers.
    expect(optimized.parameters.impedance)
      .toBeCloseTo(designer.designMonopole(GHz, height).parameters.impedance, 9)
  })
})
