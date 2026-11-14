import HoverHelp from './ui/HoverHelp'
import React, { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button } from './ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Mail, Lock, User, Eye, EyeOff } from 'lucide-react'
import FolioLogo from './brand/FolioLogo'

interface AuthFormProps {
  onAuthSuccess: () => void
}

export default function AuthForm({ onAuthSuccess }: AuthFormProps) {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setNotice('')
    setLoading(true)

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        })
        if (error) throw error
      } else {
        if (password !== confirmPassword) {
          throw new Error('Passwords do not match')
        }
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters')
        }

        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName,
            },
          },
        })
        if (error) throw error
        if (!data.session) {
          // Email confirmation is enabled on this project: no session yet, so
          // `onAuthSuccess` would fire into nothing. Tell the user what happens next.
          setNotice(`Account created. Confirm ${email} using the link we sent, then sign in.`)
          setIsLogin(true)
          return
        }
      }

      onAuthSuccess()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleAuth = async () => {
    setError('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin,
        },
      })
      if (error) throw error
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred')
      setLoading(false)
    }
  }

  const handleGitHubAuth = async () => {
    setError('')
    setLoading(true)

    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: window.location.origin,
        },
      })
      if (error) throw error
    } catch (error) {
      setError(error instanceof Error ? error.message : 'An error occurred')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        {/* The lockup is left-aligned everywhere it appears, so the mark and the
            wordmark start on the same edge as the fields below them. */}
        <CardHeader>
          <div className="mb-4 flex items-center">
            <FolioLogo
              markClassName="h-11 w-11 flex-shrink-0 text-primary"
              wordmarkClassName="h-5 w-auto text-foreground"
              showTagline
            />
          </div>
          <CardTitle className="sr-only">Folio</CardTitle>
          <p className="text-muted-foreground">
            {isLogin ? 'Sign in to your account' : 'Create your account'}
          </p>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
                <input
                  type="text"
                  placeholder="Full Name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-foreground placeholder:text-muted-foreground"
                  required={!isLogin}
                />
              </div>
            )}

            <div className="relative">
              <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
              <input
                type="email"
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-foreground placeholder:text-muted-foreground"
                required
              />
            </div>

            <div className="relative">
              <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-12 text-foreground placeholder:text-muted-foreground"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide the password' : 'Show the password'}
                title={showPassword ? 'Hide the password' : 'Show the password'}
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              >
                {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
              </button>
            </div>

            {!isLogin && (
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-5 h-5" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Confirm Password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border border-input bg-background py-2 pl-10 pr-4 text-foreground placeholder:text-muted-foreground"
                  required={!isLogin}
                />
              </div>
            )}

            {error && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </div>
            )}
            {notice && (
              <div role="status" className="rounded-lg border border-info/30 bg-info/10 px-4 py-3 text-sm text-info">
                {notice}
              </div>
            )}



            <Button
              type="submit"
              disabled={loading}
              className="w-full"
            >
              {loading ? (
                <div className="flex items-center justify-center">
                  <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin mr-2" />
                  {isLogin ? 'Signing in...' : 'Creating account...'}
                </div>
              ) : (
                isLogin ? 'Sign In' : 'Create Account'
              )}
            </Button>
          </form>

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
              </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
              <Button
              type="button"
              variant="outline"
              onClick={handleGoogleAuth}
              disabled={loading}
              className="w-full"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleGitHubAuth}
              disabled={loading}
              className="w-full"
            >
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .5C5.7.5.7 5.5.7 11.8c0 5 3.2 9.3 7.7 10.8.6.1.8-.2.8-.5v-2c-3.1.7-3.8-1.3-3.8-1.3-.5-1.3-1.2-1.7-1.2-1.7-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 2 2.7 1.4 3.3 1 .1-.8.4-1.4.7-1.7-2.5-.3-5.2-1.3-5.2-5.6 0-1.2.4-2.3 1.1-3.1-.1-.3-.5-1.5.1-3.1 0 0 .9-.3 3 1.2a10.4 10.4 0 0 1 5.5 0c2.1-1.5 3-1.2 3-1.2.6 1.6.2 2.8.1 3.1.7.8 1.1 1.9 1.1 3.1 0 4.3-2.7 5.3-5.2 5.6.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.5-1.5 7.7-5.8 7.7-10.8C23.3 5.5 18.3.5 12 .5z"/>
              </svg>
              Continue with GitHub
            </Button>

            <HoverHelp title="X Industries SSO ships with the X Industries identity provider rollout." description="X Industries SSO ships with the X Industries identity provider rollout.">
<Button type="button"
              variant="outline"
              disabled aria-label="X Industries SSO — for X Industries employees; shipping when the identity provider rollout lands."
              className="w-full cursor-not-allowed opacity-50">
              <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M4 4h7l4 7-5.5 9H4l5.5-9L4 4zm9 0h7l-4 6-3-6z"/>
              </svg>
              Continue with X Industries
            </Button>
</HoverHelp>
          </div>
          </div>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => { setIsLogin(!isLogin); setError(''); setNotice('') }}
              className="text-sm font-medium text-primary hover:underline"
            >
              {isLogin
                ? "Don't have an account? Sign up"
                : 'Already have an account? Sign in'}
            </button>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
