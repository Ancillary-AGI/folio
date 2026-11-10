import type { ShadingMode } from './outline'

/**
 * The two readings of a 3D model, in the words the whole app uses.
 *
 * A shaded solid tells you what a thing will look like; an outline tells you what
 * it is. Two choices rather than a switch, since neither state is "off" — outline
 * is not the absence of shading, it is a different question asked of the same
 * geometry.
 *
 * This lives beside the mode list rather than in a component, because three
 * surfaces name the same choice — a viewport HUD, a display card and the settings
 * page — and none of them may drift into a fourth word for it.
 */
export const SHADING_UI: Record<ShadingMode, { label: string; hint: string }> = {
  solid: { label: 'Solid', hint: 'Shaded surfaces — judge how the design looks' },
  outline: { label: 'Outline', hint: 'Crease wire over a ghost fill — judge what the geometry is' },
}
