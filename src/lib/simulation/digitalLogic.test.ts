import { describe, it, expect } from 'vitest'
import {
  evalGate,
  flipFlopNextState,
  notLogic,
  simulateDigital,
  valueAt,
  type LogicValue,
} from './digitalLogic'

/**
 * Every expected value here is written out by hand or derived from an
 * independent formulation (counting ones for XOR, etc.). None of it calls the
 * module's own evaluator, so a bug in `evalGate` cannot make its own test pass.
 */

const VALS: LogicValue[] = [0, 1, 'X', 'Z']

describe('four-state NOT', () => {
  it('inverts 0 and 1, maps X and Z to X', () => {
    expect(notLogic(0)).toBe(1)
    expect(notLogic(1)).toBe(0)
    expect(notLogic('X')).toBe('X')
    expect(notLogic('Z')).toBe('X')
  })
})

describe('two-input gate truth tables', () => {
  // Independent expected tables for inputs drawn from {0,1,X,Z}.
  const expectedAND: Record<string, LogicValue> = {
    '0,0': 0, '0,1': 0, '0,X': 0, '0,Z': 0,
    '1,0': 0, '1,1': 1, '1,X': 'X', '1,Z': 'X',
    'X,0': 0, 'X,1': 'X', 'X,X': 'X', 'X,Z': 'X',
    'Z,0': 0, 'Z,1': 'X', 'Z,X': 'X', 'Z,Z': 'X',
  }
  const expectedOR: Record<string, LogicValue> = {
    '0,0': 0, '0,1': 1, '0,X': 'X', '0,Z': 'X',
    '1,0': 1, '1,1': 1, '1,X': 1, '1,Z': 1,
    'X,0': 'X', 'X,1': 1, 'X,X': 'X', 'X,Z': 'X',
    'Z,0': 'X', 'Z,1': 1, 'Z,X': 'X', 'Z,Z': 'X',
  }
  const expectedXOR: Record<string, LogicValue> = {
    '0,0': 0, '0,1': 1, '1,0': 1, '1,1': 0,
    '0,X': 'X', '1,X': 'X', 'X,0': 'X', 'X,1': 'X', 'X,X': 'X',
    '0,Z': 'X', '1,Z': 'X', 'Z,0': 'X', 'Z,1': 'X', 'X,Z': 'X', 'Z,X': 'X', 'Z,Z': 'X',
  }

  it('AND follows the 4-state table', () => {
    for (const a of VALS)
      for (const b of VALS) expect(evalGate('AND', [a, b])).toBe(expectedAND[`${a},${b}`])
  })
  it('NAND is NOT of AND', () => {
    for (const a of VALS)
      for (const b of VALS)
        expect(evalGate('NAND', [a, b])).toBe(notLogic(expectedAND[`${a},${b}`]))
  })
  it('OR follows the 4-state table', () => {
    for (const a of VALS)
      for (const b of VALS) expect(evalGate('OR', [a, b])).toBe(expectedOR[`${a},${b}`])
  })
  it('NOR is NOT of OR', () => {
    for (const a of VALS)
      for (const b of VALS)
        expect(evalGate('NOR', [a, b])).toBe(notLogic(expectedOR[`${a},${b}`]))
  })
  it('XOR is parity of ones, X when any input unknown', () => {
    for (const a of VALS)
      for (const b of VALS) expect(evalGate('XOR', [a, b])).toBe(expectedXOR[`${a},${b}`])
  })
  it('XNOR is NOT of XOR', () => {
    for (const a of VALS)
      for (const b of VALS)
        expect(evalGate('XNOR', [a, b])).toBe(notLogic(expectedXOR[`${a},${b}`]))
  })
  it('BUF passes a known value, X on Z or X', () => {
    expect(evalGate('BUF', [1])).toBe(1)
    expect(evalGate('BUF', [0])).toBe(0)
    expect(evalGate('BUF', ['X'])).toBe('X')
    expect(evalGate('BUF', ['Z'])).toBe('X')
  })
})

describe('flip-flop next-state', () => {
  it('D latches the data input', () => {
    expect(flipFlopNextState('D', { D: 1 }, 0).q).toBe(1)
    expect(flipFlopNextState('D', { D: 0 }, 1).q).toBe(0)
    expect(flipFlopNextState('D', { D: 'Z' }, 1).q).toBe(1) // hold on hi-Z
  })
  it('T toggles on 1, holds on 0', () => {
    expect(flipFlopNextState('T', { T: 1 }, 0).q).toBe(1)
    expect(flipFlopNextState('T', { T: 1 }, 1).q).toBe(0)
    expect(flipFlopNextState('T', { T: 0 }, 1).q).toBe(1)
  })
  it('JK sets, resets, holds, toggles', () => {
    expect(flipFlopNextState('JK', { J: 1, K: 0 }, 0).q).toBe(1)
    expect(flipFlopNextState('JK', { J: 0, K: 1 }, 1).q).toBe(0)
    expect(flipFlopNextState('JK', { J: 0, K: 0 }, 1).q).toBe(1)
    expect(flipFlopNextState('JK', { J: 1, K: 1 }, 1).q).toBe(0) // toggle
    expect(flipFlopNextState('JK', { J: 1, K: 1 }, 0).q).toBe(1)
  })
  it('SR is invalid when both asserted', () => {
    expect(flipFlopNextState('SR', { S: 1, R: 1 }, 0).q).toBe('X')
  })
})


describe('event-driven simulation', () => {
  it('propagates an AND gate with its delay', () => {
    const result = simulateDigital(
      {
        gates: [{ id: 'g1', type: 'AND', inputs: ['a', 'b'], output: 'y', delay: 5 }],
        stimuli: [
          { node: 'a', time: 0, value: 1 },
          { node: 'b', time: 0, value: 1 },
        ],
      },
      20,
    )
    expect(result.success).toBe(true)
    expect(valueAt(result, 'y', 4)).toBe('X')
    expect(valueAt(result, 'y', 5)).toBe(1)
  })

  it('ripples through a chain, each stage adding its delay', () => {
    const result = simulateDigital(
      {
        gates: [
          { id: 'g1', type: 'BUF', inputs: ['a'], output: 'n1', delay: 2 },
          { id: 'g2', type: 'BUF', inputs: ['n1'], output: 'n2', delay: 3 },
        ],
        stimuli: [{ node: 'a', time: 0, value: 1 }],
      },
      20,
    )
    expect(valueAt(result, 'n1', 2)).toBe(1)
    expect(valueAt(result, 'n2', 4)).toBe('X')
    expect(valueAt(result, 'n2', 5)).toBe(1)
  })

  it('a rising-edge D flip-flop samples data only on the clock edge', () => {
    const result = simulateDigital(
      {
        gates: [],
        flipFlops: [{ id: 'ff1', type: 'D', clock: 'clk', edge: 'rising', delay: 2, inputs: { D: 'd' }, q: 'q', qbar: 'qb' }],
        stimuli: [{ node: 'd', time: 0, value: 1 }],
        clocks: [{ id: 'c1', output: 'clk', period: 10, startState: 0 }],
      },
      30,
    )
    // startState 0 → first rising edge at t=5; q lands at 5+delay(2)=7 carrying d=1.
    expect(valueAt(result, 'q', 6)).toBe('X')
    expect(valueAt(result, 'q', 7)).toBe(1)
    expect(valueAt(result, 'qb', 7)).toBe(0)
  })

  it('cascaded T flip-flops form a binary counter', () => {
    const result = simulateDigital(
      {
        gates: [],
        flipFlops: [
          { id: 'ff0', type: 'T', clock: 'clk', edge: 'rising', delay: 1, inputs: { T: 'one' }, q: 'q0', qbar: 'qb0' },
          { id: 'ff1', type: 'T', clock: 'q0', edge: 'falling', delay: 1, inputs: { T: 'one' }, q: 'q1', qbar: 'qb1' },
          { id: 'ff2', type: 'T', clock: 'q1', edge: 'falling', delay: 1, inputs: { T: 'one' }, q: 'q2', qbar: 'qb2' },
        ],
        // State bits must start at 0; a T-FF cannot toggle out of X.
        initialValues: { one: 1, q0: 0, q1: 0, q2: 0 },
        clocks: [{ id: 'c1', output: 'clk', period: 10, startState: 0 }],
      },
      100,
    )
    expect(result.success).toBe(true)
    const readCount = (time: number): number =>
      ((valueAt(result, 'q2', time) === 1 ? 4 : 0) |
        (valueAt(result, 'q1', time) === 1 ? 2 : 0) |
        (valueAt(result, 'q0', time) === 1 ? 1 : 0))
    // startState 0 → k-th rising edge at t = 10k-5; ripple settles by t=10k-1.
    // Sampled at t=10k (well after settle, before the next edge) the count is k mod 8.
    expect(readCount(40)).toBe(4) // after 4 clocks → 100
    expect(readCount(60)).toBe(6) // after 6 clocks → 110
    expect(readCount(80)).toBe(0) // after 8 clocks → wraps to 000
  })

  it('fails loud on a combinational loop instead of hanging', () => {
    const result = simulateDigital(
      {
        gates: [{ id: 'g1', type: 'NOT', inputs: ['w'], output: 'w', delay: 1 }],
        stimuli: [{ node: 'w', time: 0, value: 0 }],
      },
      1000,
    )
    expect(result.eventCount).toBeGreaterThan(0)
  })

  it('reports an unknown net as X rather than inventing 0', () => {
    const result = simulateDigital(
      { gates: [{ id: 'g1', type: 'AND', inputs: ['floating', 'b'], output: 'y', delay: 1 }] },
      10,
    )
    expect(valueAt(result, 'y', 10)).toBe('X')
    expect(result.finalValues['y']).toBe('X')
  })
})
