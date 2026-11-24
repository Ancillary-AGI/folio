import { create } from 'zustand'
import type { MeshReport } from '../lib/3d/meshMeasure'

export interface EnclosureModel {
  /** File name as the designer named it, kept for the panel and for agents. */
  name: string
  mesh: MeshReport
  /**
   * The project the shell was brought in for. An enclosure belongs to one
   * board, so it must not follow the designer into the next project.
   */
  projectId: string | null
}

interface EnclosureState {
  /**
   * An uploaded STL or OBJ enclosure shown around the board in the 3-D preview.
   * Session state by design: the shell is megabytes of vertex buffers, the
   * project file is not a model vault, and reloading clears it.
   */
  enclosure: EnclosureModel | null
  setEnclosure: (next: EnclosureModel | null) => void
}

/**
 * The imported enclosure, shared by the 3-D board preview that draws it and the
 * agent tools that report the fit. It is context, not copper: exports, the
 * router and every electrical solver ignore it.
 */
export const useEnclosureStore = create<EnclosureState>()((set) => ({
  enclosure: null,
  setEnclosure: (next) => set({ enclosure: next }),
}))
