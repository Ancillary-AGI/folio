import { describe, expect, it } from 'vitest'
import {
  SHORTCUTS,
  allConflicts,
  bindingFromEvent,
  bindingSignature,
  findConflict,
  formatBinding,
  isValidBinding,
  loadOverrides,
  matchesBinding,
  matchesShortcut,
  normalizeKey,
  saveOverrides,
  shortcutRows,
  type ShortcutEvent,
} from './shortcuts'

const ev = (key: string, modifiers: Partial<ShortcutEvent> = {}): ShortcutEvent => ({
  key,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...modifiers,
})

function memoryStorage(): Storage {
  const data = new Map<string, string>()
  return {
    get length() { return data.size },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => { data.delete(key) },
    setItem: (key: string, value: string) => { data.set(key, value) },
  }
}

describe('shortcut bindings', () => {
  it('normalises key spellings and parses bindings from events', () => {
    expect(normalizeKey('Esc')).toBe('escape')
    expect(normalizeKey('Del')).toBe('delete')
    expect(normalizeKey('F1')).toBe('f1')
    // A bare modifier is not a binding.
    expect(bindingFromEvent(ev('Control', { ctrlKey: true }))).toBeNull()
    expect(bindingFromEvent(ev('Shift', { shiftKey: true }))).toBeNull()
    expect(bindingFromEvent(ev('K', { ctrlKey: true }), 'other')).toEqual({ key: 'k', primary: true })
    // Shift is part of the '?' character, not a chord modifier.
    expect(bindingFromEvent(ev('?', { shiftKey: true }), 'other')).toEqual({ key: '?' })
    expect(bindingFromEvent(ev('Z', { ctrlKey: true, shiftKey: true }), 'other'))
      .toEqual({ key: 'z', primary: true, shift: true })
  })

  it('matches the platform command modifier, not raw Control on macOS', () => {
    const ctrlK = { key: 'k', primary: true }
    expect(matchesBinding(ev('k', { ctrlKey: true }), ctrlK, 'other')).toBe(true)
    expect(matchesBinding(ev('k', { metaKey: true }), ctrlK, 'mac')).toBe(true)
    expect(matchesBinding(ev('k', { ctrlKey: true }), ctrlK, 'mac')).toBe(false)
    expect(matchesBinding(ev('k'), ctrlK, 'other')).toBe(false)
  })

  it('requires an exact modifier chord for letters but tolerates implicit shift on symbols', () => {
    expect(matchesBinding(ev('Z', { ctrlKey: true, shiftKey: true }), { key: 'z', primary: true, shift: true }, 'other')).toBe(true)
    expect(matchesBinding(ev('z', { ctrlKey: true }), { key: 'z', primary: true, shift: true }, 'other')).toBe(false)
    expect(matchesBinding(ev('?', { shiftKey: true }), { key: '?' }, 'other')).toBe(true)
  })

  it('honours alternates such as Ctrl+Y for redo, and formats bindings', () => {
    expect(matchesShortcut(ev('y', { ctrlKey: true }), 'schematic.redo', {}, 'other')).toBe(true)
    expect(matchesShortcut(ev('z', { ctrlKey: true, shiftKey: true }), 'schematic.redo', {}, 'other')).toBe(true)
    expect(formatBinding({ key: 'escape' }, 'other')).toEqual(['Esc'])
    expect(formatBinding({ key: 'k', primary: true, shift: true }, 'other')).toEqual(['Ctrl', 'Shift', 'K'])
    expect(formatBinding({ key: 'k', primary: true }, 'mac')).toEqual(['⌘', 'K'])
  })

  it('reports conflicts inside a scope and permits the same key across scopes', () => {
    // 'v' is schematic-only today, so reusing it elsewhere in that scope collides.
    expect(findConflict('schematic.wireTool', { key: 'v' }, {})?.id).toBe('schematic.selectTool')
    // Deleting the override frees it again.
    expect(findConflict('schematic.wireTool', { key: 'v' }, { 'schematic.selectTool': { key: 'q' } })).toBeUndefined()
    // A global binding and a schematic binding may share a key.
    expect(findConflict('schematic.wireTool', { key: 'k', primary: true }, {})).toBeUndefined()
    expect(allConflicts({ 'schematic.wireTool': { key: 'v' } }).get('schematic.wireTool')?.id)
      .toBe('schematic.selectTool')
  })
})

describe('shortcut persistence', () => {
  it('round-trips overrides and drops unknown ids and malformed rows', () => {
    const storage = memoryStorage()
    saveOverrides({ 'schematic.wireTool': { key: 'q' } }, storage)
    expect(loadOverrides(storage)).toEqual({ 'schematic.wireTool': { key: 'q' } })

    storage.setItem('folio.shortcuts.v1', JSON.stringify({
      version: 1,
      overrides: {
        'schematic.wireTool': { key: 'q', primary: true },
        'no.such.shortcut': { key: 'x' },
        'schematic.fit': { key: 42 },
        'schematic.grid': { key: 'g', shift: 'yes' },
      },
    }))
    expect(loadOverrides(storage)).toEqual({ 'schematic.wireTool': { key: 'q', primary: true } })
  })

  it('ignores corrupt payloads instead of poisoning the keymap', () => {
    const storage = memoryStorage()
    storage.setItem('folio.shortcuts.v1', '{not json')
    expect(loadOverrides(storage)).toEqual({})
    storage.setItem('folio.shortcuts.v1', JSON.stringify({ version: 2, overrides: { 'schematic.fit': { key: 'x' } } }))
    expect(loadOverrides(storage)).toEqual({})
    expect(loadOverrides(null)).toEqual({})
  })

  it('shows the resolved binding in the sheet and validates every definition', () => {
    for (const definition of SHORTCUTS) {
      expect(definition.id.trim().length).toBeGreaterThan(0)
      expect(definition.action.trim().length).toBeGreaterThan(0)
      expect(definition.where.trim().length).toBeGreaterThan(0)
      expect(isValidBinding(definition.binding)).toBe(true)
      for (const alternate of definition.alternates ?? []) expect(isValidBinding(alternate)).toBe(true)
    }
    expect(new Set(SHORTCUTS.map((definition) => definition.id)).size).toBe(SHORTCUTS.length)

    const rows = shortcutRows({ 'schematic.wireTool': { key: 'q' } }, 'other')
    const wire = rows.find((row) => row.definition.id === 'schematic.wireTool')
    expect(wire?.keys).toEqual([['Q']])
  })

  it('gives every default binding a distinct, non-empty signature', () => {
    const seen = new Map<string, string>()
    for (const definition of SHORTCUTS) {
      for (const binding of [definition.binding, ...(definition.alternates ?? [])]) {
        const signature = `${definition.scope}:${bindingSignature(binding)}`
        const owner = seen.get(signature)
        // Alternates may repeat a primary of the same action, never another one.
        if (owner) expect(owner).toBe(definition.id)
        seen.set(signature, definition.id)
      }
    }
  })
})
