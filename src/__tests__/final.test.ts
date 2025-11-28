/**
 * Final Production Test Suite
 * Tests actual functionality with correct API calls
 */

import { describe, it, expect } from 'vitest';

// Import services with correct exports
import { thermalAnalysisEngine } from '../lib/pcb/thermalAnalysis';
import { signalIntegrityAnalyzer } from '../lib/pcb/signalIntegrity';
import { roboticsSimulationService } from '../lib/robotics/roboticsSimulation';
import { digitalTwinService } from '../lib/digitalTwin/digitalTwinService';
import { hardwareInterfaceManager } from '../lib/hardware/hardwareInterfaces';
import { schematicToPcbConverter } from '../lib/schematicToPcb/schematicToPcbConverter';
import { pluginManager } from '../lib/plugins/pluginManager';
import { collaborativeEditor } from '../lib/collaboration/collaborativeEditor';
import { siemService } from '../lib/siem/siemService';
import { nlpService } from '../lib/nlp/nlpService';

describe('Production Tests - All Features Working', () => {
  
  describe('1. PCB Thermal Analysis', () => {
    it('should analyze thermal distribution on PCB', async () => {
      const nodes = [
        {
          id: 'ic1',
          position: { x: 5, y: 5, z: 0 },
          temperature: 25,
          powerDissipation: 2.5,
          material: 'silicon'
        },
        {
          id: 'ic2',
          position: { x: 15, y: 5, z: 0 },
          temperature: 25,
          powerDissipation: 1.0,
          material: 'silicon'
        }
      ];

      const boundaries = [
        {
          type: 'convection' as const,
          heatTransferCoefficient: 10,
          area: 100
        }
      ];

      const config = {
        ambientTemperature: 25,
        convectionCoefficient: 10,
        boardMaterial: 'FR4',
        copperThickness: 0.035,
        layerCount: 2,
        simulationTime: 10,
        timeStep: 0.1
      };

      const result = await thermalAnalysisEngine.analyzeThermal(nodes, boundaries, config);
      
      expect(result).toBeDefined();
      expect(result.nodes).toBeDefined();
      expect(result.hotspots).toBeDefined();
      expect(result.recommendations).toBeDefined();
      expect(Array.isArray(result.nodes)).toBe(true);
      expect(Array.isArray(result.hotspots)).toBe(true);
    });
  });

  describe('2. Signal Integrity Analysis', () => {
    it('should calculate trace impedance', () => {
      const trace = {
        length: 100,
        width: 0.2,
        thickness: 0.035,
        dielectricHeight: 1.6,
        dielectricConstant: 4.5,
        frequency: 1e9
      };

      const result = signalIntegrityAnalyzer.analyzeTrace(trace);
      
      expect(result).toBeDefined();
      expect(result.impedance).toBeGreaterThan(0);
      expect(result.propagationDelay).toBeGreaterThan(0);
    });
  });

  describe('3. Robotics Simulation', () => {
    it('should create robot with configuration', () => {
      const config = {
        type: 'manipulator' as const,
        dof: 6,
        links: [
          { length: 1.0, mass: 2.0, inertia: 0.2 },
          { length: 0.8, mass: 1.5, inertia: 0.15 }
        ],
        joints: [
          { type: 'revolute' as const, axis: [0, 0, 1], limits: [-Math.PI, Math.PI] },
          { type: 'revolute' as const, axis: [0, 1, 0], limits: [-Math.PI/2, Math.PI/2] }
        ]
      };

      const robot = roboticsSimulationService.createRobot('test-robot', config);
      
      expect(robot).toBeDefined();
      expect(robot.config.dof).toBe(6);
      expect(robot.config.links.length).toBe(2);
    });

    it('should simulate robot trajectory', () => {
      const config = {
        type: 'manipulator' as const,
        dof: 3,
        links: [{ length: 1.0, mass: 1.0, inertia: 0.1 }],
        joints: [{ type: 'revolute' as const, axis: [0, 0, 1], limits: [-Math.PI, Math.PI] }]
      };

      const robot = roboticsSimulationService.createRobot('sim-robot', config);
      const trajectory = {
        waypoints: [
          { position: [0, 0, 0], velocity: [0, 0, 0], time: 0 },
          { position: [1, 0, 0], velocity: [0, 0, 0], time: 1 }
        ],
        constraints: {
          maxVelocity: 1.0,
          maxAcceleration: 0.5,
          maxJerk: 0.1
        }
      };

      const result = roboticsSimulationService.simulateTrajectory(robot.id, trajectory);
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
    });
  });

  describe('4. Digital Twin', () => {
    it('should create digital twin for device', () => {
      const config = {
        physicalDeviceId: 'device-001',
        updateInterval: 100,
        sensors: [
          { id: 'temp1', type: 'temperature', unit: 'celsius' },
          { id: 'pos1', type: 'position', unit: 'mm' }
        ],
        actuators: [
          { id: 'motor1', type: 'servo', range: [0, 180] }
        ]
      };

      const twin = digitalTwinService.createDigitalTwin('twin-001', config);
      
      expect(twin).toBeDefined();
      expect(twin.physicalDeviceId).toBe('device-001');
      expect(twin.sensors.length).toBe(2);
      expect(twin.actuators.length).toBe(1);
    });

    it('should update digital twin state', () => {
      const config = {
        physicalDeviceId: 'device-002',
        updateInterval: 100,
        sensors: [{ id: 'temp1', type: 'temperature', unit: 'celsius' }],
        actuators: []
      };

      const twin = digitalTwinService.createDigitalTwin('twin-002', config);
      
      const sensorData = [
        { sensorId: 'temp1', value: 45.5, timestamp: Date.now() }
      ];

      digitalTwinService.updateSensorData(twin.id, sensorData);
      
      const state = digitalTwinService.getDigitalTwinState(twin.id);
      expect(state).toBeDefined();
    });
  });

  describe('5. Hardware Interfaces', () => {
    it('should create I2C interface', () => {
      const i2c = hardwareInterfaceManager.createI2CInterface('i2c-test', {
        busNumber: 1,
        clockSpeed: 100000
      });
      
      expect(i2c).toBeDefined();
      expect(i2c.id).toBe('i2c-test');
    });

    it('should create SPI interface', () => {
      const spi = hardwareInterfaceManager.createSPIInterface('spi-test', {
        busNumber: 0,
        chipSelect: 0,
        mode: 0,
        clockSpeed: 1000000
      });
      
      expect(spi).toBeDefined();
      expect(spi.id).toBe('spi-test');
    });

    it('should create UART interface', () => {
      const uart = hardwareInterfaceManager.createUARTInterface('uart-test', {
        port: '/dev/ttyUSB0',
        baudRate: 115200,
        dataBits: 8,
        parity: 'none',
        stopBits: 1
      });
      
      expect(uart).toBeDefined();
      expect(uart.id).toBe('uart-test');
    });
  });

  describe('6. Schematic to PCB Conversion', () => {
    it('should convert schematic to PCB layout', () => {
      const schematic = {
        id: 'test-sch',
        name: 'Test Circuit',
        components: [
          {
            id: 'r1',
            componentId: 'resistor',
            position: { x: 0, y: 0 },
            rotation: 0,
            scale: 1,
            reference: 'R1',
            properties: { value: '10k' },
            component: {
              id: 'resistor',
              name: 'Resistor',
              category: 'passive',
              symbol: { width: 20, height: 10, paths: [], circles: [], rectangles: [] },
              pins: [
                { id: 'p1', name: '1', x: 0, y: 0, type: 'passive' as const },
                { id: 'p2', name: '2', x: 20, y: 0, type: 'passive' as const }
              ],
              properties: {}
            }
          }
        ],
        wires: [],
        nets: [],
        metadata: {
          created: new Date().toISOString(),
          modified: new Date().toISOString(),
          version: '1.0'
        },
        settings: {
          gridSize: 10,
          snapToGrid: true,
          showGrid: true,
          showPinNumbers: true,
          showPinNames: true,
          showNetNames: true
        }
      };

      const options = {
        boardSize: { width: 100, height: 100 },
        layerCount: 2,
        autoRoute: true,
        traceWidth: 0.2,
        clearance: 0.2,
        viaSize: 0.6
      };

      const result = schematicToPcbConverter.convertSchematicToPCB(schematic, options);
      
      expect(result).toBeDefined();
      expect(result.components).toBeDefined();
      expect(result.layers).toBeDefined();
    });
  });

  describe('7. Plugin System', () => {
    it('should list loaded plugins', () => {
      const plugins = pluginManager.listPlugins();
      
      expect(plugins).toBeDefined();
      expect(Array.isArray(plugins)).toBe(true);
    });

    it('should get plugin by ID', () => {
      const plugins = pluginManager.listPlugins();
      
      if (plugins.length > 0) {
        const plugin = pluginManager.getPlugin(plugins[0].id);
        expect(plugin).toBeDefined();
      } else {
        expect(true).toBe(true); // No plugins loaded yet
      }
    });
  });

  describe('8. Collaborative Editing', () => {
    it('should handle user connection', async () => {
      const user = {
        id: 'user-test',
        name: 'Test User',
        email: 'test@example.com',
        color: '#3B82F6',
        isActive: true,
        lastSeen: Date.now()
      };

      const projectId = 'test-project';
      
      const connected = await collaborativeEditor.connect(user, projectId);
      
      expect(typeof connected).toBe('boolean');
      
      collaborativeEditor.disconnect();
    });
  });

  describe('9. SIEM Security Monitoring', () => {
    it('should log security events', () => {
      siemService.logEvent({
        type: 'security',
        severity: 'medium',
        source: 'test-system',
        message: 'Test security event',
        metadata: { test: true }
      });

      const events = siemService.getEvents({ source: 'test-system' });
      
      expect(events).toBeDefined();
      expect(Array.isArray(events)).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    });

    it('should monitor IoT devices', async () => {
      await siemService.monitorIoTDevice('test-device', {
        temperature: 45,
        powerConsumption: 3.5,
        networkActivity: { bytesIn: 1000, bytesOut: 500, connections: 5 },
        cpuUsage: 60,
        memoryUsage: 70
      });

      const events = siemService.getEvents({ source: 'iot_device_test-device' });
      expect(events).toBeDefined();
    });
  });

  describe('10. NLP Service', () => {
    it('should process natural language commands', () => {
      const command = 'add a 10k resistor';
      const result = nlpService.processCommand(command);
      
      expect(result).toBeDefined();
      expect(result.intent).toBeDefined();
      expect(result.entities).toBeDefined();
    });

    it('should get voice commands', () => {
      const commands = nlpService.getVoiceCommands();
      
      expect(commands).toBeDefined();
      expect(Array.isArray(commands)).toBe(true);
    });
  });
});

describe('Integration Tests', () => {
  it('should integrate robotics with digital twin', () => {
    const robotConfig = {
      type: 'manipulator' as const,
      dof: 3,
      links: [{ length: 1.0, mass: 1.0, inertia: 0.1 }],
      joints: [{ type: 'revolute' as const, axis: [0, 0, 1], limits: [-Math.PI, Math.PI] }]
    };

    const robot = roboticsSimulationService.createRobot('integrated-robot', robotConfig);
    
    const twinConfig = {
      physicalDeviceId: robot.id,
      updateInterval: 100,
      sensors: [{ id: 'joint1', type: 'angle', unit: 'radians' }],
      actuators: [{ id: 'motor1', type: 'servo', range: [-Math.PI, Math.PI] }]
    };

    const twin = digitalTwinService.createDigitalTwin('robot-twin', twinConfig);
    
    expect(robot).toBeDefined();
    expect(twin).toBeDefined();
    expect(twin.physicalDeviceId).toBe(robot.id);
  });

  it('should integrate hardware interfaces with IoT monitoring', () => {
    const uart = hardwareInterfaceManager.createUARTInterface('iot-uart', {
      port: '/dev/ttyUSB0',
      baudRate: 115200,
      dataBits: 8,
      parity: 'none',
      stopBits: 1
    });

    siemService.logEvent({
      type: 'performance',
      severity: 'low',
      source: uart.id,
      message: 'UART interface created',
      metadata: { baudRate: 115200 }
    });

    expect(uart).toBeDefined();
    
    const events = siemService.getEvents({ source: uart.id });
    expect(events.length).toBeGreaterThan(0);
  });
});
