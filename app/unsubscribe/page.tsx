import type { Metadata } from 'next'
import SiteNav from '../components/SiteNav'
import SiteFooter from '../components/SiteFooter'

export const metadata: Metadata = {
  title: 'Unsubscribe',
  robots: { index: false, follow: false, noarchive: true },
}

const backend = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')

/** Server-side unsubscribe: the token in the link is the credential, no
 * account needed. The backend records the row unsubscribed for good, so a
 * list export/alert shows the same truth everywhere. */
async function unsubscribe(token: string): Promise<{ ok: boolean; message: string }> {
  if (!backend) return { ok: false, message: 'This deployment is not configured for the Folio backend.' }
  if (!/^[0-9a-f-]{36}$/i.test(token)) return { ok: false, message: 'That unsubscribe link is not valid.' }
  try {
    const response = await fetch(`${backend}/newsletter/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    })
    const body = (await response.json().catch(() => null)) as { ok?: boolean; alreadyUnsubscribed?: boolean } | null
    if (!response.ok || !body?.ok) {
      return { ok: false, message: 'The server refused the request. Try again later.' }
    }
    return {
      ok: true,
      message: body.alreadyUnsubscribed
        ? 'You were already unsubscribed. Nothing more to do.'
        : 'You are unsubscribed. You will not receive further newsletters.',
    }
  } catch {
    return { ok: false, message: 'The backend did not answer. Try again later, or reply to the newsletter and ask us to remove you.' }
  }
}

export default async function UnsubscribePage({ searchParams }: { searchParams: { token?: string } }) {
  const token = typeof searchParams?.token === 'string' ? searchParams.token : ''
  const outcome = token ? await unsubscribe(token) : { ok: false, message: 'No unsubscribe token in the link.' }
  return (
    <>
      <a className="skip-link" href="#main">Skip to main content</a>
      <SiteNav />

      <main id="main" className="wrap">
        <section className="hero-copy" style={{ padding: '5rem 0', textAlign: 'center' }}>
          <p className="eyebrow">Newsletter</p>
          <h1 style={{ fontSize: '2rem' }}>{outcome.ok ? 'Unsubscribed.' : 'Could not unsubscribe'}</h1>
          <p className="lede" style={{ marginInline: 'auto' }}>{outcome.message}</p>
          <p style={{ marginTop: '1.5rem' }}><a className="btn btn-ghost" href="/">Back to home</a></p>
        </section>
      </main>

      <SiteFooter />
    </>
  )
}
