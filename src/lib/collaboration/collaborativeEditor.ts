import { EventEmitter } from 'events'
import { Project, Schematic, PlacedComponent, Wire } from '../supabase'

// Collaborative editing types
export interface CollaborativeUser {
  id: string
  name: string
  email: string
  avatar?: string
  color: string
  cursor?: CursorPosition
  selection?: SelectionState
  isActive: boolean
  lastSeen: number
}

export interface CursorPosition {
  x: number
  y: number
  timestamp: number
}

export interface SelectionState {
  components: string[]
  wires: string[]
  area?: {
    x: number
    y: number
    width: number
    height: number
  }
}

export interface CollaborativeOperation {
  id: string
  type: 'component_add' | 'component_remove' | 'component_move' | 'component_update' | 
        'wire_add' | 'wire_remove' | 'wire_update' | 'cursor_move' | 'selection_change'
  userId: string
  timestamp: number
  data: any
  version: number
  dependencies?: string[]
}

export interface CollaborativeSession {
  id: string
  projectId: string
  users: Map<string, CollaborativeUser>
  operations: CollaborativeOperation[]
  version: number
  isActive: boolean
  createdAt: number
  lastActivity: number
}

export interface ConflictResolution {
  operationId: string
  conflictType: 'concurrent_edit' | 'dependency_missing' | 'version_mismatch'
  resolution: 'accept' | 'reject' | 'merge' | 'manual'
  resolvedOperation?: CollaborativeOperation
}

export class CollaborativeEditor extends EventEmitter {
  private ws: WebSocket | null = null
  private session: CollaborativeSession | null = null
  private currentUser: CollaborativeUser | null = null
  private operationQueue: CollaborativeOperation[] = []
  private pendingOperations: Map<string, CollaborativeOperation> = new Map()
  private isConnected = false
  private reconnectAttempts = 0
  private maxReconnectAttempts = 5
  private reconnectDelay = 1000
  private heartbeatInterval: NodeJS.Timeout | null = null
  private operationBuffer: CollaborativeOperation[] = []
  private bufferTimeout: NodeJS.Timeout | null = null

  constructor() {
    super()
    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    // Handle window beforeunload to notify other users
    window.addEventListener('beforeunload', () => {
      if (this.isConnected && this.currentUser) {
        this.sendOperation({
          type: 'user_leave',
          userId: this.currentUser.id,
          timestamp: Date.now(),
          data: { userId: this.currentUser.id }
        })
      }
    })

    // Handle visibility change to update presence
    document.addEventListener('visibilitychange', () => {
      if (this.isConnected && this.currentUser) {
        this.sendOperation({
          type: 'presence_update',
          userId: this.currentUser.id,
          timestamp: Date.now(),
          data: { 
            isActive: !document.hidden,
            lastSeen: Date.now()
          }
        })
      }
    })
  }

  async connect(user: CollaborativeUser, projectId: string): Promise<boolean> {
    try {
      this.currentUser = user
      
      // Connect to WebSocket server
      const wsUrl = this.getWebSocketUrl()
      this.ws = new WebSocket(wsUrl)
      
      return new Promise((resolve, reject) => {
        if (!this.ws) {
          reject(new Error('Failed to create WebSocket connection'))
          return
        }

        this.ws.onopen = () => {
          console.log('Connected to collaborative editing server')
          this.isConnected = true
          this.reconnectAttempts = 0
          
          // Start heartbeat
          this.startHeartbeat()
          
          // Join project session
          this.joinSession(projectId)
          
          resolve(true)
        }

        this.ws.onmessage = (event) => {
          this.handleMessage(JSON.parse(event.data))
        }

        this.ws.onclose = (event) => {
          console.log('WebSocket connection closed:', event.code, event.reason)
          this.isConnected = false
          this.stopHeartbeat()
          
          // Attempt to reconnect if not a clean close
          if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.scheduleReconnect()
          }
        }

        this.ws.onerror = (error) => {
          console.error('WebSocket error:', error)
          reject(error)
        }
      })
    } catch (error) {
      console.error('Failed to connect to collaborative editing:', error)
      return false
    }
  }

  private getWebSocketUrl(): string {
    // In production, this would be your WebSocket server URL
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = process.env.NODE_ENV === 'production' 
      ? 'your-websocket-server.com' 
      : 'localhost:8080'
    
    return `${protocol}//${host}/collaborative`
  }

  private joinSession(projectId: string): void {
    if (!this.ws || !this.currentUser) return

    const message = {
      type: 'join_session',
      projectId,
      user: this.currentUser,
      timestamp: Date.now()
    }

    this.ws.send(JSON.stringify(message))
  }

  private handleMessage(message: any): void {
    switch (message.type) {
      case 'session_joined':
        this.handleSessionJoined(message)
        break
      case 'user_joined':
        this.handleUserJoined(message)
        break
      case 'user_left':
        this.handleUserLeft(message)
        break
      case 'operation_received':
        this.handleOperationReceived(message)
        break
      case 'operation_conflict':
        this.handleOperationConflict(message)
        break
      case 'presence_update':
        this.handlePresenceUpdate(message)
        break
      case 'cursor_update':
        this.handleCursorUpdate(message)
        break
      case 'selection_update':
        this.handleSelectionUpdate(message)
        break
      case 'heartbeat':
        this.handleHeartbeat(message)
        break
      default:
        console.warn('Unknown message type:', message.type)
    }
  }

  private handleSessionJoined(message: any): void {
    this.session = {
      id: message.sessionId,
      projectId: message.projectId,
      users: new Map(message.users.map((u: CollaborativeUser) => [u.id, u])),
      operations: message.operations || [],
      version: message.version || 0,
      isActive: true,
      createdAt: message.createdAt,
      lastActivity: Date.now()
    }

    this.emit('session:joined', this.session)
    console.log('Joined collaborative session:', this.session.id)
  }

  private handleUserJoined(message: any): void {
    if (!this.session) return

    const user: CollaborativeUser = message.user
    this.session.users.set(user.id, user)
    this.session.lastActivity = Date.now()

    this.emit('user:joined', user)
    console.log('User joined:', user.name)
  }

  private handleUserLeft(message: any): void {
    if (!this.session) return

    const userId = message.userId
    const user = this.session.users.get(userId)
    
    if (user) {
      this.session.users.delete(userId)
      this.session.lastActivity = Date.now()

      this.emit('user:left', user)
      console.log('User left:', user.name)
    }
  }

  private handleOperationReceived(message: any): void {
    const operation: CollaborativeOperation = message.operation
    
    // Don't process our own operations
    if (operation.userId === this.currentUser?.id) {
      return
    }

    // Apply operation to local state
    this.applyOperation(operation)
    
    // Update session version
    if (this.session) {
      this.session.version = Math.max(this.session.version, operation.version)
      this.session.lastActivity = Date.now()
    }

    this.emit('operation:received', operation)
  }

  private handleOperationConflict(message: any): void {
    const conflict: ConflictResolution = message.conflict
    
    console.warn('Operation conflict detected:', conflict)
    
    // Attempt automatic resolution
    const resolution = this.resolveConflict(conflict)
    
    if (resolution) {
      this.sendOperation(resolution)
    } else {
      // Notify user of manual resolution needed
      this.emit('conflict:manual_resolution_needed', conflict)
    }
  }

  private handlePresenceUpdate(message: any): void {
    if (!this.session) return

    const userId = message.userId
    const user = this.session.users.get(userId)
    
    if (user) {
      user.isActive = message.data.isActive
      user.lastSeen = message.data.lastSeen
      
      this.emit('presence:updated', user)
    }
  }

  private handleCursorUpdate(message: any): void {
    if (!this.session) return

    const userId = message.userId
    const user = this.session.users.get(userId)
    
    if (user) {
      user.cursor = message.cursor
      
      this.emit('cursor:updated', { user, cursor: message.cursor })
    }
  }

  private handleSelectionUpdate(message: any): void {
    if (!this.session) return

    const userId = message.userId
    const user = this.session.users.get(userId)
    
    if (user) {
      user.selection = message.selection
      
      this.emit('selection:updated', { user, selection: message.selection })
    }
  }

  private handleHeartbeat(message: any): void {
    // Respond to heartbeat
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify({
        type: 'heartbeat_response',
        timestamp: Date.now()
      }))
    }
  }

  // Operation sending and management
  sendOperation(operation: Omit<CollaborativeOperation, 'id' | 'version'>): void {
    if (!this.ws || !this.isConnected || !this.session) {
      console.warn('Cannot send operation: not connected or no session')
      return
    }

    const fullOperation: CollaborativeOperation = {
      ...operation,
      id: this.generateOperationId(),
      version: this.session.version + 1
    }

    // Add to pending operations
    this.pendingOperations.set(fullOperation.id, fullOperation)

    // Buffer operations to reduce network traffic
    this.bufferOperation(fullOperation)
  }

  private bufferOperation(operation: CollaborativeOperation): void {
    this.operationBuffer.push(operation)

    // Clear existing timeout
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout)
    }

    // Send buffered operations after a short delay
    this.bufferTimeout = setTimeout(() => {
      this.flushOperationBuffer()
    }, 50) // 50ms buffer
  }

  private flushOperationBuffer(): void {
    if (this.operationBuffer.length === 0 || !this.ws) return

    const message = {
      type: 'operations_batch',
      operations: this.operationBuffer,
      timestamp: Date.now()
    }

    this.ws.send(JSON.stringify(message))
    this.operationBuffer = []
  }

  private applyOperation(operation: CollaborativeOperation): void {
    // Apply operation to local state based on type
    switch (operation.type) {
      case 'component_add':
        this.emit('operation:component_add', operation.data)
        break
      case 'component_remove':
        this.emit('operation:component_remove', operation.data)
        break
      case 'component_move':
        this.emit('operation:component_move', operation.data)
        break
      case 'component_update':
        this.emit('operation:component_update', operation.data)
        break
      case 'wire_add':
        this.emit('operation:wire_add', operation.data)
        break
      case 'wire_remove':
        this.emit('operation:wire_remove', operation.data)
        break
      case 'wire_update':
        this.emit('operation:wire_update', operation.data)
        break
      case 'cursor_move':
        this.handleCursorUpdate({ userId: operation.userId, cursor: operation.data })
        break
      case 'selection_change':
        this.handleSelectionUpdate({ userId: operation.userId, selection: operation.data })
        break
    }
  }

  private resolveConflict(conflict: ConflictResolution): CollaborativeOperation | null {
    // Implement conflict resolution logic
    switch (conflict.conflictType) {
      case 'concurrent_edit':
        // Use operational transform to merge changes
        return this.mergeConcurrentEdits(conflict)
      
      case 'dependency_missing':
        // Wait for dependency or reject operation
        return null
      
      case 'version_mismatch':
        // Request latest state and retry
        this.requestLatestState()
        return null
      
      default:
        return null
    }
  }

  private mergeConcurrentEdits(conflict: ConflictResolution): CollaborativeOperation | null {
    // Implement operational transform for merging concurrent edits
    // This is a simplified version - in production, you'd use a proper OT library
    
    if (!conflict.resolvedOperation) {
      return null
    }

    return conflict.resolvedOperation
  }

  private requestLatestState(): void {
    if (this.ws && this.isConnected) {
      this.ws.send(JSON.stringify({
        type: 'request_latest_state',
        timestamp: Date.now()
      }))
    }
  }

  // Public API methods
  updateCursor(x: number, y: number): void {
    if (!this.currentUser) return

    const cursor: CursorPosition = {
      x,
      y,
      timestamp: Date.now()
    }

    this.currentUser.cursor = cursor

    this.sendOperation({
      type: 'cursor_move',
      userId: this.currentUser.id,
      timestamp: Date.now(),
      data: cursor
    })
  }

  updateSelection(selection: SelectionState): void {
    if (!this.currentUser) return

    this.currentUser.selection = selection

    this.sendOperation({
      type: 'selection_change',
      userId: this.currentUser.id,
      timestamp: Date.now(),
      data: selection
    })
  }

  addComponent(component: PlacedComponent): void {
    this.sendOperation({
      type: 'component_add',
      userId: this.currentUser!.id,
      timestamp: Date.now(),
      data: component
    })
  }

  removeComponent(componentId: string): void {
    this.sendOperation({
      type: 'component_remove',
      userId: this.currentUser!.id,
      timestamp: Date.now(),
      data: { componentId }
    })
  }

  moveComponent(componentId: string, position: { x: number; y: number }): void {
    this.sendOperation({
      type: 'component_move',
      userId: this.currentUser!.id,
      timestamp: Date.now(),
      data: { componentId, position }
    })
  }

  updateComponent(componentId: string, updates: Partial<PlacedComponent>): void {
    this.sendOperation({
      type: 'component_update',
      userId: this.currentUser!.id,
      timestamp: Date.now(),
      data: { componentId, updates }
    })
  }

  addWire(wire: Wire): void {
    this.sendOperation({
      type: 'wire_add',
      userId: this.currentUser!.id,
      timestamp: Date.now(),
      data: wire
    })
  }

  removeWire(wireId: string): void {
    this.sendOperation({
      type: 'wire_remove',
      userId: this.currentUser!.id,
      timestamp: Date.now(),
      data: { wireId }
    })
  }

  updateWire(wireId: string, updates: Partial<Wire>): void {
    this.sendOperation({
      type: 'wire_update',
      userId: this.currentUser!.id,
      timestamp: Date.now(),
      data: { wireId, updates }
    })
  }

  // Utility methods
  private generateOperationId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.isConnected) {
        this.ws.send(JSON.stringify({
          type: 'heartbeat',
          timestamp: Date.now()
        }))
      }
    }, 30000) // 30 seconds
  }

  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }
  }

  private scheduleReconnect(): void {
    this.reconnectAttempts++
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1)
    
    console.log(`Scheduling reconnect attempt ${this.reconnectAttempts} in ${delay}ms`)
    
    setTimeout(() => {
      if (this.currentUser) {
        this.connect(this.currentUser, this.session?.projectId || '')
      }
    }, delay)
  }

  // Getters
  getSession(): CollaborativeSession | null {
    return this.session
  }

  getCurrentUser(): CollaborativeUser | null {
    return this.currentUser
  }

  getUsers(): CollaborativeUser[] {
    return this.session ? Array.from(this.session.users.values()) : []
  }

  isUserConnected(): boolean {
    return this.isConnected
  }

  // Cleanup
  disconnect(): void {
    if (this.ws) {
      this.ws.close(1000, 'User disconnected')
      this.ws = null
    }
    
    this.isConnected = false
    this.stopHeartbeat()
    
    if (this.bufferTimeout) {
      clearTimeout(this.bufferTimeout)
      this.bufferTimeout = null
    }
    
    this.session = null
    this.currentUser = null
    this.operationQueue = []
    this.pendingOperations.clear()
    this.operationBuffer = []
    
    this.emit('disconnected')
  }

  dispose(): void {
    this.disconnect()
    this.removeAllListeners()
  }
}

// Export singleton instance
export const collaborativeEditor = new CollaborativeEditor()
