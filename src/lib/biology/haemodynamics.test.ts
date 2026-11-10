import { describe, expect, it } from 'vitest'

import { stepResponseMetrics } from '../control/transferFunction'
import {
  arterialInputImpedance,
  arterialPressureBalance,
  capillarySegmentExchange,
  pressureVolumeMetrics,
  RESTING_CIRCULATION,
  simulateCirculation,
  simulateWindkessel,
  starlingFiltration,
  ventricularElastance,
  windkesselDecayPressure,
  windkesselTimeConstant,
  type CirculationParameters,
  type CirculationSample,
  type StarlingForces,
} from './haemodynamics'

/** The load the preset heart drives: τ = R·C = 1.92 s, so its numbers are checkable by hand. */
const ARTERY = { resistance: 1.2, compliance: 1.6 }
/** 16 beats at a 3 ms step: enough for the loop to close, cheap enough to re-run in a sweep. */
const RUN = { tEnd: 14, dt: 0.003 }

/** A normal capillary bed: filtering at one end, most of it recovered at the other. */
const ARTERIOLAR_END: StarlingForces = {
  capillaryPressure: 32,
  interstitialPressure: 2,
  plasmaOncoticPressure: 25,
  interstitialOncoticPressure: 5,
  reflectionCoefficient: 1,
}
const VENULAR_END: StarlingForces = { ...ARTERIOLAR_END, capillaryPressure: 13 }

function trap(values: readonly number[], times: readonly number[]): number {
  let area = 0
  for (let index = 1; index < values.length; index += 1) area += (times[index] - times[index - 1]) * (values[index] + values[index - 1]) / 2
  return area
}

function beat(parameters: CirculationParameters, tEnd = RUN.tEnd, dt = RUN.dt, initialVolume = 120) {
  const profile = simulateCirculation(parameters, initialVolume, { tEnd, dt })
  return { profile, metrics: pressureVolumeMetrics(parameters, profile) }
}

/**
 * `filled − forward − drift` over the measured cycle. It should be zero: `dV/dt` is
 * exactly the mitral flow minus the aortic flow. What is left is the trapezoid error
 * of the reporting grid, so it must shrink as the grid is refined — which is the only
 * way to tell a grid artefact apart from a bookkeeping error in the readout.
 */
function flowBalanceResidual(parameters: CirculationParameters, dt: number): number {
  const { profile, metrics } = beat(parameters, RUN.tEnd, dt)
  const cycle = profile.filter((sample) => sample.time >= metrics.fromTime && sample.time <= metrics.toTime)
  const times = cycle.map((sample) => sample.time)
  const filled = trap(cycle.map((sample) => sample.mitralFlow), times)
  return filled - metrics.forwardVolume - metrics.cycleVolumeDrift
}

/**
 * The longest stretch with no forward aortic flow: both valves shut, so the artery is
 * left to discharge through the resistor alone. That is the only place the circulation
 * model is *provably* the Windkessel it embeds, which is what the decay test needs.
 */
function closedValveStretch(profile: readonly CirculationSample[]): CirculationSample[] {
  let bestStart = 0
  let bestLength = 0
  let length = 0
  for (let index = 1; index < profile.length; index += 1) {
    if (profile[index].aorticFlow <= 1e-6 && profile[index - 1].aorticFlow <= 1e-6) length += 1
    else {
      if (length > bestLength) {
        bestLength = length
        bestStart = index - length
      }
      length = 0
    }
  }
  if (length > bestLength) {
    bestLength = length
    bestStart = profile.length - length
  }
  return profile.slice(bestStart, bestStart + bestLength + 1)
}

describe('Windkessel artery', () => {
  it('names its own time constant and discharges against it', () => {
    expect(windkesselTimeConstant(ARTERY)).toBeCloseTo(1.92, 12)
    const free = simulateWindkessel(ARTERY, 100, () => 0, { tEnd: 20, dt: 0.01 })
    for (const sample of free) {
      expect(sample.arterialPressure).toBeCloseTo(windkesselDecayPressure(ARTERY, 100, sample.time), 6)
    }
    // One time constant is an e-fold. The reporting step is chosen so that τ lands on
    // the grid; sample-by-time equality would be a coin flip on an accumulator.
    const after = free[Math.round(1.92 / 0.01)]
    expect(after.time).toBeCloseTo(1.92, 9)
    expect(after.arterialPressure).toBeCloseTo(100 / Math.E, 6)
    expect(free[0].inflow).toBe(0)
  })

  it('drains towards the venous pressure it was given, not towards zero', () => {
    const loaded = { ...ARTERY, venousPressure: 5 }
    expect(windkesselDecayPressure(loaded, 105, 1.92)).toBeCloseTo(5 + 100 / Math.E, 10)
    const run = simulateWindkessel(loaded, 105, () => 0, { tEnd: 40, dt: 0.05 })
    expect(run[run.length - 1].arterialPressure).toBeLessThan(5.01)
    expect(run[run.length - 1].arterialPressure).toBeGreaterThanOrEqual(5)
    // A steady inflow now sits at Pv + Q·R, not Q·R.
    const fed = simulateWindkessel(loaded, 5, () => 10, { tEnd: 60, dt: 0.05 })
    expect(fed[fed.length - 1].arterialPressure).toBeCloseTo(5 + 12, 3)
  })

  it('is an RC low-pass the control domain can measure for itself', () => {
    const step = simulateWindkessel(ARTERY, 0, () => 20, { tEnd: 30, dt: 0.01 })
    const metrics = stepResponseMetrics(step.map((sample) => ({ timeSeconds: sample.time, output: sample.arterialPressure, state: [sample.arterialPressure] })))
    // A first-order step takes τ·ln(10/9) → τ·ln(10) to go 10→90 %, i.e. rise = τ·ln 9,
    // and τ·ln 50 to enter a ±2 % band. Measuring a haemodynamic model with an
    // electronics test rig is the point of writing the artery as an RC circuit.
    expect(metrics.steadyState).toBeCloseTo(20 * ARTERY.resistance, 4)
    expect(metrics.riseTimeSeconds / Math.log(9)).toBeCloseTo(windkesselTimeConstant(ARTERY), 2)
    expect(metrics.settlingTimeSeconds).toBeCloseTo(windkesselTimeConstant(ARTERY) * Math.log(50), 2)
    expect(metrics.overshootPct).toBe(0)
  })

  it('puts the characteristic-impedance step at the inlet and nowhere else', () => {
    const noZc = simulateWindkessel(ARTERY, 0, (t) => (t < 1 ? 20 : 0), { tEnd: 3, dt: 0.01 })
    for (const sample of noZc) expect(sample.inputPressure).toBe(sample.arterialPressure)

    const stiff = { ...ARTERY, characteristicImpedance: 0.4 }
    const run = simulateWindkessel(stiff, 0, () => 20, { tEnd: 30, dt: 0.01 })
    expect(run[0].arterialPressure).toBe(0)
    expect(run[0].inputPressure).toBeCloseTo(0.4 * 20, 10)
    for (const sample of run) expect(sample.inputPressure - sample.arterialPressure).toBeCloseTo(0.4 * sample.inflow, 10)
    // The step costs nothing at steady state: a series resistance carries no gradient
    // when the flow it passes is already accounted for by the capacitor's plateau.
    expect(run[run.length - 1].inputPressure).toBeCloseTo(run[run.length - 1].arterialPressure + 8, 6)
  })

  it('obeys its own input impedance under a sinusoidal flow', () => {
    const frequency = 0.2
    const omega = 2 * Math.PI * frequency
    const amplitude = 10
    const profile = simulateWindkessel(ARTERY, 0, (t) => amplitude * Math.sin(omega * t), { tEnd: 60, dt: 0.002 })
    // Project the settled trace onto the drive: over whole periods the sin/cos basis is
    // orthogonal, so this reads amplitude and phase out of the simulation directly.
    const steady = profile.filter((sample) => sample.time >= 40 && sample.time < 60)
    let cos = 0
    let sin = 0
    let sum = 0
    for (const sample of steady) {
      cos += sample.arterialPressure * Math.cos(omega * sample.time)
      sin += sample.arterialPressure * Math.sin(omega * sample.time)
      sum += sample.arterialPressure
    }
    const measured = Math.hypot((2 * cos) / steady.length, (2 * sin) / steady.length)
    const phase = (Math.atan2((2 * cos) / steady.length, (2 * sin) / steady.length) * 180) / Math.PI
    const theory = arterialInputImpedance(ARTERY, frequency)
    expect(measured / (amplitude * theory.magnitude)).toBeCloseTo(1, 4)
    expect(phase).toBeCloseTo(theory.phaseDegrees, 3)
    // A drive with no DC component cannot lift the mean pressure of a linear load.
    expect(Math.abs(sum / steady.length)).toBeLessThan(0.005)
  })

  it('has the DC and high-frequency limits its formula claims', () => {
    const withZc = { ...ARTERY, characteristicImpedance: 0.03 }
    const dc = arterialInputImpedance(withZc, 1e-6)
    expect(dc.magnitude).toBeCloseTo(ARTERY.resistance + 0.03, 6)
    expect(Math.abs(dc.phaseDegrees)).toBeLessThan(0.01)

    const fast = arterialInputImpedance(withZc, 1000)
    expect(fast.magnitude).toBeCloseTo(0.03, 4)
    // A series real part pulls the phase back to 0 °: the −90° limit belongs to the
    // two-element model alone, where nothing is left but the shorted capacitor.
    expect(Math.abs(fast.phaseDegrees)).toBeLessThan(0.5)
    const element2 = arterialInputImpedance(ARTERY, 1000)
    expect(element2.phaseDegrees).toBeCloseTo(-90, 1)
    expect(element2.magnitude).toBeCloseTo(1 / (2 * Math.PI * 1000 * ARTERY.compliance), 6)

    // At the corner the resistor has lost 3 dB and pressure lags by exactly 45°.
    const corner = 1 / (2 * Math.PI * windkesselTimeConstant(ARTERY))
    expect(arterialInputImpedance(ARTERY, corner).magnitude).toBeCloseTo(ARTERY.resistance / Math.SQRT2, 8)
    expect(arterialInputImpedance(ARTERY, corner).phaseDegrees).toBeCloseTo(-45, 8)
    expect(() => arterialInputImpedance(ARTERY, 0)).toThrow(/Frequency must be positive/)
  })
})

describe('left heart against its load', () => {
  it('conserves volume over a settled beat', () => {
    const { profile, metrics } = beat(RESTING_CIRCULATION)
    const cycle = profile.filter((sample) => sample.time >= metrics.fromTime && sample.time <= metrics.toTime)
    const times = cycle.map((sample) => sample.time)
    const filled = trap(cycle.map((sample) => sample.mitralFlow), times)
    // dV/dt = Q_mitral − Q_aortic, so the two integrals differ by the drift the
    // metrics report — to within the trapezoid error of a 3 ms reporting step,
    // measured at 1.8e-2 mL here. Refining the grid fourfold takes it to 2.6e-3,
    // which is what makes it a grid artefact and not a bookkeeping error.
    const residual = filled - metrics.forwardVolume - metrics.cycleVolumeDrift
    expect(Math.abs(residual)).toBeLessThan(0.05)
    expect(Math.abs(flowBalanceResidual(RESTING_CIRCULATION, RUN.dt / 4))).toBeLessThan(Math.abs(residual))
    expect(Math.abs(metrics.cycleVolumeDrift)).toBeLessThan(1)
    // With competent valves the gross and forward volumes are the same beat.
    expect(metrics.forwardVolume).toBeLessThan(metrics.strokeVolume)
    expect(metrics.strokeVolume - metrics.forwardVolume).toBeLessThan(0.5)
    expect(metrics.regurgitantVolume).toBeLessThan(0.5)
  })

  it('spends its stroke work on the artery and on the outflow tract', () => {
    const { profile, metrics } = beat(RESTING_CIRCULATION)
    const cycle = profile.filter((sample) => sample.time >= metrics.fromTime && sample.time <= metrics.toTime)
    const times = cycle.map((sample) => sample.time)
    const zc = RESTING_CIRCULATION.characteristicImpedance ?? 0
    const leak = RESTING_CIRCULATION.reverseLeakFactor ?? 1e4
    const forward = RESTING_CIRCULATION.aorticResistance + zc
    // The valve relation is exact in both directions, so the ventricle's power splits
    // into what the artery receives and what the outflow tract burns off.
    const ontoArtery = trap(cycle.map((sample) => sample.arterialPressure * sample.aorticFlow), times)
    const inTheValve = trap(cycle.map((sample) => (sample.aorticFlow >= 0 ? forward : RESTING_CIRCULATION.aorticResistance * leak) * sample.aorticFlow ** 2), times)
    const onFilling = trap(cycle.map((sample) => sample.leftVentricularPressure * sample.mitralFlow), times)
    // Both sides are trapezoids of the same trace, so they agree to the quadrature
    // error and not exactly: 0.08 % measured.
    expect(Math.abs(metrics.strokeWork / (ontoArtery + inTheValve - onFilling) - 1)).toBeLessThan(0.002)
    expect(metrics.strokeWork).toBeGreaterThan(0)
    // A quarter of the beat is lost crossing the lumped outflow tract. That is the
    // price of one resistor instead of a real aortic root, and it is worth knowing
    // before quoting an efficiency from this model.
    expect(inTheValve / metrics.strokeWork).toBeGreaterThan(0.15)
    expect(inTheValve / metrics.strokeWork).toBeLessThan(0.35)
  })

  it('discharges through the resistor between beats, exactly like the Windkessel', () => {
    const { profile } = beat(RESTING_CIRCULATION)
    const closed = closedValveStretch(profile)
    expect(closed.length * RUN.dt).toBeGreaterThan(0.5)
    const tau = windkesselTimeConstant(RESTING_CIRCULATION)
    // Start one sample in: the valve has only just shut, and the tail of ejection is
    // still moving volume into the artery.
    const base = closed[1]
    let worst = 0
    for (const sample of closed.slice(2)) {
      worst = Math.max(worst, Math.abs(sample.arterialPressure / windkesselDecayPressure(RESTING_CIRCULATION, base.arterialPressure, sample.time - base.time) - 1))
    }
    expect(worst).toBeLessThan(0.005)
    const last = closed[closed.length - 2]
    const slope = -Math.log(last.arterialPressure / base.arterialPressure) / (last.time - base.time)
    expect(slope * tau).toBeCloseTo(1, 2)
  })

  it('satisfies MAP = CO × SVR to within the leak it reports', () => {
    const { metrics } = beat(RESTING_CIRCULATION)
    const balance = arterialPressureBalance(RESTING_CIRCULATION, metrics)
    expect(balance.relativeResidual).toBeLessThan(0.005)
    // Closing the valves properly removes the discrepancy: the residual was the
    // reverse leak, not the integrator.
    const tight = { ...RESTING_CIRCULATION, reverseLeakFactor: 1e9 }
    const tightBalance = arterialPressureBalance(tight, beat(tight).metrics)
    expect(tightBalance.relativeResidual).toBeLessThan(0.0005)
    expect(metrics.regurgitantVolume / metrics.strokeVolume).toBeGreaterThan(tightBalance.relativeResidual)
    // Whatever crosses the resistor is what the mean pressure is made of.
    const span = metrics.toTime - metrics.fromTime
    expect(metrics.forwardVolume / span / (metrics.meanArterialPressure / RESTING_CIRCULATION.resistance)).toBeCloseTo(1, 3)
  })

  it('pumps the same blood twice when the valves leak', () => {
    const leaky: CirculationParameters = { ...RESTING_CIRCULATION, reverseLeakFactor: 30 }
    const { metrics } = beat(leaky)
    const baseline = beat(RESTING_CIRCULATION).metrics
    expect(metrics.regurgitantVolume).toBeGreaterThan(30)
    expect(metrics.forwardVolume / metrics.strokeVolume).toBeLessThan(0.5)
    expect(metrics.forwardVolume / (metrics.toTime - metrics.fromTime) / (metrics.meanArterialPressure / leaky.resistance)).toBeCloseTo(1, 3)
    // The signature a designer has to be able to see: the ejection fraction looks
    // *better*, the pulse pressure widens, and the mean pressure falls.
    expect(metrics.ejectionFraction).toBeGreaterThan(baseline.ejectionFraction)
    expect(metrics.pulsePressure).toBeGreaterThan(baseline.pulsePressure)
    expect(metrics.meanArterialPressure).toBeLessThan(baseline.meanArterialPressure)
    // So the quoted identity breaks, loudly, because its left side is now gross output.
    expect(arterialPressureBalance(leaky, metrics).relativeResidual).toBeGreaterThan(0.4)
  })

  it('says so when the run has not settled', () => {
    const unsettled = beat(RESTING_CIRCULATION, 1, RUN.dt, 40)
    expect(Math.abs(unsettled.metrics.cycleVolumeDrift)).toBeGreaterThan(10)
    expect(arterialPressureBalance(RESTING_CIRCULATION, unsettled.metrics).relativeResidual).toBeGreaterThan(0.4)
    const settled = beat(RESTING_CIRCULATION)
    expect(Math.abs(unsettled.metrics.strokeVolume / settled.metrics.strokeVolume - 1)).toBeGreaterThan(0.2)
    // Two long runs agree; the loop is a fixed point, not a slow drift.
    const longer = beat(RESTING_CIRCULATION, 30)
    expect(longer.metrics.strokeVolume).toBeCloseTo(settled.metrics.strokeVolume, 2)
    expect(longer.metrics.meanArterialPressure).toBeCloseTo(settled.metrics.meanArterialPressure, 1)
  })

  it('stretches the ventricle along a straight line, and never further', () => {
    const loaded = [4, 8, 12, 16, 20].map((pressure) => beat({ ...RESTING_CIRCULATION, leftAtrialPressure: pressure }).metrics)
    const first = loaded.slice(1).map((metrics, index) => metrics.strokeVolume - loaded[index].strokeVolume)
    const second = first.slice(1).map((delta, index) => delta - first[index])
    for (const delta of first) expect(delta).toBeGreaterThan(30)
    // A linear elastance and a resistive fill give a Frank–Starling relation with zero
    // curvature: this heart cannot reach its own plateau. Real ones do, and that is a
    // limitation of the model, recorded here so a future length-dependent activation
    // has to be added deliberately rather than quietly.
    for (const curvature of second) expect(Math.abs(curvature)).toBeLessThan(0.05)
    expect(first[0] / 4).toBeCloseTo(8.08, 1)
    for (const metrics of loaded) expect(metrics.ejectionFraction).toBeGreaterThan(0.45)
    expect(loaded[loaded.length - 1].ejectionFraction).toBeLessThan(0.6)
  })

  it('empties less and runs hotter against a higher resistance', () => {
    const swept = [0.8, 1.2, 2, 2.6].map((resistance) => beat({ ...RESTING_CIRCULATION, resistance }).metrics)
    for (let index = 1; index < swept.length; index += 1) {
      expect(swept[index].strokeVolume).toBeLessThan(swept[index - 1].strokeVolume)
      expect(swept[index].endSystolicVolume).toBeGreaterThan(swept[index - 1].endSystolicVolume)
      expect(swept[index].meanArterialPressure).toBeGreaterThan(swept[index - 1].meanArterialPressure)
      expect(swept[index].ejectionFraction).toBeLessThan(swept[index - 1].ejectionFraction)
    }
    expect(swept[0].strokeVolume).toBeCloseTo(73, 0)
    expect(swept[swept.length - 1].strokeVolume).toBeCloseTo(46.3, 0)
  })

  it('empties harder when the elastance is raised', () => {
    const swept = [1.4, 2, 2.7, 3.5].map((elastanceMax) => beat({ ...RESTING_CIRCULATION, elastanceMax }).metrics)
    for (let index = 1; index < swept.length; index += 1) {
      expect(swept[index].endSystolicVolume).toBeLessThan(swept[index - 1].endSystolicVolume)
      expect(swept[index].strokeVolume).toBeGreaterThan(swept[index - 1].strokeVolume)
      expect(swept[index].peakDpDt).toBeGreaterThan(swept[index - 1].peakDpDt)
    }
    // Inotropy buys volume by emptying the same filling pressure further, not by
    // filling more: the end-diastolic volume moves by about 5 mL across the sweep.
    const spread = Math.max(...swept.map((metrics) => metrics.endDiastolicVolume)) - Math.min(...swept.map((metrics) => metrics.endDiastolicVolume))
    expect(spread).toBeLessThan(6)
    expect(swept[swept.length - 1].peakDpDt / swept[0].peakDpDt).toBeGreaterThan(2)
  })

  it('trades stroke volume for rate, and neither one linearly', () => {
    const swept = [1.6, 1.2, 0.86, 0.6, 0.4].map((beatPeriod) => beat({ ...RESTING_CIRCULATION, beatPeriod }).metrics)
    for (let index = 1; index < swept.length; index += 1) {
      expect(swept[index].strokeVolume).toBeLessThan(swept[index - 1].strokeVolume)
      expect(swept[index].cardiacOutputMlPerS).toBeGreaterThan(swept[index - 1].cardiacOutputMlPerS)
    }
    // Quadrupling the rate less than doubles the output: the fill time is the limit,
    // and it is the reason this model cannot simply multiply by heart rate.
    expect(swept[swept.length - 1].heartRateBpm / swept[0].heartRateBpm).toBeCloseTo(4, 6)
    expect(swept[swept.length - 1].cardiacOutputMlPerS / swept[0].cardiacOutputMlPerS).toBeLessThan(2)
    expect(swept[swept.length - 1].strokeVolume).toBeLessThan(swept[0].strokeVolume / 2)
  })

  it('gives a stiff artery a wider pulse pressure', () => {
    const swept = [0.8, 1.2, 1.6, 2.4].map((compliance) => {
      const parameters = { ...RESTING_CIRCULATION, compliance }
      return { parameters, metrics: beat(parameters).metrics }
    })
    for (let index = 1; index < swept.length; index += 1) {
      expect(swept[index].metrics.pulsePressure).toBeLessThan(swept[index - 1].metrics.pulsePressure)
      expect(swept[index].metrics.meanArterialPressure).toBeGreaterThan(swept[index - 1].metrics.meanArterialPressure)
    }
    // Pulse pressure ≈ stroke volume / compliance is the one arterial claim worth
    // quoting; the ratio holds to a few percent across a threefold change in C.
    const ratios = swept.map(({ parameters, metrics }) => metrics.pulsePressure / (metrics.strokeVolume / parameters.compliance))
    for (const ratio of ratios) expect(ratio).toBeGreaterThan(0.84)
    for (const ratio of ratios) expect(ratio).toBeLessThan(0.89)
  })

  it('moves what it is designed to move by less than the reporting step', () => {
    const coarse = beat(RESTING_CIRCULATION, RUN.tEnd, 0.01).metrics
    const fine = beat(RESTING_CIRCULATION, RUN.tEnd, 0.001).metrics
    expect(fine.endDiastolicVolume).toBeCloseTo(coarse.endDiastolicVolume, 2)
    expect(fine.meanArterialPressure).toBeCloseTo(coarse.meanArterialPressure, 2)
    expect(fine.strokeVolume / coarse.strokeVolume).toBeCloseTo(1, 3)
    // Two metrics are genuinely grid-bound: the loop area needs samples around the loop
    // and dP/dt is a finite difference, so both under-read at a coarse step.
    expect(fine.strokeWork / coarse.strokeWork).toBeGreaterThan(1)
    expect(fine.strokeWork / coarse.strokeWork).toBeLessThan(1.01)
    expect(fine.peakDpDt).toBeGreaterThan(coarse.peakDpDt)
    expect(fine.peakDpDt / coarse.peakDpDt).toBeLessThan(1.08)
  })

  it('beats with a periodic, smooth elastance that stays inside its own bounds', () => {
    const period = RESTING_CIRCULATION.beatPeriod
    const systole = RESTING_CIRCULATION.systoleFraction * period
    for (const time of [0, 0.037, systole / 2, systole, period - 0.01, 12.7, -0.7]) {
      const value = ventricularElastance(RESTING_CIRCULATION, time)
      expect(value).toBeGreaterThanOrEqual(RESTING_CIRCULATION.elastanceMin)
      expect(value).toBeLessThanOrEqual(RESTING_CIRCULATION.elastanceMax)
    }
    expect(ventricularElastance(RESTING_CIRCULATION, period)).toBe(ventricularElastance(RESTING_CIRCULATION, 0))
    expect(ventricularElastance(RESTING_CIRCULATION, -0.7)).toBe(ventricularElastance(RESTING_CIRCULATION, 0.16))
    expect(ventricularElastance(RESTING_CIRCULATION, systole / 2)).toBe(RESTING_CIRCULATION.elastanceMax)
    const slope = (time: number): number =>
      (ventricularElastance(RESTING_CIRCULATION, time + 1e-6) - ventricularElastance(RESTING_CIRCULATION, time - 1e-6)) / 2e-6
    // sin² meets the flat diastole with zero slope at both ends: the vector field is C¹
    // across the phase boundary, so an open/close event is not also a kink in E.
    expect(Math.abs(slope(0))).toBeLessThan(1e-3)
    expect(Math.abs(slope(systole))).toBeLessThan(1e-3)
    expect(Math.abs(slope(0.02))).toBeGreaterThan(5)
    expect(() => ventricularElastance({ ...RESTING_CIRCULATION, systoleFraction: 1 }, 0)).toThrow(/strictly between 0 and 1/)
  })
})

describe('capillary exchange', () => {
  it('balances hydrostatic against oncotic pressure', () => {
    const report = starlingFiltration(ARTERIOLAR_END)
    expect(report.hydrostaticDifference).toBe(30)
    expect(report.oncoticDifference).toBe(20)
    expect(report.netFiltrationPressure).toBe(10)
    expect(report.flowPerUnitConductance).toBe(10)
    expect(starlingFiltration(ARTERIOLAR_END, 0.02).flowPerUnitConductance).toBeCloseTo(0.2, 12)
    // The null point the slider label should carry.
    expect(starlingFiltration({ ...ARTERIOLAR_END, capillaryPressure: 22 }).netFiltrationPressure).toBe(0)
  })

  it('lets a protein-tight membrane be the whole of the oncotic term', () => {
    expect(starlingFiltration({ ...ARTERIOLAR_END, reflectionCoefficient: 0 })).toMatchObject({
      oncoticDifference: 0,
      netFiltrationPressure: 30,
    })
    // With nothing held back, plasma and interstitium pull equally and only height remains.
    for (const sigma of [0, 0.25, 0.5, 1]) {
      expect(starlingFiltration({ ...ARTERIOLAR_END, reflectionCoefficient: sigma }).netFiltrationPressure).toBeCloseTo(30 - sigma * 20, 12)
    }
  })

  it('filters at the arteriolar end and recovers most, not all, at the venular end', () => {
    const bed = capillarySegmentExchange(ARTERIOLAR_END, VENULAR_END, 0.02)
    expect(bed.arteriolar.flowPerUnitConductance).toBeCloseTo(0.2, 12)
    expect(bed.venular.flowPerUnitConductance).toBeCloseTo(-0.18, 12)
    expect(bed.reabsorbed).toBeCloseTo(-0.18, 12)
    // The residual is why lymph exists: a bed cannot filter and reabsorb equally.
    expect(bed.netFiltration).toBeGreaterThan(0)
    expect(bed.netFiltration).toBeCloseTo(bed.arteriolar.flowPerUnitConductance + bed.venular.flowPerUnitConductance, 12)
  })

  it('drops filtration whenever the plasma holds more protein', () => {
    const rates = [15, 20, 25, 30, 35, 40].map((plasmaOncoticPressure) =>
      starlingFiltration({ ...ARTERIOLAR_END, plasmaOncoticPressure }).netFiltrationPressure,
    )
    for (let index = 1; index < rates.length; index += 1) expect(rates[index]).toBeLessThan(rates[index - 1])
    // The null point is where `Pc − Pi = σ(πc − πi)`: 35 mmHg of plasma protein against
    // this bed. Only past it does the wall recover fluid instead of losing it, which is
    // why a nephrotic drop in plasma protein — not a rise — is what causes oedema.
    expect(rates[4]).toBe(0)
    expect(rates[5]).toBeLessThan(0)
  })
})

describe('validation', () => {
  const cases: { label: string; run: () => unknown; message: RegExp }[] = [
    { label: 'resistance', run: () => windkesselTimeConstant({ resistance: 0, compliance: 1 }), message: /Vascular resistance must be positive/ },
    { label: 'compliance', run: () => windkesselTimeConstant({ resistance: 1, compliance: Number.NaN }), message: /Arterial compliance must be/ },
    { label: 'impedance', run: () => windkesselTimeConstant({ resistance: 1, compliance: 1, characteristicImpedance: -1 }), message: /Characteristic impedance must be/ },
    { label: 'pressure', run: () => simulateWindkessel(ARTERY, -5, () => 0, RUN), message: /Initial pressure must be non-negative/ },
    { label: 'leak', run: () => simulateCirculation({ ...RESTING_CIRCULATION, reverseLeakFactor: 0.5 }, 120, RUN), message: /Reverse leak factor must be at least 1/ },
    { label: 'elastance', run: () => simulateCirculation({ ...RESTING_CIRCULATION, elastanceMax: 0.06 }, 120, RUN), message: /Peak elastance must exceed/ },
    { label: 'systole', run: () => simulateCirculation({ ...RESTING_CIRCULATION, systoleFraction: 1 }, 120, RUN), message: /Systole fraction must lie strictly/ },
    { label: 'preload', run: () => simulateCirculation({ ...RESTING_CIRCULATION, leftAtrialPressure: 0 }, 120, RUN), message: /Left atrial pressure must be positive/ },
    { label: 'mitral', run: () => simulateCirculation({ ...RESTING_CIRCULATION, mitralResistance: 0 }, 120, RUN), message: /Mitral resistance must be positive/ },
    { label: 'volume', run: () => simulateCirculation(RESTING_CIRCULATION, 0, RUN), message: /Initial ventricular volume must be positive/ },
    { label: 'window', run: () => simulateCirculation(RESTING_CIRCULATION, 120, { tEnd: 0, dt: 0.003 }), message: /Simulation end time must be positive/ },
    { label: 'steps', run: () => simulateCirculation(RESTING_CIRCULATION, 120, { tEnd: 2000, dt: 0.001 }), message: /output steps \(limit 400000\)/ },
    { label: 'reflection', run: () => starlingFiltration({ ...ARTERIOLAR_END, reflectionCoefficient: 1.5 }), message: /Reflection coefficient must be between 0 and 1/ },
    { label: 'oncotic', run: () => starlingFiltration({ ...ARTERIOLAR_END, plasmaOncoticPressure: -1 }), message: /Plasma oncotic pressure must be non-negative/ },
    { label: 'conductance', run: () => starlingFiltration(ARTERIOLAR_END, 0), message: /Filtration coefficient times surface area must be positive/ },
    { label: 'decay', run: () => windkesselDecayPressure(ARTERY, 100, -1), message: /Time must be non-negative/ },
  ]

  it.each(cases)('$label is refused', ({ run, message }) => {
    expect(run).toThrow(message)
  })

  it('refuses a beat it cannot read', () => {
    const profile = simulateCirculation(RESTING_CIRCULATION, 120, RUN)
    expect(() => pressureVolumeMetrics(RESTING_CIRCULATION, profile.slice(0, 5))).toThrow(/at least 8 samples/)
    expect(() => pressureVolumeMetrics(RESTING_CIRCULATION, profile, { fromTime: 3, toTime: 3.012 })).toThrow(/at least 8 samples/)
  })
})
