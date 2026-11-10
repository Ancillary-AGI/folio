/**
 * A HIL rig backed by the solved circuit instead of a bench supply.
 *
 * The browser has no drive or measurement hardware, so `ArduinoIDEIntegration`
 * refuses closed. That is correct for a bench loop and useless for verifying a
 * design, so this rig closes the loop against the same netlist the simulator
 * solves: an analog input channel overrides the DC level of the independent
 * voltage source sitting on that net, and an analog output channel is the node
 * voltage Newton converged to. Nothing is interpolated or invented — if the net
 * has no source, or the solve does not converge, the case errors.
 *
 * Only analog is offered. GPIO levels, CAN frames and firmware buses belong to
 * the programmed device, which this netlist does not model.
 */
import { buildCircuitModel } from '../simulation/circuitModel'
import { runOperatingPoint } from '../simulation/solver'
import type { CircuitNetlist, Component } from '../simulation/spiceEngine'
import { HIL_BUS_LABELS, payloadBuses, type HilBus, type HilPayload, type HilRig } from './hilRig'

export interface CircuitTwinRig extends HilRig {
  readonly kind: 'twin'
  /** Nets carrying an independent voltage source, so a channel can drive them. */
  readonly driveNets: readonly string[]
  /** Every solved non-ground node, so a channel can measure it. */
  readonly measureNets: readonly string[]
  readonly temperatureCelsius: number
}

export interface TwinRigOptions {
  label?: string
  temperatureCelsius?: number
}

/** `V(OUT)`, `out` and `OUT` all name the same node. */
const netKey = (name: string): string =>
  name.trim().replace(/^v\s*\(\s*/i, '').replace(/\s*\)$/, '').toUpperCase()

function isIndependentVoltageSource(component: Component): boolean {
  const type = component.type.toLowerCase()
  if (!type.includes('source')) return /^v\d/i.test(component.name)
  if (type.includes('controlled') || type.includes('behavioral') || type.includes('arbitrary')) return false
  return type.includes('voltage') || /^v\d/i.test(component.name)
}

const refuseOtherBuses = (payload: HilPayload, direction: string): void => {
  const unsupported = payloadBuses(payload).filter((bus): bus is HilBus => bus !== 'analog')
  if (unsupported.length === 0) return
  throw new Error(
    `The circuit twin cannot ${direction} ${unsupported.map((bus) => HIL_BUS_LABELS[bus]).join(', ')}: ` +
      'the netlist models analog nets only. Run those cases against bench hardware with the firmware attached.',
  )
}

export function createCircuitTwinRig(netlist: CircuitNetlist, options: TwinRigOptions = {}): CircuitTwinRig {
  const temperatureCelsius = options.temperatureCelsius ?? 27
  const base = buildCircuitModel(netlist)
  if (base.errors.length > 0) {
    throw new Error(`The circuit twin has no valid model: ${base.errors.join('; ')}`)
  }

  const sources = netlist.components.filter(isIndependentVoltageSource)
  const driveNets = [...new Set(sources.flatMap((source) => source.nodes.map(netKey)))].sort()
  const measureNets = base.model.nodeNames.map(netKey).sort()

  let drive: Record<string, number> = {}

  const solve = (expected: HilPayload): Record<string, number> => {
    const overrides = new Map<string, number>()
    for (const [channel, value] of Object.entries(drive)) {
      if (!Number.isFinite(value)) throw new Error(`Twin drive "${channel}" is not a finite voltage.`)
      const key = netKey(channel)
      const source = sources.find((candidate) => candidate.nodes.some((node) => netKey(node) === key))
      if (!source) {
        throw new Error(
          `The circuit twin cannot drive "${channel}": no independent voltage source sits on that net. ` +
            `Driveable nets are ${driveNets.join(', ') || '(none)'}.`,
        )
      }
      overrides.set(source.name, value)
    }

    const driven: CircuitNetlist = {
      ...netlist,
      components: netlist.components.map((component) =>
        overrides.has(component.name)
          ? { ...component, parameters: { ...component.parameters, dc: overrides.get(component.name) as number } }
          : component,
      ),
    }
    const { model, errors } = buildCircuitModel(driven)
    if (errors.length > 0) throw new Error(`Twin model failed under stimulus: ${errors.join('; ')}`)
    const result = runOperatingPoint(model, { temperatureCelsius })
    if (!result.outcome.converged || result.failure || !result.outcome.operatingPoint) {
      throw new Error(
        `The twin did not converge under this stimulus${result.failure ? ` (${result.failure})` : ''}. ` +
          result.outcome.notes.join(' '),
      )
    }
    const voltages = new Map(
      Object.entries(result.outcome.operatingPoint).map(([name, value]) => [netKey(name), value]),
    )
    const measured: Record<string, number> = {}
    for (const channel of Object.keys(expected.analog ?? {})) {
      const voltage = voltages.get(netKey(channel))
      if (voltage === undefined) {
        throw new Error(
          `The circuit twin cannot measure "${channel}": that node is not in the solved model. ` +
            `Measurable nets are ${measureNets.join(', ') || '(none)'}.`,
        )
      }
      measured[channel] = voltage
    }
    return measured
  }

  return {
    id: `twin_${netlist.title.replace(/\W+/g, '_').toLowerCase()}`,
    label: options.label ?? 'Circuit twin',
    kind: 'twin',
    capabilities: ['analog'],
    note:
      `Analog loops solved from the "${netlist.title}" netlist at ${temperatureCelsius} °C. ` +
      'Inputs override the DC level of the source on the named net; outputs are converged node voltages. ' +
      'No bench hardware is involved, so this verifies the design, not the built board.',
    driveNets,
    measureNets,
    temperatureCelsius,
    async apply(inputs) {
      refuseOtherBuses(inputs, 'drive')
      drive = { ...(inputs.analog ?? {}) }
      // Resolve the drive now so an unknown net errors as a stimulus failure
      // rather than looking like a measurement that never happened.
      solve({ analog: Object.fromEntries(Object.keys(drive).map((channel) => [channel, 0])) })
    },
    async measure(expected) {
      refuseOtherBuses(expected, 'measure')
      return { analog: solve(expected) }
    },
  }
}