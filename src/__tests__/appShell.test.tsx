/**
 * Application shell smoke tests.
 *
 * The suite historically exercised services and pure logic only — nothing ever
 * mounted the React tree. These tests boot `App` in offline mode (no Supabase
 * credentials) and assert the landmarks a first-run user sees: the schematic
 * workspace, the component library, the status bar, and the theme toggle.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// SchematicCanvas drives a real Konva stage backed by a 2D canvas, which jsdom
// cannot provide. Stub that one leaf so the rest of the shell renders for real.
vi.mock('../components/SchematicCanvas', () => ({
  default: function SchematicCanvasStub() {
    return <div data-testid="schematic-canvas" />
  },
}))

import App from '../App'
import { useProjectStore } from '../stores/useProjectStore'

const ONBOARDING_COMPLETED_KEY = 'folio.onboarding.completed.v2'
const themeToggleName = /^switch to (dark|light) theme$/i

beforeEach(() => {
  localStorage.setItem(ONBOARDING_COMPLETED_KEY, 'true')
  // Zustand stores are module singletons — never assume the previous test's project.
  useProjectStore.setState({ currentProject: null, currentSchematic: null, components: [], wires: [], isDirty: false })
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

  it('opens the guide on first run and can be dismissed', async () => {
    localStorage.removeItem(ONBOARDING_COMPLETED_KEY)
    render(<App />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    fireEvent.click(screen.getByRole('button', { name: 'Close the guide' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(localStorage.getItem(ONBOARDING_COMPLETED_KEY)).toBe('true')
  })

  it('restarts the guide from Settings', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Restart guided setup' }))

    expect(await screen.findByRole('dialog', { name: /one project/i })).toBeInTheDocument()
  })

  it('keeps Back/Continue equal height in a fixed footer row', async () => {
    const { default: OnboardingTour } = await import('../components/OnboardingTour')
    // First run with no project: the wizard offers an explicit New-project
    // action instead of creating one behind Continue.
    render(
      <OnboardingTour
        onClose={() => {}}
        onCreateProject={() => {}}
        onLoadSampleCircuit={() => {}}
        onLoadDemoBlinker={() => {}}
        hasProject={false}
        stepIndex={0}
        setStepIndex={() => {}}
      />,
    )

    const dialog = await screen.findByRole('dialog')
    const back = screen.getByRole('button', { name: 'Previous step' })
    const next = screen.getByRole('button', { name: /^new project/i })
    expect(dialog).toContainElement(back)
    expect(dialog).toContainElement(next)
    // CAD-wizard footer: fixed h-16 row, items-center, no wrap — neither
    // button can stretch or wrap taller than the other.
    const row = back.parentElement?.parentElement
    expect(row?.className).toContain('h-16')
    expect(row?.className).toContain('items-center')
    expect(row?.className).not.toContain('flex-wrap')
    for (const button of [back, next]) {
      expect(button.className).toContain('h-9')
      expect(button.className).toContain('whitespace-nowrap')
    }
    // Equal heights on screen, not just equal classes.
    expect(next.getBoundingClientRect().height).toBe(back.getBoundingClientRect().height)
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
})
