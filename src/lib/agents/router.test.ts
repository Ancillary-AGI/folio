import { describe, expect, it } from 'vitest'
import { buildDemoBoard } from '../demo/demoBoard'
import { createMemoryCadRuntime } from './cadRuntime'
import { registerCadTools, type CadObservation } from './cadTools'
import { AgentHarness } from './agentHarness'
import { Blackboard } from './blackboard'
import { FAST_CONFIDENCE_FLOOR, routeRequest } from './router'

async function rig(availability: { ready: boolean; reason: string }) {
  const board = buildDemoBoard()
  const harness = new AgentHarness()
  const toolset = registerCadTools(harness, createMemoryCadRuntime({ components: board.components, wires: board.wires }))
  const observation = (await toolset.invoke('cad.observe')) as CadObservation
  return {
    context: {
      observation,
      board: new Blackboard(),
      fingerprint: observation.fingerprint,
      tools: harness.toolSpecs(),
      availability,
    },
  }
}

const WITH_MODEL = { ready: true, reason: 'Ollama · llama3' }
const NO_MODEL = { ready: false, reason: 'No model selected for planning.' }

describe('routing between the two minds', () => {
  it('answers a lookup with the reflex, and says why', async () => {
    const { context } = await rig(WITH_MODEL)
    const decision = routeRequest('how many parts are on the sheet?', context)
    expect(decision.choice).toBe('system1')
    expect(decision.reason).toContain('Measured from the current observation')
    expect(decision.fast?.reply).toContain(String(context.observation.stats.components))
  })

  it('escalates a search over parameters even when the sheet is measurable', async () => {
    const { context } = await rig(WITH_MODEL)
    const decision = routeRequest('optimise the divider so the midpoint is 6V', context)
    expect(decision.choice).toBe('system2')
    expect(decision.reason).toContain('a search over parameters')
    expect(decision.escalated).toBe(false)
  })

  it('escalates a multi-step instruction', async () => {
    const { context } = await rig(WITH_MODEL)
    const decision = routeRequest('add a capacitor and wire it to ground', context)
    expect(decision.choice).toBe('system2')
    expect(decision.reason).toContain('more than one instruction')
  })

  it('does not run a reflex it cannot execute', async () => {
    const { context } = await rig(WITH_MODEL)
    const decision = routeRequest('what is on net NEVER_MEASURED?', context)
    expect(decision.choice).toBe('system2')
    expect(decision.fast!.confidence).toBeLessThan(FAST_CONFIDENCE_FLOOR)
  })

  it('says which mind is missing when there is no model and no reflex', async () => {
    const { context } = await rig(NO_MODEL)
    const decision = routeRequest('why is my buck converter ringing?', context)
    expect(decision.choice).toBe('unavailable')
    // The reason has to name both halves of the problem and the fix.
    expect(decision.reason).toContain('needs a plan')
    expect(decision.reason).toContain('No model selected for planning.')
  })

  it('still runs the reflex when a model is down but the answer is measured', async () => {
    const { context } = await rig(NO_MODEL)
    const decision = routeRequest('check the schematic for errors', context)
    expect(decision.choice).toBe('system1')
    expect(decision.fast?.call).toEqual({ tool: 'cad.erc', args: {} })
  })

  it('admits the reflex was unsure instead of guessing when no model can take over', async () => {
    const { context } = await rig(NO_MODEL)
    const decision = routeRequest('what is the voltage on net UNMEASURED?', context)
    expect(decision.choice).toBe('unavailable')
    expect(decision.reason).toContain('reflex was not certain')
    expect(decision.reason).toContain('no verified number')
  })

  it('refuses to plan a multi-step job with no model at all', async () => {
    const { context } = await rig(NO_MODEL)
    const decision = routeRequest('design a filter, then explain why it works', context)
    expect(decision.choice).toBe('unavailable')
    expect(decision.reason).toContain('no model is reachable')
  })

  it('times the decision it just made', async () => {
    const { context } = await rig(WITH_MODEL)
    expect(routeRequest('hi', context).elapsedMs).toBeGreaterThanOrEqual(0)
  })
})
