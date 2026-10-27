/**
 * Presence wiring regression tests.
 *
 * The collaboration editor is a module singleton shared by every mount of the
 * shell, so the hook that talks to it must remove each handler it adds. An
 * earlier version attached the handlers inside `connect().then(...)`: a project
 * switch whose connect resolved after the cleanup had already run left those
 * closures registered forever, and every later join/leave event then re-ran the
 * roster update once per stale listener. These tests pin the handler pairing,
 * that late-resolve race, and the roster itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useCollaborationPresence } from './useCollaborationPresence'
import { collaborativeEditor, type CollabUser } from './collaborativeEditor'

const localUser: CollabUser = {
  id: 'user-1',
  name: 'Local User',
  email: 'local@example.com',
  color: '#3B82F6',
  isActive: true,
  lastSeen: 0,
}

const remoteUser: CollabUser = {
  id: 'user-2',
  name: 'Remote User',
  email: 'remote@example.com',
  color: '#EF4444',
  isActive: true,
  lastSeen: 0,
}

function listenersRegistered(): number {
  return collaborativeEditor.listenerCount('user:joined')
    + collaborativeEditor.listenerCount('user:left')
    + collaborativeEditor.listenerCount('session:joined')
}

/** A setter double that actually applies updater functions, so state accumulates. */
function createRoster() {
  let roster: CollabUser[] = []
  const setUsers = vi.fn((update: CollabUser[] | ((prev: CollabUser[]) => CollabUser[])) => {
    roster = typeof update === 'function' ? update(roster) : update
  })
  return { getRoster: () => roster, setUsers }
}

describe('useCollaborationPresence', () => {
  beforeEach(() => {
    collaborativeEditor.removeAllListeners()
  })

  afterEach(() => {
    collaborativeEditor.removeAllListeners()
    collaborativeEditor.disconnect()
    vi.restoreAllMocks()
  })

  it('registers one set of handlers and releases them on unmount', () => {
    const { setUsers } = createRoster()
    const { unmount } = renderHook(() =>
      useCollaborationPresence(localUser, 'project-a', true, setUsers),
    )

    expect(listenersRegistered()).toBe(3)

    unmount()
    expect(listenersRegistered()).toBe(0)
  })

  it('swaps projects without accumulating listeners', () => {
    const { setUsers } = createRoster()
    const { rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useCollaborationPresence(localUser, projectId, true, setUsers),
      { initialProps: { projectId: 'project-a' } },
    )

    rerender({ projectId: 'project-b' })
    rerender({ projectId: 'project-c' })

    expect(listenersRegistered()).toBe(3)
  })

  it('ignores a connect that resolves after the session was already re-keyed', async () => {
    const { setUsers } = createRoster()
    let resolveFirstConnect: ((connected: boolean) => void) | null = null
    const connectSpy = vi.spyOn(collaborativeEditor, 'connect')
    connectSpy.mockImplementationOnce(
      () => new Promise<boolean>(resolve => { resolveFirstConnect = resolve }),
    )

    const { rerender } = renderHook(
      ({ projectId }: { projectId: string }) =>
        useCollaborationPresence(localUser, projectId, true, setUsers),
      { initialProps: { projectId: 'project-a' } },
    )
    connectSpy.mockRestore()

    rerender({ projectId: 'project-b' })
    await act(async () => { resolveFirstConnect?.(true) })

    // Only the live project's handlers survive the stale connect.
    expect(listenersRegistered()).toBe(3)
  })

  it('adds a remote user, removes them on leave, and stops after unmount', () => {
    const { getRoster, setUsers } = createRoster()
    const { unmount } = renderHook(() =>
      useCollaborationPresence(localUser, 'project-a', true, setUsers),
    )

    // connect() joins the session locally, so the roster already carries this user.
    expect(getRoster().map(user => user.id)).toEqual(['user-1'])

    act(() => {
      collaborativeEditor.emit('user:joined', remoteUser)
    })
    expect(getRoster().map(user => user.id)).toEqual(['user-1', 'user-2'])

    act(() => {
      collaborativeEditor.emit('user:left', remoteUser)
    })
    expect(getRoster().map(user => user.id)).toEqual(['user-1'])

    unmount()
    act(() => {
      collaborativeEditor.emit('user:joined', remoteUser)
    })
    expect(getRoster().map(user => user.id)).toEqual(['user-1'])
  })

  it('adopts the full roster when a session is joined', () => {
    const { getRoster, setUsers } = createRoster()
    const { unmount } = renderHook(() =>
      useCollaborationPresence(localUser, 'project-a', true, setUsers),
    )

    act(() => {
      collaborativeEditor.emit('session:joined', {
        id: 'collab:project-a',
        projectId: 'project-a',
        users: new Map([[localUser.id, localUser], [remoteUser.id, remoteUser]]),
        operations: [],
      })
    })

    // The roster is replaced wholesale, not merged.
    expect(getRoster().map(user => user.id)).toEqual(['user-1', 'user-2'])
    unmount()
  })

  it('stays inert without a user, a project, or a cloud session', () => {
    const { setUsers } = createRoster()
    renderHook(() => useCollaborationPresence(localUser, null, true, setUsers))
    renderHook(() => useCollaborationPresence(localUser, 'project-a', false, setUsers))
    renderHook(() => useCollaborationPresence(null, 'project-a', true, setUsers))

    expect(listenersRegistered()).toBe(0)
    expect(setUsers).not.toHaveBeenCalled()
  })
})
