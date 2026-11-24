/**
 * The community preview session.
 *
 * Opening a community design does not create a project, and must not. The
 * design is applied to the live workbench with authorship attached, while the
 * shell keeps the session marker instead: the CAD renders it read-only from
 * the user's perspective, and every design mutation bounces off the action
 * guard in `useProjectStore` — the refusal surfaces as `flash`, an inline
 * explanation with one obvious way forward (adopt the design).
 *
 * Adopting persists the design into a real project built at that moment.
 * Discarding throws it away. Neither happens by accident.
 *
 * The internal name stays `template.fork` only where it is the data contract
 * (the usage-ledger kind and the cloud counter column) — the UI never uses
 * the word.
 */
import { create } from 'zustand'
import type { WorkspaceMode } from './useAppStore'

export interface CommunityPreview {
  /** The template's name — adopted projects are named after the design they fork. */
  name: string
  authorName: string
  /** CURATED id, or the cloud row id, or `import-*` for hand-carried files. */
  templateId: string
  source: 'curated' | 'community'
  /** Which seeded demo carries the design — curated templates only. */
  demoId?: string
  workspaceMode: WorkspaceMode
  /** Where the preview was launched from, so discard can navigate back. */
  origin: 'community' | 'launcher'
}

interface PreviewState {
  /** Non-null while a community design is open read-only. */
  preview: CommunityPreview | null
  /** One-shot refusal message, rendered by the shell's preview banner. */
  flash: string | null
  begin: (preview: CommunityPreview) => void
  clear: () => void
  flashMessage: (message: string) => void
  clearFlash: () => void
}

export const useCommunityPreviewStore = create<PreviewState>()((set) => ({
  preview: null,
  flash: null,

  begin: (preview) => set({ preview, flash: null }),
  clear: () => set({ preview: null, flash: null }),
  flashMessage: (message) => set({ flash: message }),
  clearFlash: () => set({ flash: null }),
}))

/**
 * The guard the action layer consults. Not a hook of anything — callable from
 * zustand action bodies without creating dependency cycles.
 */
export function previewRefusalMessage(name: string): string {
  return `“${name}” is someone else's design — make it yours to edit it.`
}

export function guardDesignMutation(): boolean {
  const { preview, flashMessage } = useCommunityPreviewStore.getState()
  if (!preview) return false
  flashMessage(previewRefusalMessage(preview.name))
  return true
}
