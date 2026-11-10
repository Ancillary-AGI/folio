import {
  Activity, Bot, CircuitBoard, Cpu, GitBranch, HelpCircle, History, Layers3, MousePointerClick, ScrollText,
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
export type OnboardingChapterId =
  | 'orientation'
  | 'capture'
  | 'prove'
  | 'physical'
  | 'connect'
  | 'govern'

export interface OnboardingChapter {
  id: OnboardingChapterId
  label: string
  /** What this chapter promises before its first step opens. */
  promise: string
}

/**
 * The tour reads as six deliberate chapters rather than thirteen flat steps.
 * The order is a design review: orient yourself, capture intent, prove it,
 * build it, connect it, then govern what you built.
 */
export const ONBOARDING_CHAPTERS: readonly OnboardingChapter[] = [
  {
    id: 'orientation',
    label: 'Orientation',
    promise: 'Find your way around the workbench and the families that hold its workspaces.',
  },
  {
    id: 'capture',
    label: 'Capture',
    promise: 'Turn intent into a connected electrical design on the sheet.',
  },
  {
    id: 'prove',
    label: 'Prove it',
    promise: 'Simulate with stated models and read real numbers off the results.',
  },
  {
    id: 'physical',
    label: 'Make it physical',
    promise: 'Turn the netlist into a board, verify constraints and judge mechanical fit.',
  },
  {
    id: 'connect',
    label: 'Connect it',
    promise: 'Join firmware, hardware tests, digital twins and the agent loop.',
  },
  {
    id: 'govern',
    label: 'Delegate & govern',
    promise: 'Version the whole project and know the boundary of every number.',
  },
]

export interface OnboardingStep {
  id: string
  chapter: OnboardingChapterId
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
    chapter: 'orientation',
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
    id: 'families',
    chapter: 'orientation',
    title: 'Five families hold twenty-eight workspaces',
    summary: 'Design, Electrical, Mechanical, Life systems and Operations each open their own tools; hover a tab to hear what it does.',
    detail:
      'The family strip groups the workbench by discipline and the row beneath it holds that family’s workspaces — schematic, simulation, PCB and fabrication under Design; control, machines, RF, HDL and silicon under Electrical; CAD, robotics, firmware, imaging, blocks and HIL under Mechanical; reaction kinetics, organelles, cells and whole-body disposition under Life systems; agents, parts, plugins, system, activity log and marketplace under Operations. Each tab has a one-sentence description on hover, the Guide button opens the full workspace guide, and the demo gallery has a tested scenario for every mode.',
    checklist: [
      'Open a family you have not used and read its tabs',
      'Hover a tab before opening it: the tooltip says what the workspace computes',
      'Use Guide to compare what that workspace models and what it refuses to model',
    ],
    mode: 'schematic',
    icon: Layers3,
    target: 'workspace-nav',
    placement: 'bottom',
    handsOn: true,
  },
  {
    id: 'help',
    chapter: 'orientation',
    title: 'Help lives in the chrome, not in a manual',
    summary: 'Hover a control to hear what it does; press F1 for guides and hands-on tutorials.',
    detail:
      'Rest the pointer on any rail button, header control or workspace tab and a one-line explanation appears after a moment; every control that has a shortcut prints its keycap. Press F1 or ? anywhere to open the help centre: guided tutorials that load a working demo and walk the real buttons, a guide to each of the 28 workspaces, a control reference and the shortcut list. Tutorial steps are self-checked — the workbench does not watch your screen or grade the result.',
    checklist: [
      'Hover the wire tool on the rail: the tooltip names the tool and its key',
      'Press F1, open Tutorials and start the rectifier walkthrough',
      'Read a workspace guide before trusting its numbers',
    ],
    mode: 'schematic',
    icon: HelpCircle,
    target: 'help-button',
    placement: 'bottom',
  },
  {
    id: 'schematic',
    chapter: 'capture',
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
    chapter: 'capture',
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
    chapter: 'prove',
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
    target: 'workspace-nav',
    placement: 'bottom',
  },
  {
    id: 'waveforms',
    chapter: 'prove',
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
    chapter: 'physical',
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
    chapter: 'physical',
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
    chapter: 'connect',
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
    id: 'agent',
    chapter: 'connect',
    title: 'Drive the CAD with an agent, visually',
    summary: 'The assistant reads the sheet and board back as images after every edit.',
    detail:
      'The assistant is a closed loop over the same CAD tools you use: it observes the schematic or board image, proposes a change, applies it, then re-reads the result. Autopilot and multi-step runs stay in the workspace; any cloud model needs credentials you provide and is labelled as such.',
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
    id: 'version-control',
    chapter: 'govern',
    title: 'Version the whole project, not just the schematic',
    summary: 'Every commit captures the complete multi-domain design state.',
    detail:
      'One content-addressed commit stores schematic, routed PCB, mechanical assembly, firmware and every other CAD domain together. Check out any commit to restore a consistent state, and branch when an alternative should not disturb the current design.',
    checklist: [
      'Commit a named milestone before a risky edit',
      'Keep one branch per alternative, review the diff before merging',
      'Treat workspace history as working storage, not a backup you have verified',
    ],
    mode: 'schematic',
    icon: History,
    target: 'version-history',
    placement: 'bottom',
  },
  {
    id: 'limits',
    chapter: 'govern',
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

export const ONBOARDING_CHAPTER_META: Readonly<Record<OnboardingChapterId, OnboardingChapter>> =
  Object.fromEntries(ONBOARDING_CHAPTERS.map((chapter) => [chapter.id, chapter])) as Record<
    OnboardingChapterId,
    OnboardingChapter
  >

/** Chapter that owns a step index, and the chapter's ordinal (1-based). */
export function chapterForStep(index: number): { chapter: OnboardingChapter; ordinal: number } {
  const step = ONBOARDING_STEPS[clampOnboardingStep(index)]
  const ordinal = ONBOARDING_CHAPTERS.findIndex((chapter) => chapter.id === step.chapter) + 1
  return { chapter: ONBOARDING_CHAPTER_META[step.chapter], ordinal }
}

/** Step indices that belong to a chapter, in tour order. */
export function chapterStepIndices(chapter: OnboardingChapterId): number[] {
  return ONBOARDING_STEPS.reduce<number[]>((indices, step, index) => {
    if (step.chapter === chapter) indices.push(index)
    return indices
  }, [])
}

/** Position of a step within its own chapter (1-based) and the chapter size. */
export function stepPositionInChapter(index: number): { position: number; size: number } {
  const clamped = clampOnboardingStep(index)
  const indices = chapterStepIndices(ONBOARDING_STEPS[clamped].chapter)
  return { position: indices.indexOf(clamped) + 1, size: indices.length }
}
