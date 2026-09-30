/**
 * Hardware Interfacing APIs — I²C, SPI, UART, CAN
 *
 * Architecture:
 *   • All four protocol classes expose a unified async API
 *   • UART: bridges to the browser WebSerial API when available; falls back to
 *     in-browser simulation so the rest of the app continues to function
 *   • I²C / SPI / CAN: fully simulated (real hardware requires a native bridge
 *     such as an Arduino/USB adapter running a JSON-over-UART protocol)
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

  private async startReading(): Promise<void> {
    if (!this.port?.readable) return
    const reader = this.port.readable.getReader()
    this.reader = reader
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        if (value) this._receiveCallbacks.forEach(cb => cb(value))
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
    }
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
    console.log(`[I2C] Init — SDA:${this.config.sda} SCL:${this.config.scl} @ ${this.config.clockSpeed / 1000} kHz`)
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
      // Real probe via bridge — for now we request and wait for ACK/NACK
      const cmd = new TextEncoder().encode(JSON.stringify({ cmd: 'i2c_probe', address: addr }) + '\n')
      await this.bridge.write(cmd)
      // In production, parse bridge response here. For now treat as present.
      return true
    }
    // Simulation: devices at even addresses 0x10–0x50 are "present"
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
    const tx: I2CTransaction = { deviceAddress, registerAddress, readLength: length, stopCondition: true, timestamp: Date.now() }
    this.txLog.push(tx)
    if (this.bridge?.state === 'connected') {
      const cmd = new TextEncoder().encode(JSON.stringify({ cmd: 'i2c_read', addr: deviceAddress, reg: registerAddress, len: length }) + '\n')
      await this.bridge.write(cmd)
      // In production wait for response bytes; return zeros for now
      return new Uint8Array(length)
    }
    // Simulation: return deterministic bytes derived from addr+reg
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

export class SPIInterface {
  private txLog: SPITransaction[] = []
  private chipSelectStates = new Map<number, boolean>()
  private bridge: WebSerialBridge | null = null

  constructor(private config: SPIConfig, bridge?: WebSerialBridge) {
    this.bridge = bridge ?? null
  }

  async initialize(): Promise<void> {
    console.log(`[SPI] Init — Mode ${this.config.mode} @ ${this.config.clockSpeed / 1e6} MHz`)
    if (this.bridge?.state === 'connected') {
      const cmd = new TextEncoder().encode(JSON.stringify({ cmd: 'spi_init', config: this.config }) + '\n')
      await this.bridge.write(cmd)
    }
  }

  async transfer(txData: Uint8Array, csPin?: number): Promise<Uint8Array> {
    const rxData = new Uint8Array(txData.length)
    if (this.bridge?.state === 'connected') {
      const cmd = new TextEncoder().encode(JSON.stringify({ cmd: 'spi_transfer', cs: csPin, data: Array.from(txData) }) + '\n')
      await this.bridge.write(cmd)
      // In production, parse response; return zeros for now
    } else {
      // Simulation: invert bits as mock MISO response
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
    console.log(`[UART] Init — ${this.config.baudRate} baud ${this.config.dataBits}${this.config.parity[0].toUpperCase()}${this.config.stopBits}`)
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

  async send(data: Uint8Array): Promise<void> {
    this.frames.push({ data: new Uint8Array(data), direction: 'tx', timestamp: Date.now() })
    if (this._connected && this.serialBridge) {
      await this.serialBridge.write(data)
    } else {
      console.log(`[UART SIM] TX:`, data)
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

export class CANInterface {
  private messages: CANMessage[] = []
  private filters: Array<{ id: number; mask: number; extended: boolean }> = []
  private rxCallbacks: Array<(msg: CANMessage) => void> = []
  /** CAN uses a UART bridge internally (e.g. Lawicel SLCAN protocol) */
  private uart: UARTInterface | null = null

  constructor(private config: CANConfig) {}

  async initialize(): Promise<void> {
    console.log(`[CAN] Init — ${this.config.bitRate} bps mode:${this.config.mode}`)
  }

  /** Optionally attach a UART bridge running the SLCAN protocol */
  attachUARTBridge(uart: UARTInterface): void {
    this.uart = uart
    uart.onReceive(raw => this._parseSLCAN(raw))
  }

  async send(message: CANMessage): Promise<boolean> {
    const msg: CANMessage = { ...message, timestamp: Date.now() }
    this.messages.push(msg)

    if (this.uart?.isConnected) {
      // SLCAN format: "t{id:3X}{len}{data}\r"
      const idStr = message.id.toString(16).padStart(3, '0').toUpperCase()
      const dataStr = Array.from(message.data).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('')
      const slcan = `t${idStr}${message.data.length}${dataStr}\r`
      await this.uart.sendString(slcan)
    }
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
    // "t{id:3X}{len}{data...}\r" or "T{id:8X}{len}{data...}\r"
    const match = text.match(/^([tT])([0-9a-fA-F]{3,8})([0-9])([0-9a-fA-F]*)\r?$/)
    if (!match) return
    const extended = match[1] === 'T'
    const id = parseInt(match[2], 16)
    const dataLen = parseInt(match[3])
    const dataHex = match[4]
    const data = new Uint8Array(dataLen)
    for (let i = 0; i < dataLen; i++) data[i] = parseInt(dataHex.slice(i * 2, i * 2 + 2), 16)
    const msg: CANMessage = { id, data, extendedId: extended, remoteFrame: false, timestamp: Date.now() }
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
