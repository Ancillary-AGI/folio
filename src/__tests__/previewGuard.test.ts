/**
 * The community preview guard: while a design is open read-only, every design
 * mutation is refused and routed to the session flash; clearing the session
 * re-enables the store.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { useProjectStore } from '../stores/useProjectStore'
import { useCommunityPreviewStore } from '../stores/useCommunityPreviewStore'

const PREVIEW = {
  name: 'Half-wave rectifier, start to gerber',
  authorName: 'Folio team',
  templateId: 'curated-rectifier-pcb',
  source: 'curated' as const,
  workspaceMode: 'pcb' as const,
  origin: 'community' as const,
}

describe('Community preview guard', () => {
  beforeEach(() => {
    useCommunityPreviewStore.setState({ preview: null, flash: null })
    useProjectStore.setState({ components: [], wires: [] })
  })

  it('refuses design mutations and raises the refusal flash', () => {
    useCommunityPreviewStore.getState().begin(PREVIEW)

    useProjectStore.getState().addComponent({
      id: 'x1', componentId: 'R', x: 0, y: 0, rotation: 0, reference: 'R1',
      properties: {}, component: { id: 'R', name: 'R' } as never,
    } as never)

    expect(useProjectStore.getState().components).toHaveLength(0)
    expect(useCommunityPreviewStore.getState().flash).toContain('make it yours')
  })

  it('allows edits once the preview is cleared', () => {
    useCommunityPreviewStore.getState().begin(PREVIEW)
    useCommunityPreviewStore.getState().clear()

    useProjectStore.getState().addComponent({
      id: 'x1', componentId: 'R', x: 0, y: 0, rotation: 0, reference: 'R1',
      properties: {}, component: { id: 'R', name: 'R' } as never,
    } as never)

    expect(useProjectStore.getState().components).toHaveLength(1)
    expect(useCommunityPreviewStore.getState().flash).toBeNull()
  })

  it('refuses undo/redo while the design is not yours', () => {
    useProjectStore.getState().addComponent({
      id: 'legal', componentId: 'R', x: 0, y: 0, rotation: 0, reference: 'R1',
      properties: {}, component: { id: 'R', name: 'R' } as never,
    } as never)
    useCommunityPreviewStore.getState().begin(PREVIEW)
    useProjectStore.getState().undo()
    expect(useProjectStore.getState().components).toHaveLength(1)
  })
})
