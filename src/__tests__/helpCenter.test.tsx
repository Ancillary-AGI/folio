import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import HelpCenter from '../components/help/HelpCenter'
import { TUTORIALS } from '../lib/tutorials/tutorials'

function renderHelp(overrides: Partial<Parameters<typeof HelpCenter>[0]> = {}) {
  const props = {
    open: true,
    onClose: vi.fn(),
    currentMode: 'schematic' as const,
    onOpenWorkspace: vi.fn(),
    onStartTutorial: vi.fn(),
    onOpenDemos: vi.fn(),
    onOpenLimits: vi.fn(),
    ...overrides,
  }
  render(<HelpCenter {...props} />)
  return props
}

describe('help center', () => {
  beforeEach(() => window.localStorage.clear())

  it('opens on the tutorial list and starts the chosen tutorial', () => {
    const props = renderHelp()
    expect(screen.getByRole('dialog', { name: /help and tutorials/i })).toBeInTheDocument()
    const starts = screen.getAllByRole('button', { name: /start tutorial/i })
    expect(starts).toHaveLength(TUTORIALS.length)

    fireEvent.click(starts[0])
    expect(props.onStartTutorial).toHaveBeenCalledWith(TUTORIALS[0])
  })

  it('filters tutorials by domain and reports an honest empty state', () => {
    renderHelp()
    const search = screen.getByRole('searchbox', { name: /search help/i })
    fireEvent.change(search, { target: { value: 'PID' } })
    expect(screen.getByText('PID: tune a motor loop and understand the trade')).toBeInTheDocument()
    expect(screen.queryByText('Rectifier: schematic to a routed board')).toBeNull()

    fireEvent.change(search, { target: { value: 'zzzz-no-such-term' } })
    expect(screen.getByText(/No tutorial matches/)).toBeInTheDocument()
  })

  it('opens a workspace guide and marks the workspace being viewed', () => {
    const props = renderHelp({ currentMode: 'rf' })
    fireEvent.click(screen.getByRole('tab', { name: /workspace guides/i }))
    expect(screen.getByText('Current')).toBeInTheDocument()

    const rfCard = screen.getByText('RF', { selector: 'p' }).closest('li')
    expect(rfCard).not.toBeNull()
    fireEvent.click(within(rfCard as HTMLElement).getByRole('button', { name: 'Open' }))
    expect(props.onOpenWorkspace).toHaveBeenCalledWith('rf')
  })

  it('lists the hover help copy and the real shortcut sheet', () => {
    renderHelp()
    fireEvent.click(screen.getByRole('tab', { name: /control reference/i }))
    expect(screen.getByText('Snap to grid')).toBeInTheDocument()
    expect(screen.getByText(/Land parts and wires on the grid pitch/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: /shortcuts/i }))
    expect(screen.getAllByText('Open help and tutorials')).toHaveLength(2)
    expect(screen.getByText('Close the open dialog or guide')).toBeInTheDocument()
  })

  it('keeps the open tab and query when the host re-renders', () => {
    const props = {
      open: true,
      currentMode: 'schematic' as const,
      onOpenWorkspace: vi.fn(),
      onStartTutorial: vi.fn(),
      onOpenDemos: vi.fn(),
      onOpenLimits: vi.fn(),
    }
    const { rerender } = render(<HelpCenter {...props} onClose={() => {}} />)

    fireEvent.click(screen.getByRole('tab', { name: /workspace guides/i }))
    fireEvent.change(screen.getByRole('searchbox', { name: /search help/i }), { target: { value: 'RF' } })

    // An inline close handler gets a new identity on every host render; that
    // must not snap the engineer back to the tutorial tab mid-search.
    rerender(<HelpCenter {...props} onClose={() => {}} />)

    expect(screen.getByRole('tab', { name: /workspace guides/i })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('searchbox', { name: /search help/i })).toHaveValue('RF')
  })

  it('closes on Escape and from the close button', () => {
    const props = renderHelp()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: /close help/i }))
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('links out to the demo gallery and the capability records', () => {
    const props = renderHelp()
    fireEvent.click(screen.getByRole('button', { name: /demo gallery/i }))
    fireEvent.click(screen.getByRole('button', { name: /capabilities and limits/i }))
    expect(props.onOpenDemos).toHaveBeenCalledTimes(1)
    expect(props.onOpenLimits).toHaveBeenCalledTimes(1)
  })
})
