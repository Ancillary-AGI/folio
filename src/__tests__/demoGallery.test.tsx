import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import DemoGallery from '../components/workspace/DemoGallery'
import { DEMO_SCENARIOS, scenariosForGroup } from '../lib/demo/demoScenarios'
import { TUTORIALS } from '../lib/tutorials/tutorials'
import { useAppStore } from '../stores/useAppStore'
import { useProjectStore } from '../stores/useProjectStore'

describe('DemoGallery', () => {
  beforeEach(() => {
    useAppStore.setState({ workspaceMode: 'schematic', demoRequest: null })
    useProjectStore.setState({ components: [], wires: [], pcbLayout: null })
  })

  it('lists a demo for every workspace and filters by family', () => {
    render(<DemoGallery open onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: 'Demo gallery' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Open demo/i })).toHaveLength(DEMO_SCENARIOS.length)
    expect(screen.getByText(`${DEMO_SCENARIOS.length} of ${DEMO_SCENARIOS.length} demos · every workspace is covered`)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Electrical' }))
    expect(screen.getAllByRole('button', { name: /Open demo/i })).toHaveLength(scenariosForGroup('electrical').length)
  })

  it('searches titles, summaries and analysis names', () => {
    render(<DemoGallery open onClose={vi.fn()} />)
    const search = screen.getByRole('searchbox', { name: 'Search demos' })

    fireEvent.change(search, { target: { value: 'rectifier' } })
    expect(screen.getByText('Half-wave rectifier')).toBeInTheDocument()
    expect(screen.queryByText('2.4 GHz dipole antenna')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'no-such-demo' } })
    expect(screen.getByText(/No demo matches/)).toBeInTheDocument()
  })

  it('loads a board demo into the stores and opens its workspace', () => {
    const onClose = vi.fn()
    render(<DemoGallery open onClose={onClose} />)

    fireEvent.click(screen.getAllByRole('button', { name: /Open demo/i })[0])

    expect(useAppStore.getState().workspaceMode).toBe('schematic')
    expect(useProjectStore.getState().components).toHaveLength(6)
    expect(useProjectStore.getState().wires.length).toBeGreaterThan(0)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('offers a guided walkthrough for every demo a tutorial is built on', () => {
    const onStartTutorial = vi.fn()
    const onClose = vi.fn()
    render(<DemoGallery open onClose={onClose} onStartTutorial={onStartTutorial} />)

    // A tutorial is a route through a real demo; a stale demo id would leave
    // the card unguided instead of starting a walkthrough of nothing.
    for (const tutorial of TUTORIALS) {
      expect(DEMO_SCENARIOS.some((scenario) => scenario.id === tutorial.demoId)).toBe(true)
    }
    const guided = screen.getAllByRole('button', { name: /^Start the guided tutorial:/ })
    expect(guided).toHaveLength(TUTORIALS.length)

    fireEvent.click(guided[0])
    expect(onStartTutorial).toHaveBeenCalledTimes(1)
    expect(onStartTutorial.mock.calls[0][0].demoId).toBe(TUTORIALS[0].demoId)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('stages a routed 3-D demo with real copper and closes on Escape', () => {
    const onClose = vi.fn()
    const { rerender } = render(<DemoGallery open onClose={onClose} />)

    const threeD = screen.getByText('Routed board in 3D').closest('article')
    expect(threeD).not.toBeNull()
    fireEvent.click(within(threeD as HTMLElement).getByRole('button', { name: /Open demo/i }))

    expect(useAppStore.getState().workspaceMode).toBe('preview3d')
    expect(useProjectStore.getState().pcbLayout?.traces.length).toBeGreaterThan(0)

    rerender(<DemoGallery open onClose={onClose} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalled()
  })
})
