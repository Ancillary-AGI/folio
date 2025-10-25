import React, { useState, useEffect, useRef } from 'react'
import { Users, User, Circle, Eye, EyeOff, MessageCircle, Settings, Crown } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { collaborativeEditor, CollaborativeUser, CollaborativeSession } from '../../lib/collaboration/collaborativeEditor'

interface CollaborativePanelProps {
  onClose: () => void
}

export default function CollaborativePanel({ onClose }: CollaborativePanelProps) {
  const [session, setSession] = useState<CollaborativeSession | null>(null)
  const [users, setUsers] = useState<CollaborativeUser[]>([])
  const [currentUser, setCurrentUser] = useState<CollaborativeUser | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [showUserList, setShowUserList] = useState(true)
  const [showCursors, setShowCursors] = useState(true)
  const [showSelections, setShowSelections] = useState(true)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Get current session and user
    const currentSession = collaborativeEditor.getSession()
    const currentUserData = collaborativeEditor.getCurrentUser()
    const connected = collaborativeEditor.isUserConnected()

    setSession(currentSession)
    setCurrentUser(currentUserData)
    setIsConnected(connected)

    // Listen for session updates
    const handleSessionJoined = (session: CollaborativeSession) => {
      setSession(session)
      setUsers(Array.from(session.users.values()))
    }

    const handleUserJoined = (user: CollaborativeUser) => {
      setUsers(prev => [...prev.filter(u => u.id !== user.id), user])
    }

    const handleUserLeft = (user: CollaborativeUser) => {
      setUsers(prev => prev.filter(u => u.id !== user.id))
    }

    const handlePresenceUpdate = (user: CollaborativeUser) => {
      setUsers(prev => prev.map(u => u.id === user.id ? user : u))
    }

    const handleDisconnected = () => {
      setIsConnected(false)
      setSession(null)
      setUsers([])
    }

    collaborativeEditor.on('session:joined', handleSessionJoined)
    collaborativeEditor.on('user:joined', handleUserJoined)
    collaborativeEditor.on('user:left', handleUserLeft)
    collaborativeEditor.on('presence:updated', handlePresenceUpdate)
    collaborativeEditor.on('disconnected', handleDisconnected)

    return () => {
      collaborativeEditor.off('session:joined', handleSessionJoined)
      collaborativeEditor.off('user:joined', handleUserJoined)
      collaborativeEditor.off('user:left', handleUserLeft)
      collaborativeEditor.off('presence:updated', handlePresenceUpdate)
      collaborativeEditor.off('disconnected', handleDisconnected)
    }
  }, [])

  useEffect(() => {
    // Scroll to bottom when new messages arrive
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatMessages])

  const handleSendMessage = () => {
    if (!newMessage.trim() || !currentUser) return

    const message: ChatMessage = {
      id: `msg_${Date.now()}`,
      userId: currentUser.id,
      userName: currentUser.name,
      userColor: currentUser.color,
      content: newMessage.trim(),
      timestamp: Date.now()
    }

    setChatMessages(prev => [...prev, message])
    setNewMessage('')

    // In a real implementation, you'd send this to the server
    // collaborativeEditor.sendChatMessage(message)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  const getUserStatusColor = (user: CollaborativeUser) => {
    if (!user.isActive) return 'bg-gray-400'
    
    const now = Date.now()
    const timeSinceLastSeen = now - user.lastSeen
    
    if (timeSinceLastSeen < 30000) return 'bg-green-400' // Active (30 seconds)
    if (timeSinceLastSeen < 300000) return 'bg-yellow-400' // Away (5 minutes)
    return 'bg-red-400' // Inactive
  }

  const getUserInitials = (name: string) => {
    return name
      .split(' ')
      .map(word => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div className="w-80 bg-card border-l border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-foreground">Collaboration</h3>
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-400' : 'bg-red-400'}`} />
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowUserList(!showUserList)}
              title={showUserList ? 'Hide users' : 'Show users'}
            >
              {showUserList ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <Settings className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Session Info */}
        {session && (
          <div className="mt-2 text-sm text-muted-foreground">
            <div>Session: {session.id.slice(-8)}</div>
            <div>Users: {users.length}</div>
            <div>Version: {session.version}</div>
          </div>
        )}
      </div>

      {/* User List */}
      {showUserList && (
        <div className="flex-1 overflow-y-auto p-4">
          <h4 className="text-sm font-medium text-foreground mb-3">Active Users</h4>
          <div className="space-y-2">
            {users.map((user) => (
              <div
                key={user.id}
                className={`flex items-center gap-3 p-2 rounded-lg border ${
                  user.id === currentUser?.id ? 'border-primary bg-primary/10' : 'border-border'
                }`}
              >
                {/* User Avatar */}
                <div className="relative">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium text-white"
                    style={{ backgroundColor: user.color }}
                  >
                    {user.avatar ? (
                      <img src={user.avatar} alt={user.name} className="w-full h-full rounded-full" />
                    ) : (
                      getUserInitials(user.name)
                    )}
                  </div>
                  <div
                    className={`absolute -bottom-1 -right-1 w-3 h-3 rounded-full border-2 border-background ${getUserStatusColor(user)}`}
                  />
                </div>

                {/* User Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground truncate">
                      {user.name}
                    </span>
                    {user.id === currentUser?.id && (
                      <Crown className="w-3 h-3 text-yellow-500" />
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {user.isActive ? 'Active' : 'Away'}
                  </div>
                </div>

                {/* User Actions */}
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="w-6 h-6"
                    title="View profile"
                  >
                    <User className="w-3 h-3" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {/* Collaboration Controls */}
          <div className="mt-6 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Show Cursors</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowCursors(!showCursors)}
                className={showCursors ? 'text-primary' : 'text-muted-foreground'}
              >
                <Circle className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">Show Selections</span>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowSelections(!showSelections)}
                className={showSelections ? 'text-primary' : 'text-muted-foreground'}
              >
                <Eye className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Chat */}
      <div className="border-t border-border flex flex-col" style={{ height: '300px' }}>
        <div className="p-3 border-b border-border">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" />
            <h4 className="text-sm font-medium text-foreground">Chat</h4>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {chatMessages.map((message) => (
            <div key={message.id} className="flex gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium text-white flex-shrink-0"
                style={{ backgroundColor: message.userColor }}
              >
                {getUserInitials(message.userName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-foreground">
                    {message.userName}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </span>
                </div>
                <div className="text-sm text-foreground mt-1">
                  {message.content}
                </div>
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        {/* Message Input */}
        <div className="p-3 border-t border-border">
          <div className="flex gap-2">
            <input
              type="text"
              value={newMessage}
              onChange={(e) => setNewMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 text-sm border border-input rounded-md bg-background"
            />
            <Button
              onClick={handleSendMessage}
              disabled={!newMessage.trim()}
              size="sm"
            >
              Send
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Chat message type
interface ChatMessage {
  id: string
  userId: string
  userName: string
  userColor: string
  content: string
  timestamp: number
}
