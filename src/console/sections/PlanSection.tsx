/**
 * Plan & limits — what this account is allowed to do, measured against the
 * policy the app actually enforces. No fake billing: where a number cannot be
 * measured it says "not measured", and billing says it has not shipped.
 */
import { useMemo } from 'react'
import { ShieldCheck, Info } from 'lucide-react'
import { resolvePlan } from '../consoleData'
import { countUsage } from '../../lib/admin/usageLedger'
import { offlineProjectStore } from '../../lib/offlineProjectStore'
import type { User } from '../../types'

interface PlanSectionProps {
  offlineMode: boolean
  user: User | null
}

function startOfToday(): number {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export default function PlanSection({ offlineMode, user }: PlanSectionProps) {
  const plan = resolvePlan(user, offlineMode)

  const rows = useMemo(() => {
    const uid = user?.id ?? 'offline-local'
    // The device cannot see the server's project rows, so an online account's
    // project count is honestly "not measured" instead of a local number
    // presented as the account's usage.
    const projectsUsed = offlineMode ? offlineProjectStore.list().length : null
    const exportsUsed = countUsage('export.run', startOfToday(), uid)
    const simulationsUsed = countUsage('simulation.run', startOfToday(), uid)
    return [
      { id: 'projects', label: 'Projects', used: projectsUsed, limit: plan.limits.maxProjects, unit: 'projects' },
      { id: 'exports', label: 'Exports today', used: exportsUsed, limit: plan.limits.maxExportsPerDay, unit: 'exports' },
      { id: 'simulations', label: 'Simulations today', used: simulationsUsed, limit: plan.limits.maxSimulationsPerDay, unit: 'runs' },
      { id: 'storage', label: 'Storage', used: null as number | null, limit: plan.limits.maxStorageMb, unit: 'MB' },
    ]
  }, [offlineMode, user?.id, plan.limits])

  return (
    <div className="max-w-3xl space-y-6">
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 sm:flex sm:items-center sm:gap-4">
        <ShieldCheck className="h-6 w-6 flex-shrink-0 text-primary" aria-hidden="true" />
        <div className="mt-2 sm:mt-0">
          <p className="text-sm font-bold text-foreground">{plan.label}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{plan.detail}</p>
        </div>
      </div>

      <section aria-labelledby="limits-heading">
        <h2 id="limits-heading" className="text-sm font-bold text-foreground">What this account can use</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {offlineMode
            ? 'Enforced here on this device.'
            : 'Enforced by the deployment when you sign in online; the usage rows below count this device’s own events, not the server’s ledger.'}
        </p>
        <div className="mt-2 overflow-hidden rounded-xl border border-border/70">
          <table className="w-full text-left text-xs">
            <thead className="bg-card/80 text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Limit</th>
                <th scope="col" className="px-4 py-2 font-semibold">Used</th>
                <th scope="col" className="px-4 py-2 font-semibold">Policy</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60 bg-card/40">
              {rows.map((row) => {
                const measurable = row.used !== null && row.limit !== null && row.limit > 0
                const remaining = measurable ? Math.max(0, row.limit! - row.used!) : null
                const percent = measurable ? Math.min(100, Math.round((row.used! / row.limit!) * 100)) : 0
                const nearCap = measurable && remaining !== null && (remaining / row.limit!) <= 0.1
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-2.5 font-medium text-foreground">{row.label}</td>
                    <td className="px-4 py-2.5">
                      <span className="tabular-nums text-muted-foreground">
                        {row.used === null ? 'Not measured' : row.used.toLocaleString()}
                      </span>
                      {measurable && (
                        <span className="mt-1 block h-1 w-full max-w-[9rem] overflow-hidden rounded-full bg-muted" role="img" aria-label={`${percent}% of the ${row.limit!.toLocaleString()} ${row.unit} used`}>
                          <span className={`block h-full rounded-full ${nearCap ? 'bg-warning' : 'bg-primary'}`} style={{ width: `${Math.max(2, percent)}%` }} />
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">
                      {row.limit === null ? 'Unlimited' : `${row.limit.toLocaleString()} ${row.unit}`}
                      {nearCap && <span className="ml-1.5 font-semibold text-warning">nearly full</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {rows.some((row) => row.used === null) && (
          <p className="mt-1.5 text-[10px] text-muted-foreground/80">
            “Not measured” means this device does not meter it. The cloud enforces storage policy server-side.
          </p>
        )}
      </section>

      <div className="flex items-start gap-3 rounded-xl border border-border/70 bg-card/40 p-4">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="text-xs leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">About paid plans and credits</p>
          <p className="mt-1">
            Billing has not shipped yet, and nothing on this page can charge you. The published
            pricing is announced not charged; the Free tier is real and unlimited today. When plans and
            credits ship, this page becomes the place to change subscription, see invoices and
            manage credits — it will not be a settings panel buried in the CAD.
          </p>
        </div>
      </div>
    </div>
  )
}
