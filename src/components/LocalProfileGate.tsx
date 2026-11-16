/**
 * The standalone deployment's sign-in.
 *
 * A device-local identity picker: choose who is working, or claim a new
 * identity. No server is involved; nothing leaves this machine. When the
 * Folio cloud is configured the hosted gate (Google, GitHub, X Industries,
 * email) is the door instead and this screen stays out of the way.
 */
import { useState, type FormEvent } from 'react'
import { ArrowRight, AlertCircle, Github, Plus, X, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import FolioLogo from './brand/FolioLogo'
import Avatar from './Avatar'
import { useLocalProfileStore } from '../stores/useLocalProfileStore'
import { supabase, isSupabaseConfigured } from '../lib/supabase'

/* The X Industries mark — one tone, parent-company identity. */
const XINDUSTRIES_MARK = (
  <svg className="h-4 w-6 flex-shrink-0" viewBox="0 0 120 80" fill="none" aria-hidden="true">
    <path d="M20 15 L50 40 L20 65 M100 15 L70 40 L100 65 M55 40 L65 40" stroke="currentColor" strokeWidth="8" strokeLinejoin="miter" strokeLinecap="square"/>
  </svg>
)

/* Google "G" — the mark the button actually navigates to, not a substitute. */
const GOOGLE_MARK = (
  <svg className="h-5 w-5 flex-shrink-0" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

export default function LocalProfileGate() {
  const profiles = useLocalProfileStore((state) => state.profiles)
  const setActiveProfile = useLocalProfileStore((state) => state.setActiveProfile)
  const addProfile = useLocalProfileStore((state) => state.addProfile)
  const removeProfile = useLocalProfileStore((state) => state.removeProfile)

  const [createOpen, setCreateOpen] = useState(profiles.length === 0)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const [cloudError, setCloudError] = useState('')
  const [signingIn, setSigningIn] = useState<string | null>(null)
  const nameValid = newName.trim().length >= 2

  const signInWith = async (provider: 'google' | 'github' | 'custom:xindustries') => {
    setCloudError('')
    setSigningIn(provider)
    try {
      if (!isSupabaseConfigured) {
        throw new Error('Cloud sign-in isn\'t available on this deployment. Create a local profile — it works fully offline on this machine.')
      }
      const redirectTo = window.location.origin
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo },
      })
      if (error) throw error
    } catch (thrown) {
      setCloudError(thrown instanceof Error ? thrown.message : String(thrown))
    } finally {
      setSigningIn(null)
    }
  }

  const signInWithGoogle = () => void signInWith('google')
  const signInWithGitHub = () => void signInWith('github')
  const signInWithXIndustries = () => void signInWith('custom:xindustries')

  const submit = (event: FormEvent) => {
    event.preventDefault()
    try {
      addProfile(newName)
      setNewName('')
      setError('')
      setCreateOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That name was refused.')
    }
  }

  const hasProfiles = profiles.length > 0

  return (
    <main className="launcher-shell flex min-h-screen items-center justify-center bg-background px-6" aria-label="Sign in to Folio">
      <div className="w-full max-w-md">
        <FolioLogo markClassName="h-9 w-9 text-primary" wordmarkClassName="h-4 text-foreground" showTagline />

        <h1 className="mt-8 text-2xl font-extrabold tracking-[-0.03em] text-foreground">
          {hasProfiles ? 'Who is working?' : 'Create your workspace'}
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {hasProfiles
            ? 'Choose a profile to sign in, or add a new one.'
            : 'One name — it stamps every commit and checkpoint. Designs stay on this device until you publish them.'}
        </p>

        {hasProfiles && (
          <ul className="mt-6 grid grid-cols-3 gap-2" aria-label="Local profiles">
            {profiles.map((profile) => (
              <li key={profile.id} className="group relative">
                <button
                  type="button"
                  onClick={() => setActiveProfile(profile.id)}
                  aria-label={`Sign in as ${profile.name}`}
                  className="group flex w-full flex-col items-center gap-1.5 rounded-xl border border-border/70 bg-card/50 px-2 pb-2.5 pt-3 transition-colors hover:border-primary/50 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Avatar name={profile.name} size={44} className="h-11 w-11 flex-shrink-0" />
                  <span className="w-full truncate text-center text-[11px] font-medium text-foreground">
                    {profile.name}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => removeProfile(profile.id)}
                  aria-label={`Forget profile ${profile.name}`}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/20 hover:text-destructive focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}

        {createOpen ? (
          <form onSubmit={submit} className="mt-4 space-y-3" aria-label="Create a new profile">
            <div>
              <Label htmlFor="profile-name">Your name</Label>
              <Input
                id="profile-name"
                autoFocus={!hasProfiles}
                autoComplete="name"
                placeholder="Ada Lovelace"
                maxLength={120}
                required
                aria-invalid={newName.length > 0 && !nameValid ? 'true' : undefined}
                className="mt-1.5"
                value={newName}
                onChange={(event) => { setNewName(event.target.value); setError('') }}
              />
            </div>
            {error && (
              <p role="alert" className="flex items-start gap-2 text-xs text-destructive">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                {error}
              </p>
            )}
            <div className="flex items-center gap-2">
              <Button type="submit" className="h-10 flex-1 gap-2 text-sm font-semibold" disabled={!nameValid}>
                Create workspace
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Button>
              {hasProfiles && (
                <Button type="button" variant="ghost" size="default" onClick={() => { setCreateOpen(false); setError(''); setNewName('') }}>
                  Cancel
                </Button>
              )}
            </div>
          </form>
        ) : (
          <Button variant="outline" className="mt-4 w-full gap-2" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            New profile
          </Button>
        )}

        <div className="mt-6">
          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
            <div className="relative flex justify-center"><span className="bg-background px-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">Or continue with</span></div>
          </div>

          <div className="mt-4 space-y-2">
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={signingIn !== null}
              aria-busy={signingIn === 'google'}
              aria-label="Continue with Google"
              className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border/70 bg-card/50 px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
            >
              {signingIn === 'google' ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
              ) : (
                GOOGLE_MARK
              )}
              <span>Continue with Google</span>
            </button>

            <button
              type="button"
              onClick={signInWithGitHub}
              disabled={signingIn !== null}
              aria-busy={signingIn === 'github'}
              aria-label="Continue with GitHub"
              className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border/70 bg-card/50 px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
            >
              {signingIn === 'github' ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
              ) : (
                <Github className="h-5 w-5 text-foreground" aria-hidden="true" />
              )}
              <span>Continue with GitHub</span>
            </button>

            <button
              type="button"
              onClick={signInWithXIndustries}
              disabled={signingIn !== null}
              aria-busy={signingIn === 'xindustries'}
              aria-label="Continue with X Industries"
              className="flex h-11 w-full items-center justify-center gap-3 rounded-lg border border-border/70 bg-card/50 px-4 text-sm font-semibold text-foreground transition-colors hover:border-primary/40 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70"
            >
              {signingIn === 'xindustries' ? (
                <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
              ) : (
                XINDUSTRIES_MARK
              )}
              <span>Continue with X Industries</span>
            </button>
          </div>

          {cloudError && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-border/80 bg-card/50 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-destructive" aria-hidden="true" />
              {cloudError}
            </p>
          )}

          <p className="mt-4 text-center text-[10px] leading-relaxed text-muted-foreground/60">
            Sign-in is optional — a local profile gives the same workbench on this machine.
          </p>
        </div>
      </div>
    </main>
  )
}
