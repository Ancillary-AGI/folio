import HoverHelp from '../ui/HoverHelp'
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, ArrowDownUp, Battery, Cpu, Download, Gauge, Layers,
  Link2, Link2Off, Network, Pause, Pencil, Play, Plus, RefreshCw, Search, Server, ShieldCheck,
  Thermometer, Trash2, Undo2, X, Zap,
} from 'lucide-react';
import { digitalTwinService, type DigitalTwin } from '../../lib/digitalTwin/digitalTwinService';
import {
  DEFAULT_THRESHOLDS, FLEET_DEVICE_LABELS, FLEET_DEVICE_TYPES, HISTORY_LIMIT, iiotFleetManager,
  type FleetAlert, type FleetCommand, type FleetDevice, type FleetSnapshot, type FleetTelemetry,
  type FleetThresholds, type TelemetrySample,
} from '../../lib/iiot/fleetManager';
import {
  FLEET_COMMANDS, FLEET_SORTS, STATUS_FILTERS, STATUS_LABELS, TREND_CHANNELS,
  alertCounts, channelLimit, defaultFleetDesign, fleetToCSV, formatAge, formatChannel, groupBySite,
  isBreached, sameView, trendRows, trendSpec, trendStats, visibleDevices,
  type BuiltDevice, type FleetDesign, type FleetView, type StatusFilter, type TrendChannel,
} from '../../lib/iiot/fleetView';
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign';
import { downloadFile } from '../../lib/exportUtils';
import { describeError } from '../../lib/utils';
import { useTheme } from '../../lib/theme/useTheme';
import { chartColor } from '../../lib/theme/tokens';
import TraceChart, { type TraceSeries } from '../charts/TraceChart';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useConfirm } from '../ui/useConfirm';
import { useDemoRequest } from '../workspace/useDemoRequest';
import FleetDeviceDialog from './FleetDeviceDialog';

const FLEET_KEY = 'iiot-fleet';
const VIEW_KEY = 'iiot-fleet-view';

/** A saved snapshot may predate a field; the registry refuses to run on half a record. */
function normalizeSnapshot(saved: Partial<FleetSnapshot>): FleetSnapshot {
  return {
    devices: (saved.devices ?? []).filter((device) => device && typeof device.id === 'string'),
    commands: saved.commands ?? [],
    history: saved.history ?? {},
    thresholds: { ...DEFAULT_THRESHOLDS, ...(saved.thresholds ?? {}) },
  };
}

/**
 * The registry is a singleton, so it is brought up to the project's saved fleet
 * before the first render publishes anything back. An empty saved fleet stays
 * empty — deleting every device is a decision, not a reason to re-seed the demo.
 */
function bootFleet(): FleetDevice[] {
  const saved = loadDomainDesign<FleetSnapshot>(FLEET_KEY);
  if (saved && Array.isArray(saved.devices)) iiotFleetManager.restore(normalizeSnapshot(saved));
  else iiotFleetManager.seedDemoFleet();
  return iiotFleetManager.listDevices();
}

function restoreView(): FleetDesign {
  const base = defaultFleetDesign();
  const saved = loadDomainDesign<FleetDesign>(VIEW_KEY);
  if (!saved) return base;
  return {
    ...base,
    ...saved,
    view: { ...base.view, ...(saved.view ?? {}) },
    views: Array.isArray(saved.views) ? saved.views.filter((entry) => entry && typeof entry.key === 'string') : [],
  };
}

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'pass' | 'fail' | 'warn' }) {
  const colour =
    tone === 'pass' ? 'text-success' : tone === 'fail' ? 'text-destructive' : tone === 'warn' ? 'text-warning' : 'text-foreground';
  return (
    <Card className="app-panel">
      <CardContent className="p-3">
        <div className={`text-2xl font-semibold leading-tight tabular-nums ${colour}`}>{value}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

/** A reading and its limit, coloured by whether the plant would call it a fault. */
function Reading({ channel, value, thresholds }: { channel: TrendChannel; value: number | undefined; thresholds: FleetThresholds }) {
  const channelSpec = trendSpec(channel);
  const limit = channelLimit(channel, thresholds);
  const breached = isBreached(channel, value, thresholds);
  const bound = limit === null ? '' : ` · ${channelSpec.breach === 'above' ? 'limit' : 'reserve'} ${limit} ${channelSpec.unit}`;
  return (
    <span className={`cad-chip ${breached ? 'cad-chip--alert' : ''}`} title={`${channelSpec.label} ${formatChannel(value, channel)}${bound}`}>
      {formatChannel(value, channel)}
    </span>
  );
}

/**
 * A threshold is live: the moment it parses, the fleet is re-judged against it.
 * The text stays a draft so `-`, `0.` and an empty box survive typing instead of
 * being snapped back to the last valid number mid-keystroke.
 */
function NumberField({
  id, label, value, unit, min, max, onCommit,
}: {
  id: string; label: string; value: number; unit: string; min: number; max: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);

  const change = (text: string) => {
    setDraft(text);
    const parsed = Number(text.trim());
    if (text.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max) onCommit(parsed);
  };
  const parsed = Number(draft.trim());
  const invalid = draft.trim() !== '' && (!Number.isFinite(parsed) || parsed < min || parsed > max);

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</label>
      <span className="cad-form-field h-7 w-full">
        <input
          id={id}
          className="cad-form-input"
          inputMode="decimal"
          value={draft}
          onChange={(event) => change(event.target.value)}
        />
        <span className="cad-form-unit">{unit}</span>
      </span>
      {invalid && <p className="mt-1 text-[10px] text-warning">Use a number between {min} and {max}.</p>}
    </div>
  );
}

/**
 * Ingesting is an event, not a slider: a sample is stamped and appended to the
 * trend when the operator commits it, so the history reads as a sequence of
 * reported readings rather than a value being dragged around.
 */
function TelemetryIngest({ device, onIngest }: { device: FleetDevice; onIngest: (telemetry: Partial<FleetTelemetry>) => void }) {
  const [temperature, setTemperature] = useState(String(device.telemetry.temperature));
  const [cpuLoad, setCpuLoad] = useState(String(device.telemetry.cpuLoad));
  const [latencyMs, setLatencyMs] = useState(String(device.telemetry.latencyMs));
  const [battery, setBattery] = useState(device.telemetry.battery === undefined ? '' : String(device.telemetry.battery));

  const parse = (text: string, min: number, max: number): number | null => {
    const value = Number(text.trim());
    return text.trim() !== '' && Number.isFinite(value) && value >= min && value <= max ? value : null;
  };
  const temp = parse(temperature, -60, 250);
  const cpu = parse(cpuLoad, 0, 100);
  const latency = parse(latencyMs, 0, 600000);
  const pack = battery.trim() === '' ? null : parse(battery, 0, 100);
  const packInvalid = battery.trim() !== '' && pack === null;
  const ready = temp !== null && cpu !== null && latency !== null && !packInvalid;

  const field = (id: string, label: string, value: string, unit: string, set: (text: string) => void) => (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</label>
      <span className="cad-form-field h-7 w-full">
        <input id={id} className="cad-form-input" inputMode="decimal" value={value} onChange={(event) => set(event.target.value)} />
        <span className="cad-form-unit">{unit}</span>
      </span>
    </div>
  );

  return (
    <div className="space-y-2 border-t border-border pt-3">
      <h4 className="cad-section-title">Ingest a sample</h4>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        No plant gateway is wired into the browser. This writes the reading the registry holds and appends it to the
        trend, which is what a gateway adapter would do on the same call.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {field(`ingest-temp-${device.id}`, 'Temperature', temperature, '°C', setTemperature)}
        {field(`ingest-cpu-${device.id}`, 'CPU load', cpuLoad, '%', setCpuLoad)}
        {field(`ingest-latency-${device.id}`, 'Loop latency', latencyMs, 'ms', setLatencyMs)}
        {field(`ingest-battery-${device.id}`, 'Battery (blank if none)', battery, '%', setBattery)}
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={!ready}
        title={ready ? 'Append this reading to the device trend and re-judge its status' : 'Every reading must be a number in range'}
        onClick={() => {
          if (temp === null || cpu === null || latency === null) return;
          onIngest({ temperature: temp, cpuLoad: cpu, latencyMs: latency, ...(pack === null ? {} : { battery: pack }) });
        }}
      >
        <Activity className="mr-1.5 h-3.5 w-3.5" /> Ingest sample
      </Button>
    </div>
  );
}

interface UndoBatch {
  devices: FleetDevice[];
  samples: Record<string, TelemetrySample[]>;
  note: string;
}

export default function DigitalTwinFleetPanel() {
  const { theme } = useTheme();
  const { spec, confirm, resolve } = useConfirm();

  const [devices, setDevices] = useState<FleetDevice[]>(bootFleet);
  const [health, setHealth] = useState(() => iiotFleetManager.fleetHealth());
  const [alerts, setAlerts] = useState<FleetAlert[]>(() => iiotFleetManager.fleetAlerts());
  const [commands, setCommands] = useState<FleetCommand[]>(() => iiotFleetManager.getCommands());
  const [thresholds, setThresholds] = useState<FleetThresholds>(() => iiotFleetManager.getThresholds());
  const [twins, setTwins] = useState<DigitalTwin[]>(() => digitalTwinService.getAllDigitalTwins());
  const [design, setDesign] = useState<FleetDesign>(restoreView);
  const [now, setNow] = useState(() => Date.now());

  const [checked, setChecked] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ device?: FleetDevice } | null>(null);
  const [undoBatch, setUndoBatch] = useState<UndoBatch | null>(null);
  const [viewName, setViewName] = useState('');
  const [commandChoice, setCommandChoice] = useState(FLEET_COMMANDS[0].id);
  const [commandNote, setCommandNote] = useState('');

  const [twinStatus, setTwinStatus] = useState('idle');
  const [twinNote, setTwinNote] = useState<string | null>(null);
  const [rectifier, setRectifier] = useState<{ verified: boolean; verdict: string; signals: string[]; cases: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setDevices(iiotFleetManager.listDevices());
    setHealth(iiotFleetManager.fleetHealth());
    setAlerts(iiotFleetManager.fleetAlerts());
    setCommands(iiotFleetManager.getCommands());
    setThresholds(iiotFleetManager.getThresholds());
    setTwins(digitalTwinService.getAllDigitalTwins());
    setNow(Date.now());
  }, []);

  // The registry is the source of truth; the store carries it into saves and VCS.
  const snapshot = useMemo<FleetSnapshot>(() => ({
    devices: devices.map((device) => ({ ...device, telemetry: { ...device.telemetry } })),
    commands: commands.map((entry) => ({ ...entry, payload: { ...entry.payload } })),
    history: Object.fromEntries(devices.map((device) => [device.id, iiotFleetManager.historyOf(device.id)])),
    thresholds,
  }), [devices, commands, thresholds]);

  usePublishDomainDesign(FLEET_KEY, snapshot, (saved) => {
    iiotFleetManager.restore(normalizeSnapshot(saved));
    refresh();
  });
  usePublishDomainDesign(VIEW_KEY, design, (saved) => setDesign({ ...restoreView(), ...saved }));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const counts = useMemo(() => alertCounts(alerts), [alerts]);
  const visible = useMemo(() => visibleDevices(devices, design.view, alerts), [devices, design.view, alerts]);
  const groups = useMemo(() => (design.view.grouped ? groupBySite(visible) : null), [design.view.grouped, visible]);
  const sites = useMemo(() => [...new Set(devices.map((device) => device.site))].sort(), [devices]);
  const selected = devices.find((device) => device.id === design.selectedId) ?? visible[0] ?? null;
  const selectedId = selected?.id;
  const selectedTwin = selected?.twinId ? twins.find((twin) => twin.id === selected.twinId) : undefined;
  const history = useMemo(() => (selectedId ? snapshot.history[selectedId] ?? [] : []), [selectedId, snapshot]);
  const channelSpec = trendSpec(design.channel);
  const trend = useMemo(() => trendRows(history, design.channel), [history, design.channel]);
  const stats = useMemo(() => trendStats(history, design.channel), [history, design.channel]);
  const limit = channelLimit(design.channel, thresholds);
  const selectedAlerts = selected ? alerts.filter((alert) => alert.deviceId === selected.id) : [];
  const selectedCommands = selected ? commands.filter((entry) => entry.deviceId === selected.id).reverse() : [];
  const visibleIds = visible.map((device) => device.id);
  const allChecked = visibleIds.length > 0 && visibleIds.every((id) => checked.includes(id));

  const patchView = (patch: Partial<FleetView>) => setDesign((current) => ({ ...current, view: { ...current.view, ...patch } }));
  const select = (id: string) => setDesign((current) => ({ ...current, selectedId: id }));

  const saveDevice = (built: BuiltDevice, editingId?: string) => {
    if (editingId) {
      iiotFleetManager.updateDevice(editingId, {
        name: built.name, type: built.type, site: built.site, firmware: built.firmware,
      });
      iiotFleetManager.ingestTelemetry(editingId, built.telemetry);
    } else {
      iiotFleetManager.registerDevice(built);
    }
    setEditing(null);
    setUndoBatch(null);
    select(built.id);
    refresh();
  };

  const removeDevices = async (ids: string[]) => {
    const victims = ids.map((id) => iiotFleetManager.getDevice(id)).filter((device): device is FleetDevice => Boolean(device));
    if (victims.length === 0) return;
    const accepted = await confirm({
      title: victims.length === 1 ? `Remove "${victims[0].name}"?` : `Remove ${victims.length} devices?`,
      detail: 'The registry entry and its trend leave the fleet. Commands already issued stay in the log as the audit trail, and Undo puts the devices and their history back.',
      confirmLabel: victims.length === 1 ? 'Remove device' : `Remove ${victims.length} devices`,
      destructive: true,
    });
    if (!accepted) return;
    const samples: Record<string, TelemetrySample[]> = {};
    for (const device of victims) {
      samples[device.id] = iiotFleetManager.historyOf(device.id);
      iiotFleetManager.removeDevice(device.id);
    }
    setUndoBatch({
      devices: victims,
      samples,
      note: `${victims.length} device${victims.length === 1 ? '' : 's'} removed`,
    });
    setChecked((current) => current.filter((id) => !ids.includes(id)));
    setDesign((current) => ({
      ...current,
      selectedId: current.selectedId && ids.includes(current.selectedId) ? null : current.selectedId,
    }));
    refresh();
  };

  const issueBulk = (command: 'maintenance' | 'resume') => {
    for (const id of checked) iiotFleetManager.command(id, command);
    setChecked([]);
    setUndoBatch(null);
    refresh();
  };

  const saveView = () => {
    const name = viewName.trim();
    if (!name) return;
    if (design.views.some((entry) => entry.name.toLowerCase() === name.toLowerCase() || sameView(entry.view, design.view))) return;
    setDesign((current) => ({
      ...current,
      views: [...current.views, { key: `view_${Date.now().toString(36)}`, name, view: { ...current.view } }],
    }));
    setViewName('');
  };

  /**
   * Synchronizing is async, so the status reported here is read from the twin
   * record after the pass finishes — reading it straight after the call would
   * report the pre-sync value as if it were the outcome.
   *
   * These twins carry no sensors, actuators or circuit model, so a pass moves
   * status, health and the sync stamp and nothing else. Saying so is the point:
   * an uninstrumented twin is not evidence that a physical asset was reconciled.
   * The rectifier proof below is the one that solves a real netlist.
   */
  const syncTwins = async () => {
    setBusy('sync');
    setError(null);
    try {
      const registry = iiotFleetManager.listDevices();
      let targets = registry.filter((device) => device.twinId && digitalTwinService.getDigitalTwin(device.twinId));
      if (targets.length === 0) {
        const first = registry[0];
        if (!first) throw new Error('The registry is empty. Register a device before synchronizing a twin.');
        const created = digitalTwinService.createDigitalTwin(first.id, `${first.name} Twin`);
        iiotFleetManager.updateDevice(first.id, { twinId: created.id });
        targets = [{ ...first, twinId: created.id }];
      }
      const notes: string[] = [];
      let lastStatus = 'idle';
      let lastHealth = 0;
      for (const device of targets) {
        const twinId = device.twinId as string;
        await digitalTwinService.syncWithPhysicalDevice(twinId);
        const synced = digitalTwinService.getDigitalTwin(twinId);
        lastStatus = synced?.status ?? 'unknown';
        lastHealth = synced?.healthScore ?? 0;
        notes.push(`Twin ${twinId}: status ${lastStatus}, health ${lastHealth}%.`);
      }
      setTwinStatus(lastStatus);
      setTwinNote(
        `${notes.join(' ')} No sensors, actuators or circuit model are attached to ${targets.length === 1 ? 'this twin' : 'these twins'}, ` +
          'so the pass recorded the sync stamp and health only — no physics ran. The rectifier twin below is the one that solves a real netlist.',
      );
    } catch (cause) {
      setTwinStatus('error');
      setTwinNote(null);
      setError(describeError(cause));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const verifyRectifierTwin = async () => {
    setBusy('rectifier');
    setError(null);
    try {
      const { buildDemoHilTwin } = await import('../../lib/demo/demoHilTwin');
      const demo = await buildDemoHilTwin();
      const verified = demo.verified && demo.driftedFails;
      setRectifier({ verified, verdict: demo.verdict, signals: demo.envelopeSignals, cases: demo.hilTests });
      setTwinStatus(verified ? 'verified' : 'failed');
    } catch (cause) {
      setRectifier(null);
      setTwinStatus('error');
      setError(describeError(cause));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  useDemoRequest('twin-rectifier', () => { void verifyRectifierTwin(); });

  const bindTwin = (device: FleetDevice) => {
    const created = digitalTwinService.createDigitalTwin(device.id, `${device.name} Twin`);
    iiotFleetManager.updateDevice(device.id, { twinId: created.id });
    setUndoBatch(null);
    refresh();
  };

  const unbindTwin = async (device: FleetDevice) => {
    if (!device.twinId) return;
    const accepted = await confirm({
      title: `Delete the twin bound to "${device.name}"?`,
      detail: 'The virtual model and its sync stamp are discarded. The device, its trend and its command log stay in the registry.',
      confirmLabel: 'Delete twin',
      destructive: true,
    });
    if (!accepted) return;
    digitalTwinService.deleteDigitalTwin(device.twinId);
    iiotFleetManager.updateDevice(device.id, { twinId: undefined });
    refresh();
  };

  const syncOne = async (device: FleetDevice) => {
    if (!device.twinId) return;
    setBusy(`sync-${device.id}`);
    setError(null);
    try {
      await digitalTwinService.syncWithPhysicalDevice(device.twinId);
      const synced = digitalTwinService.getDigitalTwin(device.twinId);
      setTwinStatus(synced?.status ?? 'unknown');
      setTwinNote(
        `Twin ${device.twinId}: status ${synced?.status ?? 'unknown'}, health ${synced?.healthScore ?? 0}%. ` +
          'No sensors, actuators or circuit model are attached to this twin, so the pass recorded the sync stamp and health only — no physics ran.',
      );
    } catch (cause) {
      setTwinStatus('error');
      setTwinNote(null);
      setError(describeError(cause));
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const exportJSON = () => {
    downloadFile(
      JSON.stringify({ generatedAt: new Date().toISOString(), health, alerts, ...snapshot }, null, 2),
      'iiot-fleet.json',
      'application/json',
    );
  };

  const exportCSV = () => downloadFile(fleetToCSV(visible, alerts), 'iiot-fleet.csv', 'text/csv');

  const clearCommandLog = async () => {
    const accepted = await confirm({
      title: 'Clear the command log?',
      detail: 'The record of what was issued to which device is discarded. Device states are unchanged. This cannot be undone.',
      confirmLabel: 'Clear log',
      destructive: true,
    });
    if (!accepted) return;
    iiotFleetManager.clearCommands();
    refresh();
  };

  const trendSeries: TraceSeries[] = [
    { key: 'value', color: chartColor(theme, '--chart-1'), label: channelSpec.label, unit: channelSpec.unit },
  ];

  const commandSpec = FLEET_COMMANDS.find((entry) => entry.id === commandChoice) ?? FLEET_COMMANDS[0];
  const duplicateView = design.views.some((entry) => sameView(entry.view, design.view));

  const deviceRow = (device: FleetDevice) => {
    const isSelected = selected?.id === device.id;
    const ownAlerts = counts[device.id] ?? 0;
    const held = device.status === 'maintenance';
    return (
      <li
        key={device.id}
        className={`flex items-start gap-2 rounded-md border px-2 py-2 transition-colors ${
          isSelected ? 'border-primary/50 bg-primary/5' : 'border-transparent hover:border-border hover:bg-muted/30'
        }`}
      >
        <input
          type="checkbox"
          className="mt-1.5 h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]"
          aria-label={`Select ${device.name} for bulk actions`}
          checked={checked.includes(device.id)}
          onChange={(event) => setChecked((current) =>
            event.target.checked ? [...current, device.id] : current.filter((id) => id !== device.id),
          )}
        />
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          aria-current={isSelected}
          aria-label={`Inspect ${device.name}`}
          title={`Open ${device.id} in the detail panel`}
          onClick={() => select(device.id)}
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
              device.status === 'online' ? 'bg-success'
                : device.status === 'degraded' ? 'bg-destructive'
                : device.status === 'maintenance' ? 'bg-warning'
                : 'bg-muted-foreground'
            }`} aria-hidden="true" />
            <span className="truncate text-[13px] font-medium">{device.name}</span>
            <span className="font-mono text-[10px] text-muted-foreground">{device.id}</span>
            <span className="cad-chip">{STATUS_LABELS[device.status]}</span>
            {ownAlerts > 0 && (
              <span className="cad-chip cad-chip--alert">
                <AlertTriangle /> {ownAlerts} alert{ownAlerts === 1 ? '' : 's'}
              </span>
            )}
            {device.twinId && <span className="cad-chip"><Link2 /> twin</span>}
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span>{FLEET_DEVICE_LABELS[device.type]}</span>
            <span aria-hidden="true">·</span>
            <span>{device.site}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">fw {device.firmware}</span>
            <span aria-hidden="true">·</span>
            <span>{formatAge(device.lastSeen, now)}</span>
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1">
            <Reading channel="temperature" value={device.telemetry.temperature} thresholds={thresholds} />
            <Reading channel="cpuLoad" value={device.telemetry.cpuLoad} thresholds={thresholds} />
            <Reading channel="latencyMs" value={device.telemetry.latencyMs} thresholds={thresholds} />
            {device.telemetry.battery !== undefined && (
              <Reading channel="battery" value={device.telemetry.battery} thresholds={thresholds} />
            )}
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-1">
          <HoverHelp title={held ? 'Resume device' : 'Hold device'} description={held ? 'Return this device to service.' : 'Hold this device for maintenance.'}>
            <button
              type="button"
              className="cad-ctl cad-ctl--icon"
              aria-label={`${held ? 'Resume' : 'Hold'} ${device.name}`}
              onClick={() => { iiotFleetManager.command(device.id, held ? 'resume' : 'maintenance'); setUndoBatch(null); refresh(); }}
            >
              {held ? <Play /> : <Pause />}
            </button>
          </HoverHelp>
          <HoverHelp title="Rename, re-site or re-flash this device record" description="Rename, re-site or re-flash this device record">
<Button type="button"
            className="cad-ctl cad-ctl--icon"
            aria-label={`Edit ${device.name}`} onClick={() => setEditing({ device })}
          >
            <Pencil />
          </Button>
</HoverHelp>
          <HoverHelp title="Remove this device from the registry" description="Remove this device from the registry">
<Button type="button"
            className="cad-ctl cad-ctl--icon"
            aria-label={`Remove ${device.name}`} onClick={() => { void removeDevices([device.id]); }}
          >
            <Trash2 />
          </Button>
</HoverHelp>
        </span>
      </li>
    );
  };

  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <Network className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-[-0.01em]">Digital twin &amp; IIoT fleet</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                The asset registry, its trends and the twins bound to it. No plant gateway is wired in — readings are
                ingested here, and a twin sync says plainly when it moved only a stamp.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <HoverHelp title="Download the registry, trends, thresholds, alerts and command log as JSON" description="Download the registry, trends, thresholds, alerts and command log as JSON">
<Button variant="outline" size="sm" onClick={exportJSON} disabled={devices.length === 0}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> Fleet JSON
            </Button>
</HoverHelp>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={visible.length === 0} title={`Download the ${visible.length} device${visible.length === 1 ? '' : 's'} on screen as CSV`}>
              <Download className="mr-1.5 h-3.5 w-3.5" /> CSV
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditing({})} title="Register a new plant asset">
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Add device
            </Button>
            <Button variant="outline" size="sm" onClick={() => { void verifyRectifierTwin(); }} disabled={busy !== null} title="Solve the rectifier netlist, build its tolerance envelope and check that a drifted bench sample is refused">
              <ShieldCheck className="mr-1.5 h-3.5 w-3.5" /> Verify rectifier twin
            </Button>
            <Button size="sm" onClick={() => { void syncTwins(); }} disabled={busy !== null} title="Synchronize every bound twin, binding one to the first device if none is bound yet">
              <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${busy === 'sync' ? 'animate-spin' : ''}`} />
              {busy === 'sync' ? 'Syncing…' : 'Sync twins'}
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Fleet health" value={`${health.score}%`} tone={health.score >= 90 ? 'pass' : health.score >= 60 ? 'warn' : 'fail'} />
          <StatTile label={`Online of ${health.total}`} value={String(health.online)} tone="pass" />
          <StatTile label="Degraded" value={String(health.degraded)} tone={health.degraded > 0 ? 'fail' : undefined} />
          <StatTile label="Offline / on hold" value={String(health.offline + health.maintenance)} />
          <StatTile label="Open alerts" value={String(alerts.length)} tone={alerts.some((alert) => alert.severity === 'critical') ? 'fail' : alerts.length > 0 ? 'warn' : undefined} />
          <StatTile label="Twin status" value={twinStatus} tone={twinStatus === 'verified' || twinStatus === 'online' ? 'pass' : twinStatus === 'error' || twinStatus === 'failed' ? 'fail' : undefined} />
        </div>

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        {twinNote && (
          <Card className="app-panel">
            <CardContent className="p-3">
              <p aria-live="polite" className="text-xs leading-relaxed text-muted-foreground">{twinNote}</p>
            </CardContent>
          </Card>
        )}

        {undoBatch && (
          <div className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <span aria-live="polite">{undoBatch.note}. The trend went with them.</span>
            <HoverHelp title="Put the removed devices and their history back" description="Put the removed devices and their history back">
<Button size="sm"
              variant="outline" onClick={() => {
                for (const device of undoBatch.devices) iiotFleetManager.restoreDevice(device, undoBatch.samples[device.id] ?? []);
                setUndoBatch(null);
                refresh();
              }}
            >
              <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Undo remove
            </Button>
</HoverHelp>
          </div>
        )}

        {alerts.length > 0 && (
          <Card className="app-panel">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-warning" /> Active alerts
                <span className="cad-chip">{alerts.length}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1.5 md:grid-cols-2">
                {alerts.map((alert) => (
                  <li key={`${alert.deviceId}-${alert.channel}`}>
                    <button
                      type="button"
                      className={`flex w-full items-start gap-2 rounded-md border px-2 py-1.5 text-left text-[11px] leading-snug transition-colors ${
                        alert.severity === 'critical'
                          ? 'border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15'
                          : 'border-warning/40 bg-warning/10 text-warning hover:bg-warning/15'
                      }`}
                      title={`Open ${alert.deviceName} in the detail panel`}
                      onClick={() => select(alert.deviceId)}
                    >
                      <span className="cad-chip shrink-0">{alert.severity}</span>
                      <span className="min-w-0">
                        <span className="font-medium">{alert.deviceName}</span> — {alert.message}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card className="app-panel">
          <CardContent className="space-y-3 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="cad-form-field h-7 min-w-[180px] flex-1">
                <Search className="ml-2 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <input
                  className="cad-form-input"
                  aria-label="Search devices by name, id, site or firmware"
                  placeholder="Search name, id, site, firmware…"
                  value={design.view.query}
                  onChange={(event) => patchView({ query: event.target.value })}
                />
                {design.view.query && (
                  <HoverHelp title="Clear the search" description="Clear the search">
<Button type="button"
                    className="cad-ctl cad-ctl--icon mr-0.5 h-5 min-h-5 w-5"
                    aria-label="Clear the device search" onClick={() => patchView({ query: '' })}
                  >
                    <X />
                  </Button>
</HoverHelp>
                )}
              </span>

              <label className="sr-only" htmlFor="fleet-site">Site</label>
              <select id="fleet-site" className="cad-form-select h-7" value={design.view.site} onChange={(event) => patchView({ site: event.target.value })}>
                <option value="all">Every site</option>
                {sites.map((site) => <option key={site} value={site}>{site}</option>)}
              </select>

              <label className="sr-only" htmlFor="fleet-type">Device class</label>
              <select id="fleet-type" className="cad-form-select h-7" value={design.view.type} onChange={(event) => patchView({ type: event.target.value as FleetView['type'] })}>
                <option value="all">Every class</option>
                {FLEET_DEVICE_TYPES.map((type) => <option key={type} value={type}>{FLEET_DEVICE_LABELS[type]}</option>)}
              </select>

              <label className="sr-only" htmlFor="fleet-sort">Sort devices by</label>
              <select id="fleet-sort" className="cad-form-select h-7" value={design.view.sort} onChange={(event) => patchView({ sort: event.target.value as FleetView['sort'] })}>
                {FLEET_SORTS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
              </select>

              <HoverHelp title={design.view.descending ? 'Sort highest first' : 'Sort lowest first'} description={design.view.descending ? 'Highest first — click for lowest first' : 'Lowest first — click for highest first'}>
                <button
                  type="button"
                  className="cad-ctl cad-ctl--icon"
                  aria-label={`Sort ${design.view.descending ? 'ascending' : 'descending'}`}
                  aria-pressed={design.view.descending}
                  onClick={() => patchView({ descending: !design.view.descending })}
              >
                <ArrowDownUp />
                </button>
              </HoverHelp>
              <HoverHelp title="Group the list by site" description="Group the list by site">
<Button type="button"
                className={`cad-ctl ${design.view.grouped ? 'cad-ctl--active' : ''}`}
                aria-pressed={design.view.grouped} onClick={() => patchView({ grouped: !design.view.grouped })}
              >
                <Layers /> Group by site
              </Button>
</HoverHelp>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {STATUS_FILTERS.map((entry) => {
                const count = entry.id === 'all' ? devices.length
                  : entry.id === 'alerts' ? devices.filter((device) => counts[device.id] > 0).length
                  : devices.filter((device) => device.status === entry.id).length;
                return (
                  <button
                    key={entry.id}
                    type="button"
                    className={`cad-ctl ${design.view.status === entry.id ? 'cad-ctl--active' : ''}`}
                    aria-pressed={design.view.status === entry.id}
                    title={`Show ${entry.label.toLowerCase()} devices (${count})`}
                    onClick={() => patchView({ status: entry.id as StatusFilter })}
                  >
                    {entry.label} <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
              <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
                {visible.length} of {devices.length} shown
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
              <span className="text-[11px] font-medium text-muted-foreground">Saved views</span>
              {design.views.length === 0 && <span className="text-[11px] text-muted-foreground">None yet.</span>}
              {design.views.map((entry) => (
                <span key={entry.key} className="flex items-center">
                  <button
                    type="button"
                    className={`cad-ctl rounded-r-none ${sameView(entry.view, design.view) ? 'cad-ctl--active' : ''}`}
                    title={`Apply the "${entry.name}" filter, sort and grouping`}
                    onClick={() => setDesign((current) => ({ ...current, view: { ...entry.view } }))}
                  >
                    {entry.name}
                  </button>
                  <HoverHelp title="Delete this saved view" description="Delete this saved view">
<Button type="button"
                    className="cad-ctl cad-ctl--icon rounded-l-none border-l-0"
                    aria-label={`Delete the saved view ${entry.name}`} onClick={() => setDesign((current) => ({ ...current, views: current.views.filter((other) => other.key !== entry.key) }))}
                  >
                    <X />
                  </Button>
</HoverHelp>
                </span>
              ))}
              <span className="cad-form-field h-7 w-40">
                <input
                  className="cad-form-input"
                  aria-label="Name for the saved view"
                  placeholder="Name this view…"
                  value={viewName}
                  onChange={(event) => setViewName(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); saveView(); } }}
                />
              </span>
              <button
                type="button"
                className="cad-ctl"
                disabled={viewName.trim() === '' || duplicateView}
                title={duplicateView ? 'This exact view is already saved' : 'Save the current filter, sort and grouping under this name'}
                onClick={saveView}
              >
                <Plus /> Save view
              </button>
            </div>

            {checked.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-2 py-1.5">
                <span className="text-[11px] font-medium" aria-live="polite">{checked.length} selected</span>
                <Button size="sm" variant="outline" onClick={() => issueBulk('maintenance')} title="Hold every selected device for maintenance">
                  <Pause className="mr-1.5 h-3.5 w-3.5" /> Hold
                </Button>
                <Button size="sm" variant="outline" onClick={() => issueBulk('resume')} title="Return every selected device to service">
                  <Play className="mr-1.5 h-3.5 w-3.5" /> Resume
                </Button>
                <Button size="sm" variant="destructive" onClick={() => { void removeDevices(checked); }} title="Remove every selected device from the registry">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Remove
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setChecked([])} title="Clear the selection">Clear</Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)]">
          <div className="min-w-0 space-y-4">
            <Card className="app-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Server className="h-4 w-4 text-primary" /> Devices
                  <span className="cad-chip">{visible.length}</span>
                  <label className="ml-auto flex items-center gap-1.5 text-[11px] font-normal text-muted-foreground">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-[hsl(var(--primary))]"
                      checked={allChecked}
                      disabled={visibleIds.length === 0}
                      onChange={(event) => setChecked(event.target.checked ? visibleIds : [])}
                    />
                    Select all shown
                  </label>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {devices.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
                    <Server className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium">The registry is empty</p>
                    <p className="max-w-md text-xs text-muted-foreground">
                      Register the assets this project owns, or load the standing demo fleet to see trends, thresholds and
                      twin binding working against believable records.
                    </p>
                    <span className="mt-1 flex flex-wrap justify-center gap-2">
                      <Button size="sm" onClick={() => setEditing({})} title="Register a new plant asset">
                        <Plus className="mr-1.5 h-3.5 w-3.5" /> Add device
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { iiotFleetManager.seedDemoFleet(); setUndoBatch(null); refresh(); }} title="Seed five demo assets with a deterministic shift of history">
                        Load demo fleet
                      </Button>
                    </span>
                  </div>
                ) : visible.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-8 text-center">
                    <Search className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm font-medium">No devices match this view</p>
                    <p className="text-xs text-muted-foreground">{devices.length} registered, none through the current filter.</p>
                    <Button size="sm" variant="outline" onClick={() => patchView({ query: '', site: 'all', type: 'all', status: 'all' })} title="Clear the search and every filter">
                      Clear filters
                    </Button>
                  </div>
                ) : groups ? (
                  <div className="space-y-3">
                    {groups.map((group) => (
                      <section key={group.site}>
                        <h3 className="cad-section-title mb-1 flex items-center gap-2">
                          {group.site} <span className="cad-chip">{group.devices.length}</span>
                        </h3>
                        <ul className="space-y-0.5">{group.devices.map(deviceRow)}</ul>
                      </section>
                    ))}
                  </div>
                ) : (
                  <ul className="space-y-0.5">{visible.map(deviceRow)}</ul>
                )}
              </CardContent>
            </Card>

            <Card className="app-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                  <Activity className="h-4 w-4 text-primary" /> Command log
                  <span className="cad-chip">{commands.length}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto"
                    disabled={commands.length === 0}
                    onClick={() => { void clearCommandLog(); }}
                    title="Discard the audit trail of issued commands"
                  >
                    Clear log
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {commands.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nothing issued yet. Holds, resumes and requests are logged here with the device they went to.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {[...commands].reverse().slice(0, 40).map((entry) => {
                      const device = devices.find((candidate) => candidate.id === entry.deviceId);
                      const label = FLEET_COMMANDS.find((command) => command.id === entry.command)?.label ?? entry.command;
                      return (
                        <li key={entry.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border/50 py-1 text-[11px] last:border-b-0">
                          <span className="font-mono tabular-nums text-muted-foreground">{new Date(entry.issuedAt).toLocaleTimeString()}</span>
                          <button
                            type="button"
                            className="font-medium underline-offset-2 hover:underline disabled:no-underline disabled:opacity-60"
                            disabled={!device}
                            title={device ? `Open ${device.name}` : 'This device is no longer in the registry'}
                            onClick={() => { if (device) select(device.id); }}
                          >
                            {device?.name ?? entry.deviceId}
                          </button>
                          <span className="text-muted-foreground">{label}</span>
                          {typeof entry.payload.note === 'string' && entry.payload.note !== '' && (
                            <span className="truncate text-muted-foreground">“{entry.payload.note}”</span>
                          )}
                          <span className={`cad-chip ml-auto ${entry.status === 'failed' ? 'cad-chip--alert' : ''}`}>{entry.status}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {commands.length > 40 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">Showing the latest 40 of {commands.length}. The JSON export carries all of them.</p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="min-w-0 space-y-4">
            <Card className="app-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="h-4 w-4 text-primary" /> Device detail
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!selected ? (
                  <p className="text-xs text-muted-foreground">Select a device to read its trend, ingest a sample and bind a twin.</p>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{selected.name}</h3>
                      <Badge variant={selected.status === 'degraded' ? 'destructive' : selected.status === 'online' ? 'default' : 'secondary'}>
                        {STATUS_LABELS[selected.status]}
                      </Badge>
                    </div>

                    <div className="rounded-md border border-border">
                      <div className="cad-prop-row"><span className="cad-prop-label">Id</span><span className="cad-prop-value font-mono">{selected.id}</span></div>
                      <div className="cad-prop-row"><span className="cad-prop-label">Class</span><span className="cad-prop-value">{FLEET_DEVICE_LABELS[selected.type]}</span></div>
                      <div className="cad-prop-row"><span className="cad-prop-label">Site</span><span className="cad-prop-value">{selected.site}</span></div>
                      <div className="cad-prop-row"><span className="cad-prop-label">Firmware</span><span className="cad-prop-value font-mono">{selected.firmware}</span></div>
                      <div className="cad-prop-row"><span className="cad-prop-label">Last seen</span><span className="cad-prop-value">{formatAge(selected.lastSeen, now)} · {new Date(selected.lastSeen).toLocaleTimeString()}</span></div>
                      <div className="cad-prop-row border-b-0"><span className="cad-prop-label">Samples</span><span className="cad-prop-value">{history.length} / {HISTORY_LIMIT}</span></div>
                    </div>

                    {selectedAlerts.length > 0 && (
                      <ul className="space-y-1">
                        {selectedAlerts.map((alert) => (
                          <li key={alert.channel} className={`flex items-start gap-2 rounded-md border px-2 py-1.5 text-[11px] leading-snug ${
                            alert.severity === 'critical' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-warning/40 bg-warning/10 text-warning'
                          }`}>
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                            <span>{alert.message}</span>
                          </li>
                        ))}
                      </ul>
                    )}

                    <div>
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-[11px] font-medium text-muted-foreground">Trend channel</span>
                        {TREND_CHANNELS.map((channel) => (
                          <button
                            key={channel.id}
                            type="button"
                            className={`cad-ctl ${design.channel === channel.id ? 'cad-ctl--active' : ''}`}
                            aria-pressed={design.channel === channel.id}
                            title={`Plot ${channel.label.toLowerCase()} against time`}
                            onClick={() => setDesign((current) => ({ ...current, channel: channel.id }))}
                          >
                            {channel.id === 'temperature' ? <Thermometer /> : channel.id === 'cpuLoad' ? <Cpu /> : channel.id === 'battery' ? <Battery /> : <Activity />}
                            {channel.label}
                          </button>
                        ))}
                      </div>
                      {stats.count === 0 ? (
                        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                          This device reports no {channelSpec.label.toLowerCase()} samples yet.
                        </p>
                      ) : (
                        <>
                          <TraceChart
                            data={trend}
                            series={trendSeries}
                            xKey="at"
                            xLabel="Time"
                            xFormatter={(value) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            yFormatter={(value) => value.toFixed(channelSpec.decimals)}
                            readoutFormatter={(value) => `${value.toFixed(channelSpec.decimals)} ${channelSpec.unit}`}
                            referencesY={limit === null ? [] : [{ value: limit, label: channelSpec.breach === 'above' ? 'Limit' : 'Reserve' }]}
                            curve="linear"
                            height={170}
                            ariaLabel={`${selected.name} ${channelSpec.label} history, ${stats.count} samples`}
                          />
                          <div className="mt-2 grid grid-cols-4 gap-1.5">
                            {([['Min', stats.min], ['Mean', stats.mean], ['Max', stats.max], ['Latest', stats.last]] as const).map(([label, value]) => (
                              <div key={label} className="rounded-md border border-border bg-muted/30 px-2 py-1">
                                <div className="text-[10px] text-muted-foreground">{label}</div>
                                <div className="cad-readout text-[11px]">{formatChannel(value, design.channel)}</div>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>

                    <TelemetryIngest
                      key={selected.id}
                      device={selected}
                      onIngest={(telemetry) => { iiotFleetManager.ingestTelemetry(selected.id, telemetry); setUndoBatch(null); refresh(); }}
                    />

                    <div className="space-y-2 border-t border-border pt-3">
                      <h4 className="cad-section-title flex items-center gap-2"><Link2 className="h-3 w-3" /> Digital twin</h4>
                      {selected.twinId && selectedTwin ? (
                        <>
                          <div className="rounded-md border border-border">
                            <div className="cad-prop-row"><span className="cad-prop-label">Twin</span><span className="cad-prop-value font-mono">{selectedTwin.id}</span></div>
                            <div className="cad-prop-row"><span className="cad-prop-label">Status</span><span className="cad-prop-value">{selectedTwin.status}</span></div>
                            <div className="cad-prop-row"><span className="cad-prop-label">Health</span><span className="cad-prop-value">{selectedTwin.healthScore}%</span></div>
                            <div className="cad-prop-row border-b-0"><span className="cad-prop-label">Last sync</span><span className="cad-prop-value">{selectedTwin.lastSync ? formatAge(selectedTwin.lastSync, now) : 'never'}</span></div>
                          </div>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            {selectedTwin.sensors.length} sensors, {selectedTwin.actuators.length} actuators,{' '}
                            {selectedTwin.virtualModel.components.length} model components. A pass with nothing attached moves the
                            stamp and health only — it is not a reconciliation against the plant.
                          </p>
                          <span className="flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { void syncOne(selected); }} title="Synchronize this twin now">
                              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Sync this twin
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => { void unbindTwin(selected); }} title="Delete the twin and unbind it from this device">
                              <Link2Off className="mr-1.5 h-3.5 w-3.5" /> Delete twin
                            </Button>
                          </span>
                        </>
                      ) : selected.twinId ? (
                        <>
                          <p className="text-[11px] leading-relaxed text-warning">
                            Bound to <span className="font-mono">{selected.twinId}</span>, which is not in this session — twins are
                            not saved with the project. Recreate it to bind a fresh model.
                          </p>
                          <Button size="sm" variant="outline" onClick={() => bindTwin(selected)} title="Create a twin for this device and bind it">
                            <Link2 className="mr-1.5 h-3.5 w-3.5" /> Recreate twin
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-[11px] leading-relaxed text-muted-foreground">
                            No twin is bound. Creating one registers a virtual model against this asset id; attach sensors,
                            actuators or a circuit model before a sync means anything.
                          </p>
                          <Button size="sm" variant="outline" onClick={() => bindTwin(selected)} title="Create a twin for this device and bind it">
                            <Link2 className="mr-1.5 h-3.5 w-3.5" /> Create twin
                          </Button>
                        </>
                      )}
                    </div>

                    <div className="space-y-2 border-t border-border pt-3">
                      <h4 className="cad-section-title">Issue a command</h4>
                      <label className="sr-only" htmlFor="fleet-command">Command</label>
                      <select id="fleet-command" className="cad-form-select h-7 w-full max-w-none" value={commandChoice} onChange={(event) => setCommandChoice(event.target.value)}>
                        {FLEET_COMMANDS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                      </select>
                      <p className="text-[11px] leading-relaxed text-muted-foreground">{commandSpec.detail}</p>
                      <span className="cad-form-field h-7 w-full">
                        <input
                          className="cad-form-input"
                          aria-label="Command note"
                          placeholder="Note for the log (optional)"
                          value={commandNote}
                          onChange={(event) => setCommandNote(event.target.value)}
                        />
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        title={`Log this command against ${selected.name}`}
                        onClick={() => {
                          iiotFleetManager.command(selected.id, commandChoice, commandNote.trim() ? { note: commandNote.trim() } : {});
                          setCommandNote('');
                          setUndoBatch(null);
                          refresh();
                        }}
                      >
                        <Zap className="mr-1.5 h-3.5 w-3.5" /> Issue to {selected.id}
                      </Button>
                      {selectedCommands.length > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          {selectedCommands.length} command{selectedCommands.length === 1 ? '' : 's'} issued to this device · latest{' '}
                          {FLEET_COMMANDS.find((entry) => entry.id === selectedCommands[0].command)?.label ?? selectedCommands[0].command}
                        </p>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            <Card className="app-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Gauge className="h-4 w-4 text-primary" /> Fleet thresholds
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Applied the moment they parse. Lowering a limit re-judges every device already over it — the fleet degrades
                  now, not on the next sample. Temperature and CPU are faults; latency and battery are warnings.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <NumberField id="fleet-limit-temp" label="Temperature" unit="°C" min={-40} max={250} value={thresholds.temperatureC}
                    onCommit={(value) => { iiotFleetManager.setThresholds({ temperatureC: value }); refresh(); }} />
                  <NumberField id="fleet-limit-cpu" label="CPU load" unit="%" min={1} max={100} value={thresholds.cpuLoadPct}
                    onCommit={(value) => { iiotFleetManager.setThresholds({ cpuLoadPct: value }); refresh(); }} />
                  <NumberField id="fleet-limit-latency" label="Loop latency" unit="ms" min={1} max={600000} value={thresholds.latencyMs}
                    onCommit={(value) => { iiotFleetManager.setThresholds({ latencyMs: value }); refresh(); }} />
                  <NumberField id="fleet-limit-battery" label="Battery reserve" unit="%" min={0} max={100} value={thresholds.batteryPct}
                    onCommit={(value) => { iiotFleetManager.setThresholds({ batteryPct: value }); refresh(); }} />
                </div>
                <Button size="sm" variant="ghost" onClick={() => { iiotFleetManager.setThresholds(DEFAULT_THRESHOLDS); refresh(); }} title="Restore the default limits and re-judge the fleet">
                  <Undo2 className="mr-1.5 h-3.5 w-3.5" /> Reset to defaults
                </Button>
              </CardContent>
            </Card>

            <Card className="app-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Solver-backed twin proof
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {rectifier ? (
                  <>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant={rectifier.verified ? 'default' : 'destructive'}>{rectifier.verified ? 'verified' : 'not verified'}</Badge>
                      <span className="cad-chip">{rectifier.cases} HIL cases</span>
                      <span className="cad-chip">{rectifier.signals.length} envelope signals</span>
                    </span>
                    <p className="text-xs leading-relaxed text-muted-foreground">{rectifier.verdict}</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      Monte Carlo over the real rectifier netlist: {rectifier.signals.join(', ')}. A bench sample at the band
                      centre correlates; the same sample drifted by +2 V is refused. This is the twin that solves physics —
                      the fleet twins above are uninstrumented records.
                    </p>
                  </>
                ) : (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    Run <span className="font-medium text-foreground">Verify rectifier twin</span> to build a tolerance envelope
                    over the rectifier netlist and check that a drifted bench sample is refused. Unlike a fleet sync, this
                    pass solves the circuit.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {editing && (
        <FleetDeviceDialog
          device={editing.device}
          existingIds={devices.map((device) => device.id)}
          sites={sites}
          nextIndex={devices.length + 1}
          onSave={saveDevice}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog spec={spec} onResolve={resolve} />
    </div>
  );
}
