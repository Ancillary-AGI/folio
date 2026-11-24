/**
 * Site identity for the public shell.
 *
 * These values are deployment data, read from `public.site_settings` at runtime.
 * An unset column yields `undefined`, and the shell omits that element rather
 * than inventing a value — a self-hosted deployment is not the company named in
 * the defaults, and must not be presented as one.
 */
import { cloudConfig } from '../cloudConfig'

export interface SiteSettings {
  /** Product name shown in the footer lockup, page titles and accessible names. */
  productName?: string
  /** The company behind the product, as named in the footer. */
  parentCompany?: string
  /** The short line under the footer lockup. */
  tagline?: string
  /** The default page description and social-card description. */
  description?: string
  /** Where support, security and takedown mail goes. */
  contactEmail?: string
  /** Canonical origin, used for metadata, sitemap and robots. No trailing slash. */
  siteUrl?: string
  githubUrl?: string
  codebergUrl?: string
  /** The published vulnerability-handling policy, linked from /security. */
  securityPolicyUrl?: string
}

/** A `mailto:` href for the contact address, or undefined when unset. */
export const contactHref = (settings: SiteSettings): string | undefined =>
  settings.contactEmail ? `mailto:${settings.contactEmail}` : undefined

/** A non-empty plain-text field. */
const plain = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

/** A link field: only schemes the shell can safely render as an anchor. */
const link = (value: unknown): string | undefined => {
  const trimmed = plain(value)
  if (!trimmed) return undefined
  return /^(https?:\/\/|mailto:)/i.test(trimmed) ? trimmed : undefined
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** An absolute site origin: http(s), no trailing slash. */
const origin = (value: unknown): string | undefined => {
  const trimmed = plain(value)
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return undefined
  try {
    const url = new URL(trimmed)
    const path = url.pathname.replace(/\/+$/, '')
    return path === '' ? url.origin : `${url.origin}${path}`
  } catch {
    return undefined
  }
}

/**
 * Turn a stored row into settings, or undefined when the row is unusable.
 *
 * Plain-text fields and link fields are checked differently: a company name is
 * not a URL, and running it through the link check would silently drop it.
 */
export function parseSiteSettings(value: unknown): SiteSettings | undefined {
  if (!value || typeof value !== 'object') return undefined
  const row = value as Record<string, unknown>
  const settings: SiteSettings = {}
  const productName = plain(row.product_name)
  if (productName) settings.productName = productName
  const parentCompany = plain(row.parent_company)
  if (parentCompany) settings.parentCompany = parentCompany
  const tagline = plain(row.tagline)
  if (tagline) settings.tagline = tagline
  const description = plain(row.description)
  if (description) settings.description = description
  const contact = plain(row.contact_email)
  if (contact && EMAIL.test(contact)) settings.contactEmail = contact
  const site = origin(row.site_url)
  if (site) settings.siteUrl = site
  const github = link(row.github_url)
  if (github) settings.githubUrl = github
  const codeberg = link(row.codeberg_url)
  if (codeberg) settings.codebergUrl = codeberg
  const security = link(row.security_policy_url)
  if (security) settings.securityPolicyUrl = security
  return settings
}

/** The empty settings object: every element omitted. */
export const NO_SITE_SETTINGS: SiteSettings = Object.freeze({})

/**
 * Read the deployment's identity.
 *
 * Returns empty settings when the deployment is unconfigured, has no row, or the
 * read failed. The shell then renders only what it can verify.
 */
export async function loadSiteSettings(signal?: AbortSignal): Promise<SiteSettings> {
  try {
    const query = new URLSearchParams({
      select: 'product_name,parent_company,tagline,description,contact_email,site_url,github_url,codeberg_url,security_policy_url',
      limit: '1',
    })
    const response = await fetch(`${cloudConfig.apiUrl}/rest/v1/site_settings?${query.toString()}`, {
      headers: { apikey: cloudConfig.resolvedAnonKey, Accept: 'application/json' },
      signal,
    })
    if (!response.ok) return NO_SITE_SETTINGS
    const rows = (await response.json()) as unknown
    if (!Array.isArray(rows) || rows.length === 0) return NO_SITE_SETTINGS
    return parseSiteSettings(rows[0]) ?? NO_SITE_SETTINGS
  } catch {
    return NO_SITE_SETTINGS
  }
}