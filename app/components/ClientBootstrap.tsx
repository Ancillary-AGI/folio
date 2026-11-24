'use client'

/**
 * Runs the bits that need a browser, once, after hydration: the persisted theme
 * bootstrap (full token set) and the legacy `/#/` URL normaliser. Kept out of
 * the server layout on purpose — the pre-paint background is handled by
 * /theme-bootstrap.js, so a late token apply is invisible to the user.
 */
import { useEffect } from 'react'
import { bootstrapTheme } from '../../src/lib/theme/useTheme'
import { readPersistedThemePreference } from '../../src/lib/theme/themeController'
import { normalizeLegacyUrl } from '../../src/stores/routing'

export default function ClientBootstrap() {
  useEffect(() => {
    bootstrapTheme(readPersistedThemePreference())
    normalizeLegacyUrl()
  }, [])
  return null
}
