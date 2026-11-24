import { describe, expect, it } from 'vitest'
import {
  DEFAULT_NET_CLASSES,
  matchesNetPattern,
  netClassRules,
  resolveNetClass,
  type NetClass,
} from './netClasses'

const classes: NetClass[] = [
  { id: 'power', name: 'Power', patterns: ['VCC*', 'GND'], traceWidthMm: 0.4, clearanceMm: 0.2 },
  { id: 'clock', name: 'Clock', patterns: ['*CLK*'], traceWidthMm: 0.3, clearanceMm: 0.15 },
  { id: 'default', name: 'Default', patterns: ['*'], traceWidthMm: 0.2, clearanceMm: 0.1 },
]

describe('net class patterns', () => {
  it('matches star and question wildcards, anchored and case-insensitive', () => {
    expect(matchesNetPattern('VCC*', 'VCC_3V3')).toBe(true)
    expect(matchesNetPattern('VCC*', 'AVCC')).toBe(false)
    expect(matchesNetPattern('DQ?', 'DQ0')).toBe(true)
    expect(matchesNetPattern('DQ?', 'DQ10')).toBe(false)
    expect(matchesNetPattern('*clk*', 'USB_CLK_P')).toBe(true)
    expect(matchesNetPattern('', 'GND')).toBe(false)
  })

  it('treats regex punctuation in a net name literally', () => {
    expect(matchesNetPattern('+3.3V', '+3.3V')).toBe(true)
    expect(matchesNetPattern('+3.3V', '+3x3V')).toBe(false)
  })
})

describe('net class resolution', () => {
  it('uses the first matching class in list order, with Default catching the rest', () => {
    expect(resolveNetClass('VCC_5V', classes)?.id).toBe('power')
    expect(resolveNetClass('CPU_CLK', classes)?.id).toBe('clock')
    expect(resolveNetClass('LED_A', classes)?.id).toBe('default')
  })

  it('lets an explicit assignment outrank a matching pattern', () => {
    const assignments = { VCC_AUDIO: 'default', CPU_CLK: 'power' }
    expect(resolveNetClass('VCC_AUDIO', classes, assignments)?.id).toBe('default')
    expect(resolveNetClass('CPU_CLK', classes, assignments)?.id).toBe('power')
  })

  it('ignores an assignment that names a class which no longer exists', () => {
    expect(resolveNetClass('VCC_5V', classes, { VCC_5V: 'removed' })?.id).toBe('power')
  })
})

describe('net class rules', () => {
  it('reports width and clearance for every named net only once', () => {
    const rules = netClassRules(['VCC_5V', 'VCC_5V', 'CPU_CLK', 'LED_A'], classes)
    expect(rules.widths).toEqual({ VCC_5V: 0.4, CPU_CLK: 0.3, LED_A: 0.2 })
    expect(rules.clearances).toEqual({ VCC_5V: 0.2, CPU_CLK: 0.15, LED_A: 0.1 })
  })

  it('leaves out nets that no class names', () => {
    const narrow = [{ id: 'only', name: 'Only', patterns: ['VCC*'], traceWidthMm: 0.5, clearanceMm: 0.3 }]
    expect(netClassRules(['VCC', 'LED_A'], narrow)).toEqual({
      widths: { VCC: 0.5 },
      clearances: { VCC: 0.3 },
    })
  })

  it('ships defaults that resolve the common bus names', () => {
    expect(resolveNetClass('VCC_5V', DEFAULT_NET_CLASSES)?.id).toBe('power')
    expect(resolveNetClass('USB2_DP', DEFAULT_NET_CLASSES)?.id).toBe('high-speed')
    expect(resolveNetClass('LED_A', DEFAULT_NET_CLASSES)?.id).toBe('default')
  })
})
