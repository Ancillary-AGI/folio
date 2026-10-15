import { useState } from 'react';
import { ArduinoIDEIntegration, type HILTestSession, type HILTestSummary } from '../../lib/programming/boardProgrammer';
import { BLINKER_HIL_SUITE } from '../../lib/demo/demoHilTwin';
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
      // The proven blinker suite — not fixture data: same cases the demo test validates.
      const setup = await ArduinoIDEIntegration.setupHILTest({
        hardwareInterfaces: { ...BLINKER_HIL_SUITE.hardwareInterfaces },
        testCases: [...BLINKER_HIL_SUITE.testCases],
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
          <p className="text-xs text-muted-foreground">
            No hardware attached: drive/measure refuses closed. The blinker suite above validates coherently,
            and the twin envelope (Monte Carlo ±3σ) verifies centre samples while refusing drift — see the
            Twin panel.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
