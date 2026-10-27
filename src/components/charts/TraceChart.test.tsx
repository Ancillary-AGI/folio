/**
 * TraceChart interaction tests.
 *
 * Recharts renders nothing at zero container width in jsdom, so these assert on
 * the chart's own readouts — the visible window and the pinned cursor — which is
 * exactly the contract an engineer relies on: the window is a range of real
 * samples, and the cursor reports solved values, never interpolated guesses.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import TraceChart from './TraceChart'

const data = Array.from({ length: 11 }, (_, index) => ({ x: index, out: index * 2 }))
const logData = [10, 100, 1000, 10000].map((frequency) => ({ x: frequency, gain: -20 * Math.log10(frequency / 10) }))

const plain = (value: number) => String(value)

function renderChart(overrides: Partial<React.ComponentProps<typeof TraceChart>> = {}) {
  return render(
    <TraceChart
      data={data}
      series={[{ key: 'out', label: 'out', color: '#2563eb' }]}
      xLabel="t"
      xFormatter={plain}
      yFormatter={plain}
      ariaLabel="Test response"
      {...overrides}
    />,
  )
}

const plotArea = () => screen.getByRole('application', { name: /Test response plot area/i })

beforeEach(() => {
  // jsdom has no pointer capture and no layout, so give the overlay a real box.
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 100, width: 100, height: 100, toJSON: () => ({}) }
  })
})

describe('TraceChart', () => {
  it('asks for an analysis when there is nothing to plot', () => {
    renderChart({ data: [] })
    expect(screen.getByRole('figure', { name: 'Test response' })).toHaveTextContent(/run an analysis/i)
  })

  it('shows the full solved window before any zoom', () => {
    renderChart()
    expect(screen.getByText('t 0 – 10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Reset view' })).toBeDisabled()
  })

  it('narrows the window with the zoom control and restores it on reset', () => {
    renderChart()
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('t 2 – 8 of 0 – 10')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Reset view' }))
    expect(screen.getByText('t 0 – 10')).toBeInTheDocument()
  })

  it('zooms and resets from the keyboard', () => {
    renderChart()
    const overlay = plotArea()

    fireEvent.keyDown(overlay, { key: '+' })
    expect(screen.getByText('t 2 – 8 of 0 – 10')).toBeInTheDocument()

    fireEvent.keyDown(overlay, { key: 'r' })
    expect(screen.getByText('t 0 – 10')).toBeInTheDocument()
  })

  it('zooms to a dragged window and snaps it onto real samples', () => {
    renderChart()
    const overlay = plotArea()

    fireEvent.pointerDown(overlay, { clientX: 20, pointerId: 1 })
    fireEvent.pointerMove(overlay, { clientX: 45, pointerId: 1 })
    fireEvent.pointerUp(overlay, { clientX: 60, pointerId: 1 })

    // 2 → 6 requested, and both endpoints exist in the solved data.
    expect(screen.getByText('t 2 – 6 of 0 – 10')).toBeInTheDocument()
  })

  it('pans with shift-drag without inventing samples outside the run', () => {
    renderChart()
    const overlay = plotArea()

    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    fireEvent.pointerDown(overlay, { clientX: 60, pointerId: 1, shiftKey: true })
    fireEvent.pointerUp(overlay, { clientX: 20, pointerId: 1, shiftKey: true })

    // 2 → 8 panned right by 2.4 units, clamped to the end of the run.
    expect(screen.getByText('t 4 – 10 of 0 – 10')).toBeInTheDocument()
  })

  it('zooms about the cursor under the wheel', async () => {
    renderChart()
    const overlay = plotArea()

    const wheel = new WheelEvent('wheel', { clientX: 25, bubbles: true, cancelable: true })
    // jsdom's constructor does not always carry deltaY through to the handler.
    Object.defineProperty(wheel, 'deltaY', { value: -100 })
    // A native dispatch skips testing-library's act() wrapper, so the React
    // state update lands on the next microtask rather than before the assert.
    act(() => {
      overlay.dispatchEvent(wheel)
    })

    // Centre 2.5 held, span 10 → 7.41: 0.65 → 8.06 snapped onto solved samples.
    await waitFor(() => expect(screen.getByText('t 1 – 8 of 0 – 10')).toBeInTheDocument())
  })

  it('pins a cursor that reads the solved value at that sample', () => {
    renderChart()
    const overlay = plotArea()

    fireEvent.pointerDown(overlay, { clientX: 60, pointerId: 1 })
    fireEvent.pointerUp(overlay, { clientX: 60, pointerId: 1 })

    const readout = screen.getByRole('status', { name: 'Pinned cursor readout' })
    expect(readout).toHaveTextContent('t 6 · out 12')

    fireEvent.pointerDown(overlay, { clientX: 60, pointerId: 1 })
    fireEvent.pointerUp(overlay, { clientX: 60, pointerId: 1 })
    expect(screen.queryByRole('status', { name: 'Pinned cursor readout' })).not.toBeInTheDocument()
  })

  it('steps the pinned cursor with the arrow keys', () => {
    renderChart()
    const overlay = plotArea()

    fireEvent.keyDown(overlay, { key: 'ArrowRight' })
    expect(screen.getByRole('status', { name: 'Pinned cursor readout' })).toHaveTextContent('t 6 · out 12')

    fireEvent.keyDown(overlay, { key: 'ArrowLeft' })
    expect(screen.getByRole('status', { name: 'Pinned cursor readout' })).toHaveTextContent('t 5 · out 10')
  })

  it('zooms a frequency decade at a time on a log axis', () => {
    renderChart({ data: logData, logX: true })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))

    // One decade of a 10 Hz–10 kHz span is a third of the axis: the window lands
    // on real sweep points rather than a geometric guess between them.
    expect(screen.getByText('t 100 – 1000 of 10 – 10000')).toBeInTheDocument()
  })

  it('falls back to a linear axis when the data includes zero', () => {
    // The default series starts at t = 0, which no log axis can contain.
    renderChart({ logX: true })
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }))
    expect(screen.getByText('t 2 – 8 of 0 – 10')).toBeInTheDocument()
  })
})
