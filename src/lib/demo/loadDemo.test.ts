import { beforeEach, describe, expect, it } from 'vitest'
import { findScenario } from './demoScenarios'
import { isBoardDemoLoad, loadBoardDemo, loadDemoScenario } from './loadDemo'
import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'

const scenario = (id: string) => {
  const found = findScenario(id)
  if (!found) throw new Error(`Missing demo scenario ${id}`)
  return found
}

describe('loadDemoScenario', () => {
  beforeEach(() => {
    useAppStore.setState({ workspaceMode: 'schematic', demoRequest: null })
    useProjectStore.setState({ components: [], wires: [], pcbLayout: null })
  })

  it('loads the board and its routed layout for the PCB demo', () => {
    loadDemoScenario(scenario('rectifier-pcb'))

    expect(useAppStore.getState().workspaceMode).toBe('pcb')
    expect(useAppStore.getState().demoRequest).toBeNull()
    expect(useProjectStore.getState().components).toHaveLength(6)
    expect(useProjectStore.getState().wires.length).toBeGreaterThan(0)
    expect(useProjectStore.getState().pcbLayout?.traces.length).toBeGreaterThan(0)
    expect(isBoardDemoLoad('pcb-autoroute')).toBe(true)
  })

  it('stages a panel-only demo without replacing the sheet', () => {
    loadDemoScenario(scenario('rf-filter'))

    expect(useAppStore.getState().workspaceMode).toBe('rf')
    expect(useAppStore.getState().demoRequest).toBe('rf-filter')
    expect(useProjectStore.getState().components).toHaveLength(0)
  })

  it('stages the routed 3-D scene and drops any stale panel request', () => {
    useAppStore.setState({ demoRequest: 'stale-request' })
    loadDemoScenario(scenario('rectifier-3d'))

    expect(useAppStore.getState().workspaceMode).toBe('preview3d')
    expect(useAppStore.getState().demoRequest).toBeNull()
    expect(useProjectStore.getState().pcbLayout?.traces.length).toBeGreaterThan(0)
  })

  it('publishes the four-layer showcase board without touching the sheet', () => {
    loadBoardDemo('Sheet I was already editing')
    const before = useProjectStore.getState().components

    loadDemoScenario(scenario('showcase-4l-3d'))

    const layout = useProjectStore.getState().pcbLayout
    expect(useAppStore.getState().demoRequest).toBeNull()
    expect(useProjectStore.getState().components).toBe(before)
    expect(layout?.components).toHaveLength(46)
    // Two buried pours is what makes this a four-layer board, not a slab.
    expect(layout?.layers.filter((layer) => layer.net)).toHaveLength(2)
    expect(layout?.pours).toHaveLength(2)
    expect(layout?.traces.length).toBeGreaterThan(40)
  })
})
