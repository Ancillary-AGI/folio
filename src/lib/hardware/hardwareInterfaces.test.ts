import { describe, it, expect, beforeEach } from 'vitest';
import {
  I2CInterface,
  SPIInterface,
  UARTInterface,
  CANInterface,
  hardwareInterfaceManager
} from './hardwareInterfaces';

describe('HardwareInterfaces', () => {
  describe('I2CInterface', () => {
    let i2c: I2CInterface;

    beforeEach(() => {
      i2c = new I2CInterface({
        address: 0x48,
        clockSpeed: 100000,
        sda: 21,
        scl: 22,
        pullupResistors: true
      });
    });

    it('should initialize I2C interface', async () => {
      await i2c.initialize();
      expect(i2c).toBeDefined();
    });

    it('should scan I2C bus', async () => {
      const devices = await i2c.scanBus();
      expect(Array.isArray(devices)).toBe(true);
    });

    it('should write to I2C register', async () => {
      await i2c.writeRegister(0x48, 0x00, 0x42);
      const transactions = i2c.getTransactions();
      expect(transactions.length).toBeGreaterThan(0);
      expect(transactions[0].deviceAddress).toBe(0x48);
      expect(transactions[0].registerAddress).toBe(0x00);
    });

    it('should read from I2C register', async () => {
      const data = await i2c.readRegister(0x48, 0x00, 2);
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBe(2);
      const transactions = i2c.getTransactions();
      expect(transactions.length).toBeGreaterThan(0);
    });

    it('should write data to I2C device', async () => {
      const data = new Uint8Array([0x01, 0x02, 0x03]);
      await i2c.write(0x48, data);
      const transactions = i2c.getTransactions();
      expect(transactions[0].data).toEqual(data);
    });

    it('should read data from I2C device', async () => {
      const data = await i2c.read(0x48, 3);
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBe(3);
    });

    it('should register I2C device', () => {
      i2c.registerDevice({ address: 0x50, registerMap: { 0x00: 'STATUS' } });
      // Device registration doesn't affect transactions, just verifies no error
      expect(i2c).toBeDefined();
    });
  });

  describe('SPIInterface', () => {
    let spi: SPIInterface;

    beforeEach(() => {
      spi = new SPIInterface({
        mode: 0,
        bitOrder: 'msb',
        clockSpeed: 1000000,
        mosi: 23,
        miso: 19,
        sck: 18,
        ss: 5
      });
    });

    it('should initialize SPI interface', async () => {
      await spi.initialize();
      expect(spi).toBeDefined();
    });

    it('should transfer data over SPI', async () => {
      const txData = new Uint8Array([0x01, 0x02, 0x03]);
      const rxData = await spi.transfer(txData);
      expect(rxData).toBeInstanceOf(Uint8Array);
      expect(rxData.length).toBe(txData.length);
      const transactions = spi.getTransactions();
      expect(transactions.length).toBeGreaterThan(0);
    });

    it('should write data over SPI', async () => {
      const data = new Uint8Array([0xFF, 0x00]);
      await spi.write(data);
      const transactions = spi.getTransactions();
      expect(transactions.length).toBeGreaterThan(0);
    });

    it('should read data over SPI', async () => {
      const data = await spi.read(4);
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBe(4);
    });

    it('should handle chip select', () => {
      spi.setChipSelect(5, false);
      spi.setChipSelect(5, true);
      // Chip select state is internal, just verify no error
      expect(spi).toBeDefined();
    });
  });

  describe('UARTInterface', () => {
    let uart: UARTInterface;

    beforeEach(() => {
      uart = new UARTInterface({
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        tx: 1,
        rx: 0
      });
    });

    it('should initialize UART interface', async () => {
      await uart.initialize();
      expect(uart).toBeDefined();
    });

    it('should send data over UART', async () => {
      const data = new Uint8Array([0x48, 0x65, 0x6C, 0x6C, 0x6F]); // "Hello"
      await uart.send(data);
      const frames = uart.getFrames();
      expect(frames.length).toBeGreaterThan(0);
      expect(frames[0].data).toEqual(data);
    });

    it('should receive data from UART', async () => {
      const data = await uart.receive(5);
      expect(data).toBeInstanceOf(Uint8Array);
      expect(data.length).toBe(5);
    });

    it('should handle UART receive callback', () => {
      let receivedData: Uint8Array | undefined;
      uart.onReceive((data) => {
        receivedData = data;
      });
      const testData = new Uint8Array([0x01, 0x02]);
      uart.simulateReceive(testData);
      expect(receivedData).toEqual(testData);
    });

    it('should get available bytes in receive buffer', () => {
      uart.simulateReceive(new Uint8Array([0x01, 0x02, 0x03]));
      const available = uart.getAvailable();
      expect(available).toBeGreaterThan(0);
    });
  });

  describe('CANInterface', () => {
    let can: CANInterface;

    beforeEach(() => {
      can = new CANInterface({
        bitRate: 500000,
        samplePoint: 75,
        sjw: 1,
        mode: 'normal'
      });
    });

    it('should initialize CAN interface', async () => {
      await can.initialize();
      expect(can).toBeDefined();
    });

    it('should send CAN message', async () => {
      const message = {
        id: 0x123,
        data: new Uint8Array([0x01, 0x02, 0x03, 0x04]),
        extendedId: false,
        remoteFrame: false,
        timestamp: Date.now()
      };
      const result = await can.send(message);
      expect(result).toBe(true);
      const messages = can.getMessages();
      expect(messages.length).toBeGreaterThan(0);
    });

    it('should receive CAN message', async () => {
      const message = await can.receive();
      expect(message).toBeDefined();
      if (message) {
        expect(message).toHaveProperty('id');
        expect(message).toHaveProperty('data');
        expect(message.data).toBeInstanceOf(Uint8Array);
      }
    });

    it('should receive CAN message with timeout', async () => {
      const message = await can.receive(100);
      // May be null if no message received within timeout
      expect(message === null || (message && message.id !== undefined)).toBe(true);
    });

    it('should set CAN filter', () => {
      can.setFilter(0x100, 0x700, false);
      // Filter setting is internal, just verify no error
      expect(can).toBeDefined();
    });

    it('should handle CAN receive callback', () => {
      let receivedMessage: { id: number; data: Uint8Array; extendedId: boolean; remoteFrame: boolean; timestamp: number } | undefined;
      const message = {
        id: 0x456,
        data: new Uint8Array([0xAA, 0xBB]),
        extendedId: false,
        remoteFrame: false,
        timestamp: Date.now()
      };
      can.onReceive((msg) => {
        receivedMessage = msg;
      });
      can.simulateReceive(message);
      expect(receivedMessage).toEqual(message);
    });
  });

  describe('HardwareInterfaceManager', () => {
    it('should create I2C interface', () => {
      const i2c = hardwareInterfaceManager.createI2C('i2c1', {
        address: 0x48,
        clockSpeed: 100000,
        sda: 21,
        scl: 22
      });
      expect(i2c).toBeInstanceOf(I2CInterface);
    });

    it('should create SPI interface', () => {
      const spi = hardwareInterfaceManager.createSPI('spi1', {
        mode: 0,
        bitOrder: 'msb',
        clockSpeed: 1000000,
        mosi: 23,
        miso: 19,
        sck: 18
      });
      expect(spi).toBeInstanceOf(SPIInterface);
    });

    it('should create UART interface', () => {
      const uart = hardwareInterfaceManager.createUART('uart1', {
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        tx: 1,
        rx: 0
      });
      expect(uart).toBeInstanceOf(UARTInterface);
    });

    it('should create CAN interface', () => {
      const can = hardwareInterfaceManager.createCAN('can1', {
        bitRate: 500000,
        samplePoint: 75,
        sjw: 1,
        mode: 'normal'
      });
      expect(can).toBeInstanceOf(CANInterface);
    });

    it('should retrieve I2C interface by name', () => {
      hardwareInterfaceManager.createI2C('test_i2c', {
        address: 0x48,
        clockSpeed: 100000,
        sda: 21,
        scl: 22
      });
      const i2c = hardwareInterfaceManager.getI2C('test_i2c');
      expect(i2c).toBeInstanceOf(I2CInterface);
    });

    it('should retrieve SPI interface by name', () => {
      hardwareInterfaceManager.createSPI('test_spi', {
        mode: 0,
        bitOrder: 'msb',
        clockSpeed: 1000000,
        mosi: 23,
        miso: 19,
        sck: 18
      });
      const spi = hardwareInterfaceManager.getSPI('test_spi');
      expect(spi).toBeInstanceOf(SPIInterface);
    });

    it('should retrieve UART interface by name', () => {
      hardwareInterfaceManager.createUART('test_uart', {
        baudRate: 9600,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
        tx: 1,
        rx: 0
      });
      const uart = hardwareInterfaceManager.getUART('test_uart');
      expect(uart).toBeInstanceOf(UARTInterface);
    });

    it('should retrieve CAN interface by name', () => {
      hardwareInterfaceManager.createCAN('test_can', {
        bitRate: 500000,
        samplePoint: 75,
        sjw: 1,
        mode: 'normal'
      });
      const can = hardwareInterfaceManager.getCAN('test_can');
      expect(can).toBeInstanceOf(CANInterface);
    });

    it('should return undefined for non-existent interface', () => {
      const i2c = hardwareInterfaceManager.getI2C('nonexistent');
      expect(i2c).toBeUndefined();
    });

    it('should get all interfaces', () => {
      hardwareInterfaceManager.createI2C('i2c_all', {
        address: 0x48,
        clockSpeed: 100000,
        sda: 21,
        scl: 22
      });
      hardwareInterfaceManager.createSPI('spi_all', {
        mode: 0,
        bitOrder: 'msb',
        clockSpeed: 1000000,
        mosi: 23,
        miso: 19,
        sck: 18
      });
      const all = hardwareInterfaceManager.getAllInterfaces();
      expect(all).toHaveProperty('i2c');
      expect(all).toHaveProperty('spi');
      expect(all).toHaveProperty('uart');
      expect(all).toHaveProperty('can');
      expect(Array.isArray(all.i2c)).toBe(true);
      expect(Array.isArray(all.spi)).toBe(true);
    });
  });
});

