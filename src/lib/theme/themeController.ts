/**
 * Theme controller — the only place allowed to touch colour on the DOM.
 *
 * Responsibilities
 * ----------------
 * • resolve `system | light | dark | high-contrast` into a concrete `ThemeId`;
 * • write every token onto `<html>` as a CSS custom property;
 * • keep `color-scheme` in sync so native widgets (scrollbars, form controls,
 *   `autofill`) follow the theme instead of fighting it;
 * • expose the storage helpers the pre-paint script in `index.html` uses, so a
 *   refreshed dark session never flashes white.
 *
 * The controller is deliberately framework-free: React subscribes to it through
 * `useTheme`, and the pre-paint script calls the same resolver.
 */

import {
  THEMES,
  THEME_IDS,
  TOKEN_NAMES,
  type ThemeId,
  type ThemePreference,
} from './tokens'

/** Zustand persist key owned by `useAppStore`; the pre-paint script reads it too. */
export const THEME_STORAGE_KEY = 'circuit-cad-app-store'

/** Matches the OS accessibility hint: prefers-reduced-transparency style prefs. */
const DARK_QUERY = '(prefers-color-scheme: dark)'
const CONTRAST_QUERY = '(prefers-contrast: more)'

export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'system'

/** Narrow an arbitrary persisted value into a supported preference. */
export function normalizeThemePreference(value: unknown): ThemePreference {
  if (value === 'system') return 'system'
  if (typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value)) {
    return value as ThemeId
  }
  /*
   * Legacy/retired names from earlier releases. `professional` produced a brown
   * UI because its CSS triplets were RGB, not HSL — mapping it to a real theme
   * is the migration path for anyone who had it selected.
   */
  if (value === 'professional' || value === 'solarized' || value === 'midnight') return 'dark'
  if (value === 'hc' || value === 'contrast') return 'high-contrast'
  return DEFAULT_THEME_PREFERENCE
}

function matches(query: string): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia(query).matches
}

/**
 * Resolve a preference to the theme that should actually paint.
 * `system` also honours the OS "reduce contrast"/"increase contrast" hints.
 */
export function resolveTheme(preference: ThemePreference, prefersDark = matches(DARK_QUERY), prefersMoreContrast = matches(CONTRAST_QUERY)): ThemeId {
  if (preference === 'system') {
    if (prefersMoreContrast) return 'high-contrast'
    return prefersDark ? 'dark' : 'light'
  }
  return preference
}

/** True when the resolved theme paints light text on dark surfaces. */
export function isDarkTheme(theme: ThemeId): boolean {
  return theme !== 'light'
}

/** Write `theme`'s tokens onto `root`. Returns the tokens that were applied. */
export function applyTheme(theme: ThemeId, root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement) {
  if (!root) return THEMES[theme]
  const tokens = THEMES[theme]
  for (const name of TOKEN_NAMES) {
    const value = tokens[name]
    if (value === undefined) root.style.removeProperty(name)
    else root.style.setProperty(name, value)
  }
  root.dataset.theme = theme
  root.style.colorScheme = isDarkTheme(theme) ? 'dark' : 'light'
  root.classList.toggle('dark', isDarkTheme(theme))
  return tokens
}

/** Remove every managed token from `root` (used by tests and teardown). */
export function clearTheme(root: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): void {
  if (!root) return
  for (const name of TOKEN_NAMES) root.style.removeProperty(name)
  delete root.dataset.theme
  root.classList.remove('dark')
}

/** Subscribe to OS appearance/contrast changes. Returns an unsubscribe function. */
export function subscribeToSystemTheme(listener: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const queries = [window.matchMedia(DARK_QUERY), window.matchMedia(CONTRAST_QUERY)]
  for (const query of queries) query.addEventListener('change', listener)
  return () => {
    for (const query of queries) query.removeEventListener('change', listener)
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Storage helpers — shared with the inline pre-paint script in `index.html`.
 * ──────────────────────────────────────────────────────────────────────────── */

interface PersistedAppState {
  state?: { settings?: { theme?: unknown } }
}

/** Read the persisted theme preference without booting Zustand. */
export function readPersistedThemePreference(): ThemePreference {
  if (typeof localStorage === 'undefined') return DEFAULT_THEME_PREFERENCE
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (!raw) return DEFAULT_THEME_PREFERENCE
    const parsed = JSON.parse(raw) as PersistedAppState
    return normalizeThemePreference(parsed?.state?.settings?.theme)
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

/**
 * Persist the preference straight into the Zustand payload so the very next
 * page load can pre-paint the right theme, even before React mounts.
 */
export function writePersistedThemePreference(preference: ThemePreference): void {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    const parsed = raw ? (JSON.parse(raw) as PersistedAppState & Record<string, unknown>) : {}
    const state = { ...(parsed.state ?? {}) }
    const settings = { ...(state.settings ?? {}) }
    settings.theme = preference
    state.settings = settings
    parsed.state = state
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(parsed))
  } catch {
    /* Private mode or a full quota: the in-memory theme still applies. */
  }
}
