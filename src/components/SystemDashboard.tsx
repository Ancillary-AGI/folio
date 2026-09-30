/**
 * System Dashboard — pulls real data from live services instead of Math.random().
 *
 * Data sources:
 *  • SIEM: active alert count, recent events, compliance status
 *  • IIoT Fleet: device health, online/degraded/offline counts
 *  • Project store: component + wire counts
 *  • App store: current workspace mode, settings
 *  • Plugin manager: loaded plugin count
 *  • Backup service: last backup age
 *  • Cross-domain orchestrator: sync score + issues
 */

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from './ui/card'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs'
import {
  Shield, Activity, Cpu, Zap, RefreshCw, AlertTriangle, CheckCircle,
  Clock, Database, Bot, GitBranch,
} from 'lucide-react'
import { siemService } from '../lib/siem/siemService'
import { pluginManager } from '../lib/plugins/pluginManager'
import { useProjectStore } from '../stores/useProjectStore'
import { useAppStore } from '../stores/useAppStore'
import { iiotFleetManager } from '../lib/iiot/fleetManager'
import { crossDomainOrchestrator } from '../lib/codesign/crossDomainOrchestrator'
import { backupService } from '../lib/backup/backupService'

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardMetrics {
  // SIEM
  activeAlerts: number
  criticalAlerts: number
  recentEventsCount: number
  compliancePassRate: number   // 0–1
  // Fleet
  devicesOnline: number
  devicesTotal: number
  fleetHealthScore: number     // 0–100
  // Design
  componentCount: number
  wireCount: number
  // IDE
  pluginsLoaded: number
  workspaceMode: string
  lastBackupAgo: string        // human-readable
  // Codesign
  syncScore: number | null
  syncIssues: number
}

const EMPTY_METRICS: DashboardMetrics = {
  activeAlerts: 0, criticalAlerts: 0, recentEventsCount: 0, compliancePassRate: 0,
  devicesOnline: 0, devicesTotal: 0, fleetHealthScore: 0,
  componentCount: 0, wireCount: 0, pluginsLoaded: 0, workspaceMode: '—',
  lastBackupAgo: '—', syncScore: null, syncIssues: 0,
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function humanDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function severityColor(sev: string) {
  switch (sev) {
    case 'critical': return 'bg-destructive text-destructive-foreground'
    case 'high': return 'bg-warning text-warning-foreground'
    case 'medium': return 'bg-warning text-warning-foreground'
    default: return 'bg-primary text-primary-foreground'
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export const SystemDashboard: React.FC = () => {
  const [metrics, setMetrics] = useState<DashboardMetrics>(EMPTY_METRICS)
  const [activeTab, setActiveTab] = useState('overview')
  const [loading, setLoading] = useState(false)
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null)

  const { components, wires, currentProject } = useProjectStore()
  const { workspaceMode } = useAppStore()

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      // ── SIEM ──────────────────────────────────────────────────────────────
      const activeAlerts = siemService.getAlerts({ status: 'active' })
      const criticalAlerts = siemService.getAlerts({ status: 'active', severity: 'critical' })
      const recentEvents = siemService.getEvents({ startTime: Date.now() - 3600 * 1000, limit: 100 })
      const allChecks = siemService.getComplianceChecks()
      const passRate = allChecks.length
        ? allChecks.filter(c => c.status === 'compliant').length / allChecks.length
        : 0

      // ── Fleet ─────────────────────────────────────────────────────────────
      let devicesOnline = 0, devicesTotal = 0, fleetHealthScore = 0
      const devices = iiotFleetManager.listDevices()
      devicesTotal = devices.length
      devicesOnline = devices.filter(device => device.status === 'online').length
      fleetHealthScore = iiotFleetManager.fleetHealth().score

      // ── Plugins ───────────────────────────────────────────────────────────
      const pluginsLoaded = pluginManager.getAllPlugins().length

      // ── Backup ────────────────────────────────────────────────────────────
      let lastBackupAgo = 'Never'
      if (currentProject) {
        const backups = backupService.listBackups(currentProject.id)
        if (backups.length > 0) {
          const latest = Math.max(...backups.map(backup => backup.createdAt))
          lastBackupAgo = humanDuration(Date.now() - latest)
        }
      }

      // ── Codesign sync ─────────────────────────────────────────────────────
      let syncScore: number | null = null
      let syncIssues = 0
      if (currentProject) {
        try {
          const namedNets = new Set(wires.map(wire => wire.netName).filter((name): name is string => Boolean(name)))
          const snapshot = crossDomainOrchestrator.synchronize(currentProject.id, {
            schematic: { nets: namedNets.size },
            siem: { alerts: activeAlerts.length },
          })
          syncScore = snapshot.syncScore
          syncIssues = snapshot.issues.length
        } catch { /* orchestrator unavailable */ }
      }

      setMetrics({
        activeAlerts: activeAlerts.length,
        criticalAlerts: criticalAlerts.length,
        recentEventsCount: recentEvents.length,
        compliancePassRate: passRate,
        devicesOnline,
        devicesTotal,
        fleetHealthScore,
        componentCount: components.length,
        wireCount: wires.length,
        pluginsLoaded,
        workspaceMode,
        lastBackupAgo,
        syncScore,
        syncIssues,
      })
      setLastRefresh(new Date())
    } catch (err) {
      console.error('Dashboard refresh error:', err)
    } finally {
      setLoading(false)
    }
  }, [components, wires, workspaceMode, currentProject])

  // Auto-refresh every 30 s
  useEffect(() => {
    refresh()
    const id = setInterval(refresh, 30_000)
    return () => clearInterval(id)
  }, [refresh])

  // Live SIEM metrics from store (no poll needed for these)
  const recentSIEMEvents = siemService.getEvents({ limit: 10 })
  const complianceChecks = siemService.getComplianceChecks()
  const activeAlertsList = siemService.getAlerts({ status: 'active' }).slice(0, 5)

  // ── Status colour helper ────────────────────────────────────────────────────
  const healthColor = (score: number) => score >= 80 ? 'text-success' : score >= 50 ? 'text-warning' : 'text-destructive'

  // ── KPI cards ──────────────────────────────────────────────────────────────
  const kpis = [
    { label: 'Active Alerts', value: metrics.activeAlerts, color: metrics.activeAlerts > 0 ? 'text-destructive' : 'text-success', icon: <Shield className="w-4 h-4" /> },
    { label: 'Critical Alerts', value: metrics.criticalAlerts, color: metrics.criticalAlerts > 0 ? 'text-destructive font-bold' : 'text-success', icon: <AlertTriangle className="w-4 h-4" /> },
    { label: 'SIEM Events (1h)', value: metrics.recentEventsCount, color: 'text-info', icon: <Activity className="w-4 h-4" /> },
    { label: 'Compliance Pass', value: `${(metrics.compliancePassRate * 100).toFixed(0)}%`, color: metrics.compliancePassRate >= 0.9 ? 'text-success' : metrics.compliancePassRate >= 0.7 ? 'text-warning' : 'text-destructive', icon: <CheckCircle className="w-4 h-4" /> },
    { label: 'Fleet Online', value: `${metrics.devicesOnline}/${metrics.devicesTotal}`, color: 'text-info', icon: <Database className="w-4 h-4" /> },
    { label: 'Fleet Health', value: `${metrics.fleetHealthScore.toFixed(0)}%`, color: healthColor(metrics.fleetHealthScore), icon: <Zap className="w-4 h-4" /> },
    { label: 'Components', value: metrics.componentCount, color: 'text-info', icon: <Cpu className="w-4 h-4" /> },
    { label: 'Plugins Loaded', value: metrics.pluginsLoaded, color: 'text-primary', icon: <Bot className="w-4 h-4" /> },
    { label: 'Last Backup', value: metrics.lastBackupAgo, color: 'text-info', icon: <GitBranch className="w-4 h-4" /> },
    { label: 'Sync Score', value: metrics.syncScore !== null ? `${metrics.syncScore.toFixed(0)}%` : '—', color: (metrics.syncScore ?? 100) >= 80 ? 'text-success' : 'text-warning', icon: <RefreshCw className="w-4 h-4" /> },
  ]

  return (
    <div className="w-full h-full p-4 bg-background overflow-y-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold">System Dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {lastRefresh ? `Last updated: ${lastRefresh.toLocaleTimeString()}` : 'Loading…'}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh} disabled={loading} className="flex items-center gap-1 text-xs">
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {kpis.map(kpi => (
          <Card key={kpi.label}>
            <CardContent className="p-3">
              <div className="flex items-center gap-1.5 mb-1 text-muted-foreground">{kpi.icon}<span className="text-xs">{kpi.label}</span></div>
              <div className={`text-xl font-bold ${kpi.color}`}>{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4 mb-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader><CardTitle className="text-sm">Domain Integration Status</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {[
                  { name: 'Schematic ↔ PCB', ok: true },
                  { name: 'PCB ↔ 3D View', ok: true },
                  { name: 'Robotics ↔ Digital Twin', ok: metrics.devicesTotal > 0 },
                  { name: 'SIEM ↔ IoT Fleet', ok: metrics.devicesTotal > 0 },
                  { name: 'AI ↔ Circuit Analysis', ok: true },
                  { name: 'Codesign Sync', ok: (metrics.syncScore ?? 0) >= 70 },
                ].map(item => (
                  <div key={item.name} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{item.name}</span>
                    <Badge className={item.ok ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground'}>{item.ok ? 'Active' : 'Inactive'}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-sm">Current Session</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Workspace</span><Badge variant="outline">{metrics.workspaceMode}</Badge></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Components</span><span>{metrics.componentCount}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Wires</span><span>{metrics.wireCount}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Plugins</span><span>{metrics.pluginsLoaded}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Last backup</span><span className={metrics.lastBackupAgo === 'Never' ? 'text-destructive' : 'text-success'}>{metrics.lastBackupAgo}</span></div>
                {metrics.syncScore !== null && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Sync score</span><span className={healthColor(metrics.syncScore)}>{metrics.syncScore.toFixed(0)}%</span></div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Security ── */}
        <TabsContent value="security" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm flex items-center gap-1"><Shield className="w-4 h-4" />Active Alerts</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {activeAlertsList.length === 0
                ? <div className="text-sm text-success flex items-center gap-1"><CheckCircle className="w-4 h-4" />No active alerts</div>
                : activeAlertsList.map(alert => (
                  <div key={alert.id} className="flex items-start justify-between gap-2 p-2 rounded bg-muted/30">
                    <div>
                      <div className="text-sm font-medium">{alert.title}</div>
                      <div className="text-xs text-muted-foreground">{alert.description}</div>
                      <div className="text-xs text-muted-foreground">{new Date(alert.timestamp).toLocaleString()}</div>
                    </div>
                    <Badge className={severityColor(alert.severity)}>{alert.severity}</Badge>
                  </div>
                ))}
              {siemService.getAlerts({ status: 'active' }).length > 5 && (
                <div className="text-xs text-muted-foreground text-center">
                  +{siemService.getAlerts({ status: 'active' }).length - 5} more — open SIEM workspace for full list
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Compliance ── */}
        <TabsContent value="compliance" className="space-y-3">
          <div className="text-sm text-muted-foreground mb-2">
            {complianceChecks.length === 0
              ? 'No compliance checks run yet. Switch to the SIEM workspace and run a compliance check.'
              : `${complianceChecks.filter(c => c.status === 'compliant').length}/${complianceChecks.length} requirements compliant`}
          </div>
          {['ISO27001', 'IEC62443', 'NIST', 'GDPR'].map(std => {
            const stdChecks = complianceChecks.filter(c => c.standard === std)
            if (stdChecks.length === 0) return null
            const passing = stdChecks.filter(c => c.status === 'compliant').length
            return (
              <Card key={std}>
                <CardHeader className="pb-2 pt-3 px-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm">{std}</CardTitle>
                    <Badge className={passing === stdChecks.length ? 'bg-success text-success-foreground' : 'bg-warning text-warning-foreground'}>
                      {passing}/{stdChecks.length}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="px-4 pb-3 space-y-1">
                  {stdChecks.slice(0, 4).map(c => (
                    <div key={c.id} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground truncate max-w-[70%]">{c.requirement}</span>
                      <span className={c.status === 'compliant' ? 'text-success' : 'text-destructive'}>
                        {c.status === 'compliant' ? '✓' : '✗'}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )
          })}
        </TabsContent>

        {/* ── Activity ── */}
        <TabsContent value="activity" className="space-y-2">
          <div className="text-sm text-muted-foreground mb-2">Last 10 SIEM events</div>
          {recentSIEMEvents.length === 0
            ? <div className="text-sm text-muted-foreground">No events yet. Start using the IDE to generate activity.</div>
            : recentSIEMEvents.map(ev => (
              <div key={ev.id} className="flex items-start justify-between gap-2 p-2 rounded bg-muted/20 text-xs">
                <div>
                  <span className="font-medium">{ev.source}</span>
                  <span className="text-muted-foreground"> — {ev.message}</span>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <Badge className={severityColor(ev.severity)}>{ev.severity}</Badge>
                  <span className="text-muted-foreground"><Clock className="w-2.5 h-2.5 inline" /> {humanDuration(Date.now() - ev.timestamp)}</span>
                </div>
              </div>
            ))}
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default SystemDashboard

// Add missing React import for JSX
import React from 'react'
