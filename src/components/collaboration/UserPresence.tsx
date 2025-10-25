import React, { useEffect, useRef, useState } from 'react'
import { CollaborativeUser, CursorPosition, SelectionState } from '../../lib/collaboration/collaborativeEditor'

interface UserPresenceProps {
  users: CollaborativeUser[]
  showCursors: boolean
  showSelections: boolean
  canvasRef: React.RefObject<HTMLDivElement>
}

export default function UserPresence({ users, showCursors, showSelections, canvasRef }: UserPresenceProps) {
  const [cursors, setCursors] = useState<Map<string, CursorPosition>>(new Map())
  const [selections, setSelections] = useState<Map<string, SelectionState>>(new Map())
  const cursorRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    // Update cursors and selections from users
    const newCursors = new Map<string, CursorPosition>()
    const newSelections = new Map<string, SelectionState>()

    users.forEach(user => {
      if (user.cursor) {
        newCursors.set(user.id, user.cursor)
      }
      if (user.selection) {
        newSelections.set(user.id, user.selection)
      }
    })

    setCursors(newCursors)
    setSelections(newSelections)
  }, [users])

  const getUserInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getCanvasPosition = (position: CursorPosition) => {
    if (!canvasRef.current) return { x: 0, y: 0 }

    const canvasRect = canvasRef.current.getBoundingClientRect()
    return {
      x: position.x - canvasRect.left,
      y: position.y - canvasRect.top
    }
  }

  const getSelectionBounds = (selection: SelectionState) => {
    if (!selection.area || !canvasRef.current) return null

    const canvasRect = canvasRef.current.getBoundingClientRect()
    return {
      x: selection.area.x - canvasRect.left,
      y: selection.area.y - canvasRect.top,
      width: selection.area.width,
      height: selection.area.height
    }
  }

  return (
    <>
      {/* User Cursors */}
      {showCursors && Array.from(cursors.entries()).map(([userId, cursor]) => {
        const user = users.find(u => u.id === userId)
        if (!user || !user.isActive) return null

        const canvasPos = getCanvasPosition(cursor)
        const isRecent = Date.now() - cursor.timestamp < 5000 // Show for 5 seconds

        if (!isRecent) return null

        return (
          <div
            key={`cursor-${userId}`}
            ref={(el) => {
              if (el) cursorRefs.current.set(userId, el)
            }}
            className="absolute pointer-events-none z-50 transition-all duration-100"
            style={{
              left: canvasPos.x,
              top: canvasPos.y,
              transform: 'translate(-2px, -2px)'
            }}
          >
            {/* Cursor Arrow */}
            <div
              className="w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-current"
              style={{ color: user.color }}
            />
            
            {/* User Label */}
            <div
              className="absolute top-4 left-2 px-2 py-1 rounded text-xs font-medium text-white whitespace-nowrap"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </div>

            {/* Cursor Trail */}
            <div
              className="absolute top-1 left-1 w-2 h-2 rounded-full opacity-50"
              style={{ backgroundColor: user.color }}
            />
          </div>
        )
      })}

      {/* User Selections */}
      {showSelections && Array.from(selections.entries()).map(([userId, selection]) => {
        const user = users.find(u => u.id === userId)
        if (!user || !user.isActive || !selection.area) return null

        const bounds = getSelectionBounds(selection)
        if (!bounds) return null

        return (
          <div
            key={`selection-${userId}`}
            className="absolute pointer-events-none z-40"
            style={{
              left: bounds.x,
              top: bounds.y,
              width: bounds.width,
              height: bounds.height
            }}
          >
            {/* Selection Rectangle */}
            <div
              className="w-full h-full border-2 border-dashed opacity-50"
              style={{ borderColor: user.color }}
            />
            
            {/* Selection Label */}
            <div
              className="absolute -top-6 left-0 px-2 py-1 rounded text-xs font-medium text-white"
              style={{ backgroundColor: user.color }}
            >
              {user.name}
            </div>
          </div>
        )
      })}

      {/* User Activity Indicators */}
      {users.map((user) => {
        if (!user.isActive) return null

        return (
          <div
            key={`activity-${user.id}`}
            className="absolute top-2 right-2 z-50"
          >
            <div className="flex items-center gap-2">
              {/* User Avatar */}
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white"
                style={{ backgroundColor: user.color }}
                title={`${user.name} is active`}
              >
                {getUserInitials(user.name)}
              </div>
              
              {/* Activity Pulse */}
              <div
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: user.color }}
              />
            </div>
          </div>
        )
      })}
    </>
  )
}

// Cursor Animation Component
export function CursorAnimation({ user, position }: { user: CollaborativeUser; position: CursorPosition }) {
  const [isVisible, setIsVisible] = useState(true)

  useEffect(() => {
    setIsVisible(true)
    const timer = setTimeout(() => setIsVisible(false), 5000)
    return () => clearTimeout(timer)
  }, [position])

  if (!isVisible) return null

  return (
    <div
      className="absolute pointer-events-none z-50 transition-all duration-100"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translate(-2px, -2px)'
      }}
    >
      {/* Animated Cursor */}
      <div className="relative">
        <div
          className="w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-current animate-pulse"
          style={{ color: user.color }}
        />
        
        {/* Ripple Effect */}
        <div
          className="absolute top-1 left-1 w-2 h-2 rounded-full animate-ping"
          style={{ backgroundColor: user.color }}
        />
      </div>
    </div>
  )
}

// Selection Highlight Component
export function SelectionHighlight({ user, selection }: { user: CollaborativeUser; selection: SelectionState }) {
  if (!selection.area) return null

  return (
    <div
      className="absolute pointer-events-none z-40"
      style={{
        left: selection.area.x,
        top: selection.area.y,
        width: selection.area.width,
        height: selection.area.height
      }}
    >
      {/* Selection Border */}
      <div
        className="w-full h-full border-2 border-dashed opacity-50 animate-pulse"
        style={{ borderColor: user.color }}
      />
      
      {/* Selection Fill */}
      <div
        className="absolute inset-0 opacity-10"
        style={{ backgroundColor: user.color }}
      />
      
      {/* Corner Handles */}
      <div
        className="absolute -top-1 -left-1 w-3 h-3 rounded-full border-2 border-white"
        style={{ backgroundColor: user.color }}
      />
      <div
        className="absolute -top-1 -right-1 w-3 h-3 rounded-full border-2 border-white"
        style={{ backgroundColor: user.color }}
      />
      <div
        className="absolute -bottom-1 -left-1 w-3 h-3 rounded-full border-2 border-white"
        style={{ backgroundColor: user.color }}
      />
      <div
        className="absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-white"
        style={{ backgroundColor: user.color }}
      />
    </div>
  )
}

// User Status Indicator
export function UserStatusIndicator({ user }: { user: CollaborativeUser }) {
  const getStatusColor = () => {
    if (!user.isActive) return 'bg-gray-400'
    
    const now = Date.now()
    const timeSinceLastSeen = now - user.lastSeen
    
    if (timeSinceLastSeen < 30000) return 'bg-green-400' // Active (30 seconds)
    if (timeSinceLastSeen < 300000) return 'bg-yellow-400' // Away (5 minutes)
    return 'bg-red-400' // Inactive
  }

  const getStatusText = () => {
    if (!user.isActive) return 'Offline'
    
    const now = Date.now()
    const timeSinceLastSeen = now - user.lastSeen
    
    if (timeSinceLastSeen < 30000) return 'Active'
    if (timeSinceLastSeen < 300000) return 'Away'
    return 'Inactive'
  }

  return (
    <div className="flex items-center gap-2">
      <div
        className="w-3 h-3 rounded-full border-2 border-white"
        style={{ backgroundColor: user.color }}
      />
      <div className={`w-2 h-2 rounded-full ${getStatusColor()}`} />
      <span className="text-xs text-muted-foreground">{getStatusText()}</span>
    </div>
  )
}
