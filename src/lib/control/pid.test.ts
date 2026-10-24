import { describe, expect, it } from 'vitest'
import {
  initialPidState,
  pidClosedLoop,
  pidStep,
  pidTransferFunction,
} from './pid'
import { simulateStep, stepResponseMetrics } from './transferFunction'

describe('continuous PID design', () => {
  it('assembles the filtered PID as one proper rational function', () => {
    const controller = pidTransferFunction({
      kp: 2,
      ki: 3,
      kd: 0.5,
      derivativeFilterSeconds: 0.1,
    })
    expect(controller.numerator).toEqual([0.7, 2.3, 3])
    expect(controller.denominator).toEqual([0.1, 1, 0])
  })

  it('drives a first-order plant to zero steady-state error', () => {
    const plant = { numerator: [1], denominator: [1, 1] }
    const loop = pidClosedLoop(plant, { kp: 2, ki: 3, kd: 0 })
    const response = simulateStep(loop, { tEndSeconds: 20, dtSeconds: 0.002 })
    const metrics = stepResponseMetrics(response)

    expect(metrics.steadyState).toBeCloseTo(1, 4)
    // PI turns the type-0 plant into a type-1 loop; the closed-loop poles are
    // s² + 3s + 3, so settling is a few seconds, not the plant's 4 s tail.
    expect(metrics.settlingTimeSeconds).toBeLessThan(5)
  })

  it('rejects non-finite gains and a non-positive derivative filter', () => {
    expect(() => pidTransferFunction({ kp: Number.NaN, ki: 0, kd: 0 })).toThrow(/kp/)
    expect(() => pidTransferFunction({ kp: 1, ki: 0, kd: 0, derivativeFilterSeconds: 0 })).toThrow(/filter/)
  })
})

describe('sampled PID', () => {
  it('clamps its output and stops integrating once saturated', () => {
    const first = pidStep(
      initialPidState(0),
      { kp: 10, ki: 5, kd: 0 },
      1,
      0,
      0.1,
      { minOutput: 0, maxOutput: 1 },
    )
    expect(first.output).toBe(1)
    expect(first.saturated).toBe(true)
    expect(first.integral).toBe(0)

    const second = pidStep(first.state, { kp: 10, ki: 5, kd: 0 }, 1, 0, 0.1, {
      minOutput: 0,
      maxOutput: 1,
    })
    expect(second.output).toBe(1)
    expect(second.state.integral).toBe(0)
  })

  it('differentiates the measurement, so a setpoint step causes no kick', () => {
    const initial = initialPidState(0)
    const movedSetpoint = pidStep(initial, { kp: 0, ki: 0, kd: 1 }, 1, 0, 0.01)
    const sameMeasurement = pidStep(initial, { kp: 0, ki: 0, kd: 1 }, 0, 0, 0.01)
    expect(movedSetpoint.derivative).toBe(0)
    expect(sameMeasurement.derivative).toBe(0)

    const measurementJump = pidStep(initial, { kp: 0, ki: 0, kd: 1 }, 1, 1, 0.01)
    // α = τ/(τ+dt) = 0.5, raw derivative = −1/0.01 = −100.
    expect(measurementJump.derivative).toBeCloseTo(-50, 9)
  })

  it('integrates the error while it remains inside the limits', () => {
    const result = pidStep(initialPidState(0), { kp: 0, ki: 2, kd: 0 }, 1, 0, 0.5)
    expect(result.output).toBeCloseTo(1, 12)
    expect(result.integral).toBeCloseTo(1, 12)
    expect(result.error).toBe(1)
    expect(result.saturated).toBe(false)
  })

  it('rejects invalid sample times, limits and state', () => {
    const state = initialPidState()
    expect(() => pidStep(state, { kp: 1, ki: 0, kd: 0 }, 0, 0, 0)).toThrow(/sample time/)
    expect(() =>
      pidStep(state, { kp: 1, ki: 0, kd: 0 }, 0, 0, 0.1, { minOutput: 2, maxOutput: 1 }),
    ).toThrow(/limits/)
    expect(() =>
      pidStep({ integral: Number.NaN, previousMeasurement: 0, derivative: 0 }, { kp: 1, ki: 0, kd: 0 }, 0, 0, 0.1),
    ).toThrow(/state/)
  })
})
