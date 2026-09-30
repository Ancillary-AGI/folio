import type { Project } from './supabase'

export interface OfflineProject extends Project {
  canvas_data?: Record<string, unknown>
}

const storageKey = 'folio.offlineProjects'

/** Monotonic per-process suffix for locally created project ids. */
let offlineProjectSeq = 0

const readProjects = (): OfflineProject[] => {
  if (typeof localStorage === 'undefined') return []
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(storageKey) || '[]')
    return Array.isArray(stored)
      ? stored.filter((project): project is OfflineProject =>
          typeof project?.id === 'string' &&
          typeof project?.name === 'string' &&
          typeof project?.user_id === 'string'
        )
      : []
  } catch {
    return []
  }
}

const writeProjects = (projects: OfflineProject[]): void => {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(storageKey, JSON.stringify(projects))
}

export const offlineProjectStore = {
  list(): OfflineProject[] {
    return readProjects().sort((left, right) => right.updated_at.localeCompare(left.updated_at))
  },

  get(projectId: string): OfflineProject | undefined {
    return readProjects().find((project) => project.id === projectId)
  },

  create(userId: string, name: string): OfflineProject {
    const now = new Date().toISOString()
    offlineProjectSeq += 1
    const project: OfflineProject = {
      id: `local-${Date.now()}-${offlineProjectSeq}`,
      user_id: userId,
      name,
      description: 'Local-only engineering project',
      created_at: now,
      updated_at: now,
      canvas_data: { components: [], wires: [], viewport: { zoom: 1, pan: { x: 0, y: 0 } } },
    }
    writeProjects([...readProjects(), project])
    return project
  },

  saveCanvas(projectId: string, canvasData: Record<string, unknown>): void {
    writeProjects(readProjects().map((project) =>
      project.id === projectId
        ? { ...project, canvas_data: canvasData, updated_at: new Date().toISOString() }
        : project
    ))
  },

  delete(projectId: string): void {
    writeProjects(readProjects().filter((project) => project.id !== projectId))
  },
}