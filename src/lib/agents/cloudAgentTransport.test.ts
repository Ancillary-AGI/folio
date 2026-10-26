import { describe, expect, it, vi } from 'vitest'
import {
  AGENT_JOB_SCHEMA,
  CloudAgentUnavailableError,
  cloudAgentConfigFromEnv,
  cloudAgentTransportFromEnv,
  createAgentJobRequest,
  createCloudAgentTransport,
  createUnavailableCloudTransport,
  isTerminalJobState,
} from './cloudAgentTransport'
import type { AutopilotGoal } from './autopilot'

const goal: AutopilotGoal = {
  description: 'Minimise ripple',
  analysis: { type: 'transient', stopTime: 4e-3, stepTime: 1e-5 },
  metric: { waveform: 'V(OUT)', statistic: 'ripple', settled: true },
}

const jobRequest = () => createAgentJobRequest({
  sessionId: 'session-1',
  title: 'Ripple tuner',
  goal,
  design: { components: [], wires: [], firmware: '' },
  budget: { maxCalls: 100, maxWallMs: 300_000 },
  now: 1_700_000_000_000,
})

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const fetchMock = (impl: FetchImpl) => vi.fn(impl)

describe('cloud agent transport', () => {
  it('reports missing configuration honestly and keeps local work available', () => {
    const config = cloudAgentConfigFromEnv({})
    expect(config.configured).toBe(false)
    expect(config.reason).toMatch(/VITE_AGENT_CLOUD_URL/)
    expect(config.reason).toMatch(/Local design/)
    const transport = cloudAgentTransportFromEnv({})
    expect(transport.kind).toBe('unavailable')
  })

  it('builds a configured transport and strips a trailing slash', () => {
    const transport = cloudAgentTransportFromEnv({
      VITE_AGENT_CLOUD_URL: 'https://agents.example.com/',
      VITE_AGENT_CLOUD_TOKEN: 'short-lived-token',
    })
    expect(transport.kind).toBe('cloud')
    expect(transport.baseUrl).toBe('https://agents.example.com')
  })

  it('rejects a non-HTTP base URL', () => {
    expect(() => createCloudAgentTransport({ baseUrl: 'ftp://agents.example.com' })).toThrow(/http/)
  })

  it('submits a job with the schema, bearer token, and idempotency key', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse({ jobId: 'job-9', state: 'queued' }))
    const transport = createCloudAgentTransport({
      baseUrl: 'https://agents.example.com',
      token: 'token-123',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const request = jobRequest()
    const submitted = await transport.submit(request)

    expect(submitted).toEqual({ jobId: 'job-9', state: 'queued' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://agents.example.com/v1/agent/jobs')
    expect(init.method).toBe('POST')
    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer token-123')
    expect(headers.get('Content-Type')).toBe('application/json')
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body.schema).toBe(AGENT_JOB_SCHEMA)
    expect(body.clientJobId).toBe('session-1')
    expect(body.approvalMode).toBe('auto')
    expect(body.goal).toMatchObject({ description: 'Minimise ripple' })
  })

  it('parses status and refuses a malformed payload', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'job-1',
        state: 'running',
        progress: { step: 12, total: 40, message: 'Sweeping C1' },
      }))
      .mockResolvedValueOnce(jsonResponse({ id: 'job-1', state: 'exploded' }))
    const transport = createCloudAgentTransport({
      baseUrl: 'https://agents.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const running = await transport.status('job-1')
    expect(running.state).toBe('running')
    expect(running.progress).toEqual({ step: 12, total: 40, message: 'Sweeping C1' })
    expect(isTerminalJobState(running.state)).toBe(false)
    await expect(transport.status('job-1')).rejects.toThrow(/valid id or state/)
    expect(isTerminalJobState('succeeded')).toBe(true)
  })

  it('fetches events after a cursor and surfaces HTTP errors with the body', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse({ ok: true }))
      .mockResolvedValueOnce(jsonResponse({
        events: [
          { seq: 4, at: '2026-10-24T00:00:00.000Z', type: 'iteration', message: 'C1 = 47u', metric: 0.01 },
        ],
      }))
      .mockResolvedValueOnce(new Response('runner offline', { status: 503, statusText: 'Service Unavailable' }))
    const transport = createCloudAgentTransport({
      baseUrl: 'https://agents.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    const events = await transport.events('job-1', 3)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ seq: 4, type: 'iteration', metric: 0.01 })
    const [url] = fetchImpl.mock.calls[0] as unknown as [string]
    expect(url).toBe('https://agents.example.com/v1/agent/jobs/job-1/events?after=3')

    await expect(transport.events('job-1')).rejects.toThrow(/HTTP 503.*runner offline/)
  })

  it('streams server-sent events and stops at the DONE sentinel', async () => {
    const first = { seq: 1, at: '2026-10-24T00:00:00.000Z', type: 'status', message: 'queued' }
    const second = { seq: 2, at: '2026-10-24T00:00:01.000Z', type: 'iteration', message: 'C1 swept', metric: 0.02 }
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(first)}\n\n`))
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(second)}\n\n`))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      },
    })
    const fetchImpl = fetchMock(async () => new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const transport = createCloudAgentTransport({
      baseUrl: 'https://agents.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    const received: number[] = []
    await transport.stream('job-2', (event) => received.push(event.seq))
    expect(received).toEqual([1, 2])
  })

  it('cancels a job with a POST and refuses empty ids', async () => {
    const fetchImpl = fetchMock(async () => jsonResponse({ ok: true }))
    const transport = createCloudAgentTransport({
      baseUrl: 'https://agents.example.com',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })
    await transport.cancel('job-3')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://agents.example.com/v1/agent/jobs/job-3/cancel')
    expect(init.method).toBe('POST')
    await expect(transport.cancel('')).rejects.toThrow(/job id/)
  })

  it('explains why an unavailable transport cannot run a job', async () => {
    const transport = createUnavailableCloudTransport(
      'Always-on agents need a server-side runner; this build has none configured.',
    )
    expect(transport.kind).toBe('unavailable')
    await expect(transport.submit(jobRequest())).rejects.toBeInstanceOf(CloudAgentUnavailableError)
    await expect(transport.status('x')).rejects.toThrow(/server-side runner/)
  })

  it('validates a job request before it reaches the network', () => {
    const base = {
      sessionId: 'session-1',
      title: 't',
      goal,
      design: { components: [], wires: [], firmware: '' },
      budget: { maxCalls: 10, maxWallMs: 1000 },
    }
    expect(() => createAgentJobRequest({ ...base, sessionId: ' ' })).toThrow(/client job id/)
    expect(() => createAgentJobRequest({
      ...base,
      goal: { ...goal, description: ' ' },
    })).toThrow(/description/)
    expect(() => createAgentJobRequest({ ...base, budget: { maxCalls: 0, maxWallMs: 1000 } })).toThrow(/budget/)
  })
})
