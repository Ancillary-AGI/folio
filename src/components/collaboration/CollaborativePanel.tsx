import { useCallback, useEffect, useState } from 'react'
import { Radio, RefreshCw, Share2, Trash2, Users, X } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { collaborativeEditor, type CollabOperation, type CollabUser } from '../../lib/collaboration/collaborativeEditor'
import {
  collaborationService,
  ROLE_PERMISSIONS,
  type CollaboratorRole,
  type CollaborationUser,
} from '../../lib/collaboration/collaborationService'

interface CollaborativePanelProps { onClose: () => void }

const ROLES: CollaboratorRole[] = ['admin', 'editor', 'reviewer', 'viewer']

/** Stable identity for sharing metadata when no realtime session is open. */
function currentSharingUser(): CollaborationUser {
  const editorUser = collaborativeEditor.getCurrentUser()
  return {
    id: editorUser?.id ?? 'local-user',
    name: editorUser?.name ?? 'Local user',
    email: editorUser?.email ?? 'local@folio',
    role: 'owner',
    lastActive: Date.now(),
  }
}

export default function CollaborativePanel({ onClose }: CollaborativePanelProps) {
  const [users, setUsers] = useState<CollabUser[]>(() => collaborativeEditor.getConnectedUsers())
  const [operations, setOperations] = useState<CollabOperation[]>([])
  const [projects, setProjects] = useState(() => collaborationService.listProjects())
  const [selectedProjectId, setSelectedProjectId] = useState(() => collaborationService.listProjects()[0]?.id ?? '')
  const [newProjectName, setNewProjectName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<CollaboratorRole>('editor')
  const [shareStatus, setShareStatus] = useState('')

  const refresh = useCallback(() => {
    setUsers(collaborativeEditor.getConnectedUsers())
    setOperations(collaborativeEditor.getCurrentSession()?.operations.slice(-12).reverse() ?? [])
    setProjects(collaborationService.listProjects())
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
  const me = currentSharingUser()
  const selectedProject = projects.find((project) => project.id === selectedProjectId)
  const canManage = selectedProject ? collaborationService.can(selectedProject.id, me.id, 'manage') : false

  const createProject = () => {
    try {
      const project = collaborationService.createProject(newProjectName, 'Shared design project', me)
      setSelectedProjectId(project.id)
      setNewProjectName('')
      setShareStatus(`Created "${project.name}".`)
      refresh()
    } catch (error) {
      setShareStatus(error instanceof Error ? error.message : 'Could not create the project.')
    }
  }

  const invite = () => {
    if (!selectedProject) return
    const email = inviteEmail.trim()
    if (!email) return
    const user: CollaborationUser = {
      id: `user_${email.toLowerCase().replace(/[^a-z0-9]/g, '_')}`,
      name: email.split('@')[0],
      email,
      role: inviteRole,
      lastActive: Date.now(),
    }
    const ok = collaborationService.addCollaborator(selectedProject.id, {
      user,
      role: inviteRole,
      joinedAt: Date.now(),
      permissions: [...ROLE_PERMISSIONS[inviteRole]],
    })
    setShareStatus(ok ? `${email} added as ${inviteRole}.` : 'Could not update that collaborator.')
    if (ok) {
      setInviteEmail('')
      refresh()
    }
  }

  const changeRole = (userId: string, role: CollaboratorRole) => {
    if (!selectedProject) return
    const existing = selectedProject.collaborators.find((c) => c.user.id === userId)
    if (!existing) return
    const ok = collaborationService.addCollaborator(selectedProject.id, {
      ...existing,
      role,
      permissions: [...ROLE_PERMISSIONS[role]],
    })
    setShareStatus(ok ? 'Role updated.' : 'The owner cannot be demoted.')
    if (ok) refresh()
  }

  const removeCollaborator = (userId: string) => {
    if (!selectedProject) return
    const ok = collaborationService.removeCollaborator(selectedProject.id, userId)
    setShareStatus(ok ? 'Collaborator removed.' : 'The owner cannot be removed.')
    if (ok) refresh()
  }

  return <Card className="flex h-full flex-col rounded-none border-y-0 border-r-0">
    <CardHeader className="flex flex-row items-center justify-between border-b border-border py-3">
      <CardTitle className="flex items-center gap-2 text-sm"><Users className="h-4 w-4" />Collaboration</CardTitle>
      <div className="flex gap-1"><Button variant="ghost" size="icon" onClick={refresh} aria-label="Refresh collaboration"><RefreshCw className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={onClose} aria-label="Close collaboration"><X className="h-4 w-4" /></Button></div>
    </CardHeader>
    <CardContent className="flex-1 space-y-5 overflow-y-auto p-4">
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs"><Radio className={`h-3.5 w-3.5 ${collaborativeEditor.isUsingRealtime() ? 'text-success' : 'text-warning'}`} />{collaborativeEditor.isUsingRealtime() ? 'Realtime session' : connected ? 'Local collaboration session' : 'No active session'}</div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Shared projects</h3>
        {projects.length > 0 && (
          <select
            aria-label="Shared project"
            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            value={selectedProjectId}
            onChange={(event) => { setSelectedProjectId(event.target.value); setShareStatus('') }}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>{project.name}</option>
            ))}
          </select>
        )}
        <div className="flex gap-2">
          <Input
            value={newProjectName}
            onChange={(event) => setNewProjectName(event.target.value)}
            placeholder="New shared project"
            aria-label="New shared project name"
            onKeyDown={(event) => { if (event.key === 'Enter') createProject() }}
          />
          <Button size="sm" onClick={createProject} disabled={!newProjectName.trim()}>Create</Button>
        </div>
        {shareStatus && <p role="status" className="text-xs text-muted-foreground">{shareStatus}</p>}
      </section>

      {selectedProject && (
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Share2 className="h-3.5 w-3.5" />Sharing — {selectedProject.name}
          </h3>
          <div className="flex flex-wrap gap-1">
            {(['read', 'write', 'share', 'manage', 'delete'] as const).map((permission) => {
              const allowed = collaborationService.can(selectedProject.id, me.id, permission)
              return (
                <span
                  key={permission}
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${allowed ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground line-through'}`}
                >
                  {permission}
                </span>
              )
            })}
          </div>
          <div className="space-y-2">
            {selectedProject.collaborators.map((collaborator) => (
              <div key={collaborator.user.id} className="flex items-center gap-2 rounded-md border border-border p-2">
                <span className="min-w-0 flex-1 truncate text-xs">{collaborator.user.email}</span>
                <select
                  aria-label={`Role for ${collaborator.user.email}`}
                  className="rounded border border-input bg-background px-1 py-0.5 text-xs"
                  value={collaborator.role}
                  disabled={!canManage || collaborator.role === 'owner'}
                  onChange={(event) => changeRole(collaborator.user.id, event.target.value as CollaboratorRole)}
                >
                  {collaborator.role === 'owner' && <option value="owner">owner</option>}
                  {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-destructive"
                  aria-label={`Remove ${collaborator.user.email}`}
                  disabled={!canManage || collaborator.role === 'owner'}
                  onClick={() => removeCollaborator(collaborator.user.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={inviteEmail}
              onChange={(event) => setInviteEmail(event.target.value)}
              placeholder="teammate@example.com"
              aria-label="Collaborator email"
              disabled={!canManage}
              onKeyDown={(event) => { if (event.key === 'Enter') invite() }}
            />
            <select
              aria-label="Invite role"
              className="rounded-md border border-input bg-background px-1 text-xs"
              value={inviteRole}
              disabled={!canManage}
              onChange={(event) => setInviteRole(event.target.value as CollaboratorRole)}
            >
              {ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
            <Button size="sm" onClick={invite} disabled={!canManage || !inviteEmail.trim()}>Invite</Button>
          </div>
          {!canManage && <p className="text-xs text-muted-foreground">Only the project owner or an admin can change sharing.</p>}
        </section>
      )}

      <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Participants ({users.length})</h3><div className="space-y-2">{users.length ? users.map(user => <div key={user.id} className="flex items-center gap-2 rounded-md border border-border p-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: user.color }} /><span className="min-w-0 flex-1 truncate text-sm">{user.name}</span><span className="text-xs text-muted-foreground">{user.isActive ? 'Active' : 'Away'}</span></div>) : <p className="text-sm text-muted-foreground">Open a project to start a collaboration session.</p>}</div></section>
      <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent design operations</h3><div className="space-y-2">{operations.length ? operations.map(operation => <div key={operation.id} className="rounded-md border border-border p-2"><p className="text-xs font-medium">{operation.type.replace(/_/g, ' ')}</p><p className="mt-1 text-xs text-muted-foreground">{new Date(operation.timestamp).toLocaleTimeString()}</p></div>) : <p className="text-sm text-muted-foreground">Operations will appear here as collaborators edit the design.</p>}</div></section>
    </CardContent>
  </Card>
}
