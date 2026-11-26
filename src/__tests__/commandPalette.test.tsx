import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CommandPalette from '../components/workspace/CommandPalette'
import { DEMO_SCENARIOS } from '../lib/demo/demoScenarios'
import { WORKSPACE_MODES } from '../lib/workspace/modes'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../stores/useProjectStore'
import type { Component } from '../lib/supabase'

const regulator: Component = {
  id: 'lib-reg',
  name: 'Regulator',
  category: 'Power supply',
  is_standard: true,
  symbol_data: { width: 40, height: 30, paths: [] },
  pins: [
    { id: 'in', name: 'IN', x: -20, y: 0, type: 'input' },
    { id: 'out', name: 'OUT', x: 20, y: 0, type: 'output' },
  ],
  default_properties: {},
  part_number: 'LM317',
  manufacturer: 'TI',
}

const placed: CanvasComponent[] = [
  {
    id: 'u1',
    componentId: 'lib-reg',
    component: regulator,
    x: 0,
    y: 0,
    rotation: 0,
    reference: 'U1',
    properties: { value: 'LM317' },
  },
  {
    id: 'u2',
    componentId: 'lib-reg',
    component: regulator,
    x: 120,
    y: 0,
    rotation: 0,
    reference: 'U2',
    properties: { value: 'LM317' },
  },
]

const vcc: CanvasWire = {
  id: 'w1',
  points: [{ x: 0, y: 0 }, { x: 120, y: 0 }],
  netName: 'VCC',
  connectedPins: [
    { componentId: 'u1', pinId: 'out' },
    { componentId: 'u2', pinId: 'in' },
  ],
}

const renderPalette = (overrides: Partial<Parameters<typeof CommandPalette>[0]> = {}) => {
  const props = {
    open: true,
    onClose: vi.fn(),
    onSave: vi.fn(),
    onOpenDemos: vi.fn(),
    onOpenLimits: vi.fn(),
    onOpenHelp: vi.fn(),
    onOpenShortcuts: vi.fn(),
    onOpenSettings: vi.fn(),
    onToggleTheme: vi.fn(),
    onToggleDesignHealth: vi.fn(),
    ...overrides,
  }
  render(<CommandPalette {...props} />)
  return props
}

describe('CommandPalette', () => {
  beforeEach(() => {
    useAppStore.setState({
      workspaceMode: 'schematic',
      demoRequest: null,
      focusRequest: null,
      netFocusRequest: null,
      selectedNet: null,
      selectedComponents: [],
    })
    useProjectStore.setState({ components: [], wires: [], pcbLayout: null })
  })

  it('lists every workspace, demo and document action in one search field', () => {
    renderPalette()

    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    // Every workspace, every demo scenario, plus the fourteen actions: help,
    // shortcuts, settings, gallery, capabilities and limits, save, design
    // health, theme, Copilot, and the five viewport verbs (dual split,
    // board+3D split, floating 3D, single view, fit).
    expect(screen.getAllByRole('option')).toHaveLength(WORKSPACE_MODES.length + DEMO_SCENARIOS.length + 14)
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('jumps to a part by reference from another workspace', () => {
    useAppStore.setState({ workspaceMode: 'mechanical' })
    useProjectStore.setState({ components: placed, wires: [] })
    const props = renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u1' } })
    // The row names the part and its value, so the engineer can tell two
    // regulators apart before jumping.
    fireEvent.click(screen.getByText('U1 · Regulator'))

    expect(useAppStore.getState().workspaceMode).toBe('schematic')
    expect(useAppStore.getState().selectedComponents).toEqual(['u1'])
    expect(useAppStore.getState().focusRequest?.id).toBe('u1')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('lists a named net once and selects its wire run', () => {
    useAppStore.setState({ workspaceMode: 'mechanical' })
    useProjectStore.setState({ components: placed, wires: [vcc] })
    const props = renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'vcc' } })
    expect(screen.getByText('Nets')).toBeInTheDocument()
    expect(screen.getByText('Net · 2 pins')).toBeInTheDocument()
    fireEvent.click(screen.getByText('VCC'))

    const app = useAppStore.getState()
    expect(app.workspaceMode).toBe('schematic')
    expect(app.selectedNet).toEqual({ name: 'VCC' })
    expect(app.selectedComponents).toEqual([])
    expect(app.netFocusRequest?.name).toBe('VCC')
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps one selection cursor: parts and nets replace each other', () => {
    const app = useAppStore.getState()

    app.selectNet({ name: 'VCC' })
    expect(useAppStore.getState().selectedNet).toEqual({ name: 'VCC' })

    app.setSelectedComponents(['u1'])
    expect(useAppStore.getState().selectedNet).toBeNull()
    expect(useAppStore.getState().selectedComponents).toEqual(['u1'])

    app.selectNet({ wireId: 'w1' })
    expect(useAppStore.getState().selectedNet).toEqual({ wireId: 'w1' })
    expect(useAppStore.getState().selectedComponents).toEqual([])

    app.clearSelection()
    expect(useAppStore.getState().selectedNet).toBeNull()
    expect(useAppStore.getState().selectedComponents).toEqual([])
  })

  it('keeps design objects out of the empty list, where commands live', () => {
    useProjectStore.setState({ components: placed, wires: [vcc] })
    renderPalette()

    expect(screen.queryByText('U1 · Regulator')).not.toBeInTheDocument()
    expect(screen.getByText('Save design snapshot')).toBeInTheDocument()
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

    // `s` prefix-matches four workspaces; equal ranks keep registry order, so
    // the first entry is Schematic and the second is Simulation. One
    // ArrowDown must land on Simulation.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 's' } })
    const options = screen.getAllByRole('option')
    expect(options.length).toBeGreaterThan(1)
    expect(options[0]).toHaveTextContent('Schematic')
    expect(options[1]).toHaveTextContent('Simulation')

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

  it('routes the settings page to the host, beside the keycap that opens it', () => {
    const props = renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'open settings' } })
    fireEvent.click(screen.getByText('Open settings'))
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('routes the capabilities and limits action to the host', () => {
    const props = renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'limits' } })
    fireEvent.click(screen.getByText('Open capabilities and limits'))
    expect(props.onOpenLimits).toHaveBeenCalledTimes(1)
    expect(props.onClose).toHaveBeenCalledTimes(1)
  })

  it('routes the design health action to the host', () => {
    const props = renderPalette()

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'design health' } })
    fireEvent.click(screen.getByText('Design health: show or hide findings'))
    expect(props.onToggleDesignHealth).toHaveBeenCalledTimes(1)
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
      onOpenShortcuts: vi.fn(),
      onOpenSettings: vi.fn(),
      onToggleTheme: vi.fn(),
      onToggleDesignHealth: vi.fn(),
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
