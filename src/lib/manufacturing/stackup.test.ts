/**
 * Stackup + impedance proofs (Pi-class leg 1).
 *
 * Checked against the textbook closed forms evaluated inline — a 0.2 mm
 * trace 0.2 mm over FR4 must land near 50 Ω microstrip, and the 4-layer
 * reference stackup must validate symmetric at ~1.6 mm.
 */
import { describe, expect, it } from 'vitest'
import {
  fourLayerStackup,
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

  it('converts pair mismatch to picoseconds at 6 ps/mm', () => {
    expect(pairSkewPs(52, 50)).toBeCloseTo(12, 9)
    expect(pairSkewPs(50, 50)).toBe(0)
  })
})
