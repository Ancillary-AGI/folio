/**
 * One hue per workspace family.
 *
 * Chart tokens already carry a contrast contract against the editor surface and
 * are retuned for every theme, so the same names read correctly in light, dark
 * and professional without a second palette. Colour is decorative here — the
 * family label is always written next to it.
 */
import type { WorkspaceGroupId } from './modes'

export const GROUP_ACCENT_TOKENS: Readonly<Record<WorkspaceGroupId, string>> = {
  design: '--chart-1',
  electrical: '--chart-2',
  mechanical: '--chart-3',
  life: '--chart-5',
  ops: '--chart-4',
}

/** `var(...)` reference suitable for a CSS custom property or inline style. */
export function groupAccent(group: WorkspaceGroupId): string {
  return `var(${GROUP_ACCENT_TOKENS[group]})`
}
