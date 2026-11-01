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
  DEFAULT_THEME_PREFERENCE,
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

  it('keeps Professional visually distinct from Dark', () => {
    expect(THEMES.professional).not.toEqual(THEMES.dark)
    expect(describeTheme('professional', 'dark')).toBe('Professional')
    expect(isDarkTheme('professional')).toBe(true)
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

describe('shell geometry', () => {
  /*
   * The design system scales every corner from one number and every shadow from
   * one hue, both declared in `index.css` rather than `tokens.ts` because neither
   * is a colour. `var(--radius)` with no definition is the failure mode this
   * pins: the CSS still parses, Tailwind still emits, and the entire product
   * silently renders with square corners.
   */
  const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8')
  const tailwind = readFileSync(resolve(process.cwd(), 'tailwind.config.js'), 'utf8')

  it('defines the radius step that the border-radius scale reads', () => {
    expect(css).toMatch(/--radius:\s*\d*\.?\d+rem/)
    const scale = tailwind.match(/borderRadius:\s*\{([^}]*)\}/)
    expect(scale, 'tailwind must override the borderRadius scale').not.toBeNull()
    for (const step of ['sm', 'md', 'lg', 'xl', '2xl']) {
      const rule = scale![1].match(new RegExp(`'?"?${step}"?:\\s*"([^"]+)"`))
      expect(rule, `borderRadius.${step} is missing`).not.toBeNull()
      expect(rule![1], `borderRadius.${step} must derive from --radius`).toContain('var(--radius)')
    }
  })

  it('paints elevation from the shadow token, not a fixed black', () => {
    const levels = tailwind.match(/boxShadow:\s*\{([\s\S]*?)\n\s{6}\},/)
    expect(levels, 'tailwind must override the boxShadow scale').not.toBeNull()
    const body = levels![1]
    // Six levels, each depth stop drawn from the verified `--shadow-color`.
    expect(body.match(/var\(--shadow-color\)/g)?.length).toBeGreaterThanOrEqual(12)
    expect(body).toContain('var(--panel-edge)')
    expect(body).not.toMatch(/rgb\(|#[0-9a-f]{3,6}/i)
  })

  it('lets an accessibility appearance switch the decoration off', () => {
    expect(css).toMatch(/--panel-edge:\s*0\.0\d+/)
    expect(css).toMatch(/--control-glow:\s*0\.4/)
    const highContrast = css.match(/\[data-theme='high-contrast'\]\s*\{[^}]*\}/)
    expect(highContrast, 'high contrast must override the decorative alphas').not.toBeNull()
    expect(highContrast![0]).toMatch(/--panel-edge:\s*0;/)
    expect(highContrast![0]).toMatch(/--control-glow:\s*0;/)
    // Focus indicators are not decoration and stay untouched by either alpha.
    expect(css).toMatch(/:focus-visible\s*\{[^}]*ring-ring/)
  })

  /*
   * A control that already draws a border must not get a second ring painted
   * outside it. `ring-offset-*` is exactly that: a seam of page background
   * between the element's own edge and the focus ring, which reads as a double
   * border. It recurs because every stock field primitive ships with one, so
   * this pins both halves — the contract in the base layer, and the absence of
   * the override in the primitives that used to carry it.
   */
  it('gives a bordered control one focus edge instead of two', () => {
    const singleEdge = css.match(/input:focus-visible,[^}]*\}/)
    expect(singleEdge, 'the base layer must carry the one-edge focus contract').not.toBeNull()
    expect(singleEdge![0]).toContain('var(--focus-halo)')
    expect(singleEdge![0]).toContain('border-color: hsl(var(--ring))')
    expect(singleEdge![0]).not.toMatch(/ring-offset/)

    for (const file of [
      'src/components/ui/input.tsx',
      'src/components/ui/select.tsx',
      'src/components/AuthForm.tsx',
      'src/components/ProjectManager.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(source, `${file} must not paint an offset ring outside its own border`).not.toMatch(
        /ring-offset-\d/,
      )
    }
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
    expect(normalizeThemePreference('professional')).toBe('professional')
    expect(normalizeThemePreference('solarized')).toBe('dark')
    expect(normalizeThemePreference('high-contrast')).toBe('high-contrast')
    expect(normalizeThemePreference('light')).toBe('light')
    expect(normalizeThemePreference(undefined)).toBe('dark')
    expect(normalizeThemePreference(42)).toBe('dark')
    expect(DEFAULT_THEME_PREFERENCE).toBe('dark')
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
    const lightBg = hslTripletToRgb(THEMES.light['--background'])
    expect(root.style.backgroundColor).toBe(`rgb(${lightBg.r}, ${lightBg.g}, ${lightBg.b})`)
    expect(root.classList.contains('dark')).toBe(false)

    clearTheme(root)
    expect(root.style.getPropertyValue('--background')).toBe('')
    expect(root.style.backgroundColor).toBe('')
    expect(root.dataset['theme']).toBeUndefined()
  })
})
