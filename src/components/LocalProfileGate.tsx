/**
 * The standalone front door.
 *
 * Shown once, before anything else, on deployments with no configured cloud:
 * the designer names themselves — nothing leaves the machine — and the studio
 * unlocks. One screen, one field that matters, no ceremony about sync.
 */
import { useState, type FormEvent } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Label } from './ui/label'
import FolioLogo from './brand/FolioLogo'
import { useLocalProfileStore } from '../stores/useLocalProfileStore'

export default function LocalProfileGate() {
  const setProfile = useLocalProfileStore((state) => state.setProfile)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const nameValid = name.trim().length >= 2

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!nameValid) return
    setProfile({ name: name.trim(), email: email.trim() })
  }

  return (
    <main className="launcher-shell flex min-h-screen flex-col items-center justify-center bg-background px-6" aria-label="Create your workspace">
      <div className="w-full max-w-md">
        <FolioLogo markClassName="h-10 w-10 text-primary" wordmarkClassName="h-4 text-foreground" showTagline />
        <h1 className="mt-8 text-2xl font-extrabold tracking-[-0.03em] text-foreground">
          Folio Engineering Workbench
        </h1>
        <p className="mt-1 text-[11px] font-medium uppercase tracking-[0.22em] text-primary">Your first schematic, one prompt away</p>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Sign in to place your first part, run the solver, route the board and
          walk out with a fab package. Everything runs on this machine first —
          nothing leaves your device until you publish it.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4" aria-label="Create your workspace profile">
          <div>
            <Label htmlFor="profile-name">Your name</Label>
            <Input
              id="profile-name"
              autoFocus
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ada Lovelace"
              maxLength={120}
              required
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="profile-email">
              Email <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="profile-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              maxLength={180}
              className="mt-1"
            />
          </div>
          <Button
            type="submit"
            className="h-11 w-full gap-2 text-sm font-semibold"
            disabled={!nameValid}
          >
            Create workspace
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>

        <p className="mt-6 text-[11px] leading-relaxed text-muted-foreground/80">
          Stored on this device in your browser — nothing leaves it. Configure the Folio
          cloud (VITE_SUPABASE_URL) for accounts, shared projects and community publishing.
        </p>
      </div>
    </main>
  )
}
