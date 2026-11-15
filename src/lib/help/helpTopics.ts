/**
 * What every chrome control does, in one sentence.
 *
 * Written as data for three consumers that must agree: the hover help on the
 * control itself, the control reference in the help center, and the tests that
 * keep the copy honest. A description states what the control does on screen —
 * it never promises a result the control cannot produce.
 */
export type HelpControlGroup = 'rail' | 'header' | 'nav'

export interface HelpTopic {
  id: string
  group: HelpControlGroup
  title: string
  /** One sentence: what the control does, in the engineer's terms. */
  description: string
  /** Keys that do the same thing, printed as keycaps. */
  keys?: readonly string[]
  /**
   * Registry binding shown instead of `keys`, so a rebind updates the hover
   * help, the control reference and the handler from one place.
   */
  shortcutId?: string
}

export const HELP_TOPICS = [
  // ── Editor rail ────────────────────────────────────────────────────────────
  {
    id: 'rail.select',
    group: 'rail',
    title: 'Select',
    description: 'Pick parts and wires: a wire selects its whole net and lights every segment and pin it reaches.',
    shortcutId: 'schematic.selectTool',
  },
  {
    id: 'rail.wire',
    group: 'rail',
    title: 'Wire',
    description: 'Click one pin, then the next: the sheet routes a segment between them.',
    shortcutId: 'schematic.wireTool',
  },
  {
    id: 'rail.delete',
    group: 'rail',
    title: 'Delete',
    description: 'Click a part or a wire to remove it; undo brings it back as one action.',
    shortcutId: 'schematic.deleteTool',
  },
  {
    id: 'rail.sketch',
    group: 'rail',
    title: 'Sketch',
    description: 'Draw wires and symbols freehand; the recogniser turns them into parts and nets.',
    shortcutId: 'schematic.sketchTool',
  },
  {
    id: 'rail.grid',
    group: 'rail',
    title: 'Grid',
    description: 'Show or hide the sheet grid.',
    shortcutId: 'schematic.grid',
  },
  {
    id: 'rail.snap',
    group: 'rail',
    title: 'Snap to grid',
    description: 'Land parts and wires on the grid pitch so the netlist and router read clean coordinates.',
  },
  {
    id: 'rail.rulers',
    group: 'rail',
    title: 'Rulers',
    description: 'Show rulers along the sheet edges for spacing and board outlines.',
  },
  {
    id: 'rail.zoom-in',
    group: 'rail',
    title: 'Zoom in',
    description: 'Zoom the sheet one step; scroll or pinch zooms under the pointer instead.',
  },
  {
    id: 'rail.zoom-out',
    group: 'rail',
    title: 'Zoom out',
    description: 'Zoom the sheet one step out.',
  },
  {
    id: 'rail.fit',
    group: 'rail',
    title: 'Fit to view',
    description: 'Fit the whole design into the viewport.',
    shortcutId: 'schematic.fit',
  },
  {
    id: 'rail.tidy',
    group: 'rail',
    title: 'Tidy arrange',
    description:
      'Straighten the sheet: parts step onto the grid in signal-flow columns and wires re-route as clean orthogonal runs. Nets, connections and values are untouched, so the circuit does not change.',
    shortcutId: 'schematic.tidy',
  },
  {
    id: 'rail.save',
    group: 'rail',
    title: 'Save',
    description: 'Save this snapshot of the design to the workspace.',
    shortcutId: 'schematic.save',
  },
  {
    id: 'rail.undo',
    group: 'rail',
    title: 'Undo',
    description: 'Step back through the design edit history.',
    shortcutId: 'schematic.undo',
  },
  {
    id: 'rail.redo',
    group: 'rail',
    title: 'Redo',
    description: 'Step forward again through edits you undid.',
    shortcutId: 'schematic.redo',
  },
  {
    id: 'rail.demo',
    group: 'rail',
    title: 'Load demo rectifier',
    description: 'Put the tested six-part rectifier on the sheet so every analysis has a known design behind it.',
  },
  {
    id: 'rail.problems',
    group: 'rail',
    title: 'Design health',
    description:
      'Show the findings panel. The rule check after every edit lists unconnected pins, floating inputs, driver conflicts and power-to-ground shorts; press F8 to step through them.',
    shortcutId: 'schematic.problems',
  },
  {
    id: 'rail.simulation',
    group: 'rail',
    title: 'Open simulation',
    description: 'Leave the sheet and open the Simulation workspace on this design.',
  },

  // ── Application header ─────────────────────────────────────────────────────
  {
    id: 'header.projects',
    group: 'header',
    title: 'Projects',
    description: 'Open the project manager to create, open or remove a project in the workspace.',
  },
  {
    id: 'header.library',
    group: 'header',
    title: 'Library dock',
    description: 'Show or hide the dock beside the workspace. It holds the parts that domain places: symbols, ISO parts, transfer functions, code. Workspaces that design nothing have no dock.',
  },
  {
    id: 'header.notifications',
    group: 'header',
    title: 'Notifications',
    description: 'Agent verdicts, export outcomes and community previews from this device, gathered in one place. Local to your browser; nothing is sent anywhere.',
  },
  {
    id: 'header.help',
    group: 'header',
    title: 'Help and tutorials',
    description: 'Workspace guides, hands-on tutorials, the control reference and the shortcut sheet.',
    keys: ['F1'],
  },
  {
    id: 'header.assistant',
    group: 'header',
    title: 'Scribe',
    description: 'Folio\'s scribe: ask the sheet a question or order a change. Scribe answers with evidence from the sheet — parts, nets, checks, dimensions — or states plainly that it cannot. Rule checks and the solver remain the arbiters.',
  },
  {
    id: 'header.theme',
    group: 'header',
    title: 'Theme',
    description: 'Switch between the light and dark theme.',
  },
  {
    id: 'header.settings',
    group: 'header',
    title: 'Settings',
    description: 'Open the preference pages: theme, canvas grid, 3D shading, editor and autosave. Changes apply at once.',
    shortcutId: 'settings.open',
  },
  {
    id: 'header.console',
    group: 'header',
    title: 'Account console',
    description: 'Your account: who you are, what this device recorded, your plan and limits, and a download of your local data. Opens the console — a separate page from the CAD.',
  },
  {
    id: 'header.plugins',
    group: 'header',
    title: 'Plugins',
    description: 'Review, install and manage permission-gated plugins. In the More tools menu.',
  },
  {
    id: 'header.collaboration',
    group: 'header',
    title: 'Collaboration',
    description: 'Share the project and review comments with collaborators. In the More tools menu.',
  },
  {
    id: 'header.security',
    group: 'header',
    title: 'Security alerts',
    description:
      'The audit trail and security alerts for this workspace, in the More tools menu. Active alerts also raise a red count in the status bar.',
  },
  {
    id: 'header.simulation',
    group: 'header',
    title: 'Simulation',
    description: 'Open the Simulation workspace — from its tab in the workspace navigation, or from the More tools menu.',
  },
  {
    id: 'header.version-history',
    group: 'header',
    title: 'Version history',
    description: 'Commit and restore the whole multi-domain design state, stored with the project.',
  },
  {
    id: 'header.back',
    group: 'header',
    title: 'Back to projects',
    description: 'Close the open design and return to the project launcher. The Projects button at the left does the same.',
  },
  {
    id: 'header.sign-out',
    group: 'header',
    title: 'Sign out',
    description: 'End the session; projects remain in the workspace. In the More tools menu.',
  },
  {
    id: 'header.palette',
    group: 'header',
    title: 'Command palette',
    description: 'Jump to a part or net by name, or search workspaces, demos and actions. Picking a part opens the sheet and centres it.',
    keys: ['Ctrl', 'K'],
  },
  {
    id: 'header.export',
    group: 'header',
    title: 'Export',
    description: 'Write the design out as an image, drawing, netlist, JSON, Gerber or bill of materials.',
  },
  {
    id: 'header.more',
    group: 'header',
    title: 'More tools',
    description:
      'The overflow menu, at every window width: voice control, the simulation and security-alert workspaces, collaboration, plugins, and the way back to the launcher.',
  },
  {
    id: 'header.voice',
    group: 'header',
    title: 'Voice conversation',
    description:
      'Start or stop the spoken conversation from the More tools menu. Dictate commands such as “place a resistor” or “connect R1 to D1”, hear the reply, or type in the panel instead.',
  },

  // ── Workspace navigation ───────────────────────────────────────────────────
  {
    id: 'nav.families',
    group: 'nav',
    title: 'Workspace families',
    description: 'Design, Electrical, Mechanical and Operations. Pick a family, then a workspace tab.',
  },
  {
    id: 'nav.tabs',
    group: 'nav',
    title: 'Workspace tabs',
    description: 'Each tab is a domain with its own model, checks and limits; switching does not couple their physics.',
  },
  {
    id: 'nav.demos',
    group: 'nav',
    title: 'Demo gallery',
    description: 'One tested scenario per workspace: load it, then change it and watch the result.',
    keys: ['Ctrl', 'Shift', 'D'],
  },
  {
    id: 'nav.guide',
    group: 'nav',
    title: 'Workspace guide',
    description: 'Open the help center on the workspace you are looking at.',
  },
  {
    id: 'nav.limits',
    group: 'nav',
    title: 'Capabilities and limits',
    description: 'For every result: the method, the tests that pin it, and what it refuses to model.',
  },
] as const satisfies readonly HelpTopic[]

export type HelpTopicId = (typeof HELP_TOPICS)[number]['id']

const TOPIC_BY_ID = new Map<string, HelpTopic>(HELP_TOPICS.map((topic) => [topic.id, topic]))

export function getHelpTopic(id: string): HelpTopic | undefined {
  return TOPIC_BY_ID.get(id)
}

export const HELP_TOPICS_BY_GROUP: Readonly<Record<HelpControlGroup, readonly HelpTopic[]>> = {
  rail: HELP_TOPICS.filter((topic) => topic.group === 'rail'),
  header: HELP_TOPICS.filter((topic) => topic.group === 'header'),
  nav: HELP_TOPICS.filter((topic) => topic.group === 'nav'),
}
