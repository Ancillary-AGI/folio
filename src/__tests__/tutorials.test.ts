import { describe, expect, it } from 'vitest'
import { DEMO_SCENARIOS } from '../lib/demo/demoScenarios'
import { WORKSPACE_MODE_META } from '../lib/workspace/modes'
import {
  TUTORIALS,
  describeTutorialProgress,
  getTutorial,
  readTutorialProgress,
  writeTutorialProgress,
  type Tutorial,
} from '../lib/tutorials/tutorials'

const demoIds = new Set(DEMO_SCENARIOS.map((scenario) => scenario.id))

describe('tutorial catalogue', () => {
  it('names each tutorial once and resolves it by id', () => {
    const ids = TUTORIALS.map((tutorial) => tutorial.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(getTutorial(TUTORIALS[0].id)).toBe(TUTORIALS[0])
    expect(getTutorial('missing')).toBeUndefined()
  })

  it('starts every tutorial from a real demo scenario', () => {
    for (const tutorial of TUTORIALS) {
      expect(demoIds.has(tutorial.demoId), `${tutorial.id} names ${tutorial.demoId}`).toBe(true)
    }
  })

  it('has at least four steps, each naming a real workspace and concrete copy', () => {
    for (const tutorial of TUTORIALS) {
      expect(tutorial.steps.length, tutorial.id).toBeGreaterThanOrEqual(4)
      expect(tutorial.minutes).toBeGreaterThan(0)
      expect(tutorial.summary.trim().length).toBeGreaterThan(30)
      for (const step of tutorial.steps) {
        expect(step.title.trim().length, tutorial.id).toBeGreaterThan(0)
        expect(step.do.trim().length, tutorial.id).toBeGreaterThan(20)
        expect(step.see.trim().length, tutorial.id).toBeGreaterThan(20)
        expect(WORKSPACE_MODE_META[step.mode], `${tutorial.id}: ${step.mode}`).toBeDefined()
      }
    }
  })

  it('lists exactly the workspaces its steps visit, in first-visit order', () => {
    for (const tutorial of TUTORIALS) {
      const visited: string[] = []
      for (const step of tutorial.steps) {
        if (!visited.includes(step.mode)) visited.push(step.mode)
      }
      expect([...tutorial.modes], tutorial.id).toEqual(visited)
    }
  })

  it('covers the design, electrical, mechanical and ops families', () => {
    const groups = new Set(TUTORIALS.flatMap((tutorial) => tutorial.modes.map((mode) => WORKSPACE_MODE_META[mode].group)))
    expect(groups.has('design')).toBe(true)
    expect(groups.has('electrical')).toBe(true)
    expect(groups.has('mechanical')).toBe(true)
    expect(groups.has('ops')).toBe(true)
  })
})

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}

describe('tutorial progress', () => {
  const tutorial: Tutorial = TUTORIALS[0]

  it('round-trips a step and a completion flag', () => {
    const storage = new MemoryStorage()
    expect(readTutorialProgress(tutorial.id, storage)).toBeNull()
    writeTutorialProgress(tutorial.id, { step: 2, completed: false, updatedAt: '2026-10-28T10:00:00.000Z' }, storage)
    expect(readTutorialProgress(tutorial.id, storage)).toEqual({
      step: 2,
      completed: false,
      updatedAt: '2026-10-28T10:00:00.000Z',
    })
  })

  it('ignores malformed or impossible records instead of throwing', () => {
    const storage = new MemoryStorage()
    storage.setItem(`folio.tutorial.${tutorial.id}`, '{not json')
    expect(readTutorialProgress(tutorial.id, storage)).toBeNull()
    storage.setItem(`folio.tutorial.${tutorial.id}`, JSON.stringify({ step: 'two', completed: false }))
    expect(readTutorialProgress(tutorial.id, storage)).toBeNull()
    storage.setItem(`folio.tutorial.${tutorial.id}`, JSON.stringify({ step: 1.7, completed: false }))
    expect(readTutorialProgress(tutorial.id, storage)?.step).toBe(1)
  })

  it('describes where the engineer stopped without inventing progress', () => {
    expect(describeTutorialProgress(tutorial, null)).toBeNull()
    expect(describeTutorialProgress(tutorial, { step: 0, completed: false, updatedAt: '' })).toBe('Not started')
    expect(describeTutorialProgress(tutorial, { step: 2, completed: false, updatedAt: '' })).toBe(
      `Resume at step 3 of ${tutorial.steps.length}`,
    )
    expect(describeTutorialProgress(tutorial, { step: 6, completed: true, updatedAt: '' })).toBe('Completed')
  })

  it('survives a storage that refuses writes', () => {
    const blocked = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota')
      },
    }
    expect(() => writeTutorialProgress('any', { step: 0, completed: false, updatedAt: '' }, blocked)).not.toThrow()
  })
})
