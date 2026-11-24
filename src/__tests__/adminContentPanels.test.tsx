import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import LegalPanel from '../admin/LegalPanel'
import RichTextEditor, { type RichTextEditorHandle } from '../admin/RichTextEditor'
import SiteSettingsPanel from '../admin/SiteSettingsPanel'
import type { AdminApi, LegalPageEntry, SiteSettingsEntry } from '../lib/admin/adminService'
import type { LegalPageSection } from '../lib/legal/legalPages'
import type { RichTextBlock } from '../lib/legal/richText'

/*
 * The content panels are the operator's only route to the public copy, so the
 * tests exercise the contract that matters: what is read is what is shown, what
 * is shown is what is saved, and a failure is said out loud instead of leaving
 * the impression that a page was published.
 */

const NOW = Date.UTC(2026, 10, 21, 12, 0, 0)

const body = (text: string, bold = false): RichTextBlock[] => [
  { type: 'paragraph', runs: [{ text, ...(bold ? { bold: true } : {}) }] },
]

function siteSettings(overrides: Partial<SiteSettingsEntry> = {}): SiteSettingsEntry {
  return {
    productName: 'Folio',
    parentCompany: 'X Industries',
    tagline: 'Engineering workbench.',
    description: 'Verified engineering.',
    contactEmail: 'founder@folio.dev',
    siteUrl: 'https://folio.dev',
    githubUrl: 'https://github.com/Ancillary-AGI/folio',
    codebergUrl: 'https://codeberg.org/X-Industries',
    securityPolicyUrl: 'https://github.com/Ancillary-AGI/folio/blob/main/SECURITY.md',
    updatedAt: NOW,
    ...overrides,
  }
}

function legalPage(overrides: Partial<LegalPageEntry> = {}): LegalPageEntry {
  return {
    slug: 'about',
    title: 'About Folio',
    eyebrow: 'About',
    heading: 'A workbench, not a chat box.',
    lede: 'We build verified engineering tools.',
    sections: [
      { heading: 'Why', body: body('Because guesses are expensive.') },
      { heading: 'How', body: body('By checking the arithmetic.') },
    ],
    updatedAt: NOW,
    ...overrides,
  }
}

function siteApi(settings: SiteSettingsEntry | null, overrides: {
  readError?: string
  saveResult?: { ok: boolean; error?: string; warning?: string }
} = {}) {
  const calls = {
    loadSiteSettings: vi.fn(async () => ({ settings, error: overrides.readError })),
    saveSiteSettings: vi.fn(async (_settings: import('../lib/site/siteSettings').SiteSettings) => overrides.saveResult ?? { ok: true }),
  }
  return { api: calls as unknown as AdminApi, calls }
}

function legalApi(entries: LegalPageEntry[], overrides: {
  readError?: string
  saveResult?: { ok: boolean; error?: string; warning?: string }
} = {}) {
  const calls = {
    listLegalPages: vi.fn(async () => ({ entries, error: overrides.readError })),
    saveLegalPage: vi.fn(async (_entry: Omit<LegalPageEntry, 'updatedAt'>) => overrides.saveResult ?? { ok: true }),
  }
  return { api: calls as unknown as AdminApi, calls }
}

describe('SiteSettingsPanel', () => {
  it('shows the stored identity and previews the footer from the draft', async () => {
    const { api } = siteApi(siteSettings())
    render(<SiteSettingsPanel api={api} onReload={vi.fn()} />)

    expect(await screen.findByLabelText('Product name')).toHaveValue('Folio')
    expect(screen.getByLabelText('Company')).toHaveValue('X Industries')
    expect(screen.getByLabelText('Contact address')).toHaveValue('founder@folio.dev')

    expect(screen.getByText('Folio')).toBeInTheDocument()
    expect(screen.getByText(/a product of X Industries/)).toBeInTheDocument()
    expect(screen.getByText('founder@folio.dev')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Product name'), { target: { value: 'Workbench' } })
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: '' } })
    fireEvent.change(screen.getByLabelText('Contact address'), { target: { value: '' } })

    expect(screen.getByText('Workbench')).toBeInTheDocument()
    expect(screen.queryByText(/a product of/)).not.toBeInTheDocument()
    expect(screen.getByText('The contact column is omitted until an address is set.')).toBeInTheDocument()
  })

  it('saves trimmed values and announces success', async () => {
    const { api, calls } = siteApi(siteSettings())
    const onReload = vi.fn()
    render(<SiteSettingsPanel api={api} onReload={onReload} />)

    const product = await screen.findByLabelText('Product name')
    fireEvent.change(product, { target: { value: '  Workbench  ' } })
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: '  ' } })
    fireEvent.click(screen.getByRole('button', { name: /save identity/i }))

    await waitFor(() => expect(calls.saveSiteSettings).toHaveBeenCalledTimes(1))
    expect(calls.saveSiteSettings).toHaveBeenCalledWith(expect.objectContaining({
      productName: 'Workbench',
      parentCompany: undefined,
      contactEmail: 'founder@folio.dev',
    }))
    expect(await screen.findByText(/^Saved\. The public site uses these values/)).toBeInTheDocument()
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('reports a generator warning instead of claiming the site updated', async () => {
    const { api } = siteApi(siteSettings(), { saveResult: { ok: true, warning: 'Audit write failed.' } })
    render(<SiteSettingsPanel api={api} onReload={vi.fn()} />)

    await screen.findByLabelText('Product name')
    fireEvent.click(screen.getByRole('button', { name: /save identity/i }))

    expect(await screen.findByText('Audit write failed.')).toBeInTheDocument()
  })

  it('reports a save failure and leaves the draft on screen', async () => {
    const { api } = siteApi(siteSettings(), { saveResult: { ok: false, error: 'Only content managers may edit identity.' } })
    render(<SiteSettingsPanel api={api} onReload={vi.fn()} />)

    await screen.findByLabelText('Product name')
    fireEvent.click(screen.getByRole('button', { name: /save identity/i }))

    expect(await screen.findByText('Only content managers may edit identity.')).toBeInTheDocument()
    expect(screen.getByLabelText('Product name')).toHaveValue('Folio')
  })

  it('explains a missing table instead of offering a form that cannot save', async () => {
    const { api } = siteApi(null, { readError: 'relation "site_settings" does not exist' })
    render(<SiteSettingsPanel api={api} onReload={vi.fn()} />)

    expect(await screen.findByText(/could not be read: relation "site_settings" does not exist/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Product name')).not.toBeInTheDocument()
    expect(screen.getByText(/Apply the site-settings migration/)).toBeInTheDocument()
  })
})

describe('LegalPanel', () => {
  it('lists every fixed page and names the ones the deployment has not stored', async () => {
    const { api } = legalApi([legalPage()])
    render(<LegalPanel api={api} onReload={vi.fn()} />)

    expect(await screen.findByText('About Folio')).toBeInTheDocument()
    expect(screen.getByText('/about · 2 sections')).toBeInTheDocument()
    expect(screen.getByText('/terms · not stored; the page will say it is unconfigured')).toBeInTheDocument()
    expect(screen.getByText('/privacy · not stored; the page will say it is unconfigured')).toBeInTheDocument()
    expect(screen.getByText('/security · not stored; the page will say it is unconfigured')).toBeInTheDocument()
  })

  it('opens the stored page and saves the editor document, not stale component state', async () => {
    const { api, calls } = legalApi([legalPage()])
    const onReload = vi.fn()
    render(<LegalPanel api={api} onReload={onReload} />)

    const editButtons = await screen.findAllByRole('button', { name: /^edit$/i })
    fireEvent.click(editButtons[0])

    expect(await screen.findByRole('heading', { name: 'About Folio' })).toBeInTheDocument()
    expect(screen.getByLabelText('Browser title')).toHaveValue('About Folio')
    expect(screen.getByLabelText('Section 1 body')).toBeInTheDocument()

    fireEvent.change(screen.getAllByLabelText('Section heading')[0], { target: { value: 'Why it exists' } })
    fireEvent.click(screen.getByRole('button', { name: /save page/i }))

    await waitFor(() => expect(calls.saveLegalPage).toHaveBeenCalledTimes(1))
    const entry = calls.saveLegalPage.mock.calls[0][0] as { sections: LegalPageSection[] }
    expect(entry.sections).toHaveLength(2)
    expect(entry.sections[0]).toMatchObject({
      heading: 'Why it exists',
      body: [{ type: 'paragraph', runs: [{ text: 'Because guesses are expensive.' }] }],
    })
    expect(entry.sections[1].heading).toBe('How')
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('drops a section that has a heading but no body', async () => {
    const emptySection: LegalPageSection = { heading: 'Empty', body: [] }
    const { api, calls } = legalApi([legalPage({ sections: [legalPage().sections[0], emptySection] })])
    render(<LegalPanel api={api} onReload={vi.fn()} />)

    const editButtons = await screen.findAllByRole('button', { name: /^edit$/i })
    fireEvent.click(editButtons[0])
    fireEvent.click(await screen.findByRole('button', { name: /save page/i }))

    await waitFor(() => expect(calls.saveLegalPage).toHaveBeenCalledTimes(1))
    const entry = calls.saveLegalPage.mock.calls[0][0] as { sections: LegalPageSection[] }
    expect(entry.sections).toHaveLength(1)
    expect(entry.sections[0].heading).toBe('Why')
  })

  it('refuses to store a page with no usable section', async () => {
    const { api, calls } = legalApi([legalPage({ sections: [{ heading: 'Only a heading', body: [] }] })])
    render(<LegalPanel api={api} onReload={vi.fn()} />)

    const editButtons = await screen.findAllByRole('button', { name: /^edit$/i })
    fireEvent.click(editButtons[0])
    fireEvent.click(await screen.findByRole('button', { name: /save page/i }))

    expect(await screen.findByText('Add at least one section with a heading and some text.')).toBeInTheDocument()
    expect(calls.saveLegalPage).not.toHaveBeenCalled()
  })

  it('reports a read failure without pretending the pages are empty', async () => {
    const { api } = legalApi([], { readError: 'permission denied for table legal_pages' })
    render(<LegalPanel api={api} onReload={vi.fn()} />)

    expect(await screen.findByText(/could not be read: permission denied for table legal_pages/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })
})

describe('RichTextEditor', () => {
  it('renders the stored document into the editable surface and reads it back', async () => {
    const ref = createRef<RichTextEditorHandle>()
    const value = body('Verified', true)
    render(<RichTextEditor id="body" label="Body" value={value} ref={ref} />)

    const editor = screen.getByRole('textbox', { name: 'Body' })
    expect(editor.innerHTML).toBe('<p><strong>Verified</strong></p>')
    expect(ref.current?.read()).toEqual(value)
  })

  it('previews the document as semantic elements', async () => {
    render(<RichTextEditor id="body" label="Body" value={body('Preview me')} />)

    expect(screen.queryByText(/The section is empty/)).not.toBeInTheDocument()
    /* The editable surface already contains the text; the preview adds a
       second, read-only rendering of the same document. */
    expect(screen.getAllByText('Preview me')).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
    expect(screen.getAllByText('Preview me')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Hide preview' }))
    expect(screen.getAllByText('Preview me')).toHaveLength(1)
  })

  it('rejects a link scheme that would not survive normalisation', async () => {
    render(<RichTextEditor id="body" label="Body" value={body('Link me')} />)

    fireEvent.change(screen.getByLabelText('Link target'), { target: { value: 'javascript:alert(1)' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))

    expect(await screen.findByText('Links must start with https://, http:// or mailto:.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Body' }).innerHTML).toBe('<p>Link me</p>')
  })
})
