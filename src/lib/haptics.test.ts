import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { triggerHaptic } from './haptics'

describe('haptics', () => {
  const vibrate = vi.fn()

  beforeEach(() => {
    vibrate.mockReset()
    vi.stubGlobal('navigator', { ...globalThis.navigator, vibrate })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fires each named pattern on devices that support the Vibration API', () => {
    triggerHaptic('tap')
    expect(vibrate).toHaveBeenLastCalledWith([10])
    triggerHaptic('success')
    expect(vibrate).toHaveBeenLastCalledWith([12, 60, 18])
    triggerHaptic('error')
    expect(vibrate).toHaveBeenLastCalledWith([30, 80, 30])
    triggerHaptic('warning')
    expect(vibrate).toHaveBeenLastCalledWith([120])
  })

  it('no-ops silently where the API is absent (iOS Safari, desktop)', () => {
    vi.stubGlobal('navigator', { ...globalThis.navigator, vibrate: undefined })
    expect(() => triggerHaptic('tap')).not.toThrow()
    expect(() => triggerHaptic('success')).not.toThrow()
  })
})
