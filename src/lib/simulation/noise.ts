/**
 * Noise and Monte Carlo analyses.
 *
 * Noise
 * -----
 * Computed with the adjoint (transposed) network method, which is how circuit
 * simulators have done `.noise` for decades:
 *
 *   For an output voltage `v_out = e_outᵀ·v` and a system `A·v = i_s` we have
 *   `v_out = (A⁻ᵀ·e_out)ᵀ·i_s`. Solve `Aᵀ·x = e_out` **once per frequency** and
 *   `x_p − x_n` is the transimpedance from any current-noise source between
 *   nodes `p` and `n` to the output. One solve therefore covers every noise
 *   source in the circuit, and the contributions add in power:
 *
 *     thermal (Johnson–Nyquist, resistor):  S_i = 4kT/R      [A²/Hz]
 *     shot                       (diode):   S_i = 2q·|I_d|   [A²/Hz]
 *
 *   Integrated RMS noise is `√(∫ S_v df)` over the swept band.
 *
 * Monte Carlo
 * -----------
 * Re-solves the circuit under component tolerances and reports mean and spread.
 * The PRNG is seeded, so the same netlist and seed always produce the same
 * distribution.
 */

import { cAbs, cSub, complex, solveComplexSystem, type Complex } from './numeric'
import { BOLTZMANN, ELEMENTARY_CHARGE, thermalVoltage } from './devices'
import type { CircuitModel } from './circuitModel'
import { createComplexSystem, stampAc } from './stamping'
import { runOperatingPoint, type AnalysisOutcome, type Waveform } from './solver'

export interface NoiseOptions {
  temperatureCelsius: number
  startFrequency: number
  stopFrequency: number
  pointsPerDecade?: number
  /** Node whose voltage noise is being measured, e.g. `OUT`. */
  outputNode?: string
  gmin?: number
}

export interface NoiseResult extends AnalysisOutcome {
  /** Integrated RMS noise over the swept band, in volts. */
  integratedRmsNoise: number
}

/**
 * Resolve the node whose noise is measured.
 * An explicit `outputNode` always wins; otherwise a conventional output net name
 * is used, because a noise analysis without an output is meaningless and
 * silently choosing one would be worse than saying so.
 */
export function resolveOutputNode(model: CircuitModel, requested?: string): string | null {
  const normalized = requested?.trim().toUpperCase()
  if (normalized) return model.nodeIndex.has(normalized) ? normalized : null
  return model.nodeNames.find((node) => /^(OUT|VOUT|OUTPUT|VO)$/.test(node)) ?? null
}

/** Transpose a complex matrix into a fresh matrix. */
function transpose(matrix: Complex[][]): Complex[][] {
  const size = matrix.length
  const result = Array.from({ length: size }, () => Array.from({ length: size }, () => complex(0)))
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      result[column][row] = matrix[row][column]
    }
  }
  return result
}

/** Logarithmic frequency grid (shared shape with the AC sweep). */
export function buildLogFrequencyGrid(start: number, stop: number, pointsPerDecade: number): number[] {
  const decades = Math.log10(stop / start)
  const count = Math.min(Math.max(2, Math.round(decades * pointsPerDecade) + 1), 2000)
  const ratio = Math.pow(stop / start, 1 / (count - 1))
  return Array.from({ length: count }, (_, index) => start * Math.pow(ratio, index))
}

/**
 * Output-referred noise spectral density.
 *
 * Emits one waveform per noise source in addition to the total, so a designer
 * can see *which* component dominates instead of only the sum.
 */
export function runNoiseAnalysis(model: CircuitModel, options: NoiseOptions): NoiseResult {
  const { temperatureCelsius, startFrequency, stopFrequency, pointsPerDecade = 10, gmin } = options
  const empty: NoiseResult = {
    nodes: [],
    waveforms: [],
    iterations: 0,
    converged: false,
    notes: [],
    integratedRmsNoise: 0,
  }

  if (!(startFrequency > 0) || !(stopFrequency > startFrequency)) {
    return { ...empty, notes: ['Noise analysis needs 0 < start frequency < stop frequency.'] }
  }

  const outputNode = resolveOutputNode(model, options.outputNode)
  if (!outputNode) {
    return {
      ...empty,
      notes: [
        options.outputNode
          ? `Noise output node "${options.outputNode}" is not a net in this circuit.`
          : 'Noise analysis needs an output net. Name a net "OUT", or choose one explicitly.',
      ],
    }
  }
  const outputIndex = model.nodeIndex.get(outputNode)
  if (outputIndex === undefined) {
    return { ...empty, notes: [`"${outputNode}" is ground; output noise cannot be measured there.`] }
  }

  const operatingPoint = runOperatingPoint(model, { temperatureCelsius, gmin })
  const notes = [...operatingPoint.outcome.notes]
  const fourKT = 4 * BOLTZMANN * (temperatureCelsius + 273.15)

  const frequencies = buildLogFrequencyGrid(startFrequency, stopFrequency, pointsPerDecade)
  const total = new Array<number>(frequencies.length).fill(0)
  const contributions = new Map<string, { spectrum: number[]; kind: 'thermal' | 'shot' }>()
  for (const device of model.devices) {
    if (device.kind === 'resistor') {
      contributions.set(device.name, { spectrum: new Array(frequencies.length).fill(0), kind: 'thermal' })
    } else if (device.kind === 'diode') {
      contributions.set(device.name, { spectrum: new Array(frequencies.length).fill(0), kind: 'shot' })
    }
  }

  for (let index = 0; index < frequencies.length; index += 1) {
    const frequency = frequencies[index]
    const system = createComplexSystem(model)
    stampAc(system, model, 2 * Math.PI * frequency, operatingPoint.diodeConductances, gmin ?? 1e-12)

    // Adjoint solve: Aᵀ·x = e_out, i.e. a unit current injected at the output.
    const adjointRhs = Array.from({ length: model.size }, () => complex(0))
    adjointRhs[outputIndex] = complex(1)
    const transfer = solveComplexSystem(transpose(system.matrix), adjointRhs)
    if (!transfer) {
      notes.push(`The noise network is singular at ${frequency.toPrecision(4)} Hz.`)
      return { ...empty, notes, converged: false, iterations: operatingPoint.outcome.iterations }
    }

    const transimpedance = (p: string, n: string): number => {
      const pIndex = model.nodeIndex.get(p)
      const nIndex = model.nodeIndex.get(n)
      const difference = cSub(
        pIndex === undefined ? complex(0) : transfer[pIndex],
        nIndex === undefined ? complex(0) : transfer[nIndex],
      )
      return cAbs(difference)
    }

    let sum = 0
    for (const device of model.devices) {
      let density: number
      if (device.kind === 'resistor') {
        density = fourKT / device.resistance
      } else if (device.kind === 'diode') {
        const bias = Math.abs(operatingPoint.diodeOperatingPoints.get(device.name)?.current ?? 0)
        density = 2 * ELEMENTARY_CHARGE * bias
      } else {
        continue
      }

      const h = transimpedance(device.p, device.n)
      const contribution = h * h * density // V²/Hz
      const bucket = contributions.get(device.name)
      if (bucket) bucket.spectrum[index] += contribution
      sum += contribution
    }

    total[index] = sum
  }

  const waveforms: Waveform[] = [
    {
      name: `total noise at ${outputNode}`,
      type: 'voltage',
      unit: 'V/√Hz',
      data: frequencies.map((frequency, index) => ({ x: frequency, y: Math.sqrt(total[index]) })),
    },
  ]
  for (const [name, { spectrum, kind }] of contributions) {
    waveforms.push({
      name: `${name} ${kind} noise`,
      type: 'voltage',
      unit: 'V/√Hz',
      data: frequencies.map((frequency, index) => ({ x: frequency, y: Math.sqrt(spectrum[index]) })),
    })
  }

  // Trapezoidal integration of the PSD across the swept band.
  let integrated = 0
  for (let index = 1; index < frequencies.length; index += 1) {
    integrated += ((total[index] + total[index - 1]) / 2) * (frequencies[index] - frequencies[index - 1])
  }
  const integratedRmsNoise = Math.sqrt(Math.max(integrated, 0))

  notes.push(
    `Bias: ${thermalVoltage(temperatureCelsius).toFixed(4)} V thermal voltage at ${temperatureCelsius} °C. ` +
      `Integrated output noise 0→band is ${(integratedRmsNoise * 1e6).toFixed(3)} µV RMS at ${outputNode}.`,
  )

  return {
    nodes: [],
    waveforms,
    iterations: operatingPoint.outcome.iterations,
    converged: true,
    notes,
    integratedRmsNoise,
  }
}
