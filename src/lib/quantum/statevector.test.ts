/**
 * Exact statevector tests: every amplitude below is worked out by hand from the
 * gate definitions, so the simulator is checked against linear algebra rather
 * than against its own output.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_QUBITS,
  expectationPauliZ,
  measureState,
  qubitProbabilities,
  qubitProbabilityOne,
  sampleCounts,
  simulateCircuit,
  type QuantumGate,
} from './statevector'

const seeded = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 2 ** 32
  }
}

const rotate = (type: 'rx' | 'ry' | 'rz', qubit: number, angle: number): QuantumGate => ({ type, qubit, angle })

describe('single-qubit gates', () => {
  it('flips |0> to |1> with X', () => {
    const state = simulateCircuit(1, [{ type: 'x', qubit: 0 }])
    expect(state.probabilities).toEqual([0, 1])
    expect(state.basisLabels).toEqual(['0', '1'])
  })

  it('returns |0> after two Hadamards', () => {
    const state = simulateCircuit(1, [
      { type: 'h', qubit: 0 },
      { type: 'h', qubit: 0 },
    ])
    expect(state.probabilities[0]).toBeCloseTo(1, 12)
    expect(state.probabilities[1]).toBeCloseTo(0, 12)
    expect(state.amplitudes[0].im).toBeCloseTo(0, 12)
  })

  it('puts a Hadamard into an equal superposition', () => {
    const state = simulateCircuit(1, [{ type: 'h', qubit: 0 }])
    expect(state.probabilities[0]).toBeCloseTo(0.5, 12)
    expect(state.probabilities[1]).toBeCloseTo(0.5, 12)
  })

  it('adds a relative phase with S without changing probabilities', () => {
    const state = simulateCircuit(1, [
      { type: 'h', qubit: 0 },
      { type: 's', qubit: 0 },
    ])
    expect(state.probabilities[0]).toBeCloseTo(0.5, 12)
    expect(state.probabilities[1]).toBeCloseTo(0.5, 12)
    expect(state.amplitudes[1].re).toBeCloseTo(0, 12)
    expect(state.amplitudes[1].im).toBeCloseTo(Math.SQRT1_2, 12)
  })

  it('turns |0> into |1> with Ry(π)', () => {
    const state = simulateCircuit(1, [rotate('ry', 0, Math.PI)])
    expect(state.probabilities[0]).toBeCloseTo(0, 12)
    expect(state.probabilities[1]).toBeCloseTo(1, 12)
  })

  it('applies a −1 relative phase with Rz(π) after H', () => {
    const state = simulateCircuit(1, [{ type: 'h', qubit: 0 }, rotate('rz', 0, Math.PI)])
    const ratioRe =
      (state.amplitudes[1].re * state.amplitudes[0].re + state.amplitudes[1].im * state.amplitudes[0].im) /
      (state.amplitudes[0].re ** 2 + state.amplitudes[0].im ** 2)
    expect(ratioRe).toBeCloseTo(-1, 12)
  })

  it('keeps the state normalised through a long sequence', () => {
    const state = simulateCircuit(3, [
      { type: 'h', qubit: 0 },
      { type: 'h', qubit: 1 },
      { type: 't', qubit: 2 },
      rotate('rx', 1, 0.7),
      { type: 'cnot', control: 0, target: 2 },
      rotate('rz', 0, 1.1),
      { type: 'cz', control: 2, target: 1 },
    ])
    const total = state.probabilities.reduce((sum, value) => sum + value, 0)
    expect(total).toBeCloseTo(1, 12)
  })
})

describe('two-qubit gates', () => {
  it('builds the Bell state with a Hadamard and a CNOT', () => {
    const state = simulateCircuit(2, [
      { type: 'h', qubit: 0 },
      { type: 'cnot', control: 0, target: 1 },
    ])
    expect(state.basisLabels).toEqual(['00', '01', '10', '11'])
    expect(state.probabilities[0]).toBeCloseTo(0.5, 12)
    expect(state.probabilities[1]).toBeCloseTo(0, 12)
    expect(state.probabilities[2]).toBeCloseTo(0, 12)
    expect(state.probabilities[3]).toBeCloseTo(0.5, 12)
    expect(qubitProbabilities(state)[0]).toBeCloseTo(0.5, 12)
    expect(qubitProbabilities(state)[1]).toBeCloseTo(0.5, 12)
    expect(expectationPauliZ(state, 0)).toBeCloseTo(0, 12)
  })

  it('uses qubit 0 as the leftmost basis bit', () => {
    const state = simulateCircuit(2, [{ type: 'x', qubit: 0 }])
    expect(state.probabilities[2]).toBe(1)
    expect(state.basisLabels[2]).toBe('10')
  })

  it('only flips the target when the control is one', () => {
    const armed = simulateCircuit(2, [
      { type: 'x', qubit: 0 },
      { type: 'cnot', control: 1, target: 0 },
    ])
    expect(armed.basisLabels[2]).toBe('10')
    expect(armed.probabilities[2]).toBeCloseTo(1, 12)

    const unarmed = simulateCircuit(2, [{ type: 'cnot', control: 1, target: 0 }])
    expect(unarmed.probabilities[0]).toBeCloseTo(1, 12)
  })

  it('swaps two qubits', () => {
    const state = simulateCircuit(2, [
      { type: 'x', qubit: 1 },
      { type: 'swap', control: 0, target: 1 },
    ])
    expect(state.probabilities[2]).toBeCloseTo(1, 12)
  })

  it('leaves the state unchanged when the control of CZ is zero', () => {
    const state = simulateCircuit(2, [
      { type: 'h', qubit: 1 },
      { type: 'cz', control: 0, target: 1 },
    ])
    expect(state.probabilities[0]).toBeCloseTo(0.5, 12)
    expect(state.probabilities[1]).toBeCloseTo(0.5, 12)
    expect(qubitProbabilityOne(state, 0)).toBe(0)
  })
})

describe('measurement', () => {
  it('draws only the two Bell outcomes', () => {
    const state = simulateCircuit(2, [
      { type: 'h', qubit: 0 },
      { type: 'cnot', control: 0, target: 1 },
    ])
    const first = measureState(state, () => 0.1)
    expect(first.label).toBe('00')
    expect(first.bits).toEqual([0, 0])
    const second = measureState(state, () => 0.75)
    expect(second.label).toBe('11')
    expect(second.bits).toEqual([1, 1])
  })

  it('aggregates shots into frequencies that sum to one', () => {
    const state = simulateCircuit(2, [
      { type: 'h', qubit: 0 },
      { type: 'cnot', control: 0, target: 1 },
    ])
    const counts = sampleCounts(state, 1000, seeded(7))
    expect(counts.total).toBe(1000)
    expect(counts.outcomes).toHaveLength(2)
    const labels = counts.outcomes.map((outcome) => outcome.label).sort()
    expect(labels).toEqual(['00', '11'])
    const total = counts.outcomes.reduce((sum, outcome) => sum + outcome.count, 0)
    expect(total).toBe(1000)
    for (const outcome of counts.outcomes) {
      expect(outcome.frequency).toBeCloseTo(outcome.count / 1000, 12)
      expect(outcome.frequency).toBeGreaterThan(0.4)
      expect(outcome.frequency).toBeLessThan(0.6)
    }
  })

  it('does not mutate the state when sampling', () => {
    const state = simulateCircuit(1, [{ type: 'h', qubit: 0 }])
    sampleCounts(state, 50, seeded(3))
    expect(state.probabilities[0]).toBeCloseTo(0.5, 12)
    expect(state.probabilities[1]).toBeCloseTo(0.5, 12)
  })
})

describe('validation', () => {
  it('refuses an impossible qubit count', () => {
    expect(() => simulateCircuit(0, [])).toThrow(/1 to 12/)
    expect(() => simulateCircuit(MAX_QUBITS + 1, [])).toThrow(/1 to 12/)
  })

  it('supports the documented maximum and reports its size', () => {
    const state = simulateCircuit(MAX_QUBITS, [{ type: 'h', qubit: MAX_QUBITS - 1 }])
    expect(state.amplitudes).toHaveLength(2 ** MAX_QUBITS)
    expect(state.probabilities.reduce((sum, value) => sum + value, 0)).toBeCloseTo(1, 10)
  })

  it('refuses out-of-range qubits', () => {
    expect(() => simulateCircuit(2, [{ type: 'h', qubit: 2 }])).toThrow(/outside 0\.\.1/)
    expect(() => simulateCircuit(2, [{ type: 'cnot', control: 0, target: -1 }])).toThrow(/outside 0\.\.1/)
  })

  it('refuses a controlled gate with one qubit used twice', () => {
    expect(() => simulateCircuit(2, [{ type: 'cnot', control: 1, target: 1 }])).toThrow(/distinct/)
  })

  it('refuses a rotation with no finite angle', () => {
    expect(() => simulateCircuit(1, [{ type: 'rx', qubit: 0 }])).toThrow(/finite rotation angle/)
    expect(() => simulateCircuit(1, [{ type: 'rz', qubit: 0, angle: Number.NaN }])).toThrow(/finite rotation angle/)
  })

  it('refuses unknown gates and bad sampling arguments', () => {
    expect(() => simulateCircuit(1, [{ type: 'fredkin' } as unknown as QuantumGate])).toThrow(/unknown gate/)
    const state = simulateCircuit(1, [{ type: 'h', qubit: 0 }])
    expect(() => qubitProbabilityOne(state, 1)).toThrow(/outside 0\.\.0/)
    expect(() => sampleCounts(state, 0)).toThrow(/shot count/)
    expect(() => measureState(state, () => 1)).toThrow(/\[0, 1\)/)
  })
})
