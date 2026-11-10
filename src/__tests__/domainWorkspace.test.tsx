/**
 * The library dock is how every workspace gets new things, not just the sheet.
 * It used to render only while the schematic was open, which left the PCB
 * workspace with a drop target and no drag source — and the other nine domains
 * that place items with no source at all.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Konva needs a real 2D canvas; the sheet is not what this file exercises.
vi.mock('../components/SchematicCanvas', () => ({
  default: () => <div data-testid="schematic-canvas" />,
}))
// Each panel's own behaviour is covered beside it; here the question is only
// whether the workspace keeps that domain's catalog next to it.
vi.mock('../components/pcb/PCBDesignPanel', () => ({
  default: () => <div data-testid="pcb-panel" />,
}))
vi.mock('../components/mechanical/MechanicalDesignPanel', () => ({
  default: () => <div data-testid="mechanical-panel" />,
}))
vi.mock('../components/SystemDashboard', () => ({
  default: () => <div data-testid="dashboard-panel" />,
}))

import DomainWorkspace from '../components/workspace/DomainWorkspace'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore, type CanvasComponent, type CanvasWire } from '../stores/useProjectStore'
import type { Component } from '../lib/supabase'

const resistor: Component = {
  id: 'lib-res',
  name: 'Resistor',
  category: 'Passive',
  is_standard: true,
  symbol_data: { width: 40, height: 20, paths: [] },
  pins: [
    { id: '1', name: 'A', x: -20, y: 0, type: 'passive' },
    { id: '2', name: 'B', x: 20, y: 0, type: 'passive' },
  ],
  default_properties: { resistance: '10k' },
}

const mount = () =>
  render(
    <DomainWorkspace
      libraryComponents={[resistor]}
      onSave={vi.fn()}
      onOpenDemos={vi.fn()}
      onOpenHelp={vi.fn()}
    />,
  )

describe('DomainWorkspace library dock', () => {
  afterEach(() => {
    useAppStore.setState({ workspaceMode: 'schematic', sidebarOpen: true, armedLibraryItem: null })
    useProjectStore.setState({ components: [], wires: [], currentProject: null })
  })

  it('is reachable while the board is open, not only on the sheet', async () => {
    useAppStore.setState({ workspaceMode: 'pcb', sidebarOpen: true })
    mount()
    expect(await screen.findByTestId('pcb-panel')).toBeInTheDocument()

    // The board draws from its own dock, named for the board rather than for
    // the sheet the parts came from.
    expect(screen.getByRole('complementary', { name: 'Board parts' })).toBeInTheDocument()
    expect(screen.getByText('Resistor')).toBeInTheDocument()
  })

  it('stays closed while the board is open if the user closed it', async () => {
    useAppStore.setState({ workspaceMode: 'pcb', sidebarOpen: false })
    mount()
    expect(await screen.findByTestId('pcb-panel')).toBeInTheDocument()

    expect(screen.queryByRole('complementary', { name: 'Board parts' })).not.toBeInTheDocument()
  })

  it('shows the catalog the open panel can place, not the parts list', async () => {
    useAppStore.setState({ workspaceMode: 'mechanical', sidebarOpen: true })
    mount()
    await screen.findByTestId('mechanical-panel')

    const dock = screen.getByRole('complementary', { name: 'Mechanical parts' })
    // An ISO table row, taken from the same standard parts the analyser solves.
    // No electrical symbol can appear here.
    expect(within(dock).getByRole('button', { name: /Hex bolt M6/ })).toBeInTheDocument()
    expect(within(dock).queryByText('Resistor')).not.toBeInTheDocument()
  })

  it('arms a row on click and disarms it on Escape', async () => {
    useAppStore.setState({ workspaceMode: 'mechanical', sidebarOpen: true })
    mount()
    await screen.findByTestId('mechanical-panel')

    const row = screen.getByRole('button', { name: /Hex bolt M6/ })
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-pressed', 'true')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.getByRole('button', { name: /Hex bolt M6/ })).toHaveAttribute('aria-pressed', 'false')
  })

  it('offers no dock where the workspace places nothing', async () => {
    useAppStore.setState({ workspaceMode: 'dashboard', sidebarOpen: true })
    mount()
    await screen.findByTestId('dashboard-panel')

    expect(screen.queryByRole('complementary')).not.toBeInTheDocument()
  })
})

const place = (id: string, reference: string): CanvasComponent => ({
  id,
  componentId: 'lib-res',
  component: resistor,
  x: 0,
  y: 0,
  rotation: 0,
  reference,
  properties: {},
})

const wire = (
  id: string,
  netName: string | undefined,
  points: CanvasWire['points'],
  connectedPins: CanvasWire['connectedPins'],
): CanvasWire => ({
  id,
  ...(netName === undefined ? {} : { netName }),
  points,
  connectedPins,
})

describe('DomainWorkspace net inspector', () => {
  const r1 = place('placed-r1', 'R1')
  const r2 = place('placed-r2', 'R2')

  afterEach(() => {
    useAppStore.setState({ workspaceMode: 'schematic', selectedNet: null, selectedComponents: [] })
    useProjectStore.setState({ components: [], wires: [], currentProject: null })
  })

  const showNet = () => {
    useAppStore.setState({ workspaceMode: 'schematic', selectedNet: { name: 'GND' } })
    mount()
    return screen.getByRole('complementary', { name: 'Net inspector' })
  }

  it('opens the inspector for a selected net and renames the whole net', () => {
    useProjectStore.setState({
      components: [r1, r2],
      wires: [
        wire('w1', 'GND', [{ x: 0, y: 0 }, { x: 40, y: 0 }], [{ componentId: 'placed-r1', pinId: '1' }]),
        wire('w2', 'GND', [{ x: 40, y: 0 }, { x: 40, y: 30 }], [
          { componentId: 'placed-r1', pinId: '2' },
          { componentId: 'placed-r2', pinId: '1' },
        ]),
      ],
    })

    const inspector = showNet()

    expect(within(inspector).getByText('GND')).toBeInTheDocument()
    expect(within(inspector).getByText('7.0 mm')).toBeInTheDocument()
    expect(within(inspector).getByTitle('Select R1 · Resistor · pin A')).toBeInTheDocument()
    expect(within(inspector).getByTitle('Select R2 · Resistor · pin A')).toBeInTheDocument()

    fireEvent.change(within(inspector).getByLabelText('Name'), { target: { value: 'VSS' } })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Apply' }))

    expect(useProjectStore.getState().wires.map((entry) => entry.netName)).toEqual(['VSS', 'VSS'])
    expect(useProjectStore.getState().isDirty).toBe(true)
    expect(useAppStore.getState().selectedNet).toEqual({ name: 'VSS' })
    expect(within(screen.getByRole('complementary', { name: 'Net inspector' })).getByText('VSS')).toBeInTheDocument()
  })

  it('refuses a name another net already uses', () => {
    useProjectStore.setState({
      components: [r1, r2],
      wires: [
        wire('w1', 'GND', [{ x: 0, y: 0 }, { x: 40, y: 0 }], [{ componentId: 'placed-r1', pinId: '1' }]),
        wire('w2', 'VCC', [{ x: 0, y: 40 }, { x: 40, y: 40 }], [{ componentId: 'placed-r2', pinId: '2' }]),
      ],
    })

    const inspector = showNet()
    fireEvent.change(within(inspector).getByLabelText('Name'), { target: { value: 'VCC' } })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Apply' }))

    expect(within(inspector).getByRole('alert')).toHaveTextContent('Another net is already named "VCC".')
    expect(useProjectStore.getState().wires.map((entry) => entry.netName)).toEqual(['GND', 'VCC'])
  })

  it('names an unnamed wire, which is what selects it on the sheet', () => {
    useProjectStore.setState({
      components: [r1],
      wires: [wire('w9', undefined, [{ x: 0, y: 0 }, { x: 20, y: 0 }], [{ componentId: 'placed-r1', pinId: '1' }])],
    })
    useAppStore.setState({ workspaceMode: 'schematic', selectedNet: { wireId: 'w9' } })
    mount()

    const inspector = screen.getByRole('complementary', { name: 'Net inspector' })
    expect(within(inspector).getByText('Unnamed net')).toBeInTheDocument()

    fireEvent.change(within(inspector).getByLabelText('Name'), { target: { value: 'N1' } })
    fireEvent.click(within(inspector).getByRole('button', { name: 'Apply' }))

    expect(useProjectStore.getState().wires[0].netName).toBe('N1')
    expect(useAppStore.getState().selectedNet).toEqual({ name: 'N1' })
  })
})

describe('DomainWorkspace pin cross-probe', () => {
  const r1 = place('placed-r1', 'R1')

  afterEach(() => {
    useAppStore.setState({ workspaceMode: 'schematic', selectedNet: null, selectedComponents: [] })
    useProjectStore.setState({ components: [], wires: [], currentProject: null })
  })

  const showPart = () => {
    useProjectStore.setState({
      components: [r1],
      wires: [
        wire('w1', 'GND', [{ x: 0, y: 0 }, { x: 40, y: 0 }], [{ componentId: 'placed-r1', pinId: '1' }]),
        wire('w2', undefined, [{ x: 0, y: 0 }, { x: 40, y: 20 }], [{ componentId: 'placed-r1', pinId: '2' }]),
      ],
    })
    useAppStore.setState({ workspaceMode: 'schematic', selectedComponents: ['placed-r1'] })
    mount()
    return screen.getByRole('complementary', { name: 'Properties inspector' })
  }

  it('shows where each pin lands and opens that net from the row', () => {
    const inspector = showPart()

    const gndRow = within(inspector).getByRole('button', { name: 'Open net GND from pin A' })
    expect(within(gndRow).getByText('GND')).toBeInTheDocument()

    fireEvent.click(gndRow)

    expect(useAppStore.getState().selectedNet).toEqual({ name: 'GND' })
    expect(useAppStore.getState().selectedComponents).toEqual([])
    expect(screen.getByRole('complementary', { name: 'Net inspector' })).toBeInTheDocument()
  })

  it('probes an unnamed wire by its identity, the same key the checker uses', () => {
    const inspector = showPart()

    fireEvent.click(within(inspector).getByRole('button', { name: 'Open net unnamed from pin B' }))

    expect(useAppStore.getState().selectedNet).toEqual({ wireId: 'w2' })
  })

  it('leaves an unwired pin inert', () => {
    useProjectStore.setState({
      components: [r1],
      wires: [wire('w1', 'GND', [{ x: 0, y: 0 }, { x: 40, y: 0 }], [{ componentId: 'placed-r1', pinId: '1' }])],
    })
    useAppStore.setState({ workspaceMode: 'schematic', selectedComponents: ['placed-r1'] })
    mount()

    const row = screen.getByTitle('B · passive · not connected')
    expect(row).toBeDisabled()

    fireEvent.click(row)
    expect(useAppStore.getState().selectedNet).toBeNull()
    expect(useAppStore.getState().selectedComponents).toEqual(['placed-r1'])
  })
})
