import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import ShortcutEditor from '../components/help/ShortcutEditor'
import { useShortcutStore } from '../stores/useShortcutStore'

beforeEach(() => {
  useShortcutStore.setState({ overrides: {} })
  localStorage.removeItem('folio.shortcuts.v1')
})

describe('shortcut editor', () => {
  it('records a new chord, saves it and shows it in the sheet', () => {
    render(<ShortcutEditor query="" />)

    fireEvent.click(screen.getByRole('button', { name: 'Change binding for Select tool' }))
    expect(screen.getByText(/press keys/i)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'q' })

    expect(useShortcutStore.getState().overrides['schematic.selectTool']).toEqual({ key: 'q' })
    expect(JSON.parse(localStorage.getItem('folio.shortcuts.v1')!).overrides['schematic.selectTool'])
      .toEqual({ key: 'q' })
    // The row now advertises the new chord and offers a reset.
    expect(screen.getByRole('button', { name: 'Change binding for Select tool' })).toHaveTextContent('Q')
    expect(screen.getByRole('button', { name: 'Reset the binding for Select tool' })).toBeInTheDocument()
  })

  it('refuses a chord another action in the same scope already owns', () => {
    render(<ShortcutEditor query="" />)

    fireEvent.click(screen.getByRole('button', { name: 'Change binding for Wire tool' }))
    fireEvent.keyDown(window, { key: 'v' })

    expect(screen.getByRole('alert')).toHaveTextContent('Select tool')
    expect(useShortcutStore.getState().overrides).toEqual({})
    // Capture stays open so the engineer can try again.
    expect(screen.getByText(/press keys/i)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByText(/press keys/i)).not.toBeInTheDocument()
  })

  it('resets one binding or all of them', () => {
    useShortcutStore.setState({
      overrides: {
        'schematic.selectTool': { key: 'q' },
        'schematic.wireTool': { key: 'e' },
      },
    })
    render(<ShortcutEditor query="" />)

    fireEvent.click(screen.getByRole('button', { name: 'Reset the binding for Select tool' }))
    expect(useShortcutStore.getState().overrides).toEqual({ 'schematic.wireTool': { key: 'e' } })

    fireEvent.click(screen.getByRole('button', { name: 'Reset all' }))
    expect(useShortcutStore.getState().overrides).toEqual({})
  })

  it('finds a row by its live chord, not only by its action name', () => {
    useShortcutStore.setState({ overrides: { 'schematic.selectTool': { key: 'q' } } })
    render(<ShortcutEditor query="q" />)

    expect(screen.getByRole('button', { name: 'Change binding for Select tool' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change binding for Rotate the selected parts 90°' })).toBeNull()
  })
})
