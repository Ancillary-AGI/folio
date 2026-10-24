import { afterEach, describe, expect, it, vi } from 'vitest'
import { SIEMService } from './siemService'

describe('SIEMService events and alerts', () => {
  it('logs events newest-first with filters and limits', () => {
    const service = new SIEMService()
    service.logEvent({ type: 'performance', severity: 'low', source: 'cpu', message: 'first', metadata: {} })
    service.logEvent({ type: 'security', severity: 'medium', source: 'auth', message: 'second', metadata: {} })

    expect(service.getEvents({ type: 'security' })).toHaveLength(1)
    expect(service.getEvents({ limit: 1 })[0].message).toBe('second')
  })

  it('opens an alert for a high security event and resolves it', () => {
    const service = new SIEMService()
    service.logEvent({ type: 'security', severity: 'high', source: 'auth', message: 'brute force', metadata: {} })

    const [alert] = service.getAlerts({ status: 'active' })
    expect(alert.ruleId).toBe('high_security')
    expect(alert.affectedSystems).toEqual(['auth'])

    service.updateAlertStatus(alert.id, 'resolved')
    expect(service.getAlerts({ status: 'active' })).toHaveLength(0)
  })

  it('notifies subscribers with a monotonic revision', () => {
    const service = new SIEMService()
    const revisions: number[] = []
    const unsubscribe = service.subscribe(() => revisions.push(service.getRevision()))
    const before = service.getRevision()

    service.logEvent({ type: 'performance', severity: 'low', source: 'test', message: 'tick', metadata: {} })
    service.createAlert({
      ruleId: 'manual',
      severity: 'low',
      title: 'Manual',
      description: 'Manual alert',
      affectedSystems: [],
      recommendedActions: [],
    })
    unsubscribe()
    service.logEvent({ type: 'performance', severity: 'low', source: 'test', message: 'after', metadata: {} })

    expect(revisions.length).toBe(2)
    expect(revisions.every(revision => revision > before)).toBe(true)
    expect(service.getRevision()).toBeGreaterThan(revisions[revisions.length - 1])
  })
})

describe('SIEMService threat detection', () => {
  it('detects a port scan and keeps it in the reportable threat list', async () => {
    const service = new SIEMService()
    const traffic = Array.from({ length: 20 }, (_, port) => ({
      sourceIP: '10.0.0.5',
      targetPort: 1000 + port,
      size: 64,
    }))

    const detected = await service.detectThreats({ networkTraffic: traffic })
    expect(detected).toHaveLength(1)
    expect(detected[0].description).toContain('20 distinct ports')

    const report = await service.generateThreatIntelligenceReport('general')
    expect(report.threats.some(threat => threat.id === detected[0].id)).toBe(true)
  })

  it('assigns unique threat ids within one batch', async () => {
    const service = new SIEMService()
    const detected = await service.detectThreats({
      componentStates: {
        a: { powerConsumption: 10, expectedPower: 1 },
        b: { powerConsumption: 20, expectedPower: 1 },
      },
    })
    expect(detected).toHaveLength(2)
    expect(new Set(detected.map(threat => threat.id)).size).toBe(2)
  })

  it('detects brute force and privilege escalation from user activity', async () => {
    const service = new SIEMService()
    const activities = [
      ...Array.from({ length: 6 }, () => ({ action: 'login_failed', user: 'mallory' })),
      ...Array.from({ length: 4 }, () => ({ action: 'sudo_attempt', user: 'mallory' })),
    ]
    const detected = await service.detectThreats({ userActivities: activities })
    expect(detected.some(threat => threat.description.includes('Brute-force'))).toBe(true)
    expect(detected.some(threat => threat.description.includes('privilege escalation'))).toBe(true)
  })
})

describe('SIEMService compliance', () => {
  it('evaluates ISO 27001 rules deterministically from the audit trail', async () => {
    const service = new SIEMService()
    const before = await service.runComplianceCheck('ISO27001')
    expect(before.length).toBeGreaterThan(0)
    expect(before.every(check => check.status === 'non_compliant')).toBe(true)
    expect(before.every(check => check.lastChecked > 0)).toBe(true)

    service.logAuditEvent({ user: 'admin', action: 'auth:mfa_verified', resource: 'session', details: {} })
    service.logAuditEvent({ user: 'admin', action: 'grant:editor', resource: 'user:42', details: {} })
    const after = await service.runComplianceCheck('ISO27001')
    const access = after.find(check => check.id === 'iso_access_control')
    const logging = after.find(check => check.id === 'iso_audit_logging')
    expect(access?.status).toBe('compliant')
    expect(logging?.status).toBe('compliant')
    // Encryption and backup cannot be inferred from the audit trail alone.
    expect(after.find(check => check.id === 'iso_crypto')?.status).toBe('non_compliant')
  })

  it('runs every standard that has rules without duplicates', async () => {
    const service = new SIEMService()
    const all = await service.runAllComplianceChecks()
    const ids = all.map(check => check.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(all.map(check => check.standard)).size).toBe(5)
  })
})

describe('SIEMService health monitoring', () => {
  afterEach(() => { vi.useRealTimers() })

  it('raises one open notice per recurring health condition', () => {
    vi.useFakeTimers()
    const service = new SIEMService()
    service.startMonitoring()
    try {
      vi.advanceTimersByTime(30_000)
      vi.advanceTimersByTime(30_000)
      vi.advanceTimersByTime(30_000)
      const notices = service
        .getAlerts({ status: 'active' })
        .filter(alert => alert.description.includes('No recent backup'))
      expect(notices).toHaveLength(1)
    } finally {
      service.stopMonitoring()
    }
  })

  it('does not let its own unresolved-alert notice inflate the count', () => {
    vi.useFakeTimers()
    const service = new SIEMService()
    for (let i = 0; i < 6; i += 1) {
      service.logEvent({ type: 'security', severity: 'high', source: 'auth', message: `intrusion ${i}`, metadata: {} })
    }
    service.startMonitoring()
    try {
      vi.advanceTimersByTime(30_000)
      // Six genuine alerts plus one health notice and one backup notice.
      expect(service.getAlerts({ status: 'active' })).toHaveLength(8)
      vi.advanceTimersByTime(30_000)
      vi.advanceTimersByTime(30_000)
      expect(service.getAlerts({ status: 'active' })).toHaveLength(8)
    } finally {
      service.stopMonitoring()
    }
  })
})

describe('SIEMService device monitoring', () => {
  it('logs high CPU, memory, temperature and error observations', async () => {
    const service = new SIEMService()
    await service.monitorIoTDevice('dev-1', {
      temperature: 80,
      cpuUsage: 95,
      memoryUsage: 98,
      errors: 12,
    })
    const messages = service.getEvents({ source: 'iot:dev-1' }).map(event => event.message)
    expect(messages).toEqual(expect.arrayContaining([
      expect.stringContaining('High temperature'),
      expect.stringContaining('High CPU usage'),
      expect.stringContaining('High memory usage'),
      expect.stringContaining('High error rate'),
    ]))
  })

  it('flags robot collisions and excessive joint torque', async () => {
    const service = new SIEMService()
    await service.monitorRoboticSystem('arm-1', {
      collisions: 1,
      jointTorques: { elbow: 12, wrist: 2 },
    })
    const messages = service.getEvents({ source: 'robot:arm-1' }).map(event => event.message)
    expect(messages.some(message => message.includes('Collision'))).toBe(true)
    expect(messages.some(message => message.includes('High torque on joint elbow'))).toBe(true)
    expect(messages.some(message => message.includes('wrist'))).toBe(false)
  })
})
