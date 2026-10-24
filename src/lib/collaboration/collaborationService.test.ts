import { beforeEach, describe, expect, it } from 'vitest'
import {
  collaborationService,
  ROLE_PERMISSIONS,
  type CollaborationUser,
} from './collaborationService'

function user(id: string, name: string): CollaborationUser {
  return { id, name, email: `${id}@folio.test`, role: 'viewer', lastActive: Date.now() }
}

const owner = user('owner-user', 'Owner')

describe('collaborationService', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('creates a project with the owner holding every role permission', () => {
    const project = collaborationService.createProject('Board review', 'Shared layout', owner)

    expect(project.collaborators).toHaveLength(1)
    expect(project.collaborators[0].role).toBe('owner')
    expect(project.collaborators[0].permissions).toEqual(ROLE_PERMISSIONS.owner)
    for (const permission of ['read', 'write', 'share', 'delete', 'manage']) {
      expect(collaborationService.can(project.id, owner.id, permission)).toBe(true)
    }
  })

  it('applies role permissions to invited collaborators and rejects unknown users', () => {
    const project = collaborationService.createProject('Role check', '', owner)
    const editor = user('editor-user', 'Editor')
    const viewer = user('viewer-user', 'Viewer')

    expect(collaborationService.addCollaborator(project.id, {
      user: editor,
      role: 'editor',
      joinedAt: Date.now(),
      permissions: [...ROLE_PERMISSIONS.editor],
    })).toBe(true)
    expect(collaborationService.addCollaborator(project.id, {
      user: viewer,
      role: 'viewer',
      joinedAt: Date.now(),
      permissions: [...ROLE_PERMISSIONS.viewer],
    })).toBe(true)

    expect(collaborationService.can(project.id, editor.id, 'write')).toBe(true)
    expect(collaborationService.can(project.id, editor.id, 'delete')).toBe(false)
    expect(collaborationService.can(project.id, viewer.id, 'write')).toBe(false)
    expect(collaborationService.can(project.id, 'stranger', 'read')).toBe(false)
    expect(collaborationService.getRole(project.id, viewer.id)).toBe('viewer')
  })

  it('prevents demoting or removing the owner while allowing role changes', () => {
    const project = collaborationService.createProject('Owner guard', '', owner)
    const reviewer = user('reviewer-user', 'Reviewer')
    collaborationService.addCollaborator(project.id, {
      user: reviewer,
      role: 'reviewer',
      joinedAt: Date.now(),
      permissions: [...ROLE_PERMISSIONS.reviewer],
    })

    expect(collaborationService.addCollaborator(project.id, {
      user: owner,
      role: 'admin',
      joinedAt: Date.now(),
      permissions: [...ROLE_PERMISSIONS.admin],
    })).toBe(false)
    expect(collaborationService.removeCollaborator(project.id, owner.id)).toBe(false)

    collaborationService.addCollaborator(project.id, {
      user: reviewer,
      role: 'editor',
      joinedAt: Date.now(),
      permissions: [...ROLE_PERMISSIONS.editor],
    })
    expect(collaborationService.can(project.id, reviewer.id, 'write')).toBe(true)
    expect(collaborationService.removeCollaborator(project.id, reviewer.id)).toBe(true)
    expect(collaborationService.can(project.id, reviewer.id, 'read')).toBe(false)
  })

  it('persists sharing metadata so it survives a reload', () => {
    const project = collaborationService.createProject('Persisted project', 'localStorage', owner)
    const raw = localStorage.getItem('folio.collabProjects.v1')
    expect(raw).toBeTruthy()
    const stored = JSON.parse(raw!) as Array<{ id: string; name: string; owner: { id: string } }>
    const match = stored.find((entry) => entry.id === project.id)
    expect(match?.name).toBe('Persisted project')
    expect(match?.owner.id).toBe(owner.id)
  })
})
