/**
 * Workspace navigation metadata.
 *
 * One registry drives the tab strip, the command palette, the status bar and
 * the demo gallery, so a mode cannot appear in one place and silently go
 * missing from another. `Record<WorkspaceMode, …>` makes the compiler reject a
 * new mode until it is described here.
 */
import type { WorkspaceMode } from '../../stores/useAppStore'

export type WorkspaceGroupId = 'design' | 'electrical' | 'mechanical' | 'ops'

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
  { id: 'electrical', label: 'Electrical', description: 'Control, machines, RF, HDL, FPGA and silicon' },
  { id: 'mechanical', label: 'Mechanical', description: 'CAD, robotics, firmware and hardware test' },
  { id: 'ops', label: 'Ops & AI', description: 'Digital twins, agents, plugins and monitoring' },
]

const MODES: readonly WorkspaceModeMeta[] = [
  { id: 'schematic', label: 'Schematic', group: 'design', description: 'Place parts, wire nets and prepare the design for simulation and layout.' },
  { id: 'simulation', label: 'Simulation', group: 'design', description: 'DC, sweep, transient, AC, noise, Monte Carlo, digital and mixed-signal analysis.' },
  { id: 'convert', label: 'Sch → PCB', group: 'design', description: 'Convert the active schematic into a placed printed-circuit board.' },
  { id: 'pcb', label: 'PCB', group: 'design', description: 'Route copper and run DRC, EMC, thermal and signal-integrity checks.' },
  { id: 'preview3d', label: '3D / AR', group: 'design', description: 'Inspect and export the routed board as a three-dimensional scene.' },
  { id: 'bom', label: 'BOM', group: 'design', description: 'Aggregate parts, costs, lifecycle and supplier data.' },
  { id: 'control', label: 'Control', group: 'electrical', description: 'LTI transfer functions, PID, Bode, margins and closed-loop step response.' },
  { id: 'machines', label: 'Machines', group: 'electrical', description: 'DC motor/generator, BLDC and stepper operating points and waveforms.' },
  { id: 'rf', label: 'RF', group: 'electrical', description: 'Antenna, transmission-line and filter synthesis with far-field patterns.' },
  { id: 'hdl', label: 'HDL/RTL', group: 'electrical', description: 'Write, elaborate and simulate Verilog and VHDL.' },
  { id: 'icdesign', label: 'IC Design', group: 'electrical', description: 'Synthesize SKY130 RTL, floorplan, package and export GDSII.' },
  { id: 'fpga', label: 'FPGA', group: 'electrical', description: 'Elaborate HDL, estimate device resources and emit a design manifest.' },
  { id: 'mechanical', label: 'CAD', group: 'mechanical', description: 'Beam analysis, enclosures, STEP/STL, printability and G-code.' },
  { id: 'robotics', label: 'Robotics', group: 'mechanical', description: 'Forward/inverse kinematics, trajectories, collision checks and mechanisms.' },
  { id: 'embedded', label: 'Firmware', group: 'mechanical', description: 'Generate, compile and upload firmware and inspect board toolchains.' },
  { id: 'imaging', label: 'Pi Imaging', group: 'mechanical', description: 'Flash Raspberry Pi images, verify boot files and check serial bring-up.' },
  { id: 'visual', label: 'Blocks', group: 'mechanical', description: 'Compose behaviour from blocks and compile it to executable code.' },
  { id: 'hil', label: 'HIL', group: 'mechanical', description: 'Run hardware-in-the-loop suites against the modeled board.' },
  { id: 'twin', label: 'Twin / IIoT', group: 'ops', description: 'Synchronize digital twins and monitor a device fleet.' },
  { id: 'agents', label: 'Agents', group: 'ops', description: 'Inspect the EDA tool harness and run the symbolic verifier.' },
  { id: 'components', label: 'Parts', group: 'ops', description: 'Import datasheets and extend the local part library.' },
  { id: 'plugins', label: 'Plugins', group: 'ops', description: 'Review, install and manage permission-gated plugins.' },
  { id: 'dashboard', label: 'System', group: 'ops', description: 'Compute capabilities, acceleration paths and project metrics.' },
  { id: 'siem', label: 'SIEM', group: 'ops', description: 'Audit trail, security alerts and policy visibility.' },
  { id: 'marketplace', label: 'Marketplace', group: 'ops', description: 'Browse, install and publish versioned design bundles.' },
]

export const WORKSPACE_MODES: readonly WorkspaceModeMeta[] = MODES

export const WORKSPACE_MODE_META: Readonly<Record<WorkspaceMode, WorkspaceModeMeta>> =
  Object.fromEntries(MODES.map((mode) => [mode.id, mode])) as Record<WorkspaceMode, WorkspaceModeMeta>

export function groupForMode(mode: WorkspaceMode): WorkspaceModeMeta['group'] {
  return WORKSPACE_MODE_META[mode].group
}
