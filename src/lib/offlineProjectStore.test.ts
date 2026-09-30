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
})