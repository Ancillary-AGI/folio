/**
 * The design-health dock is fed by the real rule checker, so these tests place
 * a part with an unconnected supply pin and read the sentence the engine
 * produces — not a fixture written to match the UI.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('../components/SchematicCanvas', () => ({
  default: () => <div data-testid="schematic-canvas" />,
}))

import DomainWorkspace from '../components/workspace/DomainWorkspace'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore, type CanvasComponent } from '../stores/useProjectStore'
import { useDesignHealthStore } from '../stores/useDesignHealthStore'
import type { Component } from '../lib/supabase'

const regulator: Component = {
  id: 'lib-reg',
  name: 'Regulator',
  category: 'Power supply',
  is_standard: true,
  symbol_data: { width: 40, height: 30, paths: [] },
  pins: [
    { id: 'vcc', name: 'VCC', x: 0, y: 0, type: 'power' },
    { id: 'out', name: 'OUT', x: 20, y: 0, type: 'output' },
    { id: 'in', name: 'IN', x: -20, y: 0, type: 'input' },
  ],
  default_properties: { voltage: '5V' },
}

const placed: CanvasComponent = {
  id: 'u1',
  componentId: 'lib-reg',
  component: regulator,
  x: 100,
  y: 100,
  rotation: 0,
  reference: 'U1',
  properties: { voltage: '5V' },
}

const mount = () =>
  render(
    <DomainWorkspace
      libraryComponents={[regulator]}
      onSave={vi.fn()}
      onOpenDemos={vi.fn()}
      onOpenHelp={vi.fn()}
    />,
  )

const reset = () => {
  useAppStore.setState({ workspaceMode: 'schematic', sidebarOpen: false, selectedComponents: [], focusRequest: null })
  useProjectStore.setState({ components: [], wires: [], currentProject: null })
  useDesignHealthStore.setState({ result: null, panelOpen: true, tab: 'problems', activeFindingIndex: null })
}

describe('design health dock', () => {
  afterEach(reset)

  it('renders the rule check the engine produced for the placed part', () => {
    reset()
    useProjectStore.setState({ components: [placed] })
    mount()

    const panel = screen.getByRole('region', { name: 'Design health' })
    expect(panel).toBeInTheDocument()
    // The power pin is an error; the floating input and unused output follow.
    expect(screen.getByText(/Power pin "VCC" of Regulator \(U1\) is not connected/)).toBeInTheDocument()
    expect(screen.getByText(/Input pin "IN" .* is floating/)).toBeInTheDocument()

    // The status bar reads this store rather than re-running the check.
    const summary = useDesignHealthStore.getState().result?.summary
    expect(summary?.errors).toBe(1)
    expect(summary?.warnings).toBe(2)
  })

  it('locates the offending part when a finding is selected', () => {
    reset()
    useProjectStore.setState({ components: [placed] })
    mount()

    fireEvent.click(screen.getByRole('button', { name: /Locate Power pin "VCC"/ }))

    expect(useAppStore.getState().selectedComponents).toEqual(['u1'])
    // The sheet consumes this request once it has a measured stage; the dock's
    // job is to name the part, not to know the canvas geometry.
    expect(useAppStore.getState().focusRequest?.id).toBe('u1')
  })

  it('filters findings by severity and reports an empty filter honestly', () => {
    reset()
    useProjectStore.setState({ components: [placed] })
    mount()

    fireEvent.click(screen.getByRole('button', { name: /Notices/ }))
    expect(screen.getByText('No findings in Notices')).toBeInTheDocument()
    expect(screen.queryByText(/Power pin "VCC"/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Warnings/ }))
    expect(screen.getByText(/Input pin "IN" .* is floating/)).toBeInTheDocument()
    expect(screen.queryByText(/Power pin "VCC"/)).not.toBeInTheDocument()
  })

  it('outlines the sheet and locates from the outline', () => {
    reset()
    useProjectStore.setState({ components: [placed] })
    mount()

    fireEvent.click(screen.getByRole('tab', { name: /Outline/ }))
    fireEvent.click(screen.getByText('Regulator'))
    expect(useAppStore.getState().selectedComponents).toEqual(['u1'])
  })

  it('steps findings with F8, wraps, and opens the dock on the way', () => {
    reset()
    useProjectStore.setState({ components: [placed] })
    useDesignHealthStore.setState({ panelOpen: false, tab: 'outline' })
    mount()

    fireEvent.keyDown(window, { key: 'F8' })
    expect(useDesignHealthStore.getState().panelOpen).toBe(true)
    expect(useDesignHealthStore.getState().tab).toBe('problems')
    expect(useDesignHealthStore.getState().activeFindingIndex).toBe(0)
    expect(useAppStore.getState().selectedComponents).toEqual(['u1'])
    expect(useAppStore.getState().focusRequest?.id).toBe('u1')

    fireEvent.keyDown(window, { key: 'F8' })
    expect(useDesignHealthStore.getState().activeFindingIndex).toBe(1)

    fireEvent.keyDown(window, { key: 'F8', shiftKey: true })
    expect(useDesignHealthStore.getState().activeFindingIndex).toBe(0)

    // Stepping back from the first row lands on the last, like an editor's
    // previous-error command.
    fireEvent.keyDown(window, { key: 'F8', shiftKey: true })
    expect(useDesignHealthStore.getState().activeFindingIndex).toBe(2)

    expect(screen.getByText('3 / 3')).toBeInTheDocument()
  })

  it('passes an empty sheet without inventing findings', () => {
    reset()
    mount()

    expect(screen.getByText('No electrical rule violations')).toBeInTheDocument()
    expect(useDesignHealthStore.getState().result?.summary.totalViolations).toBe(0)
  })
})
