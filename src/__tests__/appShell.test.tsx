/**
 * Application shell smoke tests.
 *
 * The suite historically exercised services and pure logic only — nothing ever
 * mounted the React tree. These tests boot `App` in offline mode (no Supabase
 * credentials) and assert the landmarks a first-run user sees: the schematic
 * workspace, the component library, the status bar, and the theme toggle.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

/*
 * These overlays are code-split in the app and the shell prefetches them while
 * it is idle. This suite asserts the open path, not chunk latency under a
 * parallel test run, so warm the same modules up front.
 */
beforeAll(async () => {
  await Promise.all([
    import('../components/help/HelpCenter'),
    import('../components/help/TutorialRunner'),
    import('../components/workspace/CommandPalette'),
  ])
})

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
    expect(within(screen.getByRole('contentinfo', { name: 'Workspace status' })).getByText(/Parts/)).toBeInTheDocument()

    // Header chrome: the theme control is present in the IDE too.
    expect(screen.getAllByRole('button', { name: themeToggleName }).length).toBeGreaterThan(0)
  })

  it('opens a family-tile project in that family\'s first workspace', async () => {
    render(<App />)

    // The launcher's family tiles are entry points, not a legend: pressing one
    // creates the project and lands on the workspace that family is built around.
    // The list has to finish reading before the tiles exist.
    await screen.findByRole('heading', { name: 'From first sketch to verified build.' })
    fireEvent.click(screen.getByRole('button', { name: /^Start a project in the Electrical family/ }))

    await waitFor(() => expect(useAppStore.getState().workspaceMode).toBe('control'))
    expect(screen.getByRole('button', { name: 'Control' })).toHaveAttribute('aria-current', 'page')
    expect(useProjectStore.getState().currentProject).not.toBeNull()
    expect(screen.queryByRole('heading', { name: 'From first sketch to verified build.' })).not.toBeInTheDocument()

    // And the ledger says which door was used, so the count is not a guess.
    const created = getUsageEvents().filter((event) => event.kind === 'project.create')
    expect(created).toHaveLength(1)
    expect(created[0]?.detail).toMatchObject({ storage: 'local', family: 'electrical' })
  })

  it('puts a skip link first in the tab order so keyboard users reach the workspace', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /create project/i }))[0])
    await screen.findByTestId('schematic-canvas')

    // WCAG 2.4.1: the header renders dozens of controls before the design sheet,
    // so the very first focusable thing must jump past them.
    const skip = screen.getByRole('link', { name: /skip to the workspace/i })
    const focusables = Array.from(document.querySelectorAll<HTMLElement>('body a[href], body button'))
    expect(focusables[0]).toBe(skip)

    expect(skip.getAttribute('href')).toBe('#workspace')
    expect(document.getElementById('workspace')?.tagName).toBe('MAIN')
  })

  it('opens the help centre from the header and from F1', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])
    await screen.findByTestId('schematic-canvas')

    fireEvent.click(screen.getByRole('button', { name: 'Help and tutorials' }))
    expect(
      await screen.findByRole('dialog', { name: 'Help and tutorials' }, { timeout: 15000 }),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close help' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Help and tutorials' })).not.toBeInTheDocument(),
    )

    fireEvent.keyDown(window, { key: 'F1' })
    expect(
      await screen.findByRole('dialog', { name: 'Help and tutorials' }, { timeout: 15000 }),
    ).toBeInTheDocument()
  })

  it('opens help and the command palette from the project launcher', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /create project/i })

    // The launcher advertises the same global shortcuts as the workbench, so it
    // has to mount the surfaces they open, not just the project list.
    fireEvent.keyDown(window, { key: 'F1' })
    expect(
      await screen.findByRole('dialog', { name: 'Help and tutorials' }, { timeout: 15000 }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close help' }))
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Help and tutorials' })).not.toBeInTheDocument(),
    )

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  })

  it('names the project list in the tab title instead of a workspace', async () => {
    window.history.replaceState(null, '', '/app/projects')
    render(<App />)
    await screen.findByRole('button', { name: /create project/i })

    // No design is open, so claiming the tab shows "Schematic" is a lie about
    // what the user is looking at.
    expect(document.title).toBe('Projects · Folio')

    fireEvent.click(screen.getAllByRole('button', { name: /create project/i })[0])
    await screen.findByTestId('schematic-canvas')
    const project = useProjectStore.getState().currentProject
    expect(document.title).toBe(`${project?.name} — Schematic · Folio`)
  })

  it('replaces an open overlay instead of stacking the next one', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /create project/i })

    fireEvent.keyDown(window, { key: 'F1' })
    await screen.findByRole('dialog', { name: 'Help and tutorials' }, { timeout: 15000 })

    // The palette and the help centre share the viewport, so a second shortcut
    // has to swap the surface rather than bury the first under a fresh scrim.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByRole('dialog', { name: 'Command palette' }, { timeout: 15000 })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Help and tutorials' })).not.toBeInTheDocument(),
    )

    fireEvent.keyDown(window, { key: 'F1' })
    expect(
      await screen.findByRole('dialog', { name: 'Help and tutorials' }, { timeout: 15000 }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument(),
    )
  })

  it('opens Settings with the IDE chord and dismisses it with Escape', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /create project/i })

    // Ctrl+, is the chord people already know from every editor; it replaces the
    // overlay that is up rather than stacking a second scrim on it.
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    await screen.findByRole('dialog', { name: 'Command palette' })
    fireEvent.keyDown(window, { key: ',', ctrlKey: true })
    const dialog = await screen.findByRole('dialog', { name: 'Settings' }, { timeout: 20000 })
    expect(within(dialog).getByRole('searchbox', { name: 'Search settings' })).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument(),
    )

    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Settings' })).not.toBeInTheDocument(),
    )
  })

  /*
   * `/admin` is its own Next.js route (`app/admin`), rendered outside the
   * workbench shell; the workbench bundle never claims it. In jsdom the SPA
   * simply has no admin route: rendering at /admin shows the launcher, and the
   * operator console is nowhere in it. routing.test.ts asserts the same
   * boundary in the parser.
   */
  it('does not claim /admin: the console is a separate document, so the workbench shows the launcher', async () => {
    window.history.replaceState(null, '', '/admin')
    render(<App />)
    expect(await screen.findByRole('button', { name: /create project/i })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Admin console' })).not.toBeInTheDocument()
  })

  it('keeps governance out of the app chrome entirely', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /create project/i })

    /*
     * `/admin` is the only door. The console used to advertise itself with a
     * button in the launcher header, and before that a row in the project's
     * overflow menu; governing accounts is neither of those things, so nothing
     * the designer sees may name it.
     */
    expect(screen.queryByRole('button', { name: /admin/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Admin console')).not.toBeInTheDocument()
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
    // This case mounts the shell twice, and the second mount rebuilds the board
    // from the restored layout, so it is one of the flows that needs the shell
    // suite's budget rather than a bare mount's.
  })

  it('keeps the bar to the tools used every session and folds the rest into words', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])
    await screen.findByTestId('schematic-canvas')

    const header = screen.getByRole('banner')
    expect(within(header).getByRole('button', { name: 'Ask Scribe' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Settings' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: 'Version history' })).toBeInTheDocument()

    // Two lookalike shields and a refresh-arrow standing in for "back" used to
    // sit here. They are labelled rows in the overflow menu now, and the
    // launcher button at the left of the bar is the only way out of a project.
    expect(within(header).queryByRole('button', { name: /security alerts/i })).not.toBeInTheDocument()
    expect(within(header).queryByRole('button', { name: 'Admin console' })).not.toBeInTheDocument()
    expect(within(header).queryByRole('button', { name: 'Back to Projects' })).not.toBeInTheDocument()

    fireEvent.click(within(header).getByRole('button', { name: 'More tools' }))
    const menu = screen.getByRole('menu', { name: 'More tools' })
    expect(within(menu).getByRole('menuitem', { name: /Activity log/ })).toBeInTheDocument()
    // Governance is not a design action. The console lives at `/admin` and no
    // bar — launcher or workspace — offers a door to it.
    expect(within(menu).queryByRole('menuitem', { name: 'Admin console' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('menuitem', { name: 'Back to Projects' })).toBeInTheDocument()

    // Each group is named for what its rows share. "Session" used to head voice
    // control and two workspace switches, which is not what it means.
    const groups = within(menu).getAllByRole('group').map((group) => group.getAttribute('aria-label'))
    expect(groups).toEqual(['Scribe', 'Workspaces', 'Project'])

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Simulation workspace' }))
    expect(useAppStore.getState().workspaceMode).toBe('simulation')
    // Choosing a row closes the menu, so it cannot sit over the workspace.
    expect(screen.queryByRole('menu', { name: 'More tools' })).not.toBeInTheDocument()
  })

  it('closes the component library from its palette close button', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])

    expect(await screen.findByRole('complementary', { name: 'Component library' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close the component library dock' }))
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: 'Component library' })).not.toBeInTheDocument(),
    )
  })

  it('keeps the deep-linked workspace encoded in the URL', async () => {
    // A bookmarked/reloaded tab must win over the persisted default mode; the
    // URL writer previously fired before the location reader and snapped this to /.
    window.history.replaceState(null, '', '/app/bom')
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])

    expect(await screen.findByRole('button', { name: 'BOM' })).toHaveAttribute('aria-current', 'page')
    expect(window.location.pathname.endsWith('/bom')).toBe(true)
    // Mounting the shell on a deep link also mounts the workspace the link
    // names, which is the heaviest single render in this file.
  })

  it('moves between a project and the project list with clean history routes', async () => {
    render(<App />)
    fireEvent.click((await screen.findAllByRole('button', { name: /new project/i }))[0])
    await screen.findByTestId('schematic-canvas')

    const project = useProjectStore.getState().currentProject
    expect(project).not.toBeNull()
    expect(window.location.pathname).toBe(`/app/projects/${project!.id}`)

    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/app/projects')
    expect(window.location.hash).toBe('')
    // Like the deep-link case above: creating a project mounts the schematic
    // workspace chunk and the project list unmounts it.
  })

  it('opens the guide on first run and can be dismissed', async () => {
    localStorage.removeItem(ONBOARDING_COMPLETED_KEY)
    render(<App />)

    // The guide is a tour around the workbench, not the launcher: it opens when
    // the first design is open. Create one to cross into the CAD.
    fireEvent.click(screen.getAllByRole('button', { name: /create project/i })[0])
    await screen.findByTestId('schematic-canvas')

    expect(await screen.findByRole('dialog', {}, { timeout: 15000 })).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Close the guide' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true')
  })

  // Settings, the tour and the limits dialog are three lazy chunks plus a
  // guided restart in one case, which is why the waits inside it are budgeted
  // per chunk rather than left at the 1 s findBy default.
  it('hands the guide over to the limits register instead of stacking them', async () => {
    render(<App />)
    fireEvent.click(screen.getAllByRole('button', { name: /create project/i })[0])
    await screen.findByTestId('schematic-canvas')

    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    fireEvent.click(await screen.findByRole('button', { name: 'Restart guided setup' }, { timeout: 20000 }))
    await screen.findByRole('dialog', { name: /this is your workbench/i }, { timeout: 5000 })

    // Reading the register is the point of the last step, so opening it from the
    // status bar must not leave a coach mark hovering over the panel.
    fireEvent.click(screen.getByRole('button', { name: 'Limits' }))
    // LimitsDialog is a lazy chunk; on a loaded CI box it can take longer than
    // the 1 s default to mount after the tour has already cost its budget.
    expect(
      await screen.findByRole('dialog', { name: 'Capabilities and limits' }, { timeout: 10000 }),
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /this is your workbench/i })).not.toBeInTheDocument(),
    )
    // The three lazy mounts it waits for cost ~26 s measured alone (jsdom has to
    // evaluate the whole Settings/Help/Limits graph per test), and the waits above
    // sum to 35 s, so the 30 s suite default is inside this test's own budget.
  }, 60_000)

  it('restarts the guide from Settings', async () => {
    render(<App />)
    // The restart arms and opens the tour; the tour only mounts inside an open
    // design, so open one first.
    fireEvent.click(screen.getAllByRole('button', { name: /create project/i })[0])
    await screen.findByTestId('schematic-canvas')

    fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0])
    // SettingsPanel is a lazy chunk; a loaded CI box can take well over the
    // default 1 s to fetch and mount it after the whole suite has run.
    fireEvent.click(await screen.findByRole('button', { name: 'Restart guided setup' }, { timeout: 20000 }))

    expect(await screen.findByRole('dialog', { name: /this is your workbench/i }, { timeout: 5000 })).toBeInTheDocument()
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
    expect(screen.getByRole('button', { name: 'Reviewed chapter: Orientation' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reviewed chapter: Capture' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Keep reading' }))
    expect(setStepIndex).toHaveBeenCalledWith(6)
  })

  it('records a guide closed early as an exit, not as a finished tour', async () => {
    localStorage.removeItem(ONBOARDING_COMPLETED_KEY)
    render(<App />)
    // The tour opens inside the workbench; crossing with a design opens it.
    fireEvent.click(screen.getAllByRole('button', { name: /create project/i })[0])
    await screen.findByTestId('schematic-canvas')
    await screen.findByRole('dialog', {}, { timeout: 15000 })

    // Jump two chapters ahead, then the card is closed: the ledger must not
    // claim the curriculum was finished, nor that every step was read.
    fireEvent.click(screen.getByRole('button', { name: /^Upcoming chapter: Delegate & govern$/ }))
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
    // The tour opens inside the workbench; crossing with a design opens it.
    fireEvent.click(screen.getAllByRole('button', { name: /create project/i })[0])
    await screen.findByTestId('schematic-canvas')
    await screen.findByRole('dialog', {}, { timeout: 15000 })

    // Jump to the govern chapter (its first step opens), walk one step to the
    // limits step with its open-limits action — the rail only jumps chapter starts.
    fireEvent.click(screen.getByRole('button', { name: /^Upcoming chapter: Delegate & govern$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /^Continue$/ }))
    fireEvent.click(await screen.findByRole('button', { name: /open capabilities and limits/i }))
    expect(
      await screen.findByRole('dialog', { name: 'Capabilities and limits' }, { timeout: 10000 }),
    ).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /this is your workbench/i })).not.toBeInTheDocument())

    // The hand-off closes the tour from the card and the shell in one click; only
    // the card's own exit may reach the ledger. Three steps were visited: the
    // initial orientation step, the govern chapter's first step, the limits step.
    const tourEvents = getUsageEvents().filter((event) => event.kind.startsWith('onboarding'))
    expect(tourEvents.map((event) => event.kind)).toEqual(['onboarding.complete'])
    expect(tourEvents[0]?.detail).toMatchObject({ steps: 3, total: ONBOARDING_STEP_COUNT })
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
    // module graph, so the wait below is budgeted per chunk.
    expect(await screen.findByText('Circuit Simulation', {}, { timeout: 20000 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Simulation' })).toHaveAttribute('aria-current', 'page')
    expect(window.location.pathname.endsWith('/simulation')).toBe(true)
  })

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

  /* Two content-addressed commits of the demo mainboard plus a restore: the
   * snapshot is a few thousand parts and wires hashed in jsdom, which measures
   * 9–13 s depending on how many other suites are running. */
  it('commits two sheet versions and restores the earlier one from the version panel', async () => {
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

    // The restore is the app's own question now, so the test answers it the way
    // a person does: ask, then press the button that acts.
    fireEvent.click(screen.getByRole('button', { name: 'Restore commit: full rectifier' }))
    const question = await screen.findByRole('dialog', { name: /Restore the commit/i })
    expect(within(question).getByText(/backup of the current state is taken first/i)).toBeInTheDocument()
    fireEvent.click(within(question).getByRole('button', { name: 'Restore commit' }))

    await waitFor(() => {
      expect(useProjectStore.getState().components).toHaveLength(board.components.length)
    })
    expect(useProjectStore.getState().components.map((part) => part.reference)).toEqual(
      board.components.map((part) => part.reference),
    )
  }, 30_000)
})
