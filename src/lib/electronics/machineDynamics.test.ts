import { describe, expect, it } from 'vitest'
import {
  BLDC_PRESETS,
  DC_MACHINE_PRESETS,
  STEPPER_PRESETS,
  bldcSteadyState,
  dcMachineSteadyState,
  simulateBldc,
  simulateDcMachine,
  simulateStepper,
  stepperCommandAngle,
} from './machineDynamics'

const dc = DC_MACHINE_PRESETS[0].parameters
const bldc = BLDC_PRESETS[0].parameters
const stepper = STEPPER_PRESETS[0].parameters

describe('brushed DC machine', () => {
  it('settles at the closed-form motor operating point', () => {
    const operating = { supplyVoltageV: 12, loadTorqueNm: 0.05 }
    const expected = dcMachineSteadyState(dc, operating)
    const samples = simulateDcMachine(dc, operating, { tEndSeconds: 2, dtSeconds: 0.0002 })
    const final = samples[samples.length - 1]

    expect(final.speedRadPerS).toBeCloseTo(expected.speedRadPerS, 0)
    expect(final.currentA).toBeCloseTo(expected.currentA, 1)
    expect(final.terminalVoltageV).toBeCloseTo(12, 3)
    expect(final.shaftTorqueNm).toBeCloseTo(0.05, 2)
    expect(expected.efficiency).toBeGreaterThan(0.5)
    expect(expected.efficiency).toBeLessThan(1)
  })

  it('runs a separately excited generator with a resistive load', () => {
    const operating = {
      supplyVoltageV: 0,
      loadTorqueNm: -0.05,
      loadResistanceOhm: 10,
    }
    const expected = dcMachineSteadyState(dc, operating)
    const samples = simulateDcMachine(dc, operating, { tEndSeconds: 12, dtSeconds: 0.0005 })
    const final = samples[samples.length - 1]

    expect(expected.speedRadPerS).toBeGreaterThan(0)
    expect(expected.currentA).toBeLessThan(0)
    expect(expected.terminalVoltageV).toBeGreaterThan(0)
    expect(expected.electricalPowerW).toBeLessThan(0)
    expect(final.speedRadPerS).toBeCloseTo(expected.speedRadPerS, 0)
    expect(final.terminalVoltageV).toBeCloseTo(expected.terminalVoltageV, 1)
    // The load current is the negative of the machine-terminal current, and
    // v = −R_load·i must hold once the electrical transient is over.
    expect(-operating.loadResistanceOhm * final.currentA).toBeCloseTo(final.terminalVoltageV, 2)
  })

  it('reaches no-load speed from the catalogue envelope', () => {
    const expected = dcMachineSteadyState(dc, { supplyVoltageV: 12, loadTorqueNm: 0 })
    expect(expected.speedRpm).toBeGreaterThan(10_000)
    expect(expected.speedRpm).toBeLessThan(13_000)

    const stalled = dcMachineSteadyState(dc, { supplyVoltageV: 12, loadTorqueNm: 0.5 })
    expect(stalled.speedRadPerS).toBeLessThan(0)
  })

  it('rejects non-physical parameters and impossible runs', () => {
    expect(() =>
      dcMachineSteadyState({ ...dc, inductanceH: 0 }, { supplyVoltageV: 12, loadTorqueNm: 0 }),
    ).toThrow(/inductance/)
    expect(() =>
      dcMachineSteadyState(dc, { supplyVoltageV: 12, loadTorqueNm: 0, loadResistanceOhm: -1 }),
    ).toThrow(/Load resistance/)
    expect(() =>
      simulateDcMachine(dc, { supplyVoltageV: 12, loadTorqueNm: 0 }, { tEndSeconds: 1, dtSeconds: 0 }),
    ).toThrow(/step/)
    expect(() =>
      simulateDcMachine(dc, { supplyVoltageV: 12, loadTorqueNm: 0 }, { tEndSeconds: 1, dtSeconds: 1e-9 }),
    ).toThrow(/limit/)
  })
})

describe('BLDC / PMSM', () => {
  it('settles at the dq steady state with id = 0', () => {
    const operating = { dcBusVoltageV: 24, modulationIndex: 0.9, loadTorqueNm: 0.02 }
    const expected = bldcSteadyState(bldc, operating)
    const samples = simulateBldc(bldc, operating, { tEndSeconds: 0.5, dtSeconds: 0.0001 })
    const final = samples[samples.length - 1]

    expect(final.speedRadPerS).toBeCloseTo(expected.speedRadPerS, 0)
    expect(final.currentQA).toBeCloseTo(expected.currentQA, 1)
    expect(Math.abs(final.currentDA)).toBeLessThan(0.01)
    expect(final.torqueNm).toBeCloseTo(0.02 + bldc.viscousFrictionNmsPerRad * final.speedRadPerS, 2)
    expect(final.electricalFrequencyHz).toBeCloseTo(
      (bldc.polePairs * final.speedRadPerS) / (2 * Math.PI),
      6,
    )
  })

  it('runs as a generator when the shaft is overdriven', () => {
    const operating = { dcBusVoltageV: 24, modulationIndex: 0.2, loadTorqueNm: -0.05 }
    const samples = simulateBldc(bldc, operating, { tEndSeconds: 1, dtSeconds: 0.0001 })
    const final = samples[samples.length - 1]
    expect(final.speedRadPerS).toBeGreaterThan(0)
    expect(final.currentQA).toBeLessThan(0)
    expect(final.electricalPowerW).toBeLessThan(0)
  })

  it('rejects an over-modulated inverter', () => {
    expect(() =>
      bldcSteadyState(bldc, { dcBusVoltageV: 24, modulationIndex: 1.2, loadTorqueNm: 0 }),
    ).toThrow(/Modulation index/)
  })
})

describe('stepper', () => {
  it('advances one full step per command interval', () => {
    expect(stepperCommandAngle(0, 100, Math.PI / 100)).toBe(0)
    expect(stepperCommandAngle(0.009, 100, Math.PI / 100)).toBe(0)
    expect(stepperCommandAngle(0.01, 100, Math.PI / 100)).toBeCloseTo(Math.PI / 100, 12)
    expect(stepperCommandAngle(0.25, 100, Math.PI / 100)).toBeCloseTo(25 * (Math.PI / 100), 12)
  })

  it('tracks a slow step train and keeps the lag below one step', () => {
    const rate = 100
    const samples = simulateStepper(
      stepper,
      { stepRateStepsPerSecond: rate, loadTorqueNm: 0 },
      { tEndSeconds: 1, dtSeconds: 0.0001 },
    )
    const final = samples[samples.length - 1]
    expect(Math.abs(final.positionErrorRad)).toBeLessThanOrEqual(stepper.stepAngleRad * 1.01)
    // The instantaneous speed oscillates within each command interval, so
    // track the average rate over the whole run instead.
    const averageRate = final.angleRad / final.timeSeconds / stepper.stepAngleRad
    expect(Math.abs(averageRate - rate)).toBeLessThan(2)
    expect(final.currentFraction).toBeCloseTo(1, 2)
  })

  it('stalls when the load exceeds the holding torque', () => {
    const samples = simulateStepper(
      stepper,
      { stepRateStepsPerSecond: 100, loadTorqueNm: 5 },
      { tEndSeconds: 0.5, dtSeconds: 0.0001 },
    )
    const final = samples[samples.length - 1]
    // A load above the holding torque pulls the rotor out of synchronism; it
    // must not pretend to keep tracking the command.
    expect(Math.abs(final.positionErrorRad)).toBeGreaterThan(10 * stepper.stepAngleRad)
    expect(Math.abs(final.speedStepsPerSecond - 100)).toBeGreaterThan(50)
  })

  it('rejects an unphysical step angle and rate', () => {
    expect(() => stepperCommandAngle(0, -1, Math.PI / 100)).toThrow(/Step rate/)
    expect(() => stepperCommandAngle(0, 100, 0)).toThrow(/Step angle/)
    expect(() =>
      simulateStepper(
        { ...stepper, stepAngleRad: 0 },
        { stepRateStepsPerSecond: 100, loadTorqueNm: 0 },
        { tEndSeconds: 1, dtSeconds: 0.001 },
      ),
    ).toThrow(/Step angle/)
  })
})
