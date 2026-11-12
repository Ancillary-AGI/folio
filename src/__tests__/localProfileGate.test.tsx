/**
 * The standalone front door: before a design can be created, the designer
 * claims a local profile. Nothing leaves the device.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Same constraint as the shell suite: jsdom has no 2D canvas, so the Konva
// leaf is stubbed and the rest of the shell renders for real.
vi.mock('../components/SchematicCanvas', () => ({
  default: function SchematicCanvasStub() {
    return <div data-testid="schematic-canvas" />
  },
}))

import App from '../App'
import { useLocalProfileStore } from '../stores/useLocalProfileStore'

const ADA = { id: 'ada', name: 'Ada Lovelace', createdAt: 1 }
const GRACE = { id: 'grace', name: 'Grace Hopper', createdAt: 2 }

describe('Local profile gate', () => {
  beforeEach(() => {
    useLocalProfileStore.setState({ profiles: [], activeProfileId: null })
  })

  it('stands between the designer and the launcher until a profile is claimed', async () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Create your workspace' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /from first sketch/i })).not.toBeInTheDocument()

    // An empty name cannot create a workspace.
    expect(screen.getByRole('button', { name: /create workspace/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }))

    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    const state = useLocalProfileStore.getState()
    const active = state.profiles.find((profile) => profile.id === state.activeProfileId)
    expect(active?.name).toBe('Ada Lovelace')
  })

  it('offers the stored profiles and signs into the one that is picked', async () => {
    useLocalProfileStore.setState({ profiles: [ADA, GRACE], activeProfileId: null })
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Who is working?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Sign in as Grace Hopper' }))
    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    expect(useLocalProfileStore.getState().activeProfileId).toBe('grace')
  })

  it('persists the active profile across a remount — the gate opens once', async () => {
    useLocalProfileStore.setState({ profiles: [GRACE], activeProfileId: 'grace' })
    const { unmount } = render(<App />)
    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    unmount()

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Who is working?' })).not.toBeInTheDocument()
  })
})
