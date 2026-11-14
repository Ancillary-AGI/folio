/**
 * Bootstraps a demo scenario into the live stores.
 *
 * Board-based demos replace the schematic with the tested rectifier or LED
 * flasher and clear transient canvas state. Layout-only demos publish a routed
 * board and leave the sheet alone. Panel-local demos leave both and hand the
 * open panel a one-shot request it consumes on mount. Navigation always
 * happens last, so a panel reads the already-prepared state.
 */
import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { buildDemoBoard } from './demoBoard'
import { buildDemoPcb } from './demoPcb'
import { buildBlinkBoard } from './demoBlinkBoard'
import { buildBlinkPcb } from './demoBlinkPcb'
import { buildShowcasePcb } from './demoShowcase'
import { buildLaptopPcb } from './demoLaptopBoard'
import type { DemoScenario } from './demoScenarios'
import type { PcbSceneInput } from '../pcb/pcbScene'

const BOARD_LOADS = new Set<DemoScenario['load']>(['demo-board', 'pcb-autoroute', 'demo-pcb', 'rectifier-transient', 'blinker-board', 'blinker-pcb'])
/** Board scenarios that also hand their panel a one-shot run request. */
const BOARD_REQUESTS = new Set<DemoScenario['load']>(['pcb-autoroute', 'rectifier-transient'])
/**
 * Loads that publish a finished routed layout into the store. `showcase-pcb` is
 * layout-only: its 46-part netlist lives in the board, not on the sheet, so it
 * must not overwrite the schematic the user was editing. `laptop-pcb` is the same
 * kind of board — 56 parts whose netlist is the mainboard itself.
 */
const LAYOUT_LOADS = new Set<DemoScenario['load']>(['demo-pcb', 'showcase-pcb', 'laptop-pcb', 'blinker-pcb'])

export function isBoardDemoLoad(load: DemoScenario['load']): boolean {
  return Boolean(load && BOARD_LOADS.has(load))
}

function buildLayout(load: DemoScenario['load']): PcbSceneInput {
  if (load === 'showcase-pcb') return buildShowcasePcb().scene
  if (load === 'laptop-pcb') return buildLaptopPcb().scene
  if (load === 'blinker-pcb') return buildBlinkPcb().scene
  return buildDemoPcb().scene
}

const BOARD_BUILDERS: Partial<Record<NonNullable<DemoScenario['load']>, () => { components: ReturnType<typeof buildDemoBoard>['components']; wires: ReturnType<typeof buildDemoBoard>['wires'] }>> = {
  'blinker-board': buildBlinkBoard,
  'blinker-pcb': buildBlinkBoard,
}

function sheetId(load: DemoScenario['load']): string {
  return load === 'blinker-board' || load === 'blinker-pcb' ? 'blinker-schematic' : 'demo-schematic'
}

export function loadBoardDemo(title = 'Untitled schematic', load: DemoScenario['load'] = 'demo-board'): void {
  const board = (load && BOARD_BUILDERS[load])?.() ?? buildDemoBoard()
  const now = new Date().toISOString()
  useAppStore.getState().clearSelection()
  useProjectStore.setState({
    components: board.components,
    wires: board.wires,
    // The sheet's title block reads this, so a demo screenshot names the
    // circuit instead of showing a generic empty title.
    currentSchematic: {
      id: sheetId(load),
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
    loadBoardDemo(scenario.title, scenario.load)
  }

  if (scenario.load && LAYOUT_LOADS.has(scenario.load)) {
    useProjectStore.setState({ pcbLayout: buildLayout(scenario.load) })
  } else if (scenario.load && BOARD_LOADS.has(scenario.load)) {
    // A previous 3-D demo must not linger behind a different board.
    useProjectStore.setState({ pcbLayout: null })
  }

  // Mode first (which clears stale requests), then the fresh bootstrap.
  app.setWorkspaceMode(scenario.mode)

  // `pcb-autoroute` and `rectifier-transient` are board loads *and* panel
  // requests: the board arrives wired, then the panel runs its demo once it
  // mounts. A scenario may also name a request explicitly when its load is
  // only the board. A layout load is fully handled here, so it must not also be
  // forwarded to the panel as a request nothing consumes.
  const request =
    scenario.request ??
    (scenario.load && BOARD_REQUESTS.has(scenario.load) ? scenario.load : null) ??
    (scenario.load && !BOARD_LOADS.has(scenario.load) && !LAYOUT_LOADS.has(scenario.load)
      ? scenario.load
      : null)
  if (request) app.requestDemo(request)

  if (scenario.load && BOARD_LOADS.has(scenario.load)) {
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('folio:fit-view')))
  }
}
