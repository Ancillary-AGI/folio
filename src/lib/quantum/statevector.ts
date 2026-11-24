/**
 * Small statevector quantum-circuit simulator.
 *
 * Exact unitary evolution of up to 12 qubits (4096 amplitudes) with the gate
 * set a first quantum-algorithms course needs. Qubit 0 is the leftmost bit of
 * the basis label, so `|10>` means qubit 0 is 1 and qubit 1 is 0.
 *
 * Scope, stated plainly: this is a pure-state simulator with no noise, no
 * density matrices, no mid-circuit measurement and no hardware calibration. A
 * measurement collapses a *sampled copy*; the state is not mutated, so repeated
 * shots draw from the same distribution. Sampling is the one stochastic step and
 * takes an injectable random source so tests can pin it.
 */

export interface ComplexAmplitude {
  re: number
  im: number
}

export type SingleQubitGate = 'h' | 'x' | 'y' | 'z' | 's' | 't' | 'rx' | 'ry' | 'rz'
export type TwoQubitGate = 'cnot' | 'cz' | 'swap'
export type QuantumGateType = SingleQubitGate | TwoQubitGate

export interface QuantumGate {
  type: QuantumGateType
  /** Target (or only) qubit for a single-qubit gate. */
  qubit?: number
  /** Control qubit for a controlled gate. */
  control?: number
  /** Target qubit for a controlled gate or SWAP. */
  target?: number
  /** Rotation angle in radians for rx/ry/rz. */
  angle?: number
}

export interface QuantumState {
  numQubits: number
  /** `2^numQubits` amplitudes in computational-basis order. */
  amplitudes: ComplexAmplitude[]
  /** |amplitude|², normalised to double precision. */
  probabilities: number[]
  /** Basis labels, qubit 0 leftmost, e.g. `|01>`. */
  basisLabels: string[]
}

export interface MeasurementOutcome {
  /** Bit value per qubit, index 0 = qubit 0. */
  bits: number[]
  /** Index into the state's amplitude array. */
  index: number
  label: string
  /** Probability the simulator assigned to this outcome. */
  probability: number
}

export interface MeasurementCount {
  label: string
  bits: number[]
  count: number
  frequency: number
}

export interface MeasurementCounts {
  total: number
  outcomes: MeasurementCount[]
}

export const MAX_QUBITS = 12

type Matrix2 = [[ComplexAmplitude, ComplexAmplitude], [ComplexAmplitude, ComplexAmplitude]]

const complex = (re: number, im = 0): ComplexAmplitude => ({ re, im })

const multiply = (a: ComplexAmplitude, b: ComplexAmplitude): ComplexAmplitude => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})

const add = (a: ComplexAmplitude, b: ComplexAmplitude): ComplexAmplitude => ({
  re: a.re + b.re,
  im: a.im + b.im,
})

const negate = (a: ComplexAmplitude): ComplexAmplitude => ({ re: -a.re, im: -a.im })

function assertQubit(value: number | undefined, numQubits: number, gateIndex: number, role: string): number {
  if (!Number.isInteger(value) || (value as number) < 0 || (value as number) >= numQubits) {
    throw new Error(
      `Quantum: gate ${gateIndex + 1} names ${role} ${String(value)}, outside 0..${numQubits - 1}.`,
    )
  }
  return value as number
}

function assertAngle(gate: QuantumGate, gateIndex: number): number {
  if (gate.angle === undefined || !Number.isFinite(gate.angle)) {
    throw new Error(`Quantum: gate ${gateIndex + 1} (${gate.type}) needs a finite rotation angle.`)
  }
  return gate.angle
}

function singleQubitMatrix(gate: QuantumGate, gateIndex: number): Matrix2 {
  const s = Math.SQRT1_2
  switch (gate.type) {
    case 'h':
      return [
        [complex(s), complex(s)],
        [complex(s), complex(-s)],
      ]
    case 'x':
      return [
        [complex(0), complex(1)],
        [complex(1), complex(0)],
      ]
    case 'y':
      return [
        [complex(0), complex(0, -1)],
        [complex(0, 1), complex(0)],
      ]
    case 'z':
      return [
        [complex(1), complex(0)],
        [complex(0), complex(-1)],
      ]
    case 's':
      return [
        [complex(1), complex(0)],
        [complex(0), complex(0, 1)],
      ]
    case 't':
      return [
        [complex(1), complex(0)],
        [complex(0), complex(Math.SQRT1_2, Math.SQRT1_2)],
      ]
    case 'rx': {
      const angle = assertAngle(gate, gateIndex) / 2
      const c = Math.cos(angle)
      const s2 = Math.sin(angle)
      return [
        [complex(c), complex(0, -s2)],
        [complex(0, -s2), complex(c)],
      ]
    }
    case 'ry': {
      const angle = assertAngle(gate, gateIndex) / 2
      const c = Math.cos(angle)
      const s2 = Math.sin(angle)
      return [
        [complex(c), complex(-s2)],
        [complex(s2), complex(c)],
      ]
    }
    case 'rz': {
      const angle = assertAngle(gate, gateIndex) / 2
      return [
        [complex(Math.cos(-angle), Math.sin(-angle)), complex(0)],
        [complex(0), complex(Math.cos(angle), Math.sin(angle))],
      ]
    }
    default:
      throw new Error(`Quantum: ${gate.type} is not a single-qubit gate.`)
  }
}

function applySingleQubit(amplitudes: ComplexAmplitude[], matrix: Matrix2, qubit: number, numQubits: number): void {
  const mask = 1 << (numQubits - 1 - qubit)
  for (let index = 0; index < amplitudes.length; index += 1) {
    if (index & mask) continue
    const paired = index | mask
    const zero = amplitudes[index]
    const one = amplitudes[paired]
    amplitudes[index] = add(multiply(matrix[0][0], zero), multiply(matrix[0][1], one))
    amplitudes[paired] = add(multiply(matrix[1][0], zero), multiply(matrix[1][1], one))
  }
}

/** Simulate a gate list and return the final state. Throws on an invalid circuit. */
export function simulateCircuit(numQubits: number, gates: readonly QuantumGate[]): QuantumState {
  if (!Number.isInteger(numQubits) || numQubits < 1 || numQubits > MAX_QUBITS) {
    throw new Error(`Quantum: qubit count must be an integer from 1 to ${MAX_QUBITS}.`)
  }

  const dimension = 1 << numQubits
  const amplitudes: ComplexAmplitude[] = Array.from({ length: dimension }, (_, index) =>
    index === 0 ? complex(1) : complex(0),
  )

  gates.forEach((gate, gateIndex) => {
    if (
      gate.type === 'h' ||
      gate.type === 'x' ||
      gate.type === 'y' ||
      gate.type === 'z' ||
      gate.type === 's' ||
      gate.type === 't' ||
      gate.type === 'rx' ||
      gate.type === 'ry' ||
      gate.type === 'rz'
    ) {
      const qubit = assertQubit(gate.qubit, numQubits, gateIndex, 'qubit')
      applySingleQubit(amplitudes, singleQubitMatrix(gate, gateIndex), qubit, numQubits)
      return
    }

    if (gate.type === 'cnot' || gate.type === 'cz' || gate.type === 'swap') {
      const first = assertQubit(gate.control, numQubits, gateIndex, 'control')
      const second = assertQubit(gate.target, numQubits, gateIndex, 'target')
      if (first === second) throw new Error(`Quantum: gate ${gateIndex + 1} needs distinct control and target qubits.`)
      const firstMask = 1 << (numQubits - 1 - first)
      const secondMask = 1 << (numQubits - 1 - second)
      for (let index = 0; index < dimension; index += 1) {
        if (gate.type === 'swap') {
          if (index & firstMask || !(index & secondMask)) continue
          const partner = index ^ firstMask ^ secondMask
          const held = amplitudes[index]
          amplitudes[index] = amplitudes[partner]
          amplitudes[partner] = held
        } else if (index & firstMask && index & secondMask) {
          if (gate.type === 'cz') amplitudes[index] = negate(amplitudes[index])
        } else if (gate.type === 'cnot' && index & firstMask && !(index & secondMask)) {
          const partner = index | secondMask
          const held = amplitudes[index]
          amplitudes[index] = amplitudes[partner]
          amplitudes[partner] = held
        }
      }
      return
    }

    throw new Error(`Quantum: unknown gate type "${String((gate as QuantumGate).type)}".`)
  })

  const probabilities = amplitudes.map((amplitude) => amplitude.re ** 2 + amplitude.im ** 2)
  const total = probabilities.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || Math.abs(total - 1) > 1e-9) {
    throw new Error('Quantum: the simulated state lost normalisation; the circuit is not unitary.')
  }

  return {
    numQubits,
    amplitudes,
    probabilities,
    basisLabels: probabilities.map((_, index) => index.toString(2).padStart(numQubits, '0')),
  }
}

/** Probability that `qubit` reads 1, marginalised over every other qubit. */
export function qubitProbabilityOne(state: QuantumState, qubit: number): number {
  if (!Number.isInteger(qubit) || qubit < 0 || qubit >= state.numQubits) {
    throw new Error(`Quantum: qubit ${qubit} is outside 0..${state.numQubits - 1}.`)
  }
  const mask = 1 << (state.numQubits - 1 - qubit)
  let probability = 0
  for (let index = 0; index < state.probabilities.length; index += 1) {
    if (index & mask) probability += state.probabilities[index]
  }
  return probability
}

/** All per-qubit P(1) values. */
export function qubitProbabilities(state: QuantumState): number[] {
  return Array.from({ length: state.numQubits }, (_, qubit) => qubitProbabilityOne(state, qubit))
}

/** ⟨Z⟩ on one qubit: +1 for a definite 0, −1 for a definite 1. */
export function expectationPauliZ(state: QuantumState, qubit: number): number {
  return 1 - 2 * qubitProbabilityOne(state, qubit)
}

function bitsOf(index: number, numQubits: number): number[] {
  return Array.from({ length: numQubits }, (_, qubit) => (index >> (numQubits - 1 - qubit)) & 1)
}

/**
 * Draw one computational-basis outcome from the state distribution.
 *
 * `random` must return a number in [0, 1); tests pass a seeded generator. The
 * state itself is untouched.
 */
export function measureState(state: QuantumState, random: () => number = Math.random): MeasurementOutcome {
  const draw = random()
  if (!Number.isFinite(draw) || draw < 0 || draw >= 1) {
    throw new Error('Quantum: the random source must return a value in [0, 1).')
  }
  let cumulative = 0
  let chosen = -1
  for (let index = 0; index < state.probabilities.length; index += 1) {
    cumulative += state.probabilities[index]
    if (draw < cumulative) {
      chosen = index
      break
    }
  }
  if (chosen < 0) {
    // Floating-point rounding can leave the cumulative sum a hair below 1.
    for (let index = state.probabilities.length - 1; index >= 0; index -= 1) {
      if (state.probabilities[index] > 0) {
        chosen = index
        break
      }
    }
  }
  return {
    bits: bitsOf(chosen, state.numQubits),
    index: chosen,
    label: state.basisLabels[chosen],
    probability: state.probabilities[chosen],
  }
}

/** Sample `shots` outcomes and aggregate them, most frequent first. */
export function sampleCounts(
  state: QuantumState,
  shots: number,
  random: () => number = Math.random,
): MeasurementCounts {
  if (!Number.isInteger(shots) || shots < 1 || shots > 10_000_000) {
    throw new Error('Quantum: shot count must be an integer from 1 to 10,000,000.')
  }
  const tally = new Map<number, number>()
  for (let shot = 0; shot < shots; shot += 1) {
    const outcome = measureState(state, random)
    tally.set(outcome.index, (tally.get(outcome.index) ?? 0) + 1)
  }
  const outcomes = Array.from(tally.entries())
    .map(([index, count]) => ({
      label: state.basisLabels[index],
      bits: bitsOf(index, state.numQubits),
      count,
      frequency: count / shots,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  return { total: shots, outcomes }
}
