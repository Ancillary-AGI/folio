import { useState } from 'react';
import { ArduinoIDEIntegration, type HILTestSession, type HILTestSummary } from '../../lib/programming/boardProgrammer';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';

export default function HILTestingPanel() {
  const [session, setSession] = useState<HILTestSession | null>(null);
  const [summary, setSummary] = useState<HILTestSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async () => {
    setBusy(true);
    setError('');
    try {
      const setup = await ArduinoIDEIntegration.setupHILTest({
        hardwareInterfaces: { digital: true, analog: true, uart: true },
        testCases: [
          {
            id: 'led-high',
            name: 'LED drive',
            inputs: { digital: { D13: true } },
            expectedOutputs: { digital: { D13: true } },
            settlingTime: 20,
          },
          {
            id: 'adc-rail',
            name: 'Analog rail',
            inputs: { analog: { A0: 3.3 } },
            expectedOutputs: { analog: { A0: 3.3 } },
            tolerances: { analog: { A0: 0.15 } },
            settlingTime: 20,
          },
        ],
      });
      setSession(setup);
      const result = await ArduinoIDEIntegration.runHILTest(setup);
      setSummary(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'HIL failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold">Hardware-in-the-loop</h2>
          <p className="text-sm text-muted-foreground">Exercise digital, analog, and UART loops against firmware.</p>
        </div>
        <Button onClick={run} disabled={busy}>{busy ? 'Running…' : 'Run HIL suite'}</Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Card>
        <CardHeader><CardTitle>Session {session?.id ?? '—'}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {session && <Badge>{session.status}</Badge>}
          {summary && (
            <p>
              {summary.summary.passedTests}/{summary.summary.totalTests} passed in {summary.summary.duration} ms
            </p>
          )}
          {summary?.results.map((r) => (
            <div key={r.testCaseId} className="flex justify-between border-b border-border py-1">
              <span>{r.testCaseId}</span>
              <Badge variant={r.passed ? 'default' : 'destructive'}>{r.passed ? 'pass' : 'fail'}</Badge>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
