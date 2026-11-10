import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AMBIENT_CHROME_ALPHA,
  AMBIENT_LIFT,
  ambientExposureViolations,
  auroraBands,
  bandLumaTarget,
  channelLuma,
  withChannelLuma,
} from './aurora'
import { THEMES, hslTripletToRgb, type ThemeId } from './tokens'

const LIT_THEMES: ThemeId[] = ['light', 'dark', 'professional']
const AUDITED_TOKENS = ['--primary', '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']

describe('ambient light field', () => {
  it('retunes a hue to the luma it is asked for', () => {
    for (const theme of LIT_THEMES) {
      const baseLuma = channelLuma(hslTripletToRgb(THEMES[theme]['--background']))
      const target = bandLumaTarget(baseLuma)
      for (const token of AUDITED_TOKENS) {
        const lit = hslTripletToRgb(withChannelLuma(THEMES[theme][token], target))
        // One 8-bit channel step is as close as a 24-step bisection gets.
        expect(Math.abs(channelLuma(lit) - target)).toBeLessThan(1 / 255)
      }
    }
  })

  it('never lifts a band further than the promise', () => {
    for (const theme of LIT_THEMES) {
      const bands = auroraBands(theme, '--chart-2')
      expect(bands).not.toBeNull()
      const baseRgb = hslTripletToRgb(THEMES[theme]['--background'])
      const baseLuma = channelLuma(baseRgb)
      for (const band of bands!.bands) {
        const rgb = { r: band[0] * 255, g: band[1] * 255, b: band[2] * 255 }
        expect(Math.abs(channelLuma(rgb) - baseLuma)).toBeLessThanOrEqual(AMBIENT_LIFT + 1 / 255)
        // A band that lands on the base colour paints nothing: the field earns
        // its keep with hue, and this is the assertion that says so.
        expect(Math.max(Math.abs(rgb.r - baseRgb.r), Math.abs(rgb.g - baseRgb.g), Math.abs(rgb.b - baseRgb.b))).toBeGreaterThan(4)
      }
    }
  })

  it('stays out of the high-contrast theme entirely', () => {
    expect(auroraBands('high-contrast', '--chart-1')).toBeNull()
  })

  it('keeps every contrast pair the field can reach above its floor', () => {
    expect(LIT_THEMES.flatMap(ambientExposureViolations)).toEqual([])
  })

  it('shares one chrome alpha with the stylesheet', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
    const declared = /--chrome-ambient-alpha:\s*([^;]+);/.exec(css)
    expect(declared, 'index.css must declare --chrome-ambient-alpha').not.toBeNull()
    expect(Number(declared![1]).toFixed(2)).toBe(AMBIENT_CHROME_ALPHA.toFixed(2))
  })
})
