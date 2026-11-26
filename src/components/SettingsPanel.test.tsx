/**
 * The settings page, tested the way a person uses it.
 *
 * What matters is not that the markup exists but that a change lands where the app
 * reads it: no Save step, no second copy of the value, a reset that returns only
 * the row it stood next to, and a search that finds a setting by the word a user
 * would actually type ("wireframe", not "shadingMode").
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import SettingsPanel from './SettingsPanel'
import { useAppStore } from '../stores/useAppStore'
import { DEFAULT_SETTINGS, SETTING_CATEGORIES, SETTING_DEFINITIONS } from '../lib/settings/registry'
import { boardRouterRules } from '../lib/pcb/boardLayout'
import { exportToGerber } from '../lib/exportUtils'
import { openSheet } from '../lib/drawing/sheet'

const open = () => render(<SettingsPanel onClose={() => {}} onRestartOnboarding={() => {}} />)

/** The store is the only place a setting lives, so the store is what gets asserted. */
const setting = () => useAppStore.getState().settings

/**
 * A section in the rail. The name may carry a "n changed from default" hint after
 * the title, so the match is a prefix — the same way a person reads the rail by
 * its labels rather than by its counts.
 */
const goto = (section: string) => {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${section}`) }))
}

const search = (value: string) => {
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search settings' }), { target: { value } })
}

describe('SettingsPanel', () => {
  beforeEach(() => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS } })
  })

  it('applies a change the moment it is made, with nothing to save', () => {
    const { unmount } = open()
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    unmount()

    // Reopening is what a person does to check a setting stuck.
    open()
    goto('3D viewport')
    const grid = screen.getByRole('switch', { name: 'Ground grid' })
    expect(grid).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(grid)
    expect(grid).toHaveAttribute('aria-checked', 'false')
    expect(setting().viewerGrid).toBe(false)
  })

  it('finds a setting by a word in what it does, not only by its label', () => {
    open()
    search('wireframe')
    expect(screen.getByText('Shading')).toBeInTheDocument()
    // Unrelated rows leave, so the match list stays readable.
    expect(screen.queryByText('Ground grid')).not.toBeInTheDocument()
  })

  it('says so when a search matches nothing, instead of showing an empty pane', () => {
    open()
    search('kerning')
    expect(screen.getByText(/Nothing matches “kerning”/)).toBeInTheDocument()
  })

  it('writes a choice control through the store and resets only its own row', () => {
    open()
    goto('3D viewport')
    fireEvent.change(screen.getByRole('combobox', { name: 'Shading' }), { target: { value: 'outline' } })
    expect(setting().shadingMode).toBe('outline')

    // The row now says it is away from its default and offers to put it back.
    expect(screen.getByText('modified')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reset Shading to default' }))
    expect(setting().shadingMode).toBe('solid')
    expect(screen.queryByRole('button', { name: 'Reset Shading to default' })).not.toBeInTheDocument()
  })

  it('clamps a typed value to the range the registry declares', () => {
    open()
    goto('Drafting canvas')
    const pitch = screen.getByRole('spinbutton', { name: 'Grid pitch' })
    fireEvent.change(pitch, { target: { value: '9999' } })
    expect(setting().gridSize).toBe(100)
    // The reset next to the row is the fastest way back to a usable pitch.
    fireEvent.click(screen.getByRole('button', { name: 'Reset Grid pitch to default' }))
    expect(setting().gridSize).toBe(10)
  })

  it('refuses to move a setting that the one it depends on has disabled', () => {
    useAppStore.setState({ settings: { ...DEFAULT_SETTINGS, autoSave: false } })
    open()
    goto('Saving')
    expect(screen.getByRole('combobox', { name: 'Auto-save interval' })).toBeDisabled()
    fireEvent.click(screen.getByRole('switch', { name: 'Auto-save' }))
    expect(screen.getByRole('combobox', { name: 'Auto-save interval' })).toBeEnabled()
  })

  it('counts what changed and puts the whole page back in one press', () => {
    open()
    goto('3D viewport')
    fireEvent.change(screen.getByRole('combobox', { name: 'Shading' }), { target: { value: 'outline' } })
    expect(screen.getByRole('button', { name: 'Reset all' })).toBeEnabled()
    expect(screen.getByText(/1 of \d+ changed from default/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }))
    expect(setting()).toEqual(DEFAULT_SETTINGS)
    expect(screen.getByText('Every setting is at its default.')).toBeInTheDocument()
  })

  it('hosts the live shortcut registry and the model providers as sections', () => {
    open()
    goto('Keyboard shortcuts')
    expect(screen.getByText(/Click a binding, then press the chord/)).toBeInTheDocument()

    goto('Copilot models')
    expect(
      within(screen.getByRole('dialog')).getByText(/bring your own key/i),
    ).toBeInTheDocument()
  })

  it('puts every rail section on the page with a row behind it', () => {
    open()
    for (const category of SETTING_CATEGORIES) {
      goto(category.title)
      expect(screen.getByText(category.blurb)).toBeInTheDocument()
      expect(
        SETTING_DEFINITIONS.filter((definition) => definition.category === category.id).length,
      ).toBeGreaterThan(0)
    }
  })

  it('routes the board with the copper geometry chosen here', () => {
    open()
    goto('Board rules')
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Trace width' }), { target: { value: '0.35' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Clearance' }), { target: { value: '0.15' } })
    expect(setting()).toMatchObject({ boardTraceWidthMm: 0.35, boardClearanceMm: 0.15 })
    // The router reads the same numbers: the page is not a poster of them.
    expect(boardRouterRules()).toMatchObject({ minTraceWidthMm: 0.35, minSpacingMm: 0.15 })
  })

  it('exports on the units and paper chosen here', () => {
    open()
    goto('Export & drawing')
    fireEvent.change(screen.getByRole('combobox', { name: 'Gerber units' }), { target: { value: 'in' } })
    fireEvent.change(screen.getByRole('combobox', { name: 'Drawing paper' }), { target: { value: 'A3' } })
    expect(setting()).toMatchObject({ gerberUnits: 'in', drawingPaperSize: 'A3' })
    // The writers read these: a Gerber header and a sheet laid out to the size.
    expect(exportToGerber([], [], { units: setting().gerberUnits })).toContain('%MOIN*%')
    expect(openSheet({ title: 'Divider', subject: 'schematic drawing', paper: setting().drawingPaperSize }).size)
      .toEqual({ width: 420, height: 297 })
  })

  it('keeps the guided-setup restart in the section it belongs to', () => {
    const { unmount } = open()
    expect(screen.getByRole('button', { name: 'Restart guided setup' })).toBeInTheDocument()
    unmount()

    open()
    goto('3D viewport')
    expect(screen.queryByRole('button', { name: 'Restart guided setup' })).not.toBeInTheDocument()
  })
})
