import { describe, expect, it } from 'vitest'
import { AgentHarness } from './agentHarness'
import { COUPLED_SCENARIOS, coupledTools, registerCoupledTools } from './coupledTools'

const budget = () => ({ maxCalls: 10, maxWallMs: 180_000, startedAt: Date.now() })
const allow = () => true

interface ConductorStudy {
  scenario: string
  optimum: {
    widthMm: number
    thicknessMm: number
    massKg: number
    operatingC: number
    temperatureRiseK: number
  }
  limits: {
    thermalUtilisation: number
    stiffnessUtilisation: number
    binding: { name: string; utilisation: number } | null
  }
  feasible: boolean
  massOnlySection: {
    widthMm: number
    thicknessMm: number
    massKg: number
    temperatureRiseK: number
    withinThermalLimit: boolean
  }
  massPenaltyKg: number
  conclusions: string[]
}

interface HeatsinkStudy {
  scenario: string
  optimum: {
    finCount: number
    massKg: number
    cost: number
    temperatureRiseK: number
    finEfficiency: number
    effectiveAreaM2: number
  }
  limits: {
    thermalUtilisation: number
    massUtilisation: number
    binding: { name: string; utilisation: number } | null
  }
  feasible: boolean
  massOnlySection: {
    finCount: number
    massKg: number
    temperatureRiseK: number
    withinThermalLimit: boolean
  }
  conclusions: string[]
}

interface BeamStudy {
  scenario: string
  optimum: {
    widthMm: number
    depthMm: number
    massKg: number
    totalStressMPa: number
    thermalStressMPa: number
    deflectionMm: number
  }
  feasible: boolean
  coldSection: { widthMm: number; massKg: number; totalStressMPa: number }
}

const run = async (
  args: Record<string, string | number | boolean>,
): Promise<ConductorStudy | HeatsinkStudy | BeamStudy> => {
  const harness = new AgentHarness()
  registerCoupledTools(harness)
  const call = await harness.call('coupled.study', args, budget(), allow)
  if (call.error) throw new Error(call.error)
  return call.result as ConductorStudy | HeatsinkStudy
}

const conductorArgs = (overrides: Record<string, string | number | boolean> = {}) => ({
  scenario: 'conductor',
  currentA: 30,
  lengthM: 0.1,
  minSecondMomentM4: 2e-11,
  maxRiseK: 8,
  ...overrides,
})

const heatsinkArgs = (overrides: Record<string, string | number | boolean> = {}) => ({
  scenario: 'heatsink',
  powerW: 5,
  maxRiseK: 40,
  baseLengthM: 0.04,
  baseWidthM: 0.04,
  maxMassKg: 0.2,
  ...overrides,
})

describe('coupled.study', () => {
  it('registers exactly one tool covering every scenario', () => {
    expect(coupledTools().map((tool) => tool.name)).toEqual(['coupled.study'])
    expect(COUPLED_SCENARIOS).toEqual(['conductor', 'heatsink', 'beam'])
    const harness = new AgentHarness()
    registerCoupledTools(harness)
    expect(harness.listTools()).toContain('coupled.study')
  })

  it('refuses an unknown scenario and names the ones that exist', async () => {
    const harness = new AgentHarness()
    registerCoupledTools(harness)
    const call = await harness.call('coupled.study', { scenario: 'levitate' }, budget(), allow)
    expect(call.error).toMatch(/unknown scenario "levitate"/)
    expect(call.error).toMatch(/conductor, heatsink, beam/)
  })

  describe('beam', () => {
    const beamArgs = (overrides: Record<string, string | number | boolean> = {}) => ({
      scenario: 'beam',
      loadN: 500,
      spanM: 1,
      deltaT: 30,
      maxDeflectionM: 0.005,
      ...overrides,
    })

    it('finds a feasible section and reports the thermal share of the stress', async () => {
      const result = (await run(beamArgs())) as BeamStudy
      expect(result.scenario).toBe('beam')
      expect(result.feasible).toBe(true)
      expect(result.optimum.totalStressMPa).toBeGreaterThan(0)
      /* The thermal stress is independent of the section, so a non-zero ΔT must
       * produce a non-zero share. If this were ever 0, the coupling would be
       * doing nothing. */
      expect(result.optimum.thermalStressMPa).toBeGreaterThan(0)
      expect(result.optimum.totalStressMPa).toBeGreaterThanOrEqual(result.optimum.thermalStressMPa)
    })

    it('a hotter beam is heavier or equal to the same beam sized cold', async () => {
      const cold = (await run(beamArgs({ deltaT: 0 }))) as BeamStudy
      const hot = (await run(beamArgs({ deltaT: 60 }))) as BeamStudy
      expect(hot.optimum.massKg).toBeGreaterThanOrEqual(cold.optimum.massKg - 1e-9)
    })

    it('names the required beam arguments', async () => {
      const harness = new AgentHarness()
      registerCoupledTools(harness)
      const call = await harness.call(
        'coupled.study',
        { scenario: 'beam', loadN: 500 },
        budget(),
        allow,
      )
      expect(call.error).toMatch(/spanM is required/)
    })
  })

  describe('conductor', () => {
    it('finds a feasible section and reports the binding constraint', async () => {
      const result = (await run(conductorArgs())) as ConductorStudy
      expect(result.scenario).toBe('conductor')
      expect(result.feasible).toBe(true)
      expect(result.optimum.temperatureRiseK).toBeLessThanOrEqual(8)
      expect(result.limits.thermalUtilisation).toBeLessThanOrEqual(1)
      expect(result.limits.stiffnessUtilisation).toBeLessThanOrEqual(1)
      expect(result.limits.binding?.name).toBeTruthy()
    })

    it('shows what single-discipline sizing would have chosen', async () => {
      const result = (await run(conductorArgs())) as ConductorStudy
      expect(result.massOnlySection.massKg).toBeLessThanOrEqual(result.optimum.massKg)
      expect(result.massOnlySection.temperatureRiseK).toBeGreaterThan(0)
      expect(result.conclusions.length).toBeGreaterThan(0)
      expect(result.massPenaltyKg).toBeGreaterThanOrEqual(0)
    })

    it('names the required conductor arguments', async () => {
      const harness = new AgentHarness()
      registerCoupledTools(harness)
      const call = await harness.call(
        'coupled.study',
        { scenario: 'conductor', currentA: 30 },
        budget(),
        allow,
      )
      expect(call.error).toMatch(/lengthM is required/)
    })

    it('refuses a physically impossible value instead of searching for one', async () => {
      const harness = new AgentHarness()
      registerCoupledTools(harness)
      const call = await harness.call(
        'coupled.study',
        { scenario: 'conductor', currentA: -1, lengthM: 0.1 },
        budget(),
        allow,
      )
      expect(call.error).toMatch(/Current/)
    })
  })

  describe('heatsink', () => {
    it('finds a feasible heatsink and reports fin efficiency', async () => {
      const result = (await run(heatsinkArgs())) as HeatsinkStudy
      expect(result.scenario).toBe('heatsink')
      expect(result.feasible).toBe(true)
      expect(result.optimum.temperatureRiseK).toBeLessThanOrEqual(40)
      expect(result.limits.thermalUtilisation).toBeLessThanOrEqual(1)
      expect(result.limits.massUtilisation).toBeLessThanOrEqual(1)
      /* The whole reason this is a coupled study: a real fin is not isothermal,
       * so an efficiency of exactly 1 would mean the coupling does nothing. */
      expect(result.optimum.finEfficiency).toBeLessThan(1)
      expect(result.optimum.finEfficiency).toBeGreaterThan(0)
      expect(result.optimum.finCount).toBeGreaterThanOrEqual(2)
    })

    it('shows what sizing on mass alone would have chosen', async () => {
      const result = (await run(heatsinkArgs())) as HeatsinkStudy
      expect(result.massOnlySection.massKg).toBeLessThanOrEqual(result.optimum.massKg)
      expect(result.massOnlySection.temperatureRiseK).toBeGreaterThan(0)
      expect(result.conclusions.some((line) => /efficient at the optimum/.test(line))).toBe(true)
    })

    it('names the required heatsink arguments', async () => {
      const harness = new AgentHarness()
      registerCoupledTools(harness)
      const call = await harness.call(
        'coupled.study',
        { scenario: 'heatsink', powerW: 5 },
        budget(),
        allow,
      )
      expect(call.error).toMatch(/maxRiseK is required/)
    })

    it('refuses a non-finite heatsink argument', async () => {
      const harness = new AgentHarness()
      registerCoupledTools(harness)
      const call = await harness.call(
        'coupled.study',
        { scenario: 'heatsink', powerW: Number.NaN, maxRiseK: 40, baseLengthM: 0.04, baseWidthM: 0.04 },
        budget(),
        allow,
      )
      expect(call.error).toMatch(/Power/)
    })
  })

  it('rejects a scenario parameter the harness can see is the wrong type', async () => {
    const harness = new AgentHarness()
    registerCoupledTools(harness)
    await expect(
      harness.call('coupled.study', { scenario: 42 }, budget(), allow),
    ).rejects.toThrow(/must be string/)
  })
})