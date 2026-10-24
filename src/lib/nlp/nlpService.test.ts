import { describe, expect, it } from 'vitest'
import type { Component, Net, Wire } from '../../types'
import { NLPService } from './nlpService'

const component = (
  id: string,
  name: string,
  category: string,
  properties: Record<string, string | number | boolean> = {},
): Component => ({
  id,
  name,
  category,
  symbol: { width: 40, height: 20, paths: [] },
  pins: [{ id: 'p1', name: 'Pin 1', x: 0, y: 0, type: 'passive' }],
  properties,
})

const wire = (id: string, componentIds: string[]): Wire => ({
  id,
  points: [],
  connectedPins: componentIds.map(componentId => ({ componentId, pinId: 'p1' })),
})

describe('NLPService intent matching', () => {
  it('extracts workspace navigation intents and their target', async () => {
    const service = new NLPService()
    const result = await service.processCommand('switch to pcb layout')
    expect(result.intent).toBe('switch_workspace')
  })

  it('recognises undo and reports unknown text without inventing an intent', () => {
    const service = new NLPService()
    expect(service.processCommand('undo').intent).toBe('undo')
    const unknown = service.processCommand('purple monkey dishwasher')
    expect(unknown.intent).toBe('unknown')
    expect(unknown.confidence).toBe(0)
  })

  it('keeps a bounded voice-command history', async () => {
    const service = new NLPService()
    for (let index = 0; index < 205; index += 1) {
      await service.processVoiceCommand('undo')
    }
    expect(service.getVoiceCommands()).toHaveLength(200)
  })
})

describe('NLPService suggestions', () => {
  const context = (components: Component[], wires: Wire[] = []) => ({
    components,
    wires,
    nets: [] as Net[],
  })

  it('asks for a bypass capacitor when an IC has no capacitor on its net', async () => {
    const service = new NLPService()
    const suggestions = await service.generateSmartSuggestions(
      context([component('u1', 'MCU', 'Microcontroller'), component('c1', '100nF', 'Capacitor')]),
    )
    expect(suggestions.some(suggestion => suggestion.id === 'bypass_u1')).toBe(true)
  })

  it('does not ask for a bypass capacitor when one shares the IC net', async () => {
    const service = new NLPService()
    const suggestions = await service.generateSmartSuggestions(
      context(
        [component('u1', 'MCU', 'Microcontroller'), component('c1', '100nF', 'Capacitor')],
        [wire('vcc', ['u1', 'c1'])],
      ),
    )
    expect(suggestions.some(suggestion => suggestion.id === 'bypass_u1')).toBe(false)
  })
})

describe('NLPService predictive insights', () => {
  it('returns no insights when no component declares the underlying data', async () => {
    const service = new NLPService()
    const insights = await service.generatePredictiveInsights({
      components: [component('r1', 'R1', 'Resistor'), component('r2', 'R2', 'Resistor')],
    })
    expect(insights).toEqual([])
  })

  it('sums only declared power and reports data coverage as confidence', async () => {
    const service = new NLPService()
    const insights = await service.generatePredictiveInsights({
      components: [
        component('r1', 'R1', 'Resistor', { power: 2 }),
        component('r2', 'R2', 'Resistor', { power: 1 }),
        component('r3', 'R3', 'Resistor'),
      ],
    })
    const performance = insights.find(insight => insight.type === 'performance')
    expect(performance?.data.powerW).toBe(3)
    expect(performance?.confidence).toBeCloseTo(2 / 3, 9)
    // No default cost is invented for components that do not declare one.
    expect(insights.some(insight => insight.type === 'cost')).toBe(false)
  })

  it('computes a series MTBF only when every component declares one', async () => {
    const service = new NLPService()
    const partial = await service.generatePredictiveInsights({
      components: [
        component('r1', 'R1', 'Resistor', { mtbfHours: 10000 }),
        component('r2', 'R2', 'Resistor'),
      ],
    })
    expect(partial.some(insight => insight.type === 'reliability')).toBe(false)

    const complete = await service.generatePredictiveInsights({
      components: [
        component('r1', 'R1', 'Resistor', { mtbfHours: 10000 }),
        component('r2', 'R2', 'Resistor', { mtbfHours: 10000 }),
      ],
    })
    const reliability = complete.find(insight => insight.type === 'reliability')
    expect(reliability?.data.mtbfH).toBe(5000)
  })
})

describe('NLPService ML registry', () => {
  it('refuses to invent a prediction without an inference backend', async () => {
    const service = new NLPService()
    await expect(service.predictWithModel('component_recommender')).rejects.toThrow(/not trained/)

    await service.trainMLModel('component_recommender', [{ power: 1, cost: 2 }])
    const model = service.getMLModels().find(candidate => candidate.id === 'component_recommender')
    expect(model?.trained).toBe(true)
    expect(model?.accuracy).toBe(0)
    await expect(service.predictWithModel('component_recommender')).rejects.toThrow(/no inference backend/)
  })

  it('rejects training with an empty dataset', async () => {
    const service = new NLPService()
    await expect(service.trainMLModel('component_recommender', [])).rejects.toThrow(/No training samples/)
  })
})
