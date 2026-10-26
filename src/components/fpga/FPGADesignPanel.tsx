import { useMemo, useState } from 'react';
import { FPGA_DEVICES, fpgaDesignFlow } from '../../lib/fpga/fpgaDesignFlow';
import { buildDemoHdl, DEMO_VERILOG, DEMO_VHDL } from '../../lib/demo/demoHdl';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { useDemoRequest } from '../workspace/useDemoRequest';
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign';

type FpgaLanguage = 'verilog' | 'vhdl';

interface FpgaDesign {
  deviceId: string;
  source: string;
  language: FpgaLanguage;
}

export default function FPGADesignPanel() {
  const saved = loadDomainDesign<FpgaDesign>('fpga');
  const [deviceId, setDeviceId] = useState(
    saved?.deviceId && FPGA_DEVICES.some((device) => device.id === saved.deviceId)
      ? saved.deviceId
      : FPGA_DEVICES[0].id,
  );
  const [source, setSource] = useState(typeof saved?.source === 'string' ? saved.source : DEMO_VERILOG);
  const [language, setLanguage] = useState<FpgaLanguage>(
    saved?.language === 'verilog' || saved?.language === 'vhdl' ? saved.language : 'verilog',
  );
  const [log, setLog] = useState(() => {
    try {
      return buildDemoHdl(FPGA_DEVICES[0].id).verdict;
    } catch {
      return 'Ready.';
    }
  });

  usePublishDomainDesign('fpga', { deviceId, source, language }, (next) => {
    if (next.deviceId && FPGA_DEVICES.some((device) => device.id === next.deviceId)) setDeviceId(next.deviceId);
    if (typeof next.source === 'string') setSource(next.source);
    if (next.language === 'verilog' || next.language === 'vhdl') setLanguage(next.language);
  });


  const result = useMemo(
    () => fpgaDesignFlow.synthesize([{ name: 'half_adder', language, source }], deviceId),
    [source, deviceId, language],
  );

  const loadDemo = (lang: 'verilog' | 'vhdl') => {
    setLanguage(lang);
    setSource(lang === 'verilog' ? DEMO_VERILOG : DEMO_VHDL);
    setLog(buildDemoHdl(deviceId).verdict);
  };

  useDemoRequest('fpga-verilog', () => loadDemo('verilog'));
  useDemoRequest('fpga-vhdl', () => loadDemo('vhdl'));

  const generateManifest = () => {
    const manifest = fpgaDesignFlow.generateManifest(result);
    if (!manifest) {
      setLog(result.errors.join('\n') || 'Elaboration failed');
      return;
    }
    const retained = fpgaDesignFlow.retainManifest(manifest);
    const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${deviceId}-design-manifest.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setLog(retained.message);
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <h2 className="text-xl font-semibold">FPGA Design Flow</h2>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>HDL</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label htmlFor="fpga-device" className="text-xs font-medium text-muted-foreground">Target device</label>
            <select id="fpga-device" className="w-full border rounded-md p-2 bg-background" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {FPGA_DEVICES.map((d) => (
                <option key={d.id} value={d.id}>{d.vendor} {d.part}</option>
              ))}
            </select>
            <label htmlFor="fpga-source" className="text-xs font-medium text-muted-foreground">HDL source</label>
            <textarea id="fpga-source" className="w-full h-56 font-mono text-xs border rounded-md p-2 bg-background" value={source} onChange={(e) => setSource(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => loadDemo('verilog')}>Load Verilog demo</Button>
              <Button variant="outline" onClick={() => loadDemo('vhdl')}>Load VHDL demo</Button>
            </div>
            <Button onClick={generateManifest} disabled={!result.success}>Generate design manifest (JSON)</Button>
            <p className="text-xs text-muted-foreground">
              Structural elaboration and resource estimates only. Vendor place-and-route,
              timing analysis, bitstream assembly and device programming are not bundled.
            </p>
            <p className="text-sm text-muted-foreground">{log}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Elaboration &amp; resource estimate</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex gap-2">
              <Badge>{result.success ? 'elaborated' : 'fail'}</Badge>
              <span>Timing: not modelled (vendor place-and-route required)</span>
            </div>
            <p>Gates {result.utilization.gates} → LUT estimate {result.utilization.luts} ({result.utilization.lutPercent.toFixed(1)}%)</p>
            <p>Flip-flops {result.utilization.flipFlops} · BRAM not inferred · DSP not inferred</p>
            {result.warnings.map((w) => <p key={w} className="text-warning">{w}</p>)}
            {result.errors.map((w) => <p key={w} className="text-destructive">{w}</p>)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
