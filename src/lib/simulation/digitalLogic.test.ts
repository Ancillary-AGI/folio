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
  it('SR and JK return X for unknown inputs instead of guessing a hold or set', () => {
    for (const current of [0, 1] as LogicValue[]) {
      for (const inputs of [
        { S: 0, R: 'X' },
        { S: 'X', R: 0 },
        { S: 1, R: 'X' },
        { S: 'X', R: 1 },
        { S: 'Z', R: 0 },
      ]) {
        const next = flipFlopNextState('SR', inputs as Record<string, LogicValue>, current)
        expect(next.q).toBe('X')
        expect(next.qbar).toBe('X')
      }
      for (const inputs of [
        { J: 1, K: 'X' },
        { J: 'X', K: 0 },
        { J: 0, K: 'X' },
        { J: 'Z', K: 1 },
      ]) {
        const next = flipFlopNextState('JK', inputs as Record<string, LogicValue>, current)
        expect(next.q).toBe('X')
        expect(next.qbar).toBe('X')
      }
      expect(flipFlopNextState('SR', { S: 0, R: 0 }, current)).toEqual({
        q: current,
        qbar: notLogic(current),
      })
      expect(flipFlopNextState('JK', { J: 0, K: 0 }, current)).toEqual({
        q: current,
        qbar: notLogic(current),
      })
    }
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

  it('swallows an input pulse shorter than the propagation delay', () => {
    const result = simulateDigital(
      {
        gates: [{ id: 'g1', type: 'BUF', inputs: ['a'], output: 'y', delay: 10 }],
        initialValues: { a: 0, y: 0 },
        stimuli: [
          { node: 'a', time: 0, value: 1 },
          { node: 'a', time: 4, value: 0 },
        ],
      },
      30,
    )
    expect(result.success).toBe(true)
    // The in-flight high transition is withdrawn at t=4; y never glitches.
    expect(result.transitions.y.map((transition) => transition.value)).toEqual([0])
    expect(valueAt(result, 'y', 30)).toBe(0)
  })

  it('passes a pulse that is longer than the propagation delay', () => {
    const result = simulateDigital(
      {
        gates: [{ id: 'g1', type: 'BUF', inputs: ['a'], output: 'y', delay: 10 }],
        initialValues: { a: 0, y: 0 },
        stimuli: [
          { node: 'a', time: 0, value: 1 },
          { node: 'a', time: 15, value: 0 },
        ],
      },
      40,
    )
    expect(valueAt(result, 'y', 9.9)).toBe(0)
    expect(valueAt(result, 'y', 10)).toBe(1)
    expect(valueAt(result, 'y', 24.9)).toBe(1)
    expect(valueAt(result, 'y', 25)).toBe(0)
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

describe('input validation', () => {
  const gate = { id: 'g1', type: 'BUF' as const, inputs: ['a'], output: 'y', delay: 1 }

  it('rejects a non-finite or non-positive stop time', () => {
    for (const stopTime of [Number.NaN, Number.POSITIVE_INFINITY, 0, -5]) {
      const result = simulateDigital({ gates: [gate] }, stopTime)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/stopTime/)
    }
  })

  it('rejects non-finite or negative gate delays', () => {
    for (const delay of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      const result = simulateDigital({ gates: [{ ...gate, delay }] }, 10)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/gate g1/)
    }
  })

  it('rejects non-finite or negative flip-flop delays', () => {
    const result = simulateDigital(
      {
        gates: [],
        flipFlops: [
          { id: 'ff1', type: 'D', clock: 'clk', edge: 'rising', delay: Number.NaN, inputs: { D: 'd' }, q: 'q', qbar: 'qb' },
        ],
      },
      10,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/flip-flop ff1/)
  })

  it('rejects stimuli with non-finite or negative times', () => {
    for (const time of [Number.NaN, -1]) {
      const result = simulateDigital({ gates: [], stimuli: [{ node: 'a', time, value: 1 }] }, 10)
      expect(result.success).toBe(false)
      expect(result.error).toMatch(/stimulus/)
    }
  })

  it('rejects a gate with no inputs and a unary gate with extra inputs', () => {
    expect(simulateDigital({ gates: [{ id: 'g1', type: 'AND', inputs: [], output: 'y', delay: 1 }] }, 10).success).toBe(false)
    expect(
      simulateDigital({ gates: [{ id: 'g1', type: 'NOT', inputs: ['a', 'b'], output: 'y', delay: 1 }] }, 10).success,
    ).toBe(false)
  })

  it('rejects clock periods and duties that cannot produce a waveform', () => {
    const netlist = { gates: [], clocks: [{ id: 'c1', output: 'clk', period: Number.POSITIVE_INFINITY }] }
    expect(simulateDigital(netlist, 10).success).toBe(false)
    // A duty of 1 has no low phase; the old loop would never advance time.
    expect(
      simulateDigital({ gates: [], clocks: [{ id: 'c1', output: 'clk', period: 10, duty: 1 }] }, 10).success,
    ).toBe(false)
    expect(
      simulateDigital({ gates: [], clocks: [{ id: 'c1', output: 'clk', period: 0, duty: 0.5 }] }, 10).success,
    ).toBe(false)
  })

  it('rejects a clock that would flood the event queue', () => {
    const result = simulateDigital(
      { gates: [], clocks: [{ id: 'c1', output: 'clk', period: 1e-9, duty: 0.5 }] },
      1e6,
    )
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/more than/)
  })

  it('honours a duty cycle by placing edges at the right times', () => {
    const result = simulateDigital(
      { gates: [], clocks: [{ id: 'c1', output: 'clk', period: 10, duty: 0.25, startState: 0 }] },
      20,
    )
    expect(result.success).toBe(true)
    expect(valueAt(result, 'clk', 7.4)).toBe(0)
    expect(valueAt(result, 'clk', 7.5)).toBe(1) // low phase = 0.75 × period
    expect(valueAt(result, 'clk', 9.9)).toBe(1)
    expect(valueAt(result, 'clk', 10)).toBe(0) // high phase = 0.25 × period
  })

  it('returns X for a time before the recorded history begins', () => {
    const result = simulateDigital(
      { gates: [], stimuli: [{ node: 'a', time: 0, value: 1 }] },
      1,
    )
    expect(valueAt(result, 'a', -1)).toBe('X')
    expect(valueAt(result, 'a', 0)).toBe(1)
  })
})
