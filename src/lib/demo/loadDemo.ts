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

const BOARD_LOADS = new Set<DemoScenario['load']>(['demo-board', 'pcb-autoroute', 'demo-pcb', 'rectifier-transient'])
/** Board scenarios that also hand their panel a one-shot run request. */
const BOARD_REQUESTS = new Set<DemoScenario['load']>(['pcb-autoroute', 'rectifier-transient'])

export function isBoardDemoLoad(load: DemoScenario['load']): boolean {
  return Boolean(load && BOARD_LOADS.has(load))
}

export function loadBoardDemo(title = 'Untitled schematic'): void {
  const board = buildDemoBoard()
  const now = new Date().toISOString()
  useAppStore.getState().clearSelection()
  useProjectStore.setState({
    components: board.components,
    wires: board.wires,
    // The sheet's title block reads this, so a demo screenshot names the
    // circuit instead of showing a generic empty title.
    currentSchematic: {
      id: 'demo-schematic',
      project_id: 'demo-project',
      name: title,
      order_index: 0,
      created_at: now,
      updated_at: now,
    },
    isDirty: true,
    liveFrame: null,
  })
}

export function loadDemoScenario(scenario: DemoScenario): void {
  const app = useAppStore.getState()

  if (scenario.load && BOARD_LOADS.has(scenario.load)) {
    loadBoardDemo(scenario.title)
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

  // `pcb-autoroute` and `rectifier-transient` are board loads *and* panel
  // requests: the board arrives wired, then the panel runs its demo once it
  // mounts. A scenario may also name a request explicitly when its load is
  // only the board.
  const request =
    scenario.request ??
    (scenario.load && BOARD_REQUESTS.has(scenario.load) ? scenario.load : null) ??
    (scenario.load && !BOARD_LOADS.has(scenario.load) ? scenario.load : null)
  if (request) app.requestDemo(request)

  if (scenario.load && BOARD_LOADS.has(scenario.load)) {
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('folio:fit-view')))
  }
}
