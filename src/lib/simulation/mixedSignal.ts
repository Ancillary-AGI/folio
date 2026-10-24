/**
 * Mixed-signal coupling: drive the analog SPICE engine from the digital
 * discrete-event engine and sample analog nets back into logic.
 *
 * This is a single forward pass, not a fixed-point co-simulation:
 *   1. The digital deck runs over the window. A digital node's transition
 *      history becomes a piecewise-linear (PWL) voltage source stamped into the
 *      analog net it drives. `0` maps to 0 V and `1` to the digital supply
 *      `vdd`; X/Z hold the last stable level so an unknown never becomes a
 *      phantom rail.
 *   2. The analog transient runs across the window with those sources embedded,
 *      so the analog net sees the real digital waveform including the RC/timing
 *      effects of the driver and load.
 *   3. Analog probe nodes are sampled across the transient and thresholded at
 *      `vdd/2` (or an explicit threshold) into a `probeTimeline` of 0/1.
 *
 * The probes are reported to the caller but are not written back into the
 * digital deck automatically: a circuit that genuinely needs analog→digital
 * feedback must run the digital side again with those samples as stimuli (for
 * example on the next macro-step). That two-pass loop is orchestrated by the
 * caller; this function never claims a converged closed loop.
 *
 * Nothing is invented. A digital failure is returned before the analog run, an
 * unmodelled coupling is reported in `notes`, and any analog failure surfaces
 * as `success:false` with its own error — the same fail-loud contract as both
 * engines it sits between.
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
  /**
   * Seconds per digital time unit. A deck written in nanoseconds uses `1e-9`;
   * the default `1` treats digital ticks and analog seconds as the same unit.
   */
  timeScale?: number
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
 * A transition at t is not a corner between two period-length plateaus: PWL
 * interpolates linearly between points, so only emitting (t, level) would turn
 * every clock into a triangle wave and hide the load's true step response. Each
 * transition therefore gets a short edge: the old level is held until
 * `t − edgeTime`, then the new level is reached at `t`. X/Z never becomes a
 * rail: it holds the previous 0/1 so an unknown cannot invent a phantom level.
 */
function pwlFromTransitions(
  transitions: Array<{ time: number; value: LogicValue }>,
  vdd: number,
  stopTime: number,
  stepTime: number,
  timeScale: number,
): Array<{ time: number; value: number }> {
  const points: Array<{ time: number; value: number }> = [{ time: 0, value: 0 }]
  const edgeTime = Math.max(Math.abs(stepTime), 1e-15)
  let lastLevel = 0
  for (const transition of transitions) {
    const transitionTime = transition.time * timeScale
    if (transitionTime > stopTime) break
    let nextLevel = lastLevel
    if (transition.value === 1) nextLevel = vdd
    else if (transition.value === 0) nextLevel = 0
    // X and Z keep the previous level — an unknown must not invent a rail.
    if (nextLevel === lastLevel) continue

    const previous = points[points.length - 1]
    const edgeStart = Math.max(previous.time, transitionTime - edgeTime)
    if (edgeStart > previous.time) points.push({ time: edgeStart, value: lastLevel })
    const settleTime = Math.max(transitionTime, previous.time + edgeTime * 1e-3)
    points.push({ time: settleTime, value: nextLevel })
    lastLevel = nextLevel
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
  const timeScale = request.timeScale ?? 1
  if (!Number.isFinite(timeScale) || timeScale <= 0) {
    throw new Error(`mixed-signal timeScale must be a positive number of seconds, got ${timeScale}`)
  }
  if (!Number.isFinite(stopTime) || stopTime <= 0) {
    throw new Error(`mixed-signal stopTime must be a finite, positive number of seconds, got ${stopTime}`)
  }
  if (!Number.isFinite(stepTime) || stepTime <= 0) {
    throw new Error(`mixed-signal stepTime must be a finite, positive number of seconds, got ${stepTime}`)
  }
  for (const drive of drives) {
    if (!Number.isFinite(drive.vdd) || drive.vdd <= 0) {
      throw new Error(`drive ${drive.digitalNode}->${drive.analogNet} needs a finite, positive vdd`)
    }
    if (drive.rDrive !== undefined && (!Number.isFinite(drive.rDrive) || drive.rDrive < 0)) {
      throw new Error(`drive ${drive.digitalNode}->${drive.analogNet} needs a finite, non-negative rDrive`)
    }
  }
  for (const probe of probes) {
    if (probe.threshold !== undefined && !Number.isFinite(probe.threshold)) {
      throw new Error(`probe ${probe.analogNet}->${probe.digitalNode} needs a finite threshold`)
    }
  }
  const notes: string[] = []

  // 1. Simulate the digital domain over the window. `stopTime` is in analog
  //    seconds, so the tick horizon is divided by the tick length.
  const digitalResult = simulateDigital(digital, stopTime / timeScale)
  if (!digitalResult.success) {
    return {
      success: false,
      error: `digital simulation failed: ${digitalResult.error}`,
      digital: digitalResult,
      analog: {
        success: false,
        error: 'The analog simulation was not run because the digital side failed.',
        nodes: [],
        waveforms: [],
      },
      probeTimeline: [],
      notes,
    }
  }

  // 2. Build a copy of the analog netlist with a PWL source per drive, plus a
  //    series resistance if requested (an ideal source would short a rail).
  const analogComponents: Component[] = [...analog.components]
  drives.forEach((drive, index) => {
    const pwl = pwlFromTransitions(
      digitalResult.transitions[drive.digitalNode] ?? [],
      drive.vdd,
      stopTime,
      stepTime,
      timeScale,
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

