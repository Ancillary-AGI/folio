/**
 * Noise-analysis scope tests.
 *
 * The rule these cases enforce: a number reported as noise must be the sum of
 * the mechanisms the solver actually stamps — resistor thermal and diode shot —
 * and every other noisy device in the netlist must be named as unmodelled.
 * A partial sum presented as a total is a failure even when the arithmetic is
 * right, so nothing here may be labelled "total".
 */
import { describe, expect, it } from 'vitest'
import { buildCircuitModel, type CircuitModel } from './circuitModel'
import { runNoiseAnalysis, type NoiseResult } from './noise'
import type { CircuitNetlist, Component } from './spiceEngine'

const part = (
  type: string,
  name: string,
  nodes: string[],
  parameters: Record<string, string | number>,
): Component => ({ type, name, nodes, parameters })

const resistor = (name: string, nodes: [string, string], value: string): Component =>
  part('resistor', name, nodes, { value })
const capacitor = (name: string, nodes: [string, string], value: string): Component =>
  part('capacitor', name, nodes, { value })
const voltageSource = (name: string, nodes: [string, string], value: string): Component =>
  part('voltage_source', name, nodes, { value })
const diode = (name: string, nodes: [string, string]): Component =>
  part('diode', name, nodes, { saturationCurrent: '1e-14', emissionCoefficient: 1 })
const npn = (name: string, nodes: [string, string, string]): Component =>
  part('npn_transistor', name, nodes, { is: '1e-14', bf: 100 })
const nmos = (name: string, nodes: [string, string, string]): Component =>
  part('n_channel_mosfet', name, nodes, { vto: 1, kp: '1e-4' })

const build = (components: Component[]): CircuitModel => {
  const netlist: CircuitNetlist = { title: 'noise-scope', components, analyses: [{ type: 'noise' }] }
  const built = buildCircuitModel(netlist)
  expect(built.errors).toEqual([])
  return built.model
}

const noise = (model: CircuitModel): NoiseResult =>
  runNoiseAnalysis(model, {
    temperatureCelsius: 27,
    startFrequency: 100,
    stopFrequency: 100e3,
    pointsPerDecade: 5,
    outputNode: 'OUT',
  })

/** √(Σ of each contribution's integrated power), the power-sum of the breakdown. */
const powerSum = (result: NoiseResult): number =>
  Math.sqrt(result.contributions.reduce((sum, entry) => sum + entry.integratedPower, 0))

describe('noise analysis scope', () => {
  it('keeps its figure honest when the circuit is fully modelled', () => {
    const result = noise(build([
      voltageSource('V1', ['IN', '0'], '5'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1u'),
    ]))
    expect(result.converged).toBe(true)
    // An ideal capacitor, an ideal source and a plain resistor have no other
    // noise mechanism, so there is nothing to exclude.
    expect(result.excludedSources).toEqual([])
    expect(result.contributions).toHaveLength(1)
    expect(result.contributions[0].device).toBe('R1')
    expect(result.contributions[0].kind).toBe('thermal')
    expect(result.integratedThermalAndDiodeNoise).toBeGreaterThan(0)
    expect(powerSum(result)).toBeCloseTo(result.integratedThermalAndDiodeNoise, 12)
    expect(result.notes.join(' ')).not.toMatch(/not the total/)
  })

  it('names every waveform by the mechanisms it actually sums', () => {
    const result = noise(build([
      voltageSource('V1', ['IN', '0'], '5'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1u'),
    ]))
    for (const waveform of result.waveforms) {
      expect(waveform.name.toLowerCase()).not.toContain('total')
    }
    expect(result.waveforms.map((w) => w.name)).toContain('thermal+diode noise at OUT')
  })

  it('reports a BJT in the netlist as unmodelled instead of omitting it', () => {
    const result = noise(build([
      voltageSource('VCC', ['VCC', '0'], '5'),
      resistor('RB', ['VCC', 'B'], '220k'),
      resistor('RC', ['VCC', 'OUT'], '1k'),
      npn('Q1', ['OUT', 'B', '0']),
    ]))
    expect(result.converged).toBe(true)
    expect(result.excludedSources).toHaveLength(1)
    const [excluded] = result.excludedSources
    expect(excluded?.device).toBe('Q1')
    expect(excluded?.kind).toBe('bjt')
    expect(excluded?.reason).toMatch(/noise/)
    // No BJT bucket may appear in the sum it cannot be part of.
    expect(result.contributions.map((entry) => entry.device)).toEqual(['RB', 'RC'])
    expect(result.waveforms.map((w) => w.name)).not.toContain('Q1 bjt noise')
    const notes = result.notes.join(' ')
    expect(notes).toMatch(/not the total output noise/)
    expect(notes).toMatch(/Q1 \(bjt\)/)
  })

  it('reports a MOSFET as unmodelled with its missing parameters named', () => {
    const result = noise(build([
      voltageSource('VDD', ['VDD', '0'], '5'),
      resistor('RD', ['VDD', 'OUT'], '1k'),
      nmos('M1', ['OUT', 'VDD', '0']),
    ]))
    expect(result.converged).toBe(true)
    const mosfet = result.excludedSources.find((entry) => entry.device === 'M1')
    expect(mosfet?.kind).toBe('mosfet')
    expect(mosfet?.reason).toMatch(/γ|excess-noise/)
    expect(mosfet?.reason).toMatch(/KF\/AF|flicker/)
  })

  it('carries diode shot noise as its own contribution', () => {
    const result = noise(build([
      voltageSource('V1', ['ANODE', '0'], '0.7'),
      diode('D1', ['ANODE', 'OUT']),
      resistor('R1', ['OUT', '0'], '100'),
    ]))
    expect(result.converged).toBe(true)
    expect(result.excludedSources).toEqual([])
    const shot = result.contributions.find((entry) => entry.device === 'D1')
    expect(shot?.kind).toBe('shot')
    expect(shot && shot.rmsVolts > 0).toBe(true)
    expect(result.contributions.filter((entry) => entry.kind === 'thermal')).toHaveLength(1)
    expect(powerSum(result)).toBeCloseTo(result.integratedThermalAndDiodeNoise, 12)
  })

  it('treats ideal and lossless devices as noiseless, not as exclusions', () => {
    /*
     * The models here stamp an ideal capacitor, an ideal inductor and an ideal
     * source, so they genuinely have no noise to add. Listing them as
     * "unmodelled" would overstate the gap the reader has to worry about.
     */
    const result = noise(build([
      voltageSource('V1', ['IN', '0'], '5'),
      resistor('R1', ['IN', 'OUT'], '1k'),
      capacitor('C1', ['OUT', '0'], '1u'),
      part('inductor', 'L1', ['OUT', '0'], { value: '1m' }),
    ]))
    expect(result.converged).toBe(true)
    expect(result.excludedSources).toEqual([])
    expect(result.contributions.map((entry) => entry.device)).toEqual(['R1'])
  })
})
