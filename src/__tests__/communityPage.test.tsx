/**
 * The dedicated /community page: hero + full grid, search, discipline
 * filter, empty state, opening designs and keyboard exit.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import CommunityPage from '../components/community/CommunityPage'
import { CURATED_TEMPLATES } from '../lib/community/community'

const baseProps = {
  onBack: vi.fn(),
  onOpenTemplate: vi.fn(),
  onImportFile: vi.fn(),
}

describe('CommunityPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the hero and every curated template with an open action', async () => {
    render(<CommunityPage {...baseProps} />)
    expect(screen.getByRole('heading', { name: /proven designs/i })).toBeInTheDocument()
    expect((await screen.findAllByRole('button', { name: /^open /i })).length).toBe(CURATED_TEMPLATES.length)
    for (const template of CURATED_TEMPLATES) {
      expect(screen.getByText(template.name)).toBeInTheDocument()
    }
  })

  it('narrows the grid with search and restores it when cleared', async () => {
    render(<CommunityPage {...baseProps} />)
    const search = screen.getByRole('textbox', { name: /search community templates/i })

    fireEvent.change(search, { target: { value: 'rectifier' } })
    expect(screen.getByText('Half-wave rectifier, start to gerber')).toBeInTheDocument()
    expect(screen.queryByText('Warren truss bridge')).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'zzz-no-such-design' } })
    expect(screen.getByText(/nothing matches/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /clear search and filters/i }))
    expect(screen.getByText('Warren truss bridge')).toBeInTheDocument()
  })

  it('filters by discipline and toggles back off', async () => {
    render(<CommunityPage {...baseProps} />)
    const rfChip = screen.getByRole('button', { name: /^RF \(1\)$/ })

    fireEvent.click(rfChip)
    expect(screen.getByText('Butterworth low-pass filter')).toBeInTheDocument()
    expect(screen.queryByText('Warren truss bridge')).not.toBeInTheDocument()

    fireEvent.click(rfChip)
    expect(screen.getByText('Warren truss bridge')).toBeInTheDocument()
  })

  it('opens a curated template through the caller', async () => {
    const onOpenTemplate = vi.fn()
    render(<CommunityPage {...baseProps} onOpenTemplate={onOpenTemplate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Half-wave rectifier, start to gerber' }))

    expect(onOpenTemplate).toHaveBeenCalledTimes(1)
    expect(onOpenTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 'curated-rectifier-pcb' }))
  })

  it('leaves the page with the back button and with Escape', () => {
    const onBack = vi.fn()
    const { unmount } = render(<CommunityPage {...baseProps} onBack={onBack} />)

    fireEvent.click(screen.getByRole('button', { name: /back to projects/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
    unmount()

    render(<CommunityPage {...baseProps} onBack={onBack} />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onBack).toHaveBeenCalledTimes(2)
  })
})
