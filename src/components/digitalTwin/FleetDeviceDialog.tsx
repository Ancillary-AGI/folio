import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Server } from 'lucide-react';
import {
  FLEET_DEVICE_LABELS,
  FLEET_DEVICE_TYPES,
  type FleetDevice,
} from '../../lib/iiot/fleetManager';
import {
  buildDevice,
  draftFromDevice,
  emptyDeviceDraft,
  type BuiltDevice,
  type DeviceDraft,
} from '../../lib/iiot/fleetView';
import { Button } from '../ui/button';
import DialogShell from '../ui/DialogShell';

interface FleetDeviceDialogProps {
  /** The record being edited, or undefined to register a new asset. */
  device?: FleetDevice;
  existingIds: readonly string[];
  sites: readonly string[];
  /** How many devices exist, so a new id does not start at `device-0` every time. */
  nextIndex: number;
  onSave: (device: BuiltDevice, editingId?: string) => void;
  onClose: () => void;
}

/**
 * Registering or renaming a plant asset.
 *
 * The id is immutable once it exists: history, the command log and the twin
 * binding are all keyed by it, so renaming the key would orphan them. Everything
 * else — including the first reading a device reports — is editable here, and the
 * problems list says exactly which field is not yet something the plant could
 * have reported.
 */
export default function FleetDeviceDialog({
  device,
  existingIds,
  sites,
  nextIndex,
  onSave,
  onClose,
}: FleetDeviceDialogProps) {
  const editing = device !== undefined;
  const [draft, setDraft] = useState<DeviceDraft>(() =>
    device ? draftFromDevice(device) : emptyDeviceDraft(nextIndex),
  );
  const nameRef = useRef<HTMLInputElement>(null);

  const built = useMemo(
    () => buildDevice(draft, existingIds, device?.id),
    [draft, existingIds, device?.id],
  );

  const set = <K extends keyof DeviceDraft>(key: K, value: DeviceDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const submit = () => {
    if (!built.device) return;
    onSave(built.device, device?.id);
  };

  const field = (
    id: string,
    label: string,
    key: keyof DeviceDraft,
    props: { unit?: string; placeholder?: string; hint?: string; inputMode?: 'decimal' | 'text' } = {},
  ) => (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      <span className="cad-form-field h-8">
        <input
          id={id}
          ref={key === 'name' ? nameRef : undefined}
          className="cad-form-input"
          inputMode={props.inputMode ?? 'text'}
          placeholder={props.placeholder}
          value={draft[key]}
          disabled={key === 'id' && editing}
          onChange={(event) => set(key, event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        {props.unit && <span className="cad-form-unit">{props.unit}</span>}
      </span>
      {props.hint && <p className="mt-1 text-[10px] leading-snug text-muted-foreground">{props.hint}</p>}
    </div>
  );

  return (
    <DialogShell
      onClose={onClose}
      labelledBy="fleet-device-title"
      describedBy="fleet-device-detail"
      initialFocus={nameRef}
      className="max-w-2xl"
    >
      <div className="app-panel-header flex-shrink-0">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary" aria-hidden="true">
          <Server className="h-4 w-4" />
        </span>
        <h2 id="fleet-device-title" className="min-w-0 flex-1 text-sm font-semibold">
          {editing ? `Edit ${device.name}` : 'Register a device'}
        </h2>
      </div>

      <div className="space-y-4 px-4 py-4">
        <p id="fleet-device-detail" className="text-[12px] leading-relaxed text-muted-foreground">
          {editing
            ? 'Identity, site and firmware are editable. The id stays as it is — the trend, the command log and any bound twin are keyed by it.'
            : 'The registry is local to this project. The reading below is the first sample the device reports; every later sample is ingested from the detail panel.'}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          {field('fleet-device-id', 'Device id', 'id', {
            placeholder: 'arm-02',
            hint: editing ? 'The key cannot be changed.' : 'Letters, digits, dot, dash, underscore.',
          })}
          {field('fleet-device-name', 'Name', 'name', { placeholder: 'Assembly Arm 02' })}

          <div className="min-w-0">
            <label htmlFor="fleet-device-type" className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Device class
            </label>
            <select
              id="fleet-device-type"
              className="cad-form-select h-8 w-full"
              value={draft.type}
              onChange={(event) => set('type', event.target.value as DeviceDraft['type'])}
            >
              {FLEET_DEVICE_TYPES.map((type) => (
                <option key={type} value={type}>{FLEET_DEVICE_LABELS[type]}</option>
              ))}
            </select>
          </div>

          <div className="min-w-0">
            <label htmlFor="fleet-device-site" className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Site
            </label>
            <input
              id="fleet-device-site"
              className="cad-field h-8 w-full"
              list="fleet-device-sites"
              placeholder="line-a"
              value={draft.site}
              onChange={(event) => set('site', event.target.value)}
            />
            <datalist id="fleet-device-sites">
              {sites.map((site) => <option key={site} value={site} />)}
            </datalist>
          </div>

          {field('fleet-device-firmware', 'Firmware', 'firmware', { placeholder: '2.4.1' })}
          {field('fleet-device-battery', 'Battery (blank if mains powered)', 'battery', {
            unit: '%', placeholder: '88', inputMode: 'decimal',
          })}
        </div>

        <div>
          <h3 className="cad-section-title mb-2">First reported sample</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {field('fleet-device-temperature', 'Temperature', 'temperature', { unit: '°C', placeholder: '41', inputMode: 'decimal' })}
            {field('fleet-device-cpu', 'CPU load', 'cpuLoad', { unit: '%', placeholder: '22', inputMode: 'decimal' })}
            {field('fleet-device-latency', 'Loop latency', 'latencyMs', { unit: 'ms', placeholder: '12', inputMode: 'decimal' })}
          </div>
        </div>

        {built.problems.length > 0 && (
          <ul className="space-y-1 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
            {built.problems.map((problem) => (
              <li key={problem} className="flex items-start gap-2 text-[11px] leading-snug text-warning">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                <span>{problem}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="cad-footer-row justify-end">
        <div className="cad-action-pair">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={submit}
            disabled={!built.device}
            title={built.device ? 'Save this device to the registry' : 'Fix the fields above before saving'}
          >
            {editing ? 'Save device' : 'Register device'}
          </Button>
        </div>
      </div>
    </DialogShell>
  );
}