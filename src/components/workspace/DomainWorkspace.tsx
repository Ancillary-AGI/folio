import { useCallback, useEffect, useState } from 'react'
import SchematicCanvas from '../SchematicCanvas'
import MechanicalDesignPanel from '../mechanical/MechanicalDesignPanel'
import PCBDesignPanel from '../pcb/PCBDesignPanel'
import { SchematicToPcbPanel } from '../schematicToPcb/SchematicToPcbPanel'
import Circuit3DViewer from '../3d/Circuit3DViewer'
import { AdvancedRoboticsPanel } from '../robotics/AdvancedRoboticsPanel'
import BoardProgrammingPanel from '../programming/BoardProgrammingPanel'
import FPGADesignPanel from '../fpga/FPGADesignPanel'
import HILTestingPanel from '../hil/HILTestingPanel'
import DigitalTwinFleetPanel from '../digitalTwin/DigitalTwinFleetPanel'
import SIEMDashboard from '../siem/SIEMDashboard'
import MarketplacePanel from '../marketplace/MarketplacePanel'
import SystemDashboard from '../SystemDashboard'
import BOMPanel from '../bom/BOMPanel'
import ComponentLibrary from '../ComponentLibrary'
import PropertiesPanel from '../PropertiesPanel'
import ToolRail from './ToolRail'
import { useAppStore, type WorkspaceMode } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import type { Component } from '../../lib/supabase'
import type { Schematic } from '../../types'

interface DomainWorkspaceProps {
  libraryComponents: Component[]
  onSave: (data: Record<string, unknown>) => void
}

const MODES: Array<{ id: WorkspaceMode; label: string }> = [
  { id: 'schematic', label: 'Schematic' },
  { id: 'convert', label: 'Schematic→PCB' },
  { id: 'pcb', label: 'PCB' },
  { id: 'mechanical', label: 'CAD' },
  { id: 'preview3d', label: '3D / AR' },
  { id: 'embedded', label: 'Arduino' },
  { id: 'fpga', label: 'FPGA' },
  { id: 'hil', label: 'HIL' },
  { id: 'robotics', label: 'Robotics' },
  { id: 'twin', label: 'Twin / IIoT' },
  { id: 'siem', label: 'SIEM' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'bom', label: 'BOM' },
]

/** Tab-strip group breaks: before 'embedded' (engineering) and 'siem' (ops). */
const MODE_GROUP_BREAKS = [5, 10]

export default function DomainWorkspace({ libraryComponents, onSave }: DomainWorkspaceProps) {
  const {
    workspaceMode,
    setWorkspaceMode,
    setActiveTool,
    settings,
    updateSettings,
    sidebarOpen,
    selectedComponents,
    clearSelection,
  } = useAppStore()
  const { components, wires, currentProject, updateComponent } = useProjectStore()

  /**
   * Click-to-place flow: selecting a library part arms it; the next click on
   * the empty sheet drops it (snapped). Esc or a mode switch disarms.
   */
  const [pendingComponent, setPendingComponent] = useState<Component | null>(null)

  const schematic: Schematic = {
    id: 'active-schematic',
    name: currentProject?.name ?? 'Untitled',
    components: components.map((c) => ({
      id: c.id,
      componentId: c.componentId,
      component: c.component as unknown as Schematic['components'][number]['component'],
      position: { x: c.x, y: c.y },
      rotation: c.rotation,
      scale: 1,
      reference: c.reference,
      properties: c.properties,
      locked: c.locked,
      visible: c.visible,
      selected: false,
    })),
    wires: wires.map((w) => ({
      id: w.id,
      points: w.points,
      netName: w.netName,
      connectedPins: w.connectedPins,
      style: w.style,
    })),
    nets: [],
    metadata: {
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      version: '1.0.0',
    },
    settings: {
      gridSize: 10,
      snapToGrid: true,
      showGrid: true,
      showPinNumbers: true,
      showPinNames: true,
      showNetNames: true,
    },
  }

  /** Persist the current snapshot — same payload shape as the canvas autosave. */
  const saveSnapshot = useCallback(() => {
    onSave({
      components: useProjectStore.getState().components,
      wires: useProjectStore.getState().wires,
      viewport: useAppStore.getState().viewport,
      timestamp: Date.now(),
    })
  }, [onSave])

  /*
   * CAD shortcuts. Registered only while the sheet is the active workspace and
   * never while the user is typing in a field.
   */
  useEffect(() => {
    if (workspaceMode !== 'schematic') return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.metaKey || event.ctrlKey) {
        if (event.key.toLowerCase() === 's') {
          event.preventDefault()
          saveSnapshot()
        }
        return
      }
      if (event.altKey) return
      switch (event.key.toLowerCase()) {
        case 'escape':
          setPendingComponent(null)
          clearSelection()
          break
        case 'v':
          setActiveTool('select')
          break
        case 'd':
          setActiveTool('delete')
          break
        case 'g':
          updateSettings({ showGrid: !settings.showGrid })
          break
        case 'f':
          window.dispatchEvent(new CustomEvent('folio:fit-view'))
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [workspaceMode, saveSnapshot, clearSelection, setActiveTool, updateSettings, settings.showGrid])

  const isSchematic = workspaceMode === 'schematic'

  /* Inspector payload: exactly one selected part shows the properties dock. */
  const selectedPart =
    selectedComponents.length === 1
      ? components.find((c) => c.id === selectedComponents[0]) ?? null
      : null
  const inspector = selectedPart
    ? {
        id: selectedPart.id,
        reference: selectedPart.reference,
        component: {
          name: selectedPart.component.name,
          category: selectedPart.component.category,
          pins: selectedPart.component.pins,
        },
        properties: selectedPart.properties,
        x: selectedPart.x,
        y: selectedPart.y,
        rotation: selectedPart.rotation,
      }
    : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Workspace document tabs — grouped by design / engineering / ops */}
      <nav
        className="app-chrome scrollbar-thin flex flex-shrink-0 items-stretch overflow-x-auto border-b border-border"
        aria-label="Workspace"
      >
        {MODES.map((mode, index) => (
          <span key={mode.id} className="flex items-stretch">
            {(index === MODE_GROUP_BREAKS[0] || index === MODE_GROUP_BREAKS[1]) && (
              <span className="my-1.5 w-px flex-shrink-0 bg-border" aria-hidden="true" />
            )}
            <button
              type="button"
              className={`cad-tab ${workspaceMode === mode.id ? 'cad-tab-active' : ''}`}
              aria-current={workspaceMode === mode.id ? 'page' : undefined}
              onClick={() => {
                setPendingComponent(null)
                setWorkspaceMode(mode.id)
              }}
            >
              {mode.label}
            </button>
          </span>
        ))}
      </nav>
      {/* Workstation row: tool rail | library | sheet | inspector */}
      <div className="flex min-h-0 flex-1">
        {isSchematic && <ToolRail onSave={saveSnapshot} />}

        {isSchematic && sidebarOpen && (
          <aside className="cad-dock" aria-label="Component library">
            <ComponentLibrary
              components={libraryComponents}
              selectedComponent={pendingComponent}
              onSelectComponent={(component) =>
                setPendingComponent((prev) => (prev?.id === component.id ? null : component))
              }
            />
          </aside>
        )}

        <div className="relative min-h-0 min-w-0 flex-1">
          {workspaceMode === 'schematic' && (
            <SchematicCanvas
              components={libraryComponents}
              onSave={onSave}
              pendingComponent={pendingComponent}
              onPendingPlaced={() => setPendingComponent(null)}
            />
          )}
          {workspaceMode === 'mechanical' && <MechanicalDesignPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'pcb' && <PCBDesignPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'convert' && (
            <div className="h-full overflow-auto p-4">
              <SchematicToPcbPanel schematic={schematic} />
            </div>
          )}
          {workspaceMode === 'preview3d' && <Circuit3DViewer onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'robotics' && <AdvancedRoboticsPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'embedded' && <BoardProgrammingPanel onClose={() => setWorkspaceMode('schematic')} />}
          {workspaceMode === 'fpga' && <FPGADesignPanel />}
          {workspaceMode === 'hil' && <HILTestingPanel />}
          {workspaceMode === 'twin' && <DigitalTwinFleetPanel />}
          {workspaceMode === 'siem' && <SIEMDashboard />}
          {workspaceMode === 'marketplace' && <MarketplacePanel />}
          {workspaceMode === 'dashboard' && <SystemDashboard />}
          {workspaceMode === 'bom' && <BOMPanel />}
        </div>

        {isSchematic && inspector && selectedPart && (
          <PropertiesPanel
            component={inspector}
            onUpdate={(id, patch) => {
              // The inspector patches both instance fields (x/y/rotation/lock)
              // and the editable attribute map — route each to its own slot.
              const { x, y, rotation, locked, visible, ...properties } = patch
              updateComponent(id, {
                properties,
                ...(typeof x === 'number' ? { x } : {}),
                ...(typeof y === 'number' ? { y } : {}),
                ...(typeof rotation === 'number' ? { rotation } : {}),
                ...(typeof locked === 'boolean' ? { locked } : {}),
                ...(typeof visible === 'boolean' ? { visible } : {}),
              })
            }}
            onClose={() => clearSelection()}
          />
        )}
      </div>
    </div>
  )
}
