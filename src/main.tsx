import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { bootstrapTheme } from './lib/theme/useTheme';
import { readPersistedThemePreference } from './lib/theme/themeController';
import { normalizeLegacyUrl } from './stores/routing';

/*
 * Apply the persisted theme before the first paint. Without this a dark session
 * renders one white frame on refresh — the classic theme flash.
 */
bootstrapTheme(readPersistedThemePreference());

/* Old `/#/…` bookmarks resolve once, before the router reads the location. */
normalizeLegacyUrl();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
