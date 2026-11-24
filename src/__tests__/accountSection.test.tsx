import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AccountSection from '../console/sections/AccountSection'
import type { User } from '../types'

const user: User = {
  id: 'user-1',
  name: 'Ada Okoro',
  email: 'ada@example.com',
  role: 'engineer',
}

function settingsResponse(external: Record<string, boolean>): Response {
  return new Response(JSON.stringify({ external }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => settingsResponse({ email: true, github: true })))
})

describe('AccountSection sign-in methods', () => {
  it('lists the providers the deployment reports, not a baked-in list', async () => {
    render(<AccountSection offlineMode={false} user={user} onSignedOut={vi.fn()} />)

    expect(await screen.findByText('Email and password')).toBeInTheDocument()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getAllByText('Enabled by this deployment')).toHaveLength(2)
    expect(screen.queryByText('Google')).not.toBeInTheDocument()
    expect(screen.queryByText('X Industries')).not.toBeInTheDocument()
  })

  it('says the deployment accepts none when every provider is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => settingsResponse({ email: false, github: false })))

    render(<AccountSection offlineMode={false} user={user} onSignedOut={vi.fn()} />)

    expect(await screen.findByText('This deployment reports no enabled sign-in methods.')).toBeInTheDocument()
  })

  it('distinguishes an unreachable identity service from an empty provider set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })))

    render(<AccountSection offlineMode={false} user={user} onSignedOut={vi.fn()} />)

    expect(await screen.findByText(/could not be asked which methods it accepts: The identity service answered 503\./)).toBeInTheDocument()
    expect(screen.queryByText('This deployment reports no enabled sign-in methods.')).not.toBeInTheDocument()
  })
})
