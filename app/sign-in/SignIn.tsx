'use client'

/**
 * The front door for any deployment that has accounts (which is this one).
 * Email + password and the OAuth providers all go through the same AuthForm
 * the hosted gate uses; on success we hand the whole document to /app so the
 * workbench reboots with a live session. An unconfigured deployment gets an
 * honest notice instead of a dead form.
 */
import { useEffect, useState } from 'react'
import AuthForm from '../../src/components/AuthForm'
import { isSupabaseConfigured } from '../../src/lib/supabase'

function readMode(): 'signin' | 'signup' {
  if (typeof window === 'undefined') return 'signin'
  return new URLSearchParams(window.location.search).get('mode') === 'signup' ? 'signup' : 'signin'
}

export default function SignIn() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')

  useEffect(() => {
    setMode(readMode())
  }, [])

  return (
    <div className="hero" style={{ padding: '4rem 0 5rem' }}>
      {!isSupabaseConfigured && (
        <div role="status" className="wrap" style={{ marginBottom: '1.5rem' }}>
          <p
            style={{
              background: 'var(--card)',
              border: '1px solid var(--line-strong)',
              borderRadius: '.6rem',
              padding: '.9rem 1.1rem',
              color: 'var(--mute)',
              fontSize: '.85rem',
              maxWidth: '34rem',
              margin: '0 auto',
            }}
          >
            This deployment is not configured for accounts. Sign-in needs a backend: run{' '}
            <code style={{ color: 'var(--ink)' }}>npm run backend</code> (one command, one node process, embedded
            Postgres) and set <code style={{ color: 'var(--ink)' }}>VITE_SUPABASE_URL</code> to the address it prints —
            or point it at any Supabase project. See <code style={{ color: 'var(--ink)' }}>docs/DEPLOYMENT.md</code>.
          </p>
        </div>
      )}
      <AuthForm key={mode} defaultMode={mode} onAuthSuccess={() => window.location.assign('/app')} />
    </div>
  )
}
