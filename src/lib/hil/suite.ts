/**
 * The serialisable half of a HIL suite: what the panel edits, what the engine
 * runs, and what an export carries.
 *
 * Draft values stay strings. A number field that parses on every keystroke
 * cannot hold `-`, `0.` or an empty box while an engineer is typing, and a suite
 * that silently rewrote `4.` to `4` on the way to the solver would be worse than
 * one that refuses to run until the value is a number. Parsing happens once, at
 * build time, and every refusal is a message the panel can point at.
 */
import type { HILTestCase, HILTestConfig } from '../programming/boardProgrammer'
import {
  DEFAULT_ANALOG_TOLERANCE,
  HIL_BUSES,
  formatBytes,
  parseHexBytes,
  payloadBuses,
  type HilBus,
  type HilPayload,
} from './hilRig'
import { csvCell } from '../csv'

export type CaseFilter = 'all' | 'passed' | 'failed' | 'unrun'

export const CASE_FILTERS: ReadonlyArray<{ id: CaseFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'passed', label: 'Passed' },
  { id: 'failed', label: 'Failed' },
  { id: 'unrun', label: 'Not run' },
]

export interface DigitalDraft {
  key: string
  channel: string
  high: boolean
}

export interface AnalogDraft {
  key: string
  channel: string
  value: string
  /** Absolute ± volts. Blank means the engine default. Expectations only. */
  tolerance: string
}

export interface CanDraft {
  key: string
  id: string
  data: string
}

export interface HexDraft {
  active: boolean
  hex: string
}

export interface I2cDraft {
  active: boolean
  address: string
  hex: string
}

export interface UartDraft {
  active: boolean
  text: string
}

/** One direction of a case. Tolerance is read for expectations, address for inputs. */
export interface PayloadDraft {
  digital: DigitalDraft[]
  analog: AnalogDraft[]
  can: CanDraft[]
  spi: HexDraft
  i2c: I2cDraft
  uart: UartDraft
}

export interface CaseDraft {
  /** Stable identity for React and selection; the authored `id` is free to change. */
  key: string
  id: string
  name: string
  description: string
  settlingMs: string
  enabled: boolean
  inputs: PayloadDraft
  expected: PayloadDraft
}

export interface SuiteDesign {
  interfaces: Record<HilBus, boolean>
  samplingHz: string
  timeoutMs: string
  rig: 'bench' | 'twin'
  temperatureC: string
  cases: CaseDraft[]
  filter: CaseFilter
  query: string
  selectedKey: string | null
}

export interface SuiteProblem {
  /** Null for a suite-level problem, otherwise the case it belongs to. */
  caseKey: string | null
  message: string
  /** A case-level problem that still refuses the whole suite (a duplicate id). */
  blocking?: boolean
}

let keySeq = 0
export const nextKey = (prefix: string): string => `${prefix}_${Date.now().toString(36)}_${(keySeq += 1)}`

export const emptyPayload = (): PayloadDraft => ({
  digital: [],
  analog: [],
  can: [],
  spi: { active: false, hex: '' },
  i2c: { active: false, address: '0x50', hex: '' },
  uart: { active: false, text: '' },
})

export const emptyCase = (index: number): CaseDraft => ({
  key: nextKey('case'),
  id: `case-${index}`,
  name: `Test case ${index}`,
  description: '',
  settlingMs: '20',
  enabled: true,
  inputs: emptyPayload(),
  expected: emptyPayload(),
})

const analogDraft = (channel: string, value: number, tolerance?: number): AnalogDraft => ({
  key: nextKey('ao'),
  channel,
  value: String(value),
  tolerance: tolerance === undefined ? '' : String(tolerance),
})

/** Adopt an engine case (the reference suite, an import) into editable drafts. */
export function draftFromTestCase(testCase: HILTestCase, key = nextKey('case')): CaseDraft {
  const inputs = emptyPayload()
  const expected = emptyPayload()
  for (const [channel, value] of Object.entries(testCase.inputs.analog ?? {})) {
    inputs.analog.push(analogDraft(channel, value))
  }
  for (const [channel, high] of Object.entries(testCase.inputs.digital ?? {})) {
    inputs.digital.push({ key: nextKey('di'), channel, high })
  }
  for (const frame of testCase.inputs.can ?? []) {
    inputs.can.push({ key: nextKey('can'), id: `0x${frame.id.toString(16).toUpperCase()}`, data: formatBytes(frame.data) })
  }
  if (testCase.inputs.spi) inputs.spi = { active: true, hex: formatBytes(testCase.inputs.spi) }
  if (testCase.inputs.i2c) {
    inputs.i2c = {
      active: true,
      address: `0x${testCase.inputs.i2c.address.toString(16).toUpperCase()}`,
      hex: formatBytes(testCase.inputs.i2c.data),
    }
  }
  if (testCase.inputs.uart !== undefined) inputs.uart = { active: true, text: testCase.inputs.uart }

  for (const [channel, value] of Object.entries(testCase.expectedOutputs.analog ?? {})) {
    expected.analog.push(analogDraft(channel, value, testCase.tolerances?.analog?.[channel]))
  }
  for (const [channel, high] of Object.entries(testCase.expectedOutputs.digital ?? {})) {
    expected.digital.push({ key: nextKey('di'), channel, high })
  }
  for (const frame of testCase.expectedOutputs.can ?? []) {
    expected.can.push({ key: nextKey('can'), id: `0x${frame.id.toString(16).toUpperCase()}`, data: formatBytes(frame.data) })
  }
  if (testCase.expectedOutputs.spi) expected.spi = { active: true, hex: formatBytes(testCase.expectedOutputs.spi) }
  if (testCase.expectedOutputs.i2c) expected.i2c = { active: true, address: '', hex: formatBytes(testCase.expectedOutputs.i2c) }
  if (testCase.expectedOutputs.uart !== undefined) expected.uart = { active: true, text: testCase.expectedOutputs.uart }

  return {
    key,
    id: testCase.id,
    name: testCase.name,
    description: testCase.description ?? '',
    settlingMs: String(testCase.settlingTime ?? 100),
    enabled: true,
    inputs,
    expected,
  }
}

export function defaultSuite(reference: readonly HILTestCase[]): SuiteDesign {
  const cases = reference.map((testCase) => draftFromTestCase(testCase))
  return {
    interfaces: { digital: false, analog: true, can: false, spi: false, i2c: false, uart: false },
    samplingHz: '1000',
    timeoutMs: '5000',
    rig: 'twin',
    temperatureC: '27',
    cases,
    filter: 'all',
    query: '',
    selectedKey: cases[0]?.key ?? null,
  }
}

/** Plain finite number, with an optional trailing V/v on analog fields. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(/\s*[vV]$/, '')
  if (trimmed.length === 0) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** CAN identifiers are written `0x1F2` or `498`; both must land on an integer. */
export function parseId(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed.length === 0) return null
  const value = /^0x[0-9a-f]+$/i.test(trimmed) ? Number.parseInt(trimmed, 16) : Number(trimmed)
  return Number.isInteger(value) && value >= 0 ? value : null
}

/**
 * The two directions are not the same shape: I²C stimulus is an addressed
 * frame, an I²C assertion is the bytes that came back. Overloads keep that
 * distinction in the type instead of asserting it away at the assignment.
 */
function buildPayload(draft: PayloadDraft, direction: 'inputs', problems: string[], label: string): HILTestCase['inputs'] | null
function buildPayload(draft: PayloadDraft, direction: 'expected', problems: string[], label: string): HILTestCase['expectedOutputs'] | null
function buildPayload(
  draft: PayloadDraft,
  direction: 'inputs' | 'expected',
  problems: string[],
  label: string,
): HilPayload | null {
  const payload: HilPayload = {}
  const fail = (message: string): void => { problems.push(`${label}: ${message}`) }

  if (draft.digital.length > 0) {
    const digital: Record<string, boolean> = {}
    for (const row of draft.digital) {
      const channel = row.channel.trim()
      if (!channel) { fail('a digital row has no pin name'); continue }
      if (channel in digital) { fail(`digital pin "${channel}" is declared twice`); continue }
      digital[channel] = row.high
    }
    if (Object.keys(digital).length > 0) payload.digital = digital
  }

  if (draft.analog.length > 0) {
    const analog: Record<string, number> = {}
    for (const row of draft.analog) {
      const channel = row.channel.trim()
      if (!channel) { fail('an analog row has no net name'); continue }
      if (channel in analog) { fail(`analog channel "${channel}" is declared twice`); continue }
      const value = parseNumber(row.value)
      if (value === null) { fail(`"${channel}" is not a number ("${row.value}")`); continue }
      analog[channel] = value
    }
    if (Object.keys(analog).length > 0) payload.analog = analog
  }

  if (draft.can.length > 0) {
    const frames: Array<{ id: number; data: Uint8Array }> = []
    for (const row of draft.can) {
      const id = parseId(row.id)
      if (id === null) { fail(`CAN id "${row.id}" is not a non-negative integer`); continue }
      const data = parseHexBytes(row.data)
      if (!data) { fail(`CAN payload "${row.data}" is not hex bytes (e.g. 01 A0 FF)`); continue }
      if (data.length > 8) { fail(`CAN frame 0x${id.toString(16).toUpperCase()} carries ${data.length} bytes; classical CAN allows 8`); continue }
      frames.push({ id, data })
    }
    if (frames.length > 0) payload.can = frames
  }

  if (draft.spi.active) {
    const bytes = parseHexBytes(draft.spi.hex)
    if (!bytes) fail(`SPI payload "${draft.spi.hex}" is not hex bytes`)
    else payload.spi = bytes
  }

  if (draft.i2c.active) {
    const bytes = parseHexBytes(draft.i2c.hex)
    if (!bytes) fail(`I²C payload "${draft.i2c.hex}" is not hex bytes`)
    else if (direction === 'inputs') {
      const address = parseId(draft.i2c.address)
      if (address === null || address > 0x7f) fail(`I²C address "${draft.i2c.address}" must be a 7-bit integer (0x00–0x7F)`)
      else payload.i2c = { address, data: bytes }
    } else payload.i2c = bytes
  }

  if (draft.uart.active) payload.uart = draft.uart.text

  return payloadBuses(payload).length > 0 ? payload : null
}

export interface BuiltCase {
  testCase: HILTestCase | null
  problems: SuiteProblem[]
}

export function buildCase(draft: CaseDraft, interfaces: Record<HilBus, boolean>): BuiltCase {
  const problems: SuiteProblem[] = []
  const add = (message: string): void => { problems.push({ caseKey: draft.key, message }) }
  const id = draft.id.trim()
  if (!id) add('The case needs an id.')
  if (!draft.name.trim()) add(`Case "${id || 'unnamed'}" needs a name.`)
  if (/\s/.test(id)) add(`Case id "${id}" must not contain whitespace.`)

  const settling = parseNumber(draft.settlingMs)
  if (settling === null || settling < 0) add(`Case "${id}": settling time must be a non-negative number of milliseconds.`)

  const label = `Case "${id || 'unnamed'}"`
  const inputProblems: string[] = []
  const outputProblems: string[] = []
  const inputs = buildPayload(draft.inputs, 'inputs', inputProblems, `${label} stimulus`)
  const expected = buildPayload(draft.expected, 'expected', outputProblems, `${label} assertion`)
  for (const message of [...inputProblems, ...outputProblems]) add(message)

  if (!inputs && !expected) {
    add(`${label} declares no stimulus and no assertion.`)
    return { testCase: null, problems }
  }

  const used = new Set<HilBus>([
    ...payloadBuses(inputs ?? {}),
    ...payloadBuses(expected ?? {}),
  ])
  for (const bus of used) {
    if (!interfaces[bus]) add(`${label} uses ${bus.toUpperCase()} I/O but that interface is switched off.`)
  }

  const tolerances: Record<string, number> = {}
  for (const row of draft.expected.analog) {
    const channel = row.channel.trim()
    if (!channel || row.tolerance.trim().length === 0) continue
    const tolerance = parseNumber(row.tolerance)
    if (tolerance === null || tolerance < 0) {
      add(`${label}: tolerance for "${channel}" must be a non-negative number of volts.`)
      continue
    }
    tolerances[channel] = tolerance
  }

  if (problems.length > 0) return { testCase: null, problems }

  const testCase: HILTestCase = {
    id,
    name: draft.name.trim(),
    inputs: inputs ?? {},
    expectedOutputs: expected ?? {},
    settlingTime: settling as number,
  }
  if (draft.description.trim()) testCase.description = draft.description.trim()
  if (Object.keys(tolerances).length > 0) testCase.tolerances = { analog: tolerances }
  return { testCase, problems }
}

export interface BuiltSuite {
  config: HILTestConfig | null
  problems: SuiteProblem[]
  /** Cases that built cleanly, in authored order. */
  cases: HILTestCase[]
}

export function buildSuite(
  design: SuiteDesign,
  options: { includeDisabled?: boolean } = {},
): BuiltSuite {
  const problems: SuiteProblem[] = []
  const enabled = HIL_BUSES.filter((bus) => design.interfaces[bus])
  if (enabled.length === 0) problems.push({ caseKey: null, message: 'Switch on at least one hardware interface.' })

  const sampling = parseNumber(design.samplingHz)
  if (sampling === null || sampling <= 0) {
    problems.push({ caseKey: null, message: 'Sampling rate must be a positive number of samples per second.' })
  }
  const timeout = parseNumber(design.timeoutMs)
  if (timeout === null || timeout <= 0) {
    problems.push({ caseKey: null, message: 'Timeout must be a positive number of milliseconds.' })
  }
  const temperature = parseNumber(design.temperatureC)
  if (design.rig === 'twin' && (temperature === null || temperature < -273.15)) {
    problems.push({ caseKey: null, message: 'Twin temperature must be a number at or above −273.15 °C.' })
  }

  const selected = design.cases.filter((draft) => options.includeDisabled || draft.enabled)
  if (selected.length === 0) {
    problems.push({ caseKey: null, message: 'The suite has no enabled test cases.' })
  }

  const cases: HILTestCase[] = []
  const seen = new Map<string, string>()
  for (const draft of selected) {
    const built = buildCase(draft, design.interfaces)
    problems.push(...built.problems)
    if (!built.testCase) continue
    const previous = seen.get(built.testCase.id)
    if (previous) {
      // Results are keyed by case id, so two cases claiming one id would
      // overwrite each other's verdict. Refuse the suite rather than pick one.
      problems.push({
        caseKey: draft.key,
        blocking: true,
        message: `Case id "${built.testCase.id}" is already used by "${previous}".`,
      })
      continue
    }
    seen.set(built.testCase.id, built.testCase.name)
    cases.push(built.testCase)
  }

  // A case-level problem refuses that case, not the suite: the cases that built
  // cleanly are still worth running, and the panel lists what was left out.
  const blocking = problems.filter((problem) => problem.caseKey === null || problem.blocking)
  if (blocking.length > 0 || cases.length === 0) return { config: null, problems, cases }
  return {
    config: {
      hardwareInterfaces: Object.fromEntries(HIL_BUSES.map((bus) => [bus, design.interfaces[bus]])),
      testCases: cases,
      samplingRate: sampling as number,
      timeout: timeout as number,
    },
    problems,
    cases,
  }
}

/** Buses a draft actually asserts, for the chips on a case row. */
export function draftBuses(draft: CaseDraft): HilBus[] {
  const buses = new Set<HilBus>()
  for (const payload of [draft.inputs, draft.expected]) {
    if (payload.digital.length > 0) buses.add('digital')
    if (payload.analog.length > 0) buses.add('analog')
    if (payload.can.length > 0) buses.add('can')
    if (payload.spi.active) buses.add('spi')
    if (payload.i2c.active) buses.add('i2c')
    if (payload.uart.active) buses.add('uart')
  }
  return HIL_BUSES.filter((bus) => buses.has(bus))
}

export function cloneCase(draft: CaseDraft, index: number): CaseDraft {
  const copy: CaseDraft = JSON.parse(JSON.stringify(draft)) as CaseDraft
  copy.key = nextKey('case')
  copy.id = `${draft.id}-copy${index > 1 ? `-${index}` : ''}`
  copy.name = `${draft.name} (copy)`
  const rekey = <T extends { key: string }>(rows: T[]): T[] =>
    rows.map((row) => ({ ...row, key: nextKey('row') }))
  for (const payload of [copy.inputs, copy.expected]) {
    payload.digital = rekey(payload.digital)
    payload.analog = rekey(payload.analog)
    payload.can = rekey(payload.can)
  }
  return copy
}

export interface VerdictRow {
  caseId: string
  caseName: string
  bus: string
  channel: string
  expected: string
  measured: string
  delta?: number
  tolerance?: number
  status: string
  reason?: string
  durationMs: number
  error?: string
}

/** One row per asserted channel — the export an engineer can diff against a bench log. */
export function verdictRows(
  results: ReadonlyArray<{
    testCaseId: string
    passed: boolean
    duration: number
    error?: string
    verdicts?: ReadonlyArray<{
      bus: string
      channel: string
      expected: string
      measured: string
      delta?: number
      tolerance?: number
      ok: boolean
      reason?: string
    }>
  }>,
  names: Record<string, string>,
): VerdictRow[] {
  const rows: VerdictRow[] = []
  for (const result of results) {
    const caseName = names[result.testCaseId] ?? result.testCaseId
    const verdicts = result.verdicts ?? []
    if (verdicts.length === 0) {
      rows.push({
        caseId: result.testCaseId, caseName, bus: '', channel: '', expected: '', measured: '',
        status: result.passed ? 'pass' : 'fail', durationMs: result.duration, error: result.error,
        reason: result.error,
      })
      continue
    }
    for (const verdict of verdicts) {
      rows.push({
        caseId: result.testCaseId,
        caseName,
        bus: verdict.bus,
        channel: verdict.channel,
        expected: verdict.expected,
        measured: verdict.measured,
        delta: verdict.delta,
        tolerance: verdict.tolerance,
        status: verdict.ok ? 'pass' : 'fail',
        reason: verdict.reason ?? result.error,
        durationMs: result.duration,
        error: result.error,
      })
    }
  }
  return rows
}

export function verdictsToCSV(rows: readonly VerdictRow[]): string {
  const header = [
    'case_id', 'case_name', 'bus', 'channel', 'expected', 'measured',
    'delta_v', 'tolerance_v', 'status', 'reason', 'duration_ms', 'error',
  ]
  const lines = rows.map((row) => [
    row.caseId, row.caseName, row.bus, row.channel, row.expected, row.measured,
    row.delta, row.tolerance, row.status, row.reason, row.durationMs, row.error,
  ].map(csvCell).join(','))
  return [header.join(','), ...lines].join('\r\n')
}

export const toleranceText = (text: string): string => {
  const value = parseNumber(text)
  return `±${value === null ? DEFAULT_ANALOG_TOLERANCE : value} V`
}