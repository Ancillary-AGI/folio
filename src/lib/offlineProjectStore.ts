import type { Project } from './supabase'

export interface OfflineProject extends Project {
  canvas_data?: Record<string, unknown>
}

const storageKey = 'folio.offlineProjects'

/** Random project id — ~62 bits of entropy, alphanumeric, URL-safe. */
function randomProjectId(): string {
  const bytes = new Uint8Array(8)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256)
  }
  return Array.from(bytes)
    .map((value) => value.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 12)
}

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
  // A full or blocked store throws here; callers that need to know pass
  // through saveCanvasWithStatus instead of catching blindly.
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
    const project: OfflineProject = {
      id: `p-${randomProjectId()}`,
      user_id: userId,
      name,
      description: 'Engineering project',
      created_at: now,
      updated_at: now,
      canvas_data: { components: [], wires: [], viewport: { zoom: 1, pan: { x: 0, y: 0 } } },
    }
    writeProjects([...readProjects(), project])
    return project
  },

  /**
   * Rename in place. Returns the stored project, or undefined when the id is not
   * in the workspace, so the caller can tell a rejected rename from a saved one.
   */
  rename(projectId: string, name: string): OfflineProject | undefined {
    const trimmed = name.trim()
    if (!trimmed) return undefined
    const updated = readProjects().map((project) =>
      project.id === projectId
        ? { ...project, name: trimmed, updated_at: new Date().toISOString() }
        : project
    )
    writeProjects(updated)
    return updated.find((project) => project.id === projectId)
  },

  saveCanvas(projectId: string, canvasData: Record<string, unknown>): void {
    writeProjects(readProjects().map((project) =>
      project.id === projectId
        ? { ...project, canvas_data: canvasData, updated_at: new Date().toISOString() }
        : project
    ))
  },

  /**
   * Same write, but the failure is a thrown Error with a readable message
   * instead of an exception type the caller cannot distinguish from a bug.
   * The store is the only place that knows the quota actually ran out.
   */
  saveCanvasWithStatus(projectId: string, canvasData: Record<string, unknown>): void {
    try {
      writeProjects(readProjects().map((project) =>
        project.id === projectId
          ? { ...project, canvas_data: canvasData, updated_at: new Date().toISOString() }
          : project
      ))
    } catch (err) {
      throw new Error(
        `The project could not be stored on this device: ${err instanceof Error ? err.message : String(err)}. Browser storage is full or blocked.`,
      )
    }
  },

  delete(projectId: string): void {
    writeProjects(readProjects().filter((project) => project.id !== projectId))
  },
}