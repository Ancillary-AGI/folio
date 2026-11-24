/**
 * The whole-app error boundary: one crashing panel must not take the CAD with
 * it, and the fallback must say what happened without leaking it anywhere.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ErrorBoundary from '../components/ErrorBoundary'

let bombPower = true
const Bomb = (): JSX.Element => {
  if (bombPower) throw new Error('kaboom')
  return <div>inside the boundary</div>
}

describe('ErrorBoundary', () => {
  beforeEach(() => {
    bombPower = true
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders its children when nothing throws', () => {
    bombPower = false
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByText('inside the boundary')).toBeInTheDocument()
  })

  it('catches a render error and offers the two real ways out', () => {
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByText(/Something in the workspace threw/)).toBeInTheDocument()
    expect(screen.getByText(/kaboom/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back to the launcher/i })).toBeInTheDocument()
  })

  it('copies the error details to the clipboard, keeping them on the device', async () => {
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    fireEvent.click(screen.getByRole('button', { name: /copy error details/i }))
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('kaboom'))
  })

  it('recovers on Try again once the underlying condition is gone', () => {
    const { rerender } = render(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByText(/Something in the workspace threw/)).toBeInTheDocument()
    bombPower = false
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    rerender(<ErrorBoundary><Bomb /></ErrorBoundary>)
    expect(screen.getByText('inside the boundary')).toBeInTheDocument()
  })
})
