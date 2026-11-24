import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_SESSION_SCHEMA,
  AGENT_SESSION_STORAGE_KEY,
  MAX_AGENT_SESSIONS,
  MAX_AGENT_SESSION_EVENTS,
  agentSessionStore,
  createAgentSession,
  describeSessionEvent,
  finishAgentSession,
  parseAgentSession,
  recordAgentSessionEvent,
  sessionFromAutopilot,
} from './agentSession'
import type { AutopilotResult } from './autopilot'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'

const component = (id: string): CanvasComponent => ({
  id,
  componentId: `${id}-library`,
  component: {
    name: 'Resistor',
    category: 'passive',
    is_standard: true,
    symbol_data: { width: 40, height: 20, paths: [] },
    pins: [],
    default_properties: {},
  },
  x: 0,
  y: 0,
  rotation: 0,
  reference: id.toUpperCase(),
  properties: { value: '1k' },
})

const wire = (id: string): CanvasWire => ({ id, points: [], connectedPins: [] })

const autopilotResult = (achieved: boolean): AutopilotResult => ({
  achieved,
  reason: achieved ? 'Target met at C1 = 47uF.' : 'No candidate met the goal.',
  goal: {
    description: 'Minimise output ripple',
    analysis: { type: 'transient', stopTime: 4e-3, stepTime: 1e-5 },
    metric: { waveform: 'V(OUT)', statistic: 'ripple', settled: true },
  },
  baselineMetric: 0.4,
  iterations: [
    {
      iteration: 0,
      phase: 'baseline',
      knobValues: { 'C1.value': 2e-6 },
      metric: 0.4,
      metricLabel: 'Ripple',
      score: -0.4,
      best: false,
      goalMet: false,
      message: 'Baseline',
      constraintFailures: [],
      schematicSvg: '<svg>baseline</svg>',
    },
    {
      iteration: 1,
      phase: 'sweep',
      knobValues: { 'C1.value': 47e-6 },
      metric: 0.01,
      metricLabel: 'Ripple',
      metricUnit: 'V',
      score: 0.97,
      best: true,
      goalMet: true,
      message: 'Best point',
      constraintFailures: [],
    },
  ],
  best: {
    iteration: 1,
    knobValues: { 'C1.value': 47e-6 },
    metric: 0.01,
    metricLabel: 'Ripple',
    metricUnit: 'V',
    score: 0.97,
    design: { components: [component('c1')], wires: [wire('w1')] },
    schematicSvg: '<svg>best</svg>',
  },
  finalDesign: { components: [component('c1')], wires: [wire('w1')] },
  fingerprint: 'abc123',
})

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('agent sessions', () => {
  it('records an ordered, bounded timeline and finishes with a status', () => {
    let session = createAgentSession({
      title: 'Bias tuning',
      goal: 'Set the collector current',
      budget: { maxCalls: 40, maxWallMs: 60_000 },
      now: 1_000,
    })
    session = recordAgentSessionEvent(session, { kind: 'goal', message: 'Start' }, 1_001)
    session = recordAgentSessionEvent(session, {
      kind: 'iteration',
      message: 'Tried R1 = 1k',
      iteration: 0,
      metric: 4.8,
      metricLabel: 'Ic',
      metricUnit: 'mA',
      calls: 3,
    }, 1_002)
    session = finishAgentSession(session, {
      status: 'completed',
      summary: 'Target met.',
      finalFingerprint: 'f1',
      now: 1_003,
    })

    expect(session.events.map((event) => event.seq)).toEqual([1, 2, 3])
    expect(session.events.map((event) => event.kind)).toEqual(['goal', 'iteration', 'finished'])
    expect(session.iterationCount).toBe(1)
    expect(session.calls).toBe(3)
    expect(session.status).toBe('completed')
    expect(session.finalFingerprint).toBe('f1')
    expect(session.updatedAt).toBe(new Date(1_003).toISOString())
    expect(describeSessionEvent(session.events[1])).toBe('#0 Tried R1 = 1k — Ic 4.8000 mA')
  })

  it('drops the oldest events instead of growing without bound', () => {
    let session = createAgentSession({ title: 'long run' })
    for (let index = 0; index < MAX_AGENT_SESSION_EVENTS + 20; index++) {
      session = recordAgentSessionEvent(session, { kind: 'note', message: `step ${index}` })
    }
    expect(session.events).toHaveLength(MAX_AGENT_SESSION_EVENTS)
    expect(session.events[0].message).toBe('step 20')
    expect(session.events[session.events.length - 1].message).toBe(`step ${MAX_AGENT_SESSION_EVENTS + 19}`)
  })

  it('persists, lists, and deletes sessions, pruning the oldest beyond the cap', () => {
    for (let index = 0; index < MAX_AGENT_SESSIONS + 5; index++) {
      const session = createAgentSession({
        title: `run ${index}`,
        id: `s-${index}`,
        now: 10_000 + index,
      })
      expect(agentSessionStore.save(session).ok).toBe(true)
    }
    const listed = agentSessionStore.list()
    expect(listed).toHaveLength(MAX_AGENT_SESSIONS)
    expect(listed[0].id).toBe(`s-${MAX_AGENT_SESSIONS + 4}`)
    expect(listed.some((session) => session.id === 's-0')).toBe(false)

    expect(agentSessionStore.get('s-10')?.title).toBe('run 10')
    agentSessionStore.delete('s-10')
    expect(agentSessionStore.get('s-10')).toBeUndefined()

    agentSessionStore.clear()
    expect(agentSessionStore.list()).toEqual([])
    expect(localStorage.getItem(AGENT_SESSION_STORAGE_KEY)).toBeNull()
  })

  it('ignores corrupt storage and rejects records with the wrong schema', () => {
    localStorage.setItem(AGENT_SESSION_STORAGE_KEY, '{not json')
    expect(agentSessionStore.list()).toEqual([])

    expect(parseAgentSession({ ...createAgentSession({ title: 'x' }), schema: 'other/1' } as unknown)).toBeUndefined()
    expect(parseAgentSession({ id: 'x', title: 'x' })).toBeUndefined()
    expect('schema' in (parseAgentSession(createAgentSession({ title: 'ok' })) ?? {})).toBe(true)
    expect(AGENT_SESSION_SCHEMA).toBe('folio.agent-session/1')
  })

  it('reports a storage quota failure instead of throwing', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    const result = agentSessionStore.save(createAgentSession({ title: 'no room' }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/QuotaExceededError/)
  })

  it('summarises an autopilot run without persisting SVG blobs', () => {
    const session = sessionFromAutopilot(autopilotResult(true), { title: 'Ripple tuner', now: 5_000 })
    expect(session.status).toBe('completed')
    expect(session.events.filter((event) => event.kind === 'iteration')).toHaveLength(2)
    expect(session.best?.knobValues['C1.value']).toBeCloseTo(47e-6)
    expect(session.best?.design.components[0].id).toBe('c1')
    expect(JSON.stringify(session)).not.toContain('schematicSvg')
    expect(session.finalFingerprint).toBe('abc123')
    expect(agentSessionStore.save(session).ok).toBe(true)
    expect(agentSessionStore.get(session.id)?.goal).toBe('Minimise output ripple')
  })

  it('marks an unmet autopilot run as stopped, not completed', () => {
    const session = sessionFromAutopilot(autopilotResult(false))
    expect(session.status).toBe('stopped')
    expect(session.summary).toMatch(/No candidate/)
  })
})
