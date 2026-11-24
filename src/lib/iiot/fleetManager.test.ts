import { describe, expect, it } from 'vitest'
import {
  DEFAULT_THRESHOLDS, HISTORY_LIMIT, IIoTFleetManager, type FleetDevice, type TelemetrySample,
} from './fleetManager'

const device = (id: string, site = 'plant-a'): Omit<FleetDevice, 'lastSeen' | 'status'> => ({
  id,
  name: id,
  type: 'robot',
  site,
  firmware: '1.0.0',
  telemetry: { temperature: 40, cpuLoad: 20, latencyMs: 10 },
})

describe('IIoTFleetManager', () => {
  it('registers devices online and filters by site', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    manager.registerDevice(device('plc-1', 'plant-b'))
    expect(manager.listDevices()).toHaveLength(2)
    expect(manager.listDevices('plant-b').map(entry => entry.id)).toEqual(['plc-1'])
    expect(manager.sites()).toEqual(['plant-a', 'plant-b'])
    expect(manager.getDevice('arm-1')?.name).toBe('arm-1')
    expect(manager.getDevice('ghost')).toBeUndefined()
  })

  it('marks a device degraded when telemetry crosses a threshold', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    expect(manager.ingestTelemetry('arm-1', { temperature: 90 })?.status).toBe('degraded')
    expect(manager.ingestTelemetry('arm-1', { temperature: 40, cpuLoad: 95 })?.status).toBe('degraded')
    expect(manager.ingestTelemetry('arm-1', { temperature: 40, cpuLoad: 20 })?.status).toBe('online')
    expect(manager.ingestTelemetry('missing', { temperature: 90 })).toBeUndefined()
  })

  it('keeps maintenance state until resumed', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    manager.command('arm-1', 'maintenance')
    expect(manager.ingestTelemetry('arm-1', { temperature: 40 })?.status).toBe('maintenance')
    manager.command('arm-1', 'resume')
    expect(manager.listDevices()[0].status).toBe('online')
  })

  it('resumes into degraded when the device is still over a limit', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    manager.ingestTelemetry('arm-1', { temperature: 95 })
    manager.command('arm-1', 'maintenance')
    expect(manager.command('arm-1', 'resume').status).toBe('ack')
    expect(manager.getDevice('arm-1')?.status).toBe('degraded')
  })

  it('fails commands for unknown devices instead of acknowledging them', () => {
    const manager = new IIoTFleetManager()
    expect(manager.command('ghost', 'resume').status).toBe('failed')
    manager.registerDevice(device('arm-1'))
    expect(manager.command('arm-1', 'resume').status).toBe('ack')
    expect(manager.getCommands('arm-1')).toHaveLength(1)
    expect(manager.getCommands()).toHaveLength(2)
    manager.clearCommands()
    expect(manager.getCommands()).toHaveLength(0)
  })

  it('scores an empty fleet as healthy and weights degraded devices', () => {
    const manager = new IIoTFleetManager()
    expect(manager.fleetHealth()).toEqual({
      total: 0, online: 0, degraded: 0, offline: 0, maintenance: 0, alerts: 0, score: 100,
    })

    manager.registerDevice(device('a'))
    manager.registerDevice(device('b'))
    manager.ingestTelemetry('b', { temperature: 90 })
    const health = manager.fleetHealth()
    expect(health).toMatchObject({ total: 2, online: 1, degraded: 1, offline: 0, alerts: 1 })
    expect(health.score).toBe(70)
  })

  it('edits identity and site without letting the id drift', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    const updated = manager.updateDevice('arm-1', { name: 'Arm One', site: 'plant-c', firmware: '2.0.0', twinId: 'twin_1' })
    expect(updated).toMatchObject({ id: 'arm-1', name: 'Arm One', site: 'plant-c', firmware: '2.0.0', twinId: 'twin_1' })
    expect(manager.listDevices('plant-c')).toHaveLength(1)
    expect(manager.updateDevice('ghost', { name: 'x' })).toBeUndefined()
  })

  it('removes a device and can restore it with its history', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    manager.ingestTelemetry('arm-1', { temperature: 44 })
    const history = manager.historyOf('arm-1')
    const removed = manager.removeDevice('arm-1')
    expect(removed?.id).toBe('arm-1')
    expect(manager.listDevices()).toHaveLength(0)
    expect(manager.historyOf('arm-1')).toEqual([])
    expect(manager.removeDevice('arm-1')).toBeUndefined()
    manager.restoreDevice(removed!, history)
    expect(manager.getDevice('arm-1')?.telemetry.temperature).toBe(44)
    expect(manager.historyOf('arm-1')).toHaveLength(history.length)
  })

  it('keeps a bounded telemetry history per device', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    for (let index = 0; index < HISTORY_LIMIT + 20; index += 1) {
      manager.ingestTelemetry('arm-1', { temperature: 40 + (index % 5) })
    }
    const history = manager.historyOf('arm-1')
    expect(history).toHaveLength(HISTORY_LIMIT)
    expect(history[history.length - 1].temperature).toBe(40 + ((HISTORY_LIMIT + 19) % 5))
    expect(history.every((sample: TelemetrySample) => typeof sample.at === 'number')).toBe(true)
    // The caller gets a copy: mutating it must not rewrite the registry.
    history.pop()
    expect(manager.historyOf('arm-1')).toHaveLength(HISTORY_LIMIT)
  })

  it('re-judges the fleet when a threshold is lowered', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    manager.ingestTelemetry('arm-1', { temperature: 70 })
    expect(manager.getDevice('arm-1')?.status).toBe('online')
    manager.setThresholds({ temperatureC: 60 })
    expect(manager.getThresholds().temperatureC).toBe(60)
    expect(manager.getDevice('arm-1')?.status).toBe('degraded')
    manager.setThresholds({ temperatureC: 85 })
    expect(manager.getDevice('arm-1')?.status).toBe('online')
  })

  it('separates critical faults from warnings in the alert feed', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice({ ...device('arm-1'), telemetry: { temperature: 90, cpuLoad: 95, latencyMs: 400, battery: 8 } })
    const alerts = manager.alertsFor('arm-1')
    expect(alerts.map(alert => alert.channel)).toEqual(['temperature', 'cpuLoad', 'latencyMs', 'battery'])
    expect(alerts.map(alert => alert.severity)).toEqual(['critical', 'critical', 'warning', 'warning'])
    expect(alerts[0].message).toMatch(/90 °C is over the 85 °C limit/)
    expect(manager.alertsFor('ghost')).toEqual([])
    expect(manager.fleetAlerts()).toHaveLength(4)
    // Warnings alone do not degrade a device.
    manager.registerDevice({ ...device('agv-1'), telemetry: { temperature: 30, cpuLoad: 10, latencyMs: 400, battery: 8 } })
    expect(manager.getDevice('agv-1')?.status).toBe('online')
    expect(manager.alertsFor('agv-1').every(alert => alert.severity === 'warning')).toBe(true)
  })

  it('leaves a maintenance device alone when thresholds move', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    manager.ingestTelemetry('arm-1', { temperature: 95 })
    manager.command('arm-1', 'maintenance')
    manager.setThresholds({ temperatureC: 10 })
    expect(manager.getDevice('arm-1')?.status).toBe('maintenance')
  })

  it('snapshots and restores the whole fleet as plain JSON', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('arm-1'))
    manager.ingestTelemetry('arm-1', { temperature: 91 })
    manager.command('arm-1', 'maintenance')
    manager.setThresholds({ latencyMs: 120 })
    const snapshot = JSON.parse(JSON.stringify(manager.snapshot())) as ReturnType<IIoTFleetManager['snapshot']>

    const restored = new IIoTFleetManager()
    restored.restore(snapshot)
    expect(restored.getDevice('arm-1')?.status).toBe('maintenance')
    expect(restored.getThresholds().latencyMs).toBe(120)
    expect(restored.historyOf('arm-1')).toHaveLength(2)
    expect(restored.getCommands('arm-1')).toHaveLength(1)
    expect(restored.fleetHealth()).toEqual(manager.fleetHealth())
    expect(restored.snapshot()).toEqual(snapshot)
  })

  it('restores over an existing fleet instead of merging into it', () => {
    const manager = new IIoTFleetManager()
    manager.registerDevice(device('stale'))
    manager.restore({ devices: [], commands: [], history: {}, thresholds: DEFAULT_THRESHOLDS })
    expect(manager.listDevices()).toEqual([])
    expect(manager.getCommands()).toEqual([])
  })

  it('seeds a believable fleet once, with a deterministic trend', () => {
    const manager = new IIoTFleetManager()
    const now = 1_760_000_000_000
    expect(manager.seedDemoFleet(now)).toBe(true)
    expect(manager.seedDemoFleet(now)).toBe(false)
    const devices = manager.listDevices()
    expect(devices.length).toBeGreaterThanOrEqual(5)
    expect(manager.sites()).toEqual(['cell-b', 'line-a'])
    expect(manager.historyOf('arm-01')).toHaveLength(24)
    expect(manager.historyOf('arm-01')[23].at).toBe(now)
    expect(manager.alertsFor('env-11').map(alert => alert.channel)).toEqual(['battery'])

    const second = new IIoTFleetManager()
    second.seedDemoFleet(now)
    expect(second.snapshot()).toEqual(manager.snapshot())
  })
})