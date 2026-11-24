import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import localFont from 'next/font/local'
import Script from 'next/script'
import ClientBootstrap from './components/ClientBootstrap'
import ErrorBoundary from '../src/components/ErrorBoundary'
import { loadSiteSettings } from '../src/lib/site/siteSettings'
import './globals.css'
import './site.css'

/*
 * The Folio face. Self-hosted, one file, one family for the whole site:
 * the marketing pages, the consoles and the workbench all set --font-archivo
 * here; the FOLIO lockup itself is outlined vector geometry, so the brand
 * renders identically even without the font installed. `theme-bootstrap.js`
 * runs before paint from the static shell and reads its own
 * data-theme-default — folio-dark everywhere; the stored preference still
 * wins for returning users.
 */
const archivo = localFont({
  src: '../public/fonts/Archivo-Variable.ttf',
  variable: '--font-archivo',
  display: 'swap',
  weight: '100 900',
  declarations: [{ prop: 'font-stretch', value: '62% 125%' }],
  fallback: ['system-ui', 'sans-serif'],
})

/*
 * Identity is deployment data, not bundle data. The title template, social
 * names, default description and canonical origin come from site_settings so a
 * fork or a self-hosted operator is not presented as the shipped deployment.
 */
export async function generateMetadata(): Promise<Metadata> {
  const settings = await loadSiteSettings()
  const name = settings.productName
  const description = settings.description
  const siteUrl = settings.siteUrl
  const metadataBase = siteUrl ? new URL(siteUrl) : undefined
  return {
    ...(metadataBase ? { metadataBase } : {}),
    ...(name ? { title: { default: name, template: `%s — ${name}` } } : {}),
    ...(description ? { description } : {}),
    ...(name ? { applicationName: name } : {}),
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/favicon.svg', type: 'image/svg+xml' },
        { url: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      ],
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
    },
    openGraph: {
      type: 'website',
      ...(name ? { siteName: name } : {}),
      ...(name ? { title: name } : {}),
      ...(description ? { description } : {}),
      url: '/',
      images: [{ url: '/hero-cad.jpg', width: 1200, height: 789, alt: name ? `${name} workbench showing a schematic, the DRC health panel and the assistant` : 'The engineering workbench' }],
      locale: 'en_US',
    },
    twitter: {
      card: 'summary_large_image',
      ...(name ? { title: name } : {}),
      ...(description ? { description } : {}),
      images: ['/hero-cad.jpg'],
    },
  }
}

/* A per-request CSP nonce cannot be stamped onto prerendered HTML, so the
 * security headers only exist on dynamically rendered documents — every
 * content page in this app ships that way and pays a request's latency,
 * accepted deliberately. The workbench route is client-only and hydrates
 * identically either way; the consoles are noindex and server-rendered
 * per request on purpose. */
export const dynamic = 'force-dynamic'

export const viewport: Viewport = {
  themeColor: '#07080D',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body>
        <Script src="/theme-bootstrap.js" strategy="beforeInteractive" data-theme-default="folio-dark" />
        <ClientBootstrap />
        {/* A render error anywhere in the tree would otherwise unmount the whole
            app to a white screen. The boundary keeps the failure in one place and
            says the design was autosaved. */}
        <ErrorBoundary>{children}</ErrorBoundary>
      </body>
    </html>
  )
}
