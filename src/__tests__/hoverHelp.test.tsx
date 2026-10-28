import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HoverHelp from '../components/ui/HoverHelp'
import { HELP_TOPICS, HELP_TOPICS_BY_GROUP, SHORTCUTS, getHelpTopic } from '../lib/help/helpTopics'
import { computeTooltipPlacement } from '../lib/help/tooltipLayout'

describe('help topic registry', () => {
  it('names every topic once and says what it does in one sentence', () => {
    const ids = HELP_TOPICS.map((topic) => topic.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const topic of HELP_TOPICS) {
      expect(topic.title.trim().length).toBeGreaterThan(0)
      expect(topic.description.trim().length).toBeGreaterThan(20)
      expect(topic.description.trim().length).toBeLessThanOrEqual(200)
      expect(topic.description.endsWith('.')).toBe(true)
      if ('keys' in topic && topic.keys) expect(topic.keys.length).toBeGreaterThan(0)
    }
  })

  it('partitions topics into the three control groups and resolves them by id', () => {
    expect(HELP_TOPICS_BY_GROUP.rail.length).toBeGreaterThan(0)
    expect(HELP_TOPICS_BY_GROUP.header.length).toBeGreaterThan(0)
    expect(HELP_TOPICS_BY_GROUP.nav.length).toBeGreaterThan(0)
    expect(
      HELP_TOPICS_BY_GROUP.rail.length + HELP_TOPICS_BY_GROUP.header.length + HELP_TOPICS_BY_GROUP.nav.length,
    ).toBe(HELP_TOPICS.length)
    expect(getHelpTopic('rail.grid')?.title).toBe('Grid')
    expect(getHelpTopic('missing.topic')).toBeUndefined()
  })

  it('lists shortcuts with a key, an action and where it applies', () => {
    expect(SHORTCUTS.length).toBeGreaterThan(0)
    for (const row of SHORTCUTS) {
      expect(row.keys.length).toBeGreaterThan(0)
      expect(row.action.trim().length).toBeGreaterThan(0)
      expect(row.where.trim().length).toBeGreaterThan(0)
    }
  })
})

describe('hover help', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('waits out the hover delay before opening, then describes the trigger', () => {
    render(
      <HoverHelp topicId="rail.grid">
        <button type="button">Grid</button>
      </HoverHelp>,
    )
    const trigger = screen.getByRole('button', { name: 'Grid' })
    expect(trigger).not.toHaveAttribute('aria-describedby')

    fireEvent.mouseOver(trigger)
    act(() => vi.advanceTimersByTime(549))
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => vi.advanceTimersByTime(1))
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Show or hide the sheet grid.')
    expect(tooltip).toHaveTextContent('Grid')
    expect(trigger).toHaveAttribute('aria-describedby', tooltip.id)
  })

  it('opens at once on keyboard focus and closes on blur', () => {
    render(
      <HoverHelp topicId="rail.save">
        <button type="button">Save</button>
      </HoverHelp>,
    )
    const trigger = screen.getByRole('button', { name: 'Save' })
    act(() => trigger.focus())
    expect(screen.getByRole('tooltip')).toHaveTextContent('Save this snapshot of the design to this device.')

    act(() => trigger.blur())
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('cancels a pending hover when the pointer leaves before the delay', () => {
    render(
      <HoverHelp topicId="rail.wire">
        <button type="button">Wire</button>
      </HoverHelp>,
    )
    const trigger = screen.getByRole('button', { name: 'Wire' })
    fireEvent.mouseOver(trigger)
    act(() => vi.advanceTimersByTime(200))
    fireEvent.mouseOut(trigger)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('dismisses on Escape and on scroll', () => {
    render(
      <HoverHelp topicId="rail.fit">
        <button type="button">Fit</button>
      </HoverHelp>,
    )
    const trigger = screen.getByRole('button', { name: 'Fit' })

    act(() => trigger.focus())
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()

    act(() => trigger.blur())
    act(() => trigger.focus())
    expect(screen.getByRole('tooltip')).toBeInTheDocument()
    fireEvent.scroll(window)
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(trigger).not.toHaveAttribute('aria-describedby')
  })

  it('keeps an existing aria-describedby when the guide closes', () => {
    render(
      <HoverHelp topicId="rail.select">
        <button type="button" aria-describedby="field-hint">Select</button>
      </HoverHelp>,
    )
    const trigger = screen.getByRole('button', { name: 'Select' })
    fireEvent.mouseOver(trigger)
    act(() => vi.advanceTimersByTime(600))
    expect(trigger.getAttribute('aria-describedby')).toContain('field-hint')
    expect(trigger.getAttribute('aria-describedby')).toContain('help-')
  })

  it('renders the trigger untouched when there is no copy to show', () => {
    // The prop is a union of real ids; this cast exercises a registry that
    // drifted after the call site was written rather than a typo the compiler
    // would have caught.
    const missing = 'missing.topic' as Parameters<typeof HoverHelp>[0]['topicId']
    render(
      <HoverHelp topicId={missing}>
        <button type="button">Unknown</button>
      </HoverHelp>,
    )
    const trigger = screen.getByRole('button', { name: 'Unknown' })
    fireEvent.mouseOver(trigger)
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})

describe('tooltip placement', () => {
  const viewport = { width: 1280, height: 800 }

  it('sits under the control when there is room', () => {
    const placement = computeTooltipPlacement(
      { left: 600, top: 200, width: 40, height: 20 },
      { width: 240, height: 90 },
      viewport,
      'bottom',
    )
    expect(placement.side).toBe('bottom')
    expect(placement.top).toBe(228)
    expect(placement.left).toBe(500)
  })

  it('flips above a control near the bottom edge', () => {
    const placement = computeTooltipPlacement(
      { left: 600, top: 700, width: 40, height: 20 },
      { width: 240, height: 90 },
      viewport,
      'bottom',
    )
    expect(placement.side).toBe('top')
    expect(placement.top).toBe(602)
  })

  it('prefers the requested side for a rail control and stays inside the window', () => {
    const placement = computeTooltipPlacement(
      { left: 4, top: 300, width: 36, height: 28 },
      { width: 240, height: 90 },
      viewport,
      'right',
    )
    expect(placement.side).toBe('right')
    expect(placement.left).toBe(48)
    expect(placement.top).toBe(269)
  })

  it('pins an oversized guide inside a tiny window instead of drawing it off screen', () => {
    const placement = computeTooltipPlacement(
      { left: 0, top: 0, width: 10, height: 10 },
      { width: 240, height: 90 },
      { width: 200, height: 100 },
      'bottom',
    )
    expect(placement).toEqual({ left: 8, top: 8, side: 'bottom' })
  })
})
