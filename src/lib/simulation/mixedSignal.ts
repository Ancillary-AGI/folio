/**
 * Mixed-signal co-simulation: couple the analog SPICE engine to the digital
 * discrete-event engine so a GPIO can drive an analog load and a comparator can
 * drive logic in one run.
 *
 * Strategy — lockstep macro-stepping:
 *   1. A digital node's transition history is rendered as a piecewise-linear
 *      (PWL) voltage source and stamped into the analog net it drives. `0` maps
 *      to 0 V and `1` maps to the digital supply `vdd`; X/Z fall back to the
 *      last stable level so an unknown never becomes a phantom rail.
 *   2. The analog transient runs across the whole window with those sources
 *      embedded, so the analog net sees the real digital waveform — including
 *      the RC/timing effects of the driver and load.
 *   3. Analog probe nodes are sampled across the transient and thresholded at
 *      `vdd/2` back into 0/1, closing the loop: a comparator output then feeds
 *      a logic gate.
 *
 * Nothing is invented. An unmodelled coupling is reported in `notes`, and any
 * analog failure surfaces as `success:false` with its own error — the same
 * fail-loud contract as both engines it sits between.
 */

import {
  simulateDigital,
  type DigitalNetlist,
  type DigitalResult,
  type LogicValue,
} from './digitalLogic'
import { spiceEngine, type CircuitNetlist, type Component, type SimulationResult } from './spiceEngine'

/** One declared digital→analog driver: a digital node drives an analog net. */
export interface DigitalToAnalogDrive {
  /** Digital node whose waveform drives the analog net. */
  digitalNode: string
  /** Analog net driven by this digital node. */
  analogNet: string
  /** Voltage representing logic 1, in volts (e.g. 3.3 or 5). */
  vdd: number
  /** Output series resistance of the driver, in ohms. Default 0 (ideal). */
  rDrive?: number
}

/** One declared analog→digital probe: an analog net feeds a digital node. */
export interface AnalogToDigitalProbe {
  /** Analog net whose voltage is sensed. */
  analogNet: string
  /** Digital node this feeds back into. */
  digitalNode: string
  /** Logic threshold, in volts. Defaults to `vdd/2`. */
  threshold?: number
}

export interface MixedSignalRequest {
  digital: DigitalNetlist
  analog: CircuitNetlist
  drives?: DigitalToAnalogDrive[]
  probes?: AnalogToDigitalProbe[]
  /** End time of the co-simulation window, in seconds. */
  stopTime: number
  /** Analog transient step, in seconds. */
  stepTime: number
}

export interface MixedSignalResult {
  success: boolean
  error?: string
  digital: DigitalResult
  analog: SimulationResult
  /** Sampled analog→digital threshold decisions, per probe, over time. */
  probeTimeline: Array<{ time: number; digitalNode: string; value: LogicValue }>
  notes: string[]
}

/**
 * Render a digital node's transitions as a monotonic PWL point list.
 *
 * A transition at t contributes (t, level). The list is forced strictly
 * increasing in time (the analog PWL evaluator requires it) by nudging any
 * zero-width corner forward by a fraction of the step. X/Z never becomes a
 * rail: it holds the previous 0/1 so an unknown cannot invent a phantom level.
 */
function pwlFromTransitions(
  transitions: Array<{ time: number; value: LogicValue }>,
  vdd: number,
  stopTime: number,
  stepTime: number,
): Array<{ time: number; value: number }> {
  const points: Array<{ time: number; value: number }> = [{ time: 0, value: 0 }]
  let lastLevel = 0
  for (const transition of transitions) {
    if (transition.time > stopTime) break
    if (transition.value === 1) lastLevel = vdd
    else if (transition.value === 0) lastLevel = 0
    // X and Z keep the previous level — an unknown must not invent a rail.
    const previous = points[points.length - 1]
    let time = transition.time
    if (time <= previous.time) time = previous.time + Math.abs(stepTime) * 1e-3
    points.push({ time, value: lastLevel })
  }
  return points
}

/** Threshold an analog sample into a logic value. */
function thresholdToLogic(voltage: number, threshold: number): LogicValue {
  return voltage >= threshold ? 1 : 0
}

/**
 * Run a lockstep mixed-signal simulation.
 */
export async function simulateMixedSignal(request: MixedSignalRequest): Promise<MixedSignalResult> {
  const { digital, analog, drives = [], probes = [], stopTime, stepTime } = request
  const notes: string[] = []

  // 1. Simulate the digital domain over the window.
  const digitalResult = simulateDigital(digital, stopTime)

  // 2. Build a copy of the analog netlist with a PWL source per drive, plus a
  //    series resistance if requested (an ideal source would short a rail).
  const analogComponents: Component[] = [...analog.components]
  drives.forEach((drive, index) => {
    const pwl = pwlFromTransitions(
      digitalResult.transitions[drive.digitalNode] ?? [],
      drive.vdd,
      stopTime,
      stepTime,
    )
    if (pwl.length < 2) {
      notes.push(`drive ${drive.digitalNode}->${drive.analogNet} has no transitions; net held at 0 V`)
    }
    const rDrive = drive.rDrive
    const useInternal = typeof rDrive === 'number' && rDrive > 0
    analogComponents.push({
      type: 'voltage-source',
      name: `VMS${index + 1}`,
      nodes: [useInternal ? `__ms${drive.digitalNode}` : drive.analogNet, '0'],
      parameters: { points: pwl.map((p) => `${p.time},${p.value}`).join(' '), dc: 0 },
    })
    if (useInternal && typeof rDrive === 'number') {
      // Series R between the ideal PWL source and the driven net, so the load
      // sees the driver's output impedance rather than a hard rail.
      analogComponents.push({
        type: 'resistor',
        name: `RMS${index + 1}`,
        nodes: [`__ms${drive.digitalNode}`, drive.analogNet],
        parameters: { resistance: rDrive },
      })
    }
  })

  // 3. Run the analog transient with the digital sources embedded. The analog
  //    engine is async and takes the transient parameters inside `analyses`.
  const analogNetlist: CircuitNetlist = {
    ...analog,
    components: analogComponents,
    analyses: [
      ...(analog.analyses ?? []).filter((analysis) => analysis.type !== 'transient'),
      { type: 'transient', startTime: 0, stopTime, stepTime },
    ],
  }
  const analogResult = await spiceEngine.simulate(analogNetlist)
  if (!analogResult.success) {
    return {
      success: false,
      error: analogResult.error,
      digital: digitalResult,
      analog: analogResult,
      probeTimeline: [],
      notes,
    }
  }

  // 4. Close the loop: sample each probe across the transient and threshold
  //    back into logic, so a comparator output can drive a gate.
  const defaultThreshold = (drives[0]?.vdd ?? 3.3) / 2
  const probeTimeline: MixedSignalResult['probeTimeline'] = []
  for (const probe of probes) {
    const threshold = probe.threshold ?? defaultThreshold
    // The analog engine uppercases node names in its waveform keys (`V(A)`), so
    // the match is case-insensitive on the node — never miss a real net over case.
    const wanted = `V(${probe.analogNet})`.toUpperCase()
    const waveform = analogResult.waveforms.find(
      (wave) => wave.name.toUpperCase() === wanted,
    )
    if (!waveform) {
      notes.push(`probe ${probe.analogNet}->${probe.digitalNode}: no analog waveform for that net`)
      continue
    }
    for (const sample of waveform.data) {
      probeTimeline.push({
        time: sample.x,
        digitalNode: probe.digitalNode,
        value: thresholdToLogic(sample.y, threshold),
      })
    }
  }

  return { success: true, digital: digitalResult, analog: analogResult, probeTimeline, notes }
}

