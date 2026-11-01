/**
 * Keyboard shortcut registry.
 *
 * One source of truth for the bindings the workbench implements. Handlers read
 * the resolved binding instead of hard-coding keys, so a rebind in the guide
 * changes what the editor actually does. Bindings are stored per user in
 * localStorage; a malformed or stale store is discarded rather than trusted.
 */

export type ShortcutScope = 'global' | 'schematic' | 'pcb'
export type Platform = 'mac' | 'other'

export interface KeyBinding {
  /** Normalised key token: `k`, `f1`, `escape`, `arrowleft`, `?`. */
  key: string
  /** The platform's command modifier: Ctrl elsewhere, ⌘ on macOS. */
  primary?: boolean
  shift?: boolean
  alt?: boolean
}

export interface ShortcutDefinition {
  id: string
  action: string
  /** Where the binding applies, in the shortcut sheet's words. */
  where: string
  scope: ShortcutScope
  binding: KeyBinding
  /** Extra keys that trigger the same action (never edited, always active). */
  alternates?: readonly KeyBinding[]
  /** Escape-like keys must keep working from inside a text field. */
  allowInInput?: boolean
}

export interface ShortcutEvent {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'escape',
  del: 'delete',
  return: 'enter',
  ins: 'insert',
  spacebar: 'space',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
}

/** Normalise a DOM `KeyboardEvent.key` or a stored token into one spelling. */
export function normalizeKey(key: string): string {
  const lower = key.trim().toLowerCase()
  return KEY_ALIASES[lower] ?? lower
}

const DISPLAY_KEYS: Readonly<Record<string, string>> = {
  escape: 'Esc',
  delete: 'Del',
  backspace: '⌫',
  enter: '↵',
  space: 'Space',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  tab: 'Tab',
  plus: '+',
}

const PUNCTUATION = /^[^a-z0-9]$/

/**
 * `?`, `+` and `{` are produced with Shift on most layouts, so Shift is part of
 * the character, not a separate chord modifier: demanding Shift would make the
 * binding impossible to type on some keyboards and impossible to match on
 * others.
 */
function shiftIsImplicit(key: string): boolean {
  return PUNCTUATION.test(key)
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

export function currentPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'other'
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent) ? 'mac' : 'other'
}

function primaryHeld(event: ShortcutEvent, platform: Platform): boolean {
  return platform === 'mac' ? event.metaKey : event.ctrlKey
}

/** Does this event fire the binding? Modifiers must match exactly. */
export function matchesBinding(
  event: ShortcutEvent,
  binding: KeyBinding,
  platform: Platform = currentPlatform(),
): boolean {
  if (normalizeKey(event.key) !== normalizeKey(binding.key)) return false
  if (Boolean(binding.primary) !== primaryHeld(event, platform)) return false
  // A raw Control press on macOS is not the command modifier.
  if (platform === 'mac' && event.ctrlKey) return false
  if (platform === 'other' && event.metaKey) return false
  if (Boolean(binding.alt) !== event.altKey) return false
  if (!shiftIsImplicit(binding.key) && Boolean(binding.shift) !== event.shiftKey) return false
  return true
}

const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt', 'altgraph', 'capslock', 'os', 'fn'])

/** Build a binding from a keydown, or null for a bare modifier press. */
export function bindingFromEvent(event: ShortcutEvent, platform: Platform = currentPlatform()): KeyBinding | null {
  const key = normalizeKey(event.key)
  if (!key || MODIFIER_KEYS.has(key)) return null
  return {
    key,
    primary: primaryHeld(event, platform) || undefined,
    shift: (shiftIsImplicit(key) ? false : event.shiftKey) || undefined,
    alt: event.altKey || undefined,
  }
}

/** Canonical signature used for conflict detection and persistence tests. */
export function bindingSignature(binding: KeyBinding): string {
  return [
    binding.primary ? 'primary' : '',
    binding.alt ? 'alt' : '',
    binding.shift ? 'shift' : '',
    normalizeKey(binding.key),
  ].filter(Boolean).join('+')
}

export function formatBinding(
  binding: KeyBinding,
  platform: Platform = currentPlatform(),
): string[] {
  const key = normalizeKey(binding.key)
  const parts: string[] = []
  if (binding.primary) parts.push(platform === 'mac' ? '⌘' : 'Ctrl')
  if (binding.alt) parts.push(platform === 'mac' ? '⌥' : 'Alt')
  if (binding.shift) parts.push(platform === 'mac' ? '⇧' : 'Shift')
  parts.push(DISPLAY_KEYS[key] ?? (key.length === 1 ? key.toUpperCase() : key.replace(/^f(\d+)$/, (_m, n) => `F${n}`)))
  return parts
}

export function isValidBinding(value: unknown): value is KeyBinding {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  if (typeof candidate.key !== 'string') return false
  const key = candidate.key.trim()
  if (key.length === 0 || key.length > 24) return false
  if (candidate.primary !== undefined && typeof candidate.primary !== 'boolean') return false
  if (candidate.shift !== undefined && typeof candidate.shift !== 'boolean') return false
  if (candidate.alt !== undefined && typeof candidate.alt !== 'boolean') return false
  return true
}

/**
 * The bindings the workbench implements. Every entry here is consumed by a
 * handler: adding a row without wiring it would advertise a dead key, so the
 * registry test cross-checks this list against the handler call sites.
 */
export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'help.open',
    action: 'Open help and tutorials',
    where: 'Workbench',
    scope: 'global',
    binding: { key: 'f1' },
    allowInInput: true,
  },
  {
    id: 'help.openQuestion',
    action: 'Open help and tutorials',
    where: 'Workbench outside a text field',
    scope: 'global',
    binding: { key: '?' },
  },
  {
    id: 'help.close',
    action: 'Close the open dialog or guide',
    where: 'Workbench',
    scope: 'global',
    binding: { key: 'escape' },
    allowInInput: true,
  },
  {
    id: 'palette.open',
    action: 'Command palette: workspaces, demos and actions',
    where: 'Workbench',
    scope: 'global',
    binding: { key: 'k', primary: true },
  },
  {
    id: 'demos.open',
    action: 'Demo gallery',
    where: 'Workbench',
    scope: 'global',
    binding: { key: 'd', primary: true, shift: true },
  },
  {
    id: 'agents.open',
    action: 'Agent workbench',
    where: 'Workbench',
    scope: 'global',
    binding: { key: 'a', primary: true, shift: true },
  },
  {
    id: 'voice.toggle',
    action: 'Start or stop the voice conversation',
    where: 'Workbench',
    scope: 'global',
    binding: { key: 'm', primary: true, shift: true },
  },
  {
    id: 'schematic.selectTool',
    action: 'Select tool',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'v' },
  },
  {
    id: 'schematic.wireTool',
    action: 'Wire tool',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'w' },
  },
  {
    id: 'schematic.deleteTool',
    action: 'Delete tool',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'd' },
  },
  {
    id: 'schematic.sketchTool',
    action: 'Sketch tool: draw a circuit and recognise it',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 's' },
  },
  {
    id: 'schematic.sketchCommit',
    action: 'Sketch: place the recognised ink on the sheet',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'enter', primary: true },
  },
  {
    id: 'schematic.rotate',
    action: 'Rotate the selected parts 90°',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'r' },
  },
  {
    id: 'schematic.grid',
    action: 'Toggle the grid',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'g' },
  },
  {
    id: 'schematic.fit',
    action: 'Fit the design to the view',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'f' },
  },
  {
    id: 'schematic.undo',
    action: 'Undo the last edit',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'z', primary: true },
  },
  {
    id: 'schematic.redo',
    action: 'Redo the undone edit',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'z', primary: true, shift: true },
    alternates: [{ key: 'y', primary: true }],
  },
  {
    id: 'schematic.save',
    action: 'Save the current snapshot',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 's', primary: true },
  },
  {
    id: 'schematic.cancel',
    action: 'Cancel the wire, clear the selection',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'escape' },
  },
  {
    id: 'schematic.deleteSelection',
    action: 'Delete the selected parts and wires',
    where: 'Schematic',
    scope: 'schematic',
    binding: { key: 'delete' },
    alternates: [{ key: 'backspace' }],
  },
  {
    id: 'pcb.cancel',
    action: 'Cancel the copper draft',
    where: 'PCB canvas',
    scope: 'pcb',
    binding: { key: 'escape' },
  },
  {
    id: 'pcb.finish',
    action: 'Finish the copper draft',
    where: 'PCB canvas',
    scope: 'pcb',
    binding: { key: 'enter' },
  },
  {
    id: 'pcb.rotate',
    action: 'Rotate the selected part clockwise',
    where: 'PCB canvas',
    scope: 'pcb',
    binding: { key: 'r' },
  },
  {
    id: 'pcb.rotateReverse',
    action: 'Rotate the selected part anticlockwise',
    where: 'PCB canvas',
    scope: 'pcb',
    binding: { key: 'r', shift: true },
  },
  {
    id: 'pcb.flip',
    action: 'Flip the selected part to the other face of the board',
    where: 'PCB canvas',
    scope: 'pcb',
    binding: { key: 'f' },
  },
  {
    id: 'pcb.undo',
    action: 'Undo the last board edit',
    where: 'PCB canvas',
    scope: 'pcb',
    binding: { key: 'z', primary: true },
  },
  {
    id: 'pcb.redo',
    action: 'Redo the undone board edit',
    where: 'PCB canvas',
    scope: 'pcb',
    binding: { key: 'z', primary: true, shift: true },
    alternates: [{ key: 'y', primary: true }],
  },
  {
    id: 'pcb.deleteSelection',
    action: 'Delete the selected track or via',
    where: 'PCB canvas',
    scope: 'pcb',
    binding: { key: 'delete' },
    alternates: [{ key: 'backspace' }],
  },
] as const

/**
 * Keys a surface owns while it has focus, so the workbench dispatcher never
 * sees them and they cannot be rebound. Listed here to keep the shortcut
 * sheet complete: `src/components/editor/CodeEditor.tsx` implements each one.
 */
export const EDITOR_KEYS = [
  { keys: ['Ctrl / ⌘', 'F'], action: 'Open find, with replace', where: 'Code editor' },
  { keys: ['Ctrl / ⌘', '/'], action: 'Comment or uncomment the line', where: 'Code editor' },
  { keys: ['Tab'], action: 'Accept the highlighted completion, or indent', where: 'Code editor' },
  { keys: ['Shift', 'Tab'], action: 'Outdent the line or the selected block', where: 'Code editor' },
  { keys: ['Enter'], action: 'Accept the completion, or open a new indented line', where: 'Code editor' },
  { keys: ['Esc'], action: 'Close completions, then the find bar', where: 'Code editor' },
  { keys: ['Home'], action: 'First character of the line, then column one', where: 'Code editor' },
  { keys: ['↑', '↓'], action: 'Walk completions, then walk find matches', where: 'Code editor' },
  { keys: ['(', '[', '{'], action: 'Insert the pair, or wrap the selection in it', where: 'Code editor' },
  { keys: ['"', "'"], action: 'Pair a quote, or step over one already typed', where: 'Code editor' },
] as const

export const SHORTCUTS_BY_ID: ReadonlyMap<string, ShortcutDefinition> = new Map(
  SHORTCUTS.map((definition) => [definition.id, definition]),
)

export type ShortcutId = (typeof SHORTCUTS)[number]['id']

export interface ShortcutOverrides {
  [id: string]: KeyBinding
}

export function resolveBinding(
  id: string,
  overrides: ShortcutOverrides = {},
): KeyBinding | undefined {
  const definition = SHORTCUTS_BY_ID.get(id)
  if (!definition) return undefined
  return overrides[id] ?? definition.binding
}

export function matchesShortcut(
  event: ShortcutEvent,
  id: string,
  overrides: ShortcutOverrides = {},
  platform: Platform = currentPlatform(),
): boolean {
  const definition = SHORTCUTS_BY_ID.get(id)
  if (!definition) return false
  const primary = resolveBinding(id, overrides)
  if (primary && matchesBinding(event, primary, platform)) return true
  return (definition.alternates ?? []).some((binding) => matchesBinding(event, binding, platform))
}

/**
 * Does any definition in the same scope already own this binding? Global and
 * schematic bindings may repeat because the schematic handler only runs while
 * the sheet is open; two bindings inside one scope cannot.
 */
export function findConflict(
  id: string,
  binding: KeyBinding,
  overrides: ShortcutOverrides = {},
): ShortcutDefinition | undefined {
  const definition = SHORTCUTS_BY_ID.get(id)
  if (!definition) return undefined
  const signature = bindingSignature(binding)
  for (const other of SHORTCUTS) {
    if (other.id === id || other.scope !== definition.scope) continue
    const candidate = resolveBinding(other.id, overrides)
    if (candidate && bindingSignature(candidate) === signature) return other
    for (const alternate of other.alternates ?? []) {
      if (bindingSignature(alternate) === signature) return other
    }
  }
  return undefined
}

/** Every duplicate inside a scope, for the editor's per-row warning. */
export function allConflicts(overrides: ShortcutOverrides = {}): Map<string, ShortcutDefinition> {
  const conflicts = new Map<string, ShortcutDefinition>()
  for (const definition of SHORTCUTS) {
    const binding = resolveBinding(definition.id, overrides)
    if (!binding) continue
    const other = findConflict(definition.id, binding, overrides)
    if (other) conflicts.set(definition.id, other)
  }
  return conflicts
}

const STORAGE_KEY = 'folio.shortcuts.v1'

interface PersistedOverrides {
  version: 1
  overrides: ShortcutOverrides
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Read and validate saved overrides; unknown ids and malformed rows vanish. */
export function loadOverrides(target: Storage | null = storage()): ShortcutOverrides {
  if (!target) return {}
  try {
    const raw = target.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Partial<PersistedOverrides>
    if (!parsed || parsed.version !== 1 || !parsed.overrides || typeof parsed.overrides !== 'object') {
      return {}
    }
    const clean: ShortcutOverrides = {}
    for (const [id, binding] of Object.entries(parsed.overrides)) {
      if (!SHORTCUTS_BY_ID.has(id)) continue
      if (!isValidBinding(binding)) continue
      clean[id] = { key: normalizeKey(binding.key), primary: binding.primary, shift: binding.shift, alt: binding.alt }
    }
    return clean
  } catch {
    return {}
  }
}

export function saveOverrides(overrides: ShortcutOverrides, target: Storage | null = storage()): void {
  if (!target) return
  try {
    const payload: PersistedOverrides = { version: 1, overrides }
    target.setItem(STORAGE_KEY, JSON.stringify(payload))
  } catch {
    // A full or blocked storage must not break editing; the session keeps the
    // in-memory overrides and only the persistence across reloads is lost.
  }
}

export function shortcutRows(
  overrides: ShortcutOverrides = {},
  platform: Platform = currentPlatform(),
): Array<{ definition: ShortcutDefinition; keys: string[][] }> {
  return SHORTCUTS.map((definition) => {
    const primary = resolveBinding(definition.id, overrides) ?? definition.binding
    return {
      definition,
      keys: [primary, ...(definition.alternates ?? [])].map((binding) => formatBinding(binding, platform)),
    }
  })
}

/** Text form used by the command palette and tests. */
export function describeShortcut(id: string, overrides: ShortcutOverrides = {}, platform: Platform = currentPlatform()): string {
  const binding = resolveBinding(id, overrides)
  return binding ? formatBinding(binding, platform).join(platform === 'mac' ? '' : '+') : ''
}

/**
 * Keycaps to show for a help topic: its own keys when it has them, otherwise
 * the live binding (and alternates) from the registry.
 */
export function topicKeyLabels(
  topic: { keys?: readonly string[]; shortcutId?: string },
  overrides: ShortcutOverrides = {},
  platform: Platform = currentPlatform(),
): string[] {
  if (topic.keys && topic.keys.length > 0) return [...topic.keys]
  if (!topic.shortcutId) return []
  const definition = SHORTCUTS_BY_ID.get(topic.shortcutId)
  if (!definition) return []
  const bindings = [resolveBinding(definition.id, overrides) ?? definition.binding, ...(definition.alternates ?? [])]
  return bindings.map((binding) => formatBinding(binding, platform).join(platform === 'mac' ? '' : '+'))
}
