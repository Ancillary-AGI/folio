import { describe, expect, it } from 'vitest'
import { sizeCoupledConductor, COPPER } from './coupledConductor'
import { ALUMINIUM_6063, sizeCoupledHeatsink } from './coupledHeatsink'
import { S275_STEEL, sizeCoupledBeam } from './coupledBeam'

/**
 * One invariant across every coupled scenario: `feasible` must be exactly the
 * conjunction of the utilisations reported beside it.
 *
 * This exists because a penalty search converges *onto* the constraint boundary,
 * so the final point can sit a few parts per million outside a limit — and a
 * scenario that inherited the optimiser's internal flag could then report
 * `feasible: true` next to a utilisation above 1, or the reverse. That is the
 * worst failure mode for a sizing tool: the numbers and the verdict disagree.
 *
 * Each entry returns its own pair, so the array stays homogeneous and the
 * assertions are typed against one shape.
 */
interface ScenarioOutcome {
  feasible: boolean
  utilisations: number[]
}

const scenarios: ReadonlyArray<{ name: string; run: () => Promise<ScenarioOutcome> }> = [
  {
    name: 'conductor',
    run: async () => {
      const result = await sizeCoupledConductor({
        lengthM: 0.1,
        currentA: 30,
        ambientC: 25,
        maxTemperatureRiseK: 8,
        surfaceCoefficientWm2K: 10,
        minSecondMomentM4: 2e-11,
        material: COPPER,
        width: { min: 0.002, max: 0.02 },
        thickness: { min: 0.0005, max: 0.005 },
        populationSize: 20,
        iterations: 40,
        seed: 1234,
      })
      return {
        feasible: result.feasible,
        utilisations: [result.thermalUtilisation, result.stiffnessUtilisation],
      }
    },
  },
  {
    name: 'heatsink',
    run: async () => {
      const result = await sizeCoupledHeatsink({
        powerW: 5,
        maxTemperatureRiseK: 40,
        surfaceCoefficientWm2K: 10,
        baseLengthM: 0.04,
        baseWidthM: 0.04,
        baseThickness: { min: 0.002, max: 0.006 },
        finHeight: { min: 0.005, max: 0.03 },
        finThickness: { min: 0.0008, max: 0.003 },
        finCount: { min: 2, max: 20 },
        maxMassKg: 0.2,
        material: ALUMINIUM_6063,
        populationSize: 20,
        iterations: 40,
      })
      return {
        feasible: result.feasible,
        utilisations: [result.thermalUtilisation, result.massUtilisation],
      }
    },
  },
  {
    name: 'beam',
    run: async () => {
      const result = await sizeCoupledBeam({
        loadN: 500,
        spanM: 1,
        temperatureChangeK: 30,
        maxDeflectionM: 0.005,
        width: { min: 0.01, max: 0.1 },
        depth: { min: 0.01, max: 0.15 },
        material: S275_STEEL,
        populationSize: 20,
        iterations: 40,
      })
      return {
        feasible: result.feasible,
        utilisations: [result.stressUtilisation, result.deflectionUtilisation],
      }
    },
  },
]

describe('coupled scenarios agree with their own numbers', () => {
  for (const scenario of scenarios) {
    it(`${scenario.name}: feasible is exactly "every utilisation is within 1"`, async () => {
      const { feasible, utilisations } = await scenario.run()
      const allWithin = utilisations.every((value) => value <= 1)

      expect(feasible).toBe(allWithin)
      // No NaN may slip through as "within".
      for (const value of utilisations) expect(Number.isNaN(value)).toBe(false)
    })

    it(`${scenario.name}: a feasible result is genuinely feasible`, async () => {
      const { feasible, utilisations } = await scenario.run()
      if (!feasible) return
      for (const value of utilisations) expect(value).toBeLessThanOrEqual(1)
    })
  }
})