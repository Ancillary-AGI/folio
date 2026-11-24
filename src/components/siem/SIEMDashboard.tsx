import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert, XCircle } from 'lucide-react'
import { siemService, type SIEMAlert, type SIEMEvent } from '../../lib/siem/siemService'
import { backupService } from '../../lib/backup/backupService'
import { buildCheckpointPayload } from '../../lib/backup/checkpoint'
import { useProjectStore } from '../../stores/useProjectStore'
import { describeError } from '../../lib/utils'
import { Button } from '../ui/button'
import { Badge } from '../ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

/**
 * SIEM & compliance dashboard.
 *
 * Data flow
 * ---------
 * The service is the source of truth and publishes a monotonic revision on every
 * mutation, so this component subscribes with `useSyncExternalStore` instead of
 * polling or keeping a private "tick" counter. That means:
 *   • the view is never stale after an event is logged elsewhere in the app;
 *   • there is no interval keeping the CPU awake when nothing changes;
 *   • there is exactly one copy of the security state.
 *
 * Compliance has to be *run* to produce evidence, so the dashboard triggers a
 * real check pass on mount (and on demand), which is what fills the panel.
 */

type Severity = SIEMEvent['severity'] | SIEMAlert['severity']

const SEVERITY_STYLE: Record<Severity, string> = {
  low: 'bg-info/15 text-info border-info/40',
  medium: 'bg-warning/15 text-warning border-warning/40',
  high: 'bg-destructive/15 text-destructive border-destructive/40',
  critical: 'bg-destructive text-destructive-foreground border-destructive',
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }

function SeverityBadge({ severity }: { severity: Severity }) {
  const Icon = severity === 'critical' || severity === 'high' ? ShieldAlert : AlertTriangle
  return (
    <Badge variant="outline" className={`shrink-0 gap-1 ${SEVERITY_STYLE[severity]}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {severity}
    </Badge>
  )
}

function relativeTime(timestamp: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

/** Stable subscribers — a fresh arrow each render would resubscribe React
 * every commit. Module scope so their identity never changes. */
const subscribeToSiem = (listener: () => void) => siemService.subscribe(listener)
const getSiemRevision = () => siemService.getRevision()

export default function SIEMDashboard() {
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)
  const [backupStatus, setBackupStatus] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const currentProject = useProjectStore((state) => state.currentProject)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const runCompliance = useCallback(async () => {
    setChecking(true)
    setCheckError(null)
    try {
      await siemService.runAllComplianceChecks()
      // Health conditions depend on data outside the compliance rules (the
      // checkpoint store), so refresh them from the same action.
      siemService.checkHealth()
    } catch (error) {
      if (mountedRef.current) setCheckError(`Compliance check failed: ${describeError(error)}`)
    } finally {
      if (mountedRef.current) setChecking(false)
    }
  }, [])

  const createCheckpoint = () => {
    if (!currentProject) return
    const checkpoint = backupService.createBackup(
      currentProject.id,
      buildCheckpointPayload(),
      'SIEM backup',
    )
    siemService.logAuditEvent({
      user: 'operator',
      action: 'project:checkpoint:create',
      resource: currentProject.id,
      details: { checkpointId: checkpoint.id, label: checkpoint.label },
    })
    siemService.checkHealth()
    const storageError = backupService.getStorageError()
    setBackupStatus(storageError
      ? `Checkpoint kept for this session only — ${storageError}.`
      : `Checkpoint saved as “${checkpoint.label}”.`)
  }

  const resolveAlert = (alert: SIEMAlert) => {
    siemService.updateAlertStatus(alert.id, 'resolved')
  }

  // Compliance evidence has to be produced, not assumed.
  useEffect(() => {
    void runCompliance()
  }, [runCompliance])

  // A one-second clock, only while the panel is mounted, for "3m ago" labels.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  /*
   * `useSyncExternalStore` requires a referentially stable snapshot; the
   * service's monotonic revision number is exactly that. The return value is
   * not needed here — subscribing is the point: React re-renders this component
   * whenever the security state actually changes, and the reads below always
   * see the current data.
   */
  /*
   * The service caps its own collections (10k events / 50k audit entries).
   * Deriving on every render was O(n log n) per second for the clock tick and
   * defeated the `byType` memo entirely; memoising on the monotonic revision
   * re-derives exactly when the security state actually changes.
   */
  const revision = useSyncExternalStore(
    subscribeToSiem,
    getSiemRevision,
    getSiemRevision,
  )

  const events = useMemo(() => { void revision; return siemService.getEvents() }, [revision])
  const checks = useMemo(() => { void revision; return siemService.getComplianceChecks() }, [revision])
  const alerts = useMemo(() => { void revision; return siemService.getAlerts() }, [revision])
  const auditTrail = useMemo(() => { void revision; return siemService.getAuditTrail().slice(0, 6) }, [revision])
  const openAlerts = alerts
    .filter((alert) => alert.status === 'active')
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.timestamp - a.timestamp)
  const failing = checks.filter((check) => check.status === 'non_compliant')
  const audited = checks.filter((check) => check.status !== 'not_applicable')
  const passRate = audited.length > 0 ? (audited.length - failing.length) / audited.length : 1
  const recentEvents = events.slice(0, 8)

  const logProbe = () => {
    siemService.logEvent({
      type: 'anomaly',
      severity: 'medium',
      source: 'robot-fleet-01',
      message: 'Unexpected UART traffic on CAN gateway',
      metadata: { protocol: 'UART' },
    })
    siemService.logAuditEvent({
      user: 'operator',
      action: 'siem:inject_probe',
      resource: 'can-gateway-01',
      details: { protocol: 'UART' },
    })
  }

  const byType = useMemo(() => {
    const counts = new Map<SIEMEvent['type'], number>()
    for (const event of events) counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
    return [...counts.entries()]
  }, [events])

  const passPercent = Math.round(passRate * 100)

  return (
    <div className="scrollbar-thin h-full space-y-4 overflow-auto p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-semibold text-foreground">
            <ShieldAlert className="h-5 w-5 text-primary" aria-hidden="true" />
            Activity &amp; security log
          </h2>
          <p className="text-sm text-muted-foreground">
            What this workspace recorded itself — saves, exports, agent runs — the alerts those
            events raise, and the policy checks that can be evaluated in the browser. The threat
            table is a static reference, not live telemetry.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={logProbe}>
            Inject probe event
          </Button>
          <Button size="sm" onClick={() => void runCompliance()} disabled={checking}>
            <RefreshCw className={`mr-2 h-4 w-4 ${checking ? 'animate-spin' : ''}`} aria-hidden="true" />
            {checking ? 'Checking…' : 'Run compliance check'}
          </Button>
        </div>
      </div>

      {checkError && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {checkError}
        </div>
      )}

      {/* Summary strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Open alerts',
            value: String(openAlerts.length),
            tone: openAlerts.length === 0 ? 'text-success' : 'text-destructive',
          },
          {
            label: 'Events captured',
            value: String(events.length),
            tone: 'text-foreground',
          },
          {
            label: 'Compliance pass rate',
            value: checks.length === 0 ? 'Not run' : `${passPercent}%`,
            tone: passPercent >= 90 ? 'text-success' : passPercent >= 70 ? 'text-warning' : 'text-destructive',
          },
          {
            label: 'Non-compliant controls',
            value: String(failing.length),
            tone: failing.length === 0 ? 'text-success' : 'text-destructive',
          },
        ].map((item) => (
          <Card key={item.label}>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground">{item.label}</p>
              <p className={`mt-1 text-2xl font-semibold ${item.tone}`}>{item.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Alerts */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Active alerts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {openAlerts.slice(0, 6).map((alert) => (
              <div
                key={alert.id}
                className="flex items-start justify-between gap-3 border-b border-border pb-2 last:border-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-card-foreground">{alert.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {alert.description} · {relativeTime(alert.timestamp, now)}
                  </p>
                  {alert.recommendedActions[0] && (
                    <p className="mt-0.5 text-xs text-muted-foreground/80">
                      {alert.recommendedActions[0]}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {alert.ruleId === 'backup_overdue' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={createCheckpoint}
                        disabled={!currentProject}
                      >
                        {currentProject ? 'Back up now' : 'Open a project to back up'}
                      </Button>
                    )}
                    {alert.ruleId !== 'backup_overdue' && alert.ruleId !== 'high_alert_backlog' && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => resolveAlert(alert)}
                      >
                        Resolve
                      </Button>
                    )}
                  </div>
                </div>
                <SeverityBadge severity={alert.severity} />
              </div>
            ))}
            {openAlerts.length === 0 && (
              <p className="flex items-center gap-2 text-sm text-success">
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                No active alerts
              </p>
            )}
            {backupStatus && (
              <p role="status" className="text-xs text-muted-foreground">
                {backupStatus}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Compliance */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Compliance evidence</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {checks.length === 0 && !checking && (
              <p className="text-sm text-muted-foreground">
                No checks recorded yet. Run a compliance check to collect evidence.
              </p>
            )}
            {checks.slice(0, 8).map((check) => (
              <div key={check.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-card-foreground">{check.standard}</span>
                  {check.status === 'compliant' ? (
                    <Badge variant="outline" className="gap-1 border-success/40 bg-success/15 text-success">
                      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                      compliant
                    </Badge>
                  ) : check.status === 'not_applicable' ? (
                    <Badge variant="outline" className="gap-1 text-muted-foreground">
                      not applicable
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="gap-1 border-destructive/40 bg-destructive/15 text-destructive"
                    >
                      <XCircle className="h-3 w-3" aria-hidden="true" />
                      {check.status.replace('_', ' ')}
                    </Badge>
                  )}
                </div>
                <p className="text-muted-foreground">{check.requirement}</p>
                {check.evidence.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {check.evidence.slice(0, 2).map((line) => (
                      <li key={line} className="text-xs text-muted-foreground">
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Live events */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Live events</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {recentEvents.map((event) => (
              <div key={event.id} className="border-b border-border pb-2 last:border-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-card-foreground">{event.source}</span>
                  <SeverityBadge severity={event.severity} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {event.message} · {relativeTime(event.timestamp, now)}
                </p>
              </div>
            ))}
            {recentEvents.length === 0 && (
              <p className="text-sm text-muted-foreground">Quiet — no events captured yet.</p>
            )}
          </CardContent>
        </Card>

        {/* Audit trail */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Audit trail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {auditTrail.map((entry) => (
              <div key={entry.id} className="text-sm">
                <span className="font-medium text-card-foreground">{entry.user}</span>{' '}
                <span className="text-foreground">{entry.action}</span>{' '}
                <span className="text-muted-foreground">{entry.resource}</span>
                <span className="ml-1 text-xs text-muted-foreground">
                  · {relativeTime(entry.timestamp, now)}
                </span>
              </div>
            ))}
            {auditTrail.length === 0 && (
              <p className="text-sm text-muted-foreground">No audit entries yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Event mix */}
      {byType.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Event mix</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {byType.map(([type, count]) => (
              <span
                key={type}
                className="rounded-md border border-border bg-muted/50 px-2 py-1 text-xs text-muted-foreground"
              >
                {type}: <span className="font-medium text-foreground">{count}</span>
              </span>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

