import { describe, expect, it } from 'vitest'
import { buildDemoBoard } from '../demo/demoBoard'
import { createMemoryCadRuntime } from './cadRuntime'
import { createCadToolset, type CadObservation } from './cadTools'
import { Blackboard } from './blackboard'
import { parseEngineeringValue, system1Respond } from './system1'

const observe = async (): Promise<{ observation: CadObservation; board: Blackboard }> => {
  const board = buildDemoBoard()
  const runtime = createMemoryCadRuntime({ components: board.components, wires: board.wires })
  const observation = (await createCadToolset(runtime).invoke('cad.observe')) as CadObservation
  return { observation, board: new Blackboard() }
}

const ask = async (text: string) => {
  const { observation, board } = await observe()
  return { verdict: system1Respond(text, { observation, board, fingerprint: observation.fingerprint }), observation, board }
}

/** A sheet the designer is drafting: empty, then two parts with typed designators. */
const askBare = async (text: string) => {
  const runtime = createMemoryCadRuntime()
  const tools = createCadToolset(runtime)
  await tools.invoke('cad.addPart', { symbol: 'resistor' })
  await tools.invoke('cad.addPart', { symbol: 'capacitor' })
  const observation = (await tools.invoke('cad.observe')) as CadObservation
  const verdict = system1Respond(text, { observation, board: new Blackboard(), fingerprint: observation.fingerprint })
  return { verdict, observation }
}

describe('engineering values as a designer types them', () => {
  it('reads metric prefixes and units', () => {
    expect(parseEngineeringValue('10k')).toMatchObject({ value: 10_000 })
    expect(parseEngineeringValue('4.7uF')).toMatchObject({ value: 4.7e-6, unit: 'F' })
    expect(parseEngineeringValue('22p')?.value).toBeCloseTo(2.2e-11)
    expect(parseEngineeringValue('12V')).toMatchObject({ value: 12, unit: 'V' })
    expect(parseEngineeringValue('1M')).toMatchObject({ value: 1e6 })
    expect(parseEngineeringValue('330n')?.value).toBeCloseTo(330e-9, 15)
    expect(parseEngineeringValue('  2.2µ ')?.value).toBeCloseTo(2.2e-6, 15)
  })

  it('refuses anything that is not a quantity', () => {
    expect(parseEngineeringValue('loud')).toBeNull()
    expect(parseEngineeringValue('10 kilo-what')).toBeNull()
    expect(parseEngineeringValue('')).toBeNull()
  })
})

describe('system 1 answers what is already measured', () => {
  it('greets with the real sheet counts, not a stock line', async () => {
    const { verdict, observation } = await ask('hi')
    expect(verdict.intent.kind).toBe('greeting')
    expect(verdict.reply).toContain(String(observation.stats.components))
    expect(verdict.confidence).toBeGreaterThan(0.9)
  })

  it('lists capabilities without calling a model', async () => {
    const { verdict } = await ask('what can you do?')
    expect(verdict.intent.kind).toBe('help')
    expect(verdict.basis).toContain('tool list')
  })

  it('names the single tool call behind "check the sheet"', async () => {
    const { verdict } = await ask('is there anything wrong with this schematic?')
    expect(verdict.call).toEqual({ tool: 'cad.erc', args: {} })
    expect(verdict.confidence).toBeGreaterThan(0.8)
  })

  it('runs a named analysis it has every parameter for', async () => {
    const { verdict } = await ask('dc operating point please')
    expect(verdict.call).toEqual({ tool: 'cad.simulate', args: { analysis: 'dc' } })
  })

  it('refuses to invent a run length for a transient', async () => {
    const without = await ask('run a transient analysis')
    expect(without.verdict.confidence).toBeLessThan(0.5)
    expect(without.verdict.call).toBeUndefined()

    const withDuration = await ask('transient for 4ms')
    expect(withDuration.verdict.call).toEqual({ tool: 'cad.simulate', args: { analysis: 'transient', stopS: 0.004 } })
  })

  it('answers a part question from the canvas when nothing was simulated', async () => {
    const { verdict, observation } = await ask('what is D1?')
    const diode = observation.components.find((component) => component.reference === 'D1')
    expect(verdict.intent.kind).toBe('fact')
    expect(verdict.reply).toContain(diode?.part)
    expect(verdict.basis).toContain('no simulation was needed')
  })

  it('prefers a measured number over the label on the part', async () => {
    const { observation, board } = await observe()
    board.assert({ subject: 'MID', property: 'node voltage', value: 5.98, unit: 'V', instrument: 'simulation', fingerprint: observation.fingerprint })
    const verdict = system1Respond('what is the voltage on net MID?', { observation, board, fingerprint: observation.fingerprint })
    expect(verdict.reply).toContain('5.98 V')
    expect(verdict.basis).toContain('blackboard')
  })

  it('says it has nothing verified rather than guessing about a net', async () => {
    const { verdict } = await ask('what is on net NOT_A_NET?')
    expect(verdict.confidence).toBeLessThan(0.5)
    expect(verdict.basis).toContain('no verified number')
  })

  it('drops a measurement taken on an older sheet state', async () => {
    const { observation, board } = await observe()
    board.assert({ subject: 'OUT', property: 'node voltage', value: 3.3, unit: 'V', instrument: 'simulation', fingerprint: 'stale-fingerprint' })
    const verdict = system1Respond('what is on net OUT?', { observation, board, fingerprint: observation.fingerprint })
    expect(verdict.confidence).toBeLessThan(0.5)
  })
})

describe('system 1 acts on a one-line edit', () => {
  it('turns "set R1 to 10k" into exactly one property change', async () => {
    const { verdict, observation } = await askBare('set R1 to 10k')
    expect(observation.components.map((component) => component.reference)).toContain('R1')
    expect(verdict.intent).toEqual({ kind: 'set-value', subject: 'R1', value: '10k' })
    expect(verdict.call).toEqual({ tool: 'cad.setProperty', args: { reference: 'R1', property: 'value', value: '10k' } })
    expect(verdict.confidence).toBeGreaterThan(0.85)
  })

  it('keeps the designer\'s own spelling on the part', async () => {
    const { verdict } = await ask('change C1 value to 22uF')
    expect(verdict.call?.args.value).toBe('22uF')
  })

  it('will not write a value it cannot read', async () => {
    const { verdict } = await askBare('set R1 to something big')
    expect(verdict.call).toBeUndefined()
    expect(verdict.confidence).toBeLessThan(0.5)
    expect(verdict.basis).toContain('did not read as a value')
  })

  it('will not change a part that is not on the sheet', async () => {
    const { verdict } = await askBare('set R99 to 1k')
    expect(verdict.call).toBeUndefined()
    expect(verdict.confidence).toBeLessThan(0.5)
    expect(verdict.basis).toContain('not on the sheet')
  })

  it('stays quiet when it has nothing to say', async () => {
    const { verdict } = await ask('why does the buck converter ring?')
    expect(verdict.confidence).toBe(0)
    expect(verdict.intent.kind).toBe('unknown')
  })
})
