import { describe, expect, it } from 'vitest'
import { IIoTFleetManager, type FleetDevice } from './fleetManager'

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

  it('fails commands for unknown devices instead of acknowledging them', () => {
    const manager = new IIoTFleetManager()
    expect(manager.command('ghost', 'resume').status).toBe('failed')
    manager.registerDevice(device('arm-1'))
    expect(manager.command('arm-1', 'resume').status).toBe('ack')
    expect(manager.getCommands('arm-1')).toHaveLength(1)
  })

  it('scores an empty fleet as healthy and weights degraded devices', () => {
    const manager = new IIoTFleetManager()
    expect(manager.fleetHealth()).toEqual({ total: 0, online: 0, degraded: 0, offline: 0, score: 100 })

    manager.registerDevice(device('a'))
    manager.registerDevice(device('b'))
    manager.ingestTelemetry('b', { temperature: 90 })
    const health = manager.fleetHealth()
    expect(health).toMatchObject({ total: 2, online: 1, degraded: 1, offline: 0 })
    expect(health.score).toBe(70)
  })
})
