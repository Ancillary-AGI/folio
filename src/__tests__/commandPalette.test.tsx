import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from '../components/workspace/CommandPalette'
import { DEMO_SCENARIOS } from '../lib/demo/demoScenarios'
import { WORKSPACE_MODES } from '../lib/workspace/modes'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'

const renderPalette = (overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) => {
  const props = {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onOpenDemos: vi.fn(),
    onOpenLimits: vi.fn(),
    onOpenHelp: vi.fn(),
    onToggleTheme: vi.fn(),
    ...overrides,
  }
  render(<CommandPalette {...props} />)
  return props
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useAppStore.setState({ workspaceMode: 'schematic', demoRequest: null })
    useProjectStore.setState({ components: [], wires: [], pcbLayout: null })
  })

  it('lists every workspace, demo and document action in one search field', () => {
    renderPalette()

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    // Every workspace, every demo scenario, plus the five actions: help,
    // gallery, capabilities and limits, save, theme.
    expect(screen.getAllByRole('option')).toHaveLength(WORKSPACE_MODES.length + DEMO_SCENARIOS.length + 5)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('filters by keyword and runs the first match with Enter', () => {
    renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dipole' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(useAppStore.getState().workspaceMode).toBe('rf')
  })

  it('navigates with arrow keys and closes after running a command', () => {
    const props = renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'design' } })
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(1)

    // Filtered list preserves registry order, so the first entry is Schematic
    // and the second is Simulation. One ArrowDown must land on Simulation.
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'ArrowDown' })
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })

    expect(useAppStore.getState().workspaceMode).toBe('simulation')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('exposes document actions and closes on Escape', () => {
    const props = renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'toggle colour theme' } })
    fireEvent.click(screen.getByText('Toggle colour theme'))
    expect(props.onToggleTheme).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('routes the capabilities and limits action to the host', () => {
    const props = renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'limits' } })
    fireEvent.click(screen.getByText('Open capabilities and limits'))
    expect(props.onOpenLimits).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('routes the help action to the host', () => {
    const props = renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'tutorials' } })
    fireEvent.click(screen.getByText('Open help and tutorials'))
    expect(props.onOpenHelp).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('reports when nothing matches', () => {
    renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'no-such-command' } })
    expect(screen.getByText(/No command matches/)).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Enter' })
    expect(useAppStore.getState().workspaceMode).toBe('schematic')
  })

  it('keeps the query when the host re-renders with a fresh close handler', () => {
    const props = {
      open: true,
      onSave: vi.fn(),
      onOpenDemos: vi.fn(),
      onOpenLimits: vi.fn(),
      onOpenHelp: vi.fn(),
      onToggleTheme: vi.fn(),
    }
    const { rerender } = render(<CommandPalette {...props} onClose={() => {}} />)

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'dipole' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)

    // Hosts pass inline handlers, so their identity changes on every unrelated
    // render. The palette must not treat that as a fresh opening: doing so
    // cleared the search and stole focus while the engineer was typing.
    const latestClose = vi.fn()
    rerender(<CommandPalette {...props} onClose={latestClose} />)

    expect(screen.getByRole('combobox')).toHaveValue('dipole')
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(latestClose).toHaveBeenCalledTimes(1)
  })
})
