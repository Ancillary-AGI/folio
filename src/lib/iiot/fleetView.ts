/**
 * The fleet console's view layer: what the engineer is looking at, and what a
 * trend or an export is allowed to claim.
 *
 * The registry (`fleetManager`) owns the devices; this module owns the questions
 * asked of them — which ones are on screen, in what order, what the history of a
 * channel actually contains, and whether a device draft is fit to register. It is
 * pure so the answers can be tested without rendering a panel.
 */
import {
  FLEET_DEVICE_LABELS,
  type AlertChannel,
  type FleetAlert,
  type FleetDevice,
  type FleetDeviceStatus,
  type FleetDeviceType,
  type FleetThresholds,
  type TelemetrySample,
} from './fleetManager';

export type TrendChannel = 'temperature' | 'cpuLoad' | 'latencyMs' | 'battery';

export interface TrendChannelSpec {
  id: TrendChannel;
  label: string;
  unit: string;
  /** The threshold this channel is judged against, or null when it has none. */
  limitKey: keyof FleetThresholds | null;
  /** Which side of the limit is the fault. */
  breach: 'above' | 'below';
  decimals: number;
}

export const TREND_CHANNELS: readonly TrendChannelSpec[] = [
  { id: 'temperature', label: 'Temperature', unit: '°C', limitKey: 'temperatureC', breach: 'above', decimals: 1 },
  { id: 'cpuLoad', label: 'CPU load', unit: '%', limitKey: 'cpuLoadPct', breach: 'above', decimals: 0 },
  { id: 'latencyMs', label: 'Loop latency', unit: 'ms', limitKey: 'latencyMs', breach: 'above', decimals: 0 },
  { id: 'battery', label: 'Battery', unit: '%', limitKey: 'batteryPct', breach: 'below', decimals: 0 },
];

export const trendSpec = (channel: TrendChannel): TrendChannelSpec =>
  TREND_CHANNELS.find((entry) => entry.id === channel) ?? TREND_CHANNELS[0];

export type StatusFilter = 'all' | FleetDeviceStatus | 'alerts';

export const STATUS_FILTERS: ReadonlyArray<{ id: StatusFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'online', label: 'Online' },
  { id: 'degraded', label: 'Degraded' },
  { id: 'offline', label: 'Offline' },
  { id: 'maintenance', label: 'On hold' },
  { id: 'alerts', label: 'Alerting' },
];

export type FleetSort =
  | 'name' | 'status' | 'temperature' | 'cpuLoad' | 'latencyMs' | 'battery' | 'lastSeen' | 'alerts';

export const FLEET_SORTS: ReadonlyArray<{ id: FleetSort; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'status', label: 'Status' },
  { id: 'alerts', label: 'Alert count' },
  { id: 'temperature', label: 'Temperature' },
  { id: 'cpuLoad', label: 'CPU load' },
  { id: 'latencyMs', label: 'Loop latency' },
  { id: 'battery', label: 'Battery' },
  { id: 'lastSeen', label: 'Last seen' },
];

/** Worst first, so an ascending status sort is a triage order rather than an alphabet. */
const STATUS_RANK: Record<FleetDeviceStatus, number> = { degraded: 0, offline: 1, maintenance: 2, online: 3 };

export const STATUS_LABELS: Record<FleetDeviceStatus, string> = {
  online: 'Online',
  degraded: 'Degraded',
  offline: 'Offline',
  maintenance: 'On hold',
};

export interface FleetView {
  query: string;
  /** 'all' or a site name from the registry. */
  site: string;
  type: 'all' | FleetDeviceType;
  status: StatusFilter;
  sort: FleetSort;
  descending: boolean;
  grouped: boolean;
}

export interface SavedView {
  key: string;
  name: string;
  view: FleetView;
}

export interface FleetDesign {
  view: FleetView;
  views: SavedView[];
  selectedId: string | null;
  channel: TrendChannel;
}

export const defaultFleetView = (): FleetView => ({
  query: '',
  site: 'all',
  type: 'all',
  status: 'all',
  sort: 'status',
  descending: false,
  grouped: false,
});

export const defaultFleetDesign = (): FleetDesign => ({
  view: defaultFleetView(),
  views: [],
  selectedId: null,
  channel: 'temperature',
});

/** True when two views would show the same list — a saved view is only worth naming once. */
export const sameView = (a: FleetView, b: FleetView): boolean =>
  a.query.trim() === b.query.trim() && a.site === b.site && a.type === b.type &&
  a.status === b.status && a.sort === b.sort && a.descending === b.descending && a.grouped === b.grouped;

export function alertCounts(alerts: FleetAlert[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const alert of alerts) counts[alert.deviceId] = (counts[alert.deviceId] ?? 0) + 1;
  return counts;
}

export function filterDevices(
  devices: FleetDevice[],
  view: FleetView,
  counts: Record<string, number>,
): FleetDevice[] {
  const query = view.query.trim().toLowerCase();
  return devices.filter((device) => {
    if (view.site !== 'all' && device.site !== view.site) return false;
    if (view.type !== 'all' && device.type !== view.type) return false;
    if (view.status === 'alerts' && !(counts[device.id] > 0)) return false;
    if (view.status !== 'all' && view.status !== 'alerts' && device.status !== view.status) return false;
    if (!query) return true;
    return `${device.id} ${device.name} ${device.site} ${device.firmware} ${FLEET_DEVICE_LABELS[device.type]}`
      .toLowerCase()
      .includes(query);
  });
}

const sortValue = (device: FleetDevice, sort: FleetSort, counts: Record<string, number>): number | string => {
  switch (sort) {
    case 'name': return device.name.toLowerCase();
    case 'status': return STATUS_RANK[device.status];
    case 'alerts': return counts[device.id] ?? 0;
    case 'lastSeen': return device.lastSeen;
    case 'battery': return device.telemetry.battery ?? -1;
    default: return device.telemetry[sort];
  }
};

export function sortDevices(
  devices: FleetDevice[],
  view: FleetView,
  counts: Record<string, number>,
): FleetDevice[] {
  const direction = view.descending ? -1 : 1;
  // The id breaks every tie, so the order is stable across reloads and a test can
  // assert on it rather than on whatever the Map happened to yield.
  return [...devices].sort((a, b) => {
    const left = sortValue(a, view.sort, counts);
    const right = sortValue(b, view.sort, counts);
    if (left < right) return -direction;
    if (left > right) return direction;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export function visibleDevices(
  devices: FleetDevice[],
  view: FleetView,
  alerts: FleetAlert[],
): FleetDevice[] {
  const counts = alertCounts(alerts);
  return sortDevices(filterDevices(devices, view, counts), view, counts);
}

export function groupBySite(devices: FleetDevice[]): Array<{ site: string; devices: FleetDevice[] }> {
  const groups = new Map<string, FleetDevice[]>();
  for (const device of devices) {
    const bucket = groups.get(device.site);
    if (bucket) bucket.push(device);
    else groups.set(device.site, [device]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([site, entries]) => ({ site, devices: entries }));
}

export interface TrendStats {
  count: number;
  min: number | null;
  max: number | null;
  mean: number | null;
  last: number | null;
}

const channelValue = (sample: TelemetrySample, channel: TrendChannel): number | null => {
  const value = sample[channel];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

/** One point per sample. A channel the device does not report stays null, so the line breaks rather than inventing a zero. */
export function trendRows(samples: TelemetrySample[], channel: TrendChannel): Array<{ at: number; value: number | null }> {
  return samples.map((sample) => ({ at: sample.at, value: channelValue(sample, channel) }));
}

export function trendStats(samples: TelemetrySample[], channel: TrendChannel): TrendStats {
  const values = samples.map((sample) => channelValue(sample, channel)).filter((value): value is number => value !== null);
  if (values.length === 0) return { count: 0, min: null, max: null, mean: null, last: null };
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: total / values.length,
    last: values[values.length - 1],
  };
}

export const formatChannel = (value: number | null | undefined, channel: TrendChannel): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const spec = trendSpec(channel);
  return `${value.toFixed(spec.decimals)} ${spec.unit}`;
};

export function channelLimit(channel: TrendChannel, thresholds: FleetThresholds): number | null {
  const key = trendSpec(channel).limitKey;
  return key ? thresholds[key] : null;
}

/** A missing reading is not a breach: a mains-powered controller has no pack to be flat. */
export function isBreached(channel: TrendChannel, value: number | undefined, thresholds: FleetThresholds): boolean {
  if (value === undefined || !Number.isFinite(value)) return false;
  const limit = channelLimit(channel, thresholds);
  if (limit === null) return false;
  return trendSpec(channel).breach === 'above' ? value > limit : value < limit;
}

/** How stale a reading is, in the words an operator uses on a shift handover. */
export function formatAge(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

const csvCell = (value: string | number): string => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function fleetToCSV(devices: FleetDevice[], alerts: FleetAlert[]): string {
  const header = [
    'id', 'name', 'type', 'site', 'firmware', 'status', 'last_seen',
    'temperature_c', 'cpu_load_pct', 'latency_ms', 'battery_pct', 'twin_id', 'alerts', 'alert_detail',
  ];
  const lines = [header.join(',')];
  for (const device of devices) {
    const own = alerts.filter((alert) => alert.deviceId === device.id);
    lines.push([
      device.id,
      device.name,
      FLEET_DEVICE_LABELS[device.type],
      device.site,
      device.firmware,
      device.status,
      new Date(device.lastSeen).toISOString(),
      device.telemetry.temperature,
      device.telemetry.cpuLoad,
      device.telemetry.latencyMs,
      device.telemetry.battery ?? '',
      device.twinId ?? '',
      own.length,
      own.map((alert) => `${alert.severity}: ${alert.message}`).join('; '),
    ].map(csvCell).join(','));
  }
  return `${lines.join('\r\n')}\r\n`;
}

export interface DeviceDraft {
  id: string;
  name: string;
  type: FleetDeviceType;
  site: string;
  firmware: string;
  temperature: string;
  cpuLoad: string;
  latencyMs: string;
  /** Empty means the device has no pack, which is different from a flat one. */
  battery: string;
}

export const emptyDeviceDraft = (index: number): DeviceDraft => ({
  id: `device-${index}`,
  name: '',
  type: 'sensor_hub',
  site: 'line-a',
  firmware: '1.0.0',
  temperature: '35',
  cpuLoad: '10',
  latencyMs: '20',
  battery: '',
});

export const draftFromDevice = (device: FleetDevice): DeviceDraft => ({
  id: device.id,
  name: device.name,
  type: device.type,
  site: device.site,
  firmware: device.firmware,
  temperature: String(device.telemetry.temperature),
  cpuLoad: String(device.telemetry.cpuLoad),
  latencyMs: String(device.telemetry.latencyMs),
  battery: device.telemetry.battery === undefined ? '' : String(device.telemetry.battery),
});

const numberIn = (text: string, label: string, min: number, max: number, problems: string[]): number | null => {
  const trimmed = text.trim();
  if (trimmed === '') {
    problems.push(`${label} is required.`);
    return null;
  }
  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    problems.push(`${label} is not a number ("${trimmed}").`);
    return null;
  }
  if (value < min || value > max) {
    problems.push(`${label} must be between ${min} and ${max} (got ${value}).`);
    return null;
  }
  return value;
};

export interface BuiltDevice {
  id: string;
  name: string;
  type: FleetDeviceType;
  site: string;
  firmware: string;
  telemetry: { temperature: number; cpuLoad: number; latencyMs: number; battery?: number };
}

/**
 * A device is only registered once every field reads as something the plant could
 * have reported. The id is the key the history, commands and twin binding hang
 * off, so a collision is refused rather than silently overwriting a live asset.
 */
export function buildDevice(
  draft: DeviceDraft,
  existingIds: readonly string[],
  editingId?: string,
): { device: BuiltDevice | null; problems: string[] } {
  const problems: string[] = [];
  const id = draft.id.trim();
  if (!id) problems.push('Device id is required.');
  else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) {
    problems.push(`Device id "${id}" may only use letters, digits, dot, dash and underscore, and must start with a letter or digit.`);
  } else if (id !== editingId && existingIds.includes(id)) {
    problems.push(`Device id "${id}" is already registered.`);
  }
  const name = draft.name.trim();
  if (!name) problems.push('Device name is required.');
  const site = draft.site.trim();
  if (!site) problems.push('Site is required.');
  const firmware = draft.firmware.trim();
  if (!firmware) problems.push('Firmware version is required.');

  const temperature = numberIn(draft.temperature, 'Temperature (°C)', -60, 250, problems);
  const cpuLoad = numberIn(draft.cpuLoad, 'CPU load (%)', 0, 100, problems);
  const latencyMs = numberIn(draft.latencyMs, 'Loop latency (ms)', 0, 600000, problems);
  let battery: number | undefined;
  if (draft.battery.trim() !== '') {
    const parsed = numberIn(draft.battery, 'Battery (%)', 0, 100, problems);
    if (parsed !== null) battery = parsed;
  }

  if (problems.length > 0 || temperature === null || cpuLoad === null || latencyMs === null) {
    return { device: null, problems };
  }
  return {
    device: {
      id,
      name,
      type: draft.type,
      site,
      firmware,
      telemetry: { temperature, cpuLoad, latencyMs, ...(battery === undefined ? {} : { battery }) },
    },
    problems,
  };
}

/** The commands the registry can issue without a gateway: state changes an operator owns. */
export const FLEET_COMMANDS: ReadonlyArray<{ id: string; label: string; detail: string }> = [
  { id: 'maintenance', label: 'Hold for maintenance', detail: 'Takes the device out of the fleet health score until it is resumed.' },
  { id: 'resume', label: 'Resume service', detail: 'Returns the device to service; it stays degraded if a threshold is still breached.' },
  { id: 'restart', label: 'Request restart', detail: 'Logged as issued. Without a gateway the device does not actually reboot.' },
  { id: 'calibrate', label: 'Request calibration', detail: 'Logged as issued. The reading offsets are unchanged until a bench reports back.' },
  { id: 'identify', label: 'Identify on floor', detail: 'Logged as issued. No beacon is wired to the browser.' },
];

export const ALERT_CHANNEL_LABELS: Record<AlertChannel, string> = {
  temperature: 'Temperature',
  cpuLoad: 'CPU load',
  latencyMs: 'Loop latency',
  battery: 'Battery',
};