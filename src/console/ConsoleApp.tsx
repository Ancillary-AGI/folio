/**
 * The user console — the account surface for the people who use Folio.
 *
 * A separate document on purpose: the website sells, the workbench designs,
 * the admin console operates, this one is yours. It holds your identity, the
 * usage this device actually recorded, the plan and limits that govern you,
 * and a complete download of your local data. It never touches the CAD, and
 * the CAD bundle never contains it.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity, CircleUserRound, Database, Gauge, LayoutDashboard, ArrowLeft, LogOut,
  type LucideIcon,
} from 'lucide-react'
import FolioLogo, { FolioMark } from '../components/brand/FolioLogo'
import LocalProfileGate from '../components/LocalProfileGate'
import AuthForm from '../components/AuthForm'
import { Button } from '../components/ui/button'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useActiveProfile, useLocalProfileStore } from '../stores/useLocalProfileStore'
import { readOwnGovernanceRole } from '../lib/admin/quotaSync'
import type { User } from '../types'
import OverviewSection from './sections/OverviewSection'
import AccountSection from './sections/AccountSection'
import UsageSection from './sections/UsageSection'
import PlanSection from './sections/PlanSection'
import DataSection from './sections/DataSection'

type SectionId = 'overview' | 'account' | 'usage' | 'plan' | 'data'

const SECTIONS: Array<{ id: SectionId; label: string; icon: LucideIcon }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'account', label: 'Account', icon: CircleUserRound },
  { id: 'usage', label: 'Usage', icon: Activity },
  { id: 'plan', label: 'Plan & limits', icon: Gauge },
  { id: 'data', label: 'Data', icon: Database },
]

function Backdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(70% 55% at 12% -8%, hsl(var(--primary) / 0.14), transparent 70%),'
            + 'radial-gradient(80% 60% at 50% 112%, hsl(var(--chart-2) / 0.10), transparent 72%)',
        }}
      />
    </div>
  )
}

export default function ConsoleApp() {
  const offlineMode = !isSupabaseConfigured
  const localProfile = useActiveProfile()
  const [section, setSection] = useState<SectionId>('overview')

  // Cloud session, mirrored into state. Offline mode never enters this path.
  const [cloudUser, setCloudUser] = useState<User | null>(null)
  const [sessionState, setSessionState] = useState<'checking' | 'in' | 'out'>(offlineMode ? 'in' : 'checking')

  useEffect(() => {
    if (offlineMode) return
    let cancelled = false
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled) return
      const user = (session?.user as unknown as User | undefined) ?? null
      setCloudUser(user)
      setSessionState(user ? 'in' : 'out')
    }).catch(() => {
      if (!cancelled) setSessionState('out')
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = (session?.user as unknown as User | undefined) ?? null
      setCloudUser(user)
      setSessionState(user ? 'in' : 'out')
    })
    return () => {
      cancelled = true
      subscription.unsubscribe()
    }
  }, [offlineMode])

  // Governance role rides on the same read the workbench does, so the plan
  // page shows the limits that genuinely apply to this account.
  useEffect(() => {
    if (offlineMode || !cloudUser?.id) return
    let alive = true
    void readOwnGovernanceRole(cloudUser.id).then((role) => {
      if (!alive) return
      setCloudUser((current) => (current && current.id === cloudUser.id ? { ...current, role } : current))
    })
    return () => { alive = false }
  }, [offlineMode, cloudUser?.id])

  const signedIn = useMemo(
    () => (offlineMode ? localProfile !== null : sessionState === 'in' && cloudUser !== null),
    [offlineMode, localProfile, sessionState, cloudUser],
  )

  /* Gates — the same doors as the workbench, so there is exactly one way in. */
  if (offlineMode && !localProfile) return <LocalProfileGate />
  if (!offlineMode && sessionState === 'checking') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background" role="status" aria-live="polite">
        <span className="text-sm text-muted-foreground">Opening your console…</span>
      </main>
    )
  }
  if (!offlineMode && sessionState === 'out') {
    return <AuthForm onAuthSuccess={() => {
      // The auth listener flips sessionState; nothing else to do here.
    }} />
  }
  if (!signedIn) return null

  const identity = offlineMode
    ? localProfile?.name ?? 'Workspace owner'
    : cloudUser?.email ?? 'Account'

  const handleSignedOut = () => {
    if (offlineMode) {
      // The gate renders from the store; nothing to clear here.
      return
    }
    setCloudUser(null)
    setSessionState('out')
  }

  const activeSection = SECTIONS.find((entry) => entry.id === section) ?? SECTIONS[0]

  const content: Record<SectionId, ReactNode> = {
    overview: (
      <OverviewSection
        offlineMode={offlineMode}
        user={cloudUser}
        localProfile={localProfile}
        onOpenSection={(next) => setSection(next)}
      />
    ),
    account: <AccountSection offlineMode={offlineMode} user={cloudUser} onSignedOut={handleSignedOut} />,
    usage: <UsageSection />,
    plan: <PlanSection offlineMode={offlineMode} user={cloudUser} />,
    data: <DataSection />,
  }

  const signOutQuick = async () => {
    if (offlineMode) {
      useLocalProfileStore.getState().clearActiveProfile()
      return
    }
    await supabase?.auth.signOut()
    handleSignedOut()
  }

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <Backdrop />

      {/* Sidebar — the section rail of a real account surface. */}
      <nav aria-label="Console sections" className="hidden w-60 flex-shrink-0 flex-col border-r border-border/70 px-4 py-5 md:flex">
        <FolioLogo markClassName="h-8 w-8 text-primary" wordmarkClassName="h-[15px] text-surface-foreground" showTagline={false} />
        <p className="mt-1.5 pl-11 text-[10px] font-bold uppercase tracking-[0.24em] text-muted-foreground">Console</p>
        <ul className="mt-6 space-y-1">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <li key={id}>
              <button
                type="button"
                onClick={() => setSection(id)}
                aria-current={section === id ? 'page' : undefined}
                className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${section === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}
              >
                <Icon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                {label}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-auto pt-6">
          <a
            href="/"
            className="block rounded-lg px-3 py-2 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Folio — the product website →
          </a>
          <a
            href="/app"
            className="flex items-center gap-2 rounded-lg px-3 py-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to the workbench
          </a>
        </div>
      </nav>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <FolioMark className="h-6 w-6 text-primary md:hidden" aria-hidden="true" />
            <h1 className="text-sm font-extrabold tracking-tight text-foreground">{activeSection.label}</h1>
            <span className="hidden truncate text-[11px] text-muted-foreground sm:inline">· {identity}</span>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <a
              href="/app"
              className="hidden h-8 items-center gap-2 rounded-md border border-border/70 px-3 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground sm:inline-flex"
            >
              Open workbench
            </a>
            <Button variant="ghost" size="icon" onClick={() => void signOutQuick()} aria-label="Sign out" title="Sign out">
              <LogOut className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </header>

        {/* Mobile section rail */}
        <div role="group" aria-label="Console sections" className="flex flex-wrap gap-1 border-b border-border/70 px-3 py-2 md:hidden">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? 'page' : undefined}
              className={`flex flex-shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition-colors ${section === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        <main className="min-w-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6">
          {content[section]}
        </main>
      </div>
    </div>
  )
}
