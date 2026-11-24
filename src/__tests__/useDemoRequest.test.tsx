import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { useDemoRequest } from '../components/workspace/useDemoRequest'
import { useAppStore } from '../stores/useAppStore'

function Probe({ handler }: { handler: () => void }) {
  useDemoRequest('probe', handler)
  return null
}

beforeEach(() => useAppStore.setState({ demoRequest: null }))
afterEach(cleanup)

describe('useDemoRequest', () => {
  it('runs a one-shot request exactly once under StrictMode', () => {
    const handler = vi.fn()
    useAppStore.setState({ demoRequest: 'probe' })
    render(
      <StrictMode>
        <Probe handler={handler} />
      </StrictMode>,
    )
    expect(handler).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().demoRequest).toBeNull()
  })

  it('leaves requests addressed to another panel untouched', () => {
    const handler = vi.fn()
    useAppStore.setState({ demoRequest: 'other' })
    render(<Probe handler={handler} />)
    expect(handler).not.toHaveBeenCalled()
    expect(useAppStore.getState().demoRequest).toBe('other')
  })
})
