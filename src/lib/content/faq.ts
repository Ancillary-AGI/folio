/**
 * The public FAQ.
 *
 * Questions and answers are operator-owned rows in `public.faq_entries`; the
 * migration seeds the shipped copy. There is no baked-in fallback in the
 * bundle: an unconfigured deployment says the FAQ is not published rather than
 * showing copy nobody can edit.
 */
import { cloudConfig } from '../cloudConfig'

/** The public page an entry belongs to. */
export const FAQ_SURFACES = ['home', 'pricing'] as const
export type FaqSurface = (typeof FAQ_SURFACES)[number]

export const isFaqSurface = (value: unknown): value is FaqSurface =>
  value === 'home' || value === 'pricing'

export interface PublicFaqEntry {
  question: string
  answer: string
}

export function parseFaqRows(value: unknown): PublicFaqEntry[] {
  if (!Array.isArray(value)) return []
  const entries: PublicFaqEntry[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Record<string, unknown>
    const question = typeof row.question === 'string' ? row.question.trim() : ''
    const answer = typeof row.answer === 'string' ? row.answer.trim() : ''
    if (question && answer) entries.push({ question, answer })
  }
  return entries
}

export async function loadPublicFaq(
  surface: FaqSurface = 'home',
  signal?: AbortSignal,
): Promise<PublicFaqEntry[]> {
  try {
    const query = new URLSearchParams({
      select: 'question,answer',
      surface: `eq.${surface}`,
      published: 'eq.true',
      order: 'position.asc,id.asc',
    })
    const response = await fetch(`${cloudConfig.apiUrl}/rest/v1/faq_entries?${query.toString()}`, {
      headers: { apikey: cloudConfig.resolvedAnonKey, Accept: 'application/json' },
      signal,
    })
    if (!response.ok) return []
    return parseFaqRows(await response.json())
  } catch {
    return []
  }
}
