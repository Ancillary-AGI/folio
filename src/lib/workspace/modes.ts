/**
 * Workspace navigation metadata.
 *
 * One registry drives the tab strip, the command palette, the status bar and
 * the demo gallery, so a mode cannot appear in one place and silently go
 * missing from another. `Record<WorkspaceMode, …>` makes the compiler reject a
 * new mode until it is described here.
 */
import type { WorkspaceMode } from '../../stores/useAppStore'

export type WorkspaceGroupId = 'design' | 'electrical' | 'mechanical' | 'life' | 'ops'

export interface WorkspaceGroup {
  id: WorkspaceGroupId
  label: string
  description: string
}

export interface WorkspaceModeMeta {
  id: WorkspaceMode
  label: string
  description: string
  group: WorkspaceGroupId
}

export const WORKSPACE_GROUPS: readonly WorkspaceGroup[] = [
  { id: 'design', label: 'Design', description: 'Schematic capture, simulation, PCB and fabrication' },
  { id: 'electrical', label: 'Electrical', description: 'Control, machines, power grids, RF, HDL, FPGA and silicon' },
  { id: 'mechanical', label: 'Mechanical', description: 'CAD, structures, robotics, firmware and hardware test' },
  { id: 'life', label: 'Life systems', description: 'Reaction kinetics, organelles, cells, tissues, organs and whole-body disposition' },
  { id: 'ops', label: 'Operations', description: 'Digital twins, agents, plugins and monitoring' },
]

const MODES: readonly WorkspaceModeMeta[] = [
  { id: 'schematic', label: 'Schematic', group: 'design', description: 'Place parts, wire nets and prepare the design for simulation and layout.' },
  { id: 'simulation', label: 'Simulation', group: 'design', description: 'DC, sweep, transient, AC, noise, Monte Carlo, digital and mixed-signal analysis.' },
  { id: 'convert', label: 'Sch → PCB', group: 'design', description: 'Convert the active schematic into a placed printed-circuit board.' },
  { id: 'pcb', label: 'PCB', group: 'design', description: 'Route copper and run DRC, EMC, thermal and signal-integrity checks.' },
  { id: 'preview3d', label: '3D / AR', group: 'design', description: 'Inspect and export the routed board as a three-dimensional scene.' },
  { id: 'bom', label: 'BOM', group: 'design', description: 'Aggregate parts, costs and declared lifecycle status.' },
  { id: 'control', label: 'Control', group: 'electrical', description: 'LTI transfer functions, PID, Bode, margins and closed-loop step response.' },
  { id: 'machines', label: 'Machines', group: 'electrical', description: 'DC motor/generator, BLDC and stepper operating points and waveforms.' },
  { id: 'grid', label: 'Grid', group: 'electrical', description: 'Transmission and distribution power flow with generator limits and line loading.' },
  { id: 'rf', label: 'RF', group: 'electrical', description: 'Antennas, filters, radio and fibre link budgets, NR/6G numerology and statevector quantum circuits.' },
  { id: 'hdl', label: 'HDL/RTL', group: 'electrical', description: 'Write, elaborate and simulate Verilog and VHDL.' },
  { id: 'icdesign', label: 'IC Design', group: 'electrical', description: 'Synthesize SKY130 RTL, floorplan, package and export GDSII.' },
  { id: 'fpga', label: 'FPGA', group: 'electrical', description: 'Elaborate HDL, estimate device resources and emit a design manifest.' },
  { id: 'mechanical', label: 'CAD', group: 'mechanical', description: 'Beam analysis, enclosures, STEP/STL, printability and G-code.' },
  { id: 'structures', label: 'Structures', group: 'mechanical', description: 'Pin-jointed trusses: joints, bars, bearings and loads solved by direct stiffness.' },
  { id: 'robotics', label: 'Robotics', group: 'mechanical', description: 'Forward/inverse kinematics, trajectories, collision checks and mechanisms.' },
  { id: 'embedded', label: 'Firmware', group: 'mechanical', description: 'Generate, compile and upload firmware and inspect board toolchains.' },
  { id: 'imaging', label: 'Pi Imaging', group: 'mechanical', description: 'Flash Raspberry Pi images, verify boot files and check serial bring-up.' },
  { id: 'visual', label: 'Blocks', group: 'mechanical', description: 'Compose behaviour from blocks and compile it to executable code.' },
  { id: 'hil', label: 'HIL', group: 'mechanical', description: 'Run hardware-in-the-loop suites against the modeled board.' },
  { id: 'biology', label: 'Biology', group: 'life', description: 'Reaction kinetics, a respiring mitochondrion, excitable cells, gene circuits, conducting tissue and circuits, and drug disposition — solved, not illustrated.' },
  { id: 'twin', label: 'Twin / IIoT', group: 'ops', description: 'Synchronize digital twins and monitor a device fleet.' },
  { id: 'agents', label: 'Agents', group: 'ops', description: 'Run the closed-loop autopilot, inspect the EDA tool harness and verify a design claim.' },
  { id: 'components', label: 'Parts', group: 'ops', description: 'Import datasheets and extend the local part library.' },
  { id: 'plugins', label: 'Plugins', group: 'ops', description: 'Review, install and manage permission-gated plugins.' },
  { id: 'dashboard', label: 'System', group: 'ops', description: 'Compute capabilities, acceleration paths and project metrics.' },
  { id: 'siem', label: 'Activity log', group: 'ops', description: 'What this workspace recorded, the alerts those events raised, and policy state.' },
  { id: 'marketplace', label: 'Marketplace', group: 'ops', description: 'Browse, install and publish versioned design bundles.' },
]

export const WORKSPACE_MODES: readonly WorkspaceModeMeta[] = MODES

export const WORKSPACE_MODE_META: Readonly<Record<WorkspaceMode, WorkspaceModeMeta>> =
  Object.fromEntries(MODES.map((mode) => [mode.id, mode])) as Record<WorkspaceMode, WorkspaceModeMeta>

export function groupForMode(mode: WorkspaceMode): WorkspaceModeMeta['group'] {
  return WORKSPACE_MODE_META[mode].group
}

/** How many workspaces each family actually ships — derived, never hand-typed. */
export const MODE_COUNT_BY_GROUP: Readonly<Record<WorkspaceGroupId, number>> =
  WORKSPACE_GROUPS.reduce(
    (acc, group) => ({ ...acc, [group.id]: MODES.filter((mode) => mode.group === group.id).length }),
    {} as Record<WorkspaceGroupId, number>,
  )

/**
 * The workspace a family is entered through: the first mode listed under it, so
 * "start a project in this family" lands on the tab that family is built around
 * instead of always on the schematic. Derived from the same registry — a family
 * that shipped no mode would fail here rather than quietly open a blank tab.
 */
export const FIRST_MODE_BY_GROUP: Readonly<Record<WorkspaceGroupId, WorkspaceMode>> =
  WORKSPACE_GROUPS.reduce(
    (acc, group) => {
      const first = MODES.find((mode) => mode.group === group.id)
      if (!first) throw new Error(`Workspace family "${group.id}" lists no mode.`)
      return { ...acc, [group.id]: first.id }
    },
    {} as Record<WorkspaceGroupId, WorkspaceMode>,
  )
