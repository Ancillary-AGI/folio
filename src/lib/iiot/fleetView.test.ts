/**
 * The fleet console's view layer.
 *
 * These are the answers an operator acts on: which assets are on screen, in what
 * order, what a trend actually contains, and whether a device draft is fit to
 * register. A missing battery must not read as a flat one, a sort must be stable
 * enough to assert on, and an export must survive a name with a comma in it.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THRESHOLDS, type FleetAlert, type FleetDevice, type TelemetrySample } from './fleetManager';
import {
  TREND_CHANNELS, alertCounts, buildDevice, channelLimit, defaultFleetDesign, defaultFleetView,
  draftFromDevice, emptyDeviceDraft, filterDevices, fleetToCSV, formatAge, formatChannel, groupBySite,
  isBreached, sameView, sortDevices, trendRows, trendSpec, trendStats, visibleDevices,
  type FleetView,
} from './fleetView';

const device = (over: Partial<FleetDevice> = {}): FleetDevice => ({
  id: 'arm-01',
  name: 'Assembly Arm 01',
  type: 'robot',
  site: 'line-a',
  firmware: '2.4.1',
  status: 'online',
  lastSeen: 1_700_000_000_000,
  telemetry: { battery: 88, temperature: 41, cpuLoad: 22, latencyMs: 12 },
  ...over,
});

const alert = (deviceId: string, channel: FleetAlert['channel'] = 'temperature'): FleetAlert => ({
  deviceId,
  deviceName: deviceId,
  channel,
  value: 99,
  limit: 85,
  severity: 'critical',
  message: 'over the limit',
});

const view = (over: Partial<FleetView> = {}): FleetView => ({ ...defaultFleetView(), ...over });

describe('fleetView filtering', () => {
  const fleet = [
    device(),
    device({ id: 'agv-07', name: 'AGV 07', type: 'vehicle', site: 'cell-b', firmware: '1.9.0', status: 'degraded' }),
    device({ id: 'plc-02', name: 'Line A PLC', type: 'plc', firmware: '5.2.0', status: 'maintenance' }),
  ];

  it('matches name, id, site, firmware and the human class label', () => {
    expect(filterDevices(fleet, view({ query: 'agv' }), {}).map((entry) => entry.id)).toEqual(['agv-07']);
    expect(filterDevices(fleet, view({ query: 'PLC-02' }), {}).map((entry) => entry.id)).toEqual(['plc-02']);
    expect(filterDevices(fleet, view({ query: 'cell-b' }), {}).map((entry) => entry.id)).toEqual(['agv-07']);
    expect(filterDevices(fleet, view({ query: '2.4.1' }), {}).map((entry) => entry.id)).toEqual(['arm-01']);
    expect(filterDevices(fleet, view({ query: 'robot arm' }), {}).map((entry) => entry.id)).toEqual(['arm-01']);
  });

  it('trims the query so a trailing space does not empty the list', () => {
    expect(filterDevices(fleet, view({ query: '  agv  ' }), {})).toHaveLength(1);
  });

  it('narrows by site, class and status independently', () => {
    expect(filterDevices(fleet, view({ site: 'line-a' }), {})).toHaveLength(2);
    expect(filterDevices(fleet, view({ type: 'plc' }), {})).toHaveLength(1);
    expect(filterDevices(fleet, view({ status: 'degraded' }), {}).map((entry) => entry.id)).toEqual(['agv-07']);
    expect(filterDevices(fleet, view({ status: 'maintenance' }), {}).map((entry) => entry.id)).toEqual(['plc-02']);
  });

  it('the alerting filter follows the alert feed, not the device status', () => {
    const counts = alertCounts([alert('plc-02')]);
    expect(filterDevices(fleet, view({ status: 'alerts' }), counts).map((entry) => entry.id)).toEqual(['plc-02']);
    expect(filterDevices(fleet, view({ status: 'alerts' }), {})).toHaveLength(0);
  });

  it('counts alerts per device', () => {
    expect(alertCounts([alert('a'), alert('a', 'cpuLoad'), alert('b')])).toEqual({ a: 2, b: 1 });
  });
});

describe('fleetView ordering', () => {
  const fleet = [
    device({ id: 'z-online', status: 'online' }),
    device({ id: 'a-online', status: 'online' }),
    device({ id: 'hold', status: 'maintenance' }),
    device({ id: 'hot', status: 'degraded' }),
    device({ id: 'dark', status: 'offline' }),
  ];

  it('an ascending status sort is a triage order, worst first', () => {
    expect(sortDevices(fleet, view({ sort: 'status' }), {}).map((entry) => entry.id))
      .toEqual(['hot', 'dark', 'hold', 'a-online', 'z-online']);
  });

  it('reverses the sort key but keeps the id tie-break canonical in both directions', () => {
    expect(sortDevices(fleet, view({ sort: 'status', descending: true }), {}).map((entry) => entry.id))
      .toEqual(['a-online', 'z-online', 'hold', 'dark', 'hot']);
  });

  it('sorts readings numerically and puts a missing pack below every real one', () => {
    const readings = [
      device({ id: 'b', telemetry: { temperature: 10, cpuLoad: 1, latencyMs: 1, battery: 40 } }),
      device({ id: 'a', telemetry: { temperature: 10, cpuLoad: 1, latencyMs: 1 } }),
      device({ id: 'c', telemetry: { temperature: 10, cpuLoad: 1, latencyMs: 1, battery: 90 } }),
    ];
    expect(sortDevices(readings, view({ sort: 'battery' }), {}).map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by alert count and by last seen', () => {
    const counts = { hot: 3, hold: 1 };
    expect(sortDevices(fleet, view({ sort: 'alerts', descending: true }), counts)[0].id).toBe('hot');
    const stale = [device({ id: 'old', lastSeen: 1 }), device({ id: 'new', lastSeen: 9 })];
    expect(sortDevices(stale, view({ sort: 'lastSeen', descending: true }), {}).map((entry) => entry.id)).toEqual(['new', 'old']);
  });

  it('visibleDevices filters then sorts in one pass', () => {
    const result = visibleDevices(fleet, view({ status: 'online', sort: 'name' }), []);
    expect(result.map((entry) => entry.id)).toEqual(['a-online', 'z-online']);
  });

  it('groups by site alphabetically and keeps the sorted order inside a group', () => {
    const mixed = [device({ id: 'b', site: 'cell-b' }), device({ id: 'a', site: 'line-a' }), device({ id: 'c', site: 'cell-b' })];
    const groups = groupBySite(sortDevices(mixed, view({ sort: 'name' }), {}));
    expect(groups.map((group) => group.site)).toEqual(['cell-b', 'line-a']);
    expect(groups[0].devices.map((entry) => entry.id)).toEqual(['b', 'c']);
  });
});

describe('fleetView trends', () => {
  const samples: TelemetrySample[] = [
    { at: 1000, temperature: 40, cpuLoad: 20, latencyMs: 10, battery: 90 },
    { at: 2000, temperature: 50, cpuLoad: 30, latencyMs: 20 },
    { at: 3000, temperature: 60, cpuLoad: 40, latencyMs: 30, battery: 80 },
  ];

  it('keeps one point per sample and breaks the line where a channel is absent', () => {
    expect(trendRows(samples, 'temperature')).toEqual([
      { at: 1000, value: 40 }, { at: 2000, value: 50 }, { at: 3000, value: 60 },
    ]);
    expect(trendRows(samples, 'battery')).toEqual([
      { at: 1000, value: 90 }, { at: 2000, value: null }, { at: 3000, value: 80 },
    ]);
  });

  it('summarises only the samples that reported the channel', () => {
    expect(trendStats(samples, 'temperature')).toEqual({ count: 3, min: 40, max: 60, mean: 50, last: 60 });
    expect(trendStats(samples, 'battery')).toEqual({ count: 2, min: 80, max: 90, mean: 85, last: 80 });
    expect(trendStats([], 'temperature')).toEqual({ count: 0, min: null, max: null, mean: null, last: null });
  });

  it('formats with the channel precision and an em dash for nothing reported', () => {
    expect(formatChannel(41.25, 'temperature')).toBe('41.3 °C');
    expect(formatChannel(22.4, 'cpuLoad')).toBe('22 %');
    expect(formatChannel(null, 'battery')).toBe('—');
    expect(formatChannel(Number.NaN, 'temperature')).toBe('—');
  });

  it('every channel names a unit and a threshold side', () => {
    expect(TREND_CHANNELS.map((entry) => entry.id)).toEqual(['temperature', 'cpuLoad', 'latencyMs', 'battery']);
    expect(trendSpec('battery').breach).toBe('below');
    expect(trendSpec('temperature').breach).toBe('above');
    expect(trendSpec('nonsense' as never).id).toBe('temperature');
  });

  it('judges a breach against the live threshold, and never against a missing reading', () => {
    expect(channelLimit('temperature', DEFAULT_THRESHOLDS)).toBe(85);
    expect(isBreached('temperature', 90, DEFAULT_THRESHOLDS)).toBe(true);
    expect(isBreached('temperature', 85, DEFAULT_THRESHOLDS)).toBe(false);
    expect(isBreached('battery', 12, DEFAULT_THRESHOLDS)).toBe(true);
    expect(isBreached('battery', 15, DEFAULT_THRESHOLDS)).toBe(false);
    expect(isBreached('battery', undefined, DEFAULT_THRESHOLDS)).toBe(false);
    expect(isBreached('temperature', Number.NaN, DEFAULT_THRESHOLDS)).toBe(false);
  });

  it('ages a reading in shift-handover words', () => {
    const now = 1_700_000_000_000;
    expect(formatAge(now, now)).toBe('just now');
    expect(formatAge(now - 10 * 60_000, now)).toBe('10 min ago');
    expect(formatAge(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatAge(now - 72 * 3_600_000, now)).toBe('3 d ago');
    expect(formatAge(now + 5_000, now)).toBe('just now');
  });
});

describe('fleetView export', () => {
  it('writes a header, one row per device, CRLF endings and RFC quoting', () => {
    const csv = fleetToCSV(
      [device({ name: 'Arm "A", left' })],
      [alert('arm-01'), alert('arm-01', 'battery')],
    );
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('id,name,type,site,firmware,status,last_seen,temperature_c,cpu_load_pct,latency_ms,battery_pct,twin_id,alerts,alert_detail');
    expect(lines[1]).toContain('"Arm ""A"", left"');
    expect(lines[1]).toContain(',2,');
    expect(lines[1]).toContain('critical: over the limit');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(lines).toHaveLength(3);
  });

  it('leaves a missing pack and an unbound twin as empty cells, not zeroes', () => {
    const csv = fleetToCSV([device({ telemetry: { temperature: 1, cpuLoad: 2, latencyMs: 3 } })], []);
    expect(csv.split('\r\n')[1]).toContain(',3,,,0,');
  });
});

describe('fleetView device drafts', () => {
  it('builds a registerable device from a clean draft', () => {
    const draft = { ...emptyDeviceDraft(6), id: 'arm-06', name: 'Assembly Arm 06', battery: '74' };
    const built = buildDevice(draft, ['arm-01']);
    expect(built.problems).toEqual([]);
    expect(built.device).toEqual({
      id: 'arm-06',
      name: 'Assembly Arm 06',
      type: 'sensor_hub',
      site: 'line-a',
      firmware: '1.0.0',
      telemetry: { temperature: 35, cpuLoad: 10, latencyMs: 20, battery: 74 },
    });
  });

  it('omits the pack when the field is blank — mains powered is not flat', () => {
    const built = buildDevice({ ...emptyDeviceDraft(1), name: 'Hub' }, []);
    expect(built.device?.telemetry).toEqual({ temperature: 35, cpuLoad: 10, latencyMs: 20 });
  });

  it('refuses an id already in the registry, but lets an edit keep its own', () => {
    const draft = { ...emptyDeviceDraft(1), id: 'arm-01', name: 'Renamed' };
    expect(buildDevice(draft, ['arm-01']).problems).toContain('Device id "arm-01" is already registered.');
    expect(buildDevice(draft, ['arm-01'], 'arm-01').problems).toEqual([]);
  });

  it('refuses an id that is not a safe key', () => {
    const draft = { ...emptyDeviceDraft(1), id: 'arm 01/', name: 'Hub' };
    expect(buildDevice(draft, []).problems[0]).toMatch(/may only use letters, digits/);
    expect(buildDevice({ ...draft, id: '' }, []).problems).toContain('Device id is required.');
  });

  it('names every missing identity field', () => {
    const problems = buildDevice({ ...emptyDeviceDraft(1), name: '  ', site: '', firmware: '' }, []).problems;
    expect(problems).toContain('Device name is required.');
    expect(problems).toContain('Site is required.');
    expect(problems).toContain('Firmware version is required.');
  });

  it('refuses a reading the plant could not have reported', () => {
    const draft = { ...emptyDeviceDraft(1), name: 'Hub', temperature: '-', cpuLoad: '140', latencyMs: 'abc', battery: '101' };
    const built = buildDevice(draft, []);
    expect(built.device).toBeNull();
    expect(built.problems).toEqual([
      'Temperature (°C) is not a number ("-").',
      'CPU load (%) must be between 0 and 100 (got 140).',
      'Loop latency (ms) is not a number ("abc").',
      'Battery (%) must be between 0 and 100 (got 101).',
    ]);
  });

  it('refuses a blank required reading rather than defaulting it to zero', () => {
    const built = buildDevice({ ...emptyDeviceDraft(1), name: 'Hub', temperature: '' }, []);
    expect(built.device).toBeNull();
    expect(built.problems).toContain('Temperature (°C) is required.');
  });

  it('round-trips a record through the draft and back', () => {
    const record = device();
    const built = buildDevice(draftFromDevice(record), [record.id], record.id);
    expect(built.problems).toEqual([]);
    expect(built.device).toEqual({
      id: record.id, name: record.name, type: record.type, site: record.site,
      firmware: record.firmware, telemetry: record.telemetry,
    });
  });
});

describe('fleetView saved views', () => {
  it('starts on a triage sort with nothing filtered out', () => {
    expect(defaultFleetDesign()).toEqual({
      view: { query: '', site: 'all', type: 'all', status: 'all', sort: 'status', descending: false, grouped: false },
      views: [],
      selectedId: null,
      channel: 'temperature',
    });
  });

  it('ignores query whitespace when deciding a view is already saved', () => {
    expect(sameView(view({ query: 'agv' }), view({ query: ' agv ' }))).toBe(true);
    expect(sameView(view({ sort: 'name' }), view({ sort: 'status' }))).toBe(false);
    expect(sameView(view({ grouped: true }), view())).toBe(false);
  });
});