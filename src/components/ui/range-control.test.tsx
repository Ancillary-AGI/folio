/**
 * The shared slider. Two contracts matter here: every control keeps an
 * accessible name (the panels query by label), and the painted fill has to
 * track the value, because a groove that disagrees with its thumb reads as
 * broken. The element stays a native range input, so the value handed back must
 * be a number parsed from the control, not a string.
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { RangeControl } from './range-control'

const slider = () => screen.getByRole('slider')
const filled = () => slider().getAttribute('style')?.replace(/\s+/g, ' ') ?? ''

describe('RangeControl', () => {
  it('names itself and paints the filled fraction of the track', () => {
    render(<RangeControl label="Component scale" min={0.5} max={2} value={1.25} onValueChange={() => {}} />)

    expect(slider()).toBeInTheDocument()
    expect(screen.getByLabelText('Component scale')).toBe(slider())
    expect(filled()).toContain('--cad-slider-pos: 0.5')
  })

  it('clamps the fill instead of painting past the end', () => {
    const { rerender } = render(
      <RangeControl label="Demand scale" min={0.5} max={2} value={9} onValueChange={() => {}} />,
    )
    expect(filled()).toContain('--cad-slider-pos: 1')

    rerender(<RangeControl label="Demand scale" min={0.5} max={2} value={-9} onValueChange={() => {}} />)
    expect(filled()).toContain('--cad-slider-pos: 0')
  })

  it('reports the value as a number and keeps the readout in step', () => {
    const onValueChange = vi.fn()
    render(
      <RangeControl
        label="Speed"
        min={0.1}
        max={5}
        step={0.1}
        value={1}
        onValueChange={onValueChange}
        format={(value) => `${value.toFixed(1)}×`}
      />,
    )

    expect(screen.getByText('1.0×')).toBeInTheDocument()
    fireEvent.change(slider(), { target: { value: '3.2' } })
    expect(onValueChange).toHaveBeenCalledWith(3.2)
  })

  it('announces the formatted value, not the raw float', () => {
    render(
      <RangeControl
        label="Shoulder"
        min={-1.5708}
        max={1.5708}
        value={0.7854}
        onValueChange={() => {}}
        format={(value) => `${((value * 180) / Math.PI).toFixed(1)}°`}
      />,
    )

    expect(slider()).toHaveAttribute('aria-valuetext', '45.0°')
  })

  it('refuses to move while disabled', () => {
    const onValueChange = vi.fn()
    render(
      <RangeControl label="Base" min={-3.1416} max={3.1416} step={0.01} value={0} onValueChange={onValueChange} disabled />,
    )

    expect(slider()).toBeDisabled()
    fireEvent.click(slider())
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('drops the label row in a compact row but keeps the name', () => {
    render(<RangeControl compact label="Playback time" min={0} max={1000} value={500} onValueChange={() => {}} />)

    expect(screen.queryByText('Playback time')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Playback time')).toHaveValue('500')
  })
})
