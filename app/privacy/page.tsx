import type { Metadata } from 'next'
import SiteNav from '../components/SiteNav'
import SiteFooter from '../components/SiteFooter'
import LegalPage from '../components/LegalPage'
import { loadLegalPage } from '../../src/lib/legal/legalPages'

export async function generateMetadata(): Promise<Metadata> {
  const page = await loadLegalPage('privacy')
  return {
    title: page?.title || 'Privacy',
    ...(page?.lede ? { description: page.lede } : {}),
    alternates: { canonical: '/privacy' },
  }
}

export default function PrivacyPage() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <SiteNav />

      <main id="main" className="wrap">
        <LegalPage slug="privacy" />
      </main>

      <SiteFooter />
    </>
  )
}