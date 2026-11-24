import { normalizeThemePreference } from '../theme/themeController'
import { SHADING_MODES } from '../3d/outline'
import { SHADING_UI } from '../3d/shadingLabels'
import type { AppSettings } from '../../stores/useAppStore'

/**
 * The settings registry.
 *
 * One description of every preference: what it is called, what it actually does,
 * what control edits it, and the range a value may have. The settings page is
 * generated from this list, the store clamps writes through it, and the reset
 * buttons read their defaults from it — so a preference cannot be documented in
 * one place and behaved differently in another.
 *
 * The rule the list is held to: no entry without a consumer. A toggle that
 * changes a number nobody reads is worse than no toggle, because it teaches the
 * user that settings here are decorative.
 */

export type SettingCategory =
  | 'general'
  | 'drafting'
  | 'board'
  | 'simulation'
  | 'viewport'
  | 'editor'
  | 'output'
  | 'saving'

export interface CategoryDescriptor {
  id: SettingCategory
  title: string
  /** One line under the section heading; says what the group is for. */
  blurb: string
}

export const SETTING_CATEGORIES: readonly CategoryDescriptor[] = [
  { id: 'general', title: 'General', blurb: 'How the interface looks and moves.' },
  { id: 'drafting', title: 'Drafting canvas', blurb: 'Grid, snapping and edit history on the schematic and board sheets.' },
  { id: 'board', title: 'Board rules', blurb: 'The copper geometry the autorouter draws and the checker enforces.' },
  { id: 'simulation', title: 'Simulation', blurb: 'What a SPICE run starts with before you change it on the panel.' },
  { id: 'viewport', title: '3D viewport', blurb: 'How a model is shaded, lit and scaled when it is drawn.' },
  { id: 'editor', title: 'Code editor', blurb: 'Typography and typing aids in the deck, firmware and HDL buffers.' },
  { id: 'output', title: 'Export & drawing', blurb: 'What a file looks like once it leaves this app.' },
  { id: 'saving', title: 'Saving', blurb: 'How often work is written to this browser.' },
]

export interface SelectOption {
  value: string | number
  label: string
  hint?: string
}

export type SettingControl =
  | { kind: 'toggle' }
  | { kind: 'theme' }
  | { kind: 'select'; options: readonly SelectOption[] }
  | { kind: 'slider'; min: number; max: number; step: number; format: (value: number) => string }
  | { kind: 'number'; min: number; max: number; step: number; unit?: string }

export interface SettingDefinition<Key extends keyof AppSettings = keyof AppSettings> {
  key: Key
  category: SettingCategory
  title: string
  /** What changes when it is set — not a restatement of the title. */
  description: string
  control: SettingControl
  /** Extra words that should find this row in the search box. */
  keywords?: readonly string[]
  /** Where the same choice is reachable without opening Settings. */
  alsoIn?: string
  /** Row is disabled while that other setting is off — a dead interval should not look editable. */
  dependsOn?: keyof AppSettings
}

const px = (value: number) => `${value} px`
const times = (value: number) => `${value.toFixed(1)}\u00d7`

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  {
    key: 'theme',
    category: 'general',
    title: 'Theme',
    description: 'Colour scheme for the whole environment. System follows the operating system.',
    control: { kind: 'theme' },
    keywords: ['dark', 'light', 'contrast', 'colour', 'color', 'appearance'],
    alsoIn: 'the quick light/dark switch in the title bar',
  },
  {
    key: 'animations',
    category: 'general',
    title: 'Interface animations',
    description: 'Transitions and motion in panels and overlays. Off suppresses them, as prefers-reduced-motion does.',
    control: { kind: 'toggle' },
    keywords: ['motion', 'transition', 'reduce motion'],
  },
  {
    key: 'ambientLight',
    category: 'general',
    title: 'Ambient light field',
    description:
      'Drifting colour behind the shell, in the hue of the open workspace family. Bands are theme hues held within a bounded brightness of the background, so no text loses contrast; off makes every bar solid again.',
    control: { kind: 'toggle' },
    keywords: ['aurora', 'glow', 'shader', 'vfx', 'background', 'blur'],
  },
  {
    key: 'gridSize',
    category: 'drafting',
    title: 'Grid pitch',
    description: 'Spacing of the sheet grid in canvas units, and the step the cursor moves when snapping is on.',
    control: { kind: 'number', min: 1, max: 100, step: 1 },
    keywords: ['spacing', 'pitch', 'units'],
    alsoIn: 'the status bar readout',
  },
  {
    key: 'snapToGrid',
    category: 'drafting',
    title: 'Snap to grid',
    description: 'Place and route on grid multiples instead of free pixels.',
    control: { kind: 'toggle' },
    keywords: ['align', 'magnetic'],
    alsoIn: 'the left tool rail',
  },
  {
    key: 'showGrid',
    category: 'drafting',
    title: 'Show grid',
    description: 'Draw the grid on the schematic canvas. Turning it off does not turn off snapping.',
    control: { kind: 'toggle' },
    keywords: ['background', 'dots'],
    alsoIn: 'the left tool rail',
  },
  {
    key: 'showRulers',
    category: 'drafting',
    title: 'Show rulers',
    description: 'Coordinate rulers along the sheet edges, with the inset they cost taken off the drawing area.',
    control: { kind: 'toggle' },
    keywords: ['measure', 'scale', 'axis'],
    alsoIn: 'the left tool rail',
  },
  {
    key: 'showNetLabels',
    category: 'drafting',
    title: 'Net names on the sheet',
    description:
      'Name every named net where its copper runs. Labels avoid parts, wires and each other, and clicking one selects the whole net.',
    control: { kind: 'toggle' },
    keywords: ['net', 'label', 'name', 'annotation', 'connectivity'],
    alsoIn: 'the schematic sheet',
  },
  {
    key: 'historyDepth',
    category: 'drafting',
    title: 'Undo history',
    description: 'Edit states kept per design. Long routing sessions outgrow a small number, and each state is a whole sheet of memory.',
    control: { kind: 'slider', min: 20, max: 500, step: 10, format: (v) => `${v} states` },
    keywords: ['undo', 'redo', 'history'],
  },
  {
    key: 'boardTraceWidthMm',
    category: 'board',
    title: 'Trace width',
    description: 'Copper width a net that names no class of its own is routed at, and the width a Gerber wire is stroked at. The board panel can route a specific board tighter than this.',
    control: { kind: 'number', min: 0.1, max: 1, step: 0.05, unit: 'mm' },
    keywords: ['track', 'copper', 'routing', 'width', 'mil'],
    alsoIn: 'the board\u2019s net classes',
  },
  {
    key: 'boardClearanceMm',
    category: 'board',
    title: 'Clearance',
    description: 'Copper-to-copper gap the router keeps. It also sets the routing grid, so asking for a tight gap buys a fine grid.',
    control: { kind: 'number', min: 0.05, max: 1, step: 0.05, unit: 'mm' },
    keywords: ['spacing', 'drc', 'creepage', 'gap'],
    alsoIn: 'the design rule card in the board panel',
  },
  {
    key: 'boardViaDrillMm',
    category: 'board',
    title: 'Via drill',
    description: 'Finished hole diameter of a signal via the router drops. Below 0.3 mm most prototype fabs charge for a smaller drill.',
    control: { kind: 'number', min: 0.15, max: 1, step: 0.05, unit: 'mm' },
    keywords: ['hole', 'drill', 'via', 'plated'],
  },
  {
    key: 'boardViaPadMm',
    category: 'board',
    title: 'Via pad',
    description: 'Pad ring built around that drill. The annular ring is half the difference between this and the drill.',
    control: { kind: 'number', min: 0.4, max: 2, step: 0.05, unit: 'mm' },
    keywords: ['land', 'pad', 'annular', 'via'],
  },
  {
    key: 'simTemperatureC',
    category: 'simulation',
    title: 'Run temperature',
    description: 'Junction temperature a run uses when the deck states none. It sets the thermal voltage in every exponential device.',
    control: { kind: 'number', min: -40, max: 125, step: 1, unit: '\u00b0C' },
    keywords: ['temp', 'thermal', 'kelvin', 'junction'],
    alsoIn: 'the analysis parameters on the simulation sheet',
  },
  {
    key: 'simTransientStopUs',
    category: 'simulation',
    title: 'Transient stop time',
    description: 'The window a newly opened transient run starts with. A 1 kHz source needs tens of milliseconds to show a dozen cycles.',
    control: { kind: 'number', min: 10, max: 1_000_000, step: 10, unit: '\u00b5s' },
    keywords: ['transient', 'stop', 'duration', 'time', 'window'],
  },
  {
    key: 'simTransientStepUs',
    category: 'simulation',
    title: 'Transient max step',
    description: 'The largest step the integrator may take. Too coarse and a fast edge aliases to a flat line; the solver warns when it does.',
    control: { kind: 'number', min: 0.1, max: 10_000, step: 0.1, unit: '\u00b5s' },
    keywords: ['step', 'timestep', 'resolution', 'sampling'],
  },
  {
    key: 'simIntegrationMethod',
    category: 'simulation',
    title: 'Integration rule',
    description: 'Backward Euler never rings but smears edges; trapezoidal is second-order and preserves LC ringing; Gear/BDF2 is second-order and damps it.',
    control: {
      kind: 'select',
      options: [
        { value: 'backward-euler', label: 'Backward Euler', hint: 'first-order, unconditionally stable' },
        { value: 'trapezoidal', label: 'Trapezoidal', hint: 'second-order, keeps ringing' },
        { value: 'bdf2', label: 'Gear / BDF2', hint: 'second-order, damps stiff ringing' },
      ],
    },
    keywords: ['solver', 'gear', 'euler', 'trapezoid', 'integration', 'order'],
    alsoIn: 'the transient card on the simulation sheet',
  },
  {
    key: 'simPointsPerDecade',
    category: 'simulation',
    title: 'Sweep points per decade',
    description: 'Frequency samples an AC or noise sweep draws per decade. More points resolve a sharper pole and take proportionally longer.',
    control: { kind: 'number', min: 2, max: 200, step: 1 },
    keywords: ['ac', 'bode', 'frequency', 'decade', 'grid', 'resolution'],
    alsoIn: 'the AC analysis card',
  },
  {
    key: 'shadingMode',
    category: 'viewport',
    title: 'Shading',
    description: 'Solid surfaces judge how a thing looks; the crease outline with a ghost of the surface judges what the geometry is. Applies to every 3D view.',
    control: {
      kind: 'select',
      // Named from the same table the HUD buttons use, so the settings page and a
      // viewport cannot call the same mode two different things. The row's own
      // description already says what each choice is for.
      options: SHADING_MODES.map((mode) => ({ value: mode, label: SHADING_UI[mode].label })),
    },
    keywords: [...SHADING_MODES, 'wireframe', 'hidden line', 'edges'],
    alsoIn: 'each 3D viewer, on its own display controls',
  },
  {
    key: 'viewerGrid',
    category: 'viewport',
    title: 'Ground grid',
    description: 'The reference grid under a 3D model. It marks the build plane; it is not part of the export.',
    control: { kind: 'toggle' },
    keywords: ['floor', 'plane', 'reference'],
    alsoIn: 'the board preview display card',
  },
  {
    key: 'viewerShadows',
    category: 'viewport',
    title: 'Cast shadows',
    description: 'Shadow maps for parts sitting on the board. Costs frame time on a dense board; without it, parts float.',
    control: { kind: 'toggle' },
    keywords: ['lighting', 'shadow', 'performance'],
    alsoIn: 'the board preview display card',
  },
  {
    key: 'viewerPixelRatio',
    category: 'viewport',
    title: 'Render resolution',
    description: 'Resolution scale: the 3D renderer draws at this multiple of a screen pixel and never more than the display itself has. Lower renders faster and softer.',
    control: {
      kind: 'select',
      options: [
        { value: 0.75, label: '0.75\u00d7', hint: 'Fastest — renders below native density, then upscales' },
        { value: 1, label: '1\u00d7', hint: 'One pixel per screen pixel' },
        { value: 1.5, label: '1.5\u00d7' },
        { value: 2, label: '2\u00d7', hint: 'Sharpest on a HiDPI display' },
      ],
    },
    keywords: ['dpr', 'quality', 'antialias', 'performance'],
    alsoIn: 'the board preview display card',
  },
  {
    key: 'viewerPartScale',
    category: 'viewport',
    title: 'Part body scale',
    description: 'Exaggeration of component bodies in the board preview. 1.0\u00d7 is true size; above it the parts are easier to see, and no longer to scale.',
    control: { kind: 'slider', min: 0.5, max: 2, step: 0.1, format: times },
    keywords: ['size', 'body', 'exaggerate', 'zoom'],
    alsoIn: 'the board preview display card',
  },
  {
    key: 'editorFontSize',
    category: 'editor',
    title: 'Font size',
    description: 'Text size in every code buffer — SPICE decks, firmware, HDL, constraint files.',
    control: { kind: 'slider', min: 10, max: 24, step: 1, format: px },
    keywords: ['text', 'type', 'zoom', 'size'],
  },
  {
    key: 'editorLineNumbers',
    category: 'editor',
    title: 'Line numbers',
    description: 'The gutter that counts the rows and marks the one the caret sits on.',
    control: { kind: 'toggle' },
    keywords: ['gutter', 'row'],
  },
  {
    key: 'editorSuggestions',
    category: 'editor',
    title: 'Completions and ghost text',
    description: 'The popup list and the inline grey suggestion at the caret. Off means nothing is inserted before you ask for it.',
    control: { kind: 'toggle' },
    keywords: ['autocomplete', 'intellisense', 'inline', 'ghost'],
  },
  {
    key: 'editorAutoCloseBrackets',
    category: 'editor',
    title: 'Auto-close brackets',
    description: 'Typing an opening bracket, quote or backtick inserts its partner and places the caret between them.',
    control: { kind: 'toggle' },
    keywords: ['parenthesis', 'quote', 'pair'],
  },
  {
    key: 'editorAutoIndent',
    category: 'editor',
    title: 'Auto-indent',
    description: 'Pressing Enter copies the line\u2019s indentation, and adds a step inside brackets.',
    control: { kind: 'toggle' },
    keywords: ['tab', 'whitespace', 'newline'],
  },
  {
    key: 'editorTabSize',
    category: 'editor',
    title: 'Indent width',
    description: 'Spaces a Tab inserts and auto-indent steps by. Verilog and firmware conventionally take 2; some decks want 4.',
    control: {
      kind: 'select',
      options: [
        { value: 2, label: '2 spaces' },
        { value: 4, label: '4 spaces' },
        { value: 8, label: '8 spaces' },
      ],
    },
    keywords: ['tab', 'indent', 'spaces', 'whitespace'],
  },
  {
    key: 'editorActiveLine',
    category: 'editor',
    title: 'Highlight the caret line',
    description: 'Tints the row the caret sits on. It is the only cue that survives a buffer wider than the window.',
    control: { kind: 'toggle' },
    keywords: ['current line', 'caret', 'row', 'gutter'],
  },
  {
    key: 'cameraFovDeg',
    category: 'viewport',
    title: 'Camera field of view',
    description: 'Vertical angle of the 3D camera. A narrow angle flattens the model and reads like an orthographic drawing; a wide one bows the edges.',
    control: { kind: 'slider', min: 20, max: 70, step: 1, format: (v) => `${v}\u00b0` },
    keywords: ['fov', 'lens', 'perspective', 'angle', 'orthographic'],
    alsoIn: 'every 3D viewer, through its zoom',
  },
  {
    key: 'imageExportScale',
    category: 'output',
    title: 'Image export scale',
    description: 'Pixel multiple of a PNG sheet export. The sheet stays the same size; the file gets sharper and larger.',
    control: {
      kind: 'select',
      options: [
        { value: 1, label: '1\u00d7', hint: 'screen resolution' },
        { value: 2, label: '2\u00d7', hint: 'print-ready' },
        { value: 4, label: '4\u00d7', hint: 'large-format' },
      ],
    },
    keywords: ['png', 'raster', 'dpi', 'resolution', 'screenshot'],
  },
  {
    key: 'gerberUnits',
    category: 'output',
    title: 'Gerber units',
    description: 'Coordinate unit written into the Gerber header. mm takes the 3.6 format, inches the 2.6 that older CAM viewers expect.',
    control: {
      kind: 'select',
      options: [
        { value: 'mm', label: 'Millimetres', hint: '%MOMM, 3.6' },
        { value: 'in', label: 'Inches', hint: '%MOIN, 2.6' },
      ],
    },
    keywords: ['gerber', 'rs-274x', 'fab', 'cad', 'inch', 'mil'],
  },
  {
    key: 'drawingPaperSize',
    category: 'output',
    title: 'Drawing paper',
    description: 'Sheet every exported drawing is laid out on — schematic, machined part and truss framing. The model is fitted to it and the title block prints the size you chose.',
    control: {
      kind: 'select',
      options: [
        { value: 'A4', label: 'A4', hint: '297 × 210 mm' },
        { value: 'A3', label: 'A3', hint: '420 × 297 mm' },
        { value: 'Letter', label: 'Letter', hint: '279.4 × 215.9 mm' },
      ],
    },
    keywords: ['svg', 'pdf', 'sheet', 'paper', 'print', 'iso 5457', 'title block'],
  },
  {
    key: 'autoSave',
    category: 'saving',
    title: 'Auto-save',
    description: 'Write the design to this browser on the interval below, so a crash does not take the last hour with it.',
    control: { kind: 'toggle' },
    keywords: ['autosave', 'checkpoint', 'backup'],
  },
  {
    key: 'autoSaveInterval',
    category: 'saving',
    title: 'Auto-save interval',
    description: 'How often a dirty design is written. Only runs while something is unsaved.',
    control: {
      kind: 'select',
      options: [
        { value: 10000, label: '10 seconds' },
        { value: 30000, label: '30 seconds' },
        { value: 60000, label: '1 minute' },
        { value: 300000, label: '5 minutes' },
        { value: 600000, label: '10 minutes' },
      ],
    },
    keywords: ['frequency', 'every', 'timeout'],
    dependsOn: 'autoSave',
  },
]

/** The values a first run gets, and what a reset returns to. */
export const DEFAULT_SETTINGS: AppSettings = {
  // Folio Dark is the flagship first-run default; System remains an explicit choice.
  theme: 'folio-dark',
  animations: true,
  ambientLight: true,
  gridSize: 10,
  snapToGrid: true,
  showGrid: true,
  showRulers: true,
  showNetLabels: true,
  historyDepth: 100,
  boardTraceWidthMm: 0.2,
  boardClearanceMm: 0.2,
  boardViaDrillMm: 0.3,
  boardViaPadMm: 0.6,
  simTemperatureC: 27,
  simTransientStopUs: 20000,
  simTransientStepUs: 20,
  simIntegrationMethod: 'backward-euler',
  simPointsPerDecade: 20,
  shadingMode: 'solid',
  viewerGrid: true,
  viewerShadows: true,
  viewerPixelRatio: 2,
  viewerPartScale: 1,
  cameraFovDeg: 42,
  editorFontSize: 13,
  editorLineNumbers: true,
  editorSuggestions: true,
  editorAutoCloseBrackets: true,
  editorAutoIndent: true,
  editorTabSize: 2,
  editorActiveLine: true,
  imageExportScale: 1,
  gerberUnits: 'mm',
  drawingPaperSize: 'A4',
  autoSave: true,
  autoSaveInterval: 30000,
}

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as Array<keyof AppSettings>

/** The definition for a key, or undefined for a key nobody registered. */
export function settingDefinition(key: keyof AppSettings): SettingDefinition | undefined {
  return SETTING_DEFINITIONS.find((definition) => definition.key === key)
}

function roundToStep(value: number, step: number): number {
  if (!(step > 0)) return value
  return Math.round(value / step) * step
}

/**
 * A stored or typed value into a value the app can act on.
 *
 * Two paths reach settings: a control on the page, and whatever localStorage
 * held from an earlier release — including a release where a key meant something
 * else, or a hand-edited number. Rather than trust either, every write is
 * clamped to its registry range and every read through migration is filled from
 * the defaults, so a renderer never receives `undefined` or 90000.
 */
export function coerceSetting(key: keyof AppSettings, value: unknown): AppSettings[typeof key] {
  const definition = settingDefinition(key)
  const fallback = DEFAULT_SETTINGS[key]
  if (!definition || value === undefined || value === null) return fallback as AppSettings[typeof key]
  const control = definition.control
  let result: unknown
  if (control.kind === 'theme') result = normalizeThemePreference(value)
  else if (control.kind === 'toggle') result = typeof value === 'boolean' ? value : fallback
  else if (control.kind === 'select')
    result = control.options.some((option) => option.value === value) ? value : fallback
  else {
    const numeric = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(numeric)) return fallback as AppSettings[typeof key]
    const clamped = Math.min(control.max, Math.max(control.min, roundToStep(numeric, control.step)))
    // Step 0.1 arithmetic lands on 1.2000000000000002; a readout must not show it.
    const decimals = (control.step.toString().split('.')[1] || '').length
    result = Number(clamped.toFixed(decimals))
  }
  return result as AppSettings[typeof key]
}

/** Every key present, clamped, with anything unknown dropped. */
export function normalizeSettings(raw: Partial<Record<keyof AppSettings, unknown>> | undefined): AppSettings {
  const normalized = { ...DEFAULT_SETTINGS }
  if (!raw) return normalized
  for (const key of SETTING_KEYS) {
    // The per-key cast inside coerceSetting is what proves this assignment;
    // TypeScript cannot carry the correlation through a loop over a union key.
    ;(normalized as Record<string, unknown>)[key] = coerceSetting(key, raw[key])
  }
  return normalized
}

