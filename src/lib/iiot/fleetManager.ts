/**
 * The IIoT device registry behind the fleet panel.
 *
 * Everything here is local state: there is no plant gateway in the browser, so
 * telemetry is what the panel ingests and the thresholds are what the engineer
 * sets. The manager keeps a bounded history per device so a trend is evidence
 * rather than a single reading, and it can snapshot and restore itself so a
 * project save or a VCS checkout carries the fleet with it.
 */
export type FleetDeviceStatus = 'online' | 'offline' | 'degraded' | 'maintenance';

export type FleetDeviceType = 'robot' | 'plc' | 'gateway' | 'sensor_hub' | 'vehicle';

export const FLEET_DEVICE_TYPES: readonly FleetDeviceType[] = ['robot', 'plc', 'gateway', 'sensor_hub', 'vehicle'];

export const FLEET_DEVICE_LABELS: Record<FleetDeviceType, string> = {
  robot: 'Robot arm',
  plc: 'PLC',
  gateway: 'Gateway',
  sensor_hub: 'Sensor hub',
  vehicle: 'AGV / vehicle',
};

export interface FleetTelemetry {
  battery?: number;
  temperature: number;
  cpuLoad: number;
  latencyMs: number;
}

export interface FleetDevice {
  id: string;
  name: string;
  type: FleetDeviceType;
  site: string;
  firmware: string;
  status: FleetDeviceStatus;
  lastSeen: number;
  telemetry: FleetTelemetry;
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

export interface TelemetrySample extends FleetTelemetry {
  at: number;
}

export type AlertChannel = 'temperature' | 'cpuLoad' | 'latencyMs' | 'battery';

export interface FleetAlert {
  deviceId: string;
  deviceName: string;
  channel: AlertChannel;
  value: number;
  limit: number;
  severity: 'critical' | 'warning';
  message: string;
}

export interface FleetThresholds {
  /** Above this the device is degraded — silicon and motor insulation limits. */
  temperatureC: number;
  cpuLoadPct: number;
  /** Above this the loop is late, which is a warning rather than a fault. */
  latencyMs: number;
  /** Below this the pack needs charging before the next shift. */
  batteryPct: number;
}

export const DEFAULT_THRESHOLDS: FleetThresholds = {
  temperatureC: 85,
  cpuLoadPct: 92,
  latencyMs: 250,
  batteryPct: 15,
};

export const ALERT_LABELS: Record<AlertChannel, string> = {
  temperature: 'Temperature',
  cpuLoad: 'CPU load',
  latencyMs: 'Loop latency',
  battery: 'Battery',
};

export interface FleetSnapshot {
  devices: FleetDevice[];
  commands: FleetCommand[];
  history: Record<string, TelemetrySample[]>;
  thresholds: FleetThresholds;
}

/** Samples kept per device. Enough for a shift trend, bounded so a save stays small. */
export const HISTORY_LIMIT = 240;

export type DevicePatch = Partial<Pick<FleetDevice, 'name' | 'type' | 'site' | 'firmware' | 'twinId'>>;

export class IIoTFleetManager {
  private devices = new Map<string, FleetDevice>();
  private commands: FleetCommand[] = [];
  private history = new Map<string, TelemetrySample[]>();
  private thresholds: FleetThresholds = { ...DEFAULT_THRESHOLDS };
  private static idSeq = 0;

  registerDevice(device: Omit<FleetDevice, 'lastSeen' | 'status'> & { status?: FleetDeviceStatus }): FleetDevice {
    const record: FleetDevice = {
      ...device,
      status: device.status ?? 'online',
      lastSeen: Date.now(),
    };
    this.devices.set(record.id, record);
    this.history.set(record.id, [{ ...record.telemetry, at: record.lastSeen }]);
    return record;
  }

  /** Identity, site and firmware are editable; the id is the key everything else hangs off. */
  updateDevice(id: string, patch: DevicePatch): FleetDevice | undefined {
    const device = this.devices.get(id);
    if (!device) return undefined;
    const next: FleetDevice = { ...device, ...patch, id };
    this.devices.set(id, next);
    return next;
  }

  /**
   * Returns the removed record so a caller can put it back. Read `historyOf`
   * first if the trend should survive the undo; the command log stays either way
   * as the audit trail of what was issued to this device.
   */
  removeDevice(id: string): FleetDevice | undefined {
    const device = this.devices.get(id);
    if (!device) return undefined;
    this.devices.delete(id);
    this.history.delete(id);
    return { ...device, telemetry: { ...device.telemetry } };
  }

  /** History travels with an undo, so it is handed back separately from the record. */
  historyOf(id: string): TelemetrySample[] {
    return [...(this.history.get(id) ?? [])];
  }

  restoreDevice(device: FleetDevice, samples: TelemetrySample[] = []): void {
    this.devices.set(device.id, device);
    this.history.set(device.id, samples.slice(-HISTORY_LIMIT));
  }

  ingestTelemetry(deviceId: string, telemetry: Partial<FleetTelemetry>): FleetDevice | undefined {
    const device = this.devices.get(deviceId);
    if (!device) return undefined;
    device.telemetry = { ...device.telemetry, ...telemetry };
    device.lastSeen = Date.now();
    const samples = this.history.get(deviceId) ?? [];
    samples.push({ ...device.telemetry, at: device.lastSeen });
    this.history.set(deviceId, samples.slice(-HISTORY_LIMIT));
    if (this.isCritical(device)) {
      device.status = 'degraded';
    } else if (device.status !== 'maintenance') {
      device.status = 'online';
    }
    return device;
  }

  private isCritical(device: FleetDevice): boolean {
    return (
      device.telemetry.temperature > this.thresholds.temperatureC ||
      device.telemetry.cpuLoad > this.thresholds.cpuLoadPct
    );
  }

  setThresholds(patch: Partial<FleetThresholds>): FleetThresholds {
    this.thresholds = { ...this.thresholds, ...patch };
    // A threshold change re-judges the fleet immediately: lowering the limit has
    // to degrade the devices already over it, not wait for the next sample.
    for (const device of this.devices.values()) {
      if (device.status === 'maintenance' || device.status === 'offline') continue;
      device.status = this.isCritical(device) ? 'degraded' : 'online';
    }
    return { ...this.thresholds };
  }

  getThresholds(): FleetThresholds {
    return { ...this.thresholds };
  }

  alertsFor(deviceId: string): FleetAlert[] {
    const device = this.devices.get(deviceId);
    if (!device) return [];
    const alerts: FleetAlert[] = [];
    const add = (channel: AlertChannel, value: number, limit: number, severity: FleetAlert['severity'], message: string): void => {
      alerts.push({ deviceId, deviceName: device.name, channel, value, limit, severity, message });
    };
    const { temperature, cpuLoad, latencyMs, battery } = device.telemetry;
    if (temperature > this.thresholds.temperatureC) {
      add('temperature', temperature, this.thresholds.temperatureC, 'critical',
        `${temperature} °C is over the ${this.thresholds.temperatureC} °C limit`);
    }
    if (cpuLoad > this.thresholds.cpuLoadPct) {
      add('cpuLoad', cpuLoad, this.thresholds.cpuLoadPct, 'critical',
        `${cpuLoad}% CPU is over the ${this.thresholds.cpuLoadPct}% limit`);
    }
    if (latencyMs > this.thresholds.latencyMs) {
      add('latencyMs', latencyMs, this.thresholds.latencyMs, 'warning',
        `${latencyMs} ms loop latency is over the ${this.thresholds.latencyMs} ms budget`);
    }
    if (battery !== undefined && battery < this.thresholds.batteryPct) {
      add('battery', battery, this.thresholds.batteryPct, 'warning',
        `${battery}% battery is under the ${this.thresholds.batteryPct}% reserve`);
    }
    return alerts;
  }

  fleetAlerts(): FleetAlert[] {
    return this.listDevices().flatMap((device) => this.alertsFor(device.id));
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
    if (command === 'resume' && device) device.status = this.isCritical(device) ? 'degraded' : 'online';
    return cmd;
  }

  listDevices(site?: string): FleetDevice[] {
    const all = Array.from(this.devices.values());
    return site ? all.filter((d) => d.site === site) : all;
  }

  getDevice(id: string): FleetDevice | undefined {
    return this.devices.get(id);
  }

  sites(): string[] {
    return [...new Set(this.listDevices().map((device) => device.site))].sort();
  }

  fleetHealth(): { total: number; online: number; degraded: number; offline: number; maintenance: number; alerts: number; score: number } {
    const devices = this.listDevices();
    const online = devices.filter((d) => d.status === 'online').length;
    const degraded = devices.filter((d) => d.status === 'degraded').length;
    const offline = devices.filter((d) => d.status === 'offline').length;
    const maintenance = devices.filter((d) => d.status === 'maintenance').length;
    const score = devices.length === 0 ? 100 : Math.round(((online + degraded * 0.4) / devices.length) * 100);
    return { total: devices.length, online, degraded, offline, maintenance, alerts: this.fleetAlerts().length, score };
  }

  getCommands(deviceId?: string): FleetCommand[] {
    return deviceId ? this.commands.filter((c) => c.deviceId === deviceId) : [...this.commands];
  }

  clearCommands(): void {
    this.commands = [];
  }

  snapshot(): FleetSnapshot {
    return {
      devices: this.listDevices().map((device) => ({ ...device, telemetry: { ...device.telemetry } })),
      commands: this.commands.map((entry) => ({ ...entry, payload: { ...entry.payload } })),
      history: Object.fromEntries([...this.history.entries()].map(([id, samples]) => [id, samples.map((sample) => ({ ...sample }))])),
      thresholds: { ...this.thresholds },
    };
  }

  restore(snapshot: FleetSnapshot): void {
    this.devices = new Map();
    this.history = new Map();
    this.commands = [];
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(snapshot.thresholds ?? {}) };
    for (const device of snapshot.devices ?? []) {
      if (!device || typeof device.id !== 'string') continue;
      this.devices.set(device.id, { ...device, telemetry: { ...device.telemetry } });
      this.history.set(device.id, (snapshot.history?.[device.id] ?? []).slice(-HISTORY_LIMIT));
    }
    this.commands = (snapshot.commands ?? []).map((entry) => ({ ...entry }));
  }

  /**
   * A believable standing fleet, seeded once. The history is a deterministic
   * walk rather than noise from `Math.random`, so a trend on screen is the same
   * trend after a reload and a test can assert on it.
   */
  seedDemoFleet(now = Date.now()): boolean {
    if (this.devices.size > 0) return false;
    const seed: Array<Omit<FleetDevice, 'lastSeen' | 'status'>> = [
      {
        id: 'arm-01', name: 'Assembly Arm 01', type: 'robot', site: 'line-a', firmware: '2.4.1',
        telemetry: { battery: 88, temperature: 41, cpuLoad: 22, latencyMs: 12 },
      },
      {
        id: 'agv-07', name: 'AGV 07', type: 'vehicle', site: 'line-a', firmware: '1.9.0',
        telemetry: { battery: 54, temperature: 36, cpuLoad: 18, latencyMs: 20 },
      },
      {
        id: 'plc-02', name: 'Line A PLC', type: 'plc', site: 'line-a', firmware: '5.2.0',
        telemetry: { temperature: 48, cpuLoad: 61, latencyMs: 4 },
      },
      {
        id: 'gw-cell-b', name: 'Cell B Gateway', type: 'gateway', site: 'cell-b', firmware: '3.1.4',
        telemetry: { temperature: 52, cpuLoad: 34, latencyMs: 86 },
      },
      {
        id: 'env-11', name: 'Environment Hub 11', type: 'sensor_hub', site: 'cell-b', firmware: '0.9.7',
        telemetry: { battery: 12, temperature: 29, cpuLoad: 7, latencyMs: 140 },
      },
    ];
    let state = 20260117;
    const drift = (scale: number): number => {
      state = (state * 1103515245 + 12345) % 2147483648;
      return ((state / 2147483648) - 0.5) * scale;
    };
    for (const entry of seed) {
      const device = this.registerDevice(entry);
      const samples: TelemetrySample[] = [];
      for (let step = 23; step >= 0; step -= 1) {
        const at = now - step * 5 * 60 * 1000;
        samples.push({
          at,
          temperature: Math.round((entry.telemetry.temperature + drift(6) + Math.sin(step / 3) * 2) * 10) / 10,
          cpuLoad: Math.max(1, Math.min(99, Math.round(entry.telemetry.cpuLoad + drift(14) + Math.cos(step / 4) * 6))),
          latencyMs: Math.max(1, Math.round(entry.telemetry.latencyMs + drift(18))),
          ...(entry.telemetry.battery === undefined
            ? {}
            : { battery: Math.max(1, Math.min(100, Math.round(entry.telemetry.battery + step * 0.4 + drift(3)))) }),
        });
      }
      // The trend ends at the reading the registry currently holds, so the last
      // chart point and the device row can never disagree.
      samples[samples.length - 1] = { ...entry.telemetry, at: now };
      this.history.set(device.id, samples);
      device.lastSeen = now;
    }
    return true;
  }
}

export const iiotFleetManager = new IIoTFleetManager();