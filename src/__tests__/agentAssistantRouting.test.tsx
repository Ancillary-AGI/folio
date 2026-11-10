/**
 * Assistant routing — the transcript has to say which mind answered.
 *
 * These are the three paths a designer can land on, proven through the real
 * component: a reflex that answers from the measured sheet without touching a
 * model, a reflex that makes one gated edit to the live store, the fixed EDA plan
 * when a planner is wanted but unreachable, and the System 2 loop actually
 * calling an endpoint, executing what it asked for, and reporting its token cost.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import AgentAssistant from '../components/ecad/agent/AgentAssistant'
import { useProjectStore } from '../stores/useProjectStore'
import { DEFAULT_MODEL_SETTINGS, useModelSettings } from '../lib/models/settings'
import { buildDemoBoard } from '../lib/demo/demoBoard'

function readerOf(chunks: Uint8Array[]) {
  let at = 0
  return {
    read: async () => (at < chunks.length ? { done: false as const, value: chunks[at++] } : { done: true as const, value: undefined }),
    cancel: async () => {},
    releaseLock: () => {},
  }
}

/** A whole JSON body, which is what `stream: true`-ignoring servers return. */
function jsonBody(payload: unknown) {
  const text = JSON.stringify(payload)
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: { getReader: () => readerOf([]) },
    text: async () => text,
  } as unknown as Response
}

const askToolCall = (name: string, args: Record<string, unknown>) => jsonBody({
  choices: [{
    message: { tool_calls: [{ id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] },
    finish_reason: 'tool_calls',
  }],
  usage: { prompt_tokens: 120, completion_tokens: 8 },
})

const sayDone = (summary: string) => jsonBody({
  choices: [{ message: { content: JSON.stringify({ done: true, summary }) }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 200, completion_tokens: 20 },
})

const prompt = () => screen.getByLabelText('Assistant prompt')

const send = async (text: string) => {
  fireEvent.change(prompt(), { target: { value: text } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
}

describe('AgentAssistant routing', () => {
  let fetchSpy: Mock<[], Promise<Response>>

  beforeEach(() => {
    const board = buildDemoBoard()
    useProjectStore.setState({ components: board.components, wires: board.wires, pcbLayout: null })
    useModelSettings.setState({ settings: DEFAULT_MODEL_SETTINGS, apiKey: '' })
    // Nothing here may reach the network: a local port nobody listens on would
    // otherwise make these tests depend on what is installed on the machine.
    fetchSpy = vi.fn(async () => jsonBody({ choices: [{ message: { content: 'no step' } }] }))
    vi.stubGlobal('fetch', fetchSpy)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('answers a counting question from the reflex and says no model was called', async () => {
    render(<AgentAssistant />)
    expect(screen.getByText('Reflexes only')).toBeInTheDocument()

    await send('how many parts are on the sheet')

    expect(await screen.findByText(/The sheet holds/)).toBeInTheDocument()
    expect(screen.getByText(/Reflex · \d+ ms · no model called/)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('makes a one-line value change through the live store without a model', async () => {
    render(<AgentAssistant />)

    await send('set C1 to 47u')

    expect(await screen.findByText(/Completed 1 of 1 step/)).toBeInTheDocument()
    expect(useProjectStore.getState().components.find((component) => component.reference === 'C1')?.properties.value).toBe('47u')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('runs the fixed EDA plan when the request needs a plan but no model is reachable', async () => {
    const onOpenModels = vi.fn()
    render(<AgentAssistant onOpenModels={onOpenModels} />)

    // "Auto-route board" is a job the deterministic flow owns, so the missing
    // model is not an error — the work still happens.
    await send('Auto-route board')

    await screen.findByText(/Route:/)
    expect(screen.getByText(/EDA plan · 4 step\(s\) · deterministic/)).toBeInTheDocument()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('names the missing mind and offers the fix when even the fixed plan has no match', async () => {
    const onOpenModels = vi.fn()
    render(<AgentAssistant onOpenModels={onOpenModels} />)

    await send('optimise the filter capacitor for minimum ripple')

    expect(await screen.findByText(/needs a plan — and no model is reachable/)).toBeInTheDocument()
    expect(screen.getByText(/No model selected for planning/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Models' }))
    expect(onOpenModels).toHaveBeenCalled()
  })

  it('lets the planner decide a tool call and reports its token cost', async () => {
    useModelSettings.setState({
      settings: { ...DEFAULT_MODEL_SETTINGS, baseUrlOverride: 'http://127.0.0.1:9/v1', plannerModel: 'test-planner' },
    })
    // One call names a tool, the next finishes: the loop has to read the result
    // of the first before it is allowed to conclude anything.
    let turns = 0
    fetchSpy.mockImplementation(async () => {
      turns += 1
      return turns === 1
        ? askToolCall('cad.simulate', { analysis: 'dc', parameters: '{}' })
        : sayDone('DC operating point solved on the live sheet.')
    })

    render(<AgentAssistant />)
    expect(screen.getByText('Planner ready')).toBeInTheDocument()

    // "explain why" is a deliberate marker, so the reflex is skipped on purpose.
    await send('explain why the ripple on the output is too high')

    await screen.findByText(/DC operating point solved/)
    expect(fetchSpy).toHaveBeenCalledTimes(2)
    expect(screen.getByText(/Planner · .* · 348 tokens/)).toBeInTheDocument()
    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toContain('/chat/completions')
    const body = JSON.parse(String(init.body)) as {
      model: string
      tools?: { type: string; function: { name: string } }[]
    }
    expect(body.model).toBe('test-planner')
    expect(body.tools?.map((tool) => tool.function.name)).toContain('cad.simulate')
  })

  it('says so plainly when the configured model cannot be reached', async () => {
    useModelSettings.setState({
      settings: { ...DEFAULT_MODEL_SETTINGS, baseUrlOverride: 'http://127.0.0.1:9/v1', plannerModel: 'test-planner' },
    })
    fetchSpy.mockImplementation(async () => {
      throw new TypeError('Failed to fetch')
    })

    render(<AgentAssistant />)
    await send('explain why the ripple on the output is too high')

    const escalation = await screen.findByText(/The model could not be reached/)
    expect(escalation).toBeInTheDocument()
    // The fixed flow has no recipe for "explain why", and the panel says that
    // instead of leaving a dead endpoint looking like a completed answer.
    expect(await screen.findByText(/no flow for that request either/)).toBeInTheDocument()
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
  })
})
