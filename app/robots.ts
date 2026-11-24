import type { MetadataRoute } from 'next'
import { loadSiteSettings } from '../src/lib/site/siteSettings'
import { PRIVATE_ROUTES, PUBLIC_ROUTES } from '../src/lib/site/routes'

export default async function robots(): Promise<MetadataRoute.Robots> {
  const settings = await loadSiteSettings()
  return {
    rules: [
      {
        userAgent: '*',
        allow: PUBLIC_ROUTES.map((route) => route.path),
        disallow: [...PRIVATE_ROUTES],
      },
    ],
    ...(settings.siteUrl ? { sitemap: `${settings.siteUrl}/sitemap.xml` } : {}),
  }
}
