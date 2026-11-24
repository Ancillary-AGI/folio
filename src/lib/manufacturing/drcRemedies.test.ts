import { describe, expect, it } from 'vitest'
import { DEFAULT_DRC_RULES } from './drc'
import {
  REMEDY_TOOLS,
  annotateViolations,
  countAutomaticRemedies,
  remedyFor,
} from './drcRemedies'
import type { DRCRuleType, DRCViolation } from './drc'
import { registerEdaTools } from '../agents/edaTools'
import { AgentHarness } from '../agents/agentHarness'

const settings = DEFAULT_DRC_RULES

const violation = (overrides: Partial<DRCViolation> = {}): DRCViolation => ({
  type: 'clearance',
  severity: 'error',
  message: 'Copper too close',
  location: { x: 0, y: 0 },
  elementId: 'R1',
  ...overrides,
})

describe('remedyFor', () => {
  it('names only tools the harness actually registers', () => {
    /* The whole value of a remedy is that the agent can act on it. Advice that
     * names a call the harness does not have would send the loop chasing a
     * tool that does not exist. */
    const harness = new AgentHarness()
    registerEdaTools(harness)

    const registered = new Set(harness.listTools())
    for (const tool of REMEDY_TOOLS) {
      expect(registered.has(tool), `remedy names unregistered tool ${tool}`).toBe(true)
    }
  })

  it('states the numeric shortfall when the violation carries one', () => {
    const remedy = remedyFor(
      violation({ type: 'width', value: 0.1, required: 0.2 }),
      settings,
    )
    expect(remedy.automatic).toBe(true)
    expect(remedy.instruction).toContain('0.1 mm')
    expect(remedy.instruction).toContain('0.2 mm')
    expect(remedy.recheck.tool).toBe('eda.drc')
  })

  it('falls back to the rule value when no measurement is supplied', () => {
    const remedy = remedyFor(violation({ type: 'width' }), settings)
    // The instruction must quote the board's configured minimum, not a number
    // baked into the remedy table.
    expect(remedy.instruction).toContain(String(settings.minTraceWidth))
  })

  it('marks geometry-only findings as needing judgement', () => {
    for (const type of ['clearance', 'courtyard_overlap', 'keepout', 'outline'] as DRCRuleType[]) {
      expect(remedyFor(violation({ type }), settings).automatic).toBe(false)
    }
    for (const type of ['width', 'drill', 'annular_ring'] as DRCRuleType[]) {
      expect(remedyFor(violation({ type }), settings).automatic).toBe(true)
    }
  })

  it('carries the element id into the arguments so the fix targets the right thing', () => {
    const remedy = remedyFor(violation({ elementId: 'U3' }), settings)
    expect(remedy.args.elementId).toBe('U3')
  })

  it('points every rule at a re-check', () => {
    const types: DRCRuleType[] = [
      'clearance',
      'width',
      'drill',
      'annular_ring',
      'courtyard_overlap',
      'unconnected_net',
      'acute_angle',
      'trace_length',
      'keepout',
      'outline',
    ]
    for (const type of types) {
      const remedy = remedyFor(violation({ type }), settings)
      expect(remedy.recheck.tool).toBe('eda.drc')
      expect(remedy.instruction.length).toBeGreaterThan(20)
    }
  })
})

describe('annotateViolations', () => {
  it('pairs every violation with its remedy, in order', () => {
    const violations = [
      violation({ elementId: 'R1', type: 'width' }),
      violation({ elementId: 'C2', type: 'clearance' }),
    ]
    const annotated = annotateViolations(violations, settings)
    expect(annotated).toHaveLength(2)
    expect(annotated.map((entry) => entry.violation.elementId)).toEqual(['R1', 'C2'])
    expect(annotated[0]?.remedy.automatic).toBe(true)
    expect(annotated[1]?.remedy.automatic).toBe(false)
  })

  it('counts the findings that need no judgement', () => {
    const annotated = annotateViolations(
      [
        violation({ type: 'width' }),
        violation({ type: 'drill' }),
        violation({ type: 'clearance' }),
      ],
      settings,
    )
    expect(countAutomaticRemedies(annotated)).toBe(2)
  })

  it('handles an empty report', () => {
    expect(annotateViolations([], settings)).toEqual([])
    expect(countAutomaticRemedies([])).toBe(0)
  })
})