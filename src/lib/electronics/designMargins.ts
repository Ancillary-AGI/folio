/**
 * Design margins: rating, power, and first-order junction temperature.
 *
 * Every number here is derived from a solved circuit (node voltages and device
 * currents) and a rating that is actually declared somewhere — a component
 * property, a package table, or the vendor model catalog. Nothing is invented:
 * an undeclared rating produces an explicit "not rated" entry instead of a
 * comfortable pass. Junction temperature is labelled as an estimate because it
 * uses a typical package θJA, not a board-level thermal solve.
 */
import { CHIP_PACKAGES } from './passives'
import { parseSpiceValue } from '../simulation/devices'
import { lookupVendorModel } from '../simulation/vendorModels'
import type { SimulationResult } from '../simulation/spiceEngine'
import type { DesignComponentSnapshot, DesignSnapshot } from '../agents/designSnapshot'

export type MarginStatus = 'ok' | 'warn' | 'fail'
export type MarginQuantity = 'power' | 'voltage' | 'current' | 'junction-temperature'

export interface ThermalEstimate {
  ambientC: number
  riseC: number
  junctionC: number
  thetaJa: number
  /** True when θJA came from the typical package table, not a declaration. */
  estimated: boolean
  package?: string
  limitC?: number
  status?: MarginStatus
}

export interface MarginItem {
  id: string
  componentId: string
  reference: string
  part: string
  quantity: MarginQuantity
  value: number
  limit: number
  unit: string
  /** value / limit; can exceed 1. */
  utilization: number
  status: MarginStatus
  /** How the measured value was obtained (DC, transient average, sweep max). */
  basis: string
  thermal?: ThermalEstimate
}

export interface ComponentMeasurement {
  componentId: string
  reference: string
  part: string
  kind: PartKind
  voltagePeakV?: number
  reversePeakV?: number
  currentPeakA?: number
  powerAverageW?: number
  powerPeakW?: number
  thermal?: ThermalEstimate
}

export interface UnratedComponent {
  reference: string
  part: string
  reason: string
}

export interface DesignMarginReport {
  items: MarginItem[]
  measurements: ComponentMeasurement[]
  worst?: MarginItem
  limitingFactor?: string
  hottest?: { reference: string; part: string; thermal: ThermalEstimate }
  ambientCelsius: number
  power: {
    /** Window average delivered by voltage sources, W. */
    suppliedW?: number
    /** Window average dissipated by resistors and semiconductors, W. */
    dissipatedW?: number
    sourceCount: number
    basis: string
  }
  coverage: {
    components: number
    evaluated: number
    unrated: UnratedComponent[]
  }
  assumptions: string[]
  notes: string[]
}

export type PartKind =
  | 'resistor'
  | 'capacitor'
  | 'inductor'
  | 'diode'
  | 'bjt'
  | 'mosfet'
  | 'jfet'
  | 'source'
  | 'ground'
  | 'other'

/**
 * Typical junction-to-ambient thermal resistance by package, K/W.
 *
 * These are JEDEC-style single-layer board values for orientation only. A real
 * design must use the package's datasheet value with the actual copper area,
 * airflow, and neighbouring parts — the report says so and accepts an explicit
 * `thetaJA` property that overrides this table.
 */
const TYPICAL_THETA_JA: Readonly<Record<string, number>> = {
  '0201': 500,
  '0402': 400,
  '0603': 300,
  '0805': 220,
  '1206': 150,
  '1210': 120,
  '2512': 80,
  'SOT-23': 250,
  'SOT-223': 80,
  'TO-18': 150,
  'TO-92': 200,
  'TO-220': 60,
  'TO-3': 30,
  'DO-35': 250,
  'DO-41': 150,
  'SMC': 40,
  'DIP-8': 100,
  'SOIC-8': 120,
  'QFN': 50,
}

const WARN_UTILIZATION = 0.8

const statusFor = (utilization: number): MarginStatus =>
  utilization > 1 ? 'fail' : utilization > WARN_UTILIZATION ? 'warn' : 'ok'

export function classifyPart(part: string): PartKind {
  const name = part.toLowerCase().replace(/[^a-z0-9]+/g, ' ')
  if (/ground/.test(name)) return 'ground'
  if (/resistor/.test(name)) return 'resistor'
  if (/capacitor/.test(name)) return 'capacitor'
  if (/inductor/.test(name)) return 'inductor'
  if (/diode|\bled\b|rectifier|schottky|zener/.test(name)) return 'diode'
  if (/transistor|\bbjt\b|\bnpn\b|\bpnp\b/.test(name)) return 'bjt'
  if (/mosfet|n channel mos|p channel mos/.test(name)) return 'mosfet'
  if (/jfet/.test(name)) return 'jfet'
  if (/source|supply|battery/.test(name)) return 'source'
  return 'other'
}

type Properties = DesignComponentSnapshot['properties']

function numericProperty(properties: Properties, keys: string[]): number | undefined {
  for (const key of keys) {
    for (const [name, raw] of Object.entries(properties)) {
      if (name.toLowerCase() !== key.toLowerCase()) continue
      if (raw === undefined || raw === '' || typeof raw === 'boolean') continue
      try {
        return parseSpiceValue(raw, `${key}`)
      } catch {
        return undefined
      }
    }
  }
  return undefined
}

/** Parse `60`, `60K/W`, `60 °C/W` as thermal resistance without SI-prefix traps. */
function thermalResistance(raw: string | number | boolean | undefined): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0 ? raw : undefined
  if (typeof raw !== 'string') return undefined
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(?:k|°?c)?\s*\/\s*w\s*$/i.exec(raw)
    ?? /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*$/.exec(raw)
  if (!match) return undefined
  const value = Number(match[1])
  return Number.isFinite(value) && value > 0 ? value : undefined
}

function packageName(properties: Properties): string | undefined {
  for (const key of ['footprint', 'package', 'case']) {
    const raw = properties[key]
    if (typeof raw === 'string' && raw.trim()) return raw.trim()
  }
  return undefined
}

function thetaJaFor(component: DesignComponentSnapshot): { thetaJa: number; estimated: boolean; package?: string } | undefined {
  const declared =
    thermalResistance(component.properties.thetaJA) ??
    thermalResistance(component.properties.thetaJa) ??
    thermalResistance(component.properties.rthJA) ??
    thermalResistance(component.properties['thermalResistance'])
  if (declared !== undefined) return { thetaJa: declared, estimated: false }

  const pkg = packageName(component.properties)
  if (!pkg) return undefined
  const key = Object.keys(TYPICAL_THETA_JA).find((candidate) => candidate.toUpperCase() === pkg.toUpperCase())
  if (!key) return undefined
  return { thetaJa: TYPICAL_THETA_JA[key], estimated: true, package: pkg }
}

function tjMaxFor(component: DesignComponentSnapshot): number | undefined {
  return numericProperty(component.properties, ['tjMax', 'tjmax', 'maxJunction', 'tj'])
}

function vendorRatings(component: DesignComponentSnapshot) {
  const name =
    (typeof component.properties.type === 'string' && component.properties.type) ||
    (typeof component.properties.part === 'string' && component.properties.part) ||
    (typeof component.properties.mpn === 'string' && component.properties.mpn) ||
    component.value
  return name ? lookupVendorModel(name)?.ratings : undefined
}

function declaredPowerLimit(component: DesignComponentSnapshot): { limit: number; source: string } | undefined {
  const explicit = numericProperty(component.properties, ['power', 'pd', 'pmax', 'pMax', 'dissipation', 'wattage'])
  if (explicit !== undefined && explicit > 0) {
    return { limit: explicit, source: 'declared power rating' }
  }
  const pkg = packageName(component.properties)
  const chip = pkg ? CHIP_PACKAGES[pkg] : undefined
  if (chip) return { limit: chip.rating, source: `${pkg} package rating` }
  const vendor = vendorRatings(component)
  if (vendor?.pd !== undefined && vendor.pd > 0) {
    return { limit: vendor.pd, source: 'vendor model rating' }
  }
  return undefined
}

function declaredVoltageLimit(component: DesignComponentSnapshot, kind: PartKind): { limit: number; source: string } | undefined {
  const explicit = numericProperty(component.properties, ['maxVoltage', 'vmax', 'vMax', 'voltageRating', 'wv', 'vr', 'vbr'])
  if (explicit !== undefined && explicit > 0) {
    return { limit: explicit, source: 'declared voltage rating' }
  }
  const vendor = vendorRatings(component)
  if (kind === 'bjt' && vendor?.vceo !== undefined && vendor.vceo > 0) {
    return { limit: vendor.vceo, source: 'vendor Vceo' }
  }
  if ((kind === 'mosfet' || kind === 'jfet') && vendor?.vds !== undefined && vendor.vds > 0) {
    return { limit: vendor.vds, source: 'vendor Vds' }
  }
  if (kind === 'diode' && vendor?.vbr !== undefined && vendor.vbr > 0) {
    return { limit: vendor.vbr, source: 'vendor reverse voltage' }
  }
  if (kind === 'source' && vendor?.vcc !== undefined && vendor.vcc > 0) {
    return { limit: vendor.vcc, source: 'vendor supply rating' }
  }
  return undefined
}

function declaredCurrentLimit(component: DesignComponentSnapshot, kind: PartKind): { limit: number; source: string } | undefined {
  const explicit = numericProperty(component.properties, ['maxCurrent', 'imax', 'iMax', 'isat', 'satCurrent', 'iSat', 'currentRating'])
  if (explicit !== undefined && explicit > 0) {
    return { limit: explicit, source: 'declared current rating' }
  }
  const vendor = vendorRatings(component)
  if ((kind === 'bjt') && vendor?.ic !== undefined && vendor.ic > 0) {
    return { limit: vendor.ic, source: 'vendor Ic' }
  }
  if ((kind === 'mosfet' || kind === 'jfet') && vendor?.id !== undefined && vendor.id > 0) {
    return { limit: vendor.id, source: 'vendor Id' }
  }
  return undefined
}

function capacitorVoltageLimit(component: DesignComponentSnapshot): { limit: number; source: string } | undefined {
  const explicit = numericProperty(component.properties, ['voltage', 'maxVoltage', 'vmax', 'wv'])
  if (explicit !== undefined && explicit > 0) {
    return { limit: explicit, source: 'declared capacitor voltage' }
  }
  return undefined
}

function pinNet(component: DesignComponentSnapshot, pin: string): string | undefined {
  return component.pins.find((candidate) => candidate.id === pin || candidate.name === pin)?.net
}

interface Series {
  x: number
  y: number
}

const maxAbs = (data: readonly Series[]): number => {
  let peak = 0
  for (const point of data) peak = Math.max(peak, Math.abs(point.y))
  return peak
}

const minValue = (data: readonly Series[]): number => {
  let min = Infinity
  for (const point of data) min = Math.min(min, point.y)
  return min
}

const interpolate = (data: readonly Series[], x: number): number | undefined => {
  if (data.length === 0) return undefined
  if (x <= data[0].x) return data[0].y
  if (x >= data[data.length - 1].x) return data[data.length - 1].y
  let low = 0
  let high = data.length - 1
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if (data[middle].x <= x) low = middle
    else high = middle
  }
  const left = data[low]
  const right = data[high]
  const span = right.x - left.x
  if (!(span > 0)) return left.y
  return left.y + ((x - left.x) / span) * (right.y - left.y)
}

/** Align a current trace onto the voltage grid, then integrate V·I. */
function averagePowerOf(
  voltage: readonly Series[],
  current: readonly Series[],
): number | undefined {
  if (voltage.length < 2 || current.length === 0) return undefined
  const start = Math.max(voltage[0].x, current[0].x)
  const end = Math.min(voltage[voltage.length - 1].x, current[current.length - 1].x)
  if (!(end > start)) return undefined
  let energy = 0
  let previousPower: number | undefined
  let previousX = 0
  for (const point of voltage) {
    if (point.x < start) continue
    if (point.x > end) break
    const sample = interpolate(current, point.x)
    if (sample === undefined) continue
    // Trapezoidal integration of instantaneous power, not of voltage: the
    // current sample was previously interpolated and then dropped, which made
    // every "power" number an average voltage (and broke the source budget).
    const power = point.y * sample
    if (previousPower !== undefined) {
      const dt = point.x - previousX
      if (dt >= 0) energy += ((previousPower + power) / 2) * dt
    }
    previousPower = power
    previousX = point.x
  }
  if (previousPower === undefined) return undefined
  const span = end - start
  return span > 0 ? energy / span : undefined
}

interface Traces {
  voltage: Series[]
  current?: Series[]
  voltageBasis: string
  currentBasis: string
  powerAverage?: number
  /** Signed average: negative when the device delivers power (a source). */
  powerSignedAverage?: number
  powerPeak?: number
  reversePeak?: number
}

/** Voltage between two nets, constant-zero for ground. */
function voltageBetween(
  positive: string | undefined,
  negative: string | undefined,
  result: SimulationResult,
  nodeWaveforms: Map<string, Series[]>,
): { data: Series[]; basis: string } | undefined {
  if (!positive || !negative) return undefined
  const dc = result.analysis === 'dc' || !result.waveforms.some((waveform) => /^V\(/.test(waveform.name))
  if (dc) {
    const vp = positive === '0' ? 0 : result.operatingPoint?.[positive]
    const vn = negative === '0' ? 0 : result.operatingPoint?.[negative]
    if (vp === undefined || vn === undefined) return undefined
    return { data: [{ x: 0, y: vp - vn }], basis: 'DC operating point' }
  }
  // A ground terminal is a constant 0 V, not a waveform on the plot grid:
  // subtracting it must not demand a matching sample count, or every part
  // referenced to ground (the common case) reports no voltage at all.
  const positiveGround = positive === '0'
  const negativeGround = negative === '0'
  const positiveData = positiveGround ? undefined : nodeWaveforms.get(positive)
  const negativeData = negativeGround ? undefined : nodeWaveforms.get(negative)
  if (!positiveGround && !positiveData) return undefined
  if (!negativeGround && !negativeData) return undefined
  const basis = result.analysis === 'dc-sweep' ? 'DC sweep value' : 'transient waveform'
  if (positiveGround && negativeGround) return { data: [{ x: 0, y: 0 }], basis }
  if (positiveGround) {
    return { data: (negativeData ?? []).map((point) => ({ x: point.x, y: -point.y })), basis }
  }
  if (negativeGround) return { data: (positiveData ?? []).map((point) => ({ x: point.x, y: point.y })), basis }
  if (positiveData!.length !== negativeData!.length || positiveData!.some((point, index) => point.x !== negativeData![index].x)) {
    return undefined
  }
  return {
    data: positiveData!.map((point, index) => ({ x: point.x, y: point.y - negativeData![index].y })),
    basis,
  }
}

function tracesFor(
  component: DesignComponentSnapshot,
  kind: PartKind,
  result: SimulationResult,
  nodeWaveforms: Map<string, Series[]>,
  deviceCurrents: Map<string, number>,
  currentWaveforms: Map<string, Series[]>,
): Traces | undefined {
  let positive: string | undefined
  let negative: string | undefined
  if (kind === 'bjt') {
    positive = pinNet(component, 'collector')
    negative = pinNet(component, 'emitter')
  } else if (kind === 'mosfet' || kind === 'jfet') {
    positive = pinNet(component, 'drain')
    negative = pinNet(component, 'source')
  } else if (kind === 'diode') {
    positive = pinNet(component, 'anode') ?? component.pins[0]?.net
    negative = pinNet(component, 'cathode') ?? component.pins[1]?.net
  } else {
    positive = component.pins[0]?.net
    negative = component.pins[1]?.net
  }
  const voltage = voltageBetween(positive, negative, result, nodeWaveforms)
  if (!voltage) return undefined

  let current = currentWaveforms.get(component.reference)
  let currentBasis = 'solved device current waveform'
  if (!current) {
    const dc = deviceCurrents.get(component.reference)
    if (dc !== undefined) {
      current = [{ x: 0, y: dc }]
      currentBasis = 'solved device current'
    }
  }
  if (!current && kind === 'resistor') {
    const ohms = numericProperty(component.properties, ['value', 'resistance', 'r'])
    if (ohms !== undefined && ohms > 0) {
      current = voltage.data.map((point) => ({ x: point.x, y: point.y / ohms }))
      currentBasis = "Ohm's law from the solved node voltages"
    }
  }
  if (!current && kind === 'capacitor') {
    // At DC the capacitor current is exactly zero; during transient the current
    // waveform is emitted by the solver. A missing transient trace is unknown.
    if (voltage.data.length === 1) {
      current = [{ x: voltage.data[0].x, y: 0 }]
      currentBasis = 'ideal capacitor at DC'
    }
  }

  let powerAverage: number | undefined
  let powerPeak: number | undefined
  if (current && voltage.data.length === 1) {
    // A DC operating point is one sample: V·I is exact and there is nothing
    // to integrate.
    const sample = interpolate(current, voltage.data[0].x)
    if (sample !== undefined) {
      powerAverage = voltage.data[0].y * sample
      powerPeak = Math.abs(powerAverage)
    }
  } else if (current) {
    powerAverage = averagePowerOf(voltage.data, current)
    powerPeak = Math.max(
      ...voltage.data.map((point) => {
        const sample = interpolate(current as Series[], point.x)
        return sample === undefined ? 0 : Math.abs(point.y * sample)
      }),
    )
  }
  const reversePeak = kind === 'diode' ? Math.max(0, -minValue(voltage.data)) : undefined

  return {
    voltage: voltage.data,
    current,
    voltageBasis: voltage.basis,
    currentBasis,
    powerAverage: powerAverage === undefined ? undefined : Math.abs(powerAverage),
    powerSignedAverage: powerAverage,
    powerPeak,
    reversePeak,
  }
}

function thermalFor(
  component: DesignComponentSnapshot,
  powerAverageW: number | undefined,
  ambientC: number,
  thetaJaOverride?: number,
): ThermalEstimate | undefined {
  if (powerAverageW === undefined || !Number.isFinite(powerAverageW) || powerAverageW <= 0) return undefined
  const theta = thetaJaOverride !== undefined && thetaJaOverride > 0
    ? { thetaJa: thetaJaOverride, estimated: false }
    : thetaJaFor(component)
  if (!theta) return undefined
  const riseC = powerAverageW * theta.thetaJa
  const junctionC = ambientC + riseC
  const limitC = tjMaxFor(component)
  return {
    ambientC,
    riseC,
    junctionC,
    thetaJa: theta.thetaJa,
    estimated: theta.estimated,
    package: theta.package,
    limitC,
    status: limitC === undefined ? undefined : statusFor(junctionC / limitC),
  }
}

function componentKind(component: DesignComponentSnapshot): PartKind {
  return classifyPart(component.part)
}

/**
 * Build the margining report from a design snapshot and a solved result.
 *
 * Only `dc`, `transient`, `dc-sweep` produce the single solved operating point
 * or physical time series that supports power averaging. AC and noise results
 * are frequency-domain magnitudes, and a Monte Carlo result is a statistical
 * envelope rather than one bias. Margining any of those would be a category
 * error, so the report says so instead of returning a number.
 */
export function assessDesignMargins(
  snapshot: DesignSnapshot,
  result: SimulationResult | null,
  options: { ambientCelsius?: number; thetaJaOverride?: number } = {},
): DesignMarginReport {
  const ambientCelsius =
    options.ambientCelsius ??
    result?.temperatureCelsius ??
    27
  const assumptions: string[] = [
    `Ambient temperature ${ambientCelsius.toFixed(1)} °C.`,
    'Junction temperature is a first-order estimate: Tj = Tambient + average power × θJA. It is not a board-level thermal simulation.',
    'θJA comes from a typical single-layer package table unless the component declares thetaJA; real copper area, airflow and neighbouring parts change it.',
    'Warnings start at 80 % of a declared rating; failures above 100 %.',
    'The power budget compares source delivery with resistor/semiconductor dissipation over the same window; capacitors and inductors store reactive energy, so the two totals need not match exactly in a finite transient.',
  ]
  if (options.thetaJaOverride !== undefined) {
    assumptions.push(
      `θJA ${options.thetaJaOverride} K/W was supplied for every component by the caller; per-part declarations are ignored.`,
    )
  }
  const notes: string[] = []
  const items: MarginItem[] = []
  const measurements: ComponentMeasurement[] = []
  const unrated: UnratedComponent[] = []

  if (snapshot.components.length === 0) {
    return {
      items: [],
      measurements: [],
      ambientCelsius,
      power: { sourceCount: 0, basis: 'no circuit' },
      coverage: { components: 0, evaluated: 0, unrated: [] },
      assumptions,
      notes: ['Draw at least one component before checking margins.'],
    }
  }
  if (!result) {
    return {
      items: [],
      measurements: [],
      ambientCelsius,
      power: { sourceCount: 0, basis: 'no run' },
      coverage: { components: snapshot.components.length, evaluated: 0, unrated: [] },
      assumptions,
      notes: ['Run a DC operating point or transient analysis to measure the design.'],
    }
  }
  if (result.analysis !== 'dc' && result.analysis !== 'transient' && result.analysis !== 'dc-sweep') {
    const frequencyDomain = result.analysis === 'ac' || result.analysis === 'noise'
    return {
      items: [],
      measurements: [],
      ambientCelsius,
      power: { sourceCount: 0, basis: result.analysis ?? 'unknown' },
      coverage: { components: snapshot.components.length, evaluated: 0, unrated: [] },
      assumptions,
      notes: [
        frequencyDomain
          ? `${result.analysis} is frequency-domain; rating margins need a DC, transient or DC-sweep run.`
          : `${result.analysis ?? 'This analysis'} reports a statistical envelope, not one solved bias; rating margins need a DC, transient or DC-sweep run.`,
      ],
    }
  }
  if (!result.success) {
    notes.push('The last run did not converge, so its numbers are not usable for margins.')
  }

  const nodeWaveforms = new Map<string, Series[]>()
  const currentWaveforms = new Map<string, Series[]>()
  for (const waveform of result.waveforms ?? []) {
    const voltage = /^V\((.+)\)$/.exec(waveform.name)
    if (voltage) nodeWaveforms.set(voltage[1], waveform.data)
    const current = /^I\((.+)\)$/.exec(waveform.name)
    if (current) currentWaveforms.set(current[1], waveform.data)
  }
  const deviceCurrents = new Map(Object.entries(result.deviceCurrents ?? {}))
  const dcSweep = result.analysis === 'dc-sweep'
  const powerBasis = dcSweep
    ? 'maximum over the sweep (power vs. swept value)'
    : result.analysis === 'transient'
      ? 'window average from the transient'
      : 'DC operating point'
  if (dcSweep) {
    assumptions.push(
      'DC-sweep power is the maximum V·I over the swept value, not a time average; it bounds the rating but does not represent RMS heating.',
    )
  }

  let suppliedW: number | undefined
  let dissipatedW: number | undefined
  let sourceCount = 0

  for (const component of snapshot.components) {
    const kind = componentKind(component)
    if (kind === 'ground') continue

    const traces = tracesFor(component, kind, result, nodeWaveforms, deviceCurrents, currentWaveforms)
    const voltagePeak = traces ? maxAbs(traces.voltage) : undefined
    const currentPeak = traces?.current ? maxAbs(traces.current) : undefined
    const measurement: ComponentMeasurement = {
      componentId: component.id,
      reference: component.reference,
      part: component.part,
      kind,
    }
    if (voltagePeak !== undefined) measurement.voltagePeakV = voltagePeak
    if (traces?.reversePeak !== undefined && traces.reversePeak > 0) measurement.reversePeakV = traces.reversePeak
    if (currentPeak !== undefined) measurement.currentPeakA = currentPeak
    if (traces?.powerAverage !== undefined && !dcSweep) measurement.powerAverageW = traces.powerAverage
    if (traces?.powerPeak !== undefined) measurement.powerPeakW = traces.powerPeak
    measurements.push(measurement)

    if (kind === 'source' && traces?.powerSignedAverage !== undefined) {
      sourceCount += 1
      // MNA branch current enters the source's positive terminal, so delivered
      // power is the negative of V·I. A source that absorbs power contributes
      // nothing to the supply total.
      const delivered = -traces.powerSignedAverage
      if (delivered > 0) suppliedW = (suppliedW ?? 0) + delivered
    }
    const heatPower = dcSweep ? traces?.powerPeak : traces?.powerAverage
    // Only parts that turn electrical energy into heat get a dissipation
    // rating and a junction-temperature estimate. A capacitor's ideal V·I
    // averages to zero, and a source's package does not describe its heating;
    // applying a chip-resistor rating to either invents a thermal problem.
    const dissipative =
      kind === 'resistor' || kind === 'diode' || kind === 'bjt' || kind === 'mosfet' || kind === 'jfet'
    if (dissipative && heatPower !== undefined) {
      dissipatedW = (dissipatedW ?? 0) + heatPower
    }
    const thermal = dissipative ? thermalFor(component, heatPower, ambientCelsius, options.thetaJaOverride) : undefined
    if (thermal) measurement.thermal = thermal

    const componentItems: MarginItem[] = []
    const addItem = (
      quantity: MarginQuantity,
      label: string,
      value: number,
      rated: { limit: number; source: string },
      unit: string,
      basis: string,
      thermal?: ThermalEstimate,
    ): void => {
      const utilization = value / rated.limit
      componentItems.push({
        id: `${component.reference}.${quantity}`,
        componentId: component.id,
        reference: component.reference,
        part: component.part,
        quantity,
        value,
        limit: rated.limit,
        unit,
        utilization,
        status: statusFor(utilization),
        basis: `${label}: ${basis}, limit from ${rated.source}`,
        thermal,
      })
    }

    const powerLimit = declaredPowerLimit(component)
    if (dissipative && heatPower !== undefined && powerLimit) {
      addItem(
        'power',
        dcSweep ? 'Peak power' : 'Average power',
        heatPower,
        powerLimit,
        'W',
        powerBasis,
        thermal,
      )
    }
    if (thermal?.limitC !== undefined && thermal.status) {
      addItem(
        'junction-temperature',
        'Junction temperature',
        thermal.junctionC,
        { limit: thermal.limitC, source: 'declared Tj(max)' },
        '°C',
        `estimated from ${thermal.estimated ? 'typical package θJA' : 'declared θJA'}`,
        thermal,
      )
    }

    if (kind === 'resistor' && voltagePeak !== undefined) {
      // A resistor's package voltage limit is not in the chip table; only use
      // an explicit declaration. Peak power is reported even without a limit.
      const voltageLimit = declaredVoltageLimit(component, kind)
      if (voltageLimit) addItem('voltage', 'Peak voltage', voltagePeak, voltageLimit, 'V', traces?.voltageBasis ?? 'solved voltage')
    }

    if (kind === 'capacitor' && voltagePeak !== undefined) {
      const voltageLimit = capacitorVoltageLimit(component)
      if (voltageLimit) addItem('voltage', 'Peak voltage', voltagePeak, voltageLimit, 'V', traces?.voltageBasis ?? 'solved voltage')
      else unrated.push({ reference: component.reference, part: component.part, reason: 'no capacitor voltage rating declared' })
    }

    if (kind === 'inductor' && currentPeak !== undefined) {
      const currentLimit = declaredCurrentLimit(component, kind)
      if (currentLimit) addItem('current', 'Peak current', currentPeak, currentLimit, 'A', traces?.currentBasis ?? 'solved current')
      else unrated.push({ reference: component.reference, part: component.part, reason: 'no inductor current rating declared' })
    }

    if (kind === 'bjt' || kind === 'mosfet' || kind === 'jfet') {
      const voltageLimit = declaredVoltageLimit(component, kind)
      if (voltageLimit && voltagePeak !== undefined) {
        addItem('voltage', kind === 'bjt' ? 'Peak Vce' : 'Peak Vds', voltagePeak, voltageLimit, 'V', traces?.voltageBasis ?? 'solved voltage')
      }
      const currentLimit = declaredCurrentLimit(component, kind)
      if (currentLimit && currentPeak !== undefined) {
        addItem('current', kind === 'bjt' ? 'Peak Ic' : 'Peak Id', currentPeak, currentLimit, 'A', traces?.currentBasis ?? 'solved current')
      }
      if (!voltageLimit && !currentLimit) {
        unrated.push({
          reference: component.reference,
          part: component.part,
          reason: 'semiconductor ratings need a vendor part number or explicit limits',
        })
      }
    }

    if (kind === 'diode') {
      const voltageLimit = declaredVoltageLimit(component, kind)
      if (voltageLimit && traces?.reversePeak !== undefined) {
        addItem('voltage', 'Peak reverse voltage', traces.reversePeak, voltageLimit, 'V', traces.voltageBasis)
      } else if (!voltageLimit) {
        unrated.push({
          reference: component.reference,
          part: component.part,
          reason: 'no diode reverse-voltage rating declared',
        })
      }
    }

    if (kind === 'source') {
      // Sources have no consumption rating in the symbol; their delivered
      // power is part of the power budget, not a margin item.
    }

    if (componentItems.length === 0 && kind !== 'source') {
      const already = unrated.some((entry) => entry.reference === component.reference)
      if (!already) {
        unrated.push({
          reference: component.reference,
          part: component.part,
          reason: 'no measurable rating and current for an assessment',
        })
      }
    }
    items.push(...componentItems)
  }

  items.sort((a, b) => {
    const rank = (status: MarginStatus): number => (status === 'fail' ? 0 : status === 'warn' ? 1 : 2)
    return rank(a.status) - rank(b.status) || b.utilization - a.utilization || a.id.localeCompare(b.id)
  })
  measurements.sort((a, b) => {
    const left = a.thermal?.junctionC ?? -Infinity
    const right = b.thermal?.junctionC ?? -Infinity
    return right - left || a.reference.localeCompare(b.reference)
  })

  const worst = items[0]
  const hottest = measurements
    .filter((measurement) => measurement.thermal)
    .sort((a, b) => (b.thermal?.junctionC ?? 0) - (a.thermal?.junctionC ?? 0))[0]

  if (items.length === 0) {
    notes.push(
      'No component declared a rating that could be compared with this run. Add a power/voltage/current rating ' +
        'or a vendor part number to get margins.',
    )
  }
  if (unrated.length > 0) {
    notes.push(
      `${unrated.length} component${unrated.length === 1 ? '' : 's'} could not be rated: ` +
        unrated.map((entry) => entry.reference).join(', ') + '.',
    )
  }

  const limitingFactor = worst
    ? `${worst.reference} ${worst.quantity} at ${(worst.utilization * 100).toFixed(1)} % of its ` +
      `${worst.limit.toPrecision(3)} ${worst.unit} limit`
    : undefined

  return {
    items,
    measurements,
    worst,
    limitingFactor,
    hottest: hottest?.thermal
      ? { reference: hottest.reference, part: hottest.part, thermal: hottest.thermal }
      : undefined,
    ambientCelsius,
    power: {
      suppliedW,
      dissipatedW,
      sourceCount,
      basis: powerBasis,
    },
    coverage: {
      components: snapshot.components.filter((component) => componentKind(component) !== 'ground').length,
      evaluated: new Set(items.map((item) => item.componentId)).size,
      unrated,
    },
    assumptions,
    notes,
  }
}
