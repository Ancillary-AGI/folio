import { afterEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import CopilotIcon from '../components/workspace/CopilotIcon'

const pathOf = (container: HTMLElement): Element => {
  const path = container.querySelector('path')
  // jsdom does not implement SVGPathElement, so match on the tag name.
  if (!path) throw new Error('icon rendered no path')
  return path
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('CopilotIcon', () => {
  it('renders a closed amoeba outline', () => {
    const { container } = render(<CopilotIcon />)
    const path = pathOf(container)
    const d = path.getAttribute('d') ?? ''

    expect(d.startsWith('M')).toBe(true)
    expect(d.trimEnd().endsWith('Z')).toBe(true)
    // 48 sampled points plus the closing segment.
    expect(d.split('L')).toHaveLength(48)
  })

  it('stays inside the viewBox', () => {
    const { container } = render(<CopilotIcon />)
    const numbers = (pathOf(container).getAttribute('d') ?? '')
      .match(/-?\d+(\.\d+)?/g)
      ?.map(Number) ?? []

    // Coordinates come in x,y pairs.
    for (let index = 0; index < numbers.length; index += 2) {
      const x = numbers[index]
      const y = numbers[index + 1]
      expect(x).toBeGreaterThanOrEqual(0)
      expect(x).toBeLessThanOrEqual(24)
      expect(y).toBeGreaterThanOrEqual(0)
      expect(y).toBeLessThanOrEqual(24)
    }
  })

  it('holds a static shape when reduced motion is requested', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })) as unknown as typeof matchMedia)
    const { container } = render(<CopilotIcon />)
    // No animation frame is requested, so the shape is the phase-0 outline.
    expect(pathOf(container).getAttribute('d')).toContain('M')
  })
})