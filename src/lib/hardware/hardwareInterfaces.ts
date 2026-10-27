/**
 * Hardware Interfacing APIs — I²C, SPI, UART, CAN
 *
 * Architecture:
 *   • All four protocol classes expose a unified async API
 *   • UART: bridges to the browser WebSerial API when available; falls back to
 *     in-browser simulation so the rest of the app continues to function
 *   • I²C / SPI: use a native USB bridge when one is connected and simulated
 *     buses otherwise. Bridge traffic is newline-delimited JSON; every request
 *     carries an `id` and waits for the matching reply (or a timeout error).
 *     Malformed/missing replies reject rather than returning invented bytes.
 *   • CAN: simulated, or the SLCAN protocol over an attached UART bridge
 *   • HardwareInterfaceManager creates and tracks named instances
 *   • WebSerialBridge: standalone helper that wraps a SerialPort and exposes
 *     readable / writable streams for higher-level code
 */

// ── Shared types ──────────────────────────────────────────────────────────────

export interface I2CConfig {
  address: number
  clockSpeed: number     // Hz  (100 000 | 400 000 | 1 000 000)
  sda: number
  scl: number
  pullupResistors?: boolean
}

export interface I2CDevice {
  address: number
  registerMap?: Record<number, string>
}

export interface I2CTransaction {
  deviceAddress: number
  registerAddress?: number
  data?: Uint8Array
  readLength?: number
  stopCondition: boolean
  timestamp: number
}

export interface SPIConfig {
  mode: 0 | 1 | 2 | 3
  bitOrder: 'msb' | 'lsb'
  clockSpeed: number     // Hz
  mosi: number
  miso: number
  sck: number
  ss?: number
}

export interface SPITransaction {
  txData: Uint8Array
  rxData: Uint8Array
  timestamp: number
}

export interface UARTConfig {
  baudRate: number
  dataBits: 5 | 6 | 7 | 8
  stopBits: 1 | 2
  parity: 'none' | 'even' | 'odd'
  flowControl: 'none' | 'hardware' | 'software'
  tx?: number
  rx?: number
}

export interface UARTFrame {
  data: Uint8Array
  direction: 'tx' | 'rx'
  timestamp: number
}

export interface CANConfig {
  bitRate: number        // bps
  samplePoint?: number   // 0–100 %
  sjw?: number           // Synchronization Jump Width
  mode: 'normal' | 'loopback' | 'listen_only'
}

export interface CANMessage {
  id: number
  data: Uint8Array
  extendedId: boolean
  remoteFrame: boolean
  timestamp: number
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

interface SerialPortFilter {
  usbVendorId?: number
  usbProductId?: number
}

interface SerialConnectionOptions {
  baudRate: number
  dataBits?: 7 | 8
  stopBits?: 1 | 2
  parity?: 'none' | 'even' | 'odd'
  flowControl?: 'none' | 'hardware'
}

interface SerialPortLike {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open: (options: SerialConnectionOptions) => Promise<void>
  close: () => Promise<void>
}

interface NavigatorWithWebSerial extends Navigator {
  serial?: {
    requestPort: (options: { filters: SerialPortFilter[] }) => Promise<SerialPortLike>
  }
}

// ── WebSerial bridge ──────────────────────────────────────────────────────────

/**
 * Thin wrapper around the Web Serial API.
 * Falls back gracefully when running outside a secure context or in a browser
 * that does not support WebSerial.
 */
export class WebSerialBridge {
  private port: SerialPortLike | null = null
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private _state: ConnectionState = 'disconnected'
  private _receiveCallbacks: Array<(data: Uint8Array) => void> = []
  private lineBuffer = ''
  private nextRequestId = 1
  private pendingRequests = new Map<number, {
    resolve: (message: Record<string, unknown>) => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  get state(): ConnectionState { return this._state }
  get isAvailable(): boolean {
    return typeof navigator !== 'undefined' && typeof (navigator as NavigatorWithWebSerial).serial?.requestPort === 'function'
  }

  async requestPort(filters?: SerialPortFilter[]): Promise<boolean> {
    if (!this.isAvailable) return false
    try {
      this._state = 'connecting'
      const serial = (navigator as NavigatorWithWebSerial).serial
      if (!serial) return false
      this.port = await serial.requestPort({ filters: filters ?? [] })
      return true
    } catch (err) {
      this._state = 'error'
      console.warn('WebSerial: port request rejected', err)
      return false
    }
  }

  async open(options: SerialConnectionOptions): Promise<boolean> {
    if (!this.port) return false
    try {
      await this.port.open(options)
      this._state = 'connected'
      this.startReading()
      return true
    } catch (err) {
      this._state = 'error'
      console.warn('WebSerial: failed to open port', err)
      return false
    }
  }

  async write(data: Uint8Array): Promise<void> {
    if (!this.port?.writable) return
    const writer = this.writer ?? this.port.writable.getWriter()
    this.writer = writer
    await writer.write(data)
  }

  onData(callback: (data: Uint8Array) => void): void {
    this._receiveCallbacks.push(callback)
  }

  /**
   * Send a newline-delimited JSON command and wait for the bridge's reply with
   * the same `id`. The bridge protocol is documented in the module header; an
   * unanswered or unparsable reply rejects instead of returning invented data.
   */
  async request(command: Record<string, unknown>, timeoutMs = 1000): Promise<Record<string, unknown>> {
    if (this.state !== 'connected') throw new Error('WebSerial bridge is not connected')
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Bridge timeout must be positive')
    const id = this.nextRequestId++
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Bridge did not answer "${String(command.cmd)}" within ${timeoutMs} ms`))
      }, timeoutMs)
      this.pendingRequests.set(id, { resolve, reject, timer })
      this.write(new TextEncoder().encode(`${JSON.stringify({ ...command, id })}\n`)).catch(error => {
        clearTimeout(timer)
        this.pendingRequests.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  /** Feed bytes received from the port into the line-oriented response router. */
  ingest(data: Uint8Array): void {
    this.lineBuffer += new TextDecoder().decode(data)
    let newline = this.lineBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.lineBuffer.slice(0, newline).trim()
      this.lineBuffer = this.lineBuffer.slice(newline + 1)
      newline = this.lineBuffer.indexOf('\n')
      if (!line) continue
      let parsed: unknown
      try { parsed = JSON.parse(line) } catch { continue }
      if (typeof parsed !== 'object' || parsed === null) continue
      const message = parsed as Record<string, unknown>
      const id = message.id
      if (typeof id !== 'number') continue
      const pending = this.pendingRequests.get(id)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingRequests.delete(id)
        pending.resolve(message)
      }
    }
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pendingRequests.clear()
  }

  private async startReading(): Promise<void> {
    if (!this.port?.readable) return
    const reader = this.port.readable.getReader()
    this.reader = reader
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) {
          this.ingest(value)
          this._receiveCallbacks.forEach(cb => cb(value))
        }
      }
    } catch {
      /* port closed */
    }
  }

  async close(): Promise<void> {
    try {
      this.reader?.cancel()
      this.writer?.releaseLock()
      await this.port?.close()
    } catch { /* ignore */ } finally {
      this._state = 'disconnected'
      this.reader = null
      this.writer = null
      this.lineBuffer = ''
      this.rejectPending(new Error('WebSerial bridge closed before the request completed'))
    }
  }

  /** Simulate an incoming bridge line (tests and loopback diagnostics). */
  simulateData(data: string | Uint8Array): void {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
    this.ingest(bytes)
    this._receiveCallbacks.forEach(cb => cb(bytes))
  }
}

// ── I²C ───────────────────────────────────────────────────────────────────────

export class I2CInterface {
  private devices: Map<number, I2CDevice> = new Map()
  private txLog: I2CTransaction[] = []
  private bridge: WebSerialBridge | null = null

  constructor(private config: I2CConfig, bridge?: WebSerialBridge) {
    this.bridge = bridge ?? null
  }

  async initialize(): Promise<void> {
    if (this.bridge?.state === 'connected') {
      // Send a JSON "init" command to a USB-I2C bridge (e.g. CP2112)
      const cmd = new TextEncoder().encode(JSON.stringify({ cmd: 'i2c_init', config: this.config }) + '\n')
      await this.bridge.write(cmd)
    }
  }

  /** Scan bus 0x08–0x77 and return responding addresses */
  async scanBus(): Promise<number[]> {
    const found: number[] = []
    for (let addr = 0x08; addr <= 0x77; addr++) {
      if (await this.probeDevice(addr)) found.push(addr)
    }
    return found
  }

  async probeDevice(address?: number): Promise<boolean> {
    const addr = address ?? this.config.address
    if (this.bridge?.state === 'connected') {
      const reply = await this.bridge.request({ cmd: 'i2c_probe', address: addr })
      if (typeof reply.ack !== 'boolean') {
        throw new Error(`I2C bridge reply for probe 0x${addr.toString(16)} has no boolean "ack"`)
      }
      return reply.ack
    }
    // Simulated bus: devices at even addresses 0x10–0x50 are "present"
    return addr % 2 === 0 && addr >= 0x10 && addr <= 0x50
  }

  async writeRegister(deviceAddress: number, registerAddress: number, data: number | Uint8Array): Promise<void> {
    const bytes = typeof data === 'number' ? new Uint8Array([data]) : data
    const tx: I2CTransaction = { deviceAddress, registerAddress, data: bytes, stopCondition: true, timestamp: Date.now() }
    this.txLog.push(tx)
    if (this.bridge?.state === 'connected') {
      const cmd = new TextEncoder().encode(JSON.stringify({ cmd: 'i2c_write', addr: deviceAddress, reg: registerAddress, data: Array.from(bytes) }) + '\n')
      await this.bridge.write(cmd)
    }
  }

  async readRegister(deviceAddress: number, registerAddress: number, length = 1): Promise<Uint8Array> {
    if (!Number.isInteger(length) || length < 1) throw new Error('I2C read length must be a positive integer')
    const tx: I2CTransaction = { deviceAddress, registerAddress, readLength: length, stopCondition: true, timestamp: Date.now() }
    this.txLog.push(tx)
    if (this.bridge?.state === 'connected') {
      const reply = await this.bridge.request({ cmd: 'i2c_read', addr: deviceAddress, reg: registerAddress, len: length })
      return readByteArray(reply.data, length, `I2C read 0x${deviceAddress.toString(16)}:0x${registerAddress.toString(16)}`)
    }
    // Simulated bus: deterministic bytes derived from addr+reg
    return new Uint8Array(length).map((_, i) => (deviceAddress + registerAddress + i) & 0xff)
  }

  async write(deviceAddress: number, data: Uint8Array): Promise<void> {
    await this.writeRegister(deviceAddress, 0x00, data)
  }

  async read(deviceAddress: number, length: number): Promise<Uint8Array> {
    return this.readRegister(deviceAddress, 0x00, length)
  }

  registerDevice(device: I2CDevice): void {
    this.devices.set(device.address, device)
  }

  getTransactions(): I2CTransaction[] { return [...this.txLog] }
  getDevices(): I2CDevice[] { return Array.from(this.devices.values()) }
}

// ── SPI ───────────────────────────────────────────────────────────────────────

function readByteArray(value: unknown, expectedLength: number, what: string): Uint8Array {
  if (!Array.isArray(value) || value.length !== expectedLength) {
    throw new Error(`${what}: bridge reply must contain exactly ${expectedLength} bytes`)
  }
  const bytes = new Uint8Array(expectedLength)
  for (let i = 0; i < expectedLength; i += 1) {
    const byte = value[i]
    if (typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 0xff) {
      throw new Error(`${what}: bridge returned a non-byte value at index ${i}`)
    }
    bytes[i] = byte
  }
  return bytes
}

export class SPIInterface {
  private txLog: SPITransaction[] = []
  private chipSelectStates = new Map<number, boolean>()
  private bridge: WebSerialBridge | null = null

  constructor(private config: SPIConfig, bridge?: WebSerialBridge) {
    this.bridge = bridge ?? null
  }

  async initialize(): Promise<void> {
    if (this.bridge?.state === 'connected') {
      const cmd = new TextEncoder().encode(JSON.stringify({ cmd: 'spi_init', config: this.config }) + '\n')
      await this.bridge.write(cmd)
    }
  }

  async transfer(txData: Uint8Array, csPin?: number): Promise<Uint8Array> {
    let rxData: Uint8Array
    if (this.bridge?.state === 'connected') {
      const reply = await this.bridge.request({ cmd: 'spi_transfer', cs: csPin, data: Array.from(txData) })
      rxData = readByteArray(reply.data, txData.length, 'SPI transfer')
    } else {
      // Simulated MISO: invert bits
      rxData = new Uint8Array(txData.length)
      for (let i = 0; i < txData.length; i++) rxData[i] = (~txData[i]) & 0xff
    }
    this.txLog.push({ txData: new Uint8Array(txData), rxData, timestamp: Date.now() })
    return rxData
  }

  async write(data: Uint8Array, csPin?: number): Promise<void> { await this.transfer(data, csPin) }
  async read(length: number, csPin?: number): Promise<Uint8Array> { return this.transfer(new Uint8Array(length), csPin) }
  setChipSelect(pin: number, asserted: boolean): void {
    if (!Number.isInteger(pin) || pin < 0) throw new Error('Chip-select pin must be a non-negative integer')
    this.chipSelectStates.set(pin, asserted)
  }
  isChipSelectAsserted(pin: number): boolean { return this.chipSelectStates.get(pin) ?? false }
  getTransactions(): SPITransaction[] { return [...this.txLog] }
}

// ── UART ──────────────────────────────────────────────────────────────────────

export class UARTInterface {
  private frames: UARTFrame[] = []
  private rxCallbacks: Array<(data: Uint8Array) => void> = []
  private rxBuffer: number[] = []
  private rxWaiters: Array<{
    length: number
    resolve: (data: Uint8Array) => void
    reject: (error: Error) => void
    timer?: ReturnType<typeof setTimeout>
  }> = []
  private serialBridge: WebSerialBridge | null = null
  private _connected = false

  constructor(private config: UARTConfig) {}

  async initialize(): Promise<void> {
    // A UART needs no wire-level setup in the browser: the OS adapter is
    // configured when WebSerial opens the port in connect().
  }

  /**
   * Try to open a real serial port via the Web Serial API.
   * Returns true if successfully connected, false if WebSerial is unavailable
   * or the user cancels the port picker.
   */
  async connectWebSerial(filters?: SerialPortFilter[]): Promise<boolean> {
    if (!('serial' in navigator)) {
      console.info('[UART] WebSerial not available — using simulation')
      return false
    }
    const dataBits = this.config.dataBits
    if (dataBits !== 7 && dataBits !== 8) {
      console.warn('[UART] WebSerial supports only 7- or 8-bit data frames')
      return false
    }
    this.serialBridge = new WebSerialBridge()
    const acquired = await this.serialBridge.requestPort(filters)
    if (!acquired) return false

    const opened = await this.serialBridge.open({
      baudRate: this.config.baudRate,
      dataBits,
      stopBits: this.config.stopBits,
      parity: this.config.parity === 'none' ? 'none' : this.config.parity,
      flowControl: this.config.flowControl === 'hardware' ? 'hardware' : 'none',
    })
    if (opened) {
      this._connected = true
      this.serialBridge.onData(data => this._handleRx(data))
    }
    return opened
  }

  async disconnectWebSerial(): Promise<void> {
    await this.serialBridge?.close()
    this.serialBridge = null
    this._connected = false
    for (const waiter of this.rxWaiters) {
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.reject(new Error('UART disconnected before the requested bytes arrived'))
    }
    this.rxWaiters = []
  }

  get isConnected(): boolean { return this._connected }

  /**
   * Attach an already-opened bridge — a USB-serial adapter wrapper or a test
   * double — instead of going through the Web Serial port picker.
   */
  attachBridge(bridge: WebSerialBridge): void {
    this.serialBridge = bridge
    this._connected = bridge.state === 'connected'
    bridge.onData(data => this._handleRx(data))
  }

  async send(data: Uint8Array): Promise<void> {
    this.frames.push({ data: new Uint8Array(data), direction: 'tx', timestamp: Date.now() })
    if (this._connected && this.serialBridge) {
      await this.serialBridge.write(data)
    }
  }

  async sendString(text: string): Promise<void> {
    await this.send(new TextEncoder().encode(text))
  }

  receive(length: number, timeoutMs = 0): Promise<Uint8Array> {
    if (!Number.isInteger(length) || length < 0) return Promise.reject(new Error('Receive length must be a non-negative integer'))
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0) return Promise.reject(new Error('Receive timeout must be a non-negative number'))
    if (length === 0) return Promise.resolve(new Uint8Array())
    if (this.rxBuffer.length >= length) {
      return Promise.resolve(new Uint8Array(this.rxBuffer.splice(0, length)))
    }

    return new Promise((resolve, reject) => {
      const waiter = { length, resolve, reject } as (typeof this.rxWaiters)[number]
      if (timeoutMs > 0) {
        waiter.timer = setTimeout(() => {
          this.rxWaiters = this.rxWaiters.filter(candidate => candidate !== waiter)
          reject(new Error(`Timed out waiting for ${length} UART bytes`))
        }, timeoutMs)
      }
      this.rxWaiters.push(waiter)
    })
  }

  /** Manually inject RX bytes (for simulation / testing) */
  simulateReceive(data: Uint8Array): void {
    this._handleRx(data)
  }

  onReceive(callback: (data: Uint8Array) => void): void {
    this.rxCallbacks.push(callback)
  }

  private _handleRx(data: Uint8Array): void {
    const received = new Uint8Array(data)
    this.frames.push({ data: received, direction: 'rx', timestamp: Date.now() })
    this.rxBuffer.push(...received)
    this.flushReceiveWaiters()
    this.rxCallbacks.forEach(cb => cb(new Uint8Array(received)))
  }

  private flushReceiveWaiters(): void {
    while (this.rxWaiters.length > 0 && this.rxBuffer.length >= this.rxWaiters[0].length) {
      const waiter = this.rxWaiters.shift()!
      if (waiter.timer) clearTimeout(waiter.timer)
      waiter.resolve(new Uint8Array(this.rxBuffer.splice(0, waiter.length)))
    }
  }

  getFrames(): UARTFrame[] { return [...this.frames] }

  getAvailable(): number {
    return this.rxBuffer.length
  }
}

// ── CAN ───────────────────────────────────────────────────────────────────────

/**
 * Bit rates a Lawicel/SLCAN adapter can be programmed to with `S<code>`.
 * Anything else (CAN FD rates, 33.3 kbit/s) is rejected instead of silently
 * falling back to the adapter's previous speed — a wrong bit rate on a real
 * bus means corrupted frames, not a degraded simulation.
 */
const SLCAN_SPEED_CODES: ReadonlyMap<number, number> = new Map([
  [25_000, 0], [50_000, 1], [100_000, 2], [125_000, 3],
  [250_000, 4], [500_000, 5], [800_000, 6], [1_000_000, 7],
])

/** Classic CAN carries at most 8 data bytes and a 0–8 DLC. */
const CAN_MAX_DATA_BYTES = 8
const CAN_MAX_STANDARD_ID = 0x7ff
const CAN_MAX_EXTENDED_ID = 0x1fffffff

/**
 * SLCAN setup written to the bridge before the first frame: bit rate,
 * operating mode, then open the bus. SLCAN has no loopback command, so
 * loopback is emulated locally by echoing transmitted frames back in.
 */
function slcanSetupCommands(config: CANConfig): string[] {
  const speed = SLCAN_SPEED_CODES.get(config.bitRate)
  if (speed === undefined) {
    const supported = Array.from(SLCAN_SPEED_CODES.keys()).sort((a, b) => a - b).join(', ')
    throw new RangeError(`CAN bit rate ${config.bitRate} bps is not SLCAN-programmable (supported: ${supported} bps)`)
  }
  const mode = config.mode === 'listen_only' ? 'm1' : 'm0'
  return [`S${speed}`, mode, 'O']
}

/** One CAN frame as an SLCAN line, terminated with the protocol's CR. */
function encodeSLCANFrame(message: CANMessage): string {
  const idDigits = message.extendedId ? 8 : 3
  const id = message.id.toString(16).toUpperCase().padStart(idDigits, '0')
  const type = message.remoteFrame
    ? (message.extendedId ? 'R' : 'r')
    : (message.extendedId ? 'T' : 't')
  const data = Array.from(message.data, byte => byte.toString(16).toUpperCase().padStart(2, '0')).join('')
  return `${type}${id}${message.data.length}${data}\r`
}

/** Reject frames a CAN controller would never put on the bus. */
function assertValidFrame(message: CANMessage): void {
  const maxId = message.extendedId ? CAN_MAX_EXTENDED_ID : CAN_MAX_STANDARD_ID
  const width = message.extendedId ? '29-bit extended' : '11-bit standard'
  if (!Number.isInteger(message.id) || message.id < 0 || message.id > maxId) {
    throw new RangeError(`CAN identifier ${message.id} does not fit an ${width} id (0–${maxId})`)
  }
  if (message.data.length > CAN_MAX_DATA_BYTES) {
    throw new RangeError(`classic CAN carries at most ${CAN_MAX_DATA_BYTES} data bytes, got ${message.data.length}`)
  }
  if (message.remoteFrame && message.data.length > 0) {
    throw new RangeError('a CAN remote frame requests data and carries none itself')
  }
}

export class CANInterface {
  private messages: CANMessage[] = []
  private filters: Array<{ id: number; mask: number; extended: boolean }> = []
  private rxCallbacks: Array<(msg: CANMessage) => void> = []
  /** CAN uses a UART bridge internally (e.g. Lawicel SLCAN protocol) */
  private uart: UARTInterface | null = null
  /** SLCAN commands derived from the config; throws on an unusable bit rate. */
  private readonly setupCommands: string[]
  private bridgeConfigured = false

  constructor(private config: CANConfig) {
    if (config.samplePoint !== undefined && (config.samplePoint <= 0 || config.samplePoint > 100)) {
      throw new RangeError(`CAN sample point must lie in (0, 100] %, got ${config.samplePoint}`)
    }
    if (config.sjw !== undefined && (!Number.isInteger(config.sjw) || config.sjw < 1 || config.sjw > 4)) {
      throw new RangeError(`CAN synchronisation jump width must be 1–4 quanta, got ${config.sjw}`)
    }
    this.setupCommands = slcanSetupCommands(config)
  }

  /** Bit rate, mode and sample point actually programmed onto the bus. */
  getConfig(): CANConfig { return { ...this.config } }

  async initialize(): Promise<void> {
    // SLCAN adapters are programmed over the serial line, so the setup
    // commands are written the first time a connected bridge is attached.
    if (this.uart?.isConnected) await this.configureBridge()
  }

  /** Attach a UART bridge running the SLCAN protocol and program the adapter. */
  async attachUARTBridge(uart: UARTInterface): Promise<void> {
    this.uart = uart
    this.bridgeConfigured = false
    uart.onReceive(raw => this._parseSLCAN(raw))
    if (uart.isConnected) await this.configureBridge()
  }

  private async configureBridge(): Promise<void> {
    if (!this.uart || this.bridgeConfigured) return
    this.bridgeConfigured = true
    try {
      for (const command of this.setupCommands) await this.uart.sendString(`${command}\r`)
    } catch (error) {
      this.bridgeConfigured = false
      throw error
    }
  }

  async send(message: CANMessage): Promise<boolean> {
    assertValidFrame(message)
    if (this.config.mode === 'listen_only') return false
    const msg: CANMessage = { ...message, timestamp: Date.now() }
    this.messages.push(msg)

    if (this.uart?.isConnected) {
      await this.configureBridge()
      await this.uart.sendString(encodeSLCANFrame(msg))
    }
    // Loopback is a controller-side setting SLCAN cannot express, so the
    // interface echoes its own transmissions back through the receive path.
    if (this.config.mode === 'loopback') this.simulateReceive(msg)
    return true
  }

  async receive(timeoutMs = 0): Promise<CANMessage | null> {
    if (this.messages.length > 0) return this.messages.shift()!
    if (timeoutMs > 0) {
      await new Promise(r => setTimeout(r, Math.min(timeoutMs, 100)))
    }
    return null
  }

  setFilter(id: number, mask: number, extended = false): void {
    this.filters.push({ id, mask, extended })
  }

  onReceive(callback: (msg: CANMessage) => void): void {
    this.rxCallbacks.push(callback)
  }

  simulateReceive(message: CANMessage): void {
    // Inject the message exactly as provided — callers (tests, manual
    // injection) own the timestamp. Arrival time is stamped by _parseSLCAN,
    // which builds messages before calling this method.
    const msg = { ...message }
    if (this._passesFilter(msg)) {
      this.messages.push(msg)
      this.rxCallbacks.forEach(cb => cb(msg))
    }
  }

  private _passesFilter(msg: CANMessage): boolean {
    if (this.filters.length === 0) return true
    return this.filters.some(f => (msg.id & f.mask) === (f.id & f.mask))
  }

  private _parseSLCAN(raw: Uint8Array): void {
    const text = new TextDecoder().decode(raw).trim()
    const type = text.charAt(0)
    const extended = type === 'T' || type === 'R'
    if (type !== 't' && type !== 'T' && type !== 'r' && type !== 'R') return
    // The id field is fixed width: 3 hex digits for an 11-bit frame, 8 for a
    // 29-bit one. Parsing it greedily would steal the DLC digit that follows.
    const idDigits = extended ? 8 : 3
    const idHex = text.slice(1, 1 + idDigits)
    const dlcChar = text.charAt(1 + idDigits)
    const dataHex = text.slice(2 + idDigits)
    if (!/^[0-9a-fA-F]+$/.test(idHex) || !/^[0-8]$/.test(dlcChar)) return
    const dlc = Number(dlcChar)
    if (dataHex.length !== dlc * 2 || !/^[0-9a-fA-F]*$/.test(dataHex)) return
    if ((type === 'r' || type === 'R') && dlc > 0) return
    const data = new Uint8Array(dlc)
    for (let i = 0; i < dlc; i++) data[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16)
    const msg: CANMessage = {
      id: parseInt(idHex, 16),
      data,
      extendedId: extended,
      remoteFrame: type === 'r' || type === 'R',
      timestamp: Date.now(),
    }
    this.simulateReceive(msg)
  }

  getMessages(): CANMessage[] { return [...this.messages] }
}

// ── Manager ───────────────────────────────────────────────────────────────────

export class HardwareInterfaceManager {
  private i2cMap = new Map<string, I2CInterface>()
  private spiMap = new Map<string, SPIInterface>()
  private uartMap = new Map<string, UARTInterface>()
  private canMap = new Map<string, CANInterface>()

  // ── Factory methods ────────────────────────────────────────────────────────

  createI2C(name: string, config: I2CConfig, bridge?: WebSerialBridge): I2CInterface {
    const iface = new I2CInterface(config, bridge)
    this.i2cMap.set(name, iface)
    iface.initialize()
    return iface
  }
  createI2CInterface = this.createI2C.bind(this)

  createSPI(name: string, config: SPIConfig, bridge?: WebSerialBridge): SPIInterface {
    const iface = new SPIInterface(config, bridge)
    this.spiMap.set(name, iface)
    iface.initialize()
    return iface
  }
  createSPIInterface = this.createSPI.bind(this)

  createUART(name: string, config: UARTConfig): UARTInterface {
    const iface = new UARTInterface(config)
    this.uartMap.set(name, iface)
    iface.initialize()
    return iface
  }
  createUARTInterface = this.createUART.bind(this)

  createCAN(name: string, config: CANConfig): CANInterface {
    const iface = new CANInterface(config)
    this.canMap.set(name, iface)
    iface.initialize()
    return iface
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  getI2C(name: string): I2CInterface | undefined { return this.i2cMap.get(name) }
  getI2CInterface = this.getI2C.bind(this)
  getSPI(name: string): SPIInterface | undefined { return this.spiMap.get(name) }
  getSPIInterface = this.getSPI.bind(this)
  getUART(name: string): UARTInterface | undefined { return this.uartMap.get(name) }
  getUARTInterface = this.getUART.bind(this)
  getCAN(name: string): CANInterface | undefined { return this.canMap.get(name) }
  getCANInterface = this.getCAN.bind(this)

  getAllInterfaces() {
    return {
      i2c: Array.from(this.i2cMap.entries()).map(([name, iface]) => ({ name, interface: iface })),
      spi: Array.from(this.spiMap.entries()).map(([name, iface]) => ({ name, interface: iface })),
      uart: Array.from(this.uartMap.entries()).map(([name, iface]) => ({ name, interface: iface })),
      can: Array.from(this.canMap.entries()).map(([name, iface]) => ({ name, interface: iface })),
    }
  }

  /** Check whether the current browser supports WebSerial */
  get webSerialSupported(): boolean { return 'serial' in navigator }
}

export const hardwareInterfaceManager = new HardwareInterfaceManager()
