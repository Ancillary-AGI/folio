import type { Metadata } from 'next'
import SiteNav from '../components/SiteNav'
import SiteFooter from '../components/SiteFooter'
import LegalPage from '../components/LegalPage'
import { loadLegalPage } from '../../src/lib/legal/legalPages'

export async function generateMetadata(): Promise<Metadata> {
  const page = await loadLegalPage('terms')
  return {
    title: page?.title || 'Terms',
    ...(page?.lede ? { description: page.lede } : {}),
    alternates: { canonical: '/terms' },
  }
}

export default function TermsPage() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <SiteNav />

      <main id="main" className="wrap">
        <LegalPage slug="terms" />
      </main>

      <SiteFooter />
    </>
  )
}