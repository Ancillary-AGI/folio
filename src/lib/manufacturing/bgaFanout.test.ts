/**
 * BGA fanout proofs (Pi-class leg 3).
 * 0.8 mm pitch BGA: 256 balls, escape math, dog-bone vias, power to planes.
 */
import { describe, expect, it } from 'vitest'
import {
  bgaBalls,
  dogboneFanout,
  escapeTracksPerChannel,
  MICROVIA_FANOUT_RULES,
  STD_VIA_RULES,
  type BgaPackage,
} from './bgaFanout'

const soc: BgaPackage = { name: 'SOC-256', rows: 16, cols: 16, pitch: 0.8, padDiameter: 0.4 }

describe('BGA fanout', () => {
  it('generates the full ball grid centred on the origin', () => {
    const balls = bgaBalls(soc)
    expect(balls).toHaveLength(256)
    const xs = balls.map((b) => b.x)
    expect(Math.min(...xs)).toBeCloseTo(-6, 9)
    expect(Math.max(...xs)).toBeCloseTo(6, 9)
  })

  it('fans out signal balls and planes power balls with microvias', () => {
    const balls = bgaBalls(soc)
    balls[0].net = 'GND'
    balls[0].isPower = true
    balls[1].net = 'DDR_DQ0'
    balls[2].net = 'DDR_DQ1'
    const { vias, planeNets, violations } = dogboneFanout(balls, soc, MICROVIA_FANOUT_RULES)
    expect(violations).toEqual([])
    expect(planeNets).toEqual(['GND'])
    expect(vias).toHaveLength(2)
    // Dog-bone offset must put the via pad fully outside the ball pad plus the
    // clearance rule — not a via-in-pad.
    const required =
      soc.padDiameter / 2 + MICROVIA_FANOUT_RULES.minDiameter / 2 + MICROVIA_FANOUT_RULES.minPitchClearance
    for (const via of vias) {
      const ball = balls.find((b) => b.net === via.net)!
      expect(Math.hypot(via.x - ball.x, via.y - ball.y)).toBeCloseTo(required, 9)
    }
  })

  it('reports that 0.5 mm mechanical vias cannot break out a 0.8 mm-pitch BGA', () => {
    // Via edge to neighbouring ball edge would be 0.117 mm, below the 0.15 mm
    // rule. Only the four corner balls have a quadrant outside the grid; every
    // interior ball is reported instead of receiving a clearance violation.
    const balls = bgaBalls(soc).map((ball, index) => ({ ...ball, net: `N${index}` }))
    const { vias, violations } = dogboneFanout(balls, soc, STD_VIA_RULES)
    expect(vias).toHaveLength(4)
    expect(violations.join(' ')).toMatch(/252 dog-bone via\(s\) would overlap an adjacent ball/)
  })

  it('never places two vias inside the via-to-via clearance', () => {
    const balls = bgaBalls(soc).map((ball, index) => ({ ...ball, net: `N${index % 64}` }))
    const { vias } = dogboneFanout(balls, soc, MICROVIA_FANOUT_RULES)
    const keepOut = MICROVIA_FANOUT_RULES.minDiameter + MICROVIA_FANOUT_RULES.minPitchClearance
    for (let i = 0; i < vias.length; i += 1) {
      for (let j = i + 1; j < vias.length; j += 1) {
        expect(Math.hypot(vias[i].x - vias[j].x, vias[i].y - vias[j].y)).toBeGreaterThanOrEqual(keepOut)
      }
    }
  })

  it('rejects invalid package dimensions rather than generating a degenerate grid', () => {
    expect(() => bgaBalls({ ...soc, rows: 0 })).toThrow(/rows and columns/)
    expect(() => bgaBalls({ ...soc, cols: 2.5 })).toThrow(/rows and columns/)
    expect(() => bgaBalls({ ...soc, pitch: 0 })).toThrow(/pitch/)
    expect(() => bgaBalls({ ...soc, padDiameter: Number.NaN })).toThrow(/pad diameter/)
  })

  it('reports and skips vias that cannot fit at a dense pitch', () => {
    const dense: BgaPackage = { name: 'dense', rows: 3, cols: 3, pitch: 0.4, padDiameter: 0.25 }
    const balls = bgaBalls(dense).map((ball, index) => ({ ...ball, net: `N${index}` }))
    const { vias, violations } = dogboneFanout(balls, dense)
    // Only the four corner balls escape outward; the other five are reported.
    expect(vias).toHaveLength(4)
    expect(violations.join(' ')).toMatch(/5 dog-bone via\(s\) would overlap an adjacent ball/)
  })

  it('computes escape tracks between vias honestly', () => {
    // 0.8 pitch, 0.5 via: 0.3 gap cannot fit a 0.127 trace needing
    // 2×0.127 clearance — honest 0, which is why dense BGAs need
    // smaller vias. With 0.3 vias the gap is 0.5 and one track fits.
    expect(escapeTracksPerChannel(0.8, STD_VIA_RULES.minDiameter, 0.127, 0.127)).toBe(0)
    expect(escapeTracksPerChannel(0.8, 0.3, 0.127, 0.127)).toBe(1)
    expect(escapeTracksPerChannel(0.4, 0.5, 0.127, 0.127)).toBe(0)
    expect(() => escapeTracksPerChannel(0, 0.5, 0.127, 0.127)).toThrow(/pitch/)
    expect(() => escapeTracksPerChannel(0.8, 0.5, 0, 0.127)).toThrow(/trace width/)
    expect(() => escapeTracksPerChannel(0.8, 0.5, 0.127, Number.NaN)).toThrow(/spacing/)
  })

  it('skips unassigned balls instead of inventing nets', () => {
    const { vias } = dogboneFanout(bgaBalls(soc), soc)
    expect(vias).toHaveLength(0)
  })
})
