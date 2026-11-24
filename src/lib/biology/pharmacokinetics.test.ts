import { describe, expect, it } from 'vitest'

import {
  accumulationFactor,
  absorptionConcentration,
  absorptionPeakConcentration,
  absorptionPeakTime,
  areaUnderCurve,
  averageSteadyStateConcentration,
  bolusRates,
  concentrationDependentClearance,
  doseNormalizedExposure,
  estimateElimination,
  infusionConcentration,
  infusionSteadyState,
  multipleDoseBolusProfile,
  oneCompartmentConcentration,
  peakAndTrough,
  saturableElapsedTime,
  saturableEliminationProfile,
  saturableInfusionProfile,
  saturableInfusionSteadyState,
  simulateInfusion,
  simulateOneCompartmentBolus,
  simulateOralAbsorption,
  simulateTwoCompartmentBolus,
  twoCompartmentConcentration,
  twoCompartmentMacros,
  twoCompartmentMassBalance,
  type BolusParameters,
} from './pharmacokinetics'

/** 500 mg in 40 L cleared at 5 L/h: k = 0.125 h⁻¹, half-life 5.5 h. */
const BOLUS: BolusParameters = { dose: 500, volume: 40, clearance: 5 }

const THREE_HALFLIVES = { tEnd: 17, dt: 0.05 }

describe('one-compartment disposition', () => {
  it('derives the rate constant, half-life and zero-time concentration from the pair', () => {
    const rates = bolusRates(BOLUS)
    expect(rates.eliminationRate).toBeCloseTo(5 / 40, 12)
    expect(rates.halfLife).toBeCloseTo(Math.LN2 / 0.125, 12)
    expect(rates.initialConcentration).toBe(12.5)
    // Clearance and volume act in opposite directions on the clock, and only
    // their ratio matters: doubling both changes nothing.
    expect(bolusRates({ dose: 500, volume: 80, clearance: 10 }).eliminationRate).toBe(rates.eliminationRate)
    expect(bolusRates({ ...BOLUS, clearance: 10 }).halfLife).toBeCloseTo(rates.halfLife / 2, 12)
  })

  it('integrates to the exponential it is supposed to', () => {
    const samples = simulateOneCompartmentBolus(BOLUS, THREE_HALFLIVES)
    const rates = bolusRates(BOLUS)
    for (const sample of samples) {
      expect(sample.concentration).toBeCloseTo(12.5 * Math.exp(-rates.eliminationRate * sample.time), 8)
      expect(sample.amount).toBeCloseTo(500 * Math.exp(-rates.eliminationRate * sample.time), 6)
      // The reported concentration is the reported amount divided by the same
      // volume, always — the two fields cannot disagree.
      expect(sample.concentration).toBeCloseTo(sample.amount / 40, 12)
    }
    // The first sample to fall below half must be within one reporting step of
    // ln2/k, which is what a half-life means on a discrete grid.
    const crossing = samples.find((sample) => sample.amount < 250)
    expect(crossing).toBeDefined()
    expect(crossing?.time).toBeGreaterThanOrEqual(Math.LN2 / rates.eliminationRate)
    expect(crossing?.time).toBeLessThanOrEqual(Math.LN2 / rates.eliminationRate + 0.05)
  })

  it('puts the whole exposure history in the area under the curve', () => {
    const window = { tEnd: 80, dt: 0.02 }
    const samples = simulateOneCompartmentBolus(BOLUS, window)
    const expected = doseNormalizedExposure(BOLUS)
    expect(expected.auc).toBeCloseTo(500 / 5, 12)
    // The exact integral of the truncation at tEnd, not D/CL: the tail past 80 h
    // is 0.0045 % of the dose and belongs to the model, not to the quadrature.
    const exact = (BOLUS.dose / BOLUS.clearance) * (1 - Math.exp(-0.125 * window.tEnd))
    expect(areaUnderCurve(samples)).toBeCloseTo(exact, 3)
  })
})

describe('infusion', () => {
  const infusion = { rate: 50, volume: 40, clearance: 5 }

  it('approaches a plateau set by clearance alone', () => {
    expect(infusionSteadyState(infusion)).toBeCloseTo(10, 12)
    const window = { tEnd: 40, dt: 0.1 }
    const samples = simulateInfusion(infusion, window)
    const plateau = infusionSteadyState(infusion)
    // Indexed rather than matched on the clock: the reported times are accumulated
    // by the integrator, so exact float equality on `time` is a coin flip.
    const at = (time: number) => samples[Math.round(time / window.dt)]
    for (const sample of samples) {
      expect(sample.concentration).toBeCloseTo(infusionConcentration(infusion, sample.time), 8)
    }
    // One, three and five half-lives: 50 %, 87.5 % and 96.9 % of the plateau.
    const halfLife = Math.LN2 / 0.125
    for (const multiple of [1, 3, 5]) {
      const nearest = at(multiple * halfLife)
      const fraction = 1 - Math.exp(-0.125 * nearest.time)
      expect(nearest.concentration / plateau).toBeCloseTo(fraction, 6)
      expect(nearest.concentration).toBeLessThan(plateau)
    }
    expect(at(halfLife).concentration / plateau).toBeCloseTo(0.5, 1)
    expect(at(3 * halfLife).concentration / plateau).toBeCloseTo(0.875, 2)
  })

  it('lets volume change how fast the plateau arrives, never what it is', () => {
    const fast = simulateInfusion({ ...infusion, volume: 20 }, { tEnd: 200, dt: 0.5 })
    const slow = simulateInfusion({ ...infusion, volume: 80 }, { tEnd: 200, dt: 0.5 })
    // Both end on the same plateau, eighteen half-lives of the slower clock away;
    // only the route there differs.
    expect(fast[fast.length - 1].concentration).toBeCloseTo(slow[slow.length - 1].concentration, 3)
    expect(fast[fast.length - 1].concentration).toBeCloseTo(10, 3)
    expect(fast[8].concentration).toBeGreaterThan(slow[8].concentration)
  })
})

describe('first-order absorption', () => {
  const oral = { ...BOLUS, absorptionRate: 1.5, bioavailability: 0.8, lagTime: 0.5 }

  it('peaks where the Bateman derivative says it must', () => {
    const tmax = absorptionPeakTime(oral)
    expect(tmax).toBeCloseTo(Math.log(1.5 / 0.125) / (1.5 - 0.125), 12)
    const peak = absorptionPeakConcentration(oral)
    // A peak is a stationary point: the two sides of it sit lower, and the
    // derivative across it changes sign.
    const delta = 1e-4
    expect(absorptionConcentration(oral, 0.5 + tmax)).toBeGreaterThan(absorptionConcentration(oral, 0.5 + tmax - delta))
    expect(absorptionConcentration(oral, 0.5 + tmax)).toBeGreaterThan(absorptionConcentration(oral, 0.5 + tmax + delta))
    expect(peak).toBeGreaterThan(0)
    expect(peak).toBeLessThan((0.8 * 500) / 40)
  })

  it('agrees with the closed form when the gut is integrated instead', () => {
    const samples = simulateOralAbsorption(oral, { tEnd: 30, dt: 0.05 })
    for (const sample of samples) {
      expect(sample.concentration).toBeCloseTo(absorptionConcentration(oral, sample.time), 6)
    }
    // Nothing disappears on the way: what left the gut is either in the body or
    // has been cleared, and the cleared part is exactly dose·F minus the rest.
    const last = samples[samples.length - 1]
    expect(last.gutAmount + last.amount).toBeLessThanOrEqual(0.8 * 500 + 1e-6)
    expect(last.gutAmount).toBeLessThan(1e-6)
    // And the simulated peak lands on the analytic one, not merely near it.
    const measured = peakAndTrough(samples)
    expect(measured.maximum.concentration).toBeCloseTo(absorptionPeakConcentration(oral), 3)
    expect(measured.maximum.time).toBeCloseTo(0.5 + absorptionPeakTime(oral), 1)
  })

  it('holds at zero through the lag and then repeats the unlagged curve', () => {
    expect(absorptionConcentration(oral, 0.25)).toBe(0)
    const noLag = { ...oral, lagTime: 0 }
    const samples = simulateOralAbsorption(noLag, { tEnd: 12, dt: 0.25 })
    for (const sample of samples) {
      expect(absorptionConcentration(noLag, sample.time)).toBeCloseTo(absorptionConcentration(oral, sample.time + 0.5), 12)
    }
  })

  it('keeps a usable curve when absorption and elimination share a rate', () => {
    // ka = k is the singular case the two-exponential formula divides by, and the
    // limit t·e^−kt is what the integrated gut produces.
    const equal = { ...BOLUS, absorptionRate: 0.125, bioavailability: 1, lagTime: 0 }
    const samples = simulateOralAbsorption(equal, { tEnd: 40, dt: 0.1 })
    for (const sample of samples) {
      expect(sample.concentration).toBeCloseTo(absorptionConcentration(equal, sample.time), 6)
    }
    expect(absorptionPeakTime(equal)).toBeCloseTo(1 / 0.125, 12)
    // The degenerate peak is the height of t·e^−kt at its own maximum:
    // (D·ka/V)·(1/k)·e^−1 = (D/V)/e.
    expect(absorptionPeakConcentration(equal)).toBeCloseTo(12.5 / Math.E, 9)
    expect(peakAndTrough(samples).maximum.concentration).toBeCloseTo(12.5 / Math.E, 2)
  })

  it('refuses a lag that leaves the run nothing to simulate', () => {
    expect(() => simulateOralAbsorption({ ...BOLUS, absorptionRate: 1, bioavailability: 1, lagTime: 10 }, { tEnd: 10, dt: 0.5 })).toThrow(
      /not inside the simulation window/,
    )
  })
})

describe('two-compartment disposition', () => {
  const model = { dose: 100, volumeCentral: 20, volumePeripheral: 40, clearance: 4, distributionClearance: 10 }

  it('builds macro constants that satisfy their own invariants', () => {
    const macro = twoCompartmentMacros(model)
    const { k10, k12, k21 } = macro.micro
    expect(k10).toBeCloseTo(0.2, 12)
    expect(k12).toBeCloseTo(0.5, 12)
    expect(k21).toBeCloseTo(0.25, 12)
    // α and β are the roots of λ² − (k10+k12+k21)λ + k10·k21 = 0.
    expect(macro.alpha + macro.beta).toBeCloseTo(k10 + k12 + k21, 12)
    expect(macro.alpha * macro.beta).toBeCloseTo(k10 * k21, 12)
    expect(macro.alpha).toBeGreaterThan(macro.beta)
    // The two intercepts must rebuild the dose at t = 0, and the terminal
    // half-life must belong to the slower root.
    expect(macro.a + macro.b).toBeCloseTo(model.dose / model.volumeCentral, 12)
    expect(macro.halfLife).toBeCloseTo(Math.LN2 / macro.beta, 12)
    expect(twoCompartmentConcentration(model, 0)).toBeCloseTo(5, 12)
  })

  it('tracks both buckets and decays at β once distribution is finished', () => {
    const samples = simulateTwoCompartmentBolus(model, { tEnd: 60, dt: 0.1 })
    for (const sample of samples) {
      expect(sample.concentration).toBeCloseTo(twoCompartmentConcentration(model, sample.time), 6)
      // Neither bucket goes negative, and the peripheral one starts empty.
      expect(sample.peripheralAmount).toBeGreaterThanOrEqual(-1e-12)
    }
    const last = samples[samples.length - 1]
    const balance = twoCompartmentMassBalance(model, samples)
    expect(balance.recovered + balance.eliminated).toBeCloseTo(model.dose, 9)
    // Late enough that only β survives, the two buckets share the terminal slope
    // and their amounts sit in the eigenvector ratio k12/(k21 − β).
    const macro = twoCompartmentMacros(model)
    const logSlope =
      Math.log(last.concentration / samples[samples.length - 11].concentration) / (last.time - samples[samples.length - 11].time)
    expect(logSlope).toBeCloseTo(-macro.beta, 4)
    expect(last.peripheralAmount / last.amount).toBeCloseTo(macro.micro.k12 / (macro.micro.k21 - macro.beta), 4)
    // The peripheral concentration is the bucket's own amount over its own volume.
    expect(last.peripheralConcentration).toBeCloseTo(last.peripheralAmount / model.volumePeripheral, 12)
    // Terminal-phase tissue concentration sits *above* plasma: the bucket is
    // handing drug back to a central compartment that clearance is emptying. This
    // is the one thing the two-exponential curve cannot show, and the reason the
    // peripheral bucket is worth integrating at all.
    expect(last.peripheralConcentration).toBeGreaterThan(last.concentration)
    const crossover = samples.findIndex((sample) => sample.peripheralConcentration > sample.concentration)
    expect(crossover).toBeGreaterThan(0)
    expect(samples[crossover - 1].peripheralConcentration).toBeLessThanOrEqual(samples[crossover - 1].concentration)
  })

  it('clears the dose at the rate clearance sets, in two buckets or one', () => {
    const window = { tEnd: 120, dt: 0.01 }
    const samples = simulateTwoCompartmentBolus(model, window)
    const asProfile = samples.map((sample) => ({ time: sample.time, concentration: sample.concentration, amount: sample.amount }))
    // The exact integral of the biexponential truncated at tEnd, so the remaining
    // β tail is accounted for instead of being blamed on the quadrature.
    const macro = twoCompartmentMacros(model)
    const exact =
      (macro.a * (1 - Math.exp(-macro.alpha * window.tEnd))) / macro.alpha +
      (macro.b * (1 - Math.exp(-macro.beta * window.tEnd))) / macro.beta
    expect(areaUnderCurve(asProfile)).toBeCloseTo(exact, 4)
    expect(exact).toBeLessThan(model.dose / model.clearance)
  })
})

describe('multiple dosing', () => {
  const interval = 8
  const k = 0.125

  it('accumulates by exactly 1/(1 − e^−kτ)', () => {
    const factor = accumulationFactor(k, interval)
    expect(factor).toBeCloseTo(1 / (1 - Math.exp(-1)), 12)
    // A dose given once per half-life doubles the exposure, and that is the
    // definition of the factor rather than a fitted number.
    expect(accumulationFactor(Math.LN2 / 6, 6)).toBeCloseTo(2, 12)
    expect(() => accumulationFactor(0, 8)).toThrow(/Elimination rate constant/)
  })

  it('reaches the steady state the factor promises', () => {
    const factor = accumulationFactor(k, interval)
    const many = multipleDoseBolusProfile(BOLUS, { dosingInterval: interval, doses: 61, window: { tEnd: 480, dt: 0.25 } })
    // Up to but not including the next dose: the sawtooth jumps at t = τ, so the
    // identity is only claimed on the stretch where the curve is continuous.
    const first = multipleDoseBolusProfile(BOLUS, { dosingInterval: interval, doses: 1, window: { tEnd: 7.75, dt: 0.25 } })
    // Deep in the regimen, the curve over the last interval is the first-dose
    // curve scaled by the accumulation factor — the superposition identity,
    // exact to within e^(−k·59τ) of the forgotten doses.
    for (const sample of first) {
      const settled = many.find((candidate) => Math.abs(candidate.time - (59 * interval + sample.time)) < 1e-9)
      expect(settled).toBeDefined()
      expect(settled!.concentration).toBeCloseTo(sample.concentration * factor, 6)
    }
    // Immediately after a dose, the geometric sum of the kernel is the peak.
    const peak = 12.5 / (1 - Math.exp(-k * interval))
    expect(many.find((sample) => sample.time === 472)!.concentration).toBeCloseTo(peak, 6)
    // Between doses the sawtooth is pure decay: every consecutive ratio is e^−kΔt.
    const cycle = many.filter((sample) => sample.time >= 472 && sample.time < 480)
    for (let index = 1; index < cycle.length; index += 1) {
      expect(cycle[index].concentration / cycle[index - 1].concentration).toBeCloseTo(Math.exp(-k * 0.25), 9)
    }
    // Peak-to-trough is the ratio a therapeutic window is compared against, and
    // it is read off the curve rather than asserted about the formula: across the
    // 7.75 h the grid can show between two doses, the decay is e^kΔ.
    const justAfterDose = many.find((sample) => sample.time === 472)!.concentration
    const justBeforeNext = many.find((sample) => sample.time === 479.75)!.concentration
    expect(justAfterDose / justBeforeNext).toBeCloseTo(Math.exp(k * 7.75), 8)
    expect(peakAndTrough(cycle).maximum.concentration).toBeCloseTo(peak, 6)
  })

  it('averages to D/(CL·τ) whatever the volume says', () => {
    const average = averageSteadyStateConcentration(BOLUS, interval)
    expect(average).toBeCloseTo(500 / (5 * 8), 12)
    const many = multipleDoseBolusProfile(BOLUS, { dosingInterval: interval, doses: 61, window: { tEnd: 480, dt: 0.02 } })
    // One settled interval, taken strictly after the dose so the trapezoid never
    // spans the sawtooth's jump: the exposure is what an infusion at D/τ gives.
    const cycle = many.filter((sample) => sample.time >= 472 && sample.time < 480)
    const span = cycle[cycle.length - 1].time - cycle[0].time
    const peak = 12.5 / (1 - Math.exp(-k * interval))
    // The trapezoid mean over the stretch it actually covers, against that
    // stretch's exact exponential-decay mean...
    expect(areaUnderCurve(cycle) / span).toBeCloseTo((peak * (1 - Math.exp(-k * span))) / (k * span), 4)
    // ...and the pharmacology identity: over a complete interval the exposure is
    // the same as an infusion at D/τ, because peak·(1 − e^−kτ)/k = dose/CL.
    expect((peak * (1 - Math.exp(-k * interval))) / (k * interval)).toBeCloseTo(average, 10)
  })
})

describe('parameter estimation', () => {
  it('recovers the constants from a clean one-compartment curve', () => {
    const samples = simulateOneCompartmentBolus(BOLUS, { tEnd: 20, dt: 0.5 })
    const fit = estimateElimination(samples, { knownDose: 500 })
    expect(fit.eliminationRate).toBeCloseTo(0.125, 8)
    expect(fit.halfLife).toBeCloseTo(Math.LN2 / 0.125, 6)
    expect(fit.initialConcentration).toBeCloseTo(12.5, 8)
    expect(fit.volume).toBeCloseTo(40, 8)
    expect(fit.coefficientOfDetermination).toBeCloseTo(1, 10)
  })

  it('flags a curve that is not a single exponential', () => {
    const model = { dose: 100, volumeCentral: 20, volumePeripheral: 40, clearance: 4, distributionClearance: 10 }
    const samples = simulateTwoCompartmentBolus(model, { tEnd: 40, dt: 0.5 })
    const fit = estimateElimination(samples.map((sample) => ({ time: sample.time, concentration: sample.concentration, amount: sample.amount })))
    // The guard rail: a biexponential forced through a log-straight line leaves
    // visible curvature behind, and r² is where the lie shows.
    expect(fit.coefficientOfDetermination).toBeLessThan(0.999)
    expect(fit.eliminationRate).toBeGreaterThan(twoCompartmentMacros(model).beta)
    expect(() => estimateElimination([])).toThrow(/at least two/)
    expect(() => estimateElimination([{ time: 1, concentration: 0, amount: 0 }])).toThrow(/at least two/)
  })
})

describe('capacity-limited elimination', () => {
  const saturable = { dose: 200, volume: 20, vmax: 50, km: 10 }

  it('follows the exact quadrature at every point of the curve', () => {
    const samples = saturableEliminationProfile(saturable, { tEnd: 20, dt: 0.05 })
    expect(samples[0].concentration).toBe(10)
    for (const sample of samples) {
      if (sample.amount <= 0) continue
      // Invert the separable ODE: the time implied by the amount must equal the
      // time the integrator reports.
      const implied = saturableElapsedTime(saturable, 10, sample.concentration)
      expect(sample.time - implied).toBeLessThan(0.02)
      expect(sample.time - implied).toBeGreaterThan(-0.02)
      expect(sample.amount).toBeGreaterThanOrEqual(0)
    }
  })

  it('clears more slowly per unit than a first-order model would', () => {
    const linearHalfLife = Math.LN2 * (20 * 10) / 50
    const measured = saturableElapsedTime(saturable, 10, 5)
    expect(linearHalfLife).toBeCloseTo(2.773, 3)
    expect(measured).toBeCloseTo((200 * Math.LN2 + 100) / 50, 9)
    expect(measured).toBeGreaterThan(linearHalfLife)
    // ...and the gap closes as the concentration falls below Km, which is the
    // whole point: the half-life is not a constant of this drug.
    expect(saturableElapsedTime(saturable, 0.01, 0.005)).toBeCloseTo(linearHalfLife, 2)
  })

  it('finds a plateau below capacity and none above it', () => {
    const parameters = { vmax: 50, km: 10, volume: 20 }
    const plateau = saturableInfusionSteadyState(parameters, 25)
    expect(plateau).toBeCloseTo(10, 12)
    expect(saturableInfusionSteadyState(parameters, 50)).toBeNull()
    expect(saturableInfusionSteadyState(parameters, 60)).toBeNull()

    const window = { tEnd: 300, dt: 0.2 }
    const settled = saturableInfusionProfile(parameters, 25, window)
    const at = (time: number) => settled[Math.round(time / window.dt)]
    expect(at(window.tEnd).concentration).toBeCloseTo(plateau!, 3)
    // Near the plateau the sink's slope is (Vmax − R)/(V·(Km + Css)), so the
    // approach is exponential with relaxation time V·(Km + Css)/(Vmax − R) = 16 h.
    const relaxation = (parameters.volume * (parameters.km + plateau!)) / (parameters.vmax - 25)
    expect(relaxation).toBeCloseTo(16, 12)
    const measured =
      Math.log((plateau! - at(150).concentration) / (plateau! - at(250).concentration)) / (at(250).time - at(150).time)
    expect(measured).toBeCloseTo(1 / relaxation, 3)

    const overflow = saturableInfusionProfile(parameters, 60, { tEnd: 60, dt: 0.2 })
    // No steady state exists: the amount climbs the whole way, and the rise per
    // hour falls towards the excess input rate (60 − 50)/20 = 0.5 mg/L/h without
    // ever reaching it.
    const tail = overflow.slice(-20)
    for (let index = 1; index < tail.length; index += 1) {
      expect(tail[index].amount).toBeGreaterThan(tail[index - 1].amount)
    }
    const rise = (tail[tail.length - 1].concentration - tail[0].concentration) / (tail[tail.length - 1].time - tail[0].time)
    expect(rise).toBeGreaterThan(0.5)
    expect(rise).toBeLessThan(1)
    const early = overflow.slice(0, 20)
    const earlyRise = (early[early.length - 1].concentration - early[0].concentration) / (early[early.length - 1].time - early[0].time)
    expect(earlyRise).toBeGreaterThan(rise)
  })

  it('drops clearance as the enzyme fills up', () => {
    const enzyme = { vmax: 50, km: 10 }
    expect(concentrationDependentClearance(enzyme, 0)).toBeCloseTo(5, 12)
    expect(concentrationDependentClearance(enzyme, 10)).toBeCloseTo(2.5, 12)
    expect(concentrationDependentClearance(enzyme, 90)).toBeCloseTo(0.5, 12)
    expect(concentrationDependentClearance(enzyme, 0)).toBeGreaterThan(concentrationDependentClearance(enzyme, 5))
    expect(() => concentrationDependentClearance(enzyme, -1)).toThrow(/non-negative/)
  })
})

describe('validation', () => {
  const cases: [() => unknown, RegExp][] = [
    [() => bolusRates({ dose: 0, volume: 40, clearance: 5 }), /Dose/],
    [() => bolusRates({ dose: 500, volume: -40, clearance: 5 }), /Volume of distribution/],
    [() => bolusRates({ dose: 500, volume: 40, clearance: Number.NaN }), /Clearance/],
    [() => oneCompartmentConcentration(BOLUS, -1), /Time/],
    [() => infusionConcentration({ rate: -1, volume: 40, clearance: 5 }, 1), /Infusion rate/],
    [() => absorptionConcentration({ ...BOLUS, absorptionRate: 1, bioavailability: 1.4 }, 1), /Bioavailability/],
    [() => absorptionConcentration({ ...BOLUS, absorptionRate: 1, bioavailability: 0.5, lagTime: -1 }, 1), /Lag time/],
    [() => twoCompartmentMacros({ dose: 100, volumeCentral: 0, volumePeripheral: 40, clearance: 4, distributionClearance: 10 }), /Central volume/],
    [() => twoCompartmentMacros({ dose: 100, volumeCentral: 20, volumePeripheral: 40, clearance: 4, distributionClearance: 0 }), /Distribution clearance/],
    [() => accumulationFactor(0.1, 0), /Dosing interval/],
    [() => multipleDoseBolusProfile(BOLUS, { dosingInterval: 8, doses: 2.5, window: { tEnd: 8, dt: 1 } }), /whole number/],
    [() => areaUnderCurve([{ time: 0, concentration: 1, amount: 1 }]), /at least two/],
    [() => peakAndTrough([]), /at least one/],
    [() => saturableElapsedTime({ vmax: 50, km: 10, volume: 20 }, 1, 2), /cannot end above/],
    [() => saturableEliminationProfile({ dose: 1, volume: 20, vmax: 50, km: 0 }, { tEnd: 10, dt: 1 }), /Km/],
    [() => simulateOneCompartmentBolus(BOLUS, { tEnd: 0, dt: 0.1 }), /Simulation end time/],
    [() => simulateTwoCompartmentBolus({ dose: 100, volumeCentral: 20, volumePeripheral: 40, clearance: 4, distributionClearance: 10 }, { tEnd: 1e9, dt: 1e-6 }), /output steps/],
  ]

  it('refuses the inputs it cannot turn into a curve', () => {
    for (const [run, message] of cases) expect(run).toThrow(message)
  })

  it('keeps hours, litres and milligrams in the same sentence', () => {
    // A 500 mg dose in 40 L is 12.5 mg/L, cleared at 5 L/h = 62.5 mg/h at t = 0;
    // if any unit drifted, this identity would not close.
    const rates = bolusRates(BOLUS)
    expect(rates.initialConcentration * BOLUS.volume).toBeCloseTo(BOLUS.dose, 12)
    // CL = k·V is the definition the whole module runs on; if a unit drifted, this
    // closes on a different number.
    expect(rates.eliminationRate * BOLUS.volume).toBeCloseTo(BOLUS.clearance, 12)
    expect(BOLUS.clearance * rates.initialConcentration).toBeCloseTo(62.5, 12)
  })
})
