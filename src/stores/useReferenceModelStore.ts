import { create } from 'zustand'
import type { MeshReport } from '../lib/3d/meshMeasure'

export interface ReferenceModel {
  /** File name as the designer named it, kept for the card and for agents. */
  name: string
  mesh: MeshReport
  /**
   * The project the model was brought in for. An imported housing is context
   * for one assembly, so it must not follow the designer into the next project.
   */
  projectId: string | null
}

interface ReferenceModelState {
  /**
   * An uploaded STL or OBJ shown beside the assembly. Session state by design:
   * the mesh is megabytes of vertex buffers, the project file is not a model
   * vault, and reloading clears it.
   */
  reference: ReferenceModel | null
  setReference: (next: ReferenceModel | null) => void
}

/**
 * The imported reference model, shared by the 3-D viewport that draws it and
 * the agent tools that report on it. It is not an assembly part: mechanical
 * solvers, exports and version control never see it.
 */
export const useReferenceModelStore = create<ReferenceModelState>()((set) => ({
  reference: null,
  setReference: (next) => set({ reference: next }),
}))
