import { describe, expect, it } from 'vitest'
import { computeTourLayout, type TourRect } from '../lib/onboarding/tourLayout'

const viewport = { width: 1280, height: 800 }
const card = { width: 420, height: 360 }

function overlapsCard(rect: TourRect, layout: ReturnType<typeof computeTourLayout>) {
  const cardRight = layout.card.left + layout.card.width
  const cardBottom = layout.card.top + card.height
  return (
    rect.left < cardRight &&
    rect.left + rect.width > layout.card.left &&
    rect.top < cardBottom &&
    rect.top + rect.height > layout.card.top
  )
}

describe('onboarding tour layout', () => {
  it('centres the card when a step has no measurable target', () => {
    const layout = computeTourLayout(null, card, viewport)
    expect(layout.placement).toBe('center')
    expect(layout.spotlight).toBeNull()
    expect(layout.card.width).toBe(420)
    expect(layout.card.left).toBeGreaterThanOrEqual(16)
    expect(layout.card.left + layout.card.width).toBeLessThanOrEqual(viewport.width - 16)
  })

  it('places the card below a header target and never covers it', () => {
    const header: TourRect = { top: 0, left: 0, width: 1280, height: 44 }
    const layout = computeTourLayout(header, card, viewport, 'bottom')
    expect(layout.placement).toBe('bottom')
    expect(layout.spotlight?.top).toBe(-8)
    expect(layout.card.top).toBeGreaterThan(44)
    expect(overlapsCard(layout.spotlight!, layout)).toBe(false)
  })

  it('places the card above a status-bar target', () => {
    const status: TourRect = { top: 776, left: 0, width: 1280, height: 24 }
    const layout = computeTourLayout(status, card, viewport, 'top')
    expect(layout.placement).toBe('top')
    expect(layout.card.top).toBeLessThan(776)
    expect(overlapsCard(layout.spotlight!, layout)).toBe(false)
  })

  it('places the card beside a narrow dock target', () => {
    const library: TourRect = { top: 120, left: 44, width: 260, height: 640 }
    const layout = computeTourLayout(library, card, viewport, 'right')
    expect(layout.placement).toBe('right')
    expect(layout.card.left).toBeGreaterThan(44 + 260)
    expect(overlapsCard(layout.spotlight!, layout)).toBe(false)
  })

  it('docks the card when the target fills the viewport', () => {
    const canvas: TourRect = { top: 100, left: 0, width: 1280, height: 690 }
    const layout = computeTourLayout(canvas, card, viewport)
    expect(layout.placement).toBe('dock')
    expect(layout.card.left + layout.card.width).toBeLessThanOrEqual(viewport.width - 16)
    expect(layout.card.top + card.height).toBeLessThanOrEqual(viewport.height - 16)
  })

  it('falls back to a centred card when the target scrolled out of view', () => {
    const offscreen: TourRect = { top: -900, left: 10, width: 100, height: 40 }
    expect(computeTourLayout(offscreen, card, viewport).placement).toBe('center')
    expect(computeTourLayout({ ...offscreen, top: 900 }, card, viewport).placement).toBe('center')
  })

  it('narrows the card to the viewport on small screens', () => {
    const layout = computeTourLayout(null, { width: 420, height: 360 }, { width: 360, height: 640 })
    expect(layout.card.width).toBe(328)
    expect(layout.card.left).toBe(16)
  })
})
