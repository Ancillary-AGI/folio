import type { OnboardingStep } from './onboardingSteps'

export interface TourRect {
  top: number
  left: number
  width: number
  height: number
}

export type TourPlacement = 'center' | 'top' | 'bottom' | 'left' | 'right' | 'dock'

export interface TourLayout {
  card: { left: number; top: number; width: number }
  spotlight: TourRect | null
  placement: TourPlacement
}

const VIEWPORT_MARGIN = 16
const CARD_GAP = 14
const SPOTLIGHT_PADDING = 8
const CARD_MAX_WIDTH = 420
const CARD_MIN_WIDTH = 280
const CARD_ESTIMATED_HEIGHT = 360

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max))

function placementOrder(preferred: OnboardingStep['placement']): Exclude<TourPlacement, 'center' | 'dock'>[] {
  switch (preferred) {
    case 'top':
      return ['top', 'bottom', 'right', 'left']
    case 'right':
      return ['right', 'left', 'bottom', 'top']
    case 'left':
      return ['left', 'right', 'bottom', 'top']
    case 'bottom':
    default:
      return ['bottom', 'top', 'right', 'left']
  }
}

/**
 * Resolve the coach-mark and spotlight geometry.
 *
 * Pure so the geometry can be tested without a DOM: the tour must keep the
 * highlighted element and the card on screen even when the target sits at an
 * edge, is larger than the viewport, or disappears between steps.
 */
export function computeTourLayout(
  target: TourRect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  preferred?: OnboardingStep['placement'],
): TourLayout {
  const width = Math.round(
    Math.min(CARD_MAX_WIDTH, Math.max(CARD_MIN_WIDTH, viewport.width - VIEWPORT_MARGIN * 2)),
  )
  const height = Math.min(
    card.height || CARD_ESTIMATED_HEIGHT,
    Math.max(200, viewport.height - VIEWPORT_MARGIN * 2),
  )
  const centred: TourLayout = {
    placement: 'center',
    spotlight: null,
    card: {
      left: Math.round((viewport.width - width) / 2),
      top: Math.max(VIEWPORT_MARGIN, Math.round((viewport.height - height) / 2)),
      width,
    },
  }

  if (
    !target ||
    target.width <= 0 ||
    target.height <= 0 ||
    target.top + target.height < 0 ||
    target.top > viewport.height ||
    target.left + target.width < 0 ||
    target.left > viewport.width
  ) {
    return centred
  }

  const spot: TourRect = {
    top: target.top - SPOTLIGHT_PADDING,
    left: target.left - SPOTLIGHT_PADDING,
    width: target.width + SPOTLIGHT_PADDING * 2,
    height: target.height + SPOTLIGHT_PADDING * 2,
  }
  const maxLeft = viewport.width - width - VIEWPORT_MARGIN
  const maxTop = viewport.height - height - VIEWPORT_MARGIN
  const centreLeft = () => clamp(target.left + target.width / 2 - width / 2, VIEWPORT_MARGIN, maxLeft)
  const centreTop = () => clamp(target.top + target.height / 2 - height / 2, VIEWPORT_MARGIN, maxTop)

  for (const candidate of placementOrder(preferred)) {
    if (candidate === 'bottom' && spot.top + spot.height + CARD_GAP + height <= viewport.height - VIEWPORT_MARGIN) {
      return { placement: 'bottom', spotlight: spot, card: { left: centreLeft(), top: spot.top + spot.height + CARD_GAP, width } }
    }
    if (candidate === 'top' && spot.top - CARD_GAP - height >= VIEWPORT_MARGIN) {
      return { placement: 'top', spotlight: spot, card: { left: centreLeft(), top: spot.top - CARD_GAP - height, width } }
    }
    if (candidate === 'right' && spot.left + spot.width + CARD_GAP + width <= viewport.width - VIEWPORT_MARGIN) {
      return { placement: 'right', spotlight: spot, card: { left: spot.left + spot.width + CARD_GAP, top: centreTop(), width } }
    }
    if (candidate === 'left' && spot.left - CARD_GAP - width >= VIEWPORT_MARGIN) {
      return { placement: 'left', spotlight: spot, card: { left: spot.left - CARD_GAP - width, top: centreTop(), width } }
    }
  }

  // Large editors fill most of the viewport: dock the card out of the way
  // instead of covering the element the step is describing.
  return {
    placement: 'dock',
    spotlight: spot,
    card: {
      left: Math.max(VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN),
      top: Math.max(VIEWPORT_MARGIN, viewport.height - height - VIEWPORT_MARGIN),
      width,
    },
  }
}
