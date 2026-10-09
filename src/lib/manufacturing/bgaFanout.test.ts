/**
 * BGA fanout proofs (Pi-class leg 3).
 * 0.8 mm pitch BGA: 256 balls, escape math, dog-bone vias, power to planes.
 */
import { describe, expect, it } from 'vitest'
import { bgaBalls, dogboneFanout, escapeTracksPerChannel, STD_VIA_RULES, type BgaPackage } from './bgaFanout'

const soc: BgaPackage = { name: 'SOC-256', rows: 16, cols: 16, pitch: 0.8, padDiameter: 0.4 }

describe('BGA fanout', () => {
  it('generates the full ball grid centred on the origin', () => {
    const balls = bgaBalls(soc)
    expect(balls).toHaveLength(256)
    const xs = balls.map((b) => b.x)
    expect(Math.min(...xs)).toBeCloseTo(-6, 9)
    expect(Math.max(...xs)).toBeCloseTo(6, 9)
  })

  it('fans out signal balls and planes power balls', () => {
    const balls = bgaBalls(soc)
    balls[0].net = 'GND'
    balls[0].isPower = true
    balls[1].net = 'DDR_DQ0'
    balls[2].net = 'DDR_DQ1'
    const { vias, planeNets, violations } = dogboneFanout(balls, soc)
    expect(violations).toEqual([])
    expect(planeNets).toEqual(['GND'])
    expect(vias).toHaveLength(2)
    // Dog-bone offset must clear the ball pad.
    for (const via of vias) {
      const ball = balls.find((b) => b.net === via.net)!
      expect(Math.hypot(via.x - ball.x, via.y - ball.y)).toBeGreaterThan(0.2)
    }
  })

  it('computes escape tracks between vias honestly', () => {
    // 0.8 pitch, 0.5 via: 0.3 gap cannot fit a 0.127 trace needing
    // 2×0.127 clearance — honest 0, which is why dense BGAs need
    // smaller vias. With 0.3 vias the gap is 0.5 and one track fits.
    expect(escapeTracksPerChannel(0.8, STD_VIA_RULES.minDiameter, 0.127, 0.127)).toBe(0)
    expect(escapeTracksPerChannel(0.8, 0.3, 0.127, 0.127)).toBe(1)
    expect(escapeTracksPerChannel(0.4, 0.5, 0.127, 0.127)).toBe(0)
  })

  it('skips unassigned balls instead of inventing nets', () => {
    const { vias } = dogboneFanout(bgaBalls(soc), soc)
    expect(vias).toHaveLength(0)
  })
})
