'use client'

/**
 * The subscribe strip on the public site.
 *
 * It posts to this app's own `/api/newsletter/subscribe` rather than inserting
 * into the table directly, because the insert comes from an unauthenticated
 * visitor and has to be challenged first. The route verifies the CAPTCHA token,
 * then performs the same anon insert the table's RLS already allows.
 */
import { useCallback, useState, type FormEvent } from 'react'
import Captcha from '../../src/components/Captcha'

const backend = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/+$/, '')
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? ''

type Outcome =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done'; alreadyOnList: boolean }
  | { kind: 'failed'; message: string }

const fieldStyle = {
  minHeight: '2.4rem',
  borderRadius: '.5rem',
  border: '1px solid var(--line-strong)',
  background: 'var(--card)',
  color: 'var(--ink)',
  padding: '0 .7rem',
} as const

const labelStyle = {
  fontSize: '.68rem',
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--mute2)',
  fontWeight: 700,
} as const

export default function NewsletterSubscribe() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [token, setToken] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' })

  const onToken = useCallback((value: string | null) => setToken(value), [])

  // With no Supabase behind the page there is nowhere to subscribe to.
  if (!backend || !anon) return null

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (outcome.kind === 'sending') return
    setOutcome({ kind: 'sending' })
    try {
      const response = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), name: name.trim(), captchaToken: token }),
      })
      if (response.ok) {
        const body = (await response.json()) as { alreadyOnList?: boolean }
        setOutcome({ kind: 'done', alreadyOnList: Boolean(body.alreadyOnList) })
        return
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string }
      // A rejected token is single-use and spent: clear it so the next attempt
      // asks for a fresh challenge instead of resubmitting a dead one.
      if (response.status === 403) setToken(null)
      setOutcome({ kind: 'failed', message: body.error ?? `The server refused the request (${response.status}).` })
    } catch {
      setOutcome({ kind: 'failed', message: 'The backend did not answer. Try again in a moment.' })
    }
  }

  if (outcome.kind === 'done') {
    return (
      <p role="status" style={{ color: 'var(--ok)', fontSize: '.85rem', marginTop: '1rem' }}>
        {outcome.alreadyOnList ? 'You are already on the list.' : 'You are on the list. Important notices go out when there is something real to say.'}
      </p>
    )
  }

  return (
    <form onSubmit={submit} aria-label="Subscribe to the Folio newsletter" style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem', marginTop: '1rem', maxWidth: '34rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', flex: '1 1 14rem' }}>
        <label htmlFor="nl-email" style={labelStyle}>
          Newsletter
        </label>
        <input
          id="nl-email"
          type="email"
          required
          maxLength={254}
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          style={fieldStyle}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '.25rem', flex: '1 1 12rem' }}>
        <label htmlFor="nl-name" style={labelStyle}>
          Name — optional
        </label>
        <div style={{ display: 'flex', gap: '.4rem' }}>
          <input
            id="nl-name"
            type="text"
            maxLength={120}
            placeholder="Ada"
            value={name}
            onChange={(event) => setName(event.target.value)}
            style={{ ...fieldStyle, flex: '1 1 auto' }}
          />
          <button type="submit" className="btn btn-ghost" style={{ minHeight: '2.4rem' }} disabled={outcome.kind === 'sending'}>
            {outcome.kind === 'sending' ? 'Adding…' : 'Join'}
          </button>
        </div>
      </div>
      <Captcha onToken={onToken} action="newsletter-subscribe" className="w-full" />
      {outcome.kind === 'failed' && (
        <p role="alert" style={{ width: '100%', color: '#F58A8A', fontSize: '.8rem', margin: 0 }}>{outcome.message}</p>
      )}
    </form>
  )
}