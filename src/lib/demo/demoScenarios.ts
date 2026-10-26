/**
 * One-click demos for every workspace.
 *
 * Each entry names the workspace it opens, what the user can exercise there,
 * and (when the panel cannot pre-populate itself) the bootstrap the shell runs.
 * `demoScenarios.test.ts` asserts that every `WorkspaceMode` has at least one
 * scenario, so a new domain cannot ship without a way to try it.
 */
import type { WorkspaceMode } from '../../stores/useAppStore'
import type { WorkspaceGroupId } from '../workspace/modes'

export type DemoLoad =
  | 'demo-board'
  | 'demo-pcb'
  | 'pcb-autoroute'
  | 'rectifier-transient'
  | 'fpga-verilog'
  | 'fpga-vhdl'
  | 'embedded-rectifier'
  | 'robotics-demo'
  | 'twin-rectifier'
  | 'bom-audit'
  | 'marketplace-bundle'
  | 'machines-bldc'
  | 'machines-stepper'
  | 'rf-filter'
  | 'ic-full-flow'
  | 'datasheet-demo'
  | 'visual-blocks'
  | 'ic-device-lab'
  | 'hil-suite'
  | 'mechanical-enclosure'

export interface DemoScenario {
  id: string
  title: string
  mode: WorkspaceMode
  group: WorkspaceGroupId
  summary: string
  /** Concrete capabilities the demo exercises, shown on its card. */
  proves: readonly string[]
  load?: DemoLoad
  /**
   * One-shot request for a panel that has its own bootstrap (for example the
   * agent verifier). Independent of `load`, so a scenario can load the board
   * and still ask its panel to run something specific.
   */
  request?: string
}

export const DEMO_SCENARIOS: readonly DemoScenario[] = [
  {
    id: 'rectifier-schematic',
    title: 'Half-wave rectifier',
    mode: 'schematic',
    group: 'design',
    summary: 'Six-part rectifier with a real 1N5817 model and IPC footprints, wired and ready to edit.',
    proves: ['Placement and wiring', 'Symbol pin contracts', 'Footprints for layout'],
    load: 'demo-board',
  },
  {
    id: 'rectifier-transient',
    title: 'Rectifier transient response',
    mode: 'simulation',
    group: 'design',
    summary: 'Run a transient analysis on the rectifier and inspect the input, output and capacitor ripple.',
    proves: ['MNA transient solver', 'Waveform probes', 'Ripple and diode drop'],
    load: 'rectifier-transient',
  },
  {
    id: 'rectifier-convert',
    title: 'Schematic → PCB conversion',
    mode: 'convert',
    group: 'design',
    summary: 'Convert the rectifier into a placed board, then tune size, layer count and design rules.',
    proves: ['Netlist-driven placement', 'ERC gate', 'Board sizing'],
    load: 'demo-board',
  },
  {
    id: 'rectifier-pcb',
    title: 'Route and verify the rectifier PCB',
    mode: 'pcb',
    group: 'design',
    summary: 'Inspect the A*-routed rectifier with real pads and silkscreen, then run DRC, EMC, thermal and signal-integrity checks.',
    proves: ['A* autorouting', 'DRC rules', 'Thermal and SI analysis'],
    load: 'demo-pcb',
  },
  {
    id: 'rectifier-3d',
    title: 'Routed board in 3D',
    mode: 'preview3d',
    group: 'design',
    summary: 'Inspect the routed copper, vias, pads and parts, then export the same mesh as STL.',
    proves: ['Real copper geometry', 'Layer and part visibility', 'Mesh export'],
    load: 'demo-pcb',
  },
  {
    id: 'rectifier-bom',
    title: 'Rectifier BOM audit',
    mode: 'bom',
    group: 'design',
    summary: 'Audit a proven BOM with quantity breaks, lifecycle status and supplier cross-reference.',
    proves: ['BOM aggregation', 'Lifecycle inference', 'CSV/JSON export'],
    load: 'bom-audit',
  },
  {
    id: 'control-motor-loop',
    title: 'Motor speed loop with PID',
    mode: 'control',
    group: 'electrical',
    summary: 'A first-order plant with a filtered-derivative PID: step response, Bode plot and margins.',
    proves: ['Pole/zero analysis', 'PID tuning', 'Bode margins'],
  },
  {
    id: 'machines-dc',
    title: 'Brushed DC motor',
    mode: 'machines',
    group: 'electrical',
    summary: 'Drive a DC machine, then switch it to generator duty and compare terminal voltage and efficiency.',
    proves: ['ZOH-exact armature model', 'Motor/generator conventions', 'Operating-point table'],
  },
  {
    id: 'machines-bldc',
    title: 'BLDC drive with FOC',
    mode: 'machines',
    group: 'electrical',
    summary: 'Inspect dq currents, ideal field-oriented control and the resulting torque and speed traces.',
    proves: ['dq machine model', 'FOC decoupling', 'Time-domain traces'],
    load: 'machines-bldc',
  },
  {
    id: 'machines-stepper',
    title: 'Stepper microstep dynamics',
    mode: 'machines',
    group: 'electrical',
    summary: 'Explore holding torque, phase-current lag, detent and damping at different step rates.',
    proves: ['Torque/current lag', 'RK4 substepping', 'Step-rate sweeps'],
    load: 'machines-stepper',
  },
  {
    id: 'rf-dipole',
    title: '2.4 GHz dipole antenna',
    mode: 'rf',
    group: 'electrical',
    summary: 'Synthesize a half-wave dipole, inspect its integrated far-field pattern and optimise length.',
    proves: ['Numerical directivity', 'Pattern plots', 'Optimiser refusal outside the achievable range'],
  },
  {
    id: 'rf-filter',
    title: '1 GHz low-pass filter',
    mode: 'rf',
    group: 'electrical',
    summary: 'Synthesize a ladder low-pass filter and inspect component values and the calculated response.',
    proves: ['Filter synthesis', 'Order selection', 'Cutoff and roll-off'],
    load: 'rf-filter',
  },
  {
    id: 'hdl-half-adder',
    title: 'Half adder in HDL',
    mode: 'hdl',
    group: 'electrical',
    summary: 'Elaborate structural Verilog or VHDL, run four-state simulation and map to SKY130 cells.',
    proves: ['HDL parsing', 'Digital simulation', 'Gate mapping'],
    request: 'hdl-half-adder',
  },
  {
    id: 'fpga-half-adder',
    title: 'FPGA elaboration and manifest',
    mode: 'fpga',
    group: 'electrical',
    summary: 'Elaborate the half adder against a real FPGA device and generate a design manifest.',
    proves: ['Resource estimates', 'Device selection', 'Manifest export'],
    load: 'fpga-verilog',
  },
  {
    id: 'ic-full-flow',
    title: 'SKY130 full adder flow',
    mode: 'icdesign',
    group: 'electrical',
    summary: 'Synthesize RTL, floorplan the die, choose a package and export GDSII in one flow.',
    proves: ['SKY130 synthesis', 'Die and core sizing', 'QFN/TQFP/BGA packaging'],
    load: 'ic-full-flow',
  },
  {
    id: 'ic-device-lab',
    title: 'Logic and memory device lab',
    mode: 'icdesign',
    group: 'electrical',
    summary: 'Clock a 74HC595, load a 74HC165, decode with a 74HC138 and exercise SRAM, EEPROM and NOR flash.',
    proves: ['Shift-register edges', 'Active-low decoding', 'Page/erase semantics'],
    load: 'ic-device-lab',
  },
  {
    id: 'mechanical-enclosure',
    title: 'Enclosure and fabrication tray',
    mode: 'mechanical',
    group: 'mechanical',
    summary: 'Size a PCB enclosure, check beam deflection, slice the tray to G-code and export STEP/STL.',
    proves: ['Beam analysis', 'Enclosure workflow', 'FDM slicing'],
    load: 'mechanical-enclosure',
  },
  {
    id: 'robotics-two-link',
    title: 'Two-link arm and trajectory',
    mode: 'robotics',
    group: 'mechanical',
    summary: 'Load the planar two-link arm, run forward kinematics, step a timed joint move and export the mechanism.',
    proves: ['Planar forward kinematics', 'Timed trajectory', 'STEP export'],
    load: 'robotics-demo',
  },
  {
    id: 'embedded-rectifier-sketch',
    title: 'Rectifier monitor firmware',
    mode: 'embedded',
    group: 'mechanical',
    summary: 'Load the proven rectifier sketch, run the deterministic build analysis and inspect flash/RAM headroom. Exact machine code needs arduino-cli.',
    proves: ['Sketch generation', 'Static build analysis', 'Toolchain caveat'],
    load: 'embedded-rectifier',
  },
  {
    id: 'imaging-pipeline',
    title: 'Pi image flashing and bring-up',
    mode: 'imaging',
    group: 'mechanical',
    summary: 'Inspect the chunked image-flash workflow and the Linux boot contract; live flashing needs the local companion daemon.',
    proves: ['Chunked image plan', 'Boot-file contract', 'Serial handshake'],
    request: 'imaging-pipeline',
  },
  {
    id: 'visual-blocks',
    title: 'Visual behaviour program',
    mode: 'visual',
    group: 'mechanical',
    summary: 'Compose a behaviour graph from blocks, compile it and inspect the generated program.',
    proves: ['Block graph', 'Compiler diagnostics', 'Generated code'],
    load: 'visual-blocks',
  },
  {
    id: 'hil-rectifier',
    title: 'Rectifier HIL suite',
    mode: 'hil',
    group: 'mechanical',
    summary: 'Run the rectifier HIL cases; with no bench attached each hardware loop reports a refusal and the panel says why, while the twin check covers the model.',
    proves: ['HIL scenarios', 'Assertions and timing', 'Pass/fail reporting'],
    load: 'hil-suite',
  },
  {
    id: 'twin-rectifier',
    title: 'Rectifier digital twin',
    mode: 'twin',
    group: 'ops',
    summary: 'Register a fleet, sync a twin and verify the rectifier simulation against its physical model.',
    proves: ['Twin synchronization', 'Fleet telemetry', 'Verification verdict'],
    load: 'twin-rectifier',
  },
  {
    id: 'agents-verifier',
    title: 'Agent tools and symbolic verifier',
    mode: 'agents',
    group: 'ops',
    summary: 'Inspect the EDA tool harness and run the symbolic verifier against a design claim.',
    proves: ['Tool registry', 'Symbolic checks', 'Evidence output'],
    load: 'demo-board',
    request: 'agents-verifier',
  },
  {
    id: 'agents-autopilot',
    title: 'Agent autopilot: ripple search',
    mode: 'agents',
    group: 'ops',
    summary: 'Run the bounded autopilot on the rectifier: it edits the live sheet, solves every candidate and keeps the best measured filter capacitor with schematic and waveform evidence.',
    proves: ['Closed-loop design', 'Measured iterations', 'Per-iteration evidence'],
    load: 'demo-board',
    request: 'agents-autopilot',
  },
  {
    id: 'agents-mechanical-autopilot',
    title: 'Agent mechanical sizing',
    mode: 'agents',
    group: 'ops',
    summary:
      'Size the main beam under strength and deflection limits: the closed loop writes each candidate to the live assembly, redraws it, and keeps the lightest feasible section.',
    proves: ['Bounded sizing search', 'Constraint checks', 'Per-iteration assembly drawing'],
    request: 'agents-mechanical-autopilot',
  },
  {
    id: 'datasheet-importer',
    title: 'Datasheet part import',
    mode: 'components',
    group: 'ops',
    summary: 'Turn a datasheet into a library part with pins and properties, then add it to the sheet.',
    proves: ['Pin extraction', 'Custom parts', 'Library integration'],
    load: 'datasheet-demo',
  },
  {
    id: 'plugins-permissions',
    title: 'Plugin permissions',
    mode: 'plugins',
    group: 'ops',
    summary: 'Review manifests, declared permissions and lifecycle hooks; install a local plugin.',
    proves: ['Manifest validation', 'Permission gating', 'Install/uninstall'],
    request: 'plugins-permissions',
  },
  {
    id: 'dashboard-acceleration',
    title: 'Compute capability probe',
    mode: 'dashboard',
    group: 'ops',
    summary: 'Probe WebGPU, Workers and shared memory, and see the recommended thermal execution path.',
    proves: ['Adapter detection', 'Worker support', 'Acceleration fallback'],
    request: 'dashboard-acceleration',
  },
  {
    id: 'siem-audit',
    title: 'Security audit trail',
    mode: 'siem',
    group: 'ops',
    summary: 'Inspect audit events, active alerts and the local SIEM monitoring feed.',
    proves: ['Audit trail', 'Alert state', 'Local monitoring'],
  },
  {
    id: 'marketplace-bundle',
    title: 'Publish a design bundle',
    mode: 'marketplace',
    group: 'ops',
    summary: 'Publish the proven rectifier bundle and see it appear in the local marketplace index.',
    proves: ['Bundle packaging', 'Versioned listing', 'Local install state'],
    load: 'marketplace-bundle',
  },
]

export function scenariosForGroup(group: WorkspaceGroupId): DemoScenario[] {
  return DEMO_SCENARIOS.filter((scenario) => scenario.group === group)
}

export function scenariosForMode(mode: WorkspaceMode): DemoScenario[] {
  return DEMO_SCENARIOS.filter((scenario) => scenario.mode === mode)
}

export function findScenario(id: string): DemoScenario | undefined {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id)
}
