/**
 * Hands-on tutorials for the multi-domain workbench.
 *
 * Each tutorial starts from a tested demo scenario and walks through real
 * workspaces in the order an engineer would use them. Steps are deliberately
 * phrased as "do this, then look at that": the runner switches the workspace,
 * but it never claims to grade the work. `do`/`see` text must stay true to the
 * controls that exist, and a test keeps every `demoId` and `mode` real.
 */
import type { WorkspaceMode } from '../../stores/useAppStore'

export interface TutorialStep {
  title: string
  /** The action to take, in the engineer's terms. */
  do: string
  /** What to read on screen afterwards, including honest caveats. */
  see: string
  /** Workspace the runner opens for this step. */
  mode: WorkspaceMode
}

export interface Tutorial {
  id: string
  title: string
  summary: string
  /** Id of a `DEMO_SCENARIOS` entry that supplies the starting design. */
  demoId: string
  /** Workspaces the tutorial visits, in first-visit order. */
  modes: readonly WorkspaceMode[]
  /** Rough reading time, including one run per step. */
  minutes: number
  steps: readonly TutorialStep[]
}

export const TUTORIALS: readonly Tutorial[] = [
  {
    id: 'rectifier-end-to-end',
    title: 'Rectifier: schematic to a routed board',
    summary: 'Start from the tested six-part rectifier, measure its ripple, change the filter, then convert, route, inspect in 3D and price the board.',
    demoId: 'rectifier-schematic',
    modes: ['schematic', 'simulation', 'convert', 'pcb', 'preview3d', 'bom'],
    minutes: 15,
    steps: [
      {
        title: 'Read the sheet before touching it',
        do: 'Find V1, RSRC, D1, C1 and RLOAD on the sheet, and follow the OUT rail from the diode to the capacitor and the load.',
        see: 'Six parts and four nets — SRC, MID, OUT and GND. D1 sits between MID and OUT, so the load only sees the forward half cycle.',
        mode: 'schematic',
      },
      {
        title: 'Measure the ripple you start with',
        do: 'Open Simulation, keep Analysis type on Transient and press Run simulation.',
        see: 'The scope shows SRC and OUT. OUT pulses at 1 kHz and peaks below the 6 V source because the diode and RSRC drop voltage; the filter is small, so the ripple is large.',
        mode: 'simulation',
      },
      {
        title: 'Change one value and measure again',
        do: 'Return to Schematic, select C1, open Properties and set its value to 100uF. Then run the transient again.',
        see: 'OUT now sits higher between pulses and the ripple is visibly smaller. SRC is unchanged, which is the control in this experiment.',
        mode: 'simulation',
      },
      {
        title: 'Convert the netlist to a board',
        do: 'Open Sch → PCB and press Convert to PCB.',
        see: 'Six footprints, a board outline and a ratsnest that connects the same four nets. Nothing new is invented by the conversion.',
        mode: 'convert',
      },
      {
        title: 'Check the rules, then route',
        do: 'Open PCB, press Run DRC, then press Auto-Route from Schematic.',
        see: 'The DRC summary names each rule it checked and whether it passed; routed copper follows the ratsnest. A clean report is scoped to the rules checked, not to manufacturability in general.',
        mode: 'pcb',
      },
      {
        title: 'Inspect the physical board',
        do: 'Open 3D / AR and orbit the board.',
        see: 'The routed board with part bodies. The outline and copper come from the PCB you just checked, not from a separate model.',
        mode: 'preview3d',
      },
      {
        title: 'Price it and check lifecycle',
        do: 'Open BOM and read the lifecycle column.',
        see: 'Six line items with quantities and costs. Parts with no declared lifecycle say so instead of guessing one.',
        mode: 'bom',
      },
    ],
  },
  {
    id: 'control-pid',
    title: 'PID: tune a motor loop and understand the trade',
    summary: 'Read the loaded motor loop, tune it by rules of thumb and by search, apply the gains, and check what the linear margins do and do not cover.',
    demoId: 'control-motor-loop',
    modes: ['control'],
    minutes: 12,
    steps: [
      {
        title: 'Read the loop before tuning it',
        do: 'Find the plant numerator and denominator, then read the step-response, Bode and margin cards.',
        see: 'The response and Bode curves are computed from the coefficients on screen. A margin card shows a number or states that the margin is not defined for this loop.',
        mode: 'control',
      },
      {
        title: 'Get a first set of gains',
        do: 'Open the tuning toolbox and run Rules of thumb.',
        see: 'It fits a first-order-plus-delay model from a simulated step test and proposes gains. If the plant never plateaus it declines and names a route that does apply.',
        mode: 'control',
      },
      {
        title: 'Apply and read the consequence',
        do: 'Press Apply to the loop above, then read Overshoot, Phase margin and Gain margin.',
        see: 'The cards and traces update with the applied gains. Read the numbers together; a fast rise with a thin margin is a trade, not a free win.',
        mode: 'control',
      },
      {
        title: 'Push the proportional gain',
        do: 'Double Kp and watch the step response and margins.',
        see: 'Rise time usually shortens while overshoot and ringing grow. This is the linear model responding; the actuator is not limited in it.',
        mode: 'control',
      },
      {
        title: 'Check the loop you will actually run',
        do: 'Run Sampled loop check.',
        see: 'A discrete PID with a filtered derivative and an actuator limit is simulated. Saturation and windup are outside the linear model, so this trace can differ from the step response.',
        mode: 'control',
      },
      {
        title: 'Try a search and read its scope',
        do: 'Run Heuristic search or Surrogate (GP) and compare the reported cost with your hand-tuned loop.',
        see: 'Every candidate is simulated against the cost you chose. The result is the best candidate the search evaluated — not a proof of global optimality.',
        mode: 'control',
      },
    ],
  },
  {
    id: 'rf-filter',
    title: 'RF: synthesize a filter, then an antenna',
    summary: 'Design a low-pass ladder at 1 GHz, read the ideal-circuit metrics, change the order, then inspect an antenna pattern and its model basis.',
    demoId: 'rf-filter',
    modes: ['rf'],
    minutes: 10,
    steps: [
      {
        title: 'Synthesize the ladder',
        do: 'Open the Filters tab, choose Low-pass, set the design frequency to 1000 MHz, order 3 and a 50 Ω termination.',
        see: 'A synthesized L/C ladder with component values, plus gain and return-loss metrics at the design point.',
        mode: 'rf',
      },
      {
        title: 'Read the passband honestly',
        do: 'Find the passband and input/output return-loss readouts.',
        see: 'These come from the ideal ladder equations. They do not include component loss, parasitics or board effects.',
        mode: 'rf',
      },
      {
        title: 'Change the order and compare',
        do: 'Raise the order to 5 and watch the ladder and metrics.',
        see: 'Two more reactive elements and a steeper transition. The passband metrics move with the synthesis, so this is a comparison of two ideal designs.',
        mode: 'rf',
      },
      {
        title: 'Look at a radiating structure',
        do: 'Switch to Antennas, keep the 2.4 GHz dipole and read the pattern.',
        see: 'Peak gain and beamwidth are integrated from the modelled far field; feed resistance is stated. The pattern is a model, not a measurement.',
        mode: 'rf',
      },
      {
        title: 'Read what the model leaves out',
        do: 'Open the Model basis card under the result.',
        see: 'It names the pattern model and what is not modelled, such as reactive feed terms or bandwidth. Treat that text as part of the result.',
        mode: 'rf',
      },
    ],
  },
  {
    id: 'robotics-two-link',
    title: 'Robotics: kinematics, dynamics and a planned path',
    summary: 'Load a two-link arm, solve forward and inverse kinematics, compute dynamics and replay a planned trajectory with collision checks.',
    demoId: 'robotics-two-link',
    modes: ['robotics'],
    minutes: 10,
    steps: [
      {
        title: 'Load the arm',
        do: 'Press Load 2-link demo (FK + STEP).',
        see: 'Link lengths and joint angles appear in the results, and the STEP export becomes available.',
        mode: 'robotics',
      },
      {
        title: 'Solve forward kinematics',
        do: 'Read the Forward Kinematics result for the demo pose.',
        see: 'End-effector X, Y and Z for the joint angles shown. Change an angle and the position must move with it.',
        mode: 'robotics',
      },
      {
        title: 'Ask for a reachable pose',
        do: 'Set Target X/Y/Z inside the reach and press Inverse Kinematics.',
        see: 'Joint angles plus the residual. If the target is unreachable, the panel says so instead of returning a plausible-looking answer.',
        mode: 'robotics',
      },
      {
        title: 'Compute dynamics and plan',
        do: 'Press Compute Dynamics, then Plan Trajectory.',
        see: 'Joint torques for the pose and a list of waypoints. Collisions and smoothness are reported for the planned path.',
        mode: 'robotics',
      },
      {
        title: 'Replay the plan',
        do: 'Press Run Simulation.',
        see: 'The arm follows the trajectory. The result list reports collisions, waypoints and smoothness for that replay.',
        mode: 'robotics',
      },
    ],
  },
  {
    id: 'mechanical-enclosure',
    title: 'Mechanical: size an enclosure and run the checks',
    summary: 'Load the rectifier enclosure, run static, thermal, modal and fatigue analyses, then export a STEP assembly and a dimensioned drawing.',
    demoId: 'mechanical-enclosure',
    modes: ['mechanical'],
    minutes: 12,
    steps: [
      {
        title: 'Load the enclosure',
        do: 'Press Load rectifier enclosure.',
        see: 'Enclosure parts appear in the tree, and the verdict text states whether the board fits the cavity.',
        mode: 'mechanical',
      },
      {
        title: 'Run a static case',
        do: 'Choose Static Structural and press Run Analysis.',
        see: 'Stress, deflection and safety factor for the loaded case. The numbers belong to the selected part and load case, not to every part at once.',
        mode: 'mechanical',
      },
      {
        title: 'Run the thermal case',
        do: 'Switch to Thermal Analysis and run again.',
        see: 'Thermal resistance and temperature rise from the thin-fin balance. It is a lumped thermal estimate, not a CFD field solve.',
        mode: 'mechanical',
      },
      {
        title: 'Check modes and fatigue',
        do: 'Switch to Modal Analysis, run it, then switch to Fatigue Analysis and run that.',
        see: 'Mode frequencies and a fatigue life for the inspected part. Read the load assumptions the panel states with each result.',
        mode: 'mechanical',
      },
      {
        title: 'Export the deliverables',
        do: 'Press Export Assembly STEP, then Export Part Drawing (SVG).',
        see: 'Both files download. The drawing carries dimensions and a title block rather than a screenshot of the viewport.',
        mode: 'mechanical',
      },
    ],
  },
  {
    id: 'hdl-fpga',
    title: 'Logic: simulate RTL, elaborate for FPGA, then silicon',
    summary: 'Start from a half adder, simulate all input pairs, estimate FPGA resources, and see how far the SKY130 flow gets with the same RTL.',
    demoId: 'hdl-half-adder',
    modes: ['hdl', 'fpga', 'icdesign'],
    minutes: 10,
    steps: [
      {
        title: 'Read the module',
        do: 'Open HDL/RTL and read the half-adder module.',
        see: 'A sum and a carry driven by XOR and AND. This is the design every later result is computed from.',
        mode: 'hdl',
      },
      {
        title: 'Simulate every input pair',
        do: 'Elaborate and simulate the design with a=0,1 and b=0,1.',
        see: 'The waveform shows sum as XOR and carry as AND. Unknown or un-driven values are reported rather than silently treated as zero.',
        mode: 'hdl',
      },
      {
        title: 'Elaborate for an FPGA',
        do: 'Open FPGA and elaborate the same design.',
        see: 'A resource estimate (LUTs and flip-flops) and a design manifest. The estimate is for the supported RTL subset, not a place-and-route run.',
        mode: 'fpga',
      },
      {
        title: 'Push it through the SKY130 flow',
        do: 'Open IC Design and run the flow on the half adder.',
        see: 'Synthesis, floorplan and package stages report what succeeded. A failed stage names itself and its input rather than returning a green summary.',
        mode: 'icdesign',
      },
      {
        title: 'Read the supported subset',
        do: 'Open the capability record for HDL, FPGA and silicon from Capabilities and limits.',
        see: 'It names the method, the tests that pin it, and the RTL constructs the flow does not synthesize.',
        mode: 'icdesign',
      },
    ],
  },
  {
    id: 'agents-verifier',
    title: 'Agents: let the autopilot work, then verify the claim',
    summary: 'Read the tool surface, run the autopilot on the rectifier, verify a claim symbolically, and see the assistant edit the live sheet.',
    demoId: 'agents-verifier',
    modes: ['agents'],
    minutes: 10,
    steps: [
      {
        title: 'Read the tools before running them',
        do: 'Open Agents and read the tool catalog.',
        see: 'Every tool the agent may call, with its arguments. The agent has the same CAD surface as the workbench, not a separate mock.',
        mode: 'agents',
      },
      {
        title: 'Run the autopilot',
        do: 'Start the autopilot on the rectifier demo.',
        see: 'Each step names the tool it called and the result it read back. A failed step stops the run instead of being reported as success.',
        mode: 'agents',
      },
      {
        title: 'Check a claim symbolically',
        do: 'Open the symbolic verifier and verify a design claim.',
        see: 'A verdict with the scope it checked. The verifier proves what the symbolic model contains; it does not replace simulation or measurement.',
        mode: 'agents',
      },
      {
        title: 'Let the assistant edit the sheet',
        do: 'Ask the assistant for a small change to the design.',
        see: 'The change lands on the live sheet, and the returned image shows the result the agent observed.',
        mode: 'agents',
      },
      {
        title: 'Read the agent capability record',
        do: 'Open Capabilities and limits and find the agents record.',
        see: 'The method, the tests that pin it, and what the verifier and autopilot do not cover.',
        mode: 'agents',
      },
    ],
  },
] as const

const TUTORIAL_BY_ID = new Map(TUTORIALS.map((tutorial) => [tutorial.id, tutorial]))

export function getTutorial(id: string): Tutorial | undefined {
  return TUTORIAL_BY_ID.get(id)
}

export interface TutorialProgress {
  /** Zero-based step the engineer stopped on. */
  step: number
  completed: boolean
  /** ISO timestamp of the last write, so the help center can show recency. */
  updatedAt: string
}

const PROGRESS_PREFIX = 'folio.tutorial.'

type ProgressStorage = Pick<Storage, 'getItem' | 'setItem'>

function defaultStorage(): ProgressStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    // Storage can throw when the browser blocks site data; progress is optional.
    return null
  }
}

export function readTutorialProgress(id: string, storage: ProgressStorage | null = defaultStorage()): TutorialProgress | null {
  if (!storage) return null
  try {
    const raw = storage.getItem(`${PROGRESS_PREFIX}${id}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<TutorialProgress>
    if (typeof candidate.step !== 'number' || !Number.isFinite(candidate.step)) return null
    if (typeof candidate.completed !== 'boolean') return null
    return {
      step: Math.max(0, Math.floor(candidate.step)),
      completed: candidate.completed,
      updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : '',
    }
  } catch {
    return null
  }
}

export function writeTutorialProgress(
  id: string,
  progress: TutorialProgress,
  storage: ProgressStorage | null = defaultStorage(),
): void {
  if (!storage) return
  try {
    storage.setItem(`${PROGRESS_PREFIX}${id}`, JSON.stringify(progress))
  } catch {
    // A full or blocked store must not break the tutorial the engineer is in.
  }
}

/** Human-readable resume line for the help center; null when nothing was saved. */
export function describeTutorialProgress(tutorial: Tutorial, progress: TutorialProgress | null): string | null {
  if (!progress) return null
  const total = tutorial.steps.length
  if (progress.completed) return 'Completed'
  const step = Math.min(Math.max(progress.step, 0), total - 1) + 1
  return step <= 1 ? 'Not started' : `Resume at step ${step} of ${total}`
}
