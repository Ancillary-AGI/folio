/**
 * Placement maths for the hover guide.
 *
 * Pure so the geometry can be tested without a DOM: the guide must stay inside
 * the window and must not cover the control it explains, including when that
 * control sits at the very edge of a narrow or short viewport.
 */
export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

export interface TooltipRect {
  left: number
  top: number
  width: number
  height: number
}

export interface TooltipPlacement {
  left: number
  top: number
  side: TooltipSide
}

export interface TooltipSize {
  width: number
  height: number
}

const VIEWPORT_MARGIN = 8
const ANCHOR_GAP = 8

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

function placementOrder(preferred: TooltipSide | 'auto'): TooltipSide[] {
  switch (preferred) {
    case 'top':
      return ['top', 'bottom', 'right', 'left']
    case 'left':
      return ['left', 'right', 'top', 'bottom']
    case 'right':
      return ['right', 'left', 'top', 'bottom']
    case 'bottom':
      return ['bottom', 'top', 'right', 'left']
    case 'auto':
    default:
      return ['bottom', 'top', 'right', 'left']
  }
}

function candidate(anchor: TooltipRect, tip: TooltipSize, side: TooltipSide): TooltipRect {
  switch (side) {
    case 'top':
      return {
        left: anchor.left + anchor.width / 2 - tip.width / 2,
        top: anchor.top - tip.height - ANCHOR_GAP,
        width: tip.width,
        height: tip.height,
      }
    case 'left':
      return {
        left: anchor.left - tip.width - ANCHOR_GAP,
        top: anchor.top + anchor.height / 2 - tip.height / 2,
        width: tip.width,
        height: tip.height,
      }
    case 'right':
      return {
        left: anchor.left + anchor.width + ANCHOR_GAP,
        top: anchor.top + anchor.height / 2 - tip.height / 2,
        width: tip.width,
        height: tip.height,
      }
    case 'bottom':
    default:
      return {
        left: anchor.left + anchor.width / 2 - tip.width / 2,
        top: anchor.top + anchor.height + ANCHOR_GAP,
        width: tip.width,
        height: tip.height,
      }
  }
}

function fits(rect: TooltipRect, viewport: TooltipSize): boolean {
  return (
    rect.width <= viewport.width - VIEWPORT_MARGIN * 2 &&
    rect.height <= viewport.height - VIEWPORT_MARGIN * 2 &&
    rect.left >= VIEWPORT_MARGIN &&
    rect.top >= VIEWPORT_MARGIN &&
    rect.left + rect.width <= viewport.width - VIEWPORT_MARGIN &&
    rect.top + rect.height <= viewport.height - VIEWPORT_MARGIN
  )
}

export function computeTooltipPlacement(
  anchor: TooltipRect,
  tip: TooltipSize,
  viewport: TooltipSize,
  preferred: TooltipSide | 'auto' = 'auto',
): TooltipPlacement {
  const order = placementOrder(preferred)
  const chosen = order.map((side) => ({ side, rect: candidate(anchor, tip, side) })).find((entry) => fits(entry.rect, viewport))
  if (chosen) return { left: Math.round(chosen.rect.left), top: Math.round(chosen.rect.top), side: chosen.side }

  // Nothing fits cleanly (tiny window or oversized guide): keep the preferred
  // side but pin the card inside the viewport so the text is still readable.
  const fallback = candidate(anchor, tip, order[0])
  return {
    left: Math.round(clamp(fallback.left, VIEWPORT_MARGIN, viewport.width - tip.width - VIEWPORT_MARGIN)),
    top: Math.round(clamp(fallback.top, VIEWPORT_MARGIN, viewport.height - tip.height - VIEWPORT_MARGIN)),
    side: order[0],
  }
}
