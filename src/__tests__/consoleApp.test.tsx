/**
 * The user console: gates on the local profile in standalone deployments,
 * renders the account sections, signs out back to the gate.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('../components/SchematicCanvas', () => ({
  default: function SchematicCanvasStub() {
    return <div data-testid="schematic-canvas" />
  },
}))

import ConsoleApp from '../console/ConsoleApp'
import { useLocalProfileStore } from '../stores/useLocalProfileStore'

const ADA = { id: 'ada', name: 'Ada Lovelace', createdAt: 1 }

describe('ConsoleApp (standalone deployment)', () => {
  beforeEach(() => {
    useLocalProfileStore.setState({ profiles: [ADA], activeProfileId: 'ada' })
  })

  it('shows the overview with identity and the local plan', () => {
    render(<ConsoleApp />)
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getAllByText('Ada Lovelace').length).toBeGreaterThan(0)
    expect(screen.getByText(/recorded actions/)).toBeInTheDocument()
    expect(screen.getAllByText(/Local — this device/).length).toBeGreaterThan(0)
  })

  it('switches sections via the rail', () => {
    render(<ConsoleApp />)
    // jsdom renders both the desktop sidebar and the mobile rail; either drives the same state.
    fireEvent.click(screen.getAllByRole('button', { name: 'Usage' })[0])
    expect(screen.getByRole('heading', { name: 'Usage on this device' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Plan & limits' })[0])
    expect(screen.getByRole('heading', { name: 'What this account can use' })).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: 'Data' })[0])
    expect(screen.getByText(/Download local data/)).toBeInTheDocument()
  })

  it('signs out back to the gate', () => {
    render(<ConsoleApp />)
    const signOutButtons = screen.getAllByRole('button', { name: /^Sign out$/ })
    // Two doors to the same action: the header icon and the account section.
    fireEvent.click(signOutButtons[0])
    expect(useLocalProfileStore.getState().activeProfileId).toBeNull()
  })
})
