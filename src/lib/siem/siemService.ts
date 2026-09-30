/**
 * SIEM Service — Security Information and Event Management
 *
 * Provides:
 *  • In-memory event log (capped at 10 000 events)
 *  • Deterministic compliance checks — ISO 27001, IEC 62443, NIST CSF, GDPR, HIPAA
 *  • Structured threat-detection heuristics (port scan, exfil, privilege escalation, brute force)
 *  • Alert lifecycle management (create → acknowledge → resolve)
 *  • Audit trail (capped at 50 000 entries)
 *  • Real-time IoT/robotic system monitoring hooks
 *  • Periodic background health + threat checks via setInterval
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SIEMEvent {
  id: string
  timestamp: number
  type: 'security' | 'anomaly' | 'threat' | 'compliance' | 'performance'
  severity: 'low' | 'medium' | 'high' | 'critical'
  source: string
  message: string
  metadata: Record<string, unknown>
  resolved: boolean
  resolution?: string
}

export interface ThreatIntelligence {
  id: string
  type: 'malware' | 'vulnerability' | 'attack_pattern' | 'indicator' | 'anomaly'
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  indicators: string[]
  mitigation: string[]
  lastUpdated: number
  confidence: number
}

export interface ComplianceCheck {
  id: string
  standard: 'ISO27001' | 'NIST' | 'IEC62443' | 'GDPR' | 'HIPAA'
  requirement: string
  status: 'compliant' | 'non_compliant' | 'not_applicable'
  evidence: string[]
  lastChecked: number
  nextCheck: number
}

export interface AuditTrail {
  id: string
  timestamp: number
  user: string
  action: string
  resource: string
  details: Record<string, unknown>
  ipAddress?: string
  userAgent?: string
}

export interface SIEMAlert {
  id: string
  ruleId: string
  timestamp: number
  severity: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  affectedSystems: string[]
  recommendedActions: string[]
  status: 'active' | 'acknowledged' | 'resolved'
  assignedTo?: string
}

/** Internal snapshot used for deterministic compliance evaluation */
interface SystemSnapshot {
  /** Fraction of actions in the last audit window that required 2+ auth factors */
  mfaEnforcementRate: number
  /** Number of failed login attempts in the last window */
  failedLoginAttempts: number
  /** Whether encryption is active for stored assets */
  encryptionActive: boolean
  /** Whether network segments are defined */
  networkSegmentationDefined: boolean
  /** Whether role-based access grants exist */
  rbacConfigured: boolean
  /** Whether audit logging is active */
  auditLoggingActive: boolean
  /** Number of active critical/high alerts */
  unresolvedHighAlerts: number
  /** Whether backup service has at least one snapshot */
  backupExists: boolean
  /** Seconds since last backup */
  secondsSinceLastBackup: number
  /** Whether TLS is enforced for external comms (heuristic) */
  tlsEnforced: boolean
}

// ── Compliance rule definitions ───────────────────────────────────────────────

interface ComplianceRule {
  id: string
  standard: ComplianceCheck['standard']
  requirement: string
  evaluate: (snap: SystemSnapshot) => { compliant: boolean; evidence: string[] }
}

const COMPLIANCE_RULES: ComplianceRule[] = [
  // ── ISO 27001 ───────────────────────────────────────────────────────────────
  {
    id: 'iso_access_control',
    standard: 'ISO27001',
    requirement: 'A.9 — Access Control',
    evaluate: snap => ({
      compliant: snap.rbacConfigured && snap.mfaEnforcementRate >= 0.8,
      evidence: [
        snap.rbacConfigured ? '✓ RBAC grants configured' : '✗ No RBAC grants found',
        `MFA enforcement rate: ${(snap.mfaEnforcementRate * 100).toFixed(0)}% (required ≥80%)`,
      ],
    }),
  },
  {
    id: 'iso_crypto',
    standard: 'ISO27001',
    requirement: 'A.10 — Cryptography',
    evaluate: snap => ({
      compliant: snap.encryptionActive,
      evidence: [snap.encryptionActive ? '✓ Asset encryption active' : '✗ No encrypted assets detected'],
    }),
  },
  {
    id: 'iso_audit_logging',
    standard: 'ISO27001',
    requirement: 'A.12.4 — Logging and Monitoring',
    evaluate: snap => ({
      compliant: snap.auditLoggingActive,
      evidence: [snap.auditLoggingActive ? '✓ Audit trail recording is active' : '✗ Audit logging inactive'],
    }),
  },
  {
    id: 'iso_backup',
    standard: 'ISO27001',
    requirement: 'A.12.3 — Information Backup',
    evaluate: snap => ({
      compliant: snap.backupExists && snap.secondsSinceLastBackup < 86400,
      evidence: [
        snap.backupExists ? '✓ Backup snapshot exists' : '✗ No backup found',
        `Last backup: ${snap.backupExists ? `${Math.round(snap.secondsSinceLastBackup / 60)} min ago` : 'never'}`,
      ],
    }),
  },
  // ── IEC 62443 ───────────────────────────────────────────────────────────────
  {
    id: 'iec_network_segmentation',
    standard: 'IEC62443',
    requirement: 'SL-2 — Network Segmentation (FR 1)',
    evaluate: snap => ({
      compliant: snap.networkSegmentationDefined,
      evidence: [snap.networkSegmentationDefined ? '✓ Network zones defined' : '✗ No network segmentation configured'],
    }),
  },
  {
    id: 'iec_access_control',
    standard: 'IEC62443',
    requirement: 'SL-2 — Access Control (FR 2)',
    evaluate: snap => ({
      compliant: snap.rbacConfigured,
      evidence: [snap.rbacConfigured ? '✓ Role-based access configured' : '✗ RBAC not configured'],
    }),
  },
  {
    id: 'iec_secure_comms',
    standard: 'IEC62443',
    requirement: 'SL-2 — Secure Communication (FR 4)',
    evaluate: snap => ({
      compliant: snap.tlsEnforced,
      evidence: [snap.tlsEnforced ? '✓ TLS enforced on connections' : '✗ Unencrypted communication detected'],
    }),
  },
  {
    id: 'iec_audit',
    standard: 'IEC62443',
    requirement: 'SL-2 — Auditable Events (FR 6)',
    evaluate: snap => ({
      compliant: snap.auditLoggingActive,
      evidence: [snap.auditLoggingActive ? '✓ Event logging is active' : '✗ Audit logging not active'],
    }),
  },
  // ── NIST CSF ────────────────────────────────────────────────────────────────
  {
    id: 'nist_identify',
    standard: 'NIST',
    requirement: 'ID.AM — Asset Management',
    evaluate: snap => ({
      compliant: snap.rbacConfigured && snap.auditLoggingActive,
      evidence: [
        snap.rbacConfigured ? '✓ Asset access controls defined' : '✗ Asset management incomplete',
        snap.auditLoggingActive ? '✓ Asset activity is logged' : '✗ Asset logging inactive',
      ],
    }),
  },
  {
    id: 'nist_protect',
    standard: 'NIST',
    requirement: 'PR.AC — Identity Management and Access Control',
    evaluate: snap => ({
      compliant: snap.mfaEnforcementRate >= 0.7 && snap.rbacConfigured,
      evidence: [
        `MFA rate: ${(snap.mfaEnforcementRate * 100).toFixed(0)}%`,
        snap.rbacConfigured ? '✓ Access control active' : '✗ Access control missing',
      ],
    }),
  },
  {
    id: 'nist_detect',
    standard: 'NIST',
    requirement: 'DE.AE — Anomalies and Events',
    evaluate: snap => ({
      compliant: snap.auditLoggingActive && snap.unresolvedHighAlerts < 5,
      evidence: [
        snap.auditLoggingActive ? '✓ Event detection active' : '✗ Event detection inactive',
        `Unresolved high+ alerts: ${snap.unresolvedHighAlerts} (threshold: 5)`,
      ],
    }),
  },
  {
    id: 'nist_respond',
    standard: 'NIST',
    requirement: 'RS.AN — Analysis',
    evaluate: snap => ({
      compliant: snap.unresolvedHighAlerts < 3,
      evidence: [`Unresolved high/critical alerts: ${snap.unresolvedHighAlerts} (threshold: 3)`],
    }),
  },
  // ── GDPR ────────────────────────────────────────────────────────────────────
  {
    id: 'gdpr_encryption',
    standard: 'GDPR',
    requirement: 'Art. 32 — Security of Processing (encryption)',
    evaluate: snap => ({
      compliant: snap.encryptionActive,
      evidence: [snap.encryptionActive ? '✓ Personal data is encrypted at rest' : '✗ Encryption not verified'],
    }),
  },
  {
    id: 'gdpr_audit',
    standard: 'GDPR',
    requirement: 'Art. 30 — Records of Processing Activities',
    evaluate: snap => ({
      compliant: snap.auditLoggingActive,
      evidence: [snap.auditLoggingActive ? '✓ Processing activities logged' : '✗ No processing log found'],
    }),
  },
  // ── HIPAA ────────────────────────────────────────────────────────────────────
  {
    id: 'hipaa_access',
    standard: 'HIPAA',
    requirement: '§164.312(a) — Access Control',
    evaluate: snap => ({
      compliant: snap.rbacConfigured && snap.mfaEnforcementRate >= 0.9,
      evidence: [
        snap.rbacConfigured ? '✓ Access controls in place' : '✗ No access controls',
        `MFA rate: ${(snap.mfaEnforcementRate * 100).toFixed(0)}% (required ≥90%)`,
      ],
    }),
  },
  {
    id: 'hipaa_audit',
    standard: 'HIPAA',
    requirement: '§164.312(b) — Audit Controls',
    evaluate: snap => ({
      compliant: snap.auditLoggingActive,
      evidence: [snap.auditLoggingActive ? '✓ Audit controls active' : '✗ Audit controls missing'],
    }),
  },
]

// ── Service ───────────────────────────────────────────────────────────────────

export class SIEMService {
  private events: SIEMEvent[] = []
  private threats: ThreatIntelligence[] = []
  private complianceChecks: ComplianceCheck[] = []
  private auditTrail: AuditTrail[] = []
  private alerts: SIEMAlert[] = []
  private monitoringActive = false
  private monitoringIntervals: ReturnType<typeof setInterval>[] = []
  /*
   * Observability. Components must re-render when security state changes, and
   * the only correct way to know that is for the service to say so. A monotonic
   * revision counter also gives `useSyncExternalStore` a stable snapshot.
   */
  private revision = 0
  private listeners = new Set<() => void>()
  /** Monotonic id source — deterministic, collision-free, and testable. */
  private sequence = 0

  constructor() {
    this.initializeThreatIntelligence()
  }

  // ── Subscription ─────────────────────────────────────────────────────────────

  /** Subscribe to state changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Stable snapshot for `useSyncExternalStore`. Bumps on every mutation. */
  getRevision(): number {
    return this.revision
  }

  private notify(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }

  private nextId(prefix: string): string {
    this.sequence += 1
    return `${prefix}_${this.sequence.toString().padStart(6, '0')}`
  }

  // ── Event management ─────────────────────────────────────────────────────────

  logEvent(event: Omit<SIEMEvent, 'id' | 'timestamp' | 'resolved'>): void {
    const e: SIEMEvent = {
      ...event,
      id: this.nextId('evt'),
      timestamp: Date.now(),
      resolved: false,
    }
    this.events.push(e)
    this.checkForAlerts(e)
    if (this.events.length > 10000) this.events = this.events.slice(-10000)
    this.notify()
  }

  getEvents(filters?: {
    type?: string
    severity?: string
    source?: string
    resolved?: boolean
    startTime?: number
    endTime?: number
    limit?: number
  }): SIEMEvent[] {
    let result = this.events
    if (filters) {
      result = result.filter(e => {
        if (filters.type && e.type !== filters.type) return false
        if (filters.severity && e.severity !== filters.severity) return false
        if (filters.source && !e.source.includes(filters.source)) return false
        if (filters.resolved !== undefined && e.resolved !== filters.resolved) return false
        if (filters.startTime && e.timestamp < filters.startTime) return false
        if (filters.endTime && e.timestamp > filters.endTime) return false
        return true
      })
    }
    result = [...result].sort((a, b) => b.timestamp - a.timestamp)
    return filters?.limit ? result.slice(0, filters.limit) : result
  }

  resolveEvent(eventId: string, resolution: string): void {
    const e = this.events.find(x => x.id === eventId)
    if (e) {
      e.resolved = true
      e.resolution = resolution
      this.notify()
    }
  }

  // ── Threat detection ─────────────────────────────────────────────────────────

  async detectThreats(systemData: {
    networkTraffic?: Array<Record<string, unknown>>
    componentStates?: Record<string, Record<string, unknown>>
    userActivities?: Array<Record<string, unknown>>
  }): Promise<ThreatIntelligence[]> {
    const detected: ThreatIntelligence[] = []
    if (systemData.networkTraffic) detected.push(...this.analyzeNetworkTraffic(systemData.networkTraffic))
    if (systemData.componentStates) detected.push(...this.detectAnomalies(systemData.componentStates))
    if (systemData.userActivities) detected.push(...this.analyzeUserBehavior(systemData.userActivities))
    return detected
  }

  private analyzeNetworkTraffic(traffic: Array<Record<string, unknown>>): ThreatIntelligence[] {
    const threats: ThreatIntelligence[] = []

    // Port scan: source with >15 distinct target ports in one batch
    const portsBySource = new Map<string, Set<unknown>>()
    for (const pkt of traffic) {
      const src = String(pkt.sourceIP ?? pkt.src ?? 'unknown')
      const port = pkt.targetPort ?? pkt.dstPort
      if (port !== undefined) {
        if (!portsBySource.has(src)) portsBySource.set(src, new Set())
        portsBySource.get(src)!.add(port)
      }
    }
    for (const [src, ports] of portsBySource) {
      if (ports.size > 15) {
        threats.push({
          id: `thr_portscan_${Date.now()}`,
          type: 'attack_pattern',
          severity: 'medium',
          description: `Port scan detected from ${src} — ${ports.size} distinct ports probed`,
          indicators: [`Source: ${src}`, `Ports probed: ${ports.size}`],
          mitigation: ['Block source IP at firewall', 'Enable port-scan detection rule', 'Alert network team'],
          lastUpdated: Date.now(),
          confidence: 0.85,
        })
        this.logEvent({ type: 'threat', severity: 'medium', source: 'network_monitor', message: `Port scan from ${src}`, metadata: { src, ports: ports.size } })
      }
    }

    // Data exfiltration: single packet > 1 MB outbound
    for (const pkt of traffic) {
      const size = typeof pkt.size === 'number' ? pkt.size : 0
      if (size > 1_000_000) {
        threats.push({
          id: `thr_exfil_${Date.now()}`,
          type: 'attack_pattern',
          severity: 'high',
          description: `Potential data exfiltration — ${(size / 1e6).toFixed(1)} MB transfer`,
          indicators: [`Transfer size: ${size} bytes`, `Destination: ${pkt.destination ?? pkt.dst ?? 'unknown'}`],
          mitigation: ['Block connection', 'Review DLP policy', 'Audit user access'],
          lastUpdated: Date.now(),
          confidence: 0.88,
        })
        this.logEvent({ type: 'security', severity: 'high', source: 'network_monitor', message: `Large outbound transfer: ${size} bytes`, metadata: pkt })
      }
    }

    return threats
  }

  private detectAnomalies(states: Record<string, Record<string, unknown>>): ThreatIntelligence[] {
    const threats: ThreatIntelligence[] = []
    for (const [id, state] of Object.entries(states)) {
      const power = typeof state.powerConsumption === 'number' ? state.powerConsumption : -1
      const expected = typeof state.expectedPower === 'number' ? state.expectedPower : -1
      if (power > 0 && expected > 0 && power > expected * 1.5) {
        threats.push({
          id: `thr_power_${id}_${Date.now()}`,
          type: 'anomaly',
          severity: 'medium',
          description: `Anomalous power on ${id}: ${power.toFixed(1)} W (expected ${expected.toFixed(1)} W)`,
          indicators: [`Actual: ${power} W`, `Expected: ${expected} W`, `Ratio: ${(power / expected).toFixed(2)}×`],
          mitigation: ['Inspect component', 'Check for firmware anomaly', 'Monitor temperature'],
          lastUpdated: Date.now(),
          confidence: 0.76,
        })
      }
      const net = typeof state.networkActivity === 'object' && state.networkActivity !== null
        ? state.networkActivity as Record<string, unknown>
        : null
      if (net) {
        const conns = typeof net.connections === 'number' ? net.connections : 0
        if (conns > 100) {
          threats.push({
            id: `thr_net_${id}_${Date.now()}`,
            type: 'anomaly',
            severity: 'high',
            description: `Unusual network activity from ${id}: ${conns} simultaneous connections`,
            indicators: [`Connections: ${conns}`, `Threshold: 100`],
            mitigation: ['Isolate device', 'Check for botnet', 'Review firewall rules'],
            lastUpdated: Date.now(),
            confidence: 0.82,
          })
        }
      }
    }
    return threats
  }

  private analyzeUserBehavior(activities: Array<Record<string, unknown>>): ThreatIntelligence[] {
    const threats: ThreatIntelligence[] = []

    // Brute-force: >5 failed logins from same user/IP in one batch
    const failsByUser = new Map<string, number>()
    for (const a of activities) {
      if (a.action === 'login_failed') {
        const key = String(a.user ?? a.userId ?? a.ip ?? 'unknown')
        failsByUser.set(key, (failsByUser.get(key) ?? 0) + 1)
      }
    }
    for (const [user, count] of failsByUser) {
      if (count > 5) {
        threats.push({
          id: `thr_brute_${Date.now()}`,
          type: 'attack_pattern',
          severity: 'high',
          description: `Brute-force login attempt: ${count} failures for "${user}"`,
          indicators: [`User/IP: ${user}`, `Failures: ${count}`],
          mitigation: ['Temporarily lock account', 'Enable CAPTCHA', 'Notify user via out-of-band channel'],
          lastUpdated: Date.now(),
          confidence: 0.92,
        })
        this.logEvent({ type: 'security', severity: 'high', source: 'auth_monitor', message: `Brute-force on ${user}`, metadata: { user, count } })
      }
    }

    // Privilege escalation attempts
    const privAttempts = activities.filter(a => a.action === 'privilege_escalation' || a.action === 'sudo_attempt')
    if (privAttempts.length > 3) {
      threats.push({
        id: `thr_priv_${Date.now()}`,
        type: 'attack_pattern',
        severity: 'high',
        description: `${privAttempts.length} privilege escalation attempts detected`,
        indicators: [`Attempts: ${privAttempts.length}`, `Users: ${[...new Set(privAttempts.map(a => a.user))].join(', ')}`],
        mitigation: ['Lock accounts', 'Review sudo policies', 'Enable MFA for privileged operations'],
        lastUpdated: Date.now(),
        confidence: 0.90,
      })
    }

    // Unusual off-hours login
    const offHours = activities.filter(a => {
      if (a.action !== 'login_success') return false
      const h = typeof a.timestamp === 'number' ? new Date(a.timestamp).getHours() : -1
      return h >= 0 && (h < 6 || h >= 22)
    })
    if (offHours.length > 2) {
      threats.push({
        id: `thr_offhours_${Date.now()}`,
        type: 'indicator',
        severity: 'low',
        description: `${offHours.length} off-hours logins detected (22:00–06:00)`,
        indicators: offHours.slice(0, 3).map(a => `${a.user} at ${new Date(a.timestamp as number).toLocaleTimeString()}`),
        mitigation: ['Verify with users', 'Enable geo-fencing', 'Consider time-based access controls'],
        lastUpdated: Date.now(),
        confidence: 0.65,
      })
    }

    return threats
  }

  // ── Compliance ───────────────────────────────────────────────────────────────

  /**
   * Run compliance checks for a standard against the live system snapshot.
   * Results are deterministic — no Math.random().
   */
  async runComplianceCheck(standard: ComplianceCheck['standard']): Promise<ComplianceCheck[]> {
    const snap = this.buildSystemSnapshot()
    const rules = COMPLIANCE_RULES.filter(r => r.standard === standard)
    const now = Date.now()
    const nextCheck = now + 30 * 24 * 3600 * 1000

    const results: ComplianceCheck[] = rules.map(rule => {
      const { compliant, evidence } = rule.evaluate(snap)
      return {
        id: rule.id,
        standard: rule.standard,
        requirement: rule.requirement,
        status: compliant ? 'compliant' : 'non_compliant',
        evidence,
        lastChecked: now,
        nextCheck,
      }
    })

    // Upsert into the stored checks list
    for (const r of results) {
      const idx = this.complianceChecks.findIndex(c => c.id === r.id)
      if (idx >= 0) this.complianceChecks[idx] = r
      else this.complianceChecks.push(r)
    }

    this.notify()
    return results
  }

  /** Run every standard that has defined rules. Returns all results. */
  async runAllComplianceChecks(): Promise<ComplianceCheck[]> {
    const standards = Array.from(new Set(COMPLIANCE_RULES.map(rule => rule.standard)))
    const all: ComplianceCheck[] = []
    for (const standard of standards) {
      all.push(...(await this.runComplianceCheck(standard)))
    }
    return all
  }

  getComplianceChecks(standard?: ComplianceCheck['standard']): ComplianceCheck[] {
    return standard ? this.complianceChecks.filter(c => c.standard === standard) : [...this.complianceChecks]
  }

  /** Build a deterministic snapshot from real in-memory data */
  private buildSystemSnapshot(): SystemSnapshot {
    const recentWindow = Date.now() - 24 * 3600 * 1000
    const recentAudit = this.auditTrail.filter(e => e.timestamp > recentWindow)

    const loginActions = recentAudit.filter(e => e.action.startsWith('auth:'))
    const mfaActions = recentAudit.filter(e => e.action === 'auth:mfa_verified')
    const mfaEnforcementRate = loginActions.length > 0 ? mfaActions.length / loginActions.length : 0

    const failedLogins = this.events.filter(e =>
      e.type === 'security' && e.message.toLowerCase().includes('brute') && e.timestamp > recentWindow,
    ).length

    const encryptionActive = this.events.some(e => e.metadata?.encrypted === true)
      || recentAudit.some(e => e.action === 'encrypt')

    const networkSegmentationDefined = this.complianceChecks.some(
      c => c.id === 'iec_network_segmentation' && c.status === 'compliant',
    ) || this.events.some(e => e.metadata?.networkSegmented === true)

    const rbacConfigured = recentAudit.some(e => e.action.startsWith('grant:') || e.action === 'rbac:configured')
      || this.events.some(e => e.metadata?.rbacActive === true)

    const auditLoggingActive = this.auditTrail.length > 0

    const unresolvedHighAlerts = this.alerts.filter(
      a => a.status === 'active' && (a.severity === 'high' || a.severity === 'critical'),
    ).length

    // Heuristic: if the page is served over HTTPS (production) TLS is enforced
    const tlsEnforced = typeof window !== 'undefined' && window.location.protocol === 'https:'

    // Backup: check localStorage for backup service entries
    let backupExists = false
    let secondsSinceLastBackup = Infinity
    try {
      const backupMeta = localStorage.getItem('ide-backups-meta')
      if (backupMeta) {
        const parsed = JSON.parse(backupMeta) as Array<{ timestamp: number }>
        if (parsed.length > 0) {
          backupExists = true
          const latest = Math.max(...parsed.map(b => b.timestamp))
          secondsSinceLastBackup = (Date.now() - latest) / 1000
        }
      }
    } catch { /* localStorage unavailable */ }

    return {
      mfaEnforcementRate,
      failedLoginAttempts: failedLogins,
      encryptionActive,
      networkSegmentationDefined,
      rbacConfigured,
      auditLoggingActive,
      unresolvedHighAlerts,
      backupExists,
      secondsSinceLastBackup,
      tlsEnforced,
    }
  }

  // ── Audit trail ──────────────────────────────────────────────────────────────

  logAuditEvent(event: Omit<AuditTrail, 'id' | 'timestamp'>): void {
    const entry: AuditTrail = {
      ...event,
      id: this.nextId('aud'),
      timestamp: Date.now(),
    }
    this.auditTrail.push(entry)
    if (this.auditTrail.length > 50000) this.auditTrail = this.auditTrail.slice(-50000)
    this.notify()
  }

  getAuditTrail(filters?: {
    user?: string
    action?: string
    resource?: string
    startTime?: number
    endTime?: number
    limit?: number
  }): AuditTrail[] {
    let result = this.auditTrail
    if (filters) {
      result = result.filter(e => {
        if (filters.user && e.user !== filters.user) return false
        if (filters.action && !e.action.includes(filters.action)) return false
        if (filters.resource && !e.resource.includes(filters.resource)) return false
        if (filters.startTime && e.timestamp < filters.startTime) return false
        if (filters.endTime && e.timestamp > filters.endTime) return false
        return true
      })
    }
    result = [...result].sort((a, b) => b.timestamp - a.timestamp)
    return filters?.limit ? result.slice(0, filters.limit) : result
  }

  // ── Alert management ─────────────────────────────────────────────────────────

  createAlert(alert: Omit<SIEMAlert, 'id' | 'timestamp' | 'status'>): string {
    const id = this.nextId('alt')
    this.alerts.push({ ...alert, id, timestamp: Date.now(), status: 'active' })
    this.notify()
    return id
  }

  getAlerts(filters?: { severity?: string; status?: string; assignedTo?: string }): SIEMAlert[] {
    let result = this.alerts
    if (filters) {
      result = result.filter(a => {
        if (filters.severity && a.severity !== filters.severity) return false
        if (filters.status && a.status !== filters.status) return false
        if (filters.assignedTo && a.assignedTo !== filters.assignedTo) return false
        return true
      })
    }
    return [...result].sort((a, b) => b.timestamp - a.timestamp)
  }

  updateAlertStatus(alertId: string, status: SIEMAlert['status'], assignedTo?: string): void {
    const a = this.alerts.find(x => x.id === alertId)
    if (a) {
      a.status = status
      if (assignedTo) a.assignedTo = assignedTo
      this.notify()
    }
  }

  // ── Monitoring ────────────────────────────────────────────────────────────────

  startMonitoring(): void {
    if (this.monitoringActive) return
    this.monitoringActive = true

    // Health check every 30 s
    this.monitoringIntervals.push(setInterval(() => this.performHealthCheck(), 30_000))
    // Compliance drift every 6 h
    this.monitoringIntervals.push(setInterval(() => this.detectComplianceDrift(), 6 * 3600 * 1000))
  }

  stopMonitoring(): void {
    this.monitoringActive = false
    this.monitoringIntervals.forEach(clearInterval)
    this.monitoringIntervals = []
  }

  private performHealthCheck(): void {
    const snap = this.buildSystemSnapshot()
    if (snap.unresolvedHighAlerts > 5) {
      this.logEvent({
        type: 'security', severity: 'high', source: 'health_monitor',
        message: `${snap.unresolvedHighAlerts} unresolved high/critical alerts outstanding`,
        metadata: { unresolvedHighAlerts: snap.unresolvedHighAlerts },
      })
    }
    if (!snap.backupExists || snap.secondsSinceLastBackup > 86400) {
      this.logEvent({
        type: 'compliance', severity: 'medium', source: 'health_monitor',
        message: 'No recent backup detected (ISO 27001 A.12.3)',
        metadata: { backupExists: snap.backupExists, secondsSinceLastBackup: snap.secondsSinceLastBackup },
      })
    }
  }

  private async detectComplianceDrift(): Promise<void> {
    const standards: ComplianceCheck['standard'][] = ['ISO27001', 'IEC62443', 'NIST', 'GDPR']
    for (const std of standards) {
      const results = await this.runComplianceCheck(std)
      const failing = results.filter(r => r.status === 'non_compliant')
      if (failing.length > 0) {
        this.logEvent({
          type: 'compliance', severity: 'medium', source: 'compliance_monitor',
          message: `${std}: ${failing.length} requirement(s) non-compliant`,
          metadata: { standard: std, failing: failing.map(f => f.requirement) },
        })
      }
    }
  }

  // ── IoT / Robotic monitoring ─────────────────────────────────────────────────

  async monitorIoTDevice(deviceId: string, metrics: {
    temperature?: number
    powerConsumption?: number
    networkActivity?: { bytesIn: number; bytesOut: number; connections: number }
    cpuUsage?: number
    memoryUsage?: number
    errors?: number
  }): Promise<void> {
    const src = `iot:${deviceId}`
    if (metrics.temperature !== undefined && metrics.temperature > 70) {
      this.logEvent({ type: 'anomaly', severity: 'medium', source: src, message: `High temperature: ${metrics.temperature}°C`, metadata: metrics })
    }
    if (metrics.powerConsumption !== undefined && metrics.powerConsumption > 5) {
      this.logEvent({ type: 'anomaly', severity: 'medium', source: src, message: `High power: ${metrics.powerConsumption} W`, metadata: metrics })
    }
    if (metrics.networkActivity && metrics.networkActivity.connections > 100) {
      this.logEvent({ type: 'security', severity: 'high', source: src, message: `Unusual network activity: ${metrics.networkActivity.connections} connections`, metadata: metrics })
    }
    if (metrics.errors !== undefined && metrics.errors > 10) {
      this.logEvent({ type: 'anomaly', severity: 'high', source: src, message: `High error rate: ${metrics.errors} errors`, metadata: metrics })
    }
  }

  async monitorRoboticSystem(robotId: string, metrics: {
    jointTorques?: Record<string, number>
    collisions?: number
    errors?: string[]
    operationalTime?: number
  }): Promise<void> {
    const src = `robot:${robotId}`
    if (metrics.collisions && metrics.collisions > 0) {
      this.logEvent({ type: 'anomaly', severity: 'high', source: src, message: `Collision detected (count: ${metrics.collisions})`, metadata: metrics })
    }
    if (metrics.errors && metrics.errors.length > 0) {
      this.logEvent({ type: 'anomaly', severity: 'medium', source: src, message: `Errors: ${metrics.errors.join(', ')}`, metadata: metrics })
    }
    if (metrics.jointTorques) {
      for (const [joint, torque] of Object.entries(metrics.jointTorques)) {
        if (Math.abs(torque) > 10) {
          this.logEvent({ type: 'performance', severity: 'medium', source: src, message: `High torque on joint ${joint}: ${torque} N·m`, metadata: { joint, torque } })
        }
      }
    }
  }

  async checkIEC62443ComplianceForIoT(deviceId: string): Promise<ComplianceCheck[]> {
    const checks = await this.runComplianceCheck('IEC62443')
    return checks.map(c => ({ ...c, id: `${c.id}_${deviceId}` }))
  }

  // ── Threat intelligence ──────────────────────────────────────────────────────

  async generateThreatIntelligenceReport(systemType: 'iot' | 'robotic' | 'general'): Promise<{
    summary: string; threats: ThreatIntelligence[]; recommendations: string[]
  }> {
    const relevant = this.threats.filter(t => {
      if (systemType === 'iot') return t.indicators.some(i => i.toLowerCase().includes('iot') || t.type === 'vulnerability')
      if (systemType === 'robotic') return t.indicators.some(i => i.toLowerCase().includes('plc') || i.toLowerCase().includes('robot'))
      return true
    })
    return {
      summary: `Threat report for ${systemType}: ${relevant.length} known threat(s)`,
      threats: relevant,
      recommendations: [
        'Implement network segmentation for all IoT/OT devices',
        'Enable device-level authentication and certificate pinning',
        'Monitor traffic baselines and alert on deviations',
        'Keep firmware and OS patches current (patch within 30 days of CVE)',
        'Use secure communication protocols (TLS 1.3+, MQTT over TLS)',
        'Run quarterly penetration tests and red team exercises',
      ],
    }
  }

  // ── Alerts auto-generation ───────────────────────────────────────────────────

  private checkForAlerts(event: SIEMEvent): void {
    const rules: Array<{
      match: (e: SIEMEvent) => boolean
      alert: Omit<SIEMAlert, 'id' | 'timestamp' | 'status' | 'affectedSystems'>
    }> = [
      {
        match: e => e.type === 'threat' && e.severity === 'critical',
        alert: {
          ruleId: 'critical_threat', severity: 'critical',
          title: 'Critical Security Threat', description: 'A critical threat has been detected.',
          recommendedActions: ['Isolate affected systems immediately', 'Notify security team', 'Preserve forensic evidence'],
        },
      },
      {
        match: e => e.type === 'security' && e.severity === 'high',
        alert: {
          ruleId: 'high_security', severity: 'high',
          title: 'High-Priority Security Event', description: event.message,
          recommendedActions: ['Investigate immediately', 'Review access logs', 'Check for lateral movement'],
        },
      },
      {
        match: e => e.type === 'anomaly' && (e.severity === 'high' || e.severity === 'critical'),
        alert: {
          ruleId: 'high_anomaly', severity: 'high',
          title: 'Anomalous Behaviour Detected', description: event.message,
          recommendedActions: ['Review system logs', 'Check resource utilisation', 'Verify configuration integrity'],
        },
      },
      {
        match: e => e.type === 'compliance',
        alert: {
          ruleId: 'compliance_drift', severity: 'medium',
          title: 'Compliance Drift', description: event.message,
          recommendedActions: ['Run full compliance check', 'Review recent configuration changes', 'Update compliance documentation'],
        },
      },
    ]
    for (const rule of rules) {
      if (rule.match(event)) {
        this.createAlert({ ...rule.alert, affectedSystems: [event.source] })
      }
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────

  private initializeThreatIntelligence(): void {
    this.threats = [
      {
        id: 'ti_001',
        type: 'vulnerability',
        severity: 'high',
        description: 'Unauthenticated remote code execution in embedded RTOS firmware',
        indicators: ['CVE-2024-27956', 'Firmware version < 3.0.0', 'Open telnet port 23'],
        mitigation: ['Update firmware to ≥3.0.0', 'Disable telnet; use SSH', 'Apply vendor hotfix'],
        lastUpdated: Date.now(),
        confidence: 1.0,
      },
      {
        id: 'ti_002',
        type: 'malware',
        severity: 'critical',
        description: 'ICS/SCADA wiper malware targeting PLC ladder logic',
        indicators: ['Unusual PLC writes', 'Modified rungs in ladder logic', 'TRITON/TRISIS indicators'],
        mitigation: ['Disconnect affected PLCs', 'Restore from verified backup', 'Engage ICS incident response team'],
        lastUpdated: Date.now(),
        confidence: 0.95,
      },
      {
        id: 'ti_003',
        type: 'attack_pattern',
        severity: 'medium',
        description: 'MQTT broker hijack via unencrypted broker on port 1883',
        indicators: ['Unencrypted MQTT port 1883 exposed', 'Anonymous MQTT connections allowed'],
        mitigation: ['Enable TLS on MQTT (port 8883)', 'Require client certificates', 'Implement ACL rules'],
        lastUpdated: Date.now(),
        confidence: 0.88,
      },
    ]
  }
}

export const siemService = new SIEMService()
