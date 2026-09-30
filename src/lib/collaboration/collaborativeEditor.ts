/**
 * Collaborative Editor
 *
 * Architecture:
 *   • Uses Supabase Realtime broadcast channels as the transport layer
 *   • Implements a lightweight Operational Transformation-style operation queue:
 *       each operation has a lamport timestamp + userId for ordering
 *   • Falls back to an in-memory local session when Supabase is unavailable
 *   • Emits typed events: session:joined, user:joined, user:left,
 *     operation:received, cursor:moved, selection:changed, conflict:detected
 *
 * Operation types (extend as needed):
 *   component_add | component_update | component_remove
 *   wire_add | wire_update | wire_remove
 *   cursor_move | selection_change | heartbeat
 */

import { isSupabaseConfigured, supabase } from '../supabase'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CollabUser {
  id: string
  name: string
  email: string
  avatar?: string
  color: string
  isActive: boolean
  lastSeen: number
}

export type OperationType =
  | 'component_add' | 'component_update' | 'component_remove'
  | 'wire_add' | 'wire_update' | 'wire_remove'
  | 'cursor_move' | 'selection_change' | 'heartbeat'

export interface CollabOperation {
  id: string
  type: OperationType
  userId: string
  projectId: string
  /** Lamport clock value for total ordering */
  lamport: number
  timestamp: number
  payload: Record<string, unknown>
}

export interface CollabSession {
  id: string
  projectId: string
  users: Map<string, CollabUser>
  operations: CollabOperation[]
}

// ── Event emitter ─────────────────────────────────────────────────────────────

type EventMap = {
  'session:joined': [CollabSession]
  'session:left': []
  'user:joined': [CollabUser]
  'user:left': [CollabUser]
  'operation:received': [CollabOperation]
  'cursor:moved': [{ userId: string; x: number; y: number }]
  'selection:changed': [{ userId: string; componentIds: string[] }]
  'conflict:detected': [{ local: CollabOperation; remote: CollabOperation }]
}

class TypedEventEmitter {
  private _listeners = new Map<keyof EventMap, Array<{
    original: unknown
    invoke: (args: unknown[]) => void
  }>>()

  on<K extends keyof EventMap>(event: K, fn: (...args: EventMap[K]) => void): void {
    const listeners = this._listeners.get(event) ?? []
    listeners.push({
      original: fn,
      invoke: args => fn(...args as EventMap[K]),
    })
    this._listeners.set(event, listeners)
  }

  off<K extends keyof EventMap>(event: K, fn: (...args: EventMap[K]) => void): void {
    const listeners = this._listeners.get(event)
    if (listeners) this._listeners.set(event, listeners.filter(listener => listener.original !== fn))
  }

  emit<K extends keyof EventMap>(event: K, ...args: EventMap[K]): void {
    this._listeners.get(event)?.forEach(listener => listener.invoke(args))
  }

  removeAllListeners(): void { this._listeners.clear() }
}

// ── CollaborativeEditor ───────────────────────────────────────────────────────

class CollaborativeEditor extends TypedEventEmitter {
  private sessions = new Map<string, CollabSession>()
  private currentSession: CollabSession | null = null
  private currentUser: CollabUser | null = null
  private channel: ReturnType<typeof supabase.channel> | null = null
  private lamportClock = 0
  private opSeq = 0
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private useRealtime = false

  // ── Connection ──────────────────────────────────────────────────────────────

  async connect(user: CollabUser, projectId: string): Promise<boolean> {
    this.currentUser = user
    const sessionId = `collab:${projectId}`

    // Upsert local session
    let session = this.sessions.get(sessionId)
    if (!session) {
      session = { id: sessionId, projectId, users: new Map(), operations: [] }
      this.sessions.set(sessionId, session)
    }
    session.users.set(user.id, user)
    this.currentSession = session

    // Try Supabase Realtime — but only when the app is actually configured for
    // it. Without a key the SDK's connect attempt would otherwise hang
    // indefinitely (this is what stalled `connect()` in tests/dev shells).
    if (!isSupabaseConfigured) {
      this.useRealtime = false
      this.emit('session:joined', session)
      this._startHeartbeat()
      return true
    }
    try {
      await this._connectRealtime(user, projectId, sessionId, session)
    } catch (err) {
      console.warn('[Collab] Realtime unavailable — local-only session:', err)
      this.useRealtime = false
    }

    this.emit('session:joined', session)
    this._startHeartbeat()
    return true
  }

  private async _connectRealtime(
    user: CollabUser,
    projectId: string,
    sessionId: string,
    session: CollabSession,
  ): Promise<void> {
    // Close existing channel if any
    if (this.channel) {
      await supabase.removeChannel(this.channel)
      this.channel = null
    }

    this.channel = supabase.channel(sessionId, {
      config: { broadcast: { self: false }, presence: { key: user.id } },
    })

    // ── Presence ─────────────────────────────────────────────────────────────
    this.channel.on('presence', { event: 'sync' }, () => {
      const state = this.channel!.presenceState<CollabUser>()
      for (const [userId, presences] of Object.entries(state)) {
        const p = presences[0] as unknown as CollabUser
        if (userId !== user.id && p) {
          if (!session.users.has(userId)) {
            session.users.set(userId, p)
            this.emit('user:joined', p)
          }
        }
      }
    })

    this.channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
      const joined = newPresences[0] as unknown as CollabUser
      if (key !== user.id && joined) {
        session.users.set(key, joined)
        this.emit('user:joined', joined)
      }
    })

    this.channel.on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
      const left = leftPresences[0] as unknown as CollabUser
      session.users.delete(key)
      this.emit('user:left', left ?? { id: key } as CollabUser)
    })

    // ── Broadcast — design operations ─────────────────────────────────────────
    this.channel.on('broadcast', { event: 'operation' }, ({ payload }) => {
      const op = payload as CollabOperation
      if (op.userId === user.id) return   // own echo
      this._receiveOperation(op, session)
    })

    // ── Broadcast — cursor movements ──────────────────────────────────────────
    this.channel.on('broadcast', { event: 'cursor' }, ({ payload }) => {
      const { userId, x, y } = payload as { userId: string; x: number; y: number }
      if (userId !== user.id) this.emit('cursor:moved', { userId, x, y })
    })

    // ── Subscribe ─────────────────────────────────────────────────────────────
    // Bounded wait: a misconfigured endpoint must degrade to a local session,
    // never hang the UI (or the test runner) on an unresolved `connect()`.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Supabase channel subscribe timed out after 8 s')), 8_000)
      this.channel!.subscribe(async status => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timer)
          try {
            await this.channel!.track({ ...user, projectId })
          } catch {
            // Presence tracking is best-effort; broadcast still works.
          }
          this.useRealtime = true
          resolve()
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timer)
          reject(new Error(`Supabase channel status: ${status}`))
        }
      })
    })
  }

  disconnect(): void {
    try {
      if (this.channel) {
        this.channel.untrack().catch(() => {})
        supabase.removeChannel(this.channel).catch(() => {})
        this.channel = null
      }
    } catch {
      this.channel = null
    }
    if (this.currentUser && this.currentSession) {
      this.currentSession.users.delete(this.currentUser.id)
    }
    this._stopHeartbeat()
    this.currentSession = null
    this.currentUser = null
    this.useRealtime = false
    this.emit('session:left')
  }

  // ── Operations ──────────────────────────────────────────────────────────────

  async sendOperation(type: OperationType, payload: Record<string, unknown>): Promise<void> {
    if (!this.currentUser || !this.currentSession) return

    this.lamportClock++
    const op: CollabOperation = {
      id: `op_${Date.now()}_${++this.opSeq}`,
      type,
      userId: this.currentUser.id,
      projectId: this.currentSession.projectId,
      lamport: this.lamportClock,
      timestamp: Date.now(),
      payload,
    }

    this.currentSession.operations.push(op)
    if (this.currentSession.operations.length > 1000) {
      this.currentSession.operations = this.currentSession.operations.slice(-500)
    }

    if (this.useRealtime && this.channel) {
      await this.channel.send({ type: 'broadcast', event: 'operation', payload: op })
    }
  }

  async sendCursorPosition(x: number, y: number): Promise<void> {
    if (!this.currentUser || !this.useRealtime || !this.channel) return
    await this.channel.send({
      type: 'broadcast',
      event: 'cursor',
      payload: { userId: this.currentUser.id, x, y },
    })
  }

  private _receiveOperation(op: CollabOperation, session: CollabSession): void {
    // Update lamport clock
    this.lamportClock = Math.max(this.lamportClock, op.lamport) + 1

    // Check for conflicts: two ops on same entity within 500 ms
    const conflicting = session.operations.find(existing =>
      existing.userId !== op.userId &&
      existing.payload?.componentId === op.payload?.componentId &&
      Math.abs(existing.timestamp - op.timestamp) < 500,
    )
    if (conflicting) {
      this.emit('conflict:detected', { local: conflicting, remote: op })
    }

    session.operations.push(op)
    this.emit('operation:received', op)
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────────

  private _startHeartbeat(): void {
    this._stopHeartbeat()
    this.heartbeatInterval = setInterval(() => {
      if (this.currentUser) {
        this.currentUser.lastSeen = Date.now()
        if (this.useRealtime && this.channel) {
          this.channel.track({ ...this.currentUser }).catch(() => {})
        }
      }
    }, 15_000)
  }

  private _stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  // ── Accessors ───────────────────────────────────────────────────────────────

  getCurrentSession(): CollabSession | null { return this.currentSession }
  getCurrentUser(): CollabUser | null { return this.currentUser }
  getConnectedUsers(): CollabUser[] { return this.currentSession ? Array.from(this.currentSession.users.values()) : [] }
  isUsingRealtime(): boolean { return this.useRealtime }

  /** Legacy no-op — kept so existing callers don't break */
  receiveOperation(): void { /* handled internally via channel subscription */ }
}

export const collaborativeEditor = new CollaborativeEditor()
