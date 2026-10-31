/**
 * The parts palette is the way a board gets new parts. It used to render only
 * while the schematic was open, which left the PCB workspace with a drop target
 * and no drag source.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Konva needs a real 2D canvas; the sheet is not what this file exercises.
vi.mock('../components/SchematicCanvas', () => ({
  default: () => <div data-testid="schematic-canvas" />,
}))
// The board's own behaviour is covered by pcbDesignPanel.test.tsx; here the
// question is only whether the workspace keeps the palette beside it.
vi.mock('../components/pcb/PCBDesignPanel', () => ({
  default: () => <div data-testid="pcb-panel" />,
}))

import DomainWorkspace from '../components/workspace/DomainWorkspace'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'
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

describe('DomainWorkspace parts palette', () => {
  afterEach(() => {
    useAppStore.setState({ workspaceMode: 'schematic', sidebarOpen: true })
    useProjectStore.setState({ components: [], wires: [], currentProject: null })
  })

  it('is reachable while the board is open, not only on the sheet', async () => {
    useAppStore.setState({ workspaceMode: 'pcb', sidebarOpen: true })
    mount()
    expect(await screen.findByTestId('pcb-panel')).toBeInTheDocument()

    expect(screen.getByRole('complementary', { name: 'Component library' })).toBeInTheDocument()
    expect(screen.getByText('Resistor')).toBeInTheDocument()
  })

  it('stays closed while the board is open if the user closed it', async () => {
    useAppStore.setState({ workspaceMode: 'pcb', sidebarOpen: false })
    mount()
    expect(await screen.findByTestId('pcb-panel')).toBeInTheDocument()

    expect(screen.queryByRole('complementary', { name: 'Component library' })).not.toBeInTheDocument()
  })
})
