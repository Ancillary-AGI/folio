export interface IoTDevice {
  id: string;
  name: string;
  type: 'sensor' | 'actuator' | 'gateway' | 'controller' | 'smart_device';
  category: string;
  model: string;
  manufacturer: string;
  firmwareVersion: string;
  hardwareVersion: string;
  serialNumber: string;
  macAddress: string;
  ipAddress?: string;
  location: {
    building?: string;
    floor?: string;
    room?: string;
    coordinates?: { x: number; y: number; z: number };
  };
  capabilities: string[];
  status: 'online' | 'offline' | 'maintenance' | 'error';
  lastSeen: Date;
  batteryLevel?: number;
  signalStrength?: number;
  temperature?: number;
  configuration: Record<string, unknown>;
  security: {
    authentication: boolean;
    encryption: boolean;
    certificates: string[];
  };
}

export interface IoTDeviceGroup {
  id: string;
  name: string;
  description: string;
  deviceIds: string[];
  policies: IoTPolicy[];
  tags: string[];
}

export interface IoTPolicy {
  id: string;
  name: string;
  type: 'access' | 'data' | 'security' | 'maintenance';
  rules: IoTRule[];
  enabled: boolean;
}

export interface IoTRule {
  id: string;
  condition: string;
  action: string;
  priority: number;
  enabled: boolean;
}

export interface IoTDataStream {
  id: string;
  deviceId: string;
  sensorType: string;
  dataType: 'numeric' | 'boolean' | 'string' | 'json';
  unit?: string;
  frequency: number; // Hz
  retention: number; // days
  lastValue?: unknown;
  lastUpdated: Date;
  metadata: Record<string, unknown>;
}

export interface IoTAlert {
  id: string;
  deviceId: string;
  type: 'connectivity' | 'performance' | 'security' | 'maintenance' | 'threshold';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  value?: unknown;
  threshold?: unknown;
  acknowledged: boolean;
  timestamp: Date;
  resolvedAt?: Date;
}

export interface IoTAnalytics {
  deviceId: string;
  metric: string;
  timeRange: { start: Date; end: Date };
  data: Array<{ timestamp: Date; value: unknown }>;
  statistics: {
    min: number;
    max: number;
    avg: number;
    std: number;
    count: number;
  };
}

export interface IoTCommand {
  id: string;
  deviceId: string;
  command: string;
  parameters: Record<string, unknown>;
  status: 'pending' | 'sent' | 'executed' | 'failed';
  sentAt: Date;
  executedAt?: Date;
  result?: unknown;
  timeout: number; // seconds
}

export interface IoTFirmwareUpdate {
  id: string;
  deviceId: string;
  version: string;
  url: string;
  checksum: string;
  size: number;
  status: 'pending' | 'downloading' | 'installing' | 'completed' | 'failed';
  progress: number;
  scheduledAt?: Date;
  completedAt?: Date;
  error?: string;
}

export class IoTDeviceManagement {
  private devices: Map<string, IoTDevice> = new Map();
  private groups: Map<string, IoTDeviceGroup> = new Map();
  private dataStreams: Map<string, IoTDataStream> = new Map();
  private alerts: Map<string, IoTAlert> = new Map();
  private commands: Map<string, IoTCommand> = new Map();
  private firmwareUpdates: Map<string, IoTFirmwareUpdate> = new Map();

  constructor() {}

  // Device Management
  registerDevice(device: Omit<IoTDevice, 'id' | 'lastSeen'>): IoTDevice {
    const newDevice: IoTDevice = {
      ...device,
      id: `device-${Date.now()}`,
      lastSeen: new Date()
    };

    this.devices.set(newDevice.id, newDevice);

    // Initialize data streams based on device capabilities
    this.initializeDataStreams(newDevice);

    return newDevice;
  }

  updateDeviceStatus(deviceId: string, status: IoTDevice['status'], additionalData?: Partial<IoTDevice>): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    device.status = status;
    device.lastSeen = new Date();

    if (additionalData) {
      Object.assign(device, additionalData);
    }

    // Check for alerts based on status change
    this.checkDeviceAlerts(device);

    return true;
  }

  updateDeviceData(deviceId: string, sensorData: Record<string, unknown>): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    device.lastSeen = new Date();

    // Update data streams
    Object.entries(sensorData).forEach(([sensorType, value]) => {
      const stream = Array.from(this.dataStreams.values())
        .find(s => s.deviceId === deviceId && s.sensorType === sensorType);

      if (stream) {
        stream.lastValue = value;
        stream.lastUpdated = new Date();

        // Check thresholds and create alerts
        this.checkDataThresholds(stream, value);
      }
    });

    return true;
  }

  private initializeDataStreams(device: IoTDevice): void {
    device.capabilities.forEach(capability => {
      const stream: IoTDataStream = {
        id: `stream-${device.id}-${capability}`,
        deviceId: device.id,
        sensorType: capability,
        dataType: this.inferDataType(capability),
        unit: this.getUnitForCapability(capability),
        frequency: 1, // 1 Hz default
        retention: 30, // 30 days
        lastUpdated: new Date(),
        metadata: {}
      };

      this.dataStreams.set(stream.id, stream);
    });
  }

  private inferDataType(capability: string): IoTDataStream['dataType'] {
    if (capability.includes('temperature') || capability.includes('humidity') || capability.includes('pressure')) {
      return 'numeric';
    }
    if (capability.includes('motion') || capability.includes('presence')) {
      return 'boolean';
    }
    return 'json';
  }

  private getUnitForCapability(capability: string): string | undefined {
    const unitMap: Record<string, string> = {
      temperature: '°C',
      humidity: '%',
      pressure: 'hPa',
      voltage: 'V',
      current: 'A',
      power: 'W'
    };

    return unitMap[capability];
  }

  // Device Groups
  createDeviceGroup(group: Omit<IoTDeviceGroup, 'id'>): IoTDeviceGroup {
    const newGroup: IoTDeviceGroup = {
      ...group,
      id: `group-${Date.now()}`
    };

    this.groups.set(newGroup.id, newGroup);
    return newGroup;
  }

  addDeviceToGroup(groupId: string, deviceId: string): boolean {
    const group = this.groups.get(groupId);
    if (!group || group.deviceIds.includes(deviceId)) return false;

    group.deviceIds.push(deviceId);
    return true;
  }

  // Command and Control
  sendCommand(deviceId: string, command: string, parameters: Record<string, unknown>, timeout: number = 30): IoTCommand {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    const cmd: IoTCommand = {
      id: `cmd-${Date.now()}`,
      deviceId,
      command,
      parameters,
      status: 'pending',
      sentAt: new Date(),
      timeout
    };

    this.commands.set(cmd.id, cmd);

    // Simulate command execution (in production, this would send to actual device)
    setTimeout(() => {
      this.executeCommand(cmd.id);
    }, 1000);

    return cmd;
  }

  private executeCommand(commandId: string): void {
    const cmd = this.commands.get(commandId);
    if (!cmd) return;

    // Simulate command execution
    cmd.status = Math.random() > 0.1 ? 'executed' : 'failed';
    cmd.executedAt = new Date();
    cmd.result = cmd.status === 'executed' ? { success: true } : { error: 'Command failed' };
  }

  // Firmware Management
  scheduleFirmwareUpdate(deviceId: string, update: Omit<IoTFirmwareUpdate, 'id' | 'deviceId' | 'status' | 'progress'>): IoTFirmwareUpdate {
    const device = this.devices.get(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    const firmwareUpdate: IoTFirmwareUpdate = {
      ...update,
      id: `update-${Date.now()}`,
      deviceId,
      status: 'pending',
      progress: 0
    };

    this.firmwareUpdates.set(firmwareUpdate.id, firmwareUpdate);
    return firmwareUpdate;
  }

  // Alert Management
  private checkDeviceAlerts(device: IoTDevice): void {
    if (device.status === 'offline') {
      this.createAlert(device.id, 'connectivity', 'high', `Device ${device.name} went offline`);
    }

    if (device.batteryLevel && device.batteryLevel < 20) {
      this.createAlert(device.id, 'maintenance', 'medium', `Low battery on ${device.name}: ${device.batteryLevel}%`);
    }
  }

  private checkDataThresholds(stream: IoTDataStream, value: unknown): void {
    // Simple threshold checking - in production, load from configuration
    if (typeof value === 'number') {
      const thresholds: Record<string, { min?: number; max?: number }> = {
        temperature: { min: -10, max: 50 },
        humidity: { min: 0, max: 100 },
        voltage: { min: 3.0, max: 5.5 }
      };

      const threshold = thresholds[stream.sensorType];
      if (threshold) {
        if (threshold.min !== undefined && value < threshold.min) {
          this.createAlert(stream.deviceId, 'threshold', 'medium',
            `${stream.sensorType} below minimum: ${value} ${stream.unit}`);
        }
        if (threshold.max !== undefined && value > threshold.max) {
          this.createAlert(stream.deviceId, 'threshold', 'medium',
            `${stream.sensorType} above maximum: ${value} ${stream.unit}`);
        }
      }
    }
  }

  private createAlert(deviceId: string, type: IoTAlert['type'], severity: IoTAlert['severity'], message: string, value?: unknown): void {
    const alert: IoTAlert = {
      id: `alert-${Date.now()}`,
      deviceId,
      type,
      severity,
      message,
      value,
      acknowledged: false,
      timestamp: new Date()
    };

    this.alerts.set(alert.id, alert);
  }

  acknowledgeAlert(alertId: string): boolean {
    const alert = this.alerts.get(alertId);
    if (!alert) return false;

    alert.acknowledged = true;
    return true;
  }

  // Analytics
  getDeviceAnalytics(deviceId: string, metric: string, startDate: Date, endDate: Date): IoTAnalytics | null {
    const streams = Array.from(this.dataStreams.values())
      .filter(s => s.deviceId === deviceId && s.sensorType === metric);

    if (streams.length === 0) return null;

    // Mock data generation - in production, query from time-series database
    const data: Array<{ timestamp: Date; value: unknown }> = [];
    const now = new Date();
    const hours = 24;

    for (let i = 0; i < hours; i++) {
      const timestamp = new Date(now.getTime() - i * 60 * 60 * 1000);
      if (timestamp >= startDate && timestamp <= endDate) {
        data.push({
          timestamp,
          value: Math.random() * 100 // Mock value
        });
      }
    }

    const values = data.map(d => d.value as number).filter(v => typeof v === 'number');
    const statistics = {
      min: Math.min(...values),
      max: Math.max(...values),
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      std: Math.sqrt(values.reduce((sum, val) => sum + Math.pow(val - (values.reduce((a, b) => a + b, 0) / values.length), 2), 0) / values.length),
      count: values.length
    };

    return {
      deviceId,
      metric,
      timeRange: { start: startDate, end: endDate },
      data,
      statistics
    };
  }

  // Bulk Operations
  bulkCommand(deviceIds: string[], command: string, parameters: Record<string, unknown>): IoTCommand[] {
    return deviceIds.map(deviceId => this.sendCommand(deviceId, command, parameters));
  }

  bulkFirmwareUpdate(deviceIds: string[], firmwareUpdate: Omit<IoTFirmwareUpdate, 'id' | 'deviceId' | 'status' | 'progress'>): IoTFirmwareUpdate[] {
    return deviceIds.map(deviceId => this.scheduleFirmwareUpdate(deviceId, firmwareUpdate));
  }

  // Security
  authenticateDevice(deviceId: string, credentials: { token?: string; certificate?: string }): boolean {
    const device = this.devices.get(deviceId);
    if (!device) return false;

    // Mock authentication - in production, verify against device certificates/tokens
    return device.security.authentication;
  }

  // Getters
  getDevice(deviceId: string): IoTDevice | undefined {
    return this.devices.get(deviceId);
  }

  getAllDevices(): IoTDevice[] {
    return Array.from(this.devices.values());
  }

  getDevicesByType(type: IoTDevice['type']): IoTDevice[] {
    return this.getAllDevices().filter(device => device.type === type);
  }

  getDevicesByStatus(status: IoTDevice['status']): IoTDevice[] {
    return this.getAllDevices().filter(device => device.status === status);
  }

  getDeviceGroup(groupId: string): IoTDeviceGroup | undefined {
    return this.groups.get(groupId);
  }

  getAllDeviceGroups(): IoTDeviceGroup[] {
    return Array.from(this.groups.values());
  }

  getDataStream(streamId: string): IoTDataStream | undefined {
    return this.dataStreams.get(streamId);
  }

  getDeviceDataStreams(deviceId: string): IoTDataStream[] {
    return Array.from(this.dataStreams.values()).filter(stream => stream.deviceId === deviceId);
  }

  getActiveAlerts(): IoTAlert[] {
    return Array.from(this.alerts.values()).filter(alert => !alert.acknowledged);
  }

  getCommand(commandId: string): IoTCommand | undefined {
    return this.commands.get(commandId);
  }

  getDeviceCommands(deviceId: string): IoTCommand[] {
    return Array.from(this.commands.values()).filter(cmd => cmd.deviceId === deviceId);
  }

  getFirmwareUpdate(updateId: string): IoTFirmwareUpdate | undefined {
    return this.firmwareUpdates.get(updateId);
  }

  getDeviceFirmwareUpdates(deviceId: string): IoTFirmwareUpdate[] {
    return Array.from(this.firmwareUpdates.values()).filter(update => update.deviceId === deviceId);
  }

  // Dashboard Metrics
  getDashboardMetrics(): {
    totalDevices: number;
    onlineDevices: number;
    offlineDevices: number;
    alertsCount: number;
    commandsPending: number;
    updatesPending: number;
  } {
    const devices = this.getAllDevices();
    const alerts = this.getActiveAlerts();
    const commands = Array.from(this.commands.values());
    const updates = Array.from(this.firmwareUpdates.values());

    return {
      totalDevices: devices.length,
      onlineDevices: devices.filter(d => d.status === 'online').length,
      offlineDevices: devices.filter(d => d.status === 'offline').length,
      alertsCount: alerts.length,
      commandsPending: commands.filter(c => c.status === 'pending').length,
      updatesPending: updates.filter(u => u.status === 'pending').length
    };
  }
}

export const iotDeviceManagement = new IoTDeviceManagement();