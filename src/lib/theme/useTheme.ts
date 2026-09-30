/**
 * `useTheme` — React binding for the theme controller.
 *
 * Keeps three things in step:
 *   1. the user's preference (persisted in `useAppStore.settings.theme`),
 *   2. the operating system appearance/contrast, and
 *   3. the CSS custom properties actually applied to `<html>`.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useAppStore } from '../../stores/useAppStore'
import {
  applyTheme,
  isDarkTheme,
  resolveTheme,
  subscribeToSystemTheme,
  writePersistedThemePreference,
} from './themeController'
import { type ThemeId, type ThemePreference } from './tokens'

const subscribeToAppearance = (notify: () => void) => subscribeToSystemTheme(notify)

/**
 * Snapshot string so `useSyncExternalStore` only re-renders when the OS
 * actually flips appearance or contrast, not on every media query event.
 */
function readAppearanceSnapshot(): string {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light|standard'
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const moreContrast = window.matchMedia('(prefers-contrast: more)').matches
  return `${dark ? 'dark' : 'light'}|${moreContrast ? 'more' : 'standard'}`
}

function useSystemAppearance(): { prefersDark: boolean; prefersMoreContrast: boolean } {
  const snapshot = useSyncExternalStore(
    subscribeToAppearance,
    readAppearanceSnapshot,
    () => 'light|standard',
  )
  const [appearance, contrast] = snapshot.split('|')
  return { prefersDark: appearance === 'dark', prefersMoreContrast: contrast === 'more' }
}

export interface ThemeController {
  /** What the user selected, including `system`. */
  preference: ThemePreference
  /** The theme currently painting the document. */
  theme: ThemeId
  /** True when `theme` paints light text on dark surfaces. */
  isDark: boolean
  /** Update the preference; persists immediately for the next page load. */
  setPreference: (preference: ThemePreference) => void
  /** Flip between light and dark, dropping out of `system`. */
  toggle: () => void
}

export function useTheme(): ThemeController {
  const preference = useAppStore((state) => state.settings.theme)
  const animations = useAppStore((state) => state.settings.animations)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const { prefersDark, prefersMoreContrast } = useSystemAppearance()
  const theme = resolveTheme(preference, prefersDark, prefersMoreContrast)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  useEffect(() => {
    // Honour both the OS reduced-motion hint and the explicit app setting.
    if (typeof document === 'undefined') return
    const root = document.documentElement
    const reduced = !animations || window.matchMedia('(prefers-reduced-motion: reduce)').matches
    root.classList.toggle('reduce-motion', reduced)
  }, [animations])

  useEffect(() => {
    writePersistedThemePreference(preference)
  }, [preference])

  const setPreference = useCallback(
    (next: ThemePreference) => updateSettings({ theme: next }),
    [updateSettings],
  )

  const toggle = useCallback(() => {
    setPreference(isDarkTheme(theme) ? 'light' : 'dark')
  }, [setPreference, theme])

  return { preference, theme, isDark: isDarkTheme(theme), setPreference, toggle }
}

/**
 * Apply the persisted theme before React mounts so a dark session never flashes
 * a white frame. Called from `main.tsx`; kept here so it shares the resolver.
 */
export function bootstrapTheme(preference: ThemePreference): ThemeId {
  const theme = resolveTheme(preference)
  applyTheme(theme)
  return theme
}

/** Tracks whether the caller has mounted, for portals and lazy overlays. */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}
