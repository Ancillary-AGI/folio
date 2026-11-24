import type { MetadataRoute } from 'next'
import { loadSiteSettings } from '../src/lib/site/siteSettings'

/**
 * The web app manifest, served at `/manifest.webmanifest` — the URL
 * `app/layout.tsx` declares in its metadata.
 *
 * Like `robots.ts` and `sitemap.ts`, it is a route rather than a static file, so
 * the product name comes from `site_settings` and a fork or self-hosted
 * deployment is not presented as the shipped one. The colours are the shell's
 * own tokens, and the icons are the ones actually in `public/`.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const settings = await loadSiteSettings()
  const name = settings.productName ?? 'Folio'

  return {
    name,
    short_name: name,
    ...(settings.description ? { description: settings.description } : {}),
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#07080D',
    theme_color: '#07080D',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}