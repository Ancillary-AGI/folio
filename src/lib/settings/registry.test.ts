/**
 * The settings registry, checked as a contract.
 *
 * The page is generated from this list and the store clamps through it, so the
 * failure modes worth pinning are the quiet ones: a preference added to the type
 * but never registered (it would be invisible and unresettable), a default that
 * its own control cannot express (the row would render nothing selected), and a
 * coercion that lets a stored number through outside its range.
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  SETTING_CATEGORIES,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  coerceSetting,
  normalizeSettings,
  settingDefinition,
} from './registry'
import type { AppSettings } from '../../stores/useAppStore'

describe('settings registry', () => {
  it('registers every persisted setting exactly once', () => {
    const keys = SETTING_DEFINITIONS.map((definition) => definition.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect([...keys].sort()).toEqual([...SETTING_KEYS].sort())
  })

  it('puts each setting in a category the rail knows', () => {
    const categories = SETTING_CATEGORIES.map((category) => category.id)
    for (const definition of SETTING_DEFINITIONS) {
      expect(categories).toContain(definition.category)
    }
  })

  it('describes what each setting does instead of restating its title', () => {
    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.description.length).toBeGreaterThan(24)
      expect(definition.description.toLowerCase()).not.toContain(definition.title.toLowerCase())
    }
  })

  it('can express every default through its own control', () => {
    for (const definition of SETTING_DEFINITIONS) {
      const value = DEFAULT_SETTINGS[definition.key]
      const control = definition.control
      if (control.kind === 'select') {
        expect(control.options.map((option) => option.value)).toContain(value)
      }
      if (control.kind === 'slider' || control.kind === 'number') {
        expect(typeof value).toBe('number')
        expect(value).toBeGreaterThanOrEqual(control.min)
        expect(value).toBeLessThanOrEqual(control.max)
      }
    }
  })
})

describe('coerceSetting', () => {
  it('clamps a number into its range and onto its step', () => {
    expect(coerceSetting('historyDepth', 90000)).toBe(500)
    expect(coerceSetting('historyDepth', 3)).toBe(20)
    // 137 is not on a step of 10; the nearest one is, and the readout must say so.
    expect(coerceSetting('historyDepth', 137)).toBe(140)
    expect(coerceSetting('viewerPartScale', 0.52)).toBe(0.5)
  })

  it('keeps a float clean instead of shipping step arithmetic noise', () => {
    expect(coerceSetting('viewerPartScale', 1.2)).toBe(1.2)
    expect(String(coerceSetting('viewerPartScale', 1.1999999999))).not.toContain('e')
  })

  it('falls back for a value that is not a number at all', () => {
    expect(coerceSetting('editorFontSize', 'wide')).toBe(DEFAULT_SETTINGS.editorFontSize)
    expect(coerceSetting('gridSize', null)).toBe(DEFAULT_SETTINGS.gridSize)
  })

  it('refuses a select value its options never offered', () => {
    expect(coerceSetting('shadingMode', 'wireframe')).toBe('solid')
    expect(coerceSetting('shadingMode', 'outline')).toBe('outline')
    expect(coerceSetting('autoSaveInterval', 45000)).toBe(DEFAULT_SETTINGS.autoSaveInterval)
    expect(coerceSetting('autoSaveInterval', 60000)).toBe(60000)
  })

  it('refuses a non-boolean for a switch', () => {
    expect(coerceSetting('showGrid', 'true')).toBe(DEFAULT_SETTINGS.showGrid)
    expect(coerceSetting('showGrid', false)).toBe(false)
  })

  it('normalises the theme through the theme controller', () => {
    expect(coerceSetting('theme', 'neon')).toBe(DEFAULT_SETTINGS.theme)
    expect(coerceSetting('theme', 'light')).toBe('light')
  })

  it('drops an unregistered key instead of guessing a type', () => {
    expect(settingDefinition('language' as keyof AppSettings)).toBeUndefined()
    expect(coerceSetting('language' as keyof AppSettings, 'fr')).toBeUndefined()
  })
})

describe('normalizeSettings', () => {
  it('fills keys a stored version never had', () => {
    const stored = { theme: 'dark', gridSize: 10 } as Partial<Record<keyof AppSettings, unknown>>
    const normalized = normalizeSettings(stored)
    expect(normalized.historyDepth).toBe(DEFAULT_SETTINGS.historyDepth)
    expect(normalized.shadingMode).toBe(DEFAULT_SETTINGS.shadingMode)
    expect(normalized.editorFontSize).toBe(DEFAULT_SETTINGS.editorFontSize)
  })

  it('drops a retired key rather than carrying it forward', () => {
    const stored = { language: 'fr', units: 'imperial', gridSize: 8 } as unknown as Partial<
      Record<keyof AppSettings, unknown>
    >
    const normalized = normalizeSettings(stored)
    expect(normalized.gridSize).toBe(8)
    expect(Object.keys(normalized)).not.toContain('language')
    expect(Object.keys(normalized)).not.toContain('units')
  })

  it('leaves an untouched default set alone', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings({})).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips a value that is already valid', () => {
    const edited = { ...DEFAULT_SETTINGS, showRulers: false, viewerPixelRatio: 1, historyDepth: 250 }
    expect(normalizeSettings(edited)).toEqual(edited)
  })
})
