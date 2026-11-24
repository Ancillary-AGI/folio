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

  it('keeps Folio Dark visually distinct from Dark and Professional', () => {
    expect(THEMES['folio-dark']).not.toEqual(THEMES.dark)
    expect(THEMES['folio-dark']).not.toEqual(THEMES.professional)
    expect(isDarkTheme('folio-dark')).toBe(true)
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
   * one hue, both declared in `app/globals.css` rather than `tokens.ts` because neither
   * is a colour. `var(--radius)` with no definition is the failure mode this
   * pins: the CSS still parses, Tailwind still emits, and the entire product
   * silently renders with square corners.
   */
  const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8')
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
    expect(highContrast![0]).toMatch(/--control-depth:\s*0;/)
    // The shading on a filled button's face is decoration too, and the sheet
    // that hands colour to the OS has no business keeping it.
    const forced = css.match(/@media \(forced-colors: active\)[\s\S]*?\{[\s\S]*?:root\s*\{[^}]*\}/)
    expect(forced, 'forced colours must override the decorative alphas').not.toBeNull()
    expect(forced![0]).toMatch(/--control-depth:\s*0;/)
    // Focus indicators are not decoration and stay untouched by either alpha.
    expect(css).toMatch(/:focus-visible\s*\{[^}]*ring-ring/)
  })

  /*
   * A control that already draws a border must not get a second ring painted
   * outside it. `ring-offset-*` is exactly that: a seam of page background
   * between the element's own edge and the focus ring, which reads as a double
   * border. It recurs because every stock field primitive ships with one, so
   * this pins both halves — the contract itself, and the absence of the offset
   * ring in the primitives that used to carry it.
   *
   * WHERE the contract lives is the part that was got wrong once: written in
   * `@layer base` it loses to the panel's own `border-border` utility, which
   * lives in the utilities layer, and a layer always beats specificity. The
   * field then keeps its grey edge and grows the accent halo outside it — the
   * double border, wearing a different hat. So this pins the layer too.
   */
  it('gives a bordered control one focus edge instead of two', () => {
    const singleEdge = css.match(/input:not\(\[type='range'\]\):focus-visible,[^}]*\}/)
    expect(singleEdge, 'the one-edge focus contract must exist').not.toBeNull()
    expect(singleEdge![0]).toContain('var(--focus-halo)')
    expect(singleEdge![0]).toContain('border-color: hsl(var(--ring))')
    expect(singleEdge![0]).not.toMatch(/ring-offset/)

    const utilitiesAt = css.indexOf('@layer utilities {')
    const forcedColoursAt = css.indexOf('@layer base {', utilitiesAt)
    expect(utilitiesAt, 'expected a @layer utilities block').toBeGreaterThan(-1)
    expect(
      singleEdge!.index,
      'the focus contract must sit in @layer utilities, where it outranks a field border utility'
    ).toBeGreaterThan(utilitiesAt)
    expect(
      singleEdge!.index,
      'the focus contract must not be buried in the forced-colours sheet'
    ).toBeLessThan(forcedColoursAt)

    for (const file of [
      'src/components/ui/input.tsx',
      'src/components/ui/select.tsx',
      'src/components/ui/tabs.tsx',
      'src/components/ui/checkbox.tsx',
      'src/components/ui/badge.tsx',
      'src/components/AuthForm.tsx',
      'src/components/ProjectManager.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(source, `${file} must not paint an offset ring outside its own border`).not.toMatch(
        /ring-offset-\d/,
      )
    }
  })

  /*
   * A search field is a pill: the icon, the bare `bg-transparent` input and the
   * key chip are one control, and the pill is the box the engineer sees. The
   * contract above rings *any* input, so inside a pill it painted a bluish
   * outline on the text box while the pill's grey border stayed put — two edges,
   * with the narrower one drawn around the wrong box. `.cad-search` moves the
   * edge onto the pill and silences the input inside it.
   */
  it('rings the search pill, not the input inside it', () => {
    const pill = css.match(/\.cad-search:focus-within\s*\{[^}]*\}/)
    expect(pill, 'the search pill must own the focus edge').not.toBeNull()
    expect(pill![0]).toContain('border-color: hsl(var(--ring))')
    expect(pill![0]).toContain('var(--focus-halo)')

    const inner = css.match(/\.cad-search input:focus-visible,[^}]*\}/)
    expect(inner, 'the input inside a pill must paint no edge of its own').not.toBeNull()
    expect(inner![0]).toContain('box-shadow: none')

    expect(
      pill!.index,
      'the pill rule must come after the bare-input rule: equal specificity, so order decides'
    ).toBeGreaterThan(css.search(/input:not\(\[type='range'\]\):focus-visible/))

    for (const file of [
      'src/components/workspace/CommandPalette.tsx',
      'src/components/workspace/DemoGallery.tsx',
      'src/components/workspace/LimitsDialog.tsx',
      'src/components/help/HelpCenter.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8')
      expect(source, `${file} must mark its search pill with .cad-search`).toContain('cad-search')
    }
  })
})

describe('pre-paint bootstrap', () => {
  /*
   * Every page needs five literal colours to avoid a white flash before the
   * bundle evaluates. The bootstrap is one shared external file — kept so the
   * CSP can run with `script-src 'self'` and no 'unsafe-inline'. Literals
   * drift, so this test pins them to the tokens in the file and pins each
   * document to the external reference.
   */
  const pages = ['app/layout.tsx'] as const
  const bootstrap = (): string => readFileSync(resolve(process.cwd(), 'public/theme-bootstrap.js'), 'utf8')

  it('pins every theme background the bootstrap can paint to the tokens', () => {
    const hex = (theme: keyof typeof THEMES): string => rgbToHex(hslTripletToRgb(THEMES[theme]['--background']))
    // professional spreads dark, so its background is dark's.
    const expected: Record<string, string> = {
      light: hex('light'),
      dark: hex('dark'),
      'folio-dark': hex('folio-dark'),
      professional: hex('professional'),
      'high-contrast': hex('high-contrast'),
    }
    const source = bootstrap()
    expect(source).toContain("'circuit-cad-app-store'")
    for (const [theme, literal] of Object.entries(expected)) {
      expect(source, `the bootstrap must paint ${theme} as ${literal}`).toContain(`'${literal}'`)
    }
    for (const page of pages) {
      const html = readFileSync(resolve(process.cwd(), page), 'utf8')
      expect(html, `${page} must load the shared bootstrap`).toContain('src="/theme-bootstrap.js"')
      expect(html, `${page} must not carry an inline bootstrap`).not.toContain('circuit-cad-app-store')
    }
  })

  it('reads the same storage key the app persists to', () => {
    expect(bootstrap()).toContain("'circuit-cad-app-store'")
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
    expect(normalizeThemePreference(undefined)).toBe('folio-dark')
    expect(normalizeThemePreference(42)).toBe('folio-dark')
    // The shipped default is the flagship folio-dark, not the plain dark theme.
    expect(DEFAULT_THEME_PREFERENCE).toBe('folio-dark')
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
