/**
 * The community templates surface: curated seeds render from the box with
 * working curation data, curated forks route through the demo loader, and
 * export/import are lossless.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import CommunityTemplates from '../components/community/CommunityTemplates'
import { CURATED_TEMPLATES } from '../lib/community/community'

describe('CommunityTemplates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders every curated seed with licence and fork action', async () => {
    render(<CommunityTemplates onPrepareForkProject={async () => true} onOpenDemo={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: /start from proven designs/i })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^fork /i }).length).toBe(CURATED_TEMPLATES.length)
    for (const template of CURATED_TEMPLATES) {
      expect(screen.getByText(template.name)).toBeInTheDocument()
    }
    expect(screen.getAllByText('CC-BY-4.0').length).toBeGreaterThan(0)
  })

  it('forks a curated template through the same demo loader as the gallery', async () => {
    const onOpenDemo = vi.fn()
    const onPrepare = vi.fn().mockResolvedValue(true)
    render(<CommunityTemplates onPrepareForkProject={onPrepare} onOpenDemo={onOpenDemo} />)

    fireEvent.click(screen.getByRole('button', { name: 'Fork Half-wave rectifier, start to gerber' }))

    expect(onPrepare).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(onOpenDemo).toHaveBeenCalledWith('rectifier-pcb'))
  })

  it('offers export and import as the offline sharing path', async () => {
    render(<CommunityTemplates onPrepareForkProject={async () => true} onOpenDemo={vi.fn()} />)
    expect(await screen.findByRole('button', { name: /export the current design as a template file/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /import a template file/i })).toBeInTheDocument()
  })
})
