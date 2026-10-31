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
    viewport: useAppStore.getState().viewport,
  }
}
