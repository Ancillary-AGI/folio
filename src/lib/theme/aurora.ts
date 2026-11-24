/**
 * Colour maths for the ambient light field painted behind the shell.
 *
 * The field is additive and bounded: every band is a theme hue whose
 * gamma-encoded luma is lifted a fixed amount above the surface underneath it,
 * so a band can only ever make that surface *slightly brighter* — never darker,
 * and never by more than `AMBIENT_LIFT`. That is what makes a drifting glow safe
 * behind body copy. `aurora.test.ts` does not take the construction on faith: it
 * walks the whole alpha ramp for every hue in the palette, for every theme, and
 * re-measures every pair of the WCAG contract that the field can reach.
 */

import {
  CONTRAST_CONTRACT,
  THEMES,
  contrastOfRgb,
  hslTripletToRgb,
  type ThemeId,
  type Rgb,
} from './tokens'

/**
 * How far a band may move the brightness of the surface under it, in gamma-luma.
 * `aurora.test.ts` walks this number against every pair of the contrast
 * contract: 0.02 is the largest deviation that keeps all of them above their
 * floor in every theme, and a hue that saturated is what carries the look.
 */
export const AMBIENT_LIFT = 0.02

/**
 * Alpha the chrome bars give up to the field. The same number is declared in
 * `app/globals.css` as `--chrome-ambient-alpha`, and `aurora.test.ts` pins the two
 * together so the shader and the stylesheet cannot drift apart.
 */
export const AMBIENT_CHROME_ALPHA = 0.86

/**
 * Where the field is allowed to reach the reader. `alpha` is how much of the
 * solid surface is still painted over it: a chrome bar keeps most of its own
 * colour; on the launcher there is no surface at all and the field *is* the
 * background.
 */
export const AMBIENT_EXPOSURES: readonly { token: string; alpha: number; label: string }[] = [
  { token: '--surface', alpha: AMBIENT_CHROME_ALPHA, label: 'chrome bar over the field' },
  { token: '--background', alpha: 0, label: 'launcher, where the field is the surface' },
]

/** Every hue a band could ever wear, so the audit is over the worst one. */
const AUDITED_HUES: readonly string[] = ['--primary', '--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5']

const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const

/**
 * Luma a band wears over a surface of `baseLuma`: `AMBIENT_LIFT` brighter, or
 * the same amount dimmer when the surface has no headroom left — a near-white
 * background cannot be lifted, so a light theme is tinted rather than washed.
 */
export function bandLumaTarget(baseLuma: number): number {
  return 1 - baseLuma >= AMBIENT_LIFT
    ? baseLuma + AMBIENT_LIFT
    : Math.max(0, baseLuma - AMBIENT_LIFT)
}

/** Gamma-encoded (sRGB channel) luma — the quantity the shader blends in. */
export function channelLuma({ r, g, b }: Rgb): number {
  return (LUMA_WEIGHTS[0] * r + LUMA_WEIGHTS[1] * g + LUMA_WEIGHTS[2] * b) / 255
}

export function blendRgb(a: Rgb, b: Rgb, t: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  }
}

function withLightness(triplet: string, lightness: number): string {
  const [hue, saturation] = triplet.trim().split(/\s+/)
  return `${hue} ${saturation} ${lightness.toFixed(3)}%`
}

/**
 * `triplet`'s hue and chroma, retuned to a target gamma-luma. Bisection is
 * enough: luma rises monotonically with lightness, so there is one crossing.
 */
export function withChannelLuma(triplet: string, targetLuma: number): string {
  if (channelLuma(hslTripletToRgb(withLightness(triplet, 100))) <= targetLuma) return withLightness(triplet, 100)
  if (channelLuma(hslTripletToRgb(withLightness(triplet, 0))) >= targetLuma) return withLightness(triplet, 0)
  let low = 0
  let high = 100
  for (let step = 0; step < 24; step += 1) {
    const middle = (low + high) / 2
    if (channelLuma(hslTripletToRgb(withLightness(triplet, middle))) < targetLuma) low = middle
    else high = middle
  }
  return withLightness(triplet, (low + high) / 2)
}

/** Bands for `themeId`, as 0-1 floats for `gl.uniform3fv`. */
export interface AuroraBands {
  readonly base: readonly number[]
  readonly bands: readonly (readonly number[])[]
}

/**
 * `accentToken` is the open workspace family (`--chart-2`, …) and leads the
 * field, so the ambient hue follows the domain being drawn. `null` means paint
 * nothing: the high-contrast theme has no decorative leeway at all.
 */
export function auroraBands(theme: ThemeId, accentToken?: string): AuroraBands | null {
  if (theme === 'high-contrast') return null
  const tokens = THEMES[theme]
  const base = hslTripletToRgb(tokens['--background'])
  const target = bandLumaTarget(channelLuma(base))
  const names = [accentToken ?? '--primary', '--primary', '--chart-4']
  return {
    base: [base.r / 255, base.g / 255, base.b / 255],
    bands: names.map((name) => {
      const lit = hslTripletToRgb(withChannelLuma(tokens[name] ?? tokens['--primary'], target))
      return [lit.r / 255, lit.g / 255, lit.b / 255]
    }),
  }
}

/**
 * Worst contrast a contract pair can reach under the field: every audited hue,
 * every point on the band's alpha ramp, composited with `alpha` of the solid
 * surface left on top.
 */
export function worstAmbientContrast(
  theme: ThemeId,
  requirement: { foreground: string; background: string },
  alpha: number,
): number {
  const tokens = THEMES[theme]
  const foreground = hslTripletToRgb(tokens[requirement.foreground])
  const surface = hslTripletToRgb(tokens[requirement.background])
  const fieldBase = hslTripletToRgb(tokens['--background'])
  let worst = Number.POSITIVE_INFINITY
  for (const name of AUDITED_HUES) {
    const hue = tokens[name]
    if (typeof hue !== 'string') continue
    const lit = hslTripletToRgb(withChannelLuma(hue, bandLumaTarget(channelLuma(fieldBase))))
    for (let step = 0; step <= 10; step += 1) {
      const field = blendRgb(fieldBase, lit, step / 10)
      worst = Math.min(worst, contrastOfRgb(foreground, blendRgb(field, surface, alpha)))
    }
  }
  return worst
}

/** Every contract pair the field touches, re-audited through its exposure. */
export function ambientExposureViolations(theme: ThemeId): string[] {
  const violations: string[] = []
  for (const requirement of CONTRAST_CONTRACT) {
    for (const exposure of AMBIENT_EXPOSURES) {
      if (exposure.token !== requirement.background) continue
      const worst = worstAmbientContrast(theme, requirement, exposure.alpha)
      if (worst < requirement.min) {
        violations.push(
          `${theme}: ${requirement.foreground} on ${requirement.background} through the ${exposure.label} reaches ${worst.toFixed(2)}:1, below ${requirement.min}:1 (${requirement.rationale}).`,
        )
      }
    }
  }
  return violations
}
