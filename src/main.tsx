import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { bootstrapTheme } from './lib/theme/useTheme';
import { readPersistedThemePreference } from './lib/theme/themeController';

/*
 * Apply the persisted theme before the first paint. Without this a dark session
 * renders one white frame on refresh — the classic theme flash.
 */
bootstrapTheme(readPersistedThemePreference());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
