import { describe, expect, it } from 'vitest'
import { WORKSPACE_MODES } from '../workspace/modes'
import { DEMO_SCENARIOS } from './demoScenarios'

describe('demo catalog', () => {
  it('covers every workspace mode', () => {
    const covered = new Set(DEMO_SCENARIOS.map((scenario) => scenario.mode))
    for (const mode of WORKSPACE_MODES) {
      expect(covered.has(mode.id), `no demo for workspace "${mode.id}"`).toBe(true)
    }
  })

  it('has unique ids and non-empty card content', () => {
    const ids = new Set<string>()
    for (const scenario of DEMO_SCENARIOS) {
      expect(ids.has(scenario.id), `duplicate demo id "${scenario.id}"`).toBe(false)
      ids.add(scenario.id)
      expect(scenario.title.trim().length).toBeGreaterThan(0)
      expect(scenario.summary.trim().length).toBeGreaterThan(0)
      expect(scenario.proves.length).toBeGreaterThan(0)
    }
  })

  it('points each scenario at its owning workspace family', () => {
    const groupByMode = new Map(WORKSPACE_MODES.map((mode) => [mode.id, mode.group]))
    for (const scenario of DEMO_SCENARIOS) {
      expect(scenario.group).toBe(groupByMode.get(scenario.mode))
    }
  })
})
