export type FleetDeviceStatus = 'online' | 'offline' | 'degraded' | 'maintenance';

export interface FleetDevice {
  id: string;
  name: string;
  type: 'robot' | 'plc' | 'gateway' | 'sensor_hub' | 'vehicle';
  site: string;
  firmware: string;
  status: FleetDeviceStatus;
  lastSeen: number;
  telemetry: {
    battery?: number;
    temperature: number;
    cpuLoad: number;
    latencyMs: number;
  };
  twinId?: string;
}

export interface FleetCommand {
  id: string;
  deviceId: string;
  command: string;
  payload: Record<string, unknown>;
  issuedAt: number;
  status: 'queued' | 'ack' | 'failed';
}

export class IIoTFleetManager {
  private devices = new Map<string, FleetDevice>();
  private commands: FleetCommand[] = [];
  private static idSeq = 0;

  registerDevice(device: Omit<FleetDevice, 'lastSeen' | 'status'> & { status?: FleetDeviceStatus }): FleetDevice {
    const record: FleetDevice = {
      ...device,
      status: device.status ?? 'online',
      lastSeen: Date.now(),
    };
    this.devices.set(record.id, record);
    return record;
  }

  ingestTelemetry(deviceId: string, telemetry: Partial<FleetDevice['telemetry']>): FleetDevice | undefined {
    const device = this.devices.get(deviceId);
    if (!device) return undefined;
    device.telemetry = { ...device.telemetry, ...telemetry };
    device.lastSeen = Date.now();
    if ((device.telemetry.temperature ?? 0) > 85 || (device.telemetry.cpuLoad ?? 0) > 92) {
      device.status = 'degraded';
    } else if (device.status !== 'maintenance') {
      device.status = 'online';
    }
    return device;
  }

  command(deviceId: string, command: string, payload: Record<string, unknown> = {}): FleetCommand {
    const device = this.devices.get(deviceId);
    const cmd: FleetCommand = {
      id: `cmd_${Date.now()}_${++IIoTFleetManager.idSeq}`,
      deviceId,
      command,
      payload,
      issuedAt: Date.now(),
      status: device ? 'ack' : 'failed',
    };
    this.commands.push(cmd);
    if (command === 'maintenance' && device) device.status = 'maintenance';
    if (command === 'resume' && device) device.status = 'online';
    return cmd;
  }

  listDevices(site?: string): FleetDevice[] {
    const all = Array.from(this.devices.values());
    return site ? all.filter((d) => d.site === site) : all;
  }

  fleetHealth(): { total: number; online: number; degraded: number; offline: number; score: number } {
    const devices = this.listDevices();
    const online = devices.filter((d) => d.status === 'online').length;
    const degraded = devices.filter((d) => d.status === 'degraded').length;
    const offline = devices.filter((d) => d.status === 'offline').length;
    const score = devices.length === 0 ? 100 : Math.round(((online + degraded * 0.4) / devices.length) * 100);
    return { total: devices.length, online, degraded, offline, score };
  }

  getCommands(deviceId?: string): FleetCommand[] {
    return deviceId ? this.commands.filter((c) => c.deviceId === deviceId) : this.commands;
  }
}

export const iiotFleetManager = new IIoTFleetManager();
