import {
  Activity, CircuitBoard, Cpu, GitBranch, HelpCircle, History, Layers3, MousePointerClick, ScrollText,
  Shield, TrendingUp, type LucideIcon,
} from 'lucide-react'
import type { WorkspaceMode } from '../../stores/useAppStore'
import CopilotIcon from '../../components/workspace/CopilotIcon'

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
 *
 * Every step is written to be understood on first read: the title names the
 * thing the spotlight covers, and the body says what it does. No product
 * slogans.
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
 * The order walks one circuit from intent to release: orient, build it,
 * simulate it, lay it out, test the firmware, then protect the history.
 */
export const ONBOARDING_CHAPTERS: readonly OnboardingChapter[] = [
  {
    id: 'orientation',
    label: 'Orientation',
    promise: 'Find your way around the workbench.',
  },
  {
    id: 'capture',
    label: 'Capture',
    promise: 'Draw the circuit on the sheet.',
  },
  {
    id: 'prove',
    label: 'Prove it',
    promise: 'Simulate it and read the numbers.',
  },
  {
    id: 'physical',
    label: 'Make it physical',
    promise: 'Lay it out as a board.',
  },
  {
    id: 'connect',
    label: 'Connect it',
    promise: 'Flash it and test it against real hardware.',
  },
  {
    id: 'govern',
    label: 'Delegate & govern',
    promise: 'Keep history, and know what each answer is worth.',
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
    title: 'This is your workbench',
    summary: 'One project holds the schematic, the board, the firmware and the mechanical model.',
    detail:
      'Every domain — schematic, PCB, simulation, firmware, mechanical, robotics — works on the same project, in one file. Each domain checks its own work; nothing shares a hidden state. You can open an empty canvas and the validation is the same.',
    checklist: [
      'One project per design revision',
      'Keep requirements and units written down',
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
    title: 'This is the family strip',
    summary: 'Design, Electrical, Mechanical, Life systems and Operations — each tab opens its family’s workspaces.',
    detail:
      'The strip groups the 28 workspaces by discipline. Design holds schematic, simulation, PCB and fabrication. Electrical holds control, machines, RF, HDL and silicon. Mechanical holds CAD, robotics, firmware and imaging. Life systems holds reactions, tissue and whole-body models. Operations holds agents, parts, plugins and the marketplace. Hover a tab to see what it computes before you open it.',
    checklist: [
      'Hover a family tab before clicking it',
      'Skim the row of workspaces under each tab',
      'The Guide button lists what each workspace does and refuses to do',
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
    title: 'This is the Help button',
    summary: 'One-line answers on hover; F1 opens guides and tutorials.',
    detail:
      'Rest the pointer on any control in the rail, the header or a workspace tab and a short explanation appears — with its shortcut keycap. Press F1 or ? anywhere to open the help centre: tutorials that load a working demo and walk the real buttons, a guide per workspace, a control reference and the shortcut list. Tutorials check themselves; the workbench never watches your screen.',
    checklist: [
      'Hover the wire tool on the left rail',
      'Press F1 and open Tutorials',
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
    title: 'This is the component library',
    summary: 'Drag parts onto the sheet — that is how every circuit here starts.',
    detail:
      'Parts carry their models with them: a transistor drops in with a real part number behind it (2N3904 unless you change it), a diode with its reverse rating, a resistor with its power rating. Wire tool is click-to-click: arm it on the left rail, click a pin, click the next pin. Netlist extraction rebuilds connectivity from the wires you drew.',
    checklist: [
      'Drag a resistor onto the sheet',
      'Arm the wire tool and join two pins',
      'Use exact part numbers where you can',
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
    title: 'This is the tool rail',
    summary: 'Select (V), wire (W) and delete (D); grid (G), fit (F), snap — each button prints its key.',
    detail:
      'Three tools cover most edits: V for select, W for wire, D for delete. G toggles the grid, F fits the view to the design. Snap decides where parts land: on, they snap to the grid pitch the router can reason about; off, you place freely. Undo is on the rail and on Ctrl+Z.',
    checklist: [
      'Press W, click a pin, click the next pin',
      'Keep snap on while laying out',
      'Press Ctrl+Z if you dislike a wire',
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
    title: 'This is the simulator',
    summary: 'The solver runs the exact circuit drawn, with models you can inspect.',
    detail:
      'DC operating point uses modified nodal analysis. Transient, AC sweep, noise and Monte Carlo run on the same netlist you drew — nothing is re-invented for the run. Transistors we ship carry a built-in model (2N2222 family); other parts fall back to a generic model unless you drop a vendor card — the deck will say so. A clean number is not hardware certification — check limiting cases.',
    checklist: [
      'Use vendor models for critical active devices',
      'Simulate nominal plus a tolerance corner',
      'Compare against bench measurements',
    ],
    mode: 'schematic',
    icon: Activity,
  },
  {
    id: 'waveforms',
    chapter: 'prove',
    title: 'This is the waveform plot',
    summary: 'Drag to zoom, click to pin a cursor, read values off the solved samples.',
    detail:
      'Drag across a region to zoom it, shift-drag to pan, scroll to zoom under the pointer, click to drop a pinned cursor that reads a value at a solved sample — never one interpolated between samples. Plus, minus and arrow keys work when the chart has focus. A pinned cursor is the number that goes into the report.',
    checklist: [
      'Zoom the edge you care about',
      'Pin a cursor, do not eyeball the axis',
      'Check the stated model before quoting the curve',
    ],
    mode: 'simulation',
    icon: TrendingUp,
    target: 'workspace-canvas',
    handsOn: true,
  },
  {
    id: 'convert',
    chapter: 'physical',
    title: 'This is Schematic → PCB',
    summary: 'The sheet converts into a placed board — a draft, not approval.',
    detail:
      'Conversion places parts onto the board outline with footprints mapped and nets routed. Review the placement, the clearances and the copper before you order anything: DRC and ERC findings are the facts of the layout — read them as a manufacturing engineer would.',
    checklist: [
      'Check every symbol mapped to its footprint',
      'Resolve or waive every ERC and DRC finding',
      'Preview the Gerbers before a fab order',
    ],
    mode: 'convert',
    icon: GitBranch,
  },
  {
    id: 'mechanical',
    chapter: 'physical',
    title: 'This is the mechanical view',
    summary: 'Check fit, clearance and envelope in 3D — geometry is not the same as physics.',
    detail:
      'Inspect the board outline, connector access and component heights in the 3-D view. Mechanical and PCB data can only be combined when the coordinate systems and the exported assembly agree with the target toolchain.',
    checklist: [
      'Confirm units and origin',
      'Check connector access and heights',
      'Export and re-open geometry in the target CAD',
    ],
    mode: 'mechanical',
    icon: Cpu,
    target: 'workspace-canvas',
    handsOn: true,
  },
  {
    id: 'evidence',
    chapter: 'connect',
    title: 'This is the HIL workspace',
    summary: 'Flash the firmware onto the real board and test it against the hardware.',
    detail:
      'HIL runs the firmware against the actual board: current limits, fixtures, calibration and a defined test session. Real hardware needs a supported toolchain, the right interface and safe limits. A digital twin adds live signals and a validated physical model on top.',
    checklist: [
      'Select the actual board and toolchain',
      'Use current-limited supplies and fixtures',
      'Version firmware, calibration and schemas together',
    ],
    mode: 'hil',
    icon: Shield,
  },
  {
    id: 'agent',
    chapter: 'connect',
    title: 'Meet Copilot',
    summary: 'Copilot, Folio\'s copilot, observes the sheet then re-reads its own work.',
    detail:
      'Copilot watches the sheet or board, proposes a change with reasons you can check, applies it with the same tools you have, then re-reads the result. Numbers it reports are measured or simulated, never invented, and it says which. Runs stay in this workspace; a configured cloud model is labelled and needs your credentials. Review every edit it makes.',
    checklist: [
      'Give it the goal and the constraints, plainly',
      'Demand the re-read after every change',
      'Review the diff before keeping a change',
    ],
    mode: 'agents',
    icon: CopilotIcon as LucideIcon,
    target: 'agent-button',
    fallbackTarget: 'workspace-canvas',
    placement: 'bottom',
  },
  {
    id: 'version-control',
    chapter: 'govern',
    title: 'This is version history',
    summary: 'Commits snapshot the whole multi-domain project.',
    detail:
      'One commit stores schematic, routed PCB, mechanical assembly, firmware and the rest together, on one branch. Check out any commit to restore a consistent state; make a branch when an alternative should not disturb the current design.',
    checklist: [
      'Commit before a risky edit',
      'Branch per alternative; review the diff',
      'History is working storage, not a verified backup',
    ],
    mode: 'schematic',
    icon: History,
    target: 'version-history',
    placement: 'bottom',
  },
  {
    id: 'limits',
    chapter: 'govern',
    title: 'This is the limits registry',
    summary: 'Every analysis lists its method, its tests and what it does not model.',
    detail:
      'The LIMITS button opens the registry: the method behind each number (LU on the MNA matrix, Newton–Raphson, damped least-squares IK, Lee/A* routing), the test file that pins it, and the list of what is not modelled. It is deliberately blunt; read it before a number goes into a report.',
    checklist: [
      'Read the Not covered block first',
      'Filter by the workspace you are in',
      'Open the test file named on the row when it matters',
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
