/**
 * The contract between a HIL suite and the thing it exercises.
 *
 * A suite is only assertions; a rig is what applies the stimulus and takes the
 * measurement. Keeping the two apart is what lets the same cases run against a
 * bench (which refuses closed when nothing is attached) or against the solved
 * circuit twin, without the engine pretending one is the other.
 */

export type HilBus = 'digital' | 'analog' | 'can' | 'spi' | 'i2c' | 'uart'

export const HIL_BUSES: readonly HilBus[] = ['digital', 'analog', 'can', 'spi', 'i2c', 'uart']

export const HIL_BUS_LABELS: Record<HilBus, string> = {
  digital: 'Digital GPIO',
  analog: 'Analog',
  can: 'CAN',
  spi: 'SPI',
  i2c: 'I²C',
  uart: 'UART',
}

/** One direction of a test case. `i2c` is an addressed frame in, bytes out. */
export type HilPayload = {
  digital?: Record<string, boolean>
  analog?: Record<string, number>
  can?: Array<{ id: number; data: Uint8Array }>
  spi?: Uint8Array
  i2c?: { address: number; data: Uint8Array } | Uint8Array
  uart?: string
}

export interface HilTolerances {
  analog?: Record<string, number>
  timing?: number
}

export interface HilRig {
  readonly id: string
  readonly label: string
  readonly kind: 'bench' | 'twin'
  /** Buses this rig can actually drive and measure. Anything else is refused. */
  readonly capabilities: readonly HilBus[]
  /** What the rig is, stated plainly enough to sit next to a verdict. */
  readonly note: string
  apply(inputs: HilPayload): Promise<void>
  measure(expected: HilPayload): Promise<HilPayload>
}

export interface HilChannelVerdict {
  bus: HilBus
  channel: string
  expected: string
  measured: string
  /** Signed measured − expected, for analog channels only. */
  delta?: number
  tolerance?: number
  ok: boolean
  reason?: string
}

/** Absolute analog tolerance when a case does not declare one, in volts. */
export const DEFAULT_ANALOG_TOLERANCE = 0.1

/**
 * Bus payloads cross JSON boundaries (project saves, exports) where a
 * `Uint8Array` survives as a plain object or array. Normalise all three spellings
 * so a restored case compares identically to a freshly authored one.
 */
export function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value
  if (Array.isArray(value)) {
    return value.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)
      ? Uint8Array.from(value as number[])
      : null
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
    if (entries.length === 0) return new Uint8Array(0)
    const indexed = entries.every(([key, entry]) => /^\d+$/.test(key) && Number.isInteger(entry))
    if (!indexed) return null
    const length = Math.max(...entries.map(([key]) => Number(key))) + 1
    const bytes = new Uint8Array(length)
    for (const [key, entry] of entries) {
      const byte = Number(entry)
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null
      bytes[Number(key)] = byte
    }
    return bytes
  }
  return null
}

export function formatBytes(value: unknown): string {
  const bytes = toBytes(value)
  if (!bytes) return '—'
  if (bytes.length === 0) return '(empty)'
  return Array.from(bytes, (byte) => byte.toString(16).toUpperCase().padStart(2, '0')).join(' ')
}

/** `0x1F2 · 01 02` for a CAN frame, `0x50 · 01 02` for an addressed I²C frame. */
export function formatFrame(value: unknown): string {
  if (value !== null && typeof value === 'object' && 'address' in (value as Record<string, unknown>)) {
    const frame = value as { address: unknown; data: unknown }
    return `0x${Number(frame.address).toString(16).toUpperCase()} · ${formatBytes(frame.data)}`
  }
  return formatBytes(value)
}

const hex = (value: number): string => `0x${value.toString(16).toUpperCase()}`

const numberText = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 1e6) / 1e6) : '—'

function bytesEqual(left: Uint8Array | null, right: Uint8Array | null): boolean {
  if (!left || !right || left.length !== right.length) return false
  return left.every((byte, index) => byte === right[index])
}

/**
 * Compare every channel the case asserts, on every bus.
 *
 * A channel that was never measured is a failure with a reason, not a silent
 * pass: the old engine only looked at digital and analog, so a UART assertion
 * could not fail even when the firmware said nothing.
 */
export function compareHilOutputs(
  measured: HilPayload,
  expected: HilPayload,
  tolerances: HilTolerances = {},
): HilChannelVerdict[] {
  const verdicts: HilChannelVerdict[] = []
  const push = (verdict: HilChannelVerdict): void => { verdicts.push(verdict) }

  for (const [pin, want] of Object.entries(expected.digital ?? {})) {
    const got = measured.digital?.[pin]
    push({
      bus: 'digital',
      channel: pin,
      expected: want ? 'HIGH' : 'LOW',
      measured: typeof got === 'boolean' ? (got ? 'HIGH' : 'LOW') : '—',
      ok: got === want,
      reason: typeof got === 'boolean' ? undefined : 'pin was not measured',
    })
  }

  for (const [channel, want] of Object.entries(expected.analog ?? {})) {
    const got = measured.analog?.[channel]
    const tolerance = tolerances.analog?.[channel] ?? DEFAULT_ANALOG_TOLERANCE
    const measurable = typeof got === 'number' && Number.isFinite(got) && Number.isFinite(want)
    const delta = measurable ? got - want : undefined
    push({
      bus: 'analog',
      channel,
      expected: `${numberText(want)} V`,
      measured: measurable ? `${numberText(got)} V` : '—',
      delta,
      tolerance,
      ok: measurable && Math.abs(delta as number) <= tolerance,
      reason: measurable
        ? Math.abs(delta as number) > tolerance
          ? `outside ±${numberText(tolerance)} V`
          : undefined
        : 'channel was not measured',
    })
  }

  const measuredFrames = measured.can ?? []
  for (const frame of expected.can ?? []) {
    const match = measuredFrames.find((entry) => entry.id === frame.id)
    const ok = Boolean(match) && bytesEqual(toBytes(match?.data), toBytes(frame.data))
    push({
      bus: 'can',
      channel: hex(frame.id),
      expected: formatBytes(frame.data),
      measured: match ? formatBytes(match.data) : '—',
      ok,
      reason: match ? (ok ? undefined : 'payload differs') : 'no frame with this id was measured',
    })
  }

  if (expected.spi !== undefined) {
    const ok = bytesEqual(toBytes(measured.spi), toBytes(expected.spi))
    push({
      bus: 'spi',
      channel: 'MISO',
      expected: formatBytes(expected.spi),
      measured: formatBytes(measured.spi),
      ok,
      reason: ok ? undefined : measured.spi === undefined ? 'no SPI response was measured' : 'payload differs',
    })
  }

  if (expected.i2c !== undefined) {
    const want = toBytes(
      expected.i2c !== null && typeof expected.i2c === 'object' && 'data' in expected.i2c
        ? expected.i2c.data
        : expected.i2c,
    )
    const gotFrame = measured.i2c
    const got = toBytes(
      gotFrame !== null && typeof gotFrame === 'object' && 'data' in gotFrame ? gotFrame.data : gotFrame,
    )
    const ok = bytesEqual(got, want)
    push({
      bus: 'i2c',
      channel: 'SDA',
      expected: formatFrame(expected.i2c),
      measured: gotFrame === undefined ? '—' : formatFrame(gotFrame),
      ok,
      reason: ok ? undefined : gotFrame === undefined ? 'no I²C response was measured' : 'payload differs',
    })
  }

  if (expected.uart !== undefined) {
    const got = measured.uart
    const ok = got === expected.uart
    push({
      bus: 'uart',
      channel: 'TX',
      expected: JSON.stringify(expected.uart),
      measured: typeof got === 'string' ? JSON.stringify(got) : '—',
      ok,
      reason: ok ? undefined : typeof got === 'string' ? 'response differs' : 'no UART response was measured',
    })
  }

  return verdicts
}

export function hilOutputsMatch(
  measured: HilPayload,
  expected: HilPayload,
  tolerances: HilTolerances = {},
): boolean {
  return compareHilOutputs(measured, expected, tolerances).every((verdict) => verdict.ok)
}

/** Buses a payload actually uses, in declaration order. */
export function payloadBuses(payload: HilPayload): HilBus[] {
  return HIL_BUSES.filter((bus) => payload[bus] !== undefined)
}

/** Parse `01 A0 ff` into bytes; returns null on any non-byte token. */
export function parseHexBytes(text: string): Uint8Array | null {
  const tokens = text.trim().split(/[\s,]+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return new Uint8Array(0)
  const bytes: number[] = []
  for (const token of tokens) {
    if (!/^(0x)?[0-9a-f]{1,2}$/i.test(token)) return null
    bytes.push(Number.parseInt(token.replace(/^0x/i, ''), 16))
  }
  return Uint8Array.from(bytes)
}