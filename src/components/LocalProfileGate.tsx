/**
 * The standalone deployment's sign-in.
 *
 * A device-local identity picker: choose who is working, or claim a new
 * identity. No server is involved; nothing leaves this machine. When the
 * Folio cloud is configured the hosted gate (Google, GitHub, X Industries,
 * email) is the door instead and this screen stays out of the way.
 */
import { useState, type FormEvent } from 'react'
import { ArrowRight, AlertCircle, Plus, X } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import FolioLogo from './brand/FolioLogo'
import { useLocalProfileStore } from '../stores/useLocalProfileStore'

const GOOGLE_PATH = (
  <svg className="w-5 h-5" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
)

const GITHUB_PATH = (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.7.5.7 5.5.7 11.8c0 5 3.2 9.3 7.7 10.8.6.1.8-.2.8-.5v-2c-3.1.7-3.8-1.3-3.8-1.3-.5-1.3-1.2-1.7-1.2-1.7-1-.7.1-.7.1-.7 1.1.1 1.7 1.2 1.7 1.2 1 2 2.7 1.4 3.3 1 .1-.8.4-1.4.7-1.7-2.5-.3-5.2-1.3-5.2-5.6 0-1.2.4-2.3 1.1-3.1-.1-.3-.5-1.5.1-3.1 0 0 .9-.3 3 1.2a10.4 10.4 0 0 1 5.5 0c2.1-1.5 3-1.2 3-1.2.6 1.6.2 2.8.1 3.1.7.8 1.1 1.9 1.1 3.1 0 4.3-2.7 5.3-5.2 5.6.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.5-1.5 7.7-5.8 7.7-10.8C23.3 5.5 18.3.5 12 .5z"/>
  </svg>
)

const XINDUSTRIES_PATH = (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M4 4h7l4 7-5.5 9H4l5.5-9L4 4zm9 0h7l-4 6-3-6z"/>
  </svg>
)

const CLOUD_TITLE = 'Set VITE_SUPABASE_URL to enable hosted accounts with Google, GitHub and X Industries.'

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

export default function LocalProfileGate() {
  const profiles = useLocalProfileStore((state) => state.profiles)
  const setActiveProfile = useLocalProfileStore((state) => state.setActiveProfile)
  const addProfile = useLocalProfileStore((state) => state.addProfile)
  const removeProfile = useLocalProfileStore((state) => state.removeProfile)

  const [createOpen, setCreateOpen] = useState(profiles.length === 0)
  const [newName, setNewName] = useState('')
  const [error, setError] = useState('')
  const nameValid = newName.trim().length >= 2

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
                  <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/15 text-[13px] font-bold tracking-wide text-primary">
                    {initialsOf(profile.name)}
                  </span>
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
                value={newName}
                onChange={(event) => { setNewName(event.target.value); setError('') }}
                placeholder="Ada Lovelace"
                maxLength={120}
                required
                aria-invalid={newName.length > 0 && !nameValid ? 'true' : undefined}
                className="mt-1.5"
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
            <div className="relative flex justify-center"><span className="bg-background px-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80">Or use a cloud account</span></div>
          </div>

          <div className="mt-4 space-y-2">
            {[
              { label: 'Continue with Google', icon: GOOGLE_PATH },
              { label: 'Continue with GitHub', icon: GITHUB_PATH },
              { label: 'Continue with X Industries', icon: XINDUSTRIES_PATH },
            ].map(({ label, icon }) => (
              <button
                key={label}
                type="button"
                disabled
                title={CLOUD_TITLE}
                aria-label={`${label} — ${CLOUD_TITLE}`}
                className="flex h-11 w-full cursor-not-allowed items-center gap-3 rounded-lg border border-border/70 bg-card/40 px-4 text-sm font-semibold text-muted-foreground/50"
              >
                {icon}
                <span>{label}</span>
              </button>
            ))}
          </div>

          <p className="mt-4 text-center text-[11px] leading-relaxed text-muted-foreground/70">
            No account, no server, nothing leaves this browser. Set{' '}
            <code className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px]">VITE_SUPABASE_URL</code> to enable
            cloud accounts, teams and community publishing.
          </p>
        </div>
      </div>
    </main>
  )
}
