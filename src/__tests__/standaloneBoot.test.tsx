/**
 * The standalone build has no sign-in gate, by deliberate contract.
 *
 * The first run silently creates the device's default local identity (a
 * name prompt or a "sign in" screen has no meaning on a device that never
 * authenticates against a server). This test pins the new contract so a
 * future edit cannot quietly reintroduce the gate.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('../components/SchematicCanvas', () => ({
  default: function SchematicCanvasStub() {
    return <div data-testid="schematic-canvas" />
  },
}))

import App from '../App'
import { useLocalProfileStore } from '../stores/useLocalProfileStore'

describe('Standalone boot contract', () => {
  beforeEach(() => {
    useLocalProfileStore.setState({ profiles: [], activeProfileId: null })
  })

  it('opens straight into the workbench — no sign-in screen, no name prompt', async () => {
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    const state = useLocalProfileStore.getState()
    expect(state.profiles).toHaveLength(1)
    expect(state.activeProfileId).toBe(state.profiles[0]?.id)
  })

  it('reactivates an existing identity instead of stranding the device on a gate', async () => {
    useLocalProfileStore.setState({
      profiles: [
        { id: 'ada', name: 'Ada Lovelace', createdAt: 1 },
        { id: 'grace', name: 'Grace Hopper', createdAt: 2 },
      ],
      activeProfileId: null, // previously "signed out"
    })
    render(<App />)

    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    // Most recent profile is restored so the workbench is usable again.
    expect(useLocalProfileStore.getState().activeProfileId).toBe('grace')
  })
})
