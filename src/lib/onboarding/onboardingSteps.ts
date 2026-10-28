import {
  Activity, Bot, CircuitBoard, Cpu, GitBranch, History, Layers3, MousePointerClick, ScrollText,
  Shield, TrendingUp, type LucideIcon,
} from 'lucide-react'
import type { WorkspaceMode } from '../../stores/useAppStore'

/**
 * The onboarding curriculum.
 *
 * Kept as data, outside the component, so that:
 *   - the tour, the step counter and the tests all read the same source;
 *   - content can be reviewed and translated without touching JSX;
 *   - a new step cannot silently desynchronise the progress indicator.
 *
 * `mode` is the workspace the step teaches, and the tour switches to it so the
 * user sees the domain being described rather than a blank shell. `target` is
 * a `data-tour` marker in the shell: the spotlight finds the element at
 * runtime and the coach mark moves next to it. A step without a target (or
 * whose target is not on screen) falls back to a centred card.
 */
export interface OnboardingStep {
  id: string
  title: string
  summary: string
  detail: string
  checklist: string[]
  mode: WorkspaceMode
  icon: LucideIcon
  /** `data-tour` value of the element to spotlight. */
  target?: string
  /** Used when the primary target is absent at this viewport width. */
  fallbackTarget?: string
  /** Preferred side of the target for the coach mark. */
  placement?: 'top' | 'right' | 'bottom' | 'left'
  /** Optional interactive affordance rendered inside the step. */
  action?: 'load-sample-circuit' | 'open-limits'
  /**
   * The step teaches a gesture the engineer should try right now. The overlay
   * stops swallowing pointer events, so the app stays live behind the card and
   * keyboard focus outside the card keeps driving the canvas.
   */
  handsOn?: boolean
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 'workflow',
    title: 'One project, one connected engineering workflow',
    summary: 'Start from intent, then move deliberately toward implementation evidence.',
    detail:
      'Schematic, PCB, mechanical, embedded, simulation, robotics, digital-twin and security tools all operate on the same project. Each domain keeps its own model and validation limits. Sharing a workspace is not the same as physics being coupled.',
    checklist: [
      'Create one project per revision of your design',
      'Keep requirements, assumptions and units explicit',
      'Take a checkpoint before any risky edit or conversion',
    ],
    mode: 'schematic',
    icon: Layers3,
    target: 'app-header',
    placement: 'bottom',
  },
  {
    id: 'schematic',
    title: 'Capture electrical intent in the schematic',
    summary: 'Build a circuit that reads correctly before you optimise it.',
    detail:
      'Place components, connect pins, and give every part a real value or model. Netlist extraction resolves connectivity from wire topology and net names, so naming power and ground rails is what makes the rest of the toolchain reliable. The wire tool is click-to-click: arm it on the left rail, click a pin, click the next, and the sheet routes the segment.',
    checklist: [
      'Arm the wire tool on the rail and join two pins',
      'Name your power and ground rails explicitly',
      'Use exact manufacturer part numbers where you can',
      'Clear unconnected pins before running any analysis',
    ],
    mode: 'schematic',
    icon: CircuitBoard,
    target: 'component-library',
    placement: 'right',
    action: 'load-sample-circuit',
    handsOn: true,
  },
  {
    id: 'editor-tools',
    title: 'The rail holds the gestures, the keys hold the rail',
    summary: 'Select, wire and delete sit on one rail, each with a one-key shortcut.',
    detail:
      'Press V, W or D to arm a tool, G to toggle the grid and F to fit the design to the view; every button that has a shortcut prints its keycap, so the shortcut is discoverable without a cheat sheet. Snap is its own toggle: with snap on, a part lands on the grid pitch the router and the netlist can reason about.',
    checklist: [
      'Press W, click a pin, click the next pin: that is one wire',
      'Keep snap on while laying out, and turn it off only for odd-pitch parts',
      'Undo is on the rail and on Ctrl+Z — never retype a mistake away',
    ],
    mode: 'schematic',
    icon: MousePointerClick,
    target: 'tool-rail',
    placement: 'right',
    handsOn: true,
  },
  {
    id: 'simulate',
    title: 'Simulate with stated models and assumptions',
    summary: 'A numeric result is only as trustworthy as its model and boundary conditions.',
    detail:
      'The simulator solves the circuit you actually drew. DC uses modified nodal analysis. Other analyses are available only when the selected solver implements them; do not treat a numerical result as hardware certification.',
    checklist: [
      'Use vendor models for critical active devices',
      'Sweep tolerances and operating corners, not just nominal',
      'Correlate predictions against bench measurements',
    ],
    mode: 'schematic',
    icon: Activity,
    target: 'simulation-toggle',
    fallbackTarget: 'workspace-nav',
    placement: 'bottom',
  },
  {
    id: 'waveforms',
    title: 'Read the response, not just the picture',
    summary: 'Zoom, pan and pin a cursor to take real numbers off the solver output.',
    detail:
      'Every trace chart in the workbench shares the same gestures: drag to zoom a window, shift-drag to pan, scroll to zoom under the pointer, click to pin a readout, and plus, minus, arrow keys or R when the chart has keyboard focus. A pinned cursor reports a value at a solved sample, never one interpolated between samples, so what you read is what the solver produced.',
    checklist: [
      'Zoom to the edge you are judging: a switching transient, a filter corner, a phase crossover',
      'Pin a cursor instead of eyeballing the axis when a number goes into a report',
      'Re-read the stated model and solver limits before treating a curve as evidence',
    ],
    mode: 'simulation',
    icon: TrendingUp,
    target: 'workspace-canvas',
    handsOn: true,
  },
  {
    id: 'convert',
    title: 'Convert to PCB and verify constraints',
    summary: 'Treat conversion as a starting layout, never as manufacturing approval.',
    detail:
      'Inspect footprint mapping and board outline, then review clearance, net connectivity, copper width and return paths against the fabricator rules you will actually order from. DRC and ERC findings are evidence, not decoration.',
    checklist: [
      'Confirm every symbol maps to the intended footprint',
      'Resolve DRC and ERC findings you have not explicitly waived',
      'Compare Gerber and drill outputs in a manufacturing viewer',
    ],
    mode: 'convert',
    icon: GitBranch,
    target: 'workspace-nav',
    placement: 'bottom',
  },
  {
    id: 'mechanical',
    title: 'Prepare the mechanical and 3D context',
    summary: 'Judge fit and packaging separately from electrical correctness.',
    detail:
      'Use the CAD and 3D views to review envelopes, clearances and placement. Mechanical models and PCB data need verified coordinate systems and an exported assembly before they can be treated as shared geometry.',
    checklist: [
      'Confirm units, origin and board outline',
      'Check connector access and component height',
      'Export geometry and re-open it in the target toolchain',
    ],
    mode: 'mechanical',
    icon: Cpu,
    target: 'workspace-canvas',
    handsOn: true,
  },
  {
    id: 'evidence',
    title: 'Connect firmware, hardware tests and twins',
    summary: 'Move from design artefacts to controlled experiments.',
    detail:
      'Embedded, FPGA and HIL workspaces organise the programming and test flow. Real hardware needs a supported toolchain, configured target, attached interface, safe test limits and calibration. A digital twin needs trustworthy live signals and a validated physical model.',
    checklist: [
      'Select and verify the actual board and toolchain',
      'Use current-limited supplies and documented test fixtures',
      'Version firmware, calibration and telemetry schemas together',
    ],
    mode: 'hil',
    icon: Shield,
    target: 'status-bar',
    placement: 'top',
  },
  {
    id: 'version-control',
    title: 'Version the whole project, not just the schematic',
    summary: 'Every commit captures the complete multi-domain design state.',
    detail:
      'One content-addressed commit stores schematic, routed PCB, mechanical assembly, firmware and every other CAD domain together. Check out any commit to restore a consistent state, and branch when an alternative should not disturb the current design.',
    checklist: [
      'Commit a named milestone before a risky edit',
      'Keep one branch per alternative, review the diff before merging',
      'Treat local history as working storage, not a backup you have verified',
    ],
    mode: 'schematic',
    icon: History,
    target: 'version-history',
    placement: 'bottom',
  },
  {
    id: 'agent',
    title: 'Drive the CAD with an agent, visually',
    summary: 'The assistant reads the sheet and board back as images after every edit.',
    detail:
      'The assistant is a closed loop over the same CAD tools you use: it observes the schematic or board image, proposes a change, applies it, then re-reads the result. Autopilot and multi-step runs stay on this device; any cloud model needs credentials you provide and is labelled as such.',
    checklist: [
      'Describe the goal and the constraints in engineering terms',
      'Require visual feedback after every structural change',
      'Review the diff and run verification before accepting a design',
    ],
    mode: 'agents',
    icon: Bot,
    target: 'agent-button',
    fallbackTarget: 'workspace-canvas',
    placement: 'bottom',
  },
  {
    id: 'limits',
    title: 'Know the boundary of every number',
    summary: 'One registry states what each analysis computes, how, and what it refuses to model.',
    detail:
      'The LIMITS button in the status bar opens a registry of the whole workbench: the method behind each result — LU on the MNA matrix, Newton-Raphson with gmin stamping, damped least-squares IK, a Lee and A* routing grid — the test file that pins it, and a block naming what is not modelled. It is blunt on purpose: the noise figure is thermal plus diode and never total, antenna gain equals integrated directivity under a stated loss-free assumption, the fab gate implements one vendor profile, and no agent tool touches hardware. A result you cannot bound is a result you cannot use.',
    checklist: [
      'Read the Not covered block before a number goes into a report',
      'Filter the registry to the workspace you are in, then search a method name such as MNA, IK or relay',
      'Open the test file named on the row when a claim decides something real',
    ],
    mode: 'schematic',
    icon: ScrollText,
    target: 'limits-button',
    placement: 'top',
    action: 'open-limits',
  },
]

/** Total number of steps; used by the tour and by progress persistence. */
export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length

/** Clamp an arbitrary index into the valid step range. */
export function clampOnboardingStep(index: number): number {
  if (!Number.isInteger(index)) return 0
  return Math.min(Math.max(index, 0), ONBOARDING_STEP_COUNT - 1)
}
