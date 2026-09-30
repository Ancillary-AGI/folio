import { useEffect, useState } from 'react';
import { digitalTwinService } from '../../lib/digitalTwin/digitalTwinService';
import { iiotFleetManager } from '../../lib/iiot/fleetManager';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

export default function DigitalTwinFleetPanel() {
  const [health, setHealth] = useState(iiotFleetManager.fleetHealth());
  const [devices, setDevices] = useState(iiotFleetManager.listDevices());
  const [twinStatus, setTwinStatus] = useState('idle');

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

  const syncTwin = () => {
    const twin = digitalTwinService.createDigitalTwin('arm-01', 'Assembly Arm Twin');
    digitalTwinService.syncWithPhysicalDevice?.(twin.id ?? 'arm-01');
    setTwinStatus(twin.status);
    iiotFleetManager.ingestTelemetry('arm-01', { temperature: 44, cpuLoad: 30, latencyMs: 9 });
    refresh();
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-xl font-semibold">Digital twin & IIoT fleet</h2>
          <p className="text-sm text-muted-foreground">Live sync between simulated robots and plant devices.</p>
        </div>
        <Button onClick={syncTwin}>Sync twins</Button>
      </div>
      <div className="grid grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{health.score}%</div><div className="text-xs text-muted-foreground">Fleet health</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{health.online}</div><div className="text-xs text-muted-foreground">Online</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{health.degraded}</div><div className="text-xs text-muted-foreground">Degraded</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-2xl font-bold">{twinStatus}</div><div className="text-xs text-muted-foreground">Twin status</div></CardContent></Card>
      </div>
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
