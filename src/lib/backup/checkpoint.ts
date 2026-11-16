import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'

/**
 * The live design fields a checkpoint must carry. One definition so the manual
 * checkpoint, VCS safety copies and any backup action from another surface
 * cannot drift apart.
 */
export function buildCheckpointPayload(): Record<string, unknown> {
  const design = useProjectStore.getState()
  return {
    components: design.components,
    wires: design.wires,
    firmwareCode: design.firmwareCode,
    simulationRuns: design.simulationRuns,
    pcbLayout: design.pcbLayout,
    mechanicalParts: design.mechanicalParts,
    domainDesigns: design.domainDesigns,
    // The workspace mode travels with the project, so reopening it lands where
    // the designer left off instead of always the schematic.
    viewport: { ...useAppStore.getState().viewport, mode: useAppStore.getState().workspaceMode },
  }
}
