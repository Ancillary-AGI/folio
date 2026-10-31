import { describe, expect, it } from 'vitest'
import {
  DEFAULT_CONTEXT_BUDGET_TOKENS,
  buildContextPack,
  estimateTokens,
} from './contextPack'

describe('estimateTokens', () => {
  it('uses the standard characters-per-token estimate', () => {
    expect(estimateTokens('')).toBe(0)
    expect(estimateTokens('abcd')).toBe(1)
    expect(estimateTokens('abcdefgh')).toBe(2)
    expect(estimateTokens('abc')).toBe(1)
  })
})

describe('buildContextPack budgeting', () => {
  it('never exceeds the budget', () => {
    const pack = buildContextPack({
      goal: 'inspect the schematic',
      parts: Array.from({ length: 40 }, (_, index) => ({
        reference: `R${index + 1}`,
        name: 'Resistor',
        properties: { resistance: 1000 + index },
      })),
      wires: Array.from({ length: 30 }, (_, index) => ({ id: `w${index}`, netName: `NET${index}` })),
      issues: Array.from({ length: 10 }, (_, index) => `issue ${index}`),
      transcript: Array.from({ length: 20 }, (_, index) => `call ${index}`),
      budgetTokens: 400,
    })
    expect(pack.totalTokens).toBeLessThanOrEqual(400)
    expect(pack.budgetTokens).toBe(400)
  })

  it('keeps the goal even when it is longer than the whole budget', () => {
    const goal = 'simulate '.repeat(500)
    const pack = buildContextPack({ goal, budgetTokens: 64 })
    const goalSection = pack.sections.find((section) => section.id === 'goal')
    expect(goalSection).toBeDefined()
    expect(goalSection!.tokens).toBeLessThanOrEqual(64)
    expect(pack.dropped).not.toContain('goal')
    // Everything else had to give way.
    expect(pack.dropped).toContain('sheet')
  })

  it('truncates long lists with an honest omitted count', () => {
    const pack = buildContextPack({
      goal: 'inspect',
      parts: Array.from({ length: 50 }, (_, index) => ({
        reference: `R${index + 1}`,
        name: 'Resistor',
        properties: {},
      })),
      budgetTokens: 150,
    })
    const sheet = pack.sections.find((section) => section.id === 'sheet')
    expect(sheet).toBeDefined()
    expect(sheet!.content).toMatch(/omitted/)
  })

  it('reports sections that could not fit', () => {
    const pack = buildContextPack({
      goal: 'a goal',
      parts: [{ reference: 'R1', name: 'Resistor', properties: {} }],
      transcript: Array.from({ length: 500 }, (_, index) => `very long transcript line ${index} `.repeat(10)),
      budgetTokens: 64,
    })
    expect(pack.dropped).toContain('transcript')
  })

  it('describes an empty sheet without inventing parts', () => {
    const pack = buildContextPack({ goal: 'inspect', budgetTokens: 400 })
    const sheet = pack.sections.find((section) => section.id === 'sheet')
    expect(sheet).toBeDefined()
    expect(sheet!.content).toContain('0 part(s) total.')
  })

  it('defaults to a 1200-token budget', () => {
    const pack = buildContextPack({ goal: 'inspect' })
    expect(pack.budgetTokens).toBe(DEFAULT_CONTEXT_BUDGET_TOKENS)
    expect(pack.totalTokens).toBeLessThanOrEqual(DEFAULT_CONTEXT_BUDGET_TOKENS)
  })

  it('lists named nets once each', () => {
    const pack = buildContextPack({
      goal: 'inspect',
      wires: [
        { id: 'w1', netName: 'VCC' },
        { id: 'w2', netName: 'VCC' },
        { id: 'w3', netName: 'GND' },
        { id: 'w4' },
      ],
    })
    const nets = pack.sections.find((section) => section.id === 'nets')
    expect(nets!.content).toContain('VCC, GND')
    expect(nets!.content).toContain('4 wire(s) total.')
  })
})
