import { describe, expect, it } from 'vitest'
import {
  ATP_HYDROLYSIS_GIBBS_JOULES_PER_MOL,
  MITOCHONDRION_PRESETS,
  NAD_REDOX_VOLTS,
  OXYGEN_REDOX_VOLTS,
  STATE3_MITOCHONDRION,
  STATE4_MITOCHONDRION,
  UNCHARGED_START,
  atpGibbsEnergyJoulesPerMol,
  effectiveDemandFlux,
  equilibriumForceMillivolts,
  fastestRelaxationTime,
  nernstSlopeMillivoltsPerPh,
  respiratoryControlRatio,
  simulateMitochondrion,
  synthesisThresholdMillivolts,
  withLoad,
  withPerturbation,
  type MitochondrionParameters,
  type MitochondrionResult,
} from './mitochondrion'
import type { BiologyWindow } from './modelSupport'

/**
 * The longest window the whole module needs.
 *
 * Two relaxations are slow here: the proton circuit charges and discharges through
 * the leak with `C/G_leak` = 150 s when nothing else is open, and the state-4 force
 * creeps toward its balance value with a 13 s time constant. At 100 s the resting
 * force has moved 0.17 % inside the last quarter, which is what `settled` reports on.
 * The reporting step is coarse (0.5 s) because the internal step is sized from the
 * Jacobian, not from this number — see the cadence test.
 */
const RUN: BiologyWindow = { tEnd: 100, dt: 0.5 }

const restingStart = { protonMotiveForceMillivolts: 150, adpMillimolar: 0.05 }
const loadedStart = { protonMotiveForceMillivolts: 150, adpMillimolar: 0.6 }

const endOf = (run: MitochondrionResult) => run.samples[run.samples.length - 1]!

const atPreset = (id: string) => {
  const preset = MITOCHONDRION_PRESETS.find((candidate) => candidate.id === id)
  if (!preset) throw new Error(`Preset ${id} is not registered.`)
  return preset
}

/** Every sample must sit inside the box the biology allows: no negative charges, pools or concentrations. */
function expectPhysicallyBounded(run: MitochondrionResult, parameters: MitochondrionParameters): void {
  const ceiling = equilibriumForceMillivolts(parameters)
  for (const sample of run.samples) {
    expect(sample.protonMotiveForceMillivolts).toBeLessThanOrEqual(ceiling + 1e-9)
    expect(sample.protonMotiveForceMillivolts).toBeGreaterThanOrEqual(0)
    expect(sample.adpMillimolar).toBeGreaterThanOrEqual(0)
    expect(sample.adpMillimolar).toBeLessThanOrEqual(parameters.adenylatePoolMillimolar + 1e-9)
    expect(sample.atpMillimolar + sample.adpMillimolar).toBeCloseTo(parameters.adenylatePoolMillimolar, 9)
    expect(sample.transportFlux).toBeGreaterThanOrEqual(0)
    expect(sample.transportFlux).toBeLessThanOrEqual(
      parameters.transportCapacityNanoMolPerSecondPerMilligram + 1e-9,
    )
    expect(sample.synthaseFlux).toBeGreaterThanOrEqual(0)
    expect(sample.leakFlux).toBeGreaterThanOrEqual(0)
  }
}

describe('the mitochondrion as a power supply', () => {
  it('refuses parameters that would make the loop meaningless', () => {
    expect(() =>
      simulateMitochondrion({ ...STATE4_MITOCHONDRION, adenylatePoolMillimolar: 0 }, restingStart, RUN),
    ).toThrow(/Adenylate pool/)
    expect(() =>
      simulateMitochondrion({ ...STATE4_MITOCHONDRION, membranePotentialFraction: 1.4 }, restingStart, RUN),
    ).toThrow(/Membrane-potential fraction/)
    expect(() =>
      simulateMitochondrion({ ...STATE4_MITOCHONDRION, oxygenKmMicromolar: -1 }, restingStart, RUN),
    ).toThrow(/Oxygen Michaelis constant/)
    expect(() =>
      simulateMitochondrion({ ...STATE4_MITOCHONDRION, synthaseAdpKmMillimolar: 0 }, restingStart, RUN),
    ).toThrow(/Synthase ADP Michaelis/)
    // Starting with more ADP than the pool holds is not a clamped initialisation,
    // it is a request to run with negative ATP.
    expect(() =>
      simulateMitochondrion(STATE4_MITOCHONDRION, { protonMotiveForceMillivolts: 150, adpMillimolar: 6 }, RUN),
    ).toThrow(/adenylate pool/i)
  })

  it('keeps every state inside the box the biology allows', () => {
    // The regression this file exists for: the fluxes used to be unbounded in their
    // substrates, and a long run then ate ADP below nothing or filled it past the
    // pool, which made the mass-action threshold meaningless.
    for (const preset of MITOCHONDRION_PRESETS) {
      expectPhysicallyBounded(
        simulateMitochondrion(preset.parameters, preset.initial, preset.window),
        preset.parameters,
      )
    }
    expectPhysicallyBounded(
      simulateMitochondrion(withLoad(STATE4_MITOCHONDRION, 0.45), loadedStart, RUN),
      withLoad(STATE4_MITOCHONDRION, 0.45),
    )
    expectPhysicallyBounded(
      simulateMitochondrion(STATE4_MITOCHONDRION, UNCHARGED_START, RUN),
      STATE4_MITOCHONDRION,
    )
  })

  it('puts the ceiling where the redox span and the stoichiometry put it', () => {
    const ceiling = equilibriumForceMillivolts(STATE4_MITOCHONDRION)
    expect(ceiling).toBeCloseTo(((OXYGEN_REDOX_VOLTS - NAD_REDOX_VOLTS) * 2 * 1000) / 10, 6)
    expect(ceiling).toBeCloseTo(228, 6)
    // Half the protons per electron pair halves the work each proton must carry, so
    // the ceiling rises: the number is derived from the stoichiometry, not typed.
    expect(equilibriumForceMillivolts({ ...STATE4_MITOCHONDRION, protonsPerElectronPair: 5 })).toBeCloseTo(
      ceiling * 2,
      6,
    )
    const run = simulateMitochondrion(STATE3_MITOCHONDRION, loadedStart, RUN)
    expect(run.metrics.forceRange.max).toBeLessThanOrEqual(ceiling + 1e-6)
  })

  it('rests below the ceiling with nothing asked of it, and pays only for the leak', () => {
    const run = simulateMitochondrion(STATE4_MITOCHONDRION, restingStart, RUN)
    const settled = endOf(run)
    expect(run.metrics.settled).toBe(true)
    expect(run.metrics.steadyForceMillivolts).toBeGreaterThan(200)
    expect(run.metrics.steadyForceMillivolts).toBeLessThan(run.metrics.equilibriumForceMillivolts)
    // No demand and ADP eaten down to nothing: the phosphorylation threshold sits
    // above what the chain can afford, so the synthase never turns.
    expect(settled.adpMillimolar).toBeLessThan(1e-4)
    expect(settled.atpProduction).toBeLessThan(1e-6)
    expect(settled.synthaseFlux).toBeLessThan(1e-6)
    // Steady state is a proton balance: everything pumped comes back through the
    // leak. The balance is not exact at 100 s — the state-4 force creeps toward it
    // with a 13 s time constant, so the residual here is 0.16 % of the leak.
    expect(settled.transportFlux).toBeGreaterThan(settled.leakFlux)
    expect(Math.abs(settled.transportFlux - settled.leakFlux) / settled.leakFlux).toBeLessThan(0.005)
    expect(settled.oxygenConsumption).toBeCloseTo(settled.leakFlux / 10 / 2, 3)
  })

  it('takes up more oxygen and holds less force once the pool has work to do', () => {
    const state4 = simulateMitochondrion(STATE4_MITOCHONDRION, loadedStart, RUN)
    const state3 = simulateMitochondrion(STATE3_MITOCHONDRION, loadedStart, RUN)
    expect(state3.metrics.settled).toBe(true)
    expect(state3.metrics.steadyOxygenConsumption).toBeGreaterThan(state4.metrics.steadyOxygenConsumption)
    expect(state3.metrics.steadyForceMillivolts).toBeLessThan(state4.metrics.steadyForceMillivolts)
    const control = respiratoryControlRatio(
      STATE4_MITOCHONDRION,
      STATE3_MITOCHONDRION,
      loadedStart,
      RUN,
    )
    // A ratio of two measured runs. Isolated mitochondria respire at two to five
    // times rest when the acceptor is there; anything else here would mean the
    // load is not actually reaching the synthase.
    expect(control.controlRatio).toBeGreaterThan(1.5)
    expect(control.controlRatio).toBeLessThan(6)
  })

  it('matches ATP output to the demand it was given, up to the ATP the pool has', () => {
    const parameters = withLoad(STATE4_MITOCHONDRION, 0.45)
    const run = simulateMitochondrion(parameters, loadedStart, RUN)
    const settled = endOf(run)
    // What the synthase makes is what the ATPase burns, and the ATPase is itself
    // substrate-limited: at 4.4 mM ATP against a 0.1 mM Michaelis it runs at 98 % of
    // nominal. Comparing against the nominal demand would be a rounding error away
    // from failing for the right reason.
    expect(settled.atpProduction).toBeCloseTo(effectiveDemandFlux(parameters, settled.adpMillimolar), 4)
    expect(settled.atpProduction).toBeLessThanOrEqual(0.45)
    expect(settled.atpProduction / 0.45).toBeGreaterThan(0.97)
  })

  it('uncouples: the force falls under the threshold, output stops and oxygen runs away', () => {
    const preset = atPreset('uncoupled')
    const run = simulateMitochondrion(preset.parameters, preset.initial, preset.window)
    const settled = endOf(run)
    // The threshold that matters is the one at the adenylate charge the organelle
    // started with; by the end of an uncoupled run the pool has burned out, which
    // lowers it, and the last of that ATP is what the residual output below is made of.
    expect(run.metrics.steadyForceMillivolts).toBeLessThan(
      synthesisThresholdMillivolts(preset.parameters, preset.initial.adpMillimolar),
    )
    const loaded = simulateMitochondrion(STATE3_MITOCHONDRION, loadedStart, RUN)
    expect(settled.atpProduction / endOf(loaded).atpProduction).toBeLessThan(0.01)
    expect(run.metrics.steadyOxygenConsumption).toBeGreaterThan(
      simulateMitochondrion(STATE4_MITOCHONDRION, restingStart, RUN).metrics.steadyOxygenConsumption * 2,
    )
    // Proton balance with the synthase all but out of the circuit: this is what
    // uncoupling means, and it is exact to numerical precision once the pool is spent.
    expect(settled.transportFlux).toBeCloseTo(settled.leakFlux + settled.synthaseFlux, 9)
    expect(settled.adpMillimolar).toBeCloseTo(preset.parameters.adenylatePoolMillimolar, 3)
  })

  it('discharges through the leak alone when the chain is inhibited with no work on it', () => {
    const inhibited = withPerturbation(STATE4_MITOCHONDRION, { transportMultiplier: 0 })
    const run = simulateMitochondrion(inhibited, restingStart, { tEnd: 100, dt: 0.5 })
    expect(endOf(run).transportFlux).toBe(0)
    expect(run.metrics.steadyOxygenConsumption).toBe(0)
    expect(run.metrics.steadyATPProduction).toBeLessThan(1e-6)
    // Nothing pumps and the synthase is shut, so the only path is the linear leak and
    // the decay is the closed form `PMF₀·e^(−G·t/C)`. The synthase does take a little
    // charge off in the first seconds, which is why this is a bound and not an identity.
    const tau =
      inhibited.protonCapacitanceMillivoltsPerNanoMolPerMilligram /
      inhibited.leakConductanceNanoMolPerSecondPerMilligramPerMillivolt
    expect(tau).toBeCloseTo(150, 6)
    let worst = 0
    for (const sample of run.samples) {
      const analytic = restingStart.protonMotiveForceMillivolts * Math.exp(-sample.timeSecond / tau)
      expect(sample.protonMotiveForceMillivolts).toBeLessThanOrEqual(analytic + 1e-9)
      worst = Math.max(worst, Math.abs(sample.protonMotiveForceMillivolts - analytic))
    }
    expect(worst).toBeLessThan(0.2)
    expect(endOf(run).protonMotiveForceMillivolts).toBeGreaterThan(70)
  })

  it('drains the adenylate pool to ADP when the chain is inhibited under a load', () => {
    const inhibited = withPerturbation(STATE3_MITOCHONDRION, { transportMultiplier: 0 })
    const run = simulateMitochondrion(inhibited, loadedStart, RUN)
    const settled = endOf(run)
    // The ATPase keeps burning what the chain can no longer replace, so the pool ends
    // as ADP and the reported force is only the tail of the discharge.
    expect(settled.adpMillimolar / inhibited.adenylatePoolMillimolar).toBeGreaterThan(0.99)
    expect(settled.oxygenConsumption).toBe(0)
    expect(run.metrics.forceRange.max).toBeLessThan(150 + 1e-9)
    expect(settled.protonMotiveForceMillivolts).toBeLessThan(run.metrics.forceRange.max)
  })

  it('loses force and ATP when oxygen runs short, and never settles while it starves', () => {
    const normoxic = simulateMitochondrion(STATE3_MITOCHONDRION, loadedStart, RUN)
    const hypoxic = simulateMitochondrion(
      withPerturbation(STATE3_MITOCHONDRION, { oxygenMicromolar: 3 }),
      loadedStart,
      RUN,
    )
    expect(hypoxic.metrics.steadyForceMillivolts).toBeLessThan(normoxic.metrics.steadyForceMillivolts)
    expect(hypoxic.metrics.steadyATPProduction).toBeLessThan(endOf(normoxic).atpProduction)
    const hypoxicEnd = endOf(hypoxic)
    // ATP depletion under a fixed load is not a steady state, and the run says so.
    expect(hypoxic.metrics.settled).toBe(false)
    expect(hypoxicEnd.adpMillimolar).toBeGreaterThan(endOf(normoxic).adpMillimolar * 10)
    // The oxygen term saturates below its own Michaelis, so uptake cannot exceed the
    // substrate-limited capacity even as the force collapses.
    const limited =
      STATE3_MITOCHONDRION.transportCapacityNanoMolPerSecondPerMilligram * (3 / (3 + STATE3_MITOCHONDRION.oxygenKmMicromolar))
    expect(hypoxicEnd.transportFlux).toBeLessThanOrEqual(limited + 1e-9)
  })

  it('makes ATP cheaper the more ADP there is to phosphorylate', () => {
    const parameters = STATE3_MITOCHONDRION
    const lowAdp = atpGibbsEnergyJoulesPerMol(parameters, 0.02)
    const highAdp = atpGibbsEnergyJoulesPerMol(parameters, 2)
    expect(highAdp).toBeLessThan(lowAdp)
    expect(synthesisThresholdMillivolts(parameters, 2)).toBeLessThan(synthesisThresholdMillivolts(parameters, 0.02))
    // Phosphate is a substrate: more of it lowers the cost too.
    expect(
      atpGibbsEnergyJoulesPerMol({ ...parameters, phosphateMillimolar: 1 }, 0.5),
    ).toBeGreaterThan(atpGibbsEnergyJoulesPerMol({ ...parameters, phosphateMillimolar: 10 }, 0.5))
    // The mass-action term is the only reason the cost is not the standard value.
    expect(lowAdp).toBeGreaterThan(-ATP_HYDROLYSIS_GIBBS_JOULES_PER_MOL)
  })

  it('splits the reported force into potential and gradient at the Nernst slope', () => {
    const parameters = { ...STATE4_MITOCHONDRION, membranePotentialFraction: 0.8 }
    const run = simulateMitochondrion(parameters, restingStart, RUN)
    const settled = endOf(run)
    expect(settled.membranePotentialMillivolts).toBeCloseTo(0.8 * settled.protonMotiveForceMillivolts, 9)
    const gradientMv = settled.protonMotiveForceMillivolts - settled.membranePotentialMillivolts
    expect(settled.phGradient).toBeCloseTo(gradientMv / nernstSlopeMillivoltsPerPh(parameters.temperatureKelvin), 9)
    // 37 °C is the textbook 61.5 mV per pH unit, derived from R, F and T.
    expect(nernstSlopeMillivoltsPerPh(310.15)).toBeGreaterThan(61)
    expect(nernstSlopeMillivoltsPerPh(310.15)).toBeLessThan(62)
    // A colder bath holds the same force with more gradient and less potential.
    expect(nernstSlopeMillivoltsPerPh(293.15)).toBeLessThan(nernstSlopeMillivoltsPerPh(310.15))
  })

  it('charges from nothing when the membrane starts uncharged', () => {
    const run = simulateMitochondrion(STATE4_MITOCHONDRION, UNCHARGED_START, RUN)
    expect(run.samples[0]!.protonMotiveForceMillivolts).toBe(0)
    expect(run.samples[0]!.transportFlux).toBeGreaterThan(0)
    expect(run.metrics.forceRange.min).toBe(0)
    expect(run.metrics.steadyForceMillivolts).toBeGreaterThan(200)
    // An uncharged membrane pumps at full capacity, so the first sample is the
    // fastest oxygen consumption in the whole run.
    expect(run.samples[0]!.oxygenConsumption).toBeGreaterThan(run.metrics.steadyOxygenConsumption)
  })

  it('says so when the run is too short to have settled', () => {
    const short = simulateMitochondrion(STATE4_MITOCHONDRION, UNCHARGED_START, { tEnd: 0.2, dt: 0.005 })
    expect(short.metrics.settled).toBe(false)
    expect(short.metrics.steadyForceMillivolts).toBeLessThan(short.metrics.equilibriumForceMillivolts)
  })

  it('reports a steady state that does not depend on how often it was sampled', () => {
    const coarse = simulateMitochondrion(STATE3_MITOCHONDRION, loadedStart, { tEnd: 100, dt: 1 })
    const fine = simulateMitochondrion(STATE3_MITOCHONDRION, loadedStart, { tEnd: 100, dt: 0.01 })
    // Both runs are integrated to the same internal step because the step is sized
    // from the Jacobian rather than from the caller's cadence, so the end states are
    // the same number; only the averaging window differs.
    expect(endOf(coarse).protonMotiveForceMillivolts).toBeCloseTo(endOf(fine).protonMotiveForceMillivolts, 9)
    expect(Math.abs(coarse.metrics.steadyForceMillivolts - fine.metrics.steadyForceMillivolts)).toBeLessThan(
      0.001 * fine.metrics.steadyForceMillivolts,
    )
  })

  it('sizes the step from the substrate feedback, not from the leak and synthase conductances', () => {
    // `C / (G_leak + L_atp)` is 7.59 s. The dominant eigenvalue of the loop is fifty
    // times faster, because the phosphorylation threshold moves 6.4 mV per e-fold of
    // ADP. Sizing from the conductances alone gives a 0.5 s reporting cadence an
    // internal step of 0.25 s — and a steady state whose ADP is 30 % off.
    const electricalTau =
      STATE3_MITOCHONDRION.protonCapacitanceMillivoltsPerNanoMolPerMilligram /
      (STATE3_MITOCHONDRION.leakConductanceNanoMolPerSecondPerMilligramPerMillivolt +
        STATE3_MITOCHONDRION.synthaseConductanceNanoMolPerSecondPerMilligramPerMillivolt)
    const fastest = fastestRelaxationTime(STATE3_MITOCHONDRION)
    expect(fastest).toBeLessThan(electricalTau / 10)
    expect(fastest).toBeGreaterThan(0)
    expect(Number.isFinite(fastest)).toBe(true)
    // Demand only enters the ADP equation, and the fast mode is the synthase's own
    // substrate feedback, so loading the organelle barely moves the number.
    const resting = fastestRelaxationTime(STATE4_MITOCHONDRION)
    expect(Math.abs(resting - fastest) / fastest).toBeLessThan(1e-4)
    // An uncoupler multiplies the leak, and the leak is not what limits the step.
    expect(
      Math.abs(fastestRelaxationTime(withPerturbation(STATE3_MITOCHONDRION, { leakMultiplier: 40 })) - fastest) / fastest,
    ).toBeLessThan(0.01)
  })

  it('refuses a control ratio built from a resting state that consumed nothing', () => {
    const dead: MitochondrionParameters = withPerturbation(STATE4_MITOCHONDRION, { oxygenMicromolar: 0 })
    expect(() => respiratoryControlRatio(dead, STATE3_MITOCHONDRION, restingStart, RUN)).toThrow(/resting state/)
  })

  it('keeps every registered preset simulatable and distinguishable', () => {
    const results = MITOCHONDRION_PRESETS.map((preset) =>
      simulateMitochondrion(preset.parameters, preset.initial, preset.window),
    )
    expect(results).toHaveLength(MITOCHONDRION_PRESETS.length)
    for (const run of results) {
      expect(run.samples.length).toBeGreaterThan(1)
      expect(Number.isFinite(run.metrics.steadyForceMillivolts)).toBe(true)
    }
    const byId = new Map(MITOCHONDRION_PRESETS.map((preset, index) => [preset.id, results[index]!]))
    // The four presets must be four different states of the organelle, not four
    // names for the same run.
    expect(byId.get('state3-active')!.metrics.steadyOxygenConsumption).toBeGreaterThan(
      byId.get('state4-resting')!.metrics.steadyOxygenConsumption,
    )
    expect(byId.get('uncoupled')!.metrics.steadyATPProduction).toBeLessThan(
      byId.get('state3-active')!.metrics.steadyATPProduction,
    )
    expect(byId.get('hypoxic')!.metrics.steadyForceMillivolts).toBeLessThan(
      byId.get('state3-active')!.metrics.steadyForceMillivolts,
    )
  })

  it('reports the numbers its preset notes quote', () => {
    // The notes are UI copy, so every figure in one of them is asserted against the
    // run it describes. Two of the claims are the ones that surprised whoever wrote
    // them: an uncoupled organelle does not merely stop making ATP, it spends the
    // whole adenylate pool doing it, and a hypoxic one does not settle in 100 s.
    const preset = (id: string) => atPreset(id)
    const run = (id: string) => {
      const p = preset(id)
      return simulateMitochondrion(p.parameters, p.initial, p.window)
    }
    const resting = run('state4-resting')
    expect(resting.metrics.settled).toBe(true)
    expect(resting.metrics.steadyForceMillivolts).toBeGreaterThan(207.5)
    expect(resting.metrics.steadyForceMillivolts).toBeLessThan(208.3)
    // The resting pool spends itself into a corner. As ADP goes to nothing, making
    // ATP costs more, and the threshold the organelle ends up facing is a few
    // hundredths of a millivolt above the force it can hold. That gap is the whole of
    // state 4: nothing is made because nothing quite can be.
    const restingGap = resting.metrics.atpThresholdMillivolts - resting.metrics.steadyForceMillivolts
    expect(restingGap).toBeGreaterThan(0)
    expect(restingGap).toBeLessThan(0.1)
    expect(resting.metrics.steadyATPProduction).toBeLessThan(1e-6)
    expect(resting.metrics.steadyOxygenConsumption).toBeGreaterThan(0.041)
    expect(resting.metrics.steadyOxygenConsumption).toBeLessThan(0.043)

    const loaded = run('state3-active')
    expect(loaded.metrics.steadyOxygenConsumption).toBeGreaterThan(0.094)
    expect(loaded.metrics.steadyOxygenConsumption).toBeLessThan(0.097)
    expect(loaded.metrics.steadyForceMillivolts).toBeGreaterThan(181.5)
    expect(loaded.metrics.steadyForceMillivolts).toBeLessThan(182.7)
    expect(
      loaded.metrics.steadyOxygenConsumption / resting.metrics.steadyOxygenConsumption,
    ).toBeGreaterThan(2.2)
    expect(
      loaded.metrics.steadyOxygenConsumption / resting.metrics.steadyOxygenConsumption,
    ).toBeLessThan(2.4)

    const uncoupled = run('uncoupled')
    expect(uncoupled.metrics.settled).toBe(true)
    expect(uncoupled.metrics.steadyForceMillivolts).toBeGreaterThan(46.5)
    expect(uncoupled.metrics.steadyForceMillivolts).toBeLessThan(47.5)
    expect(
      uncoupled.metrics.steadyOxygenConsumption / loaded.metrics.steadyOxygenConsumption,
    ).toBeGreaterThan(3.5)
    expect(
      uncoupled.metrics.steadyOxygenConsumption / loaded.metrics.steadyOxygenConsumption,
    ).toBeLessThan(4.2)
    expect(
      uncoupled.metrics.steadyATPProduction / loaded.metrics.steadyATPProduction,
    ).toBeLessThan(0.005)
    // The pool is the note's other claim: five millimolar of adenylates, all ADP.
    expect(endOf(uncoupled).adpMillimolar).toBeCloseTo(uncoupled.parameters.adenylatePoolMillimolar, 3)
    expect(endOf(uncoupled).atpMillimolar).toBeLessThan(0.001)

    const hypoxicPreset = preset('hypoxic')
    const hypoxic = run('hypoxic')
    expect(hypoxic.metrics.settled).toBe(true)
    expect(hypoxic.metrics.steadyForceMillivolts).toBeGreaterThan(101.5)
    expect(hypoxic.metrics.steadyForceMillivolts).toBeLessThan(102.6)
    expect(
      hypoxic.metrics.steadyOxygenConsumption / loaded.metrics.steadyOxygenConsumption,
    ).toBeGreaterThan(0.6)
    expect(
      hypoxic.metrics.steadyOxygenConsumption / loaded.metrics.steadyOxygenConsumption,
    ).toBeLessThan(0.7)
    // Output only falls a quarter; the pool is what pays for a fixed demand.
    expect(
      hypoxic.metrics.steadyATPProduction / loaded.metrics.steadyATPProduction,
    ).toBeGreaterThan(0.7)
    expect(
      hypoxic.metrics.steadyATPProduction / loaded.metrics.steadyATPProduction,
    ).toBeLessThan(0.78)
    expect(endOf(hypoxic).atpMillimolar).toBeGreaterThan(0.2)
    expect(endOf(hypoxic).atpMillimolar).toBeLessThan(0.35)
    // Why this preset carries its own longer window: at the others' 100 s the pool is
    // still moving, and `settled` says so instead of averaging a transient.
    expect(
      simulateMitochondrion(hypoxicPreset.parameters, hypoxicPreset.initial, { tEnd: 100, dt: 0.5 }).metrics.settled,
    ).toBe(false)
    // And 400 s is not on the menu: the step ceiling refuses it out loud.
    expect(() =>
      simulateMitochondrion(hypoxicPreset.parameters, hypoxicPreset.initial, { tEnd: 400, dt: 0.5 }),
    ).toThrow(/stable step/)
  })
})
