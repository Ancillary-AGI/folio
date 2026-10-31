/**
 * The shell must look busy, not frozen, while a demo board loads.
 *
 * Opening the laptop mainboard runs ~6 s of A* routing and a 9 107-segment scene
 * build on the tab's main thread, which paints nothing while it runs. `App` now
 * yields two frames and shows a blocking status first; this test keeps the mock
 * loader as the clock so the assertion is about that ordering, not about how
 * long a real board takes.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const gate = vi.hoisted(() => ({
  /** Set by the stubbed loader: was the busy state on screen when routing started? */
  busyWhenLoaded: false,
  loads: [] as string[],
}))

vi.mock('../lib/demo/loadDemo', () => ({
  isBoardDemoLoad: () => false,
  loadBoardDemo: vi.fn(),
  loadDemoScenario: (scenario: { title: string }) => {
    gate.busyWhenLoaded = Boolean(document.querySelector('[aria-busy="true"]'))
    gate.loads.push(scenario.title)
  },
}))

// SchematicCanvas drives a real Konva stage backed by a 2D canvas, which jsdom
// cannot provide; the shell test stubs it the same way so the tree can mount.
vi.mock('../components/SchematicCanvas', () => ({
  default: () => <div data-testid="schematic-canvas" />,
}))

import App from '../App'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
import { resetUsageLedger } from '../lib/admin/usageLedger'

const ONBOARDING_COMPLETED_KEY = 'folio.onboarding.completed.v2'

beforeAll(async () => {
  // The gallery is code-split, and this test asserts the open path, not chunk latency.
  await import('../components/workspace/DemoGallery')
})

beforeEach(() => {
  gate.busyWhenLoaded = false
  gate.loads = []
  localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
  localStorage.removeItem('folio.offlineProjects')
  resetUsageLedger()
  useProjectStore.setState({ currentProject: null, currentSchematic: null, components: [], wires: [], isDirty: false })
  useAppStore.setState({ activeTool: 'select', workspaceMode: 'schematic', sidebarOpen: true, aiChatOpen: false })
  window.history.replaceState(null, '', '/')
})

describe('demo load busy state', () => {
  it('paints a blocking status before the loader runs, then clears it', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: /create project/i }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open the demo gallery' }))

    // The gallery mounts a code-split dialog inside the shell's Suspense stack.
    // Run alone this case finishes in under 2 s; in a 258-file parallel run the
    // mount passed 4 s and the case failed on its budget rather than its
    // behaviour, so it gets the same allowance the shell's other lazy-chunk
    // flows are held to.
    const gallery = await screen.findByRole('dialog', { name: /demo gallery/i }, { timeout: 20000 })
    const heading = await within(gallery).findByRole('heading', { name: 'Laptop mainboard, laid out' })
    const card = heading.closest('article') as HTMLElement
    fireEvent.click(within(card).getByRole('button', { name: 'Open demo' }))

    // The loader is the witness: it reports the state that was on screen at the
    // moment the blocking work would have started.
    await waitFor(() => expect(gate.loads).toEqual(['Laptop mainboard, laid out']))
    expect(gate.busyWhenLoaded).toBe(true)

    await waitFor(() => expect(document.querySelector('[aria-busy="true"]')).toBeNull())
  }, 40000)
})
