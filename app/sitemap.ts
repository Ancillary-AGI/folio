import type { MetadataRoute } from 'next'
import { loadSiteSettings } from '../src/lib/site/siteSettings'
import { PUBLIC_ROUTES } from '../src/lib/site/routes'

/**
 * A sitemap is a list of absolute URLs, so it is only honest when the
 * deployment knows its own origin. An unconfigured site returns an empty
 * sitemap rather than a list of URLs pointing at somebody else's domain.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const settings = await loadSiteSettings()
  const base = settings.siteUrl
  if (!base) return []
  return PUBLIC_ROUTES.map((route) => ({
    url: `${base}${route.path === '/' ? '/' : route.path}`,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }))
}
