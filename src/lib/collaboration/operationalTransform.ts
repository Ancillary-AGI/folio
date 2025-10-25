import { CollaborativeOperation } from './collaborativeEditor'

// Operational Transform types
export interface OperationTransform {
  type: string
  position: number
  length?: number
  data?: any
  timestamp: number
}

export interface TransformResult {
  operation1: CollaborativeOperation
  operation2: CollaborativeOperation
  conflicts: ConflictInfo[]
}

export interface ConflictInfo {
  type: 'concurrent_edit' | 'dependency_missing' | 'version_mismatch'
  operationId: string
  description: string
  severity: 'low' | 'medium' | 'high'
}

export interface OperationHistory {
  operations: CollaborativeOperation[]
  version: number
  lastModified: number
}

// Operational Transform Engine
export class OperationalTransform {
  private operationHistory: Map<string, OperationHistory> = new Map()
  private conflictResolver: ConflictResolver

  constructor() {
    this.conflictResolver = new ConflictResolver()
  }

  // Transform two operations against each other
  transformOperations(
    op1: CollaborativeOperation,
    op2: CollaborativeOperation,
    baseVersion: number
  ): TransformResult {
    const conflicts: ConflictInfo[] = []

    // Check if operations are concurrent
    if (this.isConcurrentOperation(op1, op2)) {
      const transformResult = this.transformConcurrentOperations(op1, op2)
      
      if (transformResult.conflicts.length > 0) {
        conflicts.push(...transformResult.conflicts)
      }

      return {
        operation1: transformResult.operation1,
        operation2: transformResult.operation2,
        conflicts
      }
    }

    // No conflicts, return original operations
    return {
      operation1: op1,
      operation2: op2,
      conflicts
    }
  }

  // Check if two operations are concurrent (affect the same element)
  private isConcurrentOperation(op1: CollaborativeOperation, op2: CollaborativeOperation): boolean {
    // Same operation type
    if (op1.type === op2.type) {
      switch (op1.type) {
        case 'component_update':
          return op1.data.componentId === op2.data.componentId
        case 'component_move':
          return op1.data.componentId === op2.data.componentId
        case 'wire_update':
          return op1.data.wireId === op2.data.wireId
        case 'wire_move':
          return op1.data.wireId === op2.data.wireId
        default:
          return false
      }
    }

    // Different operation types affecting the same element
    if (this.affectsSameElement(op1, op2)) {
      return true
    }

    return false
  }

  // Check if operations affect the same element
  private affectsSameElement(op1: CollaborativeOperation, op2: CollaborativeOperation): boolean {
    const getElementId = (op: CollaborativeOperation): string | null => {
      switch (op.type) {
        case 'component_update':
        case 'component_move':
        case 'component_remove':
          return op.data.componentId
        case 'wire_update':
        case 'wire_move':
        case 'wire_remove':
          return op.data.wireId
        default:
          return null
      }
    }

    const elementId1 = getElementId(op1)
    const elementId2 = getElementId(op2)

    return elementId1 !== null && elementId1 === elementId2
  }

  // Transform concurrent operations
  private transformConcurrentOperations(
    op1: CollaborativeOperation,
    op2: CollaborativeOperation
  ): TransformResult {
    const conflicts: ConflictInfo[] = []

    switch (op1.type) {
      case 'component_update':
        return this.transformComponentUpdates(op1, op2, conflicts)
      case 'component_move':
        return this.transformComponentMoves(op1, op2, conflicts)
      case 'wire_update':
        return this.transformWireUpdates(op1, op2, conflicts)
      case 'wire_move':
        return this.transformWireMoves(op1, op2, conflicts)
      default:
        // Default: keep the first operation, reject the second
        conflicts.push({
          type: 'concurrent_edit',
          operationId: op2.id,
          description: `Concurrent ${op2.type} operation conflicts with ${op1.type}`,
          severity: 'medium'
        })

        return {
          operation1: op1,
          operation2: { ...op2, data: { ...op2.data, rejected: true } },
          conflicts
        }
    }
  }

  // Transform component update operations
  private transformComponentUpdates(
    op1: CollaborativeOperation,
    op2: CollaborativeOperation,
    conflicts: ConflictInfo[]
  ): TransformResult {
    const updates1 = op1.data.updates || {}
    const updates2 = op2.data.updates || {}

    // Merge non-conflicting updates
    const mergedUpdates = { ...updates1, ...updates2 }
    
    // Check for conflicting property updates
    const conflictingProperties = this.findConflictingProperties(updates1, updates2)
    
    if (conflictingProperties.length > 0) {
      conflicts.push({
        type: 'concurrent_edit',
        operationId: op2.id,
        description: `Conflicting updates to properties: ${conflictingProperties.join(', ')}`,
        severity: 'high'
      })

      // Use the first operation's values for conflicting properties
      conflictingProperties.forEach(prop => {
        mergedUpdates[prop] = updates1[prop]
      })
    }

    const transformedOp1 = {
      ...op1,
      data: { ...op1.data, updates: mergedUpdates }
    }

    const transformedOp2 = {
      ...op2,
      data: { ...op2.data, updates: mergedUpdates }
    }

    return {
      operation1: transformedOp1,
      operation2: transformedOp2,
      conflicts
    }
  }

  // Transform component move operations
  private transformComponentMoves(
    op1: CollaborativeOperation,
    op2: CollaborativeOperation,
    conflicts: ConflictInfo[]
  ): TransformResult {
    const pos1 = op1.data.position
    const pos2 = op2.data.position

    // Calculate the final position after both moves
    const finalPosition = {
      x: pos2.x,
      y: pos2.y
    }

    // Both operations result in the same final position
    const transformedOp1 = {
      ...op1,
      data: { ...op1.data, position: finalPosition }
    }

    const transformedOp2 = {
      ...op2,
      data: { ...op2.data, position: finalPosition }
    }

    return {
      operation1: transformedOp1,
      operation2: transformedOp2,
      conflicts
    }
  }

  // Transform wire update operations
  private transformWireUpdates(
    op1: CollaborativeOperation,
    op2: CollaborativeOperation,
    conflicts: ConflictInfo[]
  ): TransformResult {
    // Similar to component updates but for wire properties
    const updates1 = op1.data.updates || {}
    const updates2 = op2.data.updates || {}

    const mergedUpdates = { ...updates1, ...updates2 }
    const conflictingProperties = this.findConflictingProperties(updates1, updates2)
    
    if (conflictingProperties.length > 0) {
      conflicts.push({
        type: 'concurrent_edit',
        operationId: op2.id,
        description: `Conflicting wire updates: ${conflictingProperties.join(', ')}`,
        severity: 'high'
      })

      conflictingProperties.forEach(prop => {
        mergedUpdates[prop] = updates1[prop]
      })
    }

    const transformedOp1 = {
      ...op1,
      data: { ...op1.data, updates: mergedUpdates }
    }

    const transformedOp2 = {
      ...op2,
      data: { ...op2.data, updates: mergedUpdates }
    }

    return {
      operation1: transformedOp1,
      operation2: transformedOp2,
      conflicts
    }
  }

  // Transform wire move operations
  private transformWireMoves(
    op1: CollaborativeOperation,
    op2: CollaborativeOperation,
    conflicts: ConflictInfo[]
  ): TransformResult {
    const points1 = op1.data.points || []
    const points2 = op2.data.points || []

    // Use the most recent wire path
    const finalPoints = points2.length > points1.length ? points2 : points1

    const transformedOp1 = {
      ...op1,
      data: { ...op1.data, points: finalPoints }
    }

    const transformedOp2 = {
      ...op2,
      data: { ...op2.data, points: finalPoints }
    }

    return {
      operation1: transformedOp1,
      operation2: transformedOp2,
      conflicts
    }
  }

  // Find conflicting properties between two update objects
  private findConflictingProperties(updates1: any, updates2: any): string[] {
    const conflicts: string[] = []

    for (const key in updates2) {
      if (updates1.hasOwnProperty(key) && updates1[key] !== updates2[key]) {
        conflicts.push(key)
      }
    }

    return conflicts
  }

  // Apply operation to the current state
  applyOperation(
    sessionId: string,
    operation: CollaborativeOperation,
    currentState: any
  ): { success: boolean; newState: any; conflicts: ConflictInfo[] } {
    const conflicts: ConflictInfo[] = []
    let newState = { ...currentState }

    try {
      switch (operation.type) {
        case 'component_add':
          newState.components = [...(newState.components || []), operation.data]
          break

        case 'component_remove':
          newState.components = (newState.components || []).filter(
            (c: any) => c.id !== operation.data.componentId
          )
          break

        case 'component_move':
          newState.components = (newState.components || []).map((c: any) =>
            c.id === operation.data.componentId
              ? { ...c, position: operation.data.position }
              : c
          )
          break

        case 'component_update':
          newState.components = (newState.components || []).map((c: any) =>
            c.id === operation.data.componentId
              ? { ...c, ...operation.data.updates }
              : c
          )
          break

        case 'wire_add':
          newState.wires = [...(newState.wires || []), operation.data]
          break

        case 'wire_remove':
          newState.wires = (newState.wires || []).filter(
            (w: any) => w.id !== operation.data.wireId
          )
          break

        case 'wire_update':
          newState.wires = (newState.wires || []).map((w: any) =>
            w.id === operation.data.wireId
              ? { ...w, ...operation.data.updates }
              : w
          )
          break

        default:
          conflicts.push({
            type: 'concurrent_edit',
            operationId: operation.id,
            description: `Unknown operation type: ${operation.type}`,
            severity: 'high'
          })
          return { success: false, newState, conflicts }
      }

      // Update operation history
      this.updateOperationHistory(sessionId, operation)

      return { success: true, newState, conflicts }
    } catch (error) {
      conflicts.push({
        type: 'concurrent_edit',
        operationId: operation.id,
        description: `Failed to apply operation: ${error}`,
        severity: 'high'
      })

      return { success: false, newState, conflicts }
    }
  }

  // Update operation history for a session
  private updateOperationHistory(sessionId: string, operation: CollaborativeOperation): void {
    const history = this.operationHistory.get(sessionId) || {
      operations: [],
      version: 0,
      lastModified: Date.now()
    }

    history.operations.push(operation)
    history.version = Math.max(history.version, operation.version)
    history.lastModified = Date.now()

    // Keep only last 1000 operations
    if (history.operations.length > 1000) {
      history.operations = history.operations.slice(-1000)
    }

    this.operationHistory.set(sessionId, history)
  }

  // Get operation history for a session
  getOperationHistory(sessionId: string): OperationHistory | undefined {
    return this.operationHistory.get(sessionId)
  }

  // Resolve conflicts using the conflict resolver
  resolveConflicts(conflicts: ConflictInfo[], operation: CollaborativeOperation): CollaborativeOperation | null {
    return this.conflictResolver.resolveConflicts(conflicts, operation)
  }
}

// Conflict Resolution Engine
class ConflictResolver {
  resolveConflicts(conflicts: ConflictInfo[], operation: CollaborativeOperation): CollaborativeOperation | null {
    // Sort conflicts by severity
    const sortedConflicts = conflicts.sort((a, b) => {
      const severityOrder = { high: 3, medium: 2, low: 1 }
      return severityOrder[b.severity] - severityOrder[a.severity]
    })

    // Handle highest priority conflict
    const primaryConflict = sortedConflicts[0]
    if (!primaryConflict) return operation

    switch (primaryConflict.type) {
      case 'concurrent_edit':
        return this.resolveConcurrentEdit(operation, primaryConflict)
      case 'dependency_missing':
        return this.resolveDependencyMissing(operation, primaryConflict)
      case 'version_mismatch':
        return this.resolveVersionMismatch(operation, primaryConflict)
      default:
        return null
    }
  }

  private resolveConcurrentEdit(operation: CollaborativeOperation, conflict: ConflictInfo): CollaborativeOperation | null {
    // For concurrent edits, we can try to merge or reject
    // This is a simplified implementation - in production, you'd use more sophisticated merging
    
    if (conflict.severity === 'high') {
      // High severity conflicts are rejected
      return null
    }

    // Medium and low severity conflicts can be merged
    return {
      ...operation,
      data: {
        ...operation.data,
        merged: true,
        conflictResolved: true
      }
    }
  }

  private resolveDependencyMissing(operation: CollaborativeOperation, conflict: ConflictInfo): CollaborativeOperation | null {
    // For missing dependencies, we can either wait or reject
    // In this implementation, we reject operations with missing dependencies
    return null
  }

  private resolveVersionMismatch(operation: CollaborativeOperation, conflict: ConflictInfo): CollaborativeOperation | null {
    // For version mismatches, we reject the operation
    // The client should request the latest state and retry
    return null
  }
}

// Export singleton instance
export const operationalTransform = new OperationalTransform()
