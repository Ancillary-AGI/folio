import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import OnboardingTour from '../components/OnboardingTour'
import { computeTourLayout, computeTourCaret, type TourRect } from '../lib/onboarding/tourLayout'
import {
  clampOnboardingStep,
  ONBOARDING_STEPS,
  ONBOARDING_STEP_COUNT,
} from '../lib/onboarding/onboardingSteps'

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

describe('onboarding tour curriculum', () => {
  it('keeps every step addressable and coherent', () => {
    const ids = ONBOARDING_STEPS.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ONBOARDING_STEP_COUNT).toBe(ids.length)
    expect(clampOnboardingStep(-4)).toBe(0)
    expect(clampOnboardingStep(999)).toBe(ids.length - 1)
    expect(clampOnboardingStep(1.5)).toBe(0)
    for (const entry of ONBOARDING_STEPS) {
      expect(entry.title.length).toBeGreaterThan(0)
      expect(entry.checklist.length).toBeGreaterThan(0)
      expect(entry.checklist.length).toBeLessThanOrEqual(4)
      expect(entry.icon).toBeDefined()
    }
  })

  it('only marks a step live when the sheet stays usable behind it', () => {
    const live = ONBOARDING_STEPS.filter((entry) => entry.handsOn)
    expect(live.length).toBeGreaterThan(0)
    for (const entry of live) {
      // A live step is only meaningful with something on screen to operate.
      expect(entry.target).toBeTruthy()
      expect(['schematic', 'simulation', 'mechanical']).toContain(entry.mode)
    }
  })

  it('points each target at a data-tour marker the shell really renders', () => {
    const rendered = new Set<string>()
    const visit = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) visit(path)
        else if (entry.name.endsWith('.tsx')) {
          for (const match of readFileSync(path, 'utf8').matchAll(/data-tour="([^"]+)"/g)) {
            rendered.add(match[1])
          }
        }
      }
    }
    visit(join(process.cwd(), 'src'))
    expect(rendered.size).toBeGreaterThan(0)
    for (const entry of ONBOARDING_STEPS) {
      if (entry.target) expect(rendered.has(entry.target), `${entry.id} -> ${entry.target}`).toBe(true)
      if (entry.fallbackTarget) {
        expect(rendered.has(entry.fallbackTarget), `${entry.id} -> ${entry.fallbackTarget}`).toBe(true)
      }
    }
  })
})

function renderTour(stepIndex: number) {
  const setStepIndex = vi.fn()
  const utils = render(
    <OnboardingTour
      onClose={() => {}}
      onCreateProject={() => {}}
      onLoadSampleCircuit={() => {}}
      onLoadDemoBoard={() => {}}
      hasProject
      stepIndex={stepIndex}
      setStepIndex={setStepIndex}
    />,
  )
  return { ...utils, setStepIndex }
}

const stepIndexById = (id: string) => {
  const index = ONBOARDING_STEPS.findIndex((entry) => entry.id === id)
  expect(index).toBeGreaterThanOrEqual(0)
  return index
}

describe('onboarding tour behaviour', () => {
  it('makes every step reachable from the dot rail and marks the current one', () => {
    const { setStepIndex } = renderTour(stepIndexById('editor-tools'))

    const dots = screen.getAllByRole('button', { name: /(Current|Reviewed|Upcoming) step\b/ })
    expect(dots).toHaveLength(ONBOARDING_STEP_COUNT)
    const current = screen.getByRole('button', { name: /^Current step:/ })
    expect(current).toHaveAttribute('aria-current', 'step')
    // Visited steps stay one click away instead of trapping the user in order.
    expect(screen.getByRole('button', { name: /^Reviewed step 1:/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^Upcoming step 5:/ }))
    expect(setStepIndex).toHaveBeenCalledWith(4)
  })

  it('keeps the sample loader on the step that declares it, not on a hardcoded id', () => {
    const declared = stepIndexById('schematic')
    const { unmount } = renderTour(declared)
    expect(screen.getByRole('button', { name: /load rectifier/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /load divider/i })).toBeInTheDocument()
    unmount()

    renderTour(stepIndexById('waveforms'))
    expect(screen.queryByRole('button', { name: /load rectifier/i })).not.toBeInTheDocument()
  })

  it('leaves a live step operable and a teaching step modal', () => {
    // jsdom reports zero-size rects, so the step's target is given a real box;
    // a live step only unlocks when the control it teaches is actually on screen.
    const host = document.createElement('div')
    host.setAttribute('data-tour', 'tool-rail')
    host.getBoundingClientRect = () =>
      ({ top: 120, left: 40, width: 44, height: 320, right: 84, bottom: 440, x: 40, y: 120, toJSON: () => ({}) }) as DOMRect
    document.body.appendChild(host)
    try {
      const live = stepIndexById('editor-tools')
      const { unmount } = renderTour(live)
      const dialog = screen.getByRole('dialog')
      expect(dialog).not.toHaveAttribute('aria-modal')
      expect(dialog.parentElement?.className).toContain('pointer-events-none')
      expect(screen.getByText(/Live step/)).toBeInTheDocument()
      expect(document.querySelector('.tour-caret')).not.toBeNull()
      expect(document.querySelectorAll('.tour-bracket')).toHaveLength(4)
      unmount()

      // The same step with its target gone falls back to a plain modal card.
      host.getBoundingClientRect = () =>
        ({ top: 0, left: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
      const second = renderTour(live)
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByRole('dialog').parentElement?.className).not.toContain('pointer-events-none')
      expect(screen.queryByText(/Live step/)).not.toBeInTheDocument()
      second.unmount()

      renderTour(0)
      expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true')
      expect(screen.queryByText(/Live step/)).not.toBeInTheDocument()
    } finally {
      host.remove()
    }
  })
})

describe('onboarding tour caret', () => {
  const spotRect: TourRect = { top: 100, left: 600, width: 80, height: 32 }

  it('sits on the card edge that faces the target', () => {
    const layout = computeTourLayout(spotRect, card, viewport, 'bottom')
    const caret = computeTourCaret(layout, 360, spotRect)
    expect(caret).not.toBeNull()
    // Card is below the target, so the caret points up from the card's top edge.
    expect(caret?.side).toBe('top')
    expect(caret?.along).toBeGreaterThan(0)
    expect(caret?.along).toBeLessThan(layout.card.width)
  })

  it('tracks the target along the edge instead of staying centred', () => {
    const left = computeTourCaret(
      computeTourLayout(spotRect, card, viewport, 'bottom'), 360, spotRect,
    )
    const right = computeTourCaret(
      computeTourLayout({ ...spotRect, left: 60 }, card, viewport, 'bottom'), 360, spotRect,
    )
    expect(left?.along).not.toBe(right?.along)
  })

  it('gives no caret to a centred or docked card', () => {
    expect(computeTourCaret(computeTourLayout(null, card, viewport), 360, null)).toBeNull()
    const filled: TourRect = { top: 100, left: 0, width: 1280, height: 690 }
    const docked = computeTourLayout(filled, card, viewport)
    expect(docked.placement).toBe('dock')
    expect(computeTourCaret(docked, 360, filled)).toBeNull()
  })

  it('keeps the caret inside the card when the target hugs an edge', () => {
    const layout = computeTourLayout({ top: 4, left: 4, width: 40, height: 24 }, card, viewport, 'bottom')
    const caret = computeTourCaret(layout, 360, { top: 4, left: 4, width: 40, height: 24 })
    expect(caret?.side).toBe('top')
    expect(caret!.along).toBeGreaterThanOrEqual(20)
    expect(caret!.along + 12).toBeLessThanOrEqual(layout.card.width)
  })
})
