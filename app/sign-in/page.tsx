import type { Metadata } from 'next'
import SiteNav from '../components/SiteNav'
import SiteFooter from '../components/SiteFooter'
import SignIn from './SignIn'

export const metadata: Metadata = {
  title: 'Sign in or sign up',
  robots: { index: false, follow: false, noarchive: true },
}

export default function SignInPage() {
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <SiteNav />
      <main id="main" className="wrap">
        <SignIn />
      </main>
      <SiteFooter />
    </>
  )
}
