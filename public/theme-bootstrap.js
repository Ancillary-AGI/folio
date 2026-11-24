/*
 * Pre-paint theme bootstrap.
 *
 * The React shell applies the full token set after hydration, but that runs
 * after the bundle is parsed. This tiny script only needs to stop the white
 * flash, so it sets `color-scheme` and the two possible background colours and
 * nothing else. The hex literals must equal `THEMES['folio-dark']['--background']`
 * and `THEMES.light['--background']` in src/lib/theme/tokens.ts.
 *
 * Loaded once from the Next root layout. `data-theme-default` selects the
 * fallback (folio-dark), and the stored preference still wins for returning
 * users. `theme.test.ts` pins the literals below, so edit them together with
 * the tokens.
 */
(function () {
  var key = 'circuit-cad-app-store';
  var script = document.currentScript;
  var defaultTheme =
    (script && script.getAttribute('data-theme-default')) || 'folio-dark';
  var preference = defaultTheme;
  try {
    var raw = localStorage.getItem(key);
    if (raw) {
      var parsed = JSON.parse(raw);
      var stored = parsed && parsed.state && parsed.state.settings && parsed.state.settings.theme;
      if (stored) preference = stored;
    }
  } catch (error) {
    /* storage disabled — use the document's default */
  }
  var prefersDark = false;
  var prefersContrast = false;
  try {
    prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    prefersContrast = window.matchMedia('(prefers-contrast: more)').matches;
  } catch (error) {
    /* no matchMedia — explicit preference remains the document default */
  }
  var theme =
    preference === 'system'
      ? prefersContrast
        ? 'high-contrast'
        : prefersDark
          ? defaultTheme
          : 'light'
      : preference;
  var isDark = theme !== 'light';
  var root = document.documentElement;
  root.dataset.theme = theme;
  if (isDark) root.classList.add('dark');
  root.style.colorScheme = isDark ? 'dark' : 'light';
  /* Exact THEMES[*]['--background'] tokens from src/lib/theme/tokens.ts:
     light #ffffff, dark #0a0f1a, folio-dark #07080d, professional (spreads dark) #0a0f1a, high-contrast #000000.
     theme.test.ts pins every one of these literals. */
  var backgrounds = {
    'light': '#ffffff',
    'dark': '#0a0f1a',
    'folio-dark': '#07080d',
    'professional': '#0a0f1a',
    'high-contrast': '#000000',
  };
  root.style.backgroundColor = backgrounds[theme] || backgrounds[defaultTheme] || '#07080d';
})();
