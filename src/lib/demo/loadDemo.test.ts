import { beforeEach, describe, expect, it } from 'vitest'
import { findScenario } from './demoScenarios'
import { isBoardDemoLoad, loadDemoScenario } from './loadDemo'
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

  it('loads the board and requests autorouting for the PCB demo', () => {
    loadDemoScenario(scenario('rectifier-pcb'))

    expect(useAppStore.getState().workspaceMode).toBe('pcb')
    expect(useAppStore.getState().demoRequest).toBe('pcb-autoroute')
    expect(useProjectStore.getState().components).toHaveLength(6)
    expect(useProjectStore.getState().wires.length).toBeGreaterThan(0)
    expect(useProjectStore.getState().pcbLayout).toBeNull()
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
})
