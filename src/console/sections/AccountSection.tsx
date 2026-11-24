/**
 * Account — who is on this device (or in this deployment).
 *
 * The standalone build has no identity system: each person gets a local
 * profile — a name and an avatar, nothing else — and the workbench always
 * opens. There is no session to signal, so the UI says "active profile",
 * not "signed in".
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Check, LogOut, Plus, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import HoverHelp from '../../components/ui/HoverHelp'
import Avatar from '../../components/Avatar'
import AccountSecurityPanel from '../../components/AccountSecurityPanel'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { cloudConfig } from '../../lib/cloudConfig'
import { loadSignInMethods, type SignInMethod } from '../../lib/auth/signInMethods'
import { supabase } from '../../lib/supabase'
import { useLocalProfileStore } from '../../stores/useLocalProfileStore'
import type { User } from '../../types'

interface AccountSectionProps {
  offlineMode: boolean
  user: User | null
  onSignedOut: () => void
}

type MethodsState =
  | { status: 'loading' }
  | { status: 'ready'; methods: SignInMethod[] }
  | { status: 'error'; message: string }

export default function AccountSection({ offlineMode, user, onSignedOut }: AccountSectionProps) {
  const profiles = useLocalProfileStore((state) => state.profiles)
  const activeProfileId = useLocalProfileStore((state) => state.activeProfileId)
  const setActiveProfile = useLocalProfileStore((state) => state.setActiveProfile)
  const addProfile = useLocalProfileStore((state) => state.addProfile)
  const removeProfile = useLocalProfileStore((state) => state.removeProfile)

  const [newName, setNewName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [error, setError] = useState('')
  const [signingOut, setSigningOut] = useState(false)
  const [methods, setMethods] = useState<MethodsState>({ status: 'loading' })

  useEffect(() => {
    if (offlineMode) return
    const controller = new AbortController()
    setMethods({ status: 'loading' })
    void loadSignInMethods({
      url: cloudConfig.apiUrl,
      anonKey: cloudConfig.resolvedAnonKey,
      signal: controller.signal,
    })
      .then((list) => setMethods({ status: 'ready', methods: list }))
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return
        setMethods({
          status: 'error',
          message: reason instanceof Error ? reason.message : 'The request failed.',
        })
      })
    return () => controller.abort()
  }, [offlineMode])

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

  const signOut = async () => {
    // Only rendered in cloud mode — the standalone console has no session.
    setSigningOut(true)
    await supabase?.auth.signOut()
    onSignedOut()
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* Passkeys and authenticator enrolment need a signed-in account, so they
          are only offered in the online build. */}
      {!offlineMode && <AccountSecurityPanel />}
      {offlineMode ? (
        <section aria-labelledby="accounts-heading">
          <h2 id="accounts-heading" className="text-sm font-bold text-foreground">People on this device</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            One profile per person who uses this machine. The workbench looks the same for everyone.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {profiles.map((profile) => {
              const isActive = profile.id === activeProfileId
              return (
                <li
                  key={profile.id}
                  className={`flex items-start gap-3 rounded-xl border p-3 ${isActive ? 'border-primary/50 bg-primary/5' : 'border-border/70 bg-card/60'}`}
                >
                  <Avatar name={profile.name} size={40} className="h-10 w-10 flex-shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold text-foreground">{profile.name}</span>
                    <span className="block text-[10px] text-muted-foreground">{isActive ? 'Active' : 'Not active'}</span>
                  </span>
                  {!isActive && (
                    <>
                      <HoverHelp title={`Switch to ${profile.name}`} description={`Make ${profile.name} the active profile on this device.`}>
                        <Button variant="ghost" size="sm" onClick={() => setActiveProfile(profile.id)} aria-label={`Switch to ${profile.name}`}>
                          <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </HoverHelp>
                      <HoverHelp title={`Forget ${profile.name}`} description={`Delete ${profile.name} from this device. This cannot be undone.`}>
                        <Button variant="ghost" size="sm" onClick={() => removeProfile(profile.id)} aria-label={`Forget profile ${profile.name}`} className="hover:text-destructive">
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </Button>
                      </HoverHelp>
                    </>
                  )}
                </li>
              )
            })}
            <li className="rounded-xl border border-dashed border-border/80 p-3">
              {createOpen ? (
                <form onSubmit={submit} className="flex items-center gap-2">
                  <Label htmlFor="console-new-profile" className="sr-only">New profile name</Label>
                  <Input
                    id="console-new-profile"
                    autoFocus
                    value={newName}
                    onChange={(event) => { setNewName(event.target.value); setError('') }}
                    placeholder="Ada Lovelace"
                    maxLength={120}
                    required
                    aria-label="New profile name"
                  />
                  <Button type="submit" size="sm" disabled={newName.trim().length < 2}>Add</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setCreateOpen(false); setNewName(''); setError('') }}>Cancel</Button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreateOpen(true)}
                  className="flex h-full w-full items-center justify-center gap-2 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                  Add another person on this device
                </button>
              )}
              {error && <p role="alert" className="mt-2 text-[11px] text-destructive">{error}</p>}
            </li>
          </ul>
        </section>
      ) : (
        <section aria-labelledby="account-heading">
          <h2 id="account-heading" className="text-sm font-bold text-foreground">Your account</h2>
          <dl className="mt-3 divide-y divide-border/70 rounded-xl border border-border/70 bg-card/60 text-xs">
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Email</dt>
              <dd className="truncate font-medium text-foreground">{user?.email ?? '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-4 p-3">
              <dt className="text-muted-foreground">Account id</dt>
              <dd className="truncate font-mono text-[11px] text-muted-foreground">{user?.id ?? '—'}</dd>
            </div>
          </dl>
          <h3 className="mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Sign-in methods</h3>
          {methods.status === 'loading' && (
            <p className="mt-2 text-xs text-muted-foreground">Reading this deployment's sign-in methods…</p>
          )}
          {methods.status === 'error' && (
            <p className="mt-2 text-xs text-muted-foreground">
              {`The identity service could not be asked which methods it accepts: ${methods.message}`}
            </p>
          )}
          {methods.status === 'ready' && methods.methods.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              This deployment reports no enabled sign-in methods.
            </p>
          )}
          {methods.status === 'ready' && methods.methods.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {methods.methods.map((method) => (
                <li key={method.id} className="flex items-start justify-between gap-4 rounded-lg border border-border/60 bg-card/40 px-3 py-2 text-xs">
                  <span className="font-medium text-foreground">{method.label}</span>
                  <span className="text-muted-foreground">Enabled by this deployment</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {offlineMode ? (
        <section aria-labelledby="device-heading" className="rounded-xl border border-border/70 bg-card/40 p-4">
          <h2 id="device-heading" className="text-sm font-bold text-foreground">This device</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Designs stay on this machine — the profile only decides who opened the workbench last.
          </p>
        </section>
      ) : (
        <section aria-labelledby="signout-heading" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 id="signout-heading" className="text-sm font-bold text-foreground">Sign out</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                Ends this session on this browser. Your designs stay on the server.
              </p>
            </div>
            <Button variant="outline" onClick={() => void signOut()} disabled={signingOut} className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10">
              <LogOut className="h-4 w-4" aria-hidden="true" />
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
