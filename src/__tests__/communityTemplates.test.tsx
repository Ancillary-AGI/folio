/**
 * The launcher section: curated seeds render from the box with working
 * curation data, opening routes through the caller, and export/import are
 * the offline sharing path.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CommunityTemplates from '../components/community/CommunityTemplates'
import { CURATED_TEMPLATES } from '../lib/community/community'

const baseProps = {
  onOpenTemplate: vi.fn(),
  onImportFile: vi.fn(),
}

describe('CommunityTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders every curated seed with its open action and team attribution', async () => {
    render(<CommunityTemplates {...baseProps} />)
    expect(await screen.findByRole('heading', { name: /start from proven designs/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^open /i }).length).toBe(CURATED_TEMPLATES.length)
    for (const template of CURATED_TEMPLATES) {
      expect(screen.getByText(template.name)).toBeInTheDocument()
    }
    expect(screen.getAllByText(/Folio team/i).length).toBeGreaterThan(0)
  })

  it('opens a curated template through the caller, read-only', async () => {
    const onOpenTemplate = vi.fn()
    render(<CommunityTemplates {...baseProps} onOpenTemplate={onOpenTemplate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Open Half-wave rectifier, start to gerber' }))

    expect(onOpenTemplate).toHaveBeenCalledTimes(1)
    expect(onOpenTemplate).toHaveBeenCalledWith(expect.objectContaining({ id: 'curated-rectifier-pcb' }))
  })

  it('offers export and import as the offline sharing path', async () => {
    render(<CommunityTemplates {...baseProps} />)
    expect(await screen.findByRole('button', { name: /export the current design as a shareable file/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import a community design file/i })).toBeInTheDocument()
  })
})
