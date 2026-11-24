import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenerationResult } from '../models/types'

const generateText = vi.fn()

// Only the network is faked: `ModelCallError` stays the real class so that the
// planner's `instanceof` branch is exercised, not simulated.
vi.mock('../models/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../models/client')>()
  return { ...actual, generateText: (...args: unknown[]) => generateText(...(args as [])) }
})

const { buildInitialMessages, createModelPlanner, parseDecision, deliberateBudget, PlannerUnavailableError } = await import('./system2')
const { Blackboard } = await import('./blackboard')
const { AgentHarness } = await import('./agentHarness')
const { buildDemoBoard } = await import('../demo/demoBoard')
const { createMemoryCadRuntime } = await import('./cadRuntime')
const { registerCadTools } = await import('./cadTools')

const endpoint = { providerId: 'openai', protocol: 'openai' as const, baseUrl: 'https://x/v1', apiKey: 'k' }

const settings = { endpoint, model: 'planner', reasoningEffort: 'off' as const, temperature: 0.2, contextBudgetTokens: 1200 }

async function rig() {
  const board = buildDemoBoard()
  const harness = new AgentHarness()
  const toolset = registerCadTools(harness, createMemoryCadRuntime({ components: board.components, wires: board.wires }))
  const observation = (await toolset.invoke('cad.observe')) as Parameters<typeof buildInitialMessages>[1]
  return { harness, toolset, board: new Blackboard(), observation }
}

const answer = (over: Partial<GenerationResult>): GenerationResult => ({
  text: '',
  toolCalls: [],
  usage: { inputTokens: 10, outputTokens: 5 },
  latencyMs: 12,
  ...over,
})

beforeEach(() => {
  generateText.mockReset()
})

describe('the first prompt', () => {
  it('states the goal, the parts and the named nets the sheet actually has', async () => {
    const { harness, board, observation } = await rig()
    const messages = buildInitialMessages('make the divider 6V', observation, board, harness.toolSpecs(), 1200)
    const packed = messages.map((message) => message.content).join('\n')
    expect(messages[0].content).toContain('Never state a number you did not receive from a tool result')
    expect(packed).toContain('make the divider 6V')
    expect(packed).toContain('D1')
    expect(packed).toContain('Named nets: 0, MID, OUT, SRC')
    expect(packed).toContain('cad.simulate(')
    expect(packed).toContain('No verified measurements.')
  })

  it('says what it had to cut instead of looking complete', async () => {
    const { harness, board, observation } = await rig()
    const messages = buildInitialMessages('a goal long enough to matter'.repeat(4), observation, board, harness.toolSpecs(), 64)
    const last = messages[messages.length - 1].content
    expect(last).toContain('omitted sections')
    expect(last).toContain('goal')
  })
})

describe('coercing a model reply into an executable step', () => {
  it('accepts the JSON contract and drops non-scalar arguments', async () => {
    const { harness } = await rig()
    const decision = parseDecision('{"tool":"cad.addPart","args":{"symbol":"resistor","properties":{"a":1},"includeSvg":true}}', harness.toolSpecs())
    expect(decision).toEqual({ tool: 'cad.addPart', args: { symbol: 'resistor', includeSvg: true }, rationale: undefined })
  })

  it('accepts a completion with a summary', async () => {
    const { harness } = await rig()
    expect(parseDecision('{"done":true,"summary":"3.3V at OUT"}', harness.toolSpecs())).toEqual({ done: true, summary: '3.3V at OUT' })
  })

  it('rejects prose, a tool that does not exist, and a half sentence', async () => {
    const { harness } = await rig()
    const tools = harness.toolSpecs()
    expect(parseDecision('I would simulate this.', tools)).toBeNull()
    expect(parseDecision('{"tool":"cad.teleport","args":{}}', tools)).toBeNull()
    expect(parseDecision('{"tool":', tools)).toBeNull()
    expect(parseDecision('', tools)).toBeNull()
  })
})

describe('the deliberate loop', () => {
  it('runs a native function call the provider returned', async () => {
    const { harness, board, observation } = await rig()
    generateText.mockResolvedValue(answer({ text: 'Checking the rules.', toolCalls: [{ id: 'c1', name: 'cad.erc', args: {} }] }))
    const planner = createModelPlanner('check it', settings, harness, board, observation)
    const decision = await planner.decide({ step: 0, remainingCalls: 5, observation, transcript: [] } as never)
    expect(decision).toEqual({ tool: 'cad.erc', args: {}, rationale: 'Checking the rules.' })
    expect(planner.state.tokens).toEqual({ input: 10, output: 5 })
    // The prompt asked for the tools natively as well as in the JSON contract.
    expect(generateText.mock.calls[0][1].tools.map((tool: { name: string }) => tool.name)).toContain('cad.erc')
  })

  it('falls back to the JSON contract when the model only writes text', async () => {
    const { harness, board, observation } = await rig()
    generateText.mockResolvedValue(answer({ text: '```json\n{"tool":"cad.observe","args":{},"rationale":"look"}\n```' }))
    const planner = createModelPlanner('look', settings, harness, board, observation)
    const decision = await planner.decide({ step: 0, remainingCalls: 5, observation, transcript: [] } as never)
    expect(decision).toMatchObject({ tool: 'cad.observe', rationale: 'look' })
  })

  it('refuses to run a tool the harness never registered', async () => {
    const { harness, board, observation } = await rig()
    generateText.mockResolvedValue(answer({ toolCalls: [{ id: 'c1', name: 'cad.deleteEverything', args: {} }] }))
    const planner = createModelPlanner('oops', settings, harness, board, observation)
    const decision = await planner.decide({ step: 0, remainingCalls: 5, observation, transcript: [] } as never)
    expect(decision).toMatchObject({ tool: 'cad.observe' })
    expect(planner.state.history.some((entry) => entry.role === 'error' && entry.text.includes('cad.deleteEverything'))).toBe(true)
  })

  it('asks once more in the required shape before giving up', async () => {
    const { harness, board, observation } = await rig()
    generateText
      .mockResolvedValueOnce(answer({ text: 'Let me think about your request.' }))
      .mockResolvedValueOnce(answer({ text: '{"done":true,"summary":"nothing to do"}' }))
    const planner = createModelPlanner('hmm', settings, harness, board, observation)
    const decision = await planner.decide({ step: 0, remainingCalls: 5, observation, transcript: [] } as never)
    expect(decision).toEqual({ done: true, summary: 'nothing to do' })
    expect(generateText).toHaveBeenCalledTimes(2)
  })

  it('reports an unreachable model as unreachable, not as finished', async () => {
    const { harness, board, observation } = await rig()
    const { ModelCallError } = await import('../models/client')
    generateText.mockRejectedValue(new ModelCallError('Could not reach openai at 127.0.0.1:11434.', undefined, 'Set OLLAMA_ORIGINS.'))
    const planner = createModelPlanner('plan', settings, harness, board, observation)
    await expect(planner.decide({ step: 0, remainingCalls: 5, observation, transcript: [] } as never)).rejects.toBeInstanceOf(PlannerUnavailableError)
  })

  it('reads the last call back into the transcript and onto the blackboard', async () => {
    const { harness, board, observation } = await rig()
    generateText.mockResolvedValue(answer({ text: '{"done":true,"summary":"measured"}' }))
    const planner = createModelPlanner('simulate it', settings, harness, board, observation)
    const call = await harness.call('cad.simulate', { analysis: 'dc' }, deliberateBudget(), () => true)
    await planner.decide({ step: 1, remainingCalls: 4, observation, transcript: harness.auditTrail() } as never)
    expect(call.error).toBeUndefined()
    // Every node the solver reported became a fact keyed by the sheet it measured.
    expect(board.factsFor({ instrument: 'simulation', fingerprint: observation.fingerprint }).length).toBeGreaterThan(0)
    const prompt = generateText.mock.calls[0][1].messages.map((message: { content: string }) => message.content).join('\n')
    expect(prompt).toContain('node voltage')
    // and the assistant turn is replayed as a structured call, not a JSON string
    expect(generateText.mock.calls[0][1].messages.some((message: { role: string }) => message.role === 'tool')).toBe(true)
  })

  it('notes when the sheet moved while the plan was being written', async () => {
    const { harness, board, observation } = await rig()
    generateText.mockResolvedValue(answer({ text: '{"done":true,"summary":"ok"}' }))
    const planner = createModelPlanner('grow it', settings, harness, board, observation)
    const moved = (await harness.call('cad.addPart', { symbol: 'resistor' }, deliberateBudget(), () => true)).result as never
    await planner.decide({ step: 1, remainingCalls: 4, observation: moved, transcript: harness.auditTrail() } as never)
    const prompt = generateText.mock.calls[0][1].messages.map((message: { role: string; content: string }) => `${message.role}:${message.content}`).join('\n')
    expect(prompt).toContain('The sheet changed since this plan began')
  })
})

describe('budgets', () => {
  it('bounds a deliberate run by calls and wall time', () => {
    const budget = deliberateBudget(6, 1000)
    expect(budget).toMatchObject({ maxCalls: 6, maxWallMs: 1000 })
    expect(budget.startedAt).toBeLessThanOrEqual(Date.now())
  })
})
