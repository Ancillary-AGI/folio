/**
 * The authentication form — the door every cloud user walks through.
 *
 * The Supabase client is mocked: the tests pin the form's behaviour (validation,
 * mode switching, error surfacing, OAuth dispatch) deterministically, and the
 * network is never touched. The one end-to-end claim this file cannot make —
 * that a live deployment round-trips a sign-in — needs the two env vars and a
 * project to point at; everything else about the form is checked here.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

const { signInWithPassword, signUp, signInWithOAuth } = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signInWithOAuth: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      signInWithPassword,
      signUp,
      signInWithOAuth,
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  },
}))

import AuthForm from '../components/AuthForm'

describe('AuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the sign-in form by default', () => {
    render(<AuthForm onAuthSuccess={() => {}} />)
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Email')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Password')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Full Name')).not.toBeInTheDocument()
  })

  it('switches to the sign-up form', () => {
    render(<AuthForm onAuthSuccess={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    expect(screen.getByPlaceholderText('Full Name')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Confirm Password')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create Account' })).toBeInTheDocument()
  })

  it('rejects mismatched passwords before any network call', async () => {
    render(<AuthForm onAuthSuccess={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ada@lovelace.dev' } })
    fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByPlaceholderText(/^Password$/), { target: { value: 'engine42' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm Password'), { target: { value: 'different' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Passwords do not match')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('rejects passwords shorter than six characters before any network call', async () => {
    render(<AuthForm onAuthSuccess={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ada@lovelace.dev' } })
    fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByPlaceholderText(/^Password$/), { target: { value: 'tiny' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm Password'), { target: { value: 'tiny' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('at least 6 characters')
    expect(signUp).not.toHaveBeenCalled()
  })

  it('signs in with email and password and reports success', async () => {
    const onAuthSuccess = vi.fn()
    signInWithPassword.mockResolvedValue({ error: null })
    render(<AuthForm onAuthSuccess={onAuthSuccess} />)
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ada@lovelace.dev' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'engine42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    await waitFor(() => expect(onAuthSuccess).toHaveBeenCalledTimes(1))
    expect(signInWithPassword).toHaveBeenCalledWith({ email: 'ada@lovelace.dev', password: 'engine42' })
  })

  it('shows the server error when sign-in fails', async () => {
    signInWithPassword.mockResolvedValue({ error: new Error('Invalid login credentials') })
    render(<AuthForm onAuthSuccess={() => {}} />)
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ada@lovelace.dev' } })
    fireEvent.change(screen.getByPlaceholderText('Password'), { target: { value: 'wrong-pass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
  })

  it('sign-up with email confirmation enabled does not sign the user in silently', async () => {
    const onAuthSuccess = vi.fn()
    // No session returned means email confirmation is required — the form must
    // not claim the user is signed in.
    signUp.mockResolvedValue({ data: { session: null, user: { id: 'u1' } }, error: null })
    render(<AuthForm onAuthSuccess={onAuthSuccess} />)
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ada@lovelace.dev' } })
    fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByPlaceholderText(/^Password$/), { target: { value: 'engine42' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm Password'), { target: { value: 'engine42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    expect(await screen.findByRole('status')).toHaveTextContent(/confirm ada@lovelace\.dev/i)
    expect(onAuthSuccess).not.toHaveBeenCalled()
  })

  it('sign-up with confirmation disabled (session returned) completes sign-in', async () => {
    const onAuthSuccess = vi.fn()
    signUp.mockResolvedValue({ data: { session: { access_token: 'tok' }, user: { id: 'u1' } }, error: null })
    render(<AuthForm onAuthSuccess={onAuthSuccess} />)
    fireEvent.click(screen.getByRole('button', { name: /sign up/i }))
    fireEvent.change(screen.getByPlaceholderText('Email'), { target: { value: 'ada@lovelace.dev' } })
    fireEvent.change(screen.getByPlaceholderText('Full Name'), { target: { value: 'Ada Lovelace' } })
    fireEvent.change(screen.getByPlaceholderText(/^Password$/), { target: { value: 'engine42' } })
    fireEvent.change(screen.getByPlaceholderText('Confirm Password'), { target: { value: 'engine42' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    await waitFor(() => expect(onAuthSuccess).toHaveBeenCalledTimes(1))
  })

  it('dispatches the Google OAuth flow', async () => {
    signInWithOAuth.mockResolvedValue({ error: null })
    render(<AuthForm onAuthSuccess={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' }),
    )
  })

  it('dispatches the GitHub OAuth flow', async () => {
    signInWithOAuth.mockResolvedValue({ error: null })
    render(<AuthForm onAuthSuccess={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /continue with github/i }))
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'github' }),
    )
  })

  it('surfaces OAuth misconfiguration as an error, not a silent spin', async () => {
    signInWithOAuth.mockResolvedValue({ error: new Error('provider is not enabled') })
    render(<AuthForm onAuthSuccess={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }))
    expect(await screen.findByRole('alert')).toHaveTextContent('provider is not enabled')
  })
})
