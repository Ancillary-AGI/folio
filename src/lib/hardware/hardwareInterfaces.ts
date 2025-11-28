/**
 * Hardware Interfacing APIs for Embedded Systems
 * Provides I2C, SPI, UART, CAN, and other communication protocol implementations
 */

export interface I2CConfig {
  address: number;
  clockSpeed: number; // Hz
  sda: number;
  scl: number;
  pullupResistors?: boolean;
}

export interface I2CDevice {
  address: number;
  registerMap?: Record<number, string>;
}

export interface I2CTransaction {
  deviceAddress: number;
  registerAddress?: number;
  data?: Uint8Array;
  readLength?: number;
  stopCondition: boolean;
}

export interface SPIConfig {
  mode: 0 | 1 | 2 | 3;
  bitOrder: 'msb' | 'lsb';
  clockSpeed: number; // Hz
  mosi: number;
  miso: number;
  sck: number;
  ss?: number;
}

export interface SPITransaction {
  data: Uint8Array;
  csActiveLow?: boolean;
  clockPolarity?: 'idle_low' | 'idle_high';
  clockPhase?: 'sample_on_leading' | 'sample_on_trailing';
}

export interface UARTConfig {
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 2;
  parity: 'none' | 'even' | 'odd';
  flowControl: 'none' | 'rts_cts' | 'xon_xoff';
  tx: number;
  rx: number;
}

export interface UARTFrame {
  data: Uint8Array;
  timestamp: number;
}

export interface CANConfig {
  bitRate: number; // bits per second
  samplePoint: number; // 0-100% of bit time
  sjw: number; // Synchronization Jump Width
  mode: 'normal' | 'loopback' | 'listen_only' | 'loopback_listen';
}

export interface CANMessage {
  id: number;
  data: Uint8Array;
  extendedId: boolean;
  remoteFrame: boolean;
  timestamp: number;
}

export class I2CInterface {
  private devices: Map<number, I2CDevice> = new Map();
  private transactions: I2CTransaction[] = [];

  constructor(private config: I2CConfig) {}

  async initialize(): Promise<void> {
    // Initialize I2C bus
    console.log(`Initializing I2C on SDA:${this.config.sda}, SCL:${this.config.scl} at ${this.config.clockSpeed}Hz`);
  }

  async scanBus(): Promise<number[]> {
    const devices: number[] = [];
    // Scan I2C bus for devices (0x08 to 0x77)
    for (let addr = 0x08; addr <= 0x77; addr++) {
      try {
        const detected = await this.probeDevice();
        if (detected) {
          devices.push(addr);
          this.devices.set(addr, { address: addr });
        }
      } catch {
        // Device not present
      }
    }
    return devices;
  }

  async probeDevice(): Promise<boolean> {
    // Simulate device probing
    return Math.random() > 0.7; // 30% chance of device presence
  }

  async writeRegister(deviceAddress: number, registerAddress: number, data: number | Uint8Array): Promise<void> {
    const dataArray = typeof data === 'number' ? new Uint8Array([data]) : data;
    
    const transaction: I2CTransaction = {
      deviceAddress,
      registerAddress,
      data: dataArray,
      stopCondition: true
    };

    this.transactions.push(transaction);
    console.log(`I2C Write: Device 0x${deviceAddress.toString(16)}, Register 0x${registerAddress.toString(16)}, Data:`, dataArray);
  }

  async readRegister(deviceAddress: number, registerAddress: number, length: number = 1): Promise<Uint8Array> {
    const transaction: I2CTransaction = {
      deviceAddress,
      registerAddress,
      readLength: length,
      stopCondition: true
    };

    this.transactions.push(transaction);
    
    // Simulate reading data
    const data = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = Math.floor(Math.random() * 256);
    }

    console.log(`I2C Read: Device 0x${deviceAddress.toString(16)}, Register 0x${registerAddress.toString(16)}, Length: ${length}`);
    return data;
  }

  async write(deviceAddress: number, data: Uint8Array): Promise<void> {
    const transaction: I2CTransaction = {
      deviceAddress,
      data,
      stopCondition: true
    };

    this.transactions.push(transaction);
    console.log(`I2C Write: Device 0x${deviceAddress.toString(16)}, Data:`, data);
  }

  async read(deviceAddress: number, length: number): Promise<Uint8Array> {
    const transaction: I2CTransaction = {
      deviceAddress,
      readLength: length,
      stopCondition: true
    };

    this.transactions.push(transaction);
    
    const data = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      data[i] = Math.floor(Math.random() * 256);
    }

    return data;
  }

  registerDevice(device: I2CDevice): void {
    this.devices.set(device.address, device);
  }

  getTransactions(): I2CTransaction[] {
    return [...this.transactions];
  }
}

export class SPIInterface {
  private transactions: SPITransaction[] = [];
  private chipSelects: Map<number, boolean> = new Map();

  constructor(private config: SPIConfig) {}

  async initialize(): Promise<void> {
    console.log(`Initializing SPI: Mode ${this.config.mode}, ${this.config.clockSpeed}Hz, MOSI:${this.config.mosi}, MISO:${this.config.miso}, SCK:${this.config.sck}`);
  }

  async transfer(data: Uint8Array, csPin?: number): Promise<Uint8Array> {
    if (csPin !== undefined) {
      this.setChipSelect(csPin, false);
    }

    const transaction: SPITransaction = {
      data: new Uint8Array(data),
      csActiveLow: true,
      clockPolarity: this.config.mode % 2 === 0 ? 'idle_low' : 'idle_high',
      clockPhase: this.config.mode < 2 ? 'sample_on_leading' : 'sample_on_trailing'
    };

    this.transactions.push(transaction);

    // Simulate SPI transfer - MISO receives data
    const received = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) {
      received[i] = Math.floor(Math.random() * 256);
    }

    if (csPin !== undefined) {
      this.setChipSelect(csPin, true);
    }

    console.log(`SPI Transfer: TX:`, data, `RX:`, received);
    return received;
  }

  async write(data: Uint8Array, csPin?: number): Promise<void> {
    await this.transfer(data, csPin);
  }

  async read(length: number, csPin?: number): Promise<Uint8Array> {
    const dummyData = new Uint8Array(length);
    return await this.transfer(dummyData, csPin);
  }

  setChipSelect(pin: number, state: boolean): void {
    this.chipSelects.set(pin, state);
  }

  getTransactions(): SPITransaction[] {
    return [...this.transactions];
  }
}

export class UARTInterface {
  private frames: UARTFrame[] = [];
  private receiveBuffer: Uint8Array[] = [];
  private onReceiveCallback?: (data: Uint8Array) => void;

  constructor(private config: UARTConfig) {}

  async initialize(): Promise<void> {
    console.log(`Initializing UART: ${this.config.baudRate} baud, ${this.config.dataBits}N${this.config.stopBits}${this.config.parity[0].toUpperCase()}`);
  }

  async send(data: Uint8Array): Promise<void> {
    const frame: UARTFrame = {
      data: new Uint8Array(data),
      timestamp: Date.now()
    };

    this.frames.push(frame);
    console.log(`UART Send:`, data);
  }

  async receive(length?: number): Promise<Uint8Array> {
    if (this.receiveBuffer.length > 0) {
      const data = this.receiveBuffer.shift()!;
      return length ? data.slice(0, length) : data;
    }

    // Simulate receiving data
    const data = new Uint8Array(length || 1);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.floor(Math.random() * 256);
    }

    return data;
  }

  onReceive(callback: (data: Uint8Array) => void): void {
    this.onReceiveCallback = callback;
  }

  simulateReceive(data: Uint8Array): void {
    if (this.onReceiveCallback) {
      this.onReceiveCallback(data);
    }
    this.receiveBuffer.push(data);
  }

  getFrames(): UARTFrame[] {
    return [...this.frames];
  }

  getAvailable(): number {
    return this.receiveBuffer.reduce((sum, buf) => sum + buf.length, 0);
  }
}

export class CANInterface {
  private messages: CANMessage[] = [];
  private filters: Array<{ id: number; mask: number; extended: boolean }> = [];
  private onReceiveCallback?: (message: CANMessage) => void;

  constructor(private config: CANConfig) {}

  async initialize(): Promise<void> {
    console.log(`Initializing CAN: ${this.config.bitRate} bps, Mode: ${this.config.mode}`);
  }

  async send(message: CANMessage): Promise<boolean> {
    this.messages.push({
      ...message,
      timestamp: Date.now()
    });

    console.log(`CAN Send: ID: 0x${message.id.toString(16)}, Data:`, message.data);
    return true;
  }

  async receive(timeout?: number): Promise<CANMessage | null> {
    if (this.messages.length > 0) {
      return this.messages.shift()!;
    }

    if (timeout) {
      await new Promise(resolve => setTimeout(resolve, timeout));
      return this.messages.shift() || null;
    }

    // Simulate receiving message
    const message: CANMessage = {
      id: Math.floor(Math.random() * 0x7FF),
      data: new Uint8Array(Math.floor(Math.random() * 8) + 1),
      extendedId: false,
      remoteFrame: false,
      timestamp: Date.now()
    };

    for (let i = 0; i < message.data.length; i++) {
      message.data[i] = Math.floor(Math.random() * 256);
    }

    return message;
  }

  setFilter(id: number, mask: number, extended: boolean = false): void {
    this.filters.push({ id, mask, extended });
    console.log(`CAN Filter: ID: 0x${id.toString(16)}, Mask: 0x${mask.toString(16)}, Extended: ${extended}`);
  }

  onReceive(callback: (message: CANMessage) => void): void {
    this.onReceiveCallback = callback;
  }

  simulateReceive(message: CANMessage): void {
    if (this.onReceiveCallback) {
      this.onReceiveCallback(message);
    }
    this.messages.push(message);
  }

  getMessages(): CANMessage[] {
    return [...this.messages];
  }
}

export class HardwareInterfaceManager {
  private i2cInterfaces: Map<string, I2CInterface> = new Map();
  private spiInterfaces: Map<string, SPIInterface> = new Map();
  private uartInterfaces: Map<string, UARTInterface> = new Map();
  private canInterfaces: Map<string, CANInterface> = new Map();

  createI2C(name: string, config: I2CConfig): I2CInterface {
    const i2c = new I2CInterface(config);
    this.i2cInterfaces.set(name, i2c);
    i2c.initialize();
    return i2c;
  }

  createSPI(name: string, config: SPIConfig): SPIInterface {
    const spi = new SPIInterface(config);
    this.spiInterfaces.set(name, spi);
    spi.initialize();
    return spi;
  }

  createUART(name: string, config: UARTConfig): UARTInterface {
    const uart = new UARTInterface(config);
    this.uartInterfaces.set(name, uart);
    uart.initialize();
    return uart;
  }

  createCAN(name: string, config: CANConfig): CANInterface {
    const can = new CANInterface(config);
    this.canInterfaces.set(name, can);
    can.initialize();
    return can;
  }

  getI2C(name: string): I2CInterface | undefined {
    return this.i2cInterfaces.get(name);
  }

  getSPI(name: string): SPIInterface | undefined {
    return this.spiInterfaces.get(name);
  }

  getUART(name: string): UARTInterface | undefined {
    return this.uartInterfaces.get(name);
  }

  getCAN(name: string): CANInterface | undefined {
    return this.canInterfaces.get(name);
  }

  getAllInterfaces(): {
    i2c: Array<{ name: string; interface: I2CInterface }>;
    spi: Array<{ name: string; interface: SPIInterface }>;
    uart: Array<{ name: string; interface: UARTInterface }>;
    can: Array<{ name: string; interface: CANInterface }>;
  } {
    return {
      i2c: Array.from(this.i2cInterfaces.entries()).map(([name, intf]) => ({ name, interface: intf })),
      spi: Array.from(this.spiInterfaces.entries()).map(([name, intf]) => ({ name, interface: intf })),
      uart: Array.from(this.uartInterfaces.entries()).map(([name, intf]) => ({ name, interface: intf })),
      can: Array.from(this.canInterfaces.entries()).map(([name, intf]) => ({ name, interface: intf }))
    };
  }
}

export const hardwareInterfaceManager = new HardwareInterfaceManager();

