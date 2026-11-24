/**
 * The user console: the standalone build boots straight into the overview
 * (no gate, no sign-out); the cloud build gates on the hosted session.
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
    expect(screen.getAllByText(/recorded actions/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Free — this device/).length).toBeGreaterThan(0)
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

  it('standalone console has no sign-out door — there is no account to end', () => {
    render(<ConsoleApp />)
    fireEvent.click(screen.getAllByRole('button', { name: 'Account' })[0])
    expect(screen.queryByRole('button', { name: /^Sign out$/ })).not.toBeInTheDocument()
    // The device card explains what identity means here — there is nothing
    // to sign in or out of.
    expect(screen.getByRole('heading', { name: 'This device' })).toBeInTheDocument()
  })
})
