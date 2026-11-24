import { useEffect } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { collaborativeEditor, type CollabSession, type CollabUser } from './collaborativeEditor'

/**
 * Keeps the presence roster for the open project in sync with the editor.
 *
 * `collaborativeEditor` is a module singleton, so every handler registered here
 * has to be removed again when the inputs change. Wiring the handlers inside
 * `connect().then(...)` let a fast project switch register them after the
 * cleanup had already run — they then accumulated for the rest of the session
 * and re-ran the roster update once per stale closure on every event.
 */
export function useCollaborationPresence(
  user: CollabUser | null,
  projectId: string | null,
  enabled: boolean,
  setUsers: Dispatch<SetStateAction<CollabUser[]>>,
): void {
  useEffect(() => {
    if (!enabled || !user || !projectId) return

    const onUserJoined = (joined: CollabUser) =>
      setUsers(prev => [...prev.filter(candidate => candidate.id !== joined.id), joined])
    const onUserLeft = (left: CollabUser) =>
      setUsers(prev => prev.filter(candidate => candidate.id !== left.id))
    const onSessionJoined = (session: CollabSession) =>
      setUsers(Array.from(session.users.values()))

    collaborativeEditor.on('user:joined', onUserJoined)
    collaborativeEditor.on('user:left', onUserLeft)
    collaborativeEditor.on('session:joined', onSessionJoined)

    void collaborativeEditor.connect(user, projectId).catch(error => {
      console.error('Collaboration connect failed:', error)
    })

    return () => {
      collaborativeEditor.off('user:joined', onUserJoined)
      collaborativeEditor.off('user:left', onUserLeft)
      collaborativeEditor.off('session:joined', onSessionJoined)
      collaborativeEditor.disconnect()
    }
  }, [enabled, projectId, setUsers, user])
}
