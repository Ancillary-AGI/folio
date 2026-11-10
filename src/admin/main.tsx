import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import AdminApp from './AdminApp'
import '../index.css'
import { bootstrapTheme } from '../lib/theme/useTheme'
import { readPersistedThemePreference } from '../lib/theme/themeController'

/*
 * The operator console is its own document. It shares the design tokens and the
 * theme bootstrap with the workbench, and nothing else: no workbench store, no
 * workbench session, no route between the two.
 */
bootstrapTheme(readPersistedThemePreference())
document.title = 'Admin console · Folio'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>,
)