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

describe('Local profile gate', () => {
  beforeEach(() => {
    useLocalProfileStore.setState({ profile: null })
  })

  it('stands between the designer and the launcher until a profile is claimed', async () => {
    render(<App />)

    expect(screen.getByRole('heading', { name: 'Folio Engineering Workbench' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /from first sketch/i })).not.toBeInTheDocument()

    // An empty name cannot create a workspace.
    expect(screen.getByRole('button', { name: /create workspace/i })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'ada@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /create workspace/i }))

    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    expect(useLocalProfileStore.getState().profile).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' })
  })

  it('persists the profile across a remount — the gate opens once', async () => {
    useLocalProfileStore.setState({ profile: { name: 'Grace Hopper', email: '' } })
    const { unmount } = render(<App />)
    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    unmount()

    render(<App />)
    expect(await screen.findByRole('heading', { name: 'From first sketch to verified build.' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: "Folio Engineering Workbench" })).not.toBeInTheDocument()
  })
})
