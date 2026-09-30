import { useCallback, useEffect, useState } from 'react'
import { Radio, RefreshCw, Users, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { collaborativeEditor, type CollabOperation, type CollabUser } from '../../lib/collaboration/collaborativeEditor'

interface CollaborativePanelProps { onClose: () => void }

export default function CollaborativePanel({ onClose }: CollaborativePanelProps) {
  const [users, setUsers] = useState<CollabUser[]>(() => collaborativeEditor.getConnectedUsers())
  const [operations, setOperations] = useState<CollabOperation[]>([])
  const refresh = useCallback(() => {
    setUsers(collaborativeEditor.getConnectedUsers())
    setOperations(collaborativeEditor.getCurrentSession()?.operations.slice(-12).reverse() ?? [])
  }, [])
  useEffect(() => {
    refresh()
    collaborativeEditor.on('session:joined', refresh)
    collaborativeEditor.on('user:joined', refresh)
    collaborativeEditor.on('user:left', refresh)
    collaborativeEditor.on('operation:received', refresh)
    return () => {
      collaborativeEditor.off('session:joined', refresh)
      collaborativeEditor.off('user:joined', refresh)
      collaborativeEditor.off('user:left', refresh)
      collaborativeEditor.off('operation:received', refresh)
    }
  }, [refresh])
  const connected = collaborativeEditor.getCurrentSession() !== null
  return <Card className="flex h-full flex-col rounded-none border-y-0 border-r-0">
    <CardHeader className="flex flex-row items-center justify-between border-b border-border py-3">
      <CardTitle className="flex items-center gap-2 text-sm"><Users className="h-4 w-4" />Collaboration</CardTitle>
      <div className="flex gap-1"><Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh collaboration"><RefreshCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close collaboration"><X className="h-4 w-4" /></Button></div>
    </CardHeader>
    <CardContent className="flex-1 space-y-5 overflow-y-auto p-4">
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs"><Radio className={`h-3.5 w-3.5 ${collaborativeEditor.isUsingRealtime() ? 'text-success' : 'text-warning'}`} />{collaborativeEditor.isUsingRealtime() ? 'Realtime session' : connected ? 'Local collaboration session' : 'No active session'}</div>
      <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Participants ({users.length})</h3><div className="space-y-2">{users.length ? users.map(user => <div key={user.id} className="flex items-center gap-2 rounded-md border border-border p-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: user.color }} /><span className="min-w-0 flex-1 truncate text-sm">{user.name}</span><span className="text-xs text-muted-foreground">{user.isActive ? 'Active' : 'Away'}</span></div>) : <p className="text-sm text-muted-foreground">Open a project to start a collaboration session.</p>}</div></section>
      <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent design operations</h3><div className="space-y-2">{operations.length ? operations.map(operation => <div key={operation.id} className="rounded-md border border-border p-2"><p className="text-xs font-medium">{operation.type.replace(/_/g, ' ')}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(operation.timestamp).toLocaleTimeString()}</p></div>) : <p className="text-sm text-muted-foreground">Operations will appear here as collaborators edit the design.</p>}</div></section>
    </CardContent>
  </Card>
}
