/**
 * The standalone deployment's sign-in.
 *
 * A device-local identity picker: choose who is working, or claim a new
 * identity. No server is involved; nothing leaves this machine. There is no
 * hosted sign-in in this build — the local profile is the whole flow.
 */
import { useState, type FormEvent } from 'react'
import { ArrowRight, AlertCircle, Plus, X } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import FolioLogo from './brand/FolioLogo'
import Avatar from './Avatar'
import { useLocalProfileStore } from '../stores/useLocalProfileStore'


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

      </div>
    </main>
  )
}
