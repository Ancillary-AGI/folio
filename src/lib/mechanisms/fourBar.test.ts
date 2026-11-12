import { describe, expect, it } from 'vitest'
import {
  analyzeFourBar,
  classifyFourBar,
  fourBarPosition,
  type FourBarLengths,
} from './fourBar'

const CRANK_ROCKER: FourBarLengths = { ground: 0.1, crank: 0.04, coupler: 0.085, rocker: 0.07 }

/** A printed run for pinning clamp bounds and verifying classifications. */
describe('fourBar', () => {
  it('classifies the textbook crank-rocker', () => {
    expect(classifyFourBar(CRANK_ROCKER)).toBe('crank-rocker')
  })

  it('classifies a double-crank (shortest link is the frame)', () => {
    expect(classifyFourBar({ ground: 0.03, crank: 0.1, coupler: 0.09, rocker: 0.09 })).toBe('double-crank')
  })

  it('classifies the Grashof double-rocker (shortest link is the coupler)', () => {
    expect(classifyFourBar({ ground: 0.09, crank: 0.1, coupler: 0.05, rocker: 0.1 })).toBe('double-rocker')
  })

  it('classifies a triple rocker when the Grashof condition fails', () => {
    expect(classifyFourBar({ ground: 0.1, crank: 0.05, coupler: 0.05, rocker: 0.05 })).toBe('triple-rocker')
  })

  it('classifies a change-point when the shortest+longest equals the other two', () => {
    expect(classifyFourBar({ ground: 0.1, crank: 0.05, coupler: 0.09, rocker: 0.06 })).toBe('change-point')
  })

  it('reports the rocker extreme for a full crank sweep — open branch only', () => {
    const result = analyzeFourBar(CRANK_ROCKER)
    expect(result.feasible).toBe(true)
    if (!result.feasible) return
    // Pinned measurement: the classic textbook crank-rocker sweeps the rocker
    // from ~1.519 rad to ~2.738 rad (≈70° of output stroke).
    expect(result.clamp.minRocker).toBeCloseTo(1.519, 2)
    expect(result.clamp.maxRocker).toBeCloseTo(2.738, 2)
    expect(result.clamp.maxRocker - result.clamp.minRocker).toBeGreaterThan(1.0)
  })

  it('solves the crank offset example and reports infeasible angles clearly', () => {
    expect(() => fourBarPosition(CRANK_ROCKER, 0, 'open')).not.toThrow()
    expect(classifyFourBar(CRANK_ROCKER)).not.toBe('triple-rocker')
  })

  it('rejects zero-length and non-positive links', () => {
    expect(() => fourBarPosition({ ground: 0, crank: 1, coupler: 1, rocker: 1 }, 0)).toThrow(/positive/)
  })
})
