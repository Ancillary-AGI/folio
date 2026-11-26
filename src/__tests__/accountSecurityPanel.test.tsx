import { beforeEach, describe, expect, it, vi } from 'vitest'

/* The panel is thin over Supabase Auth, so what is worth testing is the
 * behaviour that matters: a refusal is shown rather than swallowed, a failed
 * enrolment does not claim success, and an unsupported backend is reported
 * instead of pretending a credential was stored. */
vi.mock('../lib/supabase', () => ({ supabase: { auth: {} } }))

import { supabase } from '../lib/supabase'

const auth = supabase.auth as unknown as {
  passkey: { list: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> }
  registerPasskey: ReturnType<typeof vi.fn>
  mfa: { listFactors: ReturnType<typeof vi.fn>; enroll: ReturnType<typeof vi.fn>; unenroll: ReturnType<typeof vi.fn> }
}

const ok = <T,>(data: T) => ({ data, error: null })

beforeEach(() => {
  vi.clearAllMocks()
  auth.passkey = { list: vi.fn(async () => ok([])), delete: vi.fn(async () => ok(null)) }
  auth.mfa = {
    listFactors: vi.fn(async () => ok({ totp: [], all: [] })),
    enroll: vi.fn(async () => ok({ id: 'factor-1', type: 'totp' })),
    unenroll: vi.fn(async () => ok({ id: 'factor-1' })),
  }
  auth.registerPasskey = vi.fn(async () => ok({ id: 'pk-1' }))
})

describe('AccountSecurityPanel data flow', () => {
  it('lists passkeys and factors from the auth client', async () => {
    const { default: AccountSecurityPanel } = await import('../components/AccountSecurityPanel')
    const { render, screen, waitFor } = await import('@testing-library/react')

    auth.passkey.list.mockResolvedValue(ok([
      { id: 'pk-1', friendly_name: 'MacBook Touch ID', last_used_at: '2026-11-01T00:00:00Z' },
    ]))
    auth.mfa.listFactors.mockResolvedValue(ok({
      totp: [{ id: 'f-1', friendly_name: 'Phone', status: 'verified' }],
      all: [],
    }))

    render(<AccountSecurityPanel />)

    await waitFor(() => {
      expect(screen.getByText('MacBook Touch ID')).toBeInTheDocument()
    })
    expect(screen.getByText('Phone')).toBeInTheDocument()
    expect(screen.getByText(/Last used/)).toBeInTheDocument()
  })

  it('reports an unsupported backend instead of claiming success', async () => {
    const { default: AccountSecurityPanel } = await import('../components/AccountSecurityPanel')
    const { render, screen, waitFor } = await import('@testing-library/react')

    auth.passkey.list.mockResolvedValue({ data: null, error: new Error('404 Not Found') })

    render(<AccountSecurityPanel />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/does not provide the passkey API/i)
    })
  })

  it('surfaces a registration refusal rather than reporting success', async () => {
    const { default: AccountSecurityPanel } = await import('../components/AccountSecurityPanel')
    const { render, screen, waitFor } = await import('@testing-library/react')
    const { fireEvent } = await import('@testing-library/react')

    auth.registerPasskey.mockResolvedValue({ data: null, error: new Error('User cancelled the passkey ceremony') })

    render(<AccountSecurityPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /add a passkey/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/cancelled/i)
    })
  })

  it('reports a failed enrolment as failed, not as success', async () => {
    const { default: AccountSecurityPanel } = await import('../components/AccountSecurityPanel')
    const { render, screen, waitFor } = await import('@testing-library/react')
    const { fireEvent } = await import('@testing-library/react')

    auth.mfa.enroll.mockResolvedValue({ data: null, error: new Error('TOTP enrolment is disabled') })

    render(<AccountSecurityPanel />)
    fireEvent.click(await screen.findByRole('button', { name: /enrol an authenticator/i }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/TOTP enrolment is disabled/i)
    })
  })
})