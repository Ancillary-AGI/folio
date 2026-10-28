/**
 * Collaboration status row.
 *
 * The badge used to read "Local collaboration session", which left the reader
 * to work out that nothing reaches another machine. It now says so, and a
 * realtime session only claims health while presence is actually broadcasting.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import CollaborativePanel from '../components/collaboration/CollaborativePanel'
import { collaborativeEditor, type CollabUser } from '../lib/collaboration/collaborativeEditor'

const user: CollabUser = {
  id: 'panel-user',
  name: 'Panel Tester',
  email: 'panel-user@folio.test',
  color: '#4f46e5',
  isActive: true,
  lastSeen: 0,
}

describe('CollaborativePanel status row', () => {
  beforeEach(() => {
    collaborativeEditor.disconnect()
  })

  it('says plainly that a local session does not leave this browser', async () => {
    render(<CollaborativePanel onClose={() => {}} />)

    // Connecting fires the panel's listeners, so the join belongs in act().
    await act(async () => {
      await collaborativeEditor.connect(user, 'project-status')
    })

    const status = await screen.findByText(/operations stay in this browser/i)
    expect(status).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not report a presence failure that has not happened', () => {
    render(<CollaborativePanel onClose={() => {}} />)

    expect(collaborativeEditor.getPresenceState()).toEqual({ broadcasting: false, reason: null })
    expect(screen.queryByText(/Peers may not see you/i)).not.toBeInTheDocument()
  })
})
