import { useMemo, useState } from 'react';
import { FPGA_DEVICES, fpgaDesignFlow } from '../../lib/fpga/fpgaDesignFlow';
import { buildDemoHdl, DEMO_VERILOG, DEMO_VHDL } from '../../lib/demo/demoHdl';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

export default function FPGADesignPanel() {
  const [deviceId, setDeviceId] = useState(FPGA_DEVICES[0].id);
  const [source, setSource] = useState(DEMO_VERILOG);
  const [language, setLanguage] = useState<'verilog' | 'vhdl'>('verilog');
  const [log, setLog] = useState(() => {
    try {
      return buildDemoHdl(FPGA_DEVICES[0].id).verdict;
    } catch {
      return 'Ready.';
    }
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

  const program = () => {
    const bitstream = fpgaDesignFlow.generateBitstream(result);
    if (!bitstream) {
      setLog(result.errors.join('\n') || 'Synthesis failed');
      return;
    }
    const programmed = fpgaDesignFlow.program(bitstream);
    setLog(programmed.message);
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <h2 className="text-xl font-semibold">FPGA Design Flow</h2>
      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>HDL</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <select className="w-full border rounded-md p-2 bg-background" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              {FPGA_DEVICES.map((d) => (
                <option key={d.id} value={d.id}>{d.vendor} {d.part}</option>
              ))}
            </select>
            <textarea className="w-full h-56 font-mono text-xs border rounded-md p-2 bg-background" value={source} onChange={(e) => setSource(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => loadDemo('verilog')}>Load Verilog demo</Button>
              <Button variant="outline" onClick={() => loadDemo('vhdl')}>Load VHDL demo</Button>
            </div>
            <Button onClick={program} disabled={!result.success}>Generate bitstream & program</Button>
            <p className="text-sm text-muted-foreground">{log}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Synthesis</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex gap-2">
              <Badge>{result.success ? 'pass' : 'fail'}</Badge>
              <span>Fmax {result.timing.fmaxMhz.toFixed(1)} MHz</span>
            </div>
            <p>LUTs {result.utilization.luts} ({result.utilization.lutPercent.toFixed(1)}%)</p>
            <p>FFs {result.utilization.flipFlops} · BRAM {result.utilization.bramKb} kb · DSP {result.utilization.dsp}</p>
            {result.warnings.map((w) => <p key={w} className="text-warning">{w}</p>)}
            {result.errors.map((w) => <p key={w} className="text-destructive">{w}</p>)}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
