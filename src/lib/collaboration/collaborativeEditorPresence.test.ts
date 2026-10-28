/**
 * Presence reporting on the realtime path.
 *
 * `channel.track()` used to be swallowed: a failed first broadcast, or a failed
 * heartbeat, left `useRealtime` true, so the panel kept claiming "Realtime
 * session" while every peer's roster was quietly going stale without this
 * client's name in it. Supabase is faked here to force both outcomes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collaborativeEditor, type CollabUser, type PresenceState } from './collaborativeEditor';

const mocks = vi.hoisted(() => ({
  /** Outcome for each track() call; the last entry repeats once the list runs out. */
  outcomes: [] as boolean[],
  calls: 0,
}));

vi.mock('../supabase', () => {
  const channel = () => ({
    on: () => channel(),
    presenceState: () => ({}),
    send: () => Promise.resolve(),
    track: () => {
      const ok = mocks.outcomes[Math.min(mocks.calls, mocks.outcomes.length - 1)] ?? true
      mocks.calls += 1
      return ok ? Promise.resolve() : Promise.reject(new Error('presence channel closed'))
    },
    untrack: () => Promise.resolve(),
    subscribe: (cb: (status: string) => void) => {
      cb('SUBSCRIBED')
      return channel()
    },
  })
  return {
    isSupabaseConfigured: true,
    supabase: { channel, removeChannel: () => Promise.resolve() },
  }
})

const user = (id = 'presence-user'): CollabUser => ({
  id,
  name: 'Presence Tester',
  email: `${id}@folio.test`,
  color: '#4f46e5',
  isActive: true,
  lastSeen: 0,
})

describe('CollaborativeEditor presence state', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    collaborativeEditor.removeAllListeners()
    collaborativeEditor.disconnect()
    mocks.outcomes = []
    mocks.calls = 0
  })

  it('reports a refused presence broadcast instead of a silently degraded session', async () => {
    mocks.outcomes = [false]
    const states: PresenceState[] = []
    collaborativeEditor.on('presence:state', (next) => states.push(next))

    await collaborativeEditor.connect(user(), 'project-presence')

    expect(collaborativeEditor.isUsingRealtime()).toBe(true)
    expect(collaborativeEditor.getPresenceState()).toEqual({
      broadcasting: false,
      reason: 'presence channel closed',
    })
    expect(states).toEqual([{ broadcasting: false, reason: 'presence channel closed' }])
  })

  it('clears the report once a later heartbeat gets through', async () => {
    mocks.outcomes = [false, true]
    const states: PresenceState[] = []
    collaborativeEditor.on('presence:state', (next) => states.push(next))

    await collaborativeEditor.connect(user(), 'project-presence-recover')
    await vi.advanceTimersByTimeAsync(15_000)

    expect(collaborativeEditor.getPresenceState()).toEqual({ broadcasting: true, reason: null })
    expect(states.map((state) => state.broadcasting)).toEqual([false, true])
  })

  it('stays quiet while presence keeps working', async () => {
    mocks.outcomes = [true, true, true]
    const states: PresenceState[] = []
    collaborativeEditor.on('presence:state', (next) => states.push(next))

    await collaborativeEditor.connect(user(), 'project-presence-healthy')
    await vi.advanceTimersByTimeAsync(45_000)

    expect(states).toEqual([{ broadcasting: true, reason: null }])
  })
})
