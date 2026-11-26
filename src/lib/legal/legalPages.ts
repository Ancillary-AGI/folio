/**
 * Operator-editable copy for the public about, terms, privacy and security
 * pages, read at request time so an operator changes them without a redeploy.
 * A deployment with no row renders "not configured" rather than invented copy.
 */
import { cloudConfig } from '../cloudConfig'
import {
  normalizeRichText, safeRichTextHref, type RichTextBlock, type RichTextRun,
} from './richText'

/** The routes the public shell serves, in footer order. */
export const LEGAL_PAGE_SLUGS = [
  'about',
  'terms',
  'privacy',
  'security',
] as const

export type LegalPageSlug = (typeof LEGAL_PAGE_SLUGS)[number]

/**
 * One section of a legal page. The heading is a plain label; the body is a
 * normalised rich-text document (paragraphs, sub-headings, lists, quotes and
 * inline marks/links). No HTML is stored or injected.
 */
export interface LegalPageSection {
  heading: string
  body: RichTextBlock[]
}

export interface LegalPageContent {
  slug: LegalPageSlug
  title: string
  eyebrow: string
  heading: string
  lede: string
  sections: LegalPageSection[]
}

export const isLegalPageSlug = (value: string): value is LegalPageSlug =>
  (LEGAL_PAGE_SLUGS as readonly string[]).includes(value)

const text = (value: unknown, fallback = ''): string => (typeof value === 'string' ? value : fallback)

/**
 * Read the pre-rich-text section shape (`paragraphs` + `links`) into blocks.
 *
 * The migration converts stored rows, but a deployment can be running this
 * bundle against a database it has not migrated yet. Rendering the old rows as
 * paragraphs is more honest than replacing published legal copy with "not
 * configured" because the shape changed.
 */
function legacyBody(row: Record<string, unknown>): RichTextBlock[] {
  const paragraphs = Array.isArray(row.paragraphs)
    ? row.paragraphs.map((entry) => text(entry).trim()).filter((entry) => entry.length > 0)
    : []
  const body: RichTextBlock[] = paragraphs.map((paragraph) => ({
    type: 'paragraph',
    runs: [{ text: paragraph }],
  }))
  const links = Array.isArray(row.links) ? row.links : []
  const runs: RichTextRun[] = []
  for (const entry of links) {
    if (!entry || typeof entry !== 'object') continue
    const link = entry as Record<string, unknown>
    const label = text(link.label).trim()
    const href = safeRichTextHref(link.href)
    if (!label || !href) continue
    if (runs.length > 0) runs.push({ text: ' · ' })
    runs.push({ text: label, href })
  }
  if (runs.length > 0) body.push({ type: 'paragraph', runs })
  return normalizeRichText(body)
}

/** One stored section, in either the current or the legacy shape. */
export function parseLegalPageSection(value: unknown): LegalPageSection | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const heading = text(row.heading).trim()
  if (!heading) return undefined
  const body = Array.isArray(row.body) ? normalizeRichText(row.body) : legacyBody(row)
  if (body.length === 0) return undefined
  return { heading, body }
}

/** The stored `sections` column, normalised and with unusable rows dropped. */
export function parseLegalPageSections(value: unknown): LegalPageSection[] {
  if (!Array.isArray(value)) return []
  return value
    .map(parseLegalPageSection)
    .filter((section): section is LegalPageSection => section !== undefined)
}

/**
 * Turn a stored row into page content, or `undefined` when the row is unusable.
 *
 * A partially broken row must not take the page down: the caller shows the
 * "not configured" state instead, which is honest about what is missing.
 */
export function parseLegalPage(value: unknown): LegalPageContent | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const slug = text(row.slug).trim()
  if (!isLegalPageSlug(slug)) return undefined
  const title = text(row.title).trim()
  const heading = text(row.heading).trim()
  if (!title || !heading) return undefined
  const sections = parseLegalPageSections(row.sections)
  return {
    slug,
    title,
    eyebrow: text(row.eyebrow).trim() || title,
    heading,
    lede: text(row.lede).trim(),
    sections,
  }
}

const endpointFor = (slug: LegalPageSlug): string => {
  const query = new URLSearchParams({
    select: 'slug,title,eyebrow,heading,lede,sections',
    slug: `eq.${slug}`,
    limit: '1',
  })
  return `${cloudConfig.apiUrl}/rest/v1/legal_pages?${query.toString()}`
}

/**
 * Read one page from the deployment.
 *
 * `cloudConfig.apiUrl` resolves to the cloud project when one is configured and
 * to the bundled local backend otherwise, so this works in both modes. Returns
 * `undefined` when there is no row for this route or the read failed; callers
 * render a "not configured" state rather than inventing copy.
 */
export async function loadLegalPage(
  slug: LegalPageSlug,
  signal?: AbortSignal,
): Promise<LegalPageContent | undefined> {
  try {
    const response = await fetch(endpointFor(slug), {
      headers: { apikey: cloudConfig.resolvedAnonKey, Accept: 'application/json' },
      signal,
    })
    if (!response.ok) return undefined
    const rows = (await response.json()) as unknown
    if (!Array.isArray(rows) || rows.length === 0) return undefined
    return parseLegalPage(rows[0])
  } catch {
    return undefined
  }
}