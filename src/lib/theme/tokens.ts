/**
 * Design tokens — the single source of truth for every colour in the product.
 *
 * Why this module exists
 * ----------------------
 * Colour used to live in `index.css` as hand-written CSS blocks. One of those
 * blocks (`.professional`) stored raw RGB triplets (`15 23 42`) instead of HSL
 * triplets, so every `hsl(var(--…))` consumer silently rendered
 * `hsl(15, 23%, 42%)` — i.e. **brown** — across the whole shell.
 *
 * Tokens are therefore declared once, here, as validated HSL triplets
 * (`"<hue> <saturation>% <lightness>%"`), and written to the document root at
 * runtime. A test suite keeps proving that:
 *
 *   1. every token is a syntactically valid HSL triplet, and
 *   2. every foreground/background pair a user actually reads meets the
 *      contrast floor required by WCAG 2.2 (4.5:1 for body text, 3:1 for
 *      large text and meaningful UI boundaries, 1.4:1 for decorative
 *      separators whose meaning is carried elsewhere).
 *
 * Nothing in the UI may hard-code a brand colour; add a token instead.
 */

/** Themes that ship today. `system` is a *preference*, not a theme. */
export type ThemeId = 'light' | 'dark' | 'high-contrast'

/** What the user picked in Settings. */
export type ThemePreference = ThemeId | 'system'

export const THEME_IDS: readonly ThemeId[] = ['light', 'dark', 'high-contrast']
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark', 'high-contrast']

/**
 * Flat map of CSS custom property name → HSL triplet.
 * Keys are the `--token` names; values never include the `hsl()` wrapper so
 * that Tailwind's `<alpha-value>` syntax (`bg-card/80`) keeps working.
 */
export type ThemeTokens = Readonly<Record<string, string>>

/* ────────────────────────────────────────────────────────────────────────────
 * Light — the default. Optimised for long editing sessions on a bright screen:
 * pure white "paper" for the schematic sheet, a barely-there tint for chrome.
 * ──────────────────────────────────────────────────────────────────────────── */
const light: ThemeTokens = {
  // Surfaces
  '--background': '0 0% 100%',
  '--foreground': '222 47% 11%',
  '--surface': '210 24% 97%',
  '--surface-foreground': '222 47% 11%',
  '--card': '0 0% 100%',
  '--card-foreground': '222 47% 11%',
  '--popover': '0 0% 100%',
  '--popover-foreground': '222 47% 11%',

  // Neutrals
  '--muted': '210 24% 95%',
  '--muted-foreground': '215 20% 38%',
  '--accent': '210 30% 93%',
  '--accent-foreground': '222 47% 11%',
  '--secondary': '210 30% 94%',
  '--secondary-foreground': '222 47% 11%',

  // Brand + status
  '--primary': '222 78% 42%',
  '--primary-foreground': '210 40% 99%',
  '--destructive': '0 72% 42%',
  '--destructive-foreground': '0 0% 100%',
  '--success': '152 72% 27%',
  '--success-foreground': '0 0% 100%',
  '--warning': '32 88% 32%',
  '--warning-foreground': '0 0% 100%',
  '--info': '199 92% 30%',
  '--info-foreground': '0 0% 100%',

  // Lines
  '--border': '214 20% 82%',
  '--input': '214 20% 82%',
  '--ring': '222 78% 42%',

  // Editor sheet (kept deliberately distinct from app chrome)
  '--canvas': '0 0% 100%',
  '--canvas-foreground': '222 47% 11%',
  '--surface-variant': '210 24% 93%',
  '--surface-variant-foreground': '222 47% 11%',
  '--grid': '214 32% 90%',
  '--grid-major': '214 28% 76%',
  '--wire': '221 83% 40%',
  '--bus': '271 70% 38%',
  '--symbol': '222 45% 22%',
  '--symbol-fill': '214 40% 85%',
  '--symbol-outline': '220 30% 32%',
  '--symbol-selected-fill': '213 80% 88%',
  '--pin': '24 96% 42%',
  '--pin-ring': '24 90% 30%',
  '--junction': '222 78% 38%',
  '--selection': '217 91% 42%',
  '--hover': '213 90% 42%',
  '--net-label': '222 47% 20%',
  '--reference-label': '215 20% 38%',
  '--value-label': '215 20% 38%',
  '--canvas-error': '0 72% 42%',
  '--canvas-warning': '32 88% 34%',

  // Effects
  '--overlay': '222 47% 11%',
  '--overlay-foreground': '0 0% 100%',
  '--shadow-color': '222 47% 11%',

  /*
   * Chart series. Six hues with similar perceived lightness so no single trace
   * dominates a plot, and a minimum separation of ~40° so colour-blind readers
   * can still distinguish adjacent traces by hue or lightness.
   */
  '--chart-1': '222 78% 42%',
  '--chart-2': '160 84% 26%',
  '--chart-3': '30 92% 36%',
  '--chart-4': '275 62% 44%',
  '--chart-5': '196 90% 30%',
  '--chart-6': '340 74% 40%',
}

/* ────────────────────────────────────────────────────────────────────────────
 * Dark — opt-in. Layered, low-glare neutrals with a *darker* editor sheet so the
 * canvas reads as recessed relative to the chrome (classic EDA chiaroscuro).
 * Every foreground was chosen against the surface it is actually painted on,
 * never against a mid-grey average.
 * ──────────────────────────────────────────────────────────────────────────── */
const dark: ThemeTokens = {
  // Surfaces
  '--background': '222 44% 7%',
  '--foreground': '210 40% 96%',
  '--surface': '222 38% 11%',
  '--surface-foreground': '210 40% 96%',
  '--card': '222 36% 13%',
  '--card-foreground': '210 40% 96%',
  '--popover': '222 38% 12%',
  '--popover-foreground': '210 40% 96%',

  // Neutrals
  '--muted': '218 30% 19%',
  '--muted-foreground': '215 24% 74%',
  '--accent': '217 34% 23%',
  '--accent-foreground': '210 40% 98%',
  '--secondary': '218 30% 21%',
  '--secondary-foreground': '210 40% 96%',

  // Brand + status (light enough to be legible as *text* on the dark shell)
  '--primary': '213 94% 71%',
  '--primary-foreground': '222 44% 8%',
  '--destructive': '0 94% 76%',
  '--destructive-foreground': '0 60% 11%',
  '--success': '150 68% 66%',
  '--success-foreground': '155 60% 8%',
  '--warning': '38 96% 70%',
  '--warning-foreground': '30 62% 10%',
  '--info': '190 90% 70%',
  '--info-foreground': '195 60% 9%',

  // Lines
  '--border': '217 26% 24%',
  '--input': '217 26% 26%',
  '--ring': '213 94% 71%',

  // Editor sheet — one step darker than `--background`
  '--canvas': '222 47% 4%',
  '--canvas-foreground': '210 40% 96%',
  '--grid': '217 30% 15%',
  '--grid-major': '217 24% 27%',
  '--surface-variant': '215 28% 16%',
  '--surface-variant-foreground': '210 40% 96%',
  '--wire': '142 66% 56%',
  '--symbol-fill': '217 34% 24%',
  '--symbol-outline': '214 32% 74%',
  '--symbol-selected-fill': '217 62% 34%',
  '--pin-ring': '36 100% 70%',
  '--bus': '271 88% 76%',
  '--symbol': '210 36% 90%',
  '--pin': '32 95% 56%',
  '--junction': '213 94% 74%',
  '--selection': '213 94% 74%',
  '--hover': '199 89% 56%',
  '--net-label': '210 36% 92%',
  '--reference-label': '215 24% 74%',
  '--value-label': '215 24% 74%',
  '--canvas-error': '0 94% 76%',
  '--canvas-warning': '38 96% 72%',

  // Effects
  '--overlay': '0 0% 0%',
  '--overlay-foreground': '0 0% 98%',
  '--shadow-color': '0 0% 0%',

  /* Chart series: same hue order, lifted in lightness for a dark sheet. */
  '--chart-1': '213 94% 71%',
  '--chart-2': '158 70% 62%',
  '--chart-3': '35 96% 66%',
  '--chart-4': '271 88% 78%',
  '--chart-5': '190 90% 68%',
  '--chart-6': '338 86% 74%',
}

/* ────────────────────────────────────────────────────────────────────────────
 * High contrast — WCAG 2.2 AAA (7:1) for body copy on every surface. Intended
 * for accessibility profiles, low-quality panels, and bright sunlight.
 * ──────────────────────────────────────────────────────────────────────────── */
const highContrast: ThemeTokens = {
  '--background': '0 0% 0%',
  '--foreground': '0 0% 100%',
  '--surface': '0 0% 10%',
  '--surface-foreground': '0 0% 100%',
  '--card': '0 0% 10%',
  '--card-foreground': '0 0% 100%',
  '--popover': '0 0% 10%',
  '--popover-foreground': '0 0% 100%',

  '--muted': '0 0% 18%',
  '--muted-foreground': '0 0% 93%',
  '--accent': '0 0% 24%',
  '--accent-foreground': '0 0% 100%',
  '--secondary': '0 0% 24%',
  '--secondary-foreground': '0 0% 100%',

  '--primary': '54 100% 62%',
  '--primary-foreground': '0 0% 0%',
  '--destructive': '0 100% 76%',
  '--destructive-foreground': '0 0% 0%',
  '--success': '140 90% 70%',
  '--success-foreground': '0 0% 0%',
  '--warning': '45 100% 68%',
  '--warning-foreground': '0 0% 0%',
  '--info': '190 100% 72%',
  '--info-foreground': '0 0% 0%',

  '--border': '0 0% 55%',
  '--input': '0 0% 62%',
  '--ring': '54 100% 62%',

  '--canvas': '0 0% 0%',
  '--surface-variant': '0 0% 14%',
  '--surface-variant-foreground': '0 0% 100%',
  '--canvas-foreground': '0 0% 100%',
  '--grid': '0 0% 32%',
  '--grid-major': '0 0% 55%',
  '--wire': '120 100% 71%',
  '--bus': '275 100% 82%',
  '--symbol': '0 0% 100%',
  '--symbol-fill': '0 0% 22%',
  '--symbol-outline': '0 0% 82%',
  '--symbol-selected-fill': '54 100% 30%',
  '--pin': '45 100% 60%',
  '--pin-ring': '45 100% 76%',
  '--junction': '54 100% 68%',
  '--selection': '54 100% 68%',
  '--hover': '180 100% 76%',
  '--net-label': '0 0% 100%',
  '--reference-label': '0 0% 93%',
  '--value-label': '0 0% 93%',
  '--canvas-error': '0 100% 78%',
  '--canvas-warning': '45 100% 72%',

  '--overlay': '0 0% 0%',
  '--overlay-foreground': '0 0% 100%',
  '--shadow-color': '0 0% 0%',

  /* Chart series: maximum separation for the accessibility profile. */
  '--chart-1': '54 100% 62%',
  '--chart-2': '140 90% 70%',
  '--chart-3': '24 100% 68%',
  '--chart-4': '275 100% 82%',
  '--chart-5': '190 100% 72%',
  '--chart-6': '330 100% 78%',
}

export const THEMES: Readonly<Record<ThemeId, ThemeTokens>> = {
  light,
  dark,
  'high-contrast': highContrast,
}

/** Presentation metadata for theme pickers. */
export interface ThemeDescriptor {
  id: ThemePreference
  label: string
  description: string
  /** True when the theme paints light text on dark surfaces. */
  isDark: boolean
}

export const THEME_DESCRIPTORS: readonly ThemeDescriptor[] = [
  { id: 'system', label: 'System', description: 'Follow the operating system appearance.', isDark: false },
  { id: 'light', label: 'Light', description: 'Bright paper-white editor for daylight work.', isDark: false },
  { id: 'dark', label: 'Dark', description: 'Recessed, low-glare shell for long sessions.', isDark: true },
  { id: 'high-contrast', label: 'High contrast', description: 'AAA contrast for accessibility profiles.', isDark: true },
]

/** Every CSS custom property the runtime guarantees to write. */
export const TOKEN_NAMES: readonly string[] = Object.freeze(
  Array.from(new Set(THEME_IDS.flatMap((id) => Object.keys(THEMES[id])))).sort(),
)

/** Ordered chart-series token names, e.g. for plot traces. */
export const CHART_TOKEN_NAMES: readonly string[] = Object.freeze([
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
])

/**
 * Literal `hsl(...)` strings for plot traces in `themeId`.
 *
 * Charting libraries set colours as SVG presentation attributes, where `var()`
 * is not reliably resolved, so panels need concrete values. Reading them from the
 * token table (rather than a hard-coded palette) is what keeps traces legible in
 * every theme.
 */
export function chartSeriesColors(themeId: ThemeId): string[] {
  const tokens = THEMES[themeId]
  return CHART_TOKEN_NAMES.map((token) => `hsl(${tokens[token]})`)
}

/** Human label for a preference, e.g. for the status bar and tooltips. */
export function describeTheme(preference: ThemePreference, resolved: ThemeId): string {
  if (preference === 'system') {
    return resolved === 'light' ? 'System (light)' : resolved === 'dark' ? 'System (dark)' : 'System (high contrast)'
  }
  return THEME_DESCRIPTORS.find((descriptor) => descriptor.id === preference)?.label ?? preference
}

/* ────────────────────────────────────────────────────────────────────────────
 * Validation & colour maths (pure, dependency-free, unit-tested)
 * ──────────────────────────────────────────────────────────────────────────── */

const HSL_TRIPLET = /^(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/

/** True when `value` is a `"H S% L%"` triplet `hsl()` can consume. */
export function isHslTriplet(value: string): boolean {
  const match = HSL_TRIPLET.exec(value.trim())
  if (!match) return false
  const [, hue, saturation, lightness] = match
  return Number(hue) <= 360 && Number(saturation) <= 100 && Number(lightness) <= 100
}

/**
 * Guards against the exact regression that produced the brown theme: a token
 * that happens to be a bare RGB triplet is still accepted by `hsl()` and
 * silently renders the wrong colour.
 */
export function assertValidTheme(id: ThemeId, tokens: ThemeTokens): void {
  for (const [name, value] of Object.entries(tokens)) {
    if (!isHslTriplet(value)) {
      throw new Error(
        `Theme "${id}" has an invalid token ${name}="${value}". ` +
          'Tokens must be HSL triplets such as "222 44% 7%"; bare RGB triplets render as brown.',
      )
    }
  }
}

export interface Rgb {
  r: number
  g: number
  b: number
}

/** Convert a `"H S% L%"` triplet to 0-255 sRGB components. */
export function hslTripletToRgb(triplet: string): Rgb {
  const match = HSL_TRIPLET.exec(triplet.trim())
  if (!match) throw new Error(`Not a valid HSL triplet: "${triplet}"`)
  const hue = Number(match[1]) / 360
  const saturation = Number(match[2]) / 100
  const lightness = Number(match[3]) / 100

  if (saturation === 0) {
    const channel = Math.round(lightness * 255)
    return { r: channel, g: channel, b: channel }
  }

  const q = lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  const channel = (offset: number): number => {
    let t = hue + offset
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  return {
    r: Math.round(channel(1 / 3) * 255),
    g: Math.round(channel(0) * 255),
    b: Math.round(channel(-1 / 3) * 255),
  }
}

/** sRGB triplet → hex string, e.g. `#0a0f18`. Used by the pre-paint script. */
export function rgbToHex({ r, g, b }: Rgb): string {
  const toHex = (channel: number): string => channel.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const linearise = (channel: number): number => {
    const ratio = channel / 255
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b)
}

/** WCAG 2.2 contrast ratio between two HSL triplets (order-independent). */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(hslTripletToRgb(foreground))
  const b = relativeLuminance(hslTripletToRgb(background))
  const lighter = Math.max(a, b)
  const darker = Math.min(a, b)
  return (lighter + 0.05) / (darker + 0.05)
}

/* ────────────────────────────────────────────────────────────────────────────
 * Contrast contract
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ContrastRequirement {
  /** Text token. */
  foreground: string
  /** Surface token the text is painted on. */
  background: string
  /** Minimum ratio. 4.5 = body copy, 3 = large text / UI boundary, 7 = AAA. */
  min: number
  /** Shown in failure output so the fix is obvious. */
  rationale: string
}

const BODY = 4.5
const UI = 3
const SEPARATOR = 1.4

/**
 * The pairs a user genuinely reads. `theme.test.ts` asserts all of them, so a
 * future token edit cannot silently ship an unreadable combination.
 */
export const CONTRAST_CONTRACT: readonly ContrastRequirement[] = [
  { foreground: '--foreground', background: '--background', min: BODY, rationale: 'Body copy on the app background' },
  { foreground: '--foreground', background: '--surface', min: BODY, rationale: 'Body copy on toolbars and panel headers' },
  { foreground: '--card-foreground', background: '--card', min: BODY, rationale: 'Body copy inside cards' },
  { foreground: '--popover-foreground', background: '--popover', min: BODY, rationale: 'Body copy inside popovers and menus' },
  { foreground: '--muted-foreground', background: '--background', min: BODY, rationale: 'Secondary copy on the app background' },
  { foreground: '--muted-foreground', background: '--card', min: BODY, rationale: 'Secondary copy inside cards' },
  { foreground: '--muted-foreground', background: '--muted', min: BODY, rationale: 'Secondary copy on muted chips' },
  { foreground: '--accent-foreground', background: '--accent', min: BODY, rationale: 'Hover/selected labels' },
  { foreground: '--secondary-foreground', background: '--secondary', min: BODY, rationale: 'Secondary buttons' },
  { foreground: '--primary-foreground', background: '--primary', min: BODY, rationale: 'Primary button label' },
  { foreground: '--destructive-foreground', background: '--destructive', min: BODY, rationale: 'Destructive button label' },
  { foreground: '--success-foreground', background: '--success', min: BODY, rationale: 'Success badge label' },
  { foreground: '--warning-foreground', background: '--warning', min: BODY, rationale: 'Warning badge label' },
  { foreground: '--info-foreground', background: '--info', min: BODY, rationale: 'Info badge label' },
  { foreground: '--primary', background: '--background', min: UI, rationale: 'Primary used as text/icon on the shell' },
  { foreground: '--primary', background: '--card', min: UI, rationale: 'Primary used as text/icon inside cards' },
  { foreground: '--destructive', background: '--background', min: UI, rationale: 'Destructive used as text/icon' },
  { foreground: '--success', background: '--background', min: UI, rationale: 'Success used as text/icon' },
  { foreground: '--warning', background: '--background', min: UI, rationale: 'Warning used as text/icon' },
  { foreground: '--info', background: '--background', min: UI, rationale: 'Info used as text/icon' },
  { foreground: '--canvas-foreground', background: '--canvas', min: BODY, rationale: 'Editor content on the schematic sheet' },
  { foreground: '--wire', background: '--canvas', min: UI, rationale: 'Wire stroke on the sheet' },
  { foreground: '--symbol', background: '--canvas', min: UI, rationale: 'Symbol outline on the sheet' },
  { foreground: '--symbol-outline', background: '--canvas', min: UI, rationale: 'Symbol body edge on the sheet' },
  { foreground: '--symbol-fill', background: '--canvas', min: SEPARATOR, rationale: 'Symbol body fill separates from the sheet' },
  { foreground: '--pin-ring', background: '--canvas', min: UI, rationale: 'Pin ring on the sheet' },
  { foreground: '--pin', background: '--canvas', min: UI, rationale: 'Pin marker on the sheet' },
  { foreground: '--junction', background: '--canvas', min: UI, rationale: 'Junction dot on the sheet' },
  { foreground: '--selection', background: '--canvas', min: UI, rationale: 'Selection marquee on the sheet' },
  { foreground: '--net-label', background: '--canvas', min: BODY, rationale: 'Net name label' },
  { foreground: '--reference-label', background: '--canvas', min: BODY, rationale: 'Reference designator label' },
  { foreground: '--overlay-foreground', background: '--overlay', min: BODY, rationale: 'HUD text on a scrim' },
  { foreground: '--ring', background: '--background', min: UI, rationale: 'Focus ring (WCAG 2.2 §1.4.11)' },
  { foreground: '--border', background: '--background', min: SEPARATOR, rationale: 'Panel separator must be visible' },
  { foreground: '--border', background: '--card', min: SEPARATOR, rationale: 'Card separator must be visible' },
  // Every chart trace must be distinguishable from the plot background.
  ...CHART_TOKEN_NAMES.map((token) => ({
    foreground: token,
    background: '--canvas',
    min: UI,
    rationale: `${token} trace on a plot`,
  })),
]

/** Every contract violation for `themeId`, as human-readable messages. */
export function findContrastViolations(themeId: ThemeId): string[] {
  const tokens = THEMES[themeId]
  const violations: string[] = []
  for (const requirement of CONTRAST_CONTRACT) {
    const foreground = tokens[requirement.foreground]
    const background = tokens[requirement.background]
    if (!foreground || !background) {
      violations.push(`${themeId}: ${requirement.foreground} or ${requirement.background} is not defined`)
      continue
    }
    const ratio = contrastRatio(foreground, background)
    if (ratio + 1e-9 < requirement.min) {
      violations.push(
        `${themeId}: ${requirement.foreground} on ${requirement.background} is ${ratio.toFixed(2)}:1, ` +
          `needs >= ${requirement.min}:1 — ${requirement.rationale}`,
      )
    }
  }
  return violations
}
