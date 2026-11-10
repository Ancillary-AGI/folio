import { beforeEach, describe, expect, it } from 'vitest'
import { offlineProjectStore } from './offlineProjectStore'

describe('offlineProjectStore', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('persists projects and canvas data between reads', () => {
    const project = offlineProjectStore.create('offline-user', 'Local design')
    const canvasData = { components: [{ id: 'part-1' }], wires: [], viewport: { zoom: 2 } }

    offlineProjectStore.saveCanvas(project.id, canvasData)

    expect(offlineProjectStore.list()).toHaveLength(1)
    expect(offlineProjectStore.get(project.id)?.canvas_data).toEqual(canvasData)
  })

  it('deletes a project without affecting other projects', () => {
    const first = offlineProjectStore.create('offline-user', 'First')
    const second = offlineProjectStore.create('offline-user', 'Second')

    offlineProjectStore.delete(first.id)

    expect(offlineProjectStore.get(first.id)).toBeUndefined()
    expect(offlineProjectStore.get(second.id)?.name).toBe('Second')
  })

  it('renames a project and leaves its canvas and its siblings alone', () => {
    const first = offlineProjectStore.create('offline-user', 'First')
    const second = offlineProjectStore.create('offline-user', 'Second')
    const canvas = { components: [{ id: 'part-1' }], wires: [] }
    offlineProjectStore.saveCanvas(first.id, canvas)

    const renamed = offlineProjectStore.rename(first.id, '  Amplifier Rev B  ')

    expect(renamed?.name).toBe('Amplifier Rev B')
    expect(offlineProjectStore.get(first.id)?.name).toBe('Amplifier Rev B')
    expect(offlineProjectStore.get(first.id)?.canvas_data).toEqual(canvas)
    expect(offlineProjectStore.get(second.id)?.name).toBe('Second')
    // The list is ordered by modification time, so the renamed project leads it.
    expect(offlineProjectStore.list()[0].id).toBe(first.id)
  })

  it('refuses a blank name and a project that is not in the workspace', () => {
    const project = offlineProjectStore.create('offline-user', 'Keeps its name')

    expect(offlineProjectStore.rename(project.id, '   ')).toBeUndefined()
    expect(offlineProjectStore.rename('local-does-not-exist', 'Renamed')).toBeUndefined()

    expect(offlineProjectStore.get(project.id)?.name).toBe('Keeps its name')
  })
})