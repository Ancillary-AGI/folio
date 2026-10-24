import { describe, expect, it } from 'vitest'
import type { Component, Wire } from '../../types'
import { DigitalTwinService } from './digitalTwinService'

const symbol = { width: 40, height: 20, paths: [] }

const component = (
  id: string,
  name: string,
  pins: string[],
  properties: Record<string, string | number> = {},
): Component => ({
  id,
  name,
  category: 'passive',
  symbol,
  pins: pins.map((pinId, index) => ({
    id: pinId,
    name: `Pin ${index + 1}`,
    x: index * 10,
    y: 0,
    type: 'passive',
  })),
  properties,
})

const wire = (id: string, connectedPins: Wire['connectedPins'], netName?: string): Wire => ({
  id,
  points: [],
  connectedPins,
  netName,
})

/** 5 V source feeding a 1 kΩ resistor: OUT must sit at 5 V against ground. */
const dividerModel = () => ({
  components: [
    component('v1', 'DC Voltage Source', ['positive', 'negative'], { value: '5V', type: 'DC' }),
    component('r1', 'Resistor', ['p1', 'p2'], { value: '1k' }),
  ],
  wires: [
    wire('rail', [
      { componentId: 'v1', pinId: 'positive' },
      { componentId: 'r1', pinId: 'p1' },
    ], 'OUT'),
    wire('ground', [
      { componentId: 'v1', pinId: 'negative' },
      { componentId: 'r1', pinId: 'p2' },
    ], '0'),
  ],
  nets: [],
  simulationState: {},
})

const configTwin = (service: DigitalTwinService) =>
  service.createDigitalTwin({
    physicalDeviceId: 'board-1',
    updateInterval: 100,
    sensors: [
      { id: 'temp', type: 'temperature', unit: '°C' },
      { id: 'vbus', type: 'voltage', unit: 'V' },
      { id: 'ibus', type: 'current', unit: 'A' },
    ],
    actuators: [{ id: 'fan', type: 'motor', range: [0, 100] }],
  })

describe('DigitalTwinService', () => {
  it('solves the stored circuit instead of inventing a simulation step', async () => {
    const service = new DigitalTwinService()
    const twin = service.createDigitalTwin('asset-1', 'divider', dividerModel())

    const [step] = await service.runRealTimeSimulation(twin.id, 50)

    expect(step.success).toBe(true)
    expect(step.error).toBeUndefined()
    expect(step.nodes.length).toBeGreaterThan(0)
    expect(Object.values(step.operatingPoint ?? {}).some(value => Math.abs(value - 5) < 1e-6)).toBe(true)
    expect(step.statistics?.elementCount).toBe(2)
  })

  it('leaves config-created sensors without a reading until the twin syncs', () => {
    const service = new DigitalTwinService()
    const twin = configTwin(service)

    expect(twin.sensors).toHaveLength(3)
    expect(twin.sensors.every(sensor => sensor.lastReading === undefined)).toBe(true)

    return service.synchronizeDigitalTwin(twin.id).then(() => {
      expect(twin.sensors.every(sensor => sensor.lastReading !== undefined)).toBe(true)
      expect(twin.lastSync).toBeGreaterThan(0)
    })
  })

  it('forecasts only from telemetry the twin actually holds', async () => {
    const service = new DigitalTwinService()
    const twin = configTwin(service)
    await service.synchronizeDigitalTwin(twin.id)

    const forecast = await service.predictSystemBehavior(twin.id) as {
      predictions: Record<string, unknown>
      confidence: number
    }

    expect(forecast.predictions).toHaveProperty('temperature')
    expect(forecast.predictions).toHaveProperty('power')
    expect(forecast.confidence).toBeCloseTo(0.9, 9)
    // No pressure sensor exists, so no pressure forecast may appear.
    expect(forecast.predictions).not.toHaveProperty('pressure')
  })

  it('reports confidence 0 and no derived values without readings', async () => {
    const service = new DigitalTwinService()
    const twin = configTwin(service)

    const forecast = await service.predictSystemBehavior(twin.id) as {
      predictions: Record<string, unknown>
      confidence: number
    }

    expect(forecast.confidence).toBe(0)
    expect(forecast.predictions).not.toHaveProperty('temperature')
    expect(forecast.predictions).not.toHaveProperty('power')
  })

  it('fails the simulation step honestly when the stored wiring is invalid', async () => {
    const service = new DigitalTwinService()
    const twin = service.createDigitalTwin('asset-2', 'broken', {
      components: [component('r1', 'Resistor', ['p1', 'p2'], { value: '1k' })],
      wires: [wire('dangling', [{ componentId: 'missing', pinId: 'p1' }])],
      nets: [],
      simulationState: {},
    })

    const [step] = await service.runRealTimeSimulation(twin.id, 50)

    expect(step.success).toBe(false)
    expect(step.error).toBeTruthy()
    expect(step.nodes).toEqual([])
  })

  it('starts a first sync at full health instead of penalising missing history', async () => {
    const service = new DigitalTwinService()
    const twin = configTwin(service)
    await service.synchronizeDigitalTwin(twin.id)

    expect(twin.healthScore).toBe(100)
  })
})
