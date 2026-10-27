/**
 * Stackup + impedance proofs (Pi-class leg 1).
 *
 * Checked against the textbook closed forms evaluated inline — a 0.2 mm
 * trace 0.2 mm over FR4 must land near 50 Ω microstrip, and the 4-layer
 * reference stackup must validate symmetric at ~1.6 mm.
 */
import { describe, expect, it } from 'vitest'
import {
  delayPsPerMm,
  fourLayerStackup,
  microstripErEff,
  microstripImpedance,
  nearestPlane,
  pairSkewPs,
  striplineImpedance,
  validateStackup,
  widthForImpedance,
} from './stackup'

describe('stackup and impedance', () => {
  it('validates the 4-layer reference stackup symmetric near 1.6 mm', () => {
    const { stackup, violations } = validateStackup(fourLayerStackup())
    expect(violations).toEqual([])
    expect(stackup.totalThickness).toBeGreaterThan(1.4)
    expect(stackup.totalThickness).toBeLessThan(1.8)
  })

  it('rejects an asymmetric stackup instead of risking warp', () => {
    const layers = fourLayerStackup()
    layers.splice(1, 1)
    expect(validateStackup(layers).violations.some((v) => v.rule === 'symmetry')).toBe(true)
  })

  it('reports non-physical layer values instead of accepting NaN', () => {
    const layers = fourLayerStackup()
    layers[1] = { name: 'Prepreg', kind: 'dielectric', thickness: Number.NaN, er: 4.4 }
    const badThickness = validateStackup(layers)
    expect(badThickness.violations.some((v) => /dielectric thickness/.test(v.message))).toBe(true)
    // A partial sum would silently understate the board, so report NaN instead.
    expect(badThickness.stackup.totalThickness).toBeNaN()

    const lowEr = fourLayerStackup()
    lowEr[1] = { name: 'Prepreg', kind: 'dielectric', thickness: 0.2, er: 0.5 }
    expect(validateStackup(lowEr).violations.some((v) => /dielectric constant/.test(v.message))).toBe(true)

    const copper = fourLayerStackup()
    copper[0] = { name: 'Top', kind: 'signal', thickness: -1 }
    expect(validateStackup(copper).violations.some((v) => /copper weight/.test(v.message))).toBe(true)
  })

  it('finds the reference plane for the top signal layer', () => {
    const layers = fourLayerStackup()
    const plane = nearestPlane(layers, 0)
    expect(plane).toBeDefined()
    expect(plane!.distance).toBeCloseTo(0.2, 6)
    expect(plane!.er).toBeCloseTo(4.4, 6)
  })

  it('tracks the microstrip closed form at its textbook point', () => {
    // w = 0.3 mm, h = 0.2 mm, t = 0.035 mm, FR4: the IPC form lands ~50 Ω.
    const z = microstripImpedance(0.3, 0.2, 0.035, 4.4)
    expect(z).toBeGreaterThan(44)
    expect(z).toBeLessThan(64)
    // Narrower trace over the same height must read higher impedance.
    expect(microstripImpedance(0.15, 0.2, 0.035, 4.4)).toBeGreaterThan(z)
  })

  it('tracks the stripline closed form monotonically', () => {
    // Wider trace between the same planes must read lower impedance.
    const narrow = striplineImpedance(0.15, 0.8, 0.035, 4.4)
    const wide = striplineImpedance(0.3, 0.8, 0.035, 4.4)
    expect(wide).toBeLessThan(narrow)
    expect(narrow).toBeGreaterThan(30)
    expect(narrow).toBeLessThan(90)
  })

  it('solves the width for 50 Ω and round-trips it', () => {
    const width = widthForImpedance(50, { height: 0.2, thickness: 0.035, er: 4.4, mode: 'microstrip' })
    expect(width).toBeDefined()
    expect(microstripImpedance(width!, 0.2, 0.035, 4.4)).toBeCloseTo(50, 1)
  })

  it('returns undefined for an unreachable impedance', () => {
    expect(widthForImpedance(200, { height: 0.2, thickness: 0.035, er: 4.4, mode: 'microstrip' })).toBeUndefined()
  })

  it('reports the microstrip effective permittivity between air and laminate', () => {
    const erEff = microstripErEff(0.3, 0.2, 4.4)
    expect(erEff).toBeGreaterThan(1)
    expect(erEff).toBeLessThan(4.4)
    // A wide trace over a thin dielectric puts almost all the field in the laminate.
    expect(microstripErEff(10, 0.05, 4.4)).toBeGreaterThan(erEff)
    expect(() => microstripErEff(0.3, 0.2, 0.5)).toThrow(/εr/)
    expect(() => microstripErEff(0, 0.2, 4.4)).toThrow(/width/)
  })

  it('converts pair mismatch to picoseconds from the declared dielectric', () => {
    // ε_eff 3.24 → 6.004 ps per mm, i.e. the FR-4 rule of thumb derived from
    // the permittivity instead of hardcoded into the function.
    expect(delayPsPerMm(3.24)).toBeCloseTo(6.0042, 4)
    expect(pairSkewPs(52, 50, 3.24)).toBeCloseTo(12.0083, 4)
    expect(pairSkewPs(50, 50, 3.24)).toBe(0)
    // A slower laminate must read more skew for the same millimetres.
    expect(pairSkewPs(52, 50, 4.4)).toBeGreaterThan(pairSkewPs(52, 50, 3.24))
    expect(() => delayPsPerMm(Number.NaN)).toThrow(/permittivity/)
    expect(() => delayPsPerMm(0.9)).toThrow(/permittivity/)
    expect(() => pairSkewPs(Number.POSITIVE_INFINITY, 50, 4.4)).toThrow(/lengths must be finite/)
  })
})
