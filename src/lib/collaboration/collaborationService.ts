/**
 * Collaboration Service — persistent (localStorage-backed).
 *
 * Industry rule: sharing metadata must survive reload. So the in-memory Map
 * is now only a cache over `folio.collabProjects.v1` in localStorage.
 */

export type CollaboratorRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer'

export interface CollaborationUser {
  id: string
  name: string
  email: string
  role: CollaboratorRole
  lastActive: number
}

export interface Collaborator {
  user: CollaborationUser
  role: CollaboratorRole
  joinedAt: number
  permissions: string[]
}

export interface CollaborationProject {
  id: string
  name: string
  description: string
  owner: CollaborationUser
  collaborators: Collaborator[]
  createdAt: number
  updatedAt: number
}

const ROLE_PERMISSIONS: Record<CollaboratorRole, string[]> = {
  owner:    ['read', 'write', 'share', 'delete', 'manage'],
  admin:    ['read', 'write', 'share', 'manage'],
  editor:   ['read', 'write'],
  reviewer: ['read', 'comment'],
  viewer:   ['read'],
}

const STORAGE_KEY = 'folio.collabProjects.v1'

function loadFromDisk(): Map<string, CollaborationProject> {
  const map = new Map<string, CollaborationProject>()
  try {
    if (typeof localStorage === 'undefined') return map
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return map
    const arr = JSON.parse(raw) as CollaborationProject[]
    for (const p of arr) map.set(p.id, p)
  } catch {
    /* corrupted cache -> start empty rather than crash */
  }
  return map
}

function saveToDisk(projects: Map<string, CollaborationProject>): void {
  try {
    if (typeof localStorage === 'undefined') return
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(projects.values())))
  } catch {
    /* quota exceeded -> keep in-memory cache; next write retries */
  }
}

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e9).toString(36)}`
}

class CollaborationService {
  private projects: Map<string, CollaborationProject> = loadFromDisk()

  private persist(): void {
    saveToDisk(this.projects)
  }

  // ── Project management ───────────────────────────────────────────────────────

  createProject(
    name: string,
    description: string,
    owner: CollaborationUser
  ): CollaborationProject {
    if (!name.trim()) throw new Error('Project name is required')
    const now = Date.now()
    const project: CollaborationProject = {
      id: `proj_${now.toString(36)}_${uid().slice(0, 8)}`,
      name: name.trim(),
      description,
      owner,
      collaborators: [
        {
          user: owner,
          role: 'owner',
          joinedAt: now,
          permissions: ROLE_PERMISSIONS.owner,
        },
      ],
      createdAt: now,
      updatedAt: now,
    }
    this.projects.set(project.id, project)
    this.persist()
    return project
  }

  getProject(id: string): CollaborationProject | undefined {
    return this.projects.get(id)
  }

  listProjects(): CollaborationProject[] {
    return Array.from(this.projects.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  deleteProject(id: string): boolean {
    const ok = this.projects.delete(id)
    if (ok) this.persist()
    return ok
  }

  // ── Collaborator management ──────────────────────────────────────────────────

  addCollaborator(projectId: string, collaborator: Collaborator): boolean {
    const project = this.projects.get(projectId)
    if (!project) return false

    const existing = project.collaborators.findIndex(
      (c) => c.user.id === collaborator.user.id
    )
    const normalized: Collaborator = {
      ...collaborator,
      permissions: collaborator.permissions.length
        ? collaborator.permissions
        : [...ROLE_PERMISSIONS[collaborator.role]],
    }
    if (existing >= 0) {
      // Never allow demoting/removing the owner through this path
      if (project.collaborators[existing].role === 'owner' && normalized.role !== 'owner') {
        return false
      }
      project.collaborators[existing] = normalized
    } else {
      project.collaborators.push(normalized)
    }
    project.updatedAt = Date.now()
    this.persist()
    return true
  }

  removeCollaborator(projectId: string, userId: string): boolean {
    const project = this.projects.get(projectId)
    if (!project) return false
    const before = project.collaborators.length
    project.collaborators = project.collaborators.filter(
      (c) => c.user.id !== userId && c.role !== 'owner'
    )
    project.updatedAt = Date.now()
    this.persist()
    return project.collaborators.length < before
  }

  getCollaborators(projectId: string): Collaborator[] {
    return this.projects.get(projectId)?.collaborators ?? []
  }

  // ── Permission checks ────────────────────────────────────────────────────────

  can(projectId: string, userId: string, permission: string): boolean {
    const project = this.projects.get(projectId)
    if (!project) return false
    const collab = project.collaborators.find((c) => c.user.id === userId)
    if (!collab) return false
    return collab.permissions.includes(permission)
  }

  getRole(projectId: string, userId: string): CollaboratorRole | null {
    const project = this.projects.get(projectId)
    if (!project) return null
    return project.collaborators.find((c) => c.user.id === userId)?.role ?? null
  }
}

export const collaborationService = new CollaborationService()
export { ROLE_PERMISSIONS }
