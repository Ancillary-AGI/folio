import { describe, expect, it } from 'vitest'

import {
  CIRCUIT_PRESETS,
  analyseCircuit,
  circuitStabilityAt,
  circuitSteadyState,
  detectOscillation,
  fullConcentrations,
  geneticCircuitDerivative,
  geneticCircuitJacobian,
  hillResponseCurve,
  presetCircuit,
  promoterActivity,
  promoterFoldChange,
  resolveCircuit,
  simulateGeneticCircuit,
  stateConcentrations,
  type GeneticCircuit,
} from './geneticCircuit'

/** One unregulated gene: the only circuit with an exact answer for every trajectory. */
function constitutive(maxProduction: number, degradationPerTime: number): GeneticCircuit {
  return { species: [{ id: 'P', maxProduction, degradationPerTime }], edges: [] }
}

/** A repressor on its own promoter (Rosenfeld et al.'s negative autoregulation). */
function autoregulated(maxProduction: number, hill = 2, threshold = 1): GeneticCircuit {
  return {
    species: [{ id: 'R', maxProduction, degradationPerTime: 1, leakFraction: 0 }],
    edges: [{ from: 'R', to: 'R', kind: 'repress', threshold, hill }],
  }
}

function toggle(maxProduction: number, leakFraction = 0.001): GeneticCircuit {
  return {
    species: [
      { id: 'A', maxProduction, degradationPerTime: 1, leakFraction },
      { id: 'B', maxProduction, degradationPerTime: 1, leakFraction },
    ],
    edges: [
      { from: 'B', to: 'A', kind: 'repress', threshold: 1, hill: 2 },
      { from: 'A', to: 'B', kind: 'repress', threshold: 1, hill: 2 },
    ],
  }
}

function repressilator(hillCoefficient: number, maxProduction = 20): GeneticCircuit {
  const ids = ['tetR', 'cI', 'lacI']
  return {
    species: ids.map((id) => ({ id, maxProduction, degradationPerTime: 1, leakFraction: 0 })),
    edges: ids.map((id, index) => ({
      from: id,
      to: ids[(index + 1) % ids.length],
      kind: 'repress' as const,
      threshold: 1,
      hill: hillCoefficient,
    })),
  }
}

/** The time at which species `index` first reaches `fraction` of its final value. */
function riseTime(circuit: GeneticCircuit, index: number, fraction: number): number {
  const samples = simulateGeneticCircuit(circuit, [0, 0, 0].slice(0, circuit.species.length), { tEnd: 120, dt: 0.01 })
  const final = samples[samples.length - 1].concentrations[index]
  for (const sample of samples) if (sample.concentrations[index] >= final * fraction) return sample.time
  return Number.POSITIVE_INFINITY
}

describe('circuit resolution', () => {
  it('keeps clamped species out of the state vector but in every reported trace', () => {
    const circuit: GeneticCircuit = {
      species: [
        { id: 'X', maxProduction: 0, degradationPerTime: 1, fixedAt: 4 },
        { id: 'Y', maxProduction: 2, degradationPerTime: 1 },
      ],
      edges: [{ from: 'X', to: 'Y', kind: 'activate', threshold: 1, hill: 1 }],
    }
    const resolved = resolveCircuit(circuit)
    expect(resolved.dynamic).toEqual([1])
    expect(resolved.stateIndex).toEqual([-1, 0])
    const full = fullConcentrations(resolved, [1.5])
    expect(full).toEqual([4, 1.5])
    expect(stateConcentrations(resolved, full)).toEqual([1.5])

    const samples = simulateGeneticCircuit(circuit, [0], { tEnd: 40, dt: 0.1 })
    expect(samples.every((sample) => sample.concentrations[0] === 4)).toBe(true)
    // Held at X = 4 through a Hill-1 activator, so dY/dt = 2·(4/5) − Y exactly.
    expect(samples[samples.length - 1].concentrations[1]).toBeCloseTo(1.6, 10)
  })

  it('accepts either a full-length or an integrated-only initial condition', () => {
    const circuit: GeneticCircuit = {
      species: [
        { id: 'X', maxProduction: 0, degradationPerTime: 1, fixedAt: 4 },
        { id: 'Y', maxProduction: 2, degradationPerTime: 1 },
      ],
      edges: [],
    }
    const fromFull = simulateGeneticCircuit(circuit, [99, 0.25], { tEnd: 1, dt: 0.1 })
    const fromState = simulateGeneticCircuit(circuit, [0.25], { tEnd: 1, dt: 0.1 })
    expect(fromFull[fromFull.length - 1].concentrations[1]).toBeCloseTo(
      fromState[fromState.length - 1].concentrations[1],
      12,
    )
    expect(() => simulateGeneticCircuit(circuit, [0.25, 0.25, 0.25], { tEnd: 1, dt: 0.1 })).toThrow(
      /Initial condition has 3 values/,
    )
  })

  it('refuses a circuit it cannot interpret', () => {
    const cases: [GeneticCircuit, RegExp][] = [
      [{ species: [], edges: [] }, /at least one species/],
      [{ species: [{ id: 'A', maxProduction: 1, degradationPerTime: 1 }, { id: 'A', maxProduction: 1, degradationPerTime: 1 }], edges: [] }, /appears twice/],
      [{ species: [{ id: '', maxProduction: 1, degradationPerTime: 1 }], edges: [] }, /needs an id/],
      [{ species: [{ id: 'A', maxProduction: -1, degradationPerTime: 1 }], edges: [] }, /Production rate of A/],
      [{ species: [{ id: 'A', maxProduction: 1, degradationPerTime: 0 }], edges: [] }, /Degradation rate of A/],
      [{ species: [{ id: 'A', maxProduction: 1, degradationPerTime: 1, leakFraction: 1.5 }], edges: [] }, /Leak fraction of A/],
      [{ species: [{ id: 'A', maxProduction: 1, degradationPerTime: 1 }], edges: [{ from: 'ghost', to: 'A', kind: 'repress', threshold: 1, hill: 1 }] }, /Edge source "ghost"/],
      [{ species: [{ id: 'A', maxProduction: 1, degradationPerTime: 1 }], edges: [{ from: 'A', to: 'ghost', kind: 'repress', threshold: 1, hill: 1 }] }, /Edge target "ghost"/],
      [{ species: [{ id: 'A', maxProduction: 1, degradationPerTime: 1 }], edges: [{ from: 'A', to: 'A', kind: 'repress', threshold: 0, hill: 1 }] }, /Threshold of edge A→A/],
      [{ species: [{ id: 'A', maxProduction: 1, degradationPerTime: 1 }], edges: [{ from: 'A', to: 'A', kind: 'repress', threshold: 1, hill: 0 }] }, /Hill coefficient of edge A→A/],
      [{ species: [{ id: 'A', maxProduction: 1, degradationPerTime: 1 }], edges: [{ from: 'A', to: 'A', kind: 'degrade' as 'repress', threshold: 1, hill: 1 }] }, /neither repression nor activation/],
      [{ species: [{ id: 'A', maxProduction: 1, degradationPerTime: 1, fixedAt: 2 }], edges: [] }, /nothing to simulate/],
    ]
    for (const [circuit, message] of cases) expect(() => resolveCircuit(circuit)).toThrow(message)
  })

  it('rejects a negative initial concentration instead of integrating a meaningless one', () => {
    expect(() => simulateGeneticCircuit(autoregulated(8), [-0.1], { tEnd: 10, dt: 0.1 })).toThrow(/non-negative/)
  })
})

describe('gene dynamics', () => {
  it('reproduces the exponential charging of a constitutive gene', () => {
    // dC/dt = α − δC has C(t) = (α/δ)(1 − e^−δt). Nothing about the model is
    // empirical here, so the trace either matches or the integrator is wrong.
    const alpha = 2
    const delta = 0.5
    const samples = simulateGeneticCircuit(constitutive(alpha, delta), [0], { tEnd: 20, dt: 1 })
    for (const sample of samples) {
      const expected = (alpha / delta) * (1 - Math.exp(-delta * sample.time))
      expect(sample.concentrations[0]).toBeCloseTo(expected, 6)
    }
    // τ = 1/δ = 2 time units, and the reporting step lands exactly on it.
    const atTau = samples.find((sample) => Math.abs(sample.time - 1 / delta) < 1e-6)
    expect(atTau?.concentrations[0]).toBeCloseTo((alpha / delta) * (1 - Math.exp(-1)), 6)
  })

  it('never drives a concentration negative from a zero start', () => {
    for (const circuit of [autoregulated(8), toggle(4), repressilator(3), presetCircuit('incoherent-feedforward').circuit]) {
      const samples = simulateGeneticCircuit(circuit, circuit.species.map(() => 0), { tEnd: 50, dt: 0.05 })
      const lowest = Math.min(...samples.flatMap((sample) => sample.concentrations))
      expect(lowest).toBeGreaterThan(-1e-12)
      expect(samples.every((sample) => sample.concentrations.every(Number.isFinite))).toBe(true)
    }
  })

  it('multiplies independent promoters rather than averaging them', () => {
    const circuit: GeneticCircuit = {
      species: [
        { id: 'P', maxProduction: 1, degradationPerTime: 1 },
        { id: 'R1', maxProduction: 0, degradationPerTime: 1, fixedAt: 1 },
        { id: 'R2', maxProduction: 0, degradationPerTime: 1, fixedAt: 1 },
      ],
      edges: [
        { from: 'R1', to: 'P', kind: 'repress', threshold: 1, hill: 1 },
        { from: 'R2', to: 'P', kind: 'repress', threshold: 1, hill: 1 },
      ],
    }
    const resolved = resolveCircuit(circuit)
    // Two repressors each at their own K halve the promoter twice.
    expect(promoterActivity(resolved, 0, [0, 1, 1])).toBeCloseTo(0.25, 12)
    expect(promoterActivity(resolved, 0, [0, 0, 1])).toBeCloseTo(0.5, 12)
    expect(promoterActivity(resolved, 0, [0, 0, 0])).toBe(1)
  })
})

describe('negative autoregulation', () => {
  it('solves its own fixed-point equation at the steady state', () => {
    // C = α/(1 + C²) is the whole model at rest; rearranged, C(1 + C²) = α.
    for (const alpha of [4, 8, 20]) {
      const steady = circuitSteadyState(autoregulated(alpha), [0], { tEnd: 60, dt: 0.05 })
      expect(steady.converged).toBe(true)
      const concentration = steady.concentrations[0]
      expect(concentration * (1 + concentration ** 2)).toBeCloseTo(alpha, 8)
    }
  })

  it('reaches the same level faster than the unregulated gene', () => {
    // This is the design claim for NAR (Rosenfeld 2002), so it is checked at a
    // matched steady state: α_NAR = δ·C_ss·(1 + (C_ss/K)^n) puts both at C_ss = 2.
    const plain = constitutive(2, 1)
    const nar = autoregulated(10)
    for (const fraction of [0.5, 0.9, 0.99]) {
      expect(riseTime(nar, 0, fraction)).toBeLessThan(riseTime(plain, 0, fraction))
    }
    expect(circuitSteadyState(nar, [0], { tEnd: 60, dt: 0.05 }).concentrations[0]).toBeCloseTo(
      circuitSteadyState(plain, [0], { tEnd: 60, dt: 0.05 }).concentrations[0],
      8,
    )
  })

  it('settles faster the stronger the feedback, at a matched steady state', () => {
    // C_ss = 2, δ = 1 for every Hill slope, and α = δ·C_ss·(1 + (C_ss/K)^n) keeps
    // the fixed point put there while the slope of the repression changes.
    const times = [1, 2, 4].map((hill) => riseTime(autoregulated(2 * (1 + 2 ** hill), hill), 0, 0.9))
    for (const time of times) expect(Number.isFinite(time)).toBe(true)
    expect(times[1]).toBeLessThan(times[0])
  })
})

describe('toggle switch', () => {
  it('stores a bit: two settled states, mirror images of each other', () => {
    const circuit = toggle(4)
    const highA = circuitSteadyState(circuit, [3, 0.2], { tEnd: 200, dt: 0.05 })
    const highB = circuitSteadyState(circuit, [0.2, 3], { tEnd: 200, dt: 0.05 })
    expect(highA.converged).toBe(true)
    expect(highB.converged).toBe(true)
    expect(highA.concentrations[0]).toBeGreaterThan(3)
    expect(highA.concentrations[1]).toBeLessThan(0.5)
    // Symmetric design ⇒ mirrored answer.
    expect(highA.concentrations[0]).toBeCloseTo(highB.concentrations[1], 8)
    expect(highA.concentrations[1]).toBeCloseTo(highB.concentrations[0], 8)
    expect(circuitStabilityAt(circuit, highA.concentrations).kind).toBe('stable')
    expect(circuitStabilityAt(circuit, highB.concentrations).kind).toBe('stable')
  })

  it('puts an unstable saddle between the two states', () => {
    // The midpoint is where the memory has to be overwritten, so its instability
    // is what makes the switch writable — and it is a property of the linearised
    // model, not of a trajectory.
    const circuit = toggle(4)
    const symmetric = circuitSteadyState(circuit, [1, 1], { tEnd: 200, dt: 0.05 })
    expect(symmetric.converged).toBe(true)
    expect(symmetric.concentrations[0]).toBeCloseTo(symmetric.concentrations[1], 10)
    const verdict = circuitStabilityAt(circuit, symmetric.concentrations)
    expect(verdict.kind).toBe('unstable')
    expect(verdict.margin).toBeGreaterThan(0.1)
  })

  it('is monostable when the repression is too weak to hold a state', () => {
    // Below the bistability onset the two wells merge into one, so a design with
    // weak promoters is not a memory even if it is drawn like one.
    const symmetric = circuitSteadyState(toggle(2), [1, 1], { tEnd: 200, dt: 0.05 })
    expect(symmetric.concentrations[0]).toBeCloseTo(symmetric.concentrations[1], 10)
    expect(circuitStabilityAt(toggle(2), symmetric.concentrations).kind).toBe('stable')
  })
})

describe('repressilator', () => {
  it('does not oscillate at Hill 2, however hard the promoters are pushed', () => {
    // The deterministic model damps. What separates this from an oscillator is the
    // trend, not the size of the swing: at α = 1000 the trace is still moving by
    // 8 % of its own level late in the run, which is over the detector's floor, yet
    // it is unmistakably dying. Cooperativity, not expression level, is the knob —
    // and the original circuit kept time because gene expression is noisy, which
    // this model does not have.
    for (const alpha of [20, 200, 1000]) {
      const report = detectOscillation(simulateGeneticCircuit(repressilator(2, alpha), [1, 0.2, 0.2], { tEnd: 600, dt: 0.1 }))
      expect(report.oscillates).toBe(false)
      expect(report.amplitudeTrend).toBeLessThan(0.5)
      if (alpha === 1000) expect(report.relativeAmplitude).toBeGreaterThan(0.02)
    }
  })

  it('beats once the repression is cooperative enough', () => {
    const weak = detectOscillation(simulateGeneticCircuit(repressilator(2.2), [1, 0.2, 0.2], { tEnd: 600, dt: 0.1 }))
    expect(weak.oscillates).toBe(false)
    const strong = detectOscillation(simulateGeneticCircuit(repressilator(2.4), [1, 0.2, 0.2], { tEnd: 600, dt: 0.1 }))
    expect(strong.oscillates).toBe(true)
    expect(strong.period).not.toBeNull()
    // Onset between 2.2 and 2.4 at α = 20, measured — not quoted.
    expect(strong.amplitudeTrend).toBeGreaterThan(0.9)
    expect(strong.relativeAmplitude).toBeGreaterThan(0.5)
  })

  it('lengthens the period as the Hill slope steepens past the onset', () => {
    const periods = [2.4, 2.8, 3].map((hill) => {
      const report = detectOscillation(simulateGeneticCircuit(repressilator(hill), [1, 0.2, 0.2], { tEnd: 600, dt: 0.1 }))
      expect(report.oscillates).toBe(true)
      return report.period as number
    })
    for (let i = 1; i < periods.length; i += 1) expect(periods[i]).toBeGreaterThan(periods[i - 1])
  })

  it('reports a limit cycle as not settled, in so many words', () => {
    const steady = circuitSteadyState(repressilator(3), [1, 0.2, 0.2], { tEnd: 200, dt: 0.1 })
    expect(steady.converged).toBe(false)
    expect(steady.note).toMatch(/Not settled/)
    expect(steady.residual).toBeGreaterThan(0)
  })

  it('says the three phases are the same cycle shifted along time', () => {
    const samples = simulateGeneticCircuit(repressilator(3), [1, 0.2, 0.2], { tEnd: 600, dt: 0.1 })
    const report = detectOscillation(samples)
    const period = report.period as number
    const tail = samples.slice(Math.floor(samples.length * 0.5))
    // Each species peaks once per period, and the peak levels are equal by symmetry.
    const peaksPerSpecies = tail[0].concentrations.map((_, index) => {
      const values = tail.map((sample) => sample.concentrations[index])
      return Math.max(...values)
    })
    for (const peak of peaksPerSpecies) expect(peak).toBeGreaterThan(1)
    expect(Math.max(...peaksPerSpecies) - Math.min(...peaksPerSpecies)).toBeLessThan(0.05)
    expect(period).toBeGreaterThan(4)
    expect(period).toBeLessThan(12)
  })
})

describe('oscillation detector', () => {
  const trace = (values: number[]): { time: number; concentrations: number[] }[] =>
    values.map((value, index) => ({ time: index * 0.1, concentrations: [value] }))

  it('does not mistake a monotone relaxation for a rhythm', () => {
    const samples = trace(Array.from({ length: 400 }, (_, i) => 1 - Math.exp(-i / 40)))
    const report = detectOscillation(samples)
    expect(report.oscillates).toBe(false)
    expect(report.peaks).toBe(0)
  })

  it('does not mistake a damped spiral for a rhythm', () => {
    const samples = trace(Array.from({ length: 900 }, (_, i) => 2 + Math.exp(-i / 150) * Math.sin(i / 9)))
    const report = detectOscillation(samples)
    expect(report.oscillates).toBe(false)
    expect(report.amplitudeTrend).toBeLessThan(0.5)
  })

  it('counts a steady sine and gets its period right', () => {
    const cyclesPerSample = 0.05
    const samples = trace(Array.from({ length: 900 }, (_, i) => 3 + Math.sin(2 * Math.PI * cyclesPerSample * i)))
    const report = detectOscillation(samples)
    expect(report.oscillates).toBe(true)
    // One cycle is 1/0.05 = 20 samples, and a sample is 0.1 of time, so the period
    // is 2.0. Peak times are quantised to the reporting step, so the estimate is
    // judged to within one step rather than exactly.
    expect(report.period).not.toBeNull()
    expect(Math.abs((report.period as number) - 2)).toBeLessThan(0.1)
    expect(report.amplitude).toBeCloseTo(2, 1)
    expect(report.leadSpecies).toBe(0)
  })

  it('needs a window long enough to hold three cycles', () => {
    expect(detectOscillation(trace([1, 2, 1, 2, 1])).oscillates).toBe(false)
    expect(detectOscillation([]).oscillates).toBe(false)
    expect(() => detectOscillation(trace(Array.from({ length: 40 }, (_, i) => Math.sin(i))), { transientFraction: 1 })).toThrow(
      /Transient fraction/,
    )
  })

  it('lets a stricter deadband reject a noisier candidate', () => {
    const samples = trace(Array.from({ length: 900 }, (_, i) => 3 + 0.02 * Math.sin(2 * Math.PI * 0.05 * i)))
    expect(detectOscillation(samples, { minimumRelativeAmplitude: 0.001 }).oscillates).toBe(true)
    expect(detectOscillation(samples, { minimumRelativeAmplitude: 0.1 }).oscillates).toBe(false)
  })
})

describe('analytic Jacobian', () => {
  const finiteDifference = (circuit: GeneticCircuit, point: number[], h = 1e-6): number[][] => {
    const resolved = resolveCircuit(circuit)
    const derivative = geneticCircuitDerivative(resolved)
    const size = resolved.dynamic.length
    const columns: number[][] = []
    for (let column = 0; column < size; column += 1) {
      const up = [...point]
      const down = [...point]
      up[resolved.dynamic[column]] += h
      down[resolved.dynamic[column]] -= h
      const plus = derivative(0, stateConcentrations(resolved, up))
      const minus = derivative(0, stateConcentrations(resolved, down))
      columns.push(plus.map((value, row) => (value - minus[row]) / (2 * h)))
    }
    return Array.from({ length: size }, (_, row) => columns.map((column) => column[row]))
  }

  it('matches central differences entry by entry', () => {
    // A promoter with two dynamic inputs and one clamped input, plus a
    // self-loop — the shapes a hand-written derivative is most likely to get wrong.
    const circuit: GeneticCircuit = {
      species: [
        { id: 'X', maxProduction: 0, degradationPerTime: 1, fixedAt: 2.5 },
        { id: 'R1', maxProduction: 3, degradationPerTime: 1.3 },
        { id: 'R2', maxProduction: 2, degradationPerTime: 0.7, leakFraction: 0.05 },
        { id: 'P', maxProduction: 6, degradationPerTime: 1.1, leakFraction: 0.1 },
      ],
      edges: [
        { from: 'X', to: 'P', kind: 'activate', threshold: 1, hill: 2 },
        { from: 'R1', to: 'P', kind: 'repress', threshold: 0.8, hill: 2 },
        { from: 'R2', to: 'P', kind: 'repress', threshold: 1.5, hill: 3 },
        { from: 'R2', to: 'R2', kind: 'repress', threshold: 1, hill: 2 },
        { from: 'R1', to: 'R2', kind: 'activate', threshold: 1.2, hill: 1 },
      ],
    }
    const point = [2.5, 1.7, 0.9, 2.3]
    const analytic = geneticCircuitJacobian(circuit, point)
    const numeric = finiteDifference(circuit, point)
    expect(analytic).toHaveLength(3)
    for (let r = 0; r < analytic.length; r += 1) {
      for (let c = 0; c < analytic.length; c += 1) {
        const magnitude = Math.max(1, Math.abs(numeric[r][c]))
        expect(Math.abs(analytic[r][c] - numeric[r][c])).toBeLessThan(1e-5 * magnitude)
      }
    }
  })

  it('puts the clamped input in the denominator of the model but not in the matrix', () => {
    const circuit: GeneticCircuit = {
      species: [
        { id: 'X', maxProduction: 0, degradationPerTime: 1, fixedAt: 4 },
        { id: 'Y', maxProduction: 2, degradationPerTime: 1 },
      ],
      edges: [{ from: 'X', to: 'Y', kind: 'activate', threshold: 1, hill: 1 }],
    }
    expect(geneticCircuitJacobian(circuit, [4, 1])).toEqual([[-1]])
  })

  it('gives the constitutive gene the decay rate it advertises', () => {
    const verdict = circuitStabilityAt(constitutive(2, 0.5), [4])
    expect(verdict.kind).toBe('stable')
    expect(verdict.margin).toBeCloseTo(-0.5, 12)
    expect(verdict.spectrum.values).toHaveLength(1)
  })

  it('asks for one concentration per species', () => {
    expect(() => geneticCircuitJacobian(repressilator(3), [1, 1])).toThrow(/one concentration per species/)
  })
})

describe('promoter response curves', () => {
  it('places half-maximal activity at the threshold by construction', () => {
    // A curve from 0 to 2K in five points lands exactly on K, so the defining
    // property of the Hill function can be read off it instead of assumed.
    for (const kind of ['repress', 'activate'] as const) {
      const curve = hillResponseCurve({ kind, threshold: 2, hill: 3, points: 5, until: 4 })
      expect(curve.map((point) => point.concentration)).toEqual([0, 1, 2, 3, 4])
      expect(curve[2].activity).toBeCloseTo(0.5, 12)
      expect(curve[0].activity).toBe(kind === 'repress' ? 1 : 0)
      const far = curve[curve.length - 1]
      const factor = far.concentration ** 3 / (2 ** 3 + far.concentration ** 3)
      expect(far.activity).toBeCloseTo(kind === 'repress' ? 1 - factor : factor, 12)
      const monotone = curve.every(
        (point, index) => index === 0
          || (kind === 'repress' ? point.activity <= curve[index - 1].activity + 1e-12 : point.activity >= curve[index - 1].activity - 1e-12),
      )
      expect(monotone).toBe(true)
    }
  })

  it('lets leak set the floor and cap the fold-change', () => {
    const noLeak = promoterFoldChange({ kind: 'repress', threshold: 1, hill: 2, lowConcentration: 0, highConcentration: 10 })
    expect(noLeak.low).toBe(1)
    expect(noLeak.high).toBeCloseTo(1 / 101, 12)
    expect(noLeak.foldChange).toBeCloseTo(101, 8)
    const leaky = promoterFoldChange({ kind: 'repress', threshold: 1, hill: 2, leakFraction: 0.1, lowConcentration: 0, highConcentration: 10 })
    expect(leaky.low).toBeCloseTo(1, 12)
    // A 10 % leak floors the repressed side, so the usable range collapses from
    // 101-fold to about 9-fold: the number that decides whether a stage can drive
    // the next one.
    expect(leaky.high).toBeCloseTo(0.1 + 0.9 / 101, 12)
    expect(leaky.foldChange).toBeCloseTo(1 / (0.1 + 0.9 / 101), 8)
    expect(leaky.foldChange).toBeLessThan(noLeak.foldChange)
  })

  it('orients fold-change so that more than one always means the output moved', () => {
    const repressed = promoterFoldChange({ kind: 'repress', threshold: 1, hill: 2, lowConcentration: 0.1, highConcentration: 5 })
    const activated = promoterFoldChange({ kind: 'activate', threshold: 1, hill: 2, lowConcentration: 0.1, highConcentration: 5 })
    expect(repressed.foldChange).toBeGreaterThan(1)
    expect(activated.foldChange).toBeGreaterThan(1)
    expect(() => promoterFoldChange({ kind: 'repress', threshold: 1, hill: 2, lowConcentration: 5, highConcentration: 1 })).toThrow(
      /must exceed the low one/,
    )
  })

  it('refuses a curve it cannot draw', () => {
    expect(() => hillResponseCurve({ kind: 'repress', threshold: 0, hill: 2 })).toThrow(/Hill threshold/)
    expect(() => hillResponseCurve({ kind: 'repress', threshold: 1, hill: Number.NaN })).toThrow(/Hill coefficient/)
    expect(() => hillResponseCurve({ kind: 'repress', threshold: 1, hill: 2, points: 1 })).toThrow(/at least 2 points/)
    expect(() => hillResponseCurve({ kind: 'repress', threshold: 1, hill: 2, leakFraction: 2 })).toThrow(/leak fraction/i)
  })
})

describe('analyseCircuit', () => {
  it('confirms a memory element as settled and stable', () => {
    const preset = presetCircuit('toggle-switch')
    const analysis = analyseCircuit(preset.circuit, preset.initial, preset.window)
    expect(analysis.steadyState.converged).toBe(true)
    expect(analysis.stability.kind).toBe('stable')
    expect(analysis.stability.margin).toBeLessThan(0)
    expect(analysis.oscillation.oscillates).toBe(false)
  })

  it('withholds a stability verdict from a circuit that never arrives anywhere', () => {
    const preset = presetCircuit('repressilator')
    const analysis = analyseCircuit(preset.circuit, preset.initial, preset.window)
    expect(analysis.oscillation.oscillates).toBe(true)
    expect(analysis.stability.kind).toBe('marginal')
    expect(Number.isNaN(analysis.stability.margin)).toBe(true)
  })

  it('adapts its verdict to the initial condition for a bistable design', () => {
    const preset = presetCircuit('toggle-switch')
    const reset = analyseCircuit(preset.circuit, [0.2, 3], preset.window)
    expect(reset.stability.kind).toBe('stable')
    expect(reset.steadyState.concentrations[0]).toBeLessThan(reset.steadyState.concentrations[1])
  })

  it('labels every preset with a behaviour that its own simulation shows', () => {
    // The panel prints these notes, so each one is checked against the trace.
    for (const preset of CIRCUIT_PRESETS) {
      const analysis = analyseCircuit(preset.circuit, preset.initial, preset.window)
      expect(Number.isFinite(analysis.oscillation.amplitude)).toBe(true)
      switch (preset.id) {
        case 'repressilator':
          expect(analysis.oscillation.oscillates).toBe(true)
          break
        case 'toggle-switch':
          expect(analysis.steadyState.converged).toBe(true)
          expect(Math.abs(analysis.steadyState.concentrations[0] - analysis.steadyState.concentrations[1])).toBeGreaterThan(3)
          break
        case 'incoherent-feedforward': {
          // The note promises a pulse: the output must overshoot its own endpoint.
          const samples = simulateGeneticCircuit(preset.circuit, [0, 0, 0], { tEnd: 120, dt: 0.05 })
          const output = samples.map((sample) => sample.concentrations[2])
          expect(Math.max(...output)).toBeGreaterThan(2 * output[output.length - 1])
          expect(analysis.stability.kind).toBe('stable')
          break
        }
        default:
          expect(analysis.steadyState.converged).toBe(true)
          expect(analysis.stability.kind).toBe('stable')
      }
    }
  })

  it('knows the presets it has', () => {
    expect(CIRCUIT_PRESETS.map((preset) => preset.id)).toEqual([
      'repressilator',
      'toggle-switch',
      'negative-autoregulation',
      'incoherent-feedforward',
    ])
    expect(() => presetCircuit('oscillating-switch')).toThrow(/No circuit preset "oscillating-switch"/)
  })
})

describe('run windows', () => {
  it('refuses a run that would emit more samples than a chart can hold', () => {
    expect(() => simulateGeneticCircuit(constitutive(1, 1), [0], { tEnd: 1e6, dt: 1 })).toThrow(/output/)
    expect(() => simulateGeneticCircuit(constitutive(1, 1), [0], { tEnd: -1, dt: 0.1 })).toThrow(/positive/)
    expect(() => simulateGeneticCircuit(constitutive(1, 1), [0], { tEnd: 10, dt: Number.NaN })).toThrow(/finite/)
  })

  it('reports coarsely while solving finely', () => {
    // δ = 1 ⇒ τ = 1 ⇒ an internal step near 1/20; the output stays at the caller's dt.
    const samples = simulateGeneticCircuit(constitutive(2, 1), [0], { tEnd: 10, dt: 1 })
    expect(samples).toHaveLength(11)
    expect(samples[1].time).toBeCloseTo(1, 12)
    expect(samples[10].time).toBeCloseTo(10, 12)
  })

  it('lets a first-order step show what accuracy costs', () => {
    // Euler at the same cadence must be visibly worse than RK4, or the method
    // switch in the panel would be decorative.
    const options = { tEnd: 4, dt: 0.4 }
    const exact = (samples: { time: number; concentrations: number[] }[]): number =>
      Math.max(...samples.map((sample) => Math.abs(sample.concentrations[0] - 2 * (1 - Math.exp(-sample.time)))))
    const rk4 = exact(simulateGeneticCircuit(constitutive(2, 1), [0], options))
    const euler = exact(simulateGeneticCircuit(constitutive(2, 1), [0], { ...options, method: 'euler' }))
    expect(rk4).toBeLessThan(1e-4)
    expect(euler).toBeGreaterThan(rk4 * 100)
  })
})
