import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import ConsoleApp from './ConsoleApp'
import '../index.css'
import { bootstrapTheme } from '../lib/theme/useTheme'
import { readPersistedThemePreference } from '../lib/theme/themeController'

/*
 * The user console is its own document. It shares the design tokens and the
 * theme bootstrap with the workbench, and nothing else: no workbench store, no
 * workbench session. It reads the small device-local stores it exists to
 * report on (profiles, usage, quota policy) directly.
 */
bootstrapTheme(readPersistedThemePreference())
document.title = 'Console — Folio'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConsoleApp />
  </StrictMode>,
)
