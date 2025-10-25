import { EventEmitter } from 'events'
import { CollaborativeUser, CollaborativeOperation, CollaborativeSession, ConflictResolution } from './collaborativeEditor'

// WebSocket server message types
export interface ServerMessage {
  type: string
  data?: any
  timestamp: number
  sessionId?: string
  userId?: string
}

export interface ClientMessage {
  type: string
  data?: any
  timestamp: number
  projectId?: string
  user?: CollaborativeUser
  operations?: CollaborativeOperation[]
}

export interface SessionState {
  projectId: string
  users: Map<string, CollaborativeUser>
  operations: CollaborativeOperation[]
  version: number
  lastActivity: number
}

export class CollaborativeServer extends EventEmitter {
  private sessions: Map<string, CollaborativeSession> = new Map()
  private userSessions: Map<string, string> = new Map() // userId -> sessionId
  private operationHistory: Map<string, CollaborativeOperation[]> = new Map()
  private conflictResolver: ConflictResolver
  private isRunning = false

  constructor() {
    super()
    this.conflictResolver = new ConflictResolver()
    this.setupCleanupTasks()
  }

  private setupCleanupTasks(): void {
    // Clean up inactive sessions every 5 minutes
    setInterval(() => {
      this.cleanupInactiveSessions()
    }, 5 * 60 * 1000)

    // Clean up old operations every hour
    setInterval(() => {
      this.cleanupOldOperations()
    }, 60 * 60 * 1000)
  }

  handleConnection(ws: WebSocket, userId: string): void {
    console.log(`User ${userId} connected`)

    ws.on('message', (data: string) => {
      try {
        const message: ClientMessage = JSON.parse(data)
        this.handleMessage(ws, userId, message)
      } catch (error) {
        console.error('Failed to parse message:', error)
        this.sendError(ws, 'Invalid message format')
      }
    })

    ws.on('close', () => {
      console.log(`User ${userId} disconnected`)
      this.handleDisconnection(userId)
    })

    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error)
    })
  }

  private handleMessage(ws: WebSocket, userId: string, message: ClientMessage): void {
    switch (message.type) {
      case 'join_session':
        this.handleJoinSession(ws, userId, message)
        break
      case 'leave_session':
        this.handleLeaveSession(userId)
        break
      case 'operations_batch':
        this.handleOperationsBatch(userId, message)
        break
      case 'heartbeat':
        this.handleHeartbeat(ws, userId)
        break
      case 'request_latest_state':
        this.handleRequestLatestState(ws, userId)
        break
      case 'presence_update':
        this.handlePresenceUpdate(userId, message)
        break
      case 'cursor_update':
        this.handleCursorUpdate(userId, message)
        break
      case 'selection_update':
        this.handleSelectionUpdate(userId, message)
        break
      default:
        console.warn(`Unknown message type: ${message.type}`)
        this.sendError(ws, `Unknown message type: ${message.type}`)
    }
  }

  private handleJoinSession(ws: WebSocket, userId: string, message: ClientMessage): void {
    const { projectId, user } = message.data

    if (!projectId || !user) {
      this.sendError(ws, 'Missing projectId or user data')
      return
    }

    // Leave existing session if any
    this.handleLeaveSession(userId)

    // Get or create session
    let session = this.getOrCreateSession(projectId)
    
    // Add user to session
    session.users.set(userId, user)
    session.lastActivity = Date.now()
    
    // Track user session
    this.userSessions.set(userId, session.id)

    // Send session joined confirmation
    this.sendMessage(ws, {
      type: 'session_joined',
      sessionId: session.id,
      projectId: session.projectId,
      users: Array.from(session.users.values()),
      operations: session.operations.slice(-100), // Send last 100 operations
      version: session.version,
      createdAt: session.createdAt
    })

    // Notify other users
    this.broadcastToSession(session.id, {
      type: 'user_joined',
      user,
      timestamp: Date.now()
    }, userId)

    console.log(`User ${user.name} joined session ${session.id}`)
  }

  private handleLeaveSession(userId: string): void {
    const sessionId = this.userSessions.get(userId)
    if (!sessionId) return

    const session = this.sessions.get(sessionId)
    if (!session) return

    const user = session.users.get(userId)
    if (user) {
      // Notify other users
      this.broadcastToSession(sessionId, {
        type: 'user_left',
        userId,
        timestamp: Date.now()
      }, userId)

      // Remove user from session
      session.users.delete(userId)
      session.lastActivity = Date.now()

      // Remove session if empty
      if (session.users.size === 0) {
        this.sessions.delete(sessionId)
        console.log(`Session ${sessionId} removed (empty)`)
      }

      // Remove user session tracking
      this.userSessions.delete(userId)

      console.log(`User ${user.name} left session ${sessionId}`)
    }
  }

  private handleOperationsBatch(userId: string, message: ClientMessage): void {
    const sessionId = this.userSessions.get(userId)
    if (!sessionId) return

    const session = this.sessions.get(sessionId)
    if (!session) return

    const operations = message.operations || []
    
    for (const operation of operations) {
      // Validate operation
      if (!this.validateOperation(operation)) {
        console.warn(`Invalid operation from user ${userId}:`, operation)
        continue
      }

      // Check for conflicts
      const conflicts = this.detectConflicts(session, operation)
      
      if (conflicts.length > 0) {
        // Resolve conflicts
        const resolution = this.conflictResolver.resolveConflicts(conflicts, operation)
        
        if (resolution.resolution === 'accept') {
          this.applyOperation(session, operation)
        } else if (resolution.resolution === 'reject') {
          this.sendConflictNotification(userId, resolution)
          continue
        } else if (resolution.resolution === 'merge') {
          const mergedOperation = resolution.resolvedOperation
          if (mergedOperation) {
            this.applyOperation(session, mergedOperation)
          }
        }
      } else {
        // No conflicts, apply operation
        this.applyOperation(session, operation)
      }
    }

    // Broadcast operations to other users
    this.broadcastToSession(sessionId, {
      type: 'operations_received',
      operations,
      timestamp: Date.now()
    }, userId)
  }

  private handleHeartbeat(ws: WebSocket, userId: string): void {
    this.sendMessage(ws, {
      type: 'heartbeat_response',
      timestamp: Date.now()
    })
  }

  private handleRequestLatestState(ws: WebSocket, userId: string): void {
    const sessionId = this.userSessions.get(userId)
    if (!sessionId) return

    const session = this.sessions.get(sessionId)
    if (!session) return

    this.sendMessage(ws, {
      type: 'latest_state',
      sessionId,
      operations: session.operations,
      version: session.version,
      timestamp: Date.now()
    })
  }

  private handlePresenceUpdate(userId: string, message: ClientMessage): void {
    const sessionId = this.userSessions.get(userId)
    if (!sessionId) return

    const session = this.sessions.get(sessionId)
    if (!session) return

    const user = session.users.get(userId)
    if (user) {
      user.isActive = message.data.isActive
      user.lastSeen = message.data.lastSeen
      session.lastActivity = Date.now()

      // Broadcast presence update
      this.broadcastToSession(sessionId, {
        type: 'presence_update',
        userId,
        data: message.data,
        timestamp: Date.now()
      }, userId)
    }
  }

  private handleCursorUpdate(userId: string, message: ClientMessage): void {
    const sessionId = this.userSessions.get(userId)
    if (!sessionId) return

    const session = this.sessions.get(sessionId)
    if (!session) return

    const user = session.users.get(userId)
    if (user) {
      user.cursor = message.data.cursor
      session.lastActivity = Date.now()

      // Broadcast cursor update
      this.broadcastToSession(sessionId, {
        type: 'cursor_update',
        userId,
        cursor: message.data.cursor,
        timestamp: Date.now()
      }, userId)
    }
  }

  private handleSelectionUpdate(userId: string, message: ClientMessage): void {
    const sessionId = this.userSessions.get(userId)
    if (!sessionId) return

    const session = this.sessions.get(sessionId)
    if (!sessionId) return

    const user = session.users.get(userId)
    if (user) {
      user.selection = message.data.selection
      session.lastActivity = Date.now()

      // Broadcast selection update
      this.broadcastToSession(sessionId, {
        type: 'selection_update',
        userId,
        selection: message.data.selection,
        timestamp: Date.now()
      }, userId)
    }
  }

  private handleDisconnection(userId: string): void {
    this.handleLeaveSession(userId)
  }

  private getOrCreateSession(projectId: string): CollaborativeSession {
    // Check if session already exists for this project
    for (const session of this.sessions.values()) {
      if (session.projectId === projectId) {
        return session
      }
    }

    // Create new session
    const sessionId = this.generateSessionId()
    const session: CollaborativeSession = {
      id: sessionId,
      projectId,
      users: new Map(),
      operations: [],
      version: 0,
      isActive: true,
      createdAt: Date.now(),
      lastActivity: Date.now()
    }

    this.sessions.set(sessionId, session)
    this.operationHistory.set(sessionId, [])

    console.log(`Created new session ${sessionId} for project ${projectId}`)
    return session
  }

  private validateOperation(operation: CollaborativeOperation): boolean {
    // Basic validation
    if (!operation.id || !operation.type || !operation.userId || !operation.timestamp) {
      return false
    }

    // Validate operation type
    const validTypes = [
      'component_add', 'component_remove', 'component_move', 'component_update',
      'wire_add', 'wire_remove', 'wire_update', 'cursor_move', 'selection_change'
    ]

    return validTypes.includes(operation.type)
  }

  private detectConflicts(session: CollaborativeSession, operation: CollaborativeOperation): ConflictResolution[] {
    const conflicts: ConflictResolution[] = []

    // Check for concurrent edits on the same element
    const recentOperations = session.operations.slice(-10) // Check last 10 operations
    
    for (const existingOp of recentOperations) {
      if (this.isConcurrentEdit(existingOp, operation)) {
        conflicts.push({
          operationId: operation.id,
          conflictType: 'concurrent_edit',
          resolution: 'manual' // Will be resolved by conflict resolver
        })
      }
    }

    // Check for version conflicts
    if (operation.version <= session.version) {
      conflicts.push({
        operationId: operation.id,
        conflictType: 'version_mismatch',
        resolution: 'reject'
      })
    }

    return conflicts
  }

  private isConcurrentEdit(op1: CollaborativeOperation, op2: CollaborativeOperation): boolean {
    // Check if operations affect the same element
    if (op1.type === op2.type) {
      switch (op1.type) {
        case 'component_update':
          return op1.data.componentId === op2.data.componentId
        case 'wire_update':
          return op1.data.wireId === op2.data.wireId
        case 'component_move':
          return op1.data.componentId === op2.data.componentId
        default:
          return false
      }
    }

    return false
  }

  private applyOperation(session: CollaborativeSession, operation: CollaborativeOperation): void {
    // Add operation to session
    session.operations.push(operation)
    session.version = Math.max(session.version, operation.version)
    session.lastActivity = Date.now()

    // Store in operation history
    const history = this.operationHistory.get(session.id) || []
    history.push(operation)
    this.operationHistory.set(session.id, history)

    // Limit operation history size
    if (history.length > 1000) {
      history.splice(0, history.length - 1000)
    }
  }

  private sendConflictNotification(userId: string, conflict: ConflictResolution): void {
    // This would send a conflict notification to the specific user
    // Implementation depends on your WebSocket setup
    console.log(`Conflict notification for user ${userId}:`, conflict)
  }

  private broadcastToSession(sessionId: string, message: ServerMessage, excludeUserId?: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    // This would broadcast to all users in the session except the excluded one
    // Implementation depends on your WebSocket setup
    console.log(`Broadcasting to session ${sessionId}:`, message)
  }

  private sendMessage(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message))
    }
  }

  private sendError(ws: WebSocket, error: string): void {
    this.sendMessage(ws, {
      type: 'error',
      data: { error },
      timestamp: Date.now()
    })
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private cleanupInactiveSessions(): void {
    const now = Date.now()
    const inactiveThreshold = 30 * 60 * 1000 // 30 minutes

    for (const [sessionId, session] of this.sessions) {
      if (now - session.lastActivity > inactiveThreshold) {
        console.log(`Cleaning up inactive session ${sessionId}`)
        
        // Notify users before cleanup
        this.broadcastToSession(sessionId, {
          type: 'session_inactive',
          timestamp: now
        })

        // Remove session
        this.sessions.delete(sessionId)
        this.operationHistory.delete(sessionId)
      }
    }
  }

  private cleanupOldOperations(): void {
    const now = Date.now()
    const operationThreshold = 24 * 60 * 60 * 1000 // 24 hours

    for (const [sessionId, operations] of this.operationHistory) {
      const filteredOperations = operations.filter(op => 
        now - op.timestamp < operationThreshold
      )
      
      if (filteredOperations.length !== operations.length) {
        this.operationHistory.set(sessionId, filteredOperations)
        console.log(`Cleaned up old operations for session ${sessionId}`)
      }
    }
  }

  // Public API
  getSessionStats(): { totalSessions: number; totalUsers: number; activeUsers: number } {
    let totalUsers = 0
    let activeUsers = 0

    for (const session of this.sessions.values()) {
      totalUsers += session.users.size
      activeUsers += Array.from(session.users.values()).filter(u => u.isActive).length
    }

    return {
      totalSessions: this.sessions.size,
      totalUsers,
      activeUsers
    }
  }

  getSession(sessionId: string): CollaborativeSession | undefined {
    return this.sessions.get(sessionId)
  }

  getAllSessions(): CollaborativeSession[] {
    return Array.from(this.sessions.values())
  }
}

// Conflict Resolution System
class ConflictResolver {
  resolveConflicts(conflicts: ConflictResolution[], operation: CollaborativeOperation): ConflictResolution {
    // Implement conflict resolution strategies
    for (const conflict of conflicts) {
      switch (conflict.conflictType) {
        case 'concurrent_edit':
          return this.resolveConcurrentEdit(conflict, operation)
        case 'version_mismatch':
          return this.resolveVersionMismatch(conflict, operation)
        case 'dependency_missing':
          return this.resolveDependencyMissing(conflict, operation)
        default:
          return { ...conflict, resolution: 'reject' }
      }
    }

    return { ...conflicts[0], resolution: 'accept' }
  }

  private resolveConcurrentEdit(conflict: ConflictResolution, operation: CollaborativeOperation): ConflictResolution {
    // Implement operational transform for concurrent edits
    // This is a simplified version - in production, use a proper OT library
    
    return {
      ...conflict,
      resolution: 'merge',
      resolvedOperation: operation // Simplified - would merge changes
    }
  }

  private resolveVersionMismatch(conflict: ConflictResolution, operation: CollaborativeOperation): ConflictResolution {
    return {
      ...conflict,
      resolution: 'reject'
    }
  }

  private resolveDependencyMissing(conflict: ConflictResolution, operation: CollaborativeOperation): ConflictResolution {
    return {
      ...conflict,
      resolution: 'reject'
    }
  }
}

export const collaborativeServer = new CollaborativeServer()
