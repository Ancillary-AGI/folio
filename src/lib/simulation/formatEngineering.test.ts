import { describe, expect, it } from 'vitest'

import { formatEngineering, formatEngineeringPrecise } from './formatEngineering'

describe('formatEngineering', () => {
  it('scales to the SI prefix instead of printing zeros', () => {
    expect(formatEngineering(2e-11)).toBe('20.0p')
    expect(formatEngineering(0.0045)).toBe('4.50m')
    expect(formatEngineering(1500)).toBe('1.50k')
    expect(formatEngineering(0)).toBe('0')
  })

  it('keeps three significant digits without float noise', () => {
    expect(formatEngineering(99.9999999999)).toBe('100')
    expect(formatEngineering(45.6)).toBe('45.6')
    expect(formatEngineering(1.5)).toBe('1.50')
    expect(formatEngineering(Number.NaN)).toBe('—')
    expect(formatEngineering(Number.POSITIVE_INFINITY)).toBe('—')
  })

  it('ignores the tick index a chart formatter is called with', () => {
    // Recharts calls tick formatters as `formatter(value, index)`. When this
    // function took a digits parameter, index 0 reached toPrecision(0) and the
    // whole chart threw at render time — a crash no zero-width jsdom test sees.
    const asTickFormatter = formatEngineering as (...args: number[]) => string
    for (let index = 0; index < 12; index += 1) {
      expect(asTickFormatter(0.0045, index)).toBe('4.50m')
    }
    expect(asTickFormatter(1500, 0)).toBe('1.50k')
  })

  it('gives a readout the digits an axis tick does not need', () => {
    expect(formatEngineering(0.004567891)).toBe('4.57m')
    expect(formatEngineeringPrecise(0.004567891)).toBe('4.56789m')
    expect(formatEngineeringPrecise(0)).toBe('0')
  })
})
