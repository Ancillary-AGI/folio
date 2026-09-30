import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  assertValidTheme,
  CONTRAST_CONTRACT,
  contrastRatio,
  findContrastViolations,
  hslTripletToRgb,
  isHslTriplet,
  rgbToHex,
  THEMES,
  THEME_IDS,
  THEME_PREFERENCES,
  TOKEN_NAMES,
  describeTheme,
} from './tokens'
import {
  applyTheme,
  clearTheme,
  isDarkTheme,
  normalizeThemePreference,
  resolveTheme,
} from './themeController'

describe('design tokens', () => {
  it('declares every theme with an identical token set', () => {
    for (const id of THEME_IDS) {
      const keys = Object.keys(THEMES[id]).sort()
      expect(keys, `theme "${id}" is missing tokens`).toEqual([...TOKEN_NAMES])
    }
  })

  it('uses valid HSL triplets everywhere', () => {
    for (const id of THEME_IDS) {
      expect(() => assertValidTheme(id, THEMES[id])).not.toThrow()
    }
  })

  it('rejects the RGB triplets that produced the brown theme', () => {
    expect(isHslTriplet('15 23 42')).toBe(false)
    expect(isHslTriplet('248 250 252')).toBe(false)
    expect(isHslTriplet('222 44% 7%')).toBe(true)
    expect(() => assertValidTheme('dark', { '--background': '15 23 42' })).toThrow(/brown/)
  })

  it('documents every contrast-sensitive pair', () => {
    expect(CONTRAST_CONTRACT.length).toBeGreaterThan(25)
  })
})

describe('theme contrast', () => {
  it.each(THEME_IDS)('%s meets its WCAG contract', (id) => {
    const violations = findContrastViolations(id)
    expect(violations, violations.join('\n')).toEqual([])
    expect(THEMES[id]).toBeDefined()
  })

  it('recesses the editor sheet relative to the chrome in dark, and not in light', () => {
    // Monotonic luminance proxy: higher contrast against black == brighter colour.
    const brightness = (triplet: string) => contrastRatio(triplet, '0 0% 0%')

    expect(brightness(THEMES.dark['--canvas'])).toBeLessThan(brightness(THEMES.dark['--background']))
    expect(brightness(THEMES.dark['--background'])).toBeLessThan(brightness(THEMES.dark['--card']))
    expect(brightness(THEMES.light['--canvas'])).toBeGreaterThanOrEqual(brightness(THEMES.light['--background']))

    expect(isDarkTheme('dark')).toBe(true)
    expect(isDarkTheme('high-contrast')).toBe(true)
    expect(isDarkTheme('light')).toBe(false)
  })
})

describe('colour maths', () => {
  it('converts HSL triplets to sRGB', () => {
    expect(rgbToHex(hslTripletToRgb('0 0% 100%'))).toBe('#ffffff')
    expect(rgbToHex(hslTripletToRgb('0 0% 0%'))).toBe('#000000')
    expect(rgbToHex(hslTripletToRgb('0 100% 50%'))).toBe('#ff0000')
    expect(rgbToHex(hslTripletToRgb('120 100% 50%'))).toBe('#00ff00')
    expect(rgbToHex(hslTripletToRgb('240 100% 50%'))).toBe('#0000ff')
  })

  it('computes WCAG contrast ratios', () => {
    expect(contrastRatio('0 0% 100%', '0 0% 0%')).toBeCloseTo(21, 1)
    expect(contrastRatio('0 0% 0%', '0 0% 0%')).toBeCloseTo(1, 5)
    // Order independent.
    expect(contrastRatio('0 0% 0%', '0 0% 100%')).toBeCloseTo(21, 1)
  })

  it('rejects malformed triplets loudly', () => {
    expect(() => hslTripletToRgb('not-a-colour')).toThrow(/valid HSL/)
  })
})

describe('pre-paint bootstrap', () => {
  /*
   * `index.html` needs two literal colours to avoid a white flash before the
   * bundle evaluates. Literals drift, so this test pins them to the tokens.
   */
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

  it('uses the exact dark background token for the dark first paint', () => {
    const hex = rgbToHex(hslTripletToRgb(THEMES.dark['--background']))
    expect(html).toContain(`'${hex}'`)
  })

  it('uses the exact light background token for the light first paint', () => {
    const hex = rgbToHex(hslTripletToRgb(THEMES.light['--background']))
    expect(html).toContain(`'${hex}'`)
  })

  it('reads the same storage key the app persists to', () => {
    expect(html).toContain("'circuit-cad-app-store'")
  })
})

describe('theme controller', () => {
  it('resolves the system preference from OS signals', () => {
    expect(resolveTheme('system', false, false)).toBe('light')
    expect(resolveTheme('system', true, false)).toBe('dark')
    expect(resolveTheme('system', true, true)).toBe('high-contrast')
    expect(resolveTheme('light', true, true)).toBe('light')
  })

  it('migrates retired theme names instead of leaking them into the UI', () => {
    expect(normalizeThemePreference('professional')).toBe('dark')
    expect(normalizeThemePreference('solarized')).toBe('dark')
    expect(normalizeThemePreference('high-contrast')).toBe('high-contrast')
    expect(normalizeThemePreference('light')).toBe('light')
    expect(normalizeThemePreference(undefined)).toBe('system')
    expect(normalizeThemePreference(42)).toBe('system')
  })

  it('covers every declared preference in the descriptors', () => {
    for (const preference of THEME_PREFERENCES) {
      expect(describeTheme(preference, 'dark')).toBeTruthy()
    }
  })

  it('writes and clears tokens on a document root', () => {
    const root = document.createElement('div')
    applyTheme('dark', root)
    expect(root.style.getPropertyValue('--background')).toBe(THEMES.dark['--background'])
    expect(root.dataset['theme']).toBe('dark')
    expect(root.style.colorScheme).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)

    applyTheme('light', root)
    expect(root.style.getPropertyValue('--background')).toBe(THEMES.light['--background'])
    expect(root.style.colorScheme).toBe('light')
    expect(root.classList.contains('dark')).toBe(false)

    clearTheme(root)
    expect(root.style.getPropertyValue('--background')).toBe('')
    expect(root.dataset['theme']).toBeUndefined()
  })
})
