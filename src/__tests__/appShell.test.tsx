/**
 * Application shell smoke tests.
 *
 * The suite historically exercised services and pure logic only — nothing ever
 * mounted the React tree. These tests boot `App` in offline mode (no Supabase
 * credentials) and assert the landmarks a first-run user sees: the schematic
 * workspace, the component library, the status bar, and the theme toggle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// SchematicCanvas drives a real Konva stage backed by a 2D canvas, which jsdom
// cannot provide. Stub that one leaf so the rest of the shell renders for real,
// while keeping the autosave contract reachable from a button.
vi.mock('../components/SchematicCanvas', () => ({
  default: function SchematicCanvasStub(props: { onSave?: (data: Record<string, unknown>) => void }) {
    return (
      <div data-testid="schematic-canvas">
        <button
          type="button"
          onClick={() => props.onSave?.({ components: [], wires: [], viewport: { zoom: 1 } })}
        >
          Autosave canvas snapshot
        </button>
      </div>
    )
  },
}))

import App from '../App'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import { offlineProjectStore } from '../lib/offlineProjectStore'
import { buildDemoBoard } from '../lib/demo/demoBoard'
import { getUsageEvents, resetUsageLedger } from '../lib/admin/usageLedger'
import { ONBOARDING_STEP_COUNT } from '../lib/onboarding/onboardingSteps'

const ONBOARDING_COMPLETED_KEY = 'folio.onboarding.completed.v2'
const themeToggleName = /^switch to (dark|light) theme$/i

beforeEach(() => {
  localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
  // The usage ledger is a module singleton backed by localStorage; tour tests
  // read it, so every case starts from an empty one.
  resetUsageLedger()
  // Projects persist in localStorage, and earlier tests create some. Start each
  // test from the first-run state so the empty project list is deterministic.
  localStorage.removeItem('folio.offlineProjects')
  // Zustand stores are module singletons — never assume the previous test's project or tool.
  useProjectStore.setState({ currentProject: null, currentSchematic: null, components: [], wires: [], isDirty: false })
  useAppStore.setState({ activeTool: 'select', workspaceMode: 'schematic', sidebarOpen: true, aiChatOpen: false })
  window.history.replaceState(null, '', '/')
})

describe('App shell', () => {
  it('boots into the offline schematic workspace', async () => {
    render(<App />)

    // Without a project the app parks on the offline project landing.
    expect(await screen.findByRole('button', { name: /create project/i })).toBeInTheDocument()

    // Create a project offline to cross into the IDE layout.
    fireEvent.click(screen.getAllByRole('button', { name: /create project/i })[0])

    // Default workspace mode routes to the schematic canvas.
    expect(await screen.findByTestId('schematic-canvas')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Schematic' })).toHaveAttribute('aria-current', 'page')

    // Offline component library and status-bar landmarks.
    expect(screen.getByRole('complementary', { name: 'Component library' })).toBeInTheDocument()
    expect(screen.getByText('Resistor')).toBeInTheDocument()
    expect(screen.getByText(/PARTS/)).toBeInTheDocument()

    // Header chrome: the theme control is present in the IDE too.
    expect(screen.getAllByRole('button', { name: themeToggleName }).length).toBeGreaterThan(0)
  })

  it('opens the help centre from the header and from F1', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])
    await screen.findByTestId('schematic-canvas')

    fireEvent.click(screen.getByRole('button', { name: 'Help and tutorials' }))
    expect(await screen.findByRole('dialog', { name: 'Help and tutorials' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close help' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Help and tutorials' })).not.toBeInTheDocument(),
    )

    fireEvent.keyDown(window, { key: 'F1' })
    expect(await screen.findByRole('dialog', { name: 'Help and tutorials' })).toBeInTheDocument()
  })

  it('opens the administration console from a deep link and returns to projects', async () => {
    window.history.replaceState(null, '', '/admin')
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Administration' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back to projects' }))

    expect(await screen.findByRole('button', { name: /create project/i })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/projects')
  })

  it('keeps firmware, simulation history, and the routed board on save', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])
    await screen.findByTestId('schematic-canvas')
    const project = useProjectStore.getState().currentProject
    expect(project).not.toBeNull()
    const layout = {
      widthMm: 20, heightMm: 10, thicknessMm: 1.6,
      layers: [], traces: [], vias: [], components: [],
    }

    useProjectStore.setState({
      firmwareCode: 'void setup() {}',
      simulationRuns: [
        { id: 'run-1', name: 'DC sweep', type: 'dc', parameters: {}, status: 'complete', createdAt: 1 },
      ],
      pcbLayout: layout,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Autosave canvas snapshot' }))

    await waitFor(() => {
      const saved = offlineProjectStore.get(project!.id)
      expect(saved?.canvas_data?.firmwareCode).toBe('void setup() {}')
      expect(saved?.canvas_data?.simulationRuns).toEqual([
        { id: 'run-1', name: 'DC sweep', type: 'dc', parameters: {}, status: 'complete', createdAt: 1 },
      ])
      expect(saved?.canvas_data?.pcbLayout).toEqual(layout)
    })
  })

  it('restores the routed board when a saved project is reopened', async () => {
    const view = render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])
    await screen.findByTestId('schematic-canvas')
    const project = useProjectStore.getState().currentProject
    expect(project).not.toBeNull()
    const layout = {
      widthMm: 30, heightMm: 15, thicknessMm: 1.6,
      layers: [], traces: [], vias: [], components: [],
    }

    useProjectStore.setState({ pcbLayout: layout })
    fireEvent.click(screen.getByRole('button', { name: 'Autosave canvas snapshot' }))
    await waitFor(() => expect(offlineProjectStore.get(project!.id)?.canvas_data?.pcbLayout).toEqual(layout))

    useProjectStore.setState({
      liveFrame: { time: 0.4, voltages: {}, glow: {}, lit: {} },
      isSimulating: true,
    })
    view.unmount()
    useProjectStore.setState({ currentProject: null, pcbLayout: null })
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /^open /i }))[0])

    await screen.findByTestId('schematic-canvas')
    expect(useProjectStore.getState().pcbLayout).toEqual(layout)
    expect(useProjectStore.getState().liveFrame).toBeNull()
    expect(useProjectStore.getState().isSimulating).toBe(false)
  })

  it('keeps secondary tools reachable from the compact More menu', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])

    fireEvent.click(await screen.findByRole('button', { name: 'More tools' }))
    const menu = screen.getByRole('menu', { name: 'More tools' })
    expect(within(menu).getByRole('menuitem', { name: 'Settings' })).toBeInTheDocument()

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'AI Assistant' }))
    expect(useAppStore.getState().aiChatOpen).toBe(true)
  })

  it('closes the component library from its palette close button', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])

    expect(await screen.findByRole('complementary', { name: 'Component library' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close component library' }))
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Component library' })).not.toBeInTheDocument(),
    )
  })

  it('keeps the deep-linked workspace encoded in the URL', async () => {
    // A bookmarked/reloaded tab must win over the persisted default mode; the
    // URL writer previously fired before the location reader and snapped this to /.
    window.history.replaceState(null, '', '/bom')
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])

    expect(await screen.findByRole('button', { name: 'BOM' })).toHaveAttribute('aria-current', 'page')
    expect(window.location.pathname.endsWith('/bom')).toBe(true)
  })

  it('moves between a project and the project list with clean history routes', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])
    await screen.findByTestId('schematic-canvas')

    const project = useProjectStore.getState().currentProject
    expect(project).not.toBeNull()
    expect(window.location.pathname).toBe(`/projects/${project!.id}`)

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(await screen.findByRole('heading', { name: 'Your Projects' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/projects')
    expect(window.location.hash).toBe('')
  })

  it('opens the guide on first run and can be dismissed', async () => {
    localStorage.removeItem(ONBOARDING_COMPLETED_KEY)
    render(<App />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Close the guide' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true')
  })

  // Settings, the tour and the limits dialog are three lazy chunks plus a
  // guided restart in one case; the default 10 s is not a budget this flow has
  // ever reliably fit into on a loaded machine.
  it('hands the guide over to the limits register instead of stacking them', async () => {
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /create project/i })[0])
    await screen.findByTestId('schematic-canvas')

    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Restart guided setup' }, { timeout: 20000 }))
    await screen.findByRole('dialog', { name: /one project/i }, { timeout: 5000 })

    // Reading the register is the point of the last step, so opening it from the
    // status bar must not leave a coach mark hovering over the panel.
    fireEvent.click(screen.getByRole('button', { name: 'LIMITS' }))
    expect(await screen.findByRole('dialog', { name: 'Capabilities and limits' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /one project/i })).not.toBeInTheDocument(),
    )
  }, 30000)

  it('restarts the guide from Settings', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    // SettingsPanel is a lazy chunk; a loaded CI box can take well over the
    // default 1 s to fetch and mount it after the whole suite has run.
    fireEvent.click(await screen.findByRole('button', { name: 'Restart guided setup' }, { timeout: 20000 }))

    expect(await screen.findByRole('dialog', { name: /one project/i }, { timeout: 5000 })).toBeInTheDocument()
  })

  it('keeps the forward controls equal height in a fixed footer row', async () => {
    const { default: OnboardingTour } = await import('../components/OnboardingTour')
    const setStepIndex = vi.fn()
    const onCreateProject = vi.fn()
    // First run with no project: creating one is an explicit, labelled choice,
    // and the inert Back slot carries the non-mutating forward move instead, so
    // the pointer and the right-arrow key do the same thing.
    render(
      <OnboardingTour
        onClose={() => {}}
        onCreateProject={onCreateProject}
        onLoadSampleCircuit={() => {}}
        onLoadDemoBoard={() => {}}
        onOpenLimits={() => {}}
        hasProject={false}
        stepIndex={0}
        setStepIndex={setStepIndex}
      />,
    )

    const dialog = await screen.findByRole('dialog')
    const readOn = screen.getByRole('button', { name: 'Keep reading' })
    const create = screen.getByRole('button', { name: /^new project$/i })
    expect(screen.queryByRole('button', { name: 'Previous step' })).not.toBeInTheDocument()
    expect(dialog).toContainElement(readOn)
    expect(dialog).toContainElement(create)
    // Shared CAD footer classes: fixed row, grid pair, equal heights.
    expect(readOn.closest('.cad-footer-row')).not.toBeNull()
    expect(create.closest('.cad-action-pair')).not.toBeNull()
    expect(create.getBoundingClientRect().height).toBe(readOn.getBoundingClientRect().height)

    fireEvent.click(readOn)
    expect(setStepIndex).toHaveBeenCalledWith(1)
    expect(onCreateProject).not.toHaveBeenCalled()
  })

  it('shows Back and Continue once a project is open', async () => {
    const { default: OnboardingTour } = await import('../components/OnboardingTour')
    render(
      <OnboardingTour
        onClose={() => {}}
        onCreateProject={() => {}}
        onLoadSampleCircuit={() => {}}
        onLoadDemoBoard={() => {}}
        onOpenLimits={() => {}}
        hasProject
        stepIndex={3}
        setStepIndex={() => {}}
      />,
    )

    await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: 'Previous step' })).toBeEnabled()
    expect(screen.getByRole('button', { name: /^Continue$/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Keep reading' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^new project$/i })).not.toBeInTheDocument()
  })

  it('keeps offering the project choice while no design is open', async () => {
    const { default: OnboardingTour } = await import('../components/OnboardingTour')
    const setStepIndex = vi.fn()
    // A guide resumed on the launcher has no sheet, rail or canvas to spotlight.
    // The offer to create a design stays on every step, and the dot rail keeps the
    // visited steps reachable in place of Back.
    render(
      <OnboardingTour
        onClose={() => {}}
        onCreateProject={() => {}}
        onLoadSampleCircuit={() => {}}
        onLoadDemoBoard={() => {}}
        onOpenLimits={() => {}}
        hasProject={false}
        stepIndex={5}
        setStepIndex={setStepIndex}
      />,
    )

    await screen.findByRole('dialog')
    expect(screen.getByRole('button', { name: /^new project$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep reading' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Previous step' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Reviewed step 1:/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep reading' }))
    expect(setStepIndex).toHaveBeenCalledWith(6)
  })

  it('records a guide closed early as an exit, not as a finished tour', async () => {
    localStorage.removeItem(ONBOARDING_COMPLETED_KEY)
    render(<App />)
    await screen.findByRole('dialog')

    // Two cards opened, then the card was closed: the ledger must not claim the
    // curriculum was finished, nor that every step was read.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Upcoming step ${ONBOARDING_STEP_COUNT}:`) }))
    fireEvent.click(screen.getByRole('button', { name: 'Close the guide' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const tourEvents = getUsageEvents().filter((event) => event.kind.startsWith('onboarding'))
    expect(tourEvents.map((event) => event.kind)).toEqual(['onboarding.exit'])
    expect(tourEvents[0]?.detail).toMatchObject({
      steps: 2,
      total: ONBOARDING_STEP_COUNT,
      reason: 'dismissed',
    })
  })

  it('records one completion when the guide hands over to the register', async () => {
    localStorage.removeItem(ONBOARDING_COMPLETED_KEY)
    render(<App />)
    await screen.findByRole('dialog')

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Upcoming step ${ONBOARDING_STEP_COUNT}:`) }))
    fireEvent.click(await screen.findByRole('button', { name: /open capabilities and limits/i }))
    expect(await screen.findByRole('dialog', { name: 'Capabilities and limits' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /one project/i })).not.toBeInTheDocument())

    // The hand-off closes the tour from the card and the shell in one click; only
    // the card's own exit may reach the ledger.
    const tourEvents = getUsageEvents().filter((event) => event.kind.startsWith('onboarding'))
    expect(tourEvents.map((event) => event.kind)).toEqual(['onboarding.complete'])
    expect(tourEvents[0]?.detail).toMatchObject({ steps: 2, total: ONBOARDING_STEP_COUNT })
    expect(tourEvents[0]?.detail?.reason).toBeUndefined()
  })

  it('arms the wire tool on the rail (click-to-click wiring)', async () => {
    const { default: ToolRail } = await import('../components/workspace/ToolRail')
    const { useAppStore } = await import('../stores/useAppStore')
    render(<ToolRail onSave={() => {}} />)
    const wire = screen.getByRole('button', { name: 'Wire tool' })
    expect(wire).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(wire)
    expect(useAppStore.getState().activeTool).toBe('wire')
    expect(screen.getByRole('button', { name: 'Wire tool' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the simulation workspace from its tab and writes a bookmarkable route', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])

    fireEvent.click(await screen.findByRole('button', { name: 'Simulation' }))

    // SimulationPanel is a lazy chunk and its first mount compiles a large
    // module graph; allow for a fully loaded CI budget rather than 5 s.
    expect(await screen.findByText('Circuit Simulation', {}, { timeout: 20000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simulation' })).toHaveAttribute('aria-current', 'page')
    expect(window.location.pathname.endsWith('/simulation')).toBe(true)
  }, 30000)

  it('toggles the color theme from the header', async () => {
    render(<App />)

    const toggles = await screen.findAllByRole('button', { name: themeToggleName })
    const labelBefore = toggles[0].getAttribute('aria-label') ?? ''
    // The label names the theme you would switch TO, so a "dark" label means
    // the app is currently light and will flip to dark on click.
    const expectedAfter = /dark/i.test(labelBefore) ? 'light' : 'dark'

    fireEvent.click(toggles[0])

    await waitFor(() => {
      expect(
        screen.getAllByRole('button', { name: new RegExp(`switch to ${expectedAfter} theme`, 'i') }).length,
      ).toBeGreaterThan(0)
    })
  })

  it('commits two sheet versions and restores the earlier one from the version panel', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    try {
      render(<App />)
      fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])
      await screen.findByTestId('schematic-canvas')

      const board = buildDemoBoard()
      useProjectStore.setState({ components: board.components, wires: board.wires })

      fireEvent.click(screen.getByRole('button', { name: 'Version history' }))
      fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'full rectifier' } })
      fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

      expect(await screen.findByText('full rectifier')).toBeInTheDocument()

      // Diverge from the committed sheet, then record that state too.
      const reduced = board.components.slice(0, -1)
      useProjectStore.setState({ components: reduced })
      fireEvent.change(screen.getByLabelText('Commit message'), { target: { value: 'missing a part' } })
      fireEvent.click(screen.getByRole('button', { name: 'Commit' }))

      expect(await screen.findByText('missing a part')).toBeInTheDocument()
      expect(useProjectStore.getState().components).toHaveLength(reduced.length)

      fireEvent.click(screen.getByRole('button', { name: 'Restore full rectifier' }))

      await waitFor(() => {
        expect(useProjectStore.getState().components).toHaveLength(board.components.length)
      })
      expect(useProjectStore.getState().components.map((part) => part.reference)).toEqual(
        board.components.map((part) => part.reference),
      )
      expect(confirmSpy).toHaveBeenCalled()
    } finally {
      confirmSpy.mockRestore()
    }
  })
})
