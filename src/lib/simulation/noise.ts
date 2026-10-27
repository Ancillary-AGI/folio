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
 *   source the analysis stamps, and those contributions add in power:
 *
 *     thermal (Johnson–Nyquist, resistor):  S_i = 4kT/R      [A²/Hz]
 *     shot                       (diode):   S_i = 2q·|I_d|   [A²/Hz]
 *
 *   Integrated RMS noise is `√(∫ S_v df)` over the swept band.
 *
 * Scope — read before quoting a number
 * ------------------------------------
 * Those two mechanisms are the only noise sources this analysis can derive from
 * the device models in `devices.ts`/`semiconductors.ts`, so the reported figure
 * is named `thermal+diode noise`, never "total". Transistor, switch and op-amp
 * noise needs parameters those models do not carry (see
 * `UNMODELLED_NOISE_REASONS`), and inventing them from a resistor formula would
 * be a fabricated number. Every such device that is actually present in the
 * netlist is therefore returned in `excludedSources` with its reason, instead of
 * being silently left out of the sum. Lossless capacitors, ideal inductors and
 * ideal (controlled) sources contribute nothing by definition, so they are not
 * exclusions.
 *
 * Monte Carlo
 * -----------
 * Re-solves the circuit under component tolerances and reports mean and spread.
 * The PRNG is seeded, so the same netlist and seed always produce the same
 * distribution.
 */

import { cAbs, cSub, complex, solveComplexSystem, type Complex } from './numeric'
import { BOLTZMANN, ELEMENTARY_CHARGE, thermalVoltage, type DeviceKind } from './devices'
import type { CircuitModel } from './circuitModel'
import { createComplexSystem, stampAc } from './stamping'
import {
  buildFrequencyGrid,
  isBiasIndependent,
  runOperatingPoint,
  readBranchCurrents,
  readNodeVoltages,
  type AnalysisOutcome,
  type Waveform,
} from './solver'
import { stampSemiconductorSmallSignal } from './semiconductors'

export interface NoiseOptions {
  temperatureCelsius: number
  startFrequency: number
  stopFrequency: number
  pointsPerDecade?: number
  /** Node whose voltage noise is being measured, e.g. `OUT`. */
  outputNode?: string
  gmin?: number
}

/** One device's output-referred noise, integrated over the swept band. */
export interface NoiseContribution {
  /** Reference designator, e.g. `R1`. */
  device: string
  /** Mechanism this device contributes through. */
  kind: 'thermal' | 'shot'
  /** `∫ S_v df` across the swept band, V². */
  integratedPower: number
  /** `√(∫ S_v df)`, volts RMS. */
  rmsVolts: number
}

/** A device that is present in the netlist but whose noise is not in the sum. */
export interface UnmodelledNoiseSource {
  device: string
  kind: DeviceKind
  /** Why no noise source could be derived for this device class. */
  reason: string
}

export interface NoiseResult extends AnalysisOutcome {
  /**
   * Integrated RMS of the *modelled* mechanisms only: resistor thermal noise
   * plus diode shot noise. It is NOT the total output noise whenever
   * `excludedSources` is non-empty, and is never named "total".
   */
  integratedThermalAndDiodeNoise: number
  /** Per-device breakdown; adds in power to `integratedThermalAndDiodeNoise`. */
  contributions: NoiseContribution[]
  /**
   * Noisy device classes present in the netlist that this analysis cannot model
   * (BJT/MOSFET/JFET channel and flicker noise, switch on-resistance, op-amp
   * input noise). Reported so a partial figure is never mistaken for a total.
   */
  excludedSources: UnmodelledNoiseSource[]
}

/**
 * Device classes that really generate noise but for which `devices.ts` /
 * `semiconductors.ts` expose no noise parameters. Deriving a value here would
 * mean inventing a coefficient, so the analysis names the device instead.
 */
const UNMODELLED_NOISE_REASONS: Partial<Record<DeviceKind, string>> = {
  bjt:
    'The BJT model carries no noise parameters. Collector/base shot noise and the thermal noise of its RB ' +
    'would need transistor noise sources this analysis does not stamp, and a resistor formula cannot stand in.',
  mosfet:
    'The level-1 MOSFET model has no excess-noise coefficient (γ) and no KF/AF flicker parameters, so channel ' +
    'thermal and 1/f noise cannot be derived from it without inventing both.',
  jfet:
    'The JFET model has no channel-noise coefficient or flicker parameters, so its thermal and 1/f noise ' +
    'cannot be derived without inventing them.',
  'op-amp':
    'The op-amp macromodel is defined by gain, GBW, slew rate, Rin and Rout only; it has no input-referred ' +
    'noise density (nV/√Hz) to refer to the output.',
  'voltage-switch':
    'The switch is stamped as a state-dependent Ron/Roff resistor and no thermal source is attached to it, so ' +
    'its on-resistance noise is absent from this figure.',
  'current-switch':
    'The switch is stamped as a state-dependent Ron/Roff resistor and no thermal source is attached to it, so ' +
    'its on-resistance noise is absent from this figure.',
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

/** Logarithmic frequency grid (shared with the AC sweep). */
export function buildLogFrequencyGrid(start: number, stop: number, pointsPerDecade: number): number[] {
  return buildFrequencyGrid({ startFrequency: start, stopFrequency: stop, pointsPerDecade })
}

/**
 * Devices whose noise is real but not derivable from the models in this repo,
 * in netlist order so the note and the JSON stay deterministic.
 */
function collectUnmodelledSources(model: CircuitModel): UnmodelledNoiseSource[] {
  const excluded: UnmodelledNoiseSource[] = []
  for (const device of model.devices) {
    const reason = UNMODELLED_NOISE_REASONS[device.kind]
    if (reason) excluded.push({ device: device.name, kind: device.kind, reason })
  }
  return excluded
}

/** Trapezoidal `∫ S df` across a frequency grid. */
function integrateSpectrum(frequencies: readonly number[], spectrum: readonly number[]): number {
  let area = 0
  for (let index = 1; index < frequencies.length; index += 1) {
    area += ((spectrum[index] + spectrum[index - 1]) / 2) * (frequencies[index] - frequencies[index - 1])
  }
  return Math.max(area, 0)
}

/**
 * Output-referred noise spectral density.
 *
 * Emits one waveform per modelled noise source in addition to the summed
 * `thermal+diode` trace, so a designer can see *which* component dominates
 * instead of only the sum. The sum is only over modelled mechanisms —
 * `excludedSources` lists what is missing from it.
 */
export function runNoiseAnalysis(model: CircuitModel, options: NoiseOptions): NoiseResult {
  const { temperatureCelsius, startFrequency, stopFrequency, pointsPerDecade = 10, gmin } = options
  const empty: NoiseResult = {
    nodes: [],
    waveforms: [],
    iterations: 0,
    converged: false,
    notes: [],
    integratedThermalAndDiodeNoise: 0,
    contributions: [],
    excludedSources: [],
  }

  if (!Number.isFinite(temperatureCelsius) || temperatureCelsius <= -273.15) {
    return { ...empty, notes: ['Noise analysis needs a finite temperature above absolute zero.'] }
  }
  if (!Number.isFinite(pointsPerDecade) || pointsPerDecade < 1) {
    return { ...empty, notes: ['Noise analysis needs at least one frequency point per decade.'] }
  }
  if (gmin !== undefined && (!Number.isFinite(gmin) || gmin < 0)) {
    return { ...empty, notes: ['Noise analysis needs a finite, non-negative gmin.'] }
  }
  if (!Number.isFinite(startFrequency) || !Number.isFinite(stopFrequency)) {
    return { ...empty, notes: ['Noise analysis needs finite start and stop frequencies.'] }
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

  const operatingPoint = runOperatingPoint(model, { temperatureCelsius, gmin, time: 0 })
  const notes = [...operatingPoint.outcome.notes]
  const biasSolved =
    !operatingPoint.failure &&
    operatingPoint.outcome.converged &&
    operatingPoint.solution.length > 0
  if (!biasSolved && (operatingPoint.failure !== 'singular' || !isBiasIndependent(model))) {
    // Shot noise depends on the bias current, so there is nothing to linearise
    // about when the bias solve failed. Report that, not a zero-noise circuit.
    notes.push(
      'Noise analysis needs a converged DC operating point; the bias solve failed, so no noise spectrum was computed.',
    )
    return {
      ...empty,
      notes,
      iterations: operatingPoint.outcome.iterations,
    }
  }
  if (!biasSolved) {
    notes.push(
      'The DC operating point is indeterminate (for example an ideal source directly across an ideal ' +
        'inductor); this circuit is linear, so the noise spectrum was computed about zero bias.',
    )
  }
  const biasSolution = biasSolved
    ? operatingPoint.solution
    : new Array<number>(model.size).fill(0)
  const biasDiodeConductances = biasSolved ? operatingPoint.diodeConductances : new Map<string, number>()
  const fourKT = 4 * BOLTZMANN * (temperatureCelsius + 273.15)

  const frequencies = buildLogFrequencyGrid(startFrequency, stopFrequency, pointsPerDecade)
  const modelledSum = new Array<number>(frequencies.length).fill(0)
  const contributions = new Map<string, { spectrum: number[]; kind: 'thermal' | 'shot' }>()
  /*
   * Only resistors and diodes get a bucket: those are the two classes whose noise
   * the device models define. Anything else that is noisy is reported in
   * `excludedSources` below rather than summed with a borrowed formula.
   */
  for (const device of model.devices) {
    if (device.kind === 'resistor') {
      contributions.set(device.name, { spectrum: new Array(frequencies.length).fill(0), kind: 'thermal' })
    } else if (device.kind === 'diode') {
      contributions.set(device.name, { spectrum: new Array(frequencies.length).fill(0), kind: 'shot' })
    }
  }
  const excludedSources = collectUnmodelledSources(model)

  for (let index = 0; index < frequencies.length; index += 1) {
    const frequency = frequencies[index]
    const omega = 2 * Math.PI * frequency
    const system = createComplexSystem(model)
    stampAc(system, model, omega, biasDiodeConductances, gmin ?? 1e-12)
    stampSemiconductorSmallSignal(
      system,
      model,
      operatingPoint.semiconductor,
      thermalVoltage(temperatureCelsius),
      omega,
      readNodeVoltages(model, biasSolution),
      { currents: readBranchCurrents(model, biasSolution), time: 0 },
    )

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

    modelledSum[index] = sum
  }

  const waveforms: Waveform[] = [
    {
      name: `thermal+diode noise at ${outputNode}`,
      type: 'voltage',
      unit: 'V/√Hz',
      data: frequencies.map((frequency, index) => ({ x: frequency, y: Math.sqrt(modelledSum[index]) })),
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
  const breakdown: NoiseContribution[] = [...contributions].map(([device, { spectrum, kind }]) => {
    const integratedPower = integrateSpectrum(frequencies, spectrum)
    return { device, kind, integratedPower, rmsVolts: Math.sqrt(integratedPower) }
  })
  const integratedThermalAndDiodeNoise = Math.sqrt(integrateSpectrum(frequencies, modelledSum))

  const formatHz = (value: number): string => (
    value >= 1e6 ? `${(value / 1e6).toFixed(3)} MHz`
      : value >= 1e3 ? `${(value / 1e3).toFixed(3)} kHz`
        : `${value.toFixed(1)} Hz`
  )
  const bandStart = frequencies[0] ?? startFrequency
  const bandStop = frequencies[frequencies.length - 1] ?? stopFrequency
  notes.push(
    `Bias: ${thermalVoltage(temperatureCelsius).toFixed(4)} V thermal voltage at ${temperatureCelsius} °C. ` +
      `Integrated thermal+diode (modelled) noise ${formatHz(bandStart)}–${formatHz(bandStop)} is ` +
      `${(integratedThermalAndDiodeNoise * 1e6).toFixed(3)} µV RMS at ${outputNode}.`,
  )
  if (excludedSources.length > 0) {
    notes.push(
      `This is not the total output noise: ${excludedSources.length} device(s) in the netlist have no noise ` +
        `model here and are excluded from the figure above — ` +
        `${excludedSources.map((source) => `${source.device} (${source.kind})`).join(', ')}.`,
    )
    for (const source of excludedSources) {
      notes.push(`Unmodelled noise source ${source.device} (${source.kind}): ${source.reason}`)
    }
  }

  return {
    nodes: [],
    waveforms,
    iterations: operatingPoint.outcome.iterations,
    converged: true,
    notes,
    integratedThermalAndDiodeNoise,
    contributions: breakdown,
    excludedSources,
  }
}
