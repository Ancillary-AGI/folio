import { describe, expect, it } from 'vitest'
import {
  composeReply,
  describeDesign,
  toSpeechText,
  type DesignContext,
} from './conversation'
import type { NLPProcessResult } from '../nlp/nlpService'

const context: DesignContext = {
  workspace: 'schematic',
  componentCount: 2,
  wireCount: 1,
  references: ['R1 Resistor', 'D1 Diode'],
}

const result = (
  intent: string,
  dispatchResult: unknown,
  confidence = 1,
): NLPProcessResult => ({ intent, entities: {}, confidence, dispatchResult })

describe('toSpeechText', () => {
  it('strips markdown, bullets and symbols a synthesiser would read out', () => {
    expect(toSpeechText('**Saved.** \n  - One thing\n  • another → done ×2')).toBe(
      'Saved. One thing another to done by 2',
    )
  })
})

describe('describeDesign', () => {
  it('states counts and names without inventing anything for an empty sheet', () => {
    expect(describeDesign({ ...context, componentCount: 0, wireCount: 0, references: [] })).toBe(
      'The schematic workspace has 0 parts and 0 wires. Nothing is placed yet.',
    )
    expect(describeDesign(context)).toContain('2 parts and 1 wire')
    expect(describeDesign(context)).toContain('R1 Resistor')
  })
})

describe('composeReply', () => {
  it('answers unknown phrases with honest guidance', () => {
    const reply = composeReply(result('unknown', undefined, 0), context)
    expect(reply.applied).toBe(false)
    expect(reply.display).toContain('do not recognise')
    expect(reply.stopVoice).toBe(false)
  })

  it('reports navigation only when the handler really navigated', () => {
    const ok = composeReply(result('switch_workspace', { applied: true, navigatedTo: 'pcb' }), context)
    expect(ok.applied).toBe(true)
    expect(ok.display).toContain('pcb')

    const no = composeReply(result('switch_workspace', { applied: false }), context)
    expect(no.applied).toBe(false)
    expect(no.display).toContain('nothing changed')
  })

  it('names the part an add really placed, and refuses otherwise', () => {
    const placed = composeReply(
      result('add_component', { applied: true, detail: 'Placed R3 (Resistor) at 220, 80.' }),
      context,
    )
    expect(placed.applied).toBe(true)
    expect(placed.display).toContain('R3')

    const refused = composeReply(result('add_component', { applied: false, detail: 'No such part.' }), context)
    expect(refused.applied).toBe(false)
    expect(refused.display).toContain('unchanged')
  })

  it('never claims a simulation result from opening the panel', () => {
    const reply = composeReply(
      result('simulate_circuit', { applied: true, action: 'simulate', type: 'transient' }),
      context,
    )
    expect(reply.applied).toBe(true)
    expect(reply.display).toContain('Opened the simulation panel')
    expect(reply.display).toContain('not a guarantee')
    expect(reply.display).not.toContain('passed')
  })

  it('reports an optimiser request as not performed', () => {
    const reply = composeReply(
      result('optimize_design', { applied: false, detail: 'nothing changed' }),
      context,
    )
    expect(reply.applied).toBe(false)
    expect(reply.display).toContain('nothing changed')
  })

  it('distinguishes a real undo from an empty history', () => {
    expect(composeReply(result('undo', { applied: true, detail: 'Undid the last canvas change.' }), context).applied).toBe(true)
    const nothing = composeReply(result('undo', { applied: false, detail: 'There is nothing to undo.' }), context)
    expect(nothing.applied).toBe(false)
    expect(nothing.display).toContain('nothing to undo')
  })

  it('summarises the sheet for describe_design', () => {
    const reply = composeReply(result('describe_design', { applied: false }), context)
    expect(reply.display).toContain('2 parts')
    expect(reply.display).toContain('R1 Resistor')
  })

  it('marks stop_voice so the controller closes the microphone and stays silent', () => {
    const reply = composeReply(result('stop_voice', { applied: true, detail: 'Voice off.' }), context)
    expect(reply.stopVoice).toBe(true)
    expect(reply.mute).toBe(true)
    expect(reply.applied).toBe(true)
  })

  it('flags a low-confidence match instead of asserting certainty', () => {
    const reply = composeReply(
      result('add_component', { applied: true, detail: 'Placed R3 (Resistor) at 220, 80.' }, 0.4),
      context,
    )
    expect(reply.display).toContain('(low-confidence match)')
  })

  it('keeps the spoken form free of transcript-only punctuation', () => {
    const reply = composeReply(
      result('connect_components', { applied: true, detail: 'Connected R1.1 to D1.2 on NET1.' }),
      context,
    )
    expect(reply.spoken).toBe('Connected R1.1 to D1.2 on NET1.')
    expect(reply.spoken).not.toContain('**')
  })
})
