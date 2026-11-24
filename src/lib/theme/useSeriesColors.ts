/**
 * `useSeriesColors` — the theme's plot palette as a cycling lookup.
 *
 * Views colour a trace by its series index, and that index routinely runs past
 * the end of the palette, so the wrap lives here instead of in every caller.
 * Reading the hues from the token table is what keeps them legible in all four
 * themes; a hard-coded palette does not survive high contrast.
 */
import { useTheme } from './useTheme'
import { CHART_TOKEN_NAMES, chartColor } from './tokens'

export function useSeriesColors(): (index: number) => string {
  const { theme } = useTheme()
  return (index: number) => chartColor(theme, CHART_TOKEN_NAMES[index % CHART_TOKEN_NAMES.length])
}
