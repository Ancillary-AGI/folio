import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Activity, ArrowUpRight, Eye, EyeOff, Gauge, Shield, ShieldAlert, Users } from 'lucide-react'
import { Button } from '../components/ui/button'
import { FolioMark } from '../components/brand/FolioLogo'
import AdminConsole from './AdminConsole'
import { createAdminApi } from '../lib/admin/adminService'
import {
  operatorClient, resolveOperator, signInOperator, signOutOperator, type Operator,
} from '../lib/admin/operatorSession'

/*
 * The gate in front of the operator console.
 *
 * Three doors, and only one of them opens: no deployment configured, no operator
 * session, or a signed-in account that is not an operator. Authority is the
 * `profiles` row the server holds, and the tables behind the console are
 * restricted to operators by row-level security — so this screen is a courtesy,
 * not the boundary. A designer who finds this URL gets a sign-in form and a
 * refusal, never a directory.
 */

type Gate =
  | { kind: 'checking' }
  | { kind: 'signin'; reason?: string }
  | { kind: 'ready'; operator: Operator }

const DUTIES = [
  { icon: Users, title: 'Accounts', detail: 'Who can sign in, what role they hold, and whose access to suspend.' },
  { icon: Activity, title: 'Usage', detail: 'What the product is actually used for, per account and per domain.' },
  { icon: Gauge, title: 'Quotas', detail: 'The limits each role gets, enforced by the database on every insert.' },
  { icon: Shield, title: 'Audit trail', detail: 'An append-only record of every change an operator made.' },
]

function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(70% 55% at 12% -8%, hsl(var(--primary) / 0.20), transparent 70%),'
            + 'radial-gradient(60% 50% at 88% 4%, hsl(var(--chart-4) / 0.16), transparent 72%),'
            + 'radial-gradient(80% 60% at 50% 108%, hsl(var(--chart-2) / 0.12), transparent 70%)',
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(hsl(var(--border) / 0.5) 1px, transparent 1px),'
            + 'linear-gradient(90deg, hsl(var(--border) / 0.5) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(70% 60% at 50% 30%, black, transparent 78%)',
          WebkitMaskImage: 'radial-gradient(70% 60% at 50% 30%, black, transparent 78%)',
        }}
      />
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-background">
      <Backdrop />
      {children}
    </div>
  )
}

function WorkbenchLink() {
  return (
    <a
      href="/"
      className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
    >
      Open the engineering workbench <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
    </a>
  )
}

export default function AdminApp() {
  const [db] = useState(() => operatorClient())
  const [gate, setGate] = useState<Gate>({ kind: 'checking' })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!db) return
    let alive = true
    void resolveOperator(db).then((resolution) => {
      if (!alive) return
      setGate(resolution.operator ? { kind: 'ready', operator: resolution.operator } : { kind: 'signin', reason: resolution.reason })
    })
    return () => { alive = false }
  }, [db])

  const submit = useCallback(async (event: FormEvent) => {
    event.preventDefault()
    if (!db || busy) return
    setBusy(true)
    setError('')
    const result = await signInOperator(db, email, password)
    setBusy(false)
    if (result.operator) {
      setPassword('')
      setGate({ kind: 'ready', operator: result.operator })
      return
    }
    setPassword('')
    setError(result.error ?? result.reason ?? 'Sign-in was refused.')
  }, [db, busy, email, password])

  const signOut = useCallback(async () => {
    if (db) await signOutOperator(db)
    setGate({ kind: 'signin' })
  }, [db])

  if (!db) {
    return (
      <Shell>
        <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
          <div className="rounded-xl border border-border bg-card/80 p-8 backdrop-blur-sm">
            <FolioMark className="h-9 w-9 text-primary" />
            <h1 className="mt-5 text-xl font-semibold text-foreground">No deployment to operate</h1>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              This console manages the accounts, usage and policies of a running Folio deployment. This build has none
              configured, so there is nothing here to administer — and no local directory to invent.
            </p>
            <p className="mt-4 rounded-md border border-input bg-background px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              Set <span className="font-medium text-foreground">VITE_SUPABASE_URL</span> and{' '}
              <span className="font-medium text-foreground">VITE_SUPABASE_ANON_KEY</span> on the build, apply the admin
              migrations, then promote the first operator in the deployment database.
            </p>
            <div className="mt-6"><WorkbenchLink /></div>
          </div>
        </main>
      </Shell>
    )
  }

  if (gate.kind === 'checking') {
    return (
      <Shell>
        <main className="flex flex-1 items-center justify-center px-6">
          <p role="status" className="text-sm text-muted-foreground">Checking operator access…</p>
        </main>
      </Shell>
    )
  }

  if (gate.kind === 'ready') {
    return <AdminConsole operator={gate.operator} api={createAdminApi(db, gate.operator)} onSignOut={() => { void signOut() }} />
  }

  return (
    <Shell>
      <div className="mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-6 py-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
        <section className="min-w-0">
          <div className="flex items-center gap-3">
            <FolioMark className="h-9 w-9 flex-shrink-0 text-primary" />
            <div className="min-w-0">
              <p className="text-base font-semibold leading-tight text-foreground">folio</p>
              <p className="text-[11px] text-muted-foreground">operations console</p>
            </div>
          </div>
          <h1 className="mt-7 text-2xl font-semibold leading-tight text-foreground sm:text-3xl">
            Run the product.<br />Manage the people who use it.
          </h1>
          <p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
            This is the internal console for the team that operates Folio. It is not part of the engineering workbench,
            and a designer&apos;s account cannot open it.
          </p>
          <ul className="mt-7 grid gap-3 sm:grid-cols-2">
            {DUTIES.map((duty) => {
              const Icon = duty.icon
              return (
                <li key={duty.title} className="rounded-lg border border-border bg-card/60 p-3 backdrop-blur-sm">
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
                    <span className="text-xs font-semibold text-foreground">{duty.title}</span>
                  </div>
                  <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground">{duty.detail}</p>
                </li>
              )
            })}
          </ul>
        </section>

        <section className="min-w-0">
          <form
            onSubmit={(event) => { void submit(event) }}
            className="rounded-xl border border-border bg-card/85 p-6 shadow-xl backdrop-blur-sm sm:p-7"
          >
            <h2 className="text-base font-semibold text-foreground">Operator sign-in</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Use the account an owner granted operator access to on this deployment.
            </p>

            {gate.reason && (
              <p role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs leading-relaxed text-warning">
                <ShieldAlert className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                <span>{gate.reason}</span>
              </p>
            )}
            {error && (
              <p role="alert" className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs leading-relaxed text-destructive">
                {error}
              </p>
            )}

            <div className="mt-5 space-y-4">
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Operator email</span>
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@folio.team"
                  className="mt-1.5 min-h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none transition-[border-color,background-color] focus:border-ring focus-visible:ring-2 focus-visible:ring-ring"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-medium text-muted-foreground">Password</span>
                <span className="mt-1.5 flex min-h-10 items-center rounded-md border border-input bg-background pr-1 transition-[border-color] focus-within:border-ring">
                  <input
                    type={reveal ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="min-h-10 min-w-0 flex-1 bg-transparent px-3 text-sm text-foreground outline-none"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={reveal ? 'Hide password' : 'Show password'}
                    title={reveal ? 'Hide the password' : 'Show the password'}
                    onClick={() => setReveal((value) => !value)}
                  >
                    {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </span>
              </label>
            </div>

            <Button type="submit" className="mt-6 w-full" disabled={busy}>
              {busy ? 'Checking access…' : 'Sign in to the console'}
            </Button>

            <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
              Access is decided by the deployment, not by this form. Every read and write behind it is restricted to
              operator accounts by row-level security, and every change is written to the audit trail.
            </p>
            <div className="mt-5 border-t border-border pt-4"><WorkbenchLink /></div>
          </form>
        </section>
      </div>
    </Shell>
  )
}