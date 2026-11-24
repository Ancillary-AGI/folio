import { beforeEach, describe, expect, it } from 'vitest'
import {
  Blackboard,
  factsFromErc,
  factsFromObservation,
  factsFromSimulation,
  sharedBlackboard,
} from './blackboard'

const A = 'sheet-state-a'
const B = 'sheet-state-b'

describe('the blackboard holds only what an instrument measured', () => {
  let board: Blackboard

  beforeEach(() => {
    board = new Blackboard()
  })

  it('records a measurement with its unit and instrument', () => {
    const result = board.assert({ subject: 'VOUT', property: 'node voltage', value: 3.3, unit: 'V', instrument: 'simulation', fingerprint: A })
    expect(result.accepted).toBe(true)
    const fact = board.get('VOUT.node voltage')
    expect(fact).toMatchObject({ subject: 'VOUT', value: 3.3, unit: 'V', instrument: 'simulation', verified: true })
  })

  it('refuses a fact measured on a different sheet state, with the reason', () => {
    const rejected = board.assert(
      { subject: 'VOUT', property: 'node voltage', value: 3.3, unit: 'V', instrument: 'simulation', fingerprint: B },
      A,
    )
    expect(rejected.accepted).toBe(false)
    expect(rejected.reason).toContain('different sheet state')
    expect(board.size).toBe(0)
  })

  it('hides stale measurements from a reader that names the current state', () => {
    board.assert({ subject: 'VIN', property: 'node voltage', value: 12, unit: 'V', instrument: 'simulation', fingerprint: A })
    board.assert({ subject: 'VIN', property: 'node voltage', value: 5, unit: 'V', instrument: 'simulation', fingerprint: B })
    // The second assert overwrote the first, so the board now speaks about B only.
    expect(board.factsFor({ subject: 'VIN', fingerprint: A })).toEqual([])
    expect(board.factsFor({ subject: 'VIN', fingerprint: B })[0].value).toBe(5)
  })

  it('keeps a hypothesis out of the answers until an instrument confirms it', () => {
    board.assert({ subject: 'R1', property: 'dissipation', value: 0.5, unit: 'W', instrument: 'ratings', fingerprint: A, verified: false })
    expect(board.factsFor({ subject: 'R1' })).toEqual([])
    expect(board.factsFor({ subject: 'R1', includeUnverified: true })).toHaveLength(1)
    expect(board.summarize(A)).toBe('No verified measurements.')
  })

  it('reports a contradiction between a claim and a measurement', () => {
    board.assert({ subject: 'MID', property: 'node voltage', value: 6.1, unit: 'V', instrument: 'simulation', fingerprint: A })
    const claim = { subject: 'MID', property: 'node voltage', value: 9, unit: 'V', instrument: 'human' as const, fingerprint: A }
    expect(board.contradictionOf(claim)?.value).toBe(6.1)
    // Same number, or a different state, is not a contradiction.
    expect(board.contradictionOf({ ...claim, value: 6.1 })).toBeUndefined()
    expect(board.contradictionOf({ ...claim, fingerprint: B })).toBeUndefined()
  })

  it('prunes everything measured on other states after an undo', () => {
    board.assert({ subject: 'A1', property: 'x', value: 1, instrument: 'geometry', fingerprint: A })
    board.assert({ subject: 'B2', property: 'x', value: 2, instrument: 'geometry', fingerprint: B })
    expect(board.pruneTo(A)).toBe(1)
    expect(board.size).toBe(1)
    // The log keeps history — pruning the working set is not deleting the audit trail.
    expect(board.log()).toHaveLength(2)
  })

  it('summarises for a prompt as one line per fact', () => {
    board.assert({ subject: 'VOUT', property: 'node voltage', value: 3.3, unit: 'V', instrument: 'simulation', fingerprint: A })
    board.assert({ subject: 'sheet', property: 'ERC issues', value: 0, instrument: 'erc', fingerprint: A })
    const text = board.summarize(A)
    expect(text).toContain('VOUT node voltage = 3.3 V')
    expect(text).toContain('sheet ERC issues = 0')
    expect(text.split('\n')).toHaveLength(2)
  })
})

describe('instrument readers', () => {
  it('turns a solver operating point into per-node facts', () => {
    const facts = factsFromSimulation(A, { VOUT: 3.333333333, MID: 4.9999999 })
    expect(facts).toHaveLength(2)
    expect(facts[0]).toMatchObject({ property: 'node voltage', unit: 'V', instrument: 'simulation', fingerprint: A })
    expect(facts.map((fact) => fact.value)).toEqual([3.333333, 5])
  })

  it('counts ERC issues with a grammatical unit', () => {
    expect(factsFromErc(A, ['x', 'y'])[0]).toMatchObject({ value: 2, unit: 'issues' })
    expect(factsFromErc(A, ['x'])[0]).toMatchObject({ value: 1, unit: 'issue' })
    expect(factsFromErc(A, [])[0]).toMatchObject({ value: 0, unit: 'issues' })
  })

  it('records the canvas counts as the facts a question usually asks about', () => {
    const facts = factsFromObservation(A, { components: 6, nets: 4, wires: 9 })
    expect(facts.map((fact) => `${fact.property}=${fact.value}`)).toEqual(['parts=6', 'nets=4', 'wires=9'])
    expect(facts.every((fact) => fact.instrument === 'canvas')).toBe(true)
  })

  it('feeds the shared board that panels and the agent both read', () => {
    sharedBlackboard().assert({ subject: 'shared', property: 'probe', value: 1, instrument: 'canvas', fingerprint: A })
    expect(sharedBlackboard().get('shared.probe')?.value).toBe(1)
  })
})
