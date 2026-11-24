import { describe, expect, it } from 'vitest'
import { listMcpTools, callMcpTool } from './server'

/* The MCP surface is the agent-facing contract: schema shape must be real JSON
 * Schema, every listed tool must answer a well-formed call with the shape an
 * MCP client expects, and a bogus deck must be refused — not "simulated
 * anyway". */

const halfWaveRectifier = `Half-wave rectifier — transient
.title half-wave rectifier — 6 Vpk 1 kHz into 10 Ω with 1N5817
V1 1 0 SIN(0 6 1k)
D1 1 2 D1N5817
R1 2 3 100
C1 3 0 10uF
RL 3 0 100
.model D1N5817 D(Is=2.5u Rs=0.05 N=1.1 Cjo=120p M=1 BV=50 IBV=1e-06)
.tran 1us 4ms
.end`

describe('MCP tool surface', () => {
  it('lists three tools with valid JSON Schemas', () => {
    const tools = listMcpTools()
    expect(tools).toHaveLength(3)
    for (const tool of tools) {
      expect(typeof tool.name).toBe('string')
      expect(tool.inputSchema.type).toBe('object')
      expect(Array.isArray(tool.inputSchema.required)).toBe(true)
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(20)
    }
    expect(tools.map((tool) => tool.name).sort()).toEqual(['circuit_simulate', 'component_search', 'netlist_verify'])
  })

  it('component_search finds a plain resistor', () => {
    const out = JSON.parse(callMcpTool('component_search', { query: 'resistor', limit: 3 }))
    expect(Array.isArray(out.matches)).toBe(true)
    expect(out.matches.length).toBeGreaterThan(0)
    expect(out.matches[0].name.toLowerCase()).toContain('resistor')
  })

  it('netlist_verify accepts a good deck and refuses a bad one with reasons', () => {
    const good = JSON.parse(callMcpTool('netlist_verify', { netlist: halfWaveRectifier }))
    expect(good.verdict).toBe('parseable')
    expect(good.errors).toEqual([])
    expect(good.components).toBeGreaterThan(3)

    const bad = JSON.parse(callMcpTool('netlist_verify', { netlist: 'this is not a deck at all' }))
    expect(bad.verdict).toBe('refused')
    expect(bad.errors.length).toBeGreaterThan(0)
  })

  it('circuit_simulate runs the rectifier transient', () => {
    const out = JSON.parse(callMcpTool('circuit_simulate', { netlist: halfWaveRectifier, analysis: 'transient', stopTime: 0.006, stepTime: 1e-5 }))
    expect(out.verdict).toBe('solved')
    expect(Array.isArray(out.waveforms)).toBe(true)
    expect(out.waveforms.length).toBeGreaterThan(0)
    const output = out.waveforms.find((w: { name: string }) => /3|RL|V\(/.test(w.name)) ?? out.waveforms[0]
    expect(output.stats.max).toBeGreaterThan(3.5)
    expect(output.stats.max).toBeLessThan(8)
  })

  it('circuit_simulate refuses a deck it cannot parse', () => {
    const out = JSON.parse(callMcpTool('circuit_simulate', { netlist: 'R1 a b c', analysis: 'dc' }))
    expect(out.verdict).toBe('refused')
  })

  it('throws on unknown tool', () => {
    expect(() => callMcpTool('nonsense_tool', {})).toThrow(/unknown tool/i)
  })

  it('refuses a tool name that only exists on Object.prototype', () => {
    /* A plain object inherits `constructor`, `toString`, `valueOf`. Looking the
     * handler up with `HANDLERS[name]` resolved those to a Function, called it,
     * and answered with `isError: false` and a text field that was not text —
     * a "successful" call to a tool that is not on the list. */
    for (const name of ['constructor', 'toString', 'valueOf', '__proto__']) {
      expect(() => callMcpTool(name, {})).toThrow(/unknown tool/i)
    }
  })

  it('refuses an analysis the solver does not implement', () => {
    /* The handler used to cast the string straight onto
     * `SimulationParameters['type']`, so an unrecognised name fell through the
     * dispatcher's switch and came back as a TypeError about `undefined`.
     * `callMcpTool` reports refusals by throwing, which the route turns into a
     * JSON-RPC error. */
    expect(() => callMcpTool('circuit_simulate', { netlist: halfWaveRectifier, analysis: 'bode' }))
      .toThrow(/analysis must be one of/)
    // The valid enum still runs.
    expect(() => callMcpTool('circuit_simulate', { netlist: halfWaveRectifier, analysis: 'dc' })).not.toThrow()
  })

  it('refuses a transient window and a deck size that would not terminate', () => {
    expect(() => callMcpTool('circuit_simulate', {
      netlist: halfWaveRectifier, analysis: 'transient', stopTime: 1e9, stepTime: 1e-12,
    })).toThrow(/stepTime|stopTime/)
    const huge = `x\n${'R1 a b 1k\n'.repeat(400_000)}`
    expect(() => callMcpTool('netlist_verify', { netlist: huge })).toThrow(/character limit/)
  })
})
