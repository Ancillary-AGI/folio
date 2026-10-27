import { useEffect, useState } from 'react';
import { digitalTwinService } from '../../lib/digitalTwin/digitalTwinService';
import { iiotFleetManager } from '../../lib/iiot/fleetManager';
import { describeError } from '../../lib/utils';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { useDemoRequest } from '../workspace/useDemoRequest';

export default function DigitalTwinFleetPanel() {
  const [health, setHealth] = useState(iiotFleetManager.fleetHealth());
  const [devices, setDevices] = useState(iiotFleetManager.listDevices());
  const [twinStatus, setTwinStatus] = useState('idle');
  const [rectifier, setRectifier] = useState<{ verified: boolean; verdict: string } | null>(null);
  const [twinNote, setTwinNote] = useState<string | null>(null);
  const [twinError, setTwinError] = useState<string | null>(null);

  useEffect(() => {
    if (iiotFleetManager.listDevices().length === 0) {
      iiotFleetManager.registerDevice({
        id: 'arm-01',
        name: 'Assembly Arm 01',
        type: 'robot',
        site: 'line-a',
        firmware: '2.4.1',
        telemetry: { battery: 88, temperature: 41, cpuLoad: 22, latencyMs: 12 },
      });
      iiotFleetManager.registerDevice({
        id: 'agv-07',
        name: 'AGV 07',
        type: 'vehicle',
        site: 'line-a',
        firmware: '1.9.0',
        telemetry: { battery: 54, temperature: 36, cpuLoad: 18, latencyMs: 20 },
      });
    }
    refresh();
  }, []);

  const refresh = () => {
    setDevices(iiotFleetManager.listDevices());
    setHealth(iiotFleetManager.fleetHealth());
  };

  /**
   * Synchronizing is async, so the status shown here has to come from the twin
   * record after the pass finishes — reading `twin.status` straight after the
   * call reports the pre-sync 'offline' value as if it were the outcome.
   *
   * This twin carries no sensors, actuators or circuit model, so a sync only
   * moves status, health and the sync stamp. Saying that is the point: a twin
   * with nothing attached is not evidence the asset was reconciled.
   */
  const syncTwin = async () => {
    setTwinError(null);
    const twin = digitalTwinService.createDigitalTwin('arm-01', 'Assembly Arm Twin');
    try {
      await digitalTwinService.syncWithPhysicalDevice(twin.id);
      const synced = digitalTwinService.getDigitalTwin(twin.id);
      setTwinStatus(synced?.status ?? 'error');
      iiotFleetManager.ingestTelemetry('arm-01', { temperature: 44, cpuLoad: 30, latencyMs: 9 });
      setTwinNote(
        `Twin ${twin.id}: status ${synced?.status ?? 'unknown'}, health ${synced?.healthScore ?? 0}%. ` +
          'No sensors, actuators or circuit model are attached to this twin, so the pass recorded the sync stamp and health only — no physics ran. ' +
          'The rectifier twin below is the one that solves a real netlist.',
      );
    } catch (error) {
      setTwinStatus('error');
      setTwinNote(null);
      setTwinError(describeError(error));
    }
    refresh();
  };

  const verifyRectifierTwin = async () => {
    setTwinError(null);
    try {
      const { buildDemoHilTwin } = await import('../../lib/demo/demoHilTwin');
      const demo = await buildDemoHilTwin();
      setRectifier({ verified: demo.verified, verdict: demo.verdict });
      setTwinStatus(demo.verified ? 'verified' : 'failed');
    } catch (error) {
      setRectifier(null);
      setTwinStatus('error');
      setTwinError(describeError(error));
    }
    refresh();
  };

  useDemoRequest('twin-rectifier', () => { void verifyRectifierTwin(); });

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Digital twin & IIoT fleet</h2>
          <p className="text-sm text-muted-foreground">
            Device registry with on-demand twin synchronization. No plant gateway is wired in; the twin models are the ones built here.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => { void syncTwin(); }}>Sync twins</Button>
          <Button variant="outline" onClick={() => { void verifyRectifierTwin(); }}>Verify rectifier twin</Button>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{health.score}%</div><div className="text-xs text-muted-foreground">Fleet health</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{health.online}</div><div className="text-xs text-muted-foreground">Online</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{health.degraded}</div><div className="text-xs text-muted-foreground">Degraded</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{twinStatus}</div><div className="text-xs text-muted-foreground">Twin status</div></CardContent></Card>
      </div>
      {twinError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Twin pass failed: {twinError}
        </p>
      )}
      {twinNote && (
        <Card>
          <CardContent className="p-4 text-sm">
            <p aria-live="polite" className="text-muted-foreground">{twinNote}</p>
          </CardContent>
        </Card>
      )}
      {rectifier && (
        <Card>
          <CardContent className="p-4 text-sm">
            <Badge variant={rectifier.verified ? 'default' : 'destructive'}>
              {rectifier.verified ? 'verified' : 'not verified'}
            </Badge>
            <p className="mt-2 text-muted-foreground">{rectifier.verdict}</p>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader><CardTitle>Devices</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {devices.map((d) => (
            <div key={d.id} className="flex items-center justify-between text-sm border-b border-border py-2">
              <div>
                <div className="font-medium">{d.name}</div>
                <div className="text-muted-foreground">{d.type} · {d.firmware} · {d.telemetry.temperature}°C</div>
              </div>
              <div className="flex gap-2">
                <Badge>{d.status}</Badge>
                <Button size="sm" variant="outline" onClick={() => { iiotFleetManager.command(d.id, 'maintenance'); refresh(); }}>Hold</Button>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
