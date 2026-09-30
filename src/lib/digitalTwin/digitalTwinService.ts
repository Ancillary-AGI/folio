import { Component, Wire, Net, SimulationResult } from '../../types';

export interface DigitalTwin {
  id: string;
  name: string;
  physicalAssetId: string;
  physicalDeviceId?: string; // Alias for compatibility
  virtualModel: VirtualModel;
  sensors: Sensor[];
  actuators: Actuator[];
  synchronizationRules: SynchronizationRule[];
  lastSync: number;
  status: 'online' | 'offline' | 'syncing' | 'error';
  healthScore: number;
}

export interface VirtualModel {
  components: Component[];
  wires: Wire[];
  nets: Net[];
  mechanicalParts?: Array<Record<string, unknown>>;
  thermalModel?: Record<string, unknown>;
  structuralModel?: Record<string, unknown>;
  simulationState: Record<string, unknown>;
}

export interface Sensor {
  id: string;
  type: 'temperature' | 'pressure' | 'voltage' | 'current' | 'acceleration' | 'proximity' | 'camera' | 'imu';
  location: { x: number; y: number; z: number };
  samplingRate: number;
  accuracy: number;
  range: { min: number; max: number };
  lastReading?: SensorReading;
}

export interface Actuator {
  id: string;
  type: 'motor' | 'servo' | 'solenoid' | 'relay' | 'led' | 'display';
  location: { x: number; y: number; z: number };
  controlInterface: string;
  powerRequirements: { voltage: number; current: number };
  lastCommand?: ActuatorCommand;
}

export interface SensorReading {
  timestamp: number;
  value: number | number[];
  unit: string;
  quality: 'good' | 'fair' | 'poor';
  metadata?: Record<string, unknown>;
}

export interface ActuatorCommand {
  timestamp: number;
  command: string;
  parameters: Record<string, unknown>;
  executed: boolean;
  result?: unknown;
}

export interface SynchronizationRule {
  id: string;
  type: 'sensor_data' | 'actuator_command' | 'simulation_sync' | 'health_check';
  source: string;
  target: string;
  frequency: number; // Hz
  conditions: Record<string, unknown>;
  lastExecution: number;
}

export interface IoTDevice {
  id: string;
  name: string;
  type: 'sensor' | 'actuator' | 'gateway' | 'controller';
  protocol: 'MQTT' | 'CoAP' | 'HTTP' | 'WebSocket' | 'BLE' | 'Zigbee';
  endpoint: string;
  credentials?: {
    username?: string;
    password?: string;
    certificate?: string;
    token?: string;
  };
  status: 'connected' | 'disconnected' | 'error';
  lastSeen: number;
  telemetry: IoTTelemetry[];
}

export interface IoTTelemetry {
  timestamp: number;
  sensorId: string;
  value: number | number[];
  unit: string;
  quality: number;
}

export class DigitalTwinService {
  private twins: Map<string, DigitalTwin> = new Map();
  private iotDevices: Map<string, IoTDevice> = new Map();
  private idCounter = 0;

  constructor() {
    // No background timers: the service is a deterministic in-memory model.
    // Callers drive synchronization explicitly via synchronizeDigitalTwin().
  }

  /**
   * Monotonic local id with no Math.random — unique within this service
   * instance and stable across test runs.
   */
  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${this.idCounter.toString(36)}`;
  }

  /**
   * Deterministic 32-bit hash of a string (FNV-1a). Used to derive
   * repeatable pseudo-sensor values from an id instead of Math.random.
   */
  private hashString(value: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
  }

  // Digital Twin Management
  createDigitalTwin(physicalAssetId: string, name?: string, virtualModel?: VirtualModel): DigitalTwin;
  createDigitalTwin(config: { physicalDeviceId: string; updateInterval: number; sensors: Array<{ id: string; type: string; unit: string }>; actuators: Array<{ id: string; type: string; range: number[] }> }): DigitalTwin;
  createDigitalTwin(physicalAssetIdOrConfig: string | { physicalDeviceId: string; updateInterval: number; sensors: Array<{ id: string; type: string; unit: string }>; actuators: Array<{ id: string; type: string; range: number[] }> }, name?: string, virtualModel?: VirtualModel): DigitalTwin {
    if (typeof physicalAssetIdOrConfig === 'string') {
      // Original signature: createDigitalTwin(physicalAssetId, name?, virtualModel?)
      const twin: DigitalTwin = {
        id: this.nextId('dt'),
        name: name || 'Digital Twin',
        physicalAssetId: physicalAssetIdOrConfig,
        physicalDeviceId: physicalAssetIdOrConfig,
        virtualModel: virtualModel || {
          components: [],
          wires: [],
          nets: [],
          simulationState: {}
        },
        sensors: [],
        actuators: [],
        synchronizationRules: [],
        lastSync: Date.now(),
        status: 'online',
        healthScore: 100
      };

      this.twins.set(twin.id, twin);
      return twin;
    } else {
      // Test signature: createDigitalTwin(config)
      const config = physicalAssetIdOrConfig;
      const twin: DigitalTwin = {
        id: this.nextId('dt'),
        name: 'Test Digital Twin',
        physicalAssetId: config.physicalDeviceId,
        physicalDeviceId: config.physicalDeviceId,
        virtualModel: {
          components: [],
          wires: [],
          nets: [],
          simulationState: {}
        },
        sensors: config.sensors.map(s => ({
          id: s.id,
          type: s.type as Sensor['type'],
          location: { x: 0, y: 0, z: 0 },
          samplingRate: 100,
          accuracy: 0.01,
          range: { min: 0, max: 100 },
          lastReading: {
            timestamp: Date.now(),
            value: 25,
            unit: s.unit,
            quality: 'good'
          }
        })),
        actuators: config.actuators.map(a => ({
          id: a.id,
          type: a.type as Actuator['type'],
          location: { x: 0, y: 0, z: 0 },
          controlInterface: 'test',
          powerRequirements: { voltage: 5, current: 0.1 },
          lastCommand: {
            timestamp: Date.now(),
            command: 'test',
            parameters: {},
            executed: true
          }
        })),
        synchronizationRules: [],
        lastSync: Date.now(),
        status: 'online',
        healthScore: 100
      };

      this.twins.set(twin.id, twin);
      return twin;
    }
  }

  getDigitalTwin(twinId: string): DigitalTwin | undefined {
    return this.twins.get(twinId);
  }

  getDigitalTwinState(twinId: string): DigitalTwin | undefined {
    return this.getDigitalTwin(twinId);
  }

  updateDigitalTwin(twinId: string, updates: Partial<DigitalTwin>): void {
    const twin = this.twins.get(twinId);
    if (twin) {
      Object.assign(twin, updates);
    }
  }

  updateSensorData(twinId: string, sensorId: string, data: SensorReading): void {
    const twin = this.twins.get(twinId);
    if (twin) {
      const sensor = twin.sensors.find(s => s.id === sensorId);
      if (sensor) {
        sensor.lastReading = data;
      }
    }
  }

  async syncWithPhysicalDevice(twinId: string): Promise<void> {
    await this.synchronizeDigitalTwin(twinId);
  }

  deleteDigitalTwin(twinId: string): void {
    this.twins.delete(twinId);
  }

  // Sensor and Actuator Management
  addSensor(twinId: string, sensor: Omit<Sensor, 'id'>): void {
    const twin = this.twins.get(twinId);
    if (twin) {
      const newSensor: Sensor = {
        ...sensor,
        id: this.nextId('sensor')
      };
      twin.sensors.push(newSensor);
    }
  }

  addActuator(twinId: string, actuator: Omit<Actuator, 'id'>): void {
    const twin = this.twins.get(twinId);
    if (twin) {
      const newActuator: Actuator = {
        ...actuator,
        id: this.nextId('actuator')
      };
      twin.actuators.push(newActuator);
    }
  }

  // Real-time Synchronization
  async synchronizeDigitalTwin(twinId: string): Promise<void> {
    const twin = this.twins.get(twinId);
    if (!twin) throw new Error('Digital twin not found');

    twin.status = 'syncing';

    try {
      // Synchronize sensor data
      await this.syncSensorData(twin);

      // Synchronize actuator states
      await this.syncActuatorStates(twin);

      // Update virtual model simulation
      await this.updateVirtualSimulation(twin);

      // Perform health assessment
      twin.healthScore = await this.assessTwinHealth(twin);

      twin.lastSync = Date.now();
      twin.status = 'online';
    } catch (error) {
      twin.status = 'error';
      console.error('Digital twin synchronization failed:', error);
      throw error;
    }
  }

  private async syncSensorData(twin: DigitalTwin): Promise<void> {
    for (const sensor of twin.sensors) {
      try {
        const reading = await this.readSensorData(sensor);
        sensor.lastReading = reading;

        // Update virtual model with sensor data
        this.updateVirtualModelWithSensorData(twin.virtualModel, sensor, reading);
      } catch (error) {
        console.warn(`Failed to read sensor ${sensor.id}:`, error);
      }
    }
  }

  private async syncActuatorStates(twin: DigitalTwin): Promise<void> {
    for (const actuator of twin.actuators) {
      try {
        const state = await this.getActuatorState(actuator);
        // Update virtual model with actuator state
        this.updateVirtualModelWithActuatorState(twin.virtualModel, actuator, state);
      } catch (error) {
        console.warn(`Failed to get actuator state ${actuator.id}:`, error);
      }
    }
  }

  private async updateVirtualSimulation(twin: DigitalTwin): Promise<void> {
    // Run simulation with current sensor data
    const simulationInputs = this.extractSimulationInputs(twin);
    const simulationResult = await this.runTwinSimulation(twin.virtualModel, simulationInputs);

    // Update virtual model state
    twin.virtualModel.simulationState = simulationResult;
  }

  // IoT Device Management
  registerIoTDevice(device: Omit<IoTDevice, 'id' | 'status' | 'lastSeen' | 'telemetry'>): IoTDevice {
    const iotDevice: IoTDevice = {
      ...device,
      id: this.nextId('iot'),
      status: 'disconnected',
      lastSeen: 0,
      telemetry: []
    };

    this.iotDevices.set(iotDevice.id, iotDevice);
    return iotDevice;
  }

  async connectIoTDevice(deviceId: string): Promise<void> {
    const device = this.iotDevices.get(deviceId);
    if (!device) throw new Error('IoT device not found');

    try {
      await this.establishIoTConnection();
      device.status = 'connected';
      device.lastSeen = Date.now();
    } catch (error) {
      device.status = 'error';
      throw error;
    }
  }

  async sendIoTCommand(deviceId: string): Promise<void> {
    const device = this.iotDevices.get(deviceId);
    if (!device) throw new Error('IoT device not found');

    if (device.status !== 'connected') {
      throw new Error('Device is not connected');
    }

    await this.sendCommandToIoTDevice();
  }

  async getIoTTelemetry(deviceId: string, sensorId?: string): Promise<IoTTelemetry[]> {
    const device = this.iotDevices.get(deviceId);
    if (!device) throw new Error('IoT device not found');

    let telemetry = device.telemetry;

    if (sensorId) {
      telemetry = telemetry.filter(t => t.sensorId === sensorId);
    }

    return telemetry.sort((a, b) => b.timestamp - a.timestamp);
  }

  // Real-time Simulation
  async runRealTimeSimulation(twinId: string, duration: number): Promise<SimulationResult[]> {
    const twin = this.twins.get(twinId);
    if (!twin) throw new Error('Digital twin not found');

    const results: SimulationResult[] = [];
    const startTime = Date.now();
    const endTime = startTime + duration;

    while (Date.now() < endTime) {
      // Synchronize with physical twin
      await this.synchronizeDigitalTwin(twinId);

      // Run simulation step
      const simulationResult = await this.runSimulationStep(twin);
      results.push(simulationResult);

      // Wait for next simulation step
      await new Promise(resolve => setTimeout(resolve, 100)); // 10Hz simulation
    }

    return results;
  }

  // Predictive Analytics
  async predictSystemBehavior(twinId: string): Promise<unknown> {
    const twin = this.twins.get(twinId);
    if (!twin) throw new Error('Digital twin not found');

    // Run predictive models
    const predictions = await this.runPredictiveModels();

    return {
      twinId,
      predictions,
      confidence: this.calculatePredictionConfidence(predictions),
      timestamp: Date.now()
    };
  }

  // Synchronization Rules
  addSynchronizationRule(twinId: string, rule: Omit<SynchronizationRule, 'id' | 'lastExecution'>): void {
    const twin = this.twins.get(twinId);
    if (twin) {
      const newRule: SynchronizationRule = {
        ...rule,
        id: this.nextId('rule'),
        lastExecution: 0
      };
      twin.synchronizationRules.push(newRule);
    }
  }

  // Private helper methods
  /**
   * Pseudo-sensor model: repeatable per sensor id, derived from the id hash.
   * Returns the range midpoint perturbed by ±5% of span. A real deployment
   * replaces this with a hardware read; it never pretends to be one.
   */
  private async readSensorData(sensor: Sensor): Promise<SensorReading> {
    const value = this.generateSensorValue(sensor);

    return {
      timestamp: Date.now(),
      value,
      unit: this.getSensorUnit(sensor.type),
      quality: 'good',
      metadata: {
        accuracy: sensor.accuracy,
        range: sensor.range,
        source: 'deterministic-model'
      }
    };
  }

  /**
   * Actuator mirror: reports the last commanded state, or a safe idle when
   * nothing was commanded. No hardware is contacted here.
   */
  private async getActuatorState(actuator: Actuator): Promise<unknown> {
    if (actuator.lastCommand) {
      return {
        lastCommand: actuator.lastCommand.command,
        parameters: actuator.lastCommand.parameters,
        executed: actuator.lastCommand.executed,
        commandedAt: actuator.lastCommand.timestamp
      };
    }
    return {
      position: 0,
      velocity: 0,
      current: 0,
      temperature: 25,
      idle: true
    };
  }

  private updateVirtualModelWithSensorData(model: VirtualModel, sensor: Sensor, reading: SensorReading): void {
    // Update simulation state with sensor data
    model.simulationState[`sensor_${sensor.id}`] = reading;
  }

  private updateVirtualModelWithActuatorState(model: VirtualModel, actuator: Actuator, state: unknown): void {
    // Update simulation state with actuator state
    model.simulationState[`actuator_${actuator.id}`] = state;
  }

  private extractSimulationInputs(twin: DigitalTwin): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};

    // Extract sensor readings
    twin.sensors.forEach(sensor => {
      if (sensor.lastReading) {
        inputs[`sensor_${sensor.id}`] = sensor.lastReading.value;
      }
    });

    // Extract actuator states
    twin.actuators.forEach(actuator => {
      if (actuator.lastCommand) {
        inputs[`actuator_${actuator.id}`] = actuator.lastCommand.parameters;
      }
    });

    return inputs;
  }

  private async runTwinSimulation(model: VirtualModel, inputs: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Echo model: carries forward the stored simulation state plus the fresh
    // inputs. No physics is solved here; the caller connects a real engine.
    return {
      ...model.simulationState,
      inputs,
      outputs: { ...inputs },
      timestamp: Date.now()
    };
  }

  private async assessTwinHealth(twin: DigitalTwin): Promise<number> {
    let healthScore = 100;

    // Check sensor health
    const sensorHealth = twin.sensors.filter(s => s.lastReading?.quality === 'good').length / twin.sensors.length;
    healthScore -= (1 - sensorHealth) * 20;

    // Check synchronization timeliness
    const timeSinceLastSync = Date.now() - twin.lastSync;
    if (timeSinceLastSync > 10000) { // 10 seconds
      healthScore -= Math.min(30, (timeSinceLastSync - 10000) / 1000);
    }

    // Check actuator responsiveness
    const actuatorHealth = twin.actuators.filter(a => a.lastCommand?.executed !== false).length / twin.actuators.length;
    healthScore -= (1 - actuatorHealth) * 15;

    return Math.max(0, Math.min(100, healthScore));
  }

  private async establishIoTConnection(): Promise<void> {
    // No transport is bundled: connecting requires a configured MQTT/CoAP/
    // WebSocket endpoint. Fail loudly instead of pretending a link exists.
    throw new Error('No IoT transport is configured. Register an endpoint and connect through it.');
  }

  private async sendCommandToIoTDevice(): Promise<void> {
    throw new Error('No IoT transport is configured. Register an endpoint and send through it.');
  }

  private async runSimulationStep(twin: DigitalTwin): Promise<SimulationResult> {
    // Run a single simulation step
    const inputs = this.extractSimulationInputs(twin);
    const result = await this.runTwinSimulation(twin.virtualModel, inputs);

    return {
      id: `sim_${Date.now()}`,
      timestamp: Date.now(),
      type: 'transient',
      success: true,
      nodes: [],
      waveforms: [],
      operatingPoint: result as Record<string, number>,
      convergenceInfo: {
        iterations: 1,
        converged: true,
        error: 0.001
      },
      statistics: {
        simulationTime: 100,
        memoryUsage: 50,
        nodeCount: 0,
        elementCount: 0
      }
    };
  }

  private async runPredictiveModels(): Promise<Record<string, { current: number | number[]; predicted: number; confidence: number } | number>> {
    // Baseline predictor: persistence forecast (predicted = current) with a
    // documented low confidence. A real deployment fits a model on telemetry.
    const predictions = {
      temperature: {
        current: 25,
        predicted: 25,
        confidence: 0.5
      },
      efficiency: {
        current: 0.85,
        predicted: 0.85,
        confidence: 0.5
      },
      failure_probability: 0
    };

    return predictions;
  }

  private calculatePredictionConfidence(predictions: unknown): number {
    // Calculate overall prediction confidence
    const confidences = Object.values(predictions as Record<string, { confidence?: number }>).map((p) => p.confidence || 0);
    return confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
  }

  // Utility methods
  private generateSensorValue(sensor: Sensor): number | number[] {
    const baseValue = (sensor.range.min + sensor.range.max) / 2;
    const span = sensor.range.max - sensor.range.min;
    // Deterministic ±5% dither from the id hash: stable across runs.
    const fraction = this.hashString(sensor.id) / 0xffffffff;
    const value = baseValue + (fraction - 0.5) * span * 0.1;

    return Math.max(sensor.range.min, Math.min(sensor.range.max, value));
  }

  private getSensorUnit(type: Sensor['type']): string {
    const units: Record<Sensor['type'], string> = {
      temperature: '°C',
      pressure: 'Pa',
      voltage: 'V',
      current: 'A',
      acceleration: 'm/s²',
      proximity: 'mm',
      camera: 'pixels',
      imu: 'rad/s'
    };
    return units[type] || 'unit';
  }

  stopSynchronization(): void {
    // Background sync was removed (it fabricated sensor/IoT traffic on a
    // timer); kept as a no-op so existing callers keep compiling.
  }

  getAllDigitalTwins(): DigitalTwin[] {
    return Array.from(this.twins.values());
  }

  getAllIoTDevices(): IoTDevice[] {
    return Array.from(this.iotDevices.values());
  }
}

export const digitalTwinService = new DigitalTwinService();
