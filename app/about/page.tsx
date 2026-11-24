import type { Metadata } from 'next'
import SiteNav from '../components/SiteNav'
import SiteFooter from '../components/SiteFooter'
import LegalPage from '../components/LegalPage'
import { loadLegalPage } from '../../src/lib/legal/legalPages'

export async function generateMetadata(): Promise<Metadata> {
  const page = await loadLegalPage('about')
  return {
    title: page?.title || 'About',
    ...(page?.lede ? { description: page.lede } : {}),
    alternates: { canonical: '/about' },
  }
}

export default function AboutPage() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <SiteNav />

      <main id="main" className="wrap">
        <LegalPage slug="about" />
      </main>

      <SiteFooter />
    </>
  )
}