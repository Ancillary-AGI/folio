/**
 * Bootstraps a demo scenario into the live stores.
 *
 * Board-based demos replace the schematic with the tested rectifier and clear
 * transient canvas state. Panel-local demos leave the sheet alone and hand the
 * open panel a one-shot request it consumes on mount. Navigation always happens
 * last, so a panel reads the already-prepared state.
 */
import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { buildDemoBoard } from './demoBoard'
import { buildDemoPcb } from './demoPcb'
import type { DemoScenario } from './demoScenarios'

const BOARD_LOADS = new Set<DemoScenario['load']>(['demo-board', 'pcb-autoroute', 'demo-pcb'])

export function isBoardDemoLoad(load: DemoScenario['load']): boolean {
  return Boolean(load && BOARD_LOADS.has(load))
}

export function loadBoardDemo(): void {
  const board = buildDemoBoard()
  useAppStore.getState().clearSelection()
  useProjectStore.setState({
    components: board.components,
    wires: board.wires,
    isDirty: true,
    liveFrame: null,
  })
}

export function loadDemoScenario(scenario: DemoScenario): void {
  const app = useAppStore.getState()

  if (scenario.load && BOARD_LOADS.has(scenario.load)) {
    loadBoardDemo()
  }

  if (scenario.load === 'demo-pcb') {
    const pcb = buildDemoPcb()
    useProjectStore.setState({ pcbLayout: pcb.scene })
  } else if (scenario.load && BOARD_LOADS.has(scenario.load)) {
    // A previous 3-D demo must not linger behind a different board.
    useProjectStore.setState({ pcbLayout: null })
  }

  // Mode first (which clears stale requests), then the fresh bootstrap.
  app.setWorkspaceMode(scenario.mode)

  // `pcb-autoroute` is a board load *and* a panel request: the board arrives
  // wired, then the PCB panel runs the router once it mounts.
  if (scenario.load === 'pcb-autoroute') {
    app.requestDemo(scenario.load)
  } else if (scenario.load && !BOARD_LOADS.has(scenario.load)) {
    app.requestDemo(scenario.load)
  }

  if (scenario.load && BOARD_LOADS.has(scenario.load)) {
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('folio:fit-view')))
  }
}
