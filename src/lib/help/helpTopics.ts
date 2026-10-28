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
}

export const HELP_TOPICS = [
  // ── Editor rail ────────────────────────────────────────────────────────────
  {
    id: 'rail.select',
    group: 'rail',
    title: 'Select',
    description: 'Pick parts and wires, then edit or move what you selected.',
    keys: ['V'],
  },
  {
    id: 'rail.wire',
    group: 'rail',
    title: 'Wire',
    description: 'Click one pin, then the next: the sheet routes a segment between them.',
    keys: ['W'],
  },
  {
    id: 'rail.delete',
    group: 'rail',
    title: 'Delete',
    description: 'Click a part or a wire to remove it; undo brings it back as one action.',
    keys: ['D'],
  },
  {
    id: 'rail.grid',
    group: 'rail',
    title: 'Grid',
    description: 'Show or hide the sheet grid.',
    keys: ['G'],
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
    keys: ['F'],
  },
  {
    id: 'rail.save',
    group: 'rail',
    title: 'Save',
    description: 'Save this snapshot of the design to this device.',
    keys: ['Ctrl', 'S'],
  },
  {
    id: 'rail.undo',
    group: 'rail',
    title: 'Undo',
    description: 'Step back through the design edit history.',
    keys: ['Ctrl', 'Z'],
  },
  {
    id: 'rail.redo',
    group: 'rail',
    title: 'Redo',
    description: 'Step forward again through edits you undid.',
    keys: ['Ctrl', 'Shift', 'Z'],
  },
  {
    id: 'rail.demo',
    group: 'rail',
    title: 'Load demo rectifier',
    description: 'Put the tested six-part rectifier on the sheet so every analysis has a known design behind it.',
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
    description: 'Open the project manager to create, open or remove a project on this device.',
  },
  {
    id: 'header.library',
    group: 'header',
    title: 'Component library',
    description: 'Show or hide the schematic component library dock beside the sheet.',
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
    title: 'AI assistant',
    description: 'An agent using the same CAD tools you have, reading the result back as an image after each change.',
  },
  {
    id: 'header.admin',
    group: 'header',
    title: 'Administration',
    description: 'Members, roles and the usage ledger for this workspace.',
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
    description: 'Theme, units, autosave and replaying the guided tour.',
  },
  {
    id: 'header.plugins',
    group: 'header',
    title: 'Plugins',
    description: 'Review, install and manage permission-gated plugins.',
  },
  {
    id: 'header.collaboration',
    group: 'header',
    title: 'Collaboration',
    description: 'Share the project and review comments with collaborators.',
  },
  {
    id: 'header.security',
    group: 'header',
    title: 'Security alerts',
    description: 'Open the audit trail and security alerts for this workspace.',
  },
  {
    id: 'header.simulation',
    group: 'header',
    title: 'Simulation',
    description: 'Open the Simulation workspace from anywhere in the shell.',
  },
  {
    id: 'header.version-history',
    group: 'header',
    title: 'Version history',
    description: 'Commit and restore the whole multi-domain design state, stored on this device.',
  },
  {
    id: 'header.back',
    group: 'header',
    title: 'Back to projects',
    description: 'Close the open design and return to the project launcher.',
  },
  {
    id: 'header.sign-out',
    group: 'header',
    title: 'Sign out',
    description: 'Sign out of this device; local-only projects stay on it.',
  },
  {
    id: 'header.palette',
    group: 'header',
    title: 'Command palette',
    description: 'Search workspaces, demos and actions by name and run them without hunting the menus.',
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
    description: 'Reach the secondary header tools on a narrow window without hiding them.',
  },
  {
    id: 'header.voice',
    group: 'header',
    title: 'Voice control',
    description: 'Start or stop spoken commands.',
  },

  // ── Workspace navigation ───────────────────────────────────────────────────
  {
    id: 'nav.families',
    group: 'nav',
    title: 'Workspace families',
    description: 'Design, Electrical, Mechanical and Ops & AI. Pick a family, then a workspace tab.',
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

/** Keyboard bindings the shell really implements, for the shortcut sheet. */
export interface ShortcutRow {
  keys: readonly string[]
  action: string
  where: string
}

export const SHORTCUTS: readonly ShortcutRow[] = [
  { keys: ['F1'], action: 'Open help and tutorials', where: 'Workbench' },
  { keys: ['?'], action: 'Open help and tutorials', where: 'Workbench outside a text field' },
  { keys: ['Ctrl', 'K'], action: 'Command palette: workspaces, demos and actions', where: 'Workbench' },
  { keys: ['Ctrl', 'Shift', 'D'], action: 'Demo gallery', where: 'Workbench' },
  { keys: ['V'], action: 'Select tool', where: 'Schematic' },
  { keys: ['W'], action: 'Wire tool', where: 'Schematic' },
  { keys: ['D'], action: 'Delete tool', where: 'Schematic' },
  { keys: ['G'], action: 'Toggle the grid', where: 'Schematic' },
  { keys: ['F'], action: 'Fit the design to the view', where: 'Schematic' },
  { keys: ['Ctrl', 'Z'], action: 'Undo the last edit', where: 'Schematic' },
  { keys: ['Ctrl', 'Shift', 'Z'], action: 'Redo the undone edit', where: 'Schematic' },
  { keys: ['Ctrl', 'S'], action: 'Save the current snapshot', where: 'Schematic' },
  { keys: ['Esc'], action: 'Close the open dialog or guide', where: 'Workbench' },
  { keys: ['←', '→'], action: 'Previous or next guided-tour step', where: 'Guided tour' },
] as const
