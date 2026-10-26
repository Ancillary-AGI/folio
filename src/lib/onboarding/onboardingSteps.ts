import {
  Activity, Bot, CircuitBoard, Cpu, GitBranch, History, Layers3, Shield,
  type LucideIcon,
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
  action?: 'load-sample-circuit'
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
      'Place components, connect pins, and give every part a real value or model. Netlist extraction resolves connectivity from wire topology and net names, so naming power and ground rails is what makes the rest of the toolchain reliable.',
    checklist: [
      'Name your power and ground rails explicitly',
      'Use exact manufacturer part numbers where you can',
      'Clear unconnected pins before running any analysis',
    ],
    mode: 'schematic',
    icon: CircuitBoard,
    target: 'component-library',
    placement: 'right',
    action: 'load-sample-circuit',
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
]

/** Total number of steps; used by the tour and by progress persistence. */
export const ONBOARDING_STEP_COUNT = ONBOARDING_STEPS.length

/** Clamp an arbitrary index into the valid step range. */
export function clampOnboardingStep(index: number): number {
  if (!Number.isInteger(index)) return 0
  return Math.min(Math.max(index, 0), ONBOARDING_STEP_COUNT - 1)
}
