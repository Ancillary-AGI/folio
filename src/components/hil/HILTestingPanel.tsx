import { useCallback, useMemo, useState } from 'react';
import {
  Activity, AlertTriangle, CheckCircle2, CircuitBoard, Copy, Cpu, Download, FlaskConical,
  GripVertical, Plus, Radio, Trash2, XCircle, Zap,
} from 'lucide-react';
import { ArduinoIDEIntegration, type HILTestResult, type HILTestSession } from '../../lib/programming/boardProgrammer';
import { RECTIFIER_HIL_SUITE } from '../../lib/demo/demoHilTwin';
import { buildDemoBoard } from '../../lib/demo/demoBoard';
import { buildCircuitNetlist } from '../../lib/simulation/netlistBuilder';
import { createCircuitTwinRig, type CircuitTwinRig } from '../../lib/hil/twinRig';
import { HIL_BUSES, HIL_BUS_LABELS, type HilBus } from '../../lib/hil/hilRig';
import {
  CASE_FILTERS, buildSuite, cloneCase, defaultSuite, draftBuses, emptyCase, emptyPayload,
  nextKey, toleranceText, verdictRows, verdictsToCSV,
  type AnalogDraft, type CanDraft, type CaseDraft, type CaseFilter, type DigitalDraft,
  type PayloadDraft, type SuiteDesign,
} from '../../lib/hil/suite';
import { loadDomainDesign, usePublishDomainDesign } from '../../lib/project/domainDesign';
import { downloadFile } from '../../lib/exportUtils';
import { describeError } from '../../lib/utils';
import { useProjectStore } from '../../stores/useProjectStore';
import { useTheme } from '../../lib/theme/useTheme';
import { chartColor } from '../../lib/theme/tokens';
import TraceChart, { type TraceRow, type TraceSeries } from '../charts/TraceChart';
import { Button } from '../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import ConfirmDialog from '../ui/ConfirmDialog';
import { useConfirm } from '../ui/useConfirm';
import { useDemoRequest } from '../workspace/useDemoRequest';

const DESIGN_KEY = 'hil-suite';

interface RunInfo {
  at: number;
  rig: string;
  durationMs: number;
  total: number;
  passed: number;
  failed: number;
}

const restoreSuite = (): SuiteDesign => {
  const base = defaultSuite(RECTIFIER_HIL_SUITE.testCases);
  const saved = loadDomainDesign<SuiteDesign>(DESIGN_KEY);
  if (!saved || !Array.isArray(saved.cases)) return base;
  return {
    ...base,
    ...saved,
    interfaces: { ...base.interfaces, ...(saved.interfaces ?? {}) },
    cases: saved.cases.filter((entry) => entry && typeof entry.key === 'string'),
  };
};

function StatTile({ label, value, tone }: { label: string; value: string; tone?: 'pass' | 'fail' | 'idle' }) {
  const colour =
    tone === 'pass' ? 'text-success' : tone === 'fail' ? 'text-destructive' : 'text-foreground';
  return (
    <Card className="app-panel">
      <CardContent className="p-3">
        <div className={`text-2xl font-semibold tabular-nums leading-tight ${colour}`}>{value}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

/** One channel row of a payload editor. Inputs are strings so typing never fights the parser. */
function PayloadEditor({
  draft, direction, onChange, driveNets, measureNets, caseId,
}: {
  draft: PayloadDraft;
  direction: 'inputs' | 'expected';
  onChange: (next: PayloadDraft) => void;
  driveNets: readonly string[];
  measureNets: readonly string[];
  caseId: string;
}) {
  const side = direction === 'inputs' ? 'stimulus' : 'assertion';
  const set = <K extends keyof PayloadDraft>(key: K, value: PayloadDraft[K]) => onChange({ ...draft, [key]: value });
  const nets = direction === 'inputs' ? driveNets : measureNets;
  const listId = `hil-nets-${caseId}-${direction}`;

  const rowLabel = (bus: string, index: number, field: string) => `${caseId} ${side} ${bus} ${index + 1} ${field}`;

  return (
    <div className="space-y-3">
      <datalist id={listId}>
        {nets.map((net) => <option key={net} value={net} />)}
      </datalist>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">Digital GPIO</h4>
          <button
            type="button"
            className="cad-ctl"
            title="Add a digital pin to this direction"
            onClick={() => set('digital', [...draft.digital, { key: nextKey('di'), channel: '', high: true }])}
          >
            <Plus /> Add pin
          </button>
        </div>
        {draft.digital.length === 0 && <p className="text-[11px] text-muted-foreground">No pins asserted.</p>}
        <div className="space-y-1">
          {draft.digital.map((row: DigitalDraft, index) => (
            <div key={row.key} className="flex items-center gap-1.5">
              <input
                className="cad-field h-7 flex-1"
                aria-label={rowLabel('digital', index, 'pin')}
                placeholder="D3"
                value={row.channel}
                onChange={(event) => set('digital', draft.digital.map((entry) => entry.key === row.key ? { ...entry, channel: event.target.value } : entry))}
              />
              <button
                type="button"
                className={`cad-ctl w-16 ${row.high ? 'cad-ctl--active' : ''}`}
                aria-pressed={row.high}
                title={`Drive ${row.channel || 'this pin'} ${row.high ? 'LOW' : 'HIGH'}`}
                onClick={() => set('digital', draft.digital.map((entry) => entry.key === row.key ? { ...entry, high: !entry.high } : entry))}
              >
                {row.high ? 'HIGH' : 'LOW'}
              </button>
              <button
                type="button"
                className="cad-ctl cad-ctl--icon"
                aria-label={`Remove ${rowLabel('digital', index, 'pin')}`}
                title="Remove this pin"
                onClick={() => set('digital', draft.digital.filter((entry) => entry.key !== row.key))}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">Analog nets</h4>
          <button
            type="button"
            className="cad-ctl"
            title="Add an analog net to this direction"
            onClick={() => set('analog', [...draft.analog, { key: nextKey('ao'), channel: '', value: '', tolerance: '' }])}
          >
            <Plus /> Add net
          </button>
        </div>
        {draft.analog.length === 0 && <p className="text-[11px] text-muted-foreground">No nets asserted.</p>}
        <div className="space-y-1">
          {draft.analog.map((row: AnalogDraft, index) => (
            <div key={row.key} className="flex items-center gap-1.5">
              <input
                className="cad-field h-7 w-20 flex-1"
                list={listId}
                aria-label={rowLabel('analog', index, 'net')}
                placeholder="OUT"
                value={row.channel}
                onChange={(event) => set('analog', draft.analog.map((entry) => entry.key === row.key ? { ...entry, channel: event.target.value } : entry))}
              />
              <span className="cad-form-field h-7 w-24">
                <input
                  className="cad-form-input"
                  inputMode="decimal"
                  aria-label={rowLabel('analog', index, 'volts')}
                  placeholder="4.5"
                  value={row.value}
                  onChange={(event) => set('analog', draft.analog.map((entry) => entry.key === row.key ? { ...entry, value: event.target.value } : entry))}
                />
                <span className="cad-form-unit">V</span>
              </span>
              {direction === 'expected' && (
                <span className="cad-form-field h-7 w-24" title={toleranceText(row.tolerance)}>
                  <span className="cad-form-unit pl-2">±</span>
                  <input
                    className="cad-form-input"
                    inputMode="decimal"
                    aria-label={rowLabel('analog', index, 'tolerance volts')}
                    placeholder="0.1"
                    value={row.tolerance}
                    onChange={(event) => set('analog', draft.analog.map((entry) => entry.key === row.key ? { ...entry, tolerance: event.target.value } : entry))}
                  />
                  <span className="cad-form-unit">V</span>
                </span>
              )}
              <button
                type="button"
                className="cad-ctl cad-ctl--icon"
                aria-label={`Remove ${rowLabel('analog', index, 'net')}`}
                title="Remove this net"
                onClick={() => set('analog', draft.analog.filter((entry) => entry.key !== row.key))}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h4 className="text-[11px] font-medium text-muted-foreground">CAN frames</h4>
          <button
            type="button"
            className="cad-ctl"
            title="Add a CAN frame to this direction"
            onClick={() => set('can', [...draft.can, { key: nextKey('can'), id: '0x100', data: '' }])}
          >
            <Plus /> Add frame
          </button>
        </div>
        {draft.can.length === 0 && <p className="text-[11px] text-muted-foreground">No frames asserted.</p>}
        <div className="space-y-1">
          {draft.can.map((row: CanDraft, index) => (
            <div key={row.key} className="flex items-center gap-1.5">
              <input
                className="cad-field h-7 w-20"
                aria-label={rowLabel('can', index, 'identifier')}
                placeholder="0x1F2"
                value={row.id}
                onChange={(event) => set('can', draft.can.map((entry) => entry.key === row.key ? { ...entry, id: event.target.value } : entry))}
              />
              <input
                className="cad-field h-7 min-w-0 flex-1 font-mono"
                aria-label={rowLabel('can', index, 'payload hex')}
                placeholder="01 A0 FF"
                value={row.data}
                onChange={(event) => set('can', draft.can.map((entry) => entry.key === row.key ? { ...entry, data: event.target.value } : entry))}
              />
              <button
                type="button"
                className="cad-ctl cad-ctl--icon"
                aria-label={`Remove ${rowLabel('can', index, 'frame')}`}
                title="Remove this frame"
                onClick={() => set('can', draft.can.filter((entry) => entry.key !== row.key))}
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-1.5">
        <h4 className="text-[11px] font-medium text-muted-foreground">Serial payloads</h4>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={`cad-ctl w-16 ${draft.spi.active ? 'cad-ctl--active' : ''}`}
            aria-pressed={draft.spi.active}
            title={draft.spi.active ? 'Stop asserting an SPI response' : 'Assert an SPI response'}
            onClick={() => set('spi', { ...draft.spi, active: !draft.spi.active })}
          >
            SPI
          </button>
          <input
            className="cad-field h-7 min-w-0 flex-1 font-mono disabled:opacity-40"
            disabled={!draft.spi.active}
            aria-label={`${caseId} ${side} SPI payload hex`}
            placeholder="A0 01 02"
            value={draft.spi.hex}
            onChange={(event) => set('spi', { ...draft.spi, hex: event.target.value })}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={`cad-ctl w-16 ${draft.i2c.active ? 'cad-ctl--active' : ''}`}
            aria-pressed={draft.i2c.active}
            title={draft.i2c.active ? 'Stop asserting an I²C response' : 'Assert an I²C response'}
            onClick={() => set('i2c', { ...draft.i2c, active: !draft.i2c.active })}
          >
            I²C
          </button>
          {direction === 'inputs' && (
            <input
              className="cad-field h-7 w-16 disabled:opacity-40"
              disabled={!draft.i2c.active}
              aria-label={`${caseId} ${side} I²C address`}
              placeholder="0x50"
              value={draft.i2c.address}
              onChange={(event) => set('i2c', { ...draft.i2c, address: event.target.value })}
            />
          )}
          <input
            className="cad-field h-7 min-w-0 flex-1 font-mono disabled:opacity-40"
            disabled={!draft.i2c.active}
            aria-label={`${caseId} ${side} I²C payload hex`}
            placeholder="01 02"
            value={draft.i2c.hex}
            onChange={(event) => set('i2c', { ...draft.i2c, hex: event.target.value })}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={`cad-ctl w-16 ${draft.uart.active ? 'cad-ctl--active' : ''}`}
            aria-pressed={draft.uart.active}
            title={draft.uart.active ? 'Stop asserting UART text' : 'Assert UART text'}
            onClick={() => set('uart', { ...draft.uart, active: !draft.uart.active })}
          >
            UART
          </button>
          <input
            className="cad-field h-7 min-w-0 flex-1 font-mono disabled:opacity-40"
            disabled={!draft.uart.active}
            aria-label={`${caseId} ${side} UART text`}
            placeholder="READY"
            value={draft.uart.text}
            onChange={(event) => set('uart', { ...draft.uart, text: event.target.value })}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          An empty UART box still asserts: it expects silence. Switch the bus off to stop asserting it.
        </p>
      </section>
    </div>
  );
}

export default function HILTestingPanel() {
  const { components, wires } = useProjectStore();
  const { theme } = useTheme();
  const { spec, confirm, resolve } = useConfirm();

  const [design, setDesign] = useState<SuiteDesign>(restoreSuite);
  const [results, setResults] = useState<Record<string, HILTestResult>>({});
  const [session, setSession] = useState<HILTestSession | null>(null);
  const [runInfo, setRunInfo] = useState<RunInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [undoBatch, setUndoBatch] = useState<{ cases: CaseDraft[]; note: string } | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);

  usePublishDomainDesign(DESIGN_KEY, design, (saved) => setDesign({ ...restoreSuite(), ...saved }));

  const patch = useCallback((next: Partial<SuiteDesign>) => setDesign((current) => ({ ...current, ...next })), []);
  const patchCase = useCallback((key: string, next: Partial<CaseDraft>) => {
    setDesign((current) => ({
      ...current,
      cases: current.cases.map((entry) => (entry.key === key ? { ...entry, ...next } : entry)),
    }));
  }, []);

  /** The twin solves the sheet on screen; with an empty sheet it solves the reference rectifier. */
  const twin = useMemo<{ rig: CircuitTwinRig | null; source: string; error: string | null }>(() => {
    const temperature = Number(design.temperatureC);
    const useProject = components.length > 0;
    try {
      const board = useProject ? null : buildDemoBoard();
      const netlist = buildCircuitNetlist(
        useProject ? 'Project sheet' : 'Rectifier reference',
        useProject ? components : board!.components,
        useProject ? wires : board!.wires,
        { type: 'dc' },
      );
      const rig = createCircuitTwinRig(netlist, {
        label: useProject ? 'Circuit twin — project sheet' : 'Circuit twin — rectifier reference',
        temperatureCelsius: Number.isFinite(temperature) ? temperature : 27,
      });
      return { rig, source: useProject ? 'the sheet on screen' : 'the rectifier reference board', error: null };
    } catch (cause) {
      return { rig: null, source: useProject ? 'the sheet on screen' : 'the rectifier reference board', error: describeError(cause) };
    }
  }, [components, wires, design.temperatureC]);

  const built = useMemo(() => buildSuite(design), [design]);
  const names = useMemo(
    () => Object.fromEntries(design.cases.map((entry) => [entry.id, entry.name])),
    [design.cases],
  );
  const resultList = useMemo(() => Object.values(results), [results]);
  const passed = resultList.filter((result) => result.passed).length;
  const failed = resultList.length - passed;
  const unrun = design.cases.filter((entry) => entry.enabled && !results[entry.id]).length;

  const visibleCases = useMemo(() => {
    const query = design.query.trim().toLowerCase();
    return design.cases.filter((entry) => {
      const result = results[entry.id];
      if (design.filter === 'passed' && !result?.passed) return false;
      if (design.filter === 'failed' && (!result || result.passed)) return false;
      if (design.filter === 'unrun' && result) return false;
      if (!query) return true;
      return `${entry.id} ${entry.name} ${entry.description}`.toLowerCase().includes(query);
    });
  }, [design.cases, design.filter, design.query, results]);

  const selected = design.cases.find((entry) => entry.key === design.selectedKey) ?? visibleCases[0] ?? null;
  const selectedResult = selected ? results[selected.id] : undefined;

  const runCases = async (drafts: CaseDraft[], token: string) => {
    setBusy(token);
    setError(null);
    setUndoBatch(null);
    try {
      const suite = buildSuite({ ...design, cases: drafts }, { includeDisabled: true });
      if (!suite.config) {
        setError(suite.problems.map((problem) => problem.message).join(' '));
        return;
      }
      const rig = design.rig === 'twin' ? (twin.rig ?? undefined) : undefined;
      if (design.rig === 'twin' && !rig) {
        setError(twin.error ?? 'The circuit twin could not be built from this sheet.');
        return;
      }
      const setup = await ArduinoIDEIntegration.setupHILTest(suite.config);
      setSession(setup);
      const summary = await ArduinoIDEIntegration.runHILTest(setup, rig);
      setResults((current) => {
        const next = { ...current };
        for (const result of summary.results) next[result.testCaseId] = result;
        return next;
      });
      setRunInfo({
        at: Date.now(),
        rig: rig?.label ?? 'Bench hardware',
        durationMs: summary.summary.duration,
        total: summary.summary.totalTests,
        passed: summary.summary.passedTests,
        failed: summary.summary.failedTests,
      });
    } catch (cause) {
      setError(describeError(cause));
    } finally {
      setBusy(null);
    }
  };

  useDemoRequest('hil-suite', () => {
    void runCases(design.cases.filter((entry) => entry.enabled), 'suite');
  });

  const addCase = () => {
    const draft = emptyCase(design.cases.length + 1);
    setDesign((current) => ({ ...current, cases: [...current.cases, draft], selectedKey: draft.key }));
  };

  const duplicateCase = (entry: CaseDraft) => {
    const copy = cloneCase(entry, design.cases.filter((other) => other.id.startsWith(entry.id)).length);
    setDesign((current) => {
      const at = current.cases.findIndex((other) => other.key === entry.key);
      const cases = [...current.cases];
      cases.splice(at + 1, 0, copy);
      return { ...current, cases, selectedKey: copy.key };
    });
  };

  const removeCases = async (keys: string[]) => {
    const victims = design.cases.filter((entry) => keys.includes(entry.key));
    if (victims.length === 0) return;
    const accepted = await confirm({
      title: victims.length === 1 ? `Delete "${victims[0].id}"?` : `Delete ${victims.length} test cases?`,
      detail: 'The cases and their assertions leave the suite. Results already recorded stay on screen until the next run, and Undo puts the cases back.',
      confirmLabel: victims.length === 1 ? 'Delete case' : `Delete ${victims.length} cases`,
      destructive: true,
    });
    if (!accepted) return;
    setUndoBatch({ cases: victims, note: `${victims.length} case${victims.length === 1 ? '' : 's'} deleted` });
    setChecked((current) => current.filter((key) => !keys.includes(key)));
    setDesign((current) => {
      const cases = current.cases.filter((entry) => !keys.includes(entry.key));
      return {
        ...current,
        cases,
        selectedKey: keys.includes(current.selectedKey ?? '') ? (cases[0]?.key ?? null) : current.selectedKey,
      };
    });
  };

  const moveCase = (key: string, delta: number) => {
    setDesign((current) => {
      const at = current.cases.findIndex((entry) => entry.key === key);
      const to = at + delta;
      if (at < 0 || to < 0 || to >= current.cases.length) return current;
      const cases = [...current.cases];
      const [moved] = cases.splice(at, 1);
      cases.splice(to, 0, moved);
      return { ...current, cases };
    });
  };

  const dropOn = (key: string) => {
    if (!dragKey || dragKey === key) return;
    setDesign((current) => {
      const from = current.cases.findIndex((entry) => entry.key === dragKey);
      const to = current.cases.findIndex((entry) => entry.key === key);
      if (from < 0 || to < 0) return current;
      const cases = [...current.cases];
      const [moved] = cases.splice(from, 1);
      cases.splice(to, 0, moved);
      return { ...current, cases };
    });
    setDragKey(null);
  };

  const setEnabled = (keys: string[], enabled: boolean) => {
    setDesign((current) => ({
      ...current,
      cases: current.cases.map((entry) => (keys.includes(entry.key) ? { ...entry, enabled } : entry)),
    }));
    setChecked([]);
  };

  const exportJSON = () => {
    downloadFile(
      JSON.stringify({ generatedAt: new Date().toISOString(), run: runInfo, suite: design, results: resultList }, null, 2),
      'hil-suite.json',
      'application/json',
    );
  };

  const exportCSV = () => {
    downloadFile(verdictsToCSV(verdictRows(resultList, names)), 'hil-results.csv', 'text/csv');
  };

  /** Measured against asserted, one point per case that produced an analog verdict. */
  const comparison = useMemo(() => {
    const rows: TraceRow[] = [];
    const labels: string[] = [];
    for (const entry of design.cases) {
      const result = results[entry.id];
      const verdict = result?.verdicts?.find((item) => item.bus === 'analog' && item.delta !== undefined);
      if (!verdict) continue;
      const expected = Number(verdict.expected.replace(/[^\d.eE+-]/g, ''));
      const measured = Number(verdict.measured.replace(/[^\d.eE+-]/g, ''));
      if (!Number.isFinite(expected) || !Number.isFinite(measured)) continue;
      labels.push(`${entry.id} · ${verdict.channel}`);
      rows.push({ index: rows.length, expected, measured });
    }
    return { rows, labels };
  }, [design.cases, results]);

  const series: TraceSeries[] = [
    { key: 'expected', color: chartColor(theme, '--chart-4'), label: 'Asserted', unit: 'V', dash: '5 4' },
    { key: 'measured', color: chartColor(theme, '--chart-1'), label: 'Measured', unit: 'V' },
  ];

  const caseProblems = selected ? built.problems.filter((problem) => problem.caseKey === selected.key) : [];
  const suiteProblems = built.problems.filter((problem) => problem.caseKey === null);

  return (
    <div className="h-full overflow-auto bg-background p-4">
      <div className="mx-auto max-w-[1600px] space-y-4">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
              <FlaskConical className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold tracking-[-0.01em]">Hardware-in-the-loop</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Author stimulus and assertions across six buses, then run them against bench hardware or the solved circuit twin.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportJSON} disabled={resultList.length === 0} title="Download the suite and every recorded verdict as JSON">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Suite JSON
            </Button>
            <Button variant="outline" size="sm" onClick={exportCSV} disabled={resultList.length === 0} title="Download one row per asserted channel as CSV">
              <Download className="mr-1.5 h-3.5 w-3.5" /> Verdict CSV
            </Button>
            <Button
              size="sm"
              onClick={() => { void runCases(design.cases.filter((entry) => entry.enabled), 'suite'); }}
              disabled={busy !== null || !built.config}
              title={built.config ? 'Run every enabled case against the selected rig' : 'Fix the suite check before running'}
            >
              <Zap className="mr-1.5 h-3.5 w-3.5" /> {busy ? 'Running…' : 'Run HIL suite'}
            </Button>
          </div>
        </header>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Cases passed" value={String(passed)} tone={passed > 0 ? 'pass' : undefined} />
          <StatTile label="Cases failed" value={String(failed)} tone={failed > 0 ? 'fail' : undefined} />
          <StatTile label="Enabled, not run" value={String(unrun)} />
          <StatTile
            label={runInfo ? `Last run · ${runInfo.durationMs} ms` : 'No run yet'}
            value={runInfo ? `${runInfo.passed}/${runInfo.total} passed` : '—'}
          />
        </div>

        {runInfo && (
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {runInfo.passed}/{runInfo.total} passed in {runInfo.durationMs} ms against {runInfo.rig} ·{' '}
            {new Date(runInfo.at).toLocaleTimeString()}
          </p>
        )}

        {error && (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}

        {undoBatch && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <span aria-live="polite">{undoBatch.note}. The assertions are gone from the suite.</span>
            <Button
              size="sm"
              variant="outline"
              title="Put the deleted cases back in their original order"
              onClick={() => {
                setDesign((current) => ({ ...current, cases: [...current.cases, ...undoBatch.cases] }));
                setUndoBatch(null);
              }}
            >
              Undo delete
            </Button>
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(300px,360px)_minmax(0,1fr)]">
          <div className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <Card className="app-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Radio className="h-4 w-4 text-primary" /> Rig & interfaces
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-muted-foreground" htmlFor="hil-rig">Run against</label>
                  <select
                    id="hil-rig"
                    className="cad-form-select w-full max-w-none"
                    value={design.rig}
                    onChange={(event) => patch({ rig: event.target.value as SuiteDesign['rig'] })}
                  >
                    <option value="twin">Circuit twin — solved netlist</option>
                    <option value="bench">Bench hardware — drive & measure</option>
                  </select>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {design.rig === 'twin'
                      ? `Solves ${twin.source} at ${design.temperatureC || '27'} °C. Analog only: inputs override the source on a net, outputs are converged node voltages. This verifies the design, not the built board.`
                      : 'No bench interface is attached in the browser, so every case reports a refusal rather than a measurement. Connect drive and measurement hardware to run this rig for real.'}
                  </p>
                </div>

                {design.rig === 'twin' && (
                  <div className="cad-prop-row">
                    <span className="cad-prop-label">Temperature</span>
                    <span className="cad-form-field h-6 w-28">
                      <input
                        className="cad-form-input"
                        inputMode="decimal"
                        aria-label="Twin temperature in degrees Celsius"
                        value={design.temperatureC}
                        onChange={(event) => patch({ temperatureC: event.target.value })}
                      />
                      <span className="cad-form-unit">°C</span>
                    </span>
                  </div>
                )}

                <div>
                  <div className="mb-1.5 text-[11px] font-medium text-muted-foreground">Enabled interfaces</div>
                  <div className="flex flex-wrap gap-1.5">
                    {HIL_BUSES.map((bus: HilBus) => (
                      <button
                        key={bus}
                        type="button"
                        className={`cad-ctl ${design.interfaces[bus] ? 'cad-ctl--active' : ''}`}
                        aria-pressed={design.interfaces[bus]}
                        title={`${design.interfaces[bus] ? 'Disable' : 'Enable'} ${HIL_BUS_LABELS[bus]} for this suite`}
                        onClick={() => patch({ interfaces: { ...design.interfaces, [bus]: !design.interfaces[bus] } })}
                      >
                        {HIL_BUS_LABELS[bus]}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground" htmlFor="hil-rate">Sampling</label>
                    <span className="cad-form-field h-7 w-full">
                      <input id="hil-rate" className="cad-form-input" inputMode="decimal" value={design.samplingHz}
                        onChange={(event) => patch({ samplingHz: event.target.value })} />
                      <span className="cad-form-unit">Hz</span>
                    </span>
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-muted-foreground" htmlFor="hil-timeout">Timeout</label>
                    <span className="cad-form-field h-7 w-full">
                      <input id="hil-timeout" className="cad-form-input" inputMode="decimal" value={design.timeoutMs}
                        onChange={(event) => patch({ timeoutMs: event.target.value })} />
                      <span className="cad-form-unit">ms</span>
                    </span>
                  </div>
                </div>

                <div className="cad-prop-row">
                  <span className="cad-prop-label">Session</span>
                  <span className="cad-prop-value font-mono text-[11px]">{session?.id ?? '—'}</span>
                </div>
                {twin.rig && design.rig === 'twin' && (
                  <div className="space-y-1 border-t border-border pt-2 text-[11px] text-muted-foreground">
                    <div><span className="font-medium text-foreground">Drive nets:</span> {twin.rig.driveNets.join(', ') || 'none'}</div>
                    <div><span className="font-medium text-foreground">Measure nets:</span> {twin.rig.measureNets.join(', ') || 'none'}</div>
                  </div>
                )}
                {design.rig === 'twin' && twin.error && (
                  <p role="alert" className="text-[11px] text-destructive">{twin.error}</p>
                )}
              </CardContent>
            </Card>

            <Card className="app-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CircuitBoard className="h-4 w-4 text-primary" /> Suite check
                </CardTitle>
              </CardHeader>
              <CardContent>
                {built.problems.length === 0 ? (
                  <p className="flex items-start gap-2 text-xs text-success">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {built.cases.length} case{built.cases.length === 1 ? '' : 's'} coherent: interfaces enabled, ids unique, every
                    assertion parseable. {design.rig === 'twin' ? 'The twin will solve them.' : 'The bench will refuse until hardware is attached.'}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {built.problems.map((problem, index) => (
                      <li key={index} className="flex items-start gap-2 text-xs text-destructive">
                        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <button
                          type="button"
                          className="min-w-0 text-left underline-offset-2 hover:underline"
                          title={problem.caseKey ? 'Select the case this problem belongs to' : 'Suite-level problem'}
                          onClick={() => { if (problem.caseKey) patch({ selectedKey: problem.caseKey }); }}
                        >
                          {problem.message}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {suiteProblems.length === 0 && built.problems.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Every problem above belongs to a case. Cases that build cleanly still run.
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="min-w-0 space-y-4">
            <Card className="app-panel">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Activity className="h-4 w-4 text-primary" /> Test cases
                    <span className="cad-chip">{visibleCases.length}/{design.cases.length}</span>
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {checked.length > 0 && (
                      <>
                        <Button size="sm" variant="outline" title="Run only the checked cases"
                          onClick={() => { void runCases(design.cases.filter((entry) => checked.includes(entry.key)), 'selection'); }}
                          disabled={busy !== null}>
                          Run {checked.length}
                        </Button>
                        <Button size="sm" variant="outline" title="Include the checked cases in the next suite run"
                          onClick={() => setEnabled(checked, true)}>Enable</Button>
                        <Button size="sm" variant="outline" title="Skip the checked cases in the next suite run"
                          onClick={() => setEnabled(checked, false)}>Skip</Button>
                        <Button size="sm" variant="outline" title="Delete the checked cases after confirmation"
                          onClick={() => { void removeCases(checked); }}>Delete</Button>
                      </>
                    )}
                    <Button size="sm" variant="outline" onClick={addCase} title="Append a blank case to the suite">
                      <Plus className="mr-1.5 h-3.5 w-3.5" /> Add case
                    </Button>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="cad-form-field h-7 min-w-[180px] flex-1">
                    <input
                      className="cad-form-input"
                      type="search"
                      aria-label="Search test cases"
                      placeholder="Search id, name or description"
                      value={design.query}
                      onChange={(event) => patch({ query: event.target.value })}
                    />
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {CASE_FILTERS.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        className={`cad-ctl ${design.filter === filter.id ? 'cad-ctl--active' : ''}`}
                        aria-pressed={design.filter === filter.id}
                        title={`Show ${filter.label.toLowerCase()} cases`}
                        onClick={() => patch({ filter: filter.id as CaseFilter })}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-1">
                {visibleCases.length === 0 && (
                  <p className="py-6 text-center text-xs text-muted-foreground">
                    {design.cases.length === 0
                      ? 'The suite is empty. Add a case, or load the rectifier reference from the demo gallery.'
                      : 'No case matches this filter and search.'}
                  </p>
                )}
                {visibleCases.map((entry) => {
                  const result = results[entry.id];
                  const isSelected = selected?.key === entry.key;
                  const problems = built.problems.filter((problem) => problem.caseKey === entry.key);
                  return (
                    <div
                      key={entry.key}
                      draggable
                      onDragStart={() => setDragKey(entry.key)}
                      onDragEnd={() => setDragKey(null)}
                      onDragOver={(event) => { event.preventDefault(); }}
                      onDrop={() => dropOn(entry.key)}
                      className={`rounded-md border px-2 py-1.5 transition-colors ${
                        isSelected ? 'border-primary/50 bg-primary/5' : 'border-border/60 bg-surface/40 hover:border-primary/30'
                      } ${dragKey === entry.key ? 'opacity-50' : ''} ${entry.enabled ? '' : 'opacity-60'}`}
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground" aria-hidden />
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-primary"
                          aria-label={`Select case ${entry.id}`}
                          checked={checked.includes(entry.key)}
                          onChange={(event) => setChecked((current) => event.target.checked ? [...current, entry.key] : current.filter((key) => key !== entry.key))}
                        />
                        <button
                          type="button"
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          title="Open this case in the editor"
                          onClick={() => patch({ selectedKey: entry.key })}
                        >
                          <span className={`h-2 w-2 shrink-0 rounded-full ${
                            !entry.enabled ? 'bg-muted-foreground/40'
                              : result ? (result.passed ? 'bg-success' : 'bg-destructive')
                              : problems.length > 0 ? 'bg-warning' : 'bg-muted-foreground/40'
                          }`} aria-hidden />
                          <span className="min-w-0">
                            <span className="block truncate font-mono text-xs font-medium">{entry.id}</span>
                            <span className="block truncate text-[11px] text-muted-foreground">{entry.name}</span>
                          </span>
                        </button>
                        <div className="hidden shrink-0 gap-1 sm:flex">
                          {draftBuses(entry).map((bus) => <span key={bus} className="cad-chip">{bus}</span>)}
                        </div>
                        {result && (
                          <Badge variant={result.passed ? 'default' : 'destructive'} className="shrink-0">
                            {result.passed ? 'pass' : 'fail'}
                          </Badge>
                        )}
                        <div className="flex shrink-0 items-center gap-0.5">
                          <button type="button" className="cad-ctl cad-ctl--icon" aria-label={`Move ${entry.id} earlier`} title="Move earlier in the run order"
                            onClick={() => moveCase(entry.key, -1)}><span aria-hidden>↑</span></button>
                          <button type="button" className="cad-ctl cad-ctl--icon" aria-label={`Move ${entry.id} later`} title="Move later in the run order"
                            onClick={() => moveCase(entry.key, 1)}><span aria-hidden>↓</span></button>
                          <button type="button" className="cad-ctl cad-ctl--icon" aria-label={`Run case ${entry.id}`} title="Run only this case"
                            disabled={busy !== null}
                            onClick={() => { void runCases([entry], entry.key); }}>
                            <Zap />
                          </button>
                          <button type="button" className="cad-ctl cad-ctl--icon" aria-label={`Duplicate case ${entry.id}`} title="Duplicate this case"
                            onClick={() => duplicateCase(entry)}><Copy /></button>
                          <button type="button" className="cad-ctl cad-ctl--icon" aria-label={`Delete case ${entry.id}`} title="Delete this case after confirmation"
                            onClick={() => { void removeCases([entry.key]); }}><Trash2 /></button>
                        </div>
                      </div>
                      {result && (
                        <div className="mt-1 flex flex-wrap items-center gap-2 pl-8 text-[11px] text-muted-foreground">
                          <span className="cad-readout">{result.duration} ms</span>
                          <span>{result.verdicts?.filter((verdict) => verdict.ok).length ?? 0}/{result.verdicts?.length ?? 0} channels</span>
                          {result.error && <span className="truncate text-destructive">{result.error}</span>}
                        </div>
                      )}
                      {!result && problems.length > 0 && (
                        <p className="mt-1 pl-8 text-[11px] text-warning">{problems[0].message}</p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            {selected && (
              <Card className="app-panel">
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Cpu className="h-4 w-4 text-primary" /> Editing {selected.id || 'unnamed case'}
                    </CardTitle>
                    <button
                      type="button"
                      className={`cad-ctl ${selected.enabled ? 'cad-ctl--active' : ''}`}
                      aria-pressed={selected.enabled}
                      title={selected.enabled ? 'Skip this case in the next suite run' : 'Include this case in the next suite run'}
                      onClick={() => patchCase(selected.key, { enabled: !selected.enabled })}
                    >
                      {selected.enabled ? 'Enabled' : 'Skipped'}
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground" htmlFor="hil-case-id">Case id</label>
                      <input id="hil-case-id" className="cad-field h-7 w-full font-mono" value={selected.id}
                        onChange={(event) => patchCase(selected.key, { id: event.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground" htmlFor="hil-case-name">Name</label>
                      <input id="hil-case-name" className="cad-field h-7 w-full" value={selected.name}
                        onChange={(event) => patchCase(selected.key, { name: event.target.value })} />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-[11px] font-medium text-muted-foreground" htmlFor="hil-case-desc">What this case proves</label>
                      <input id="hil-case-desc" className="cad-field h-7 w-full" value={selected.description}
                        placeholder="The rail it checks and why that level is the acceptance band"
                        onChange={(event) => patchCase(selected.key, { description: event.target.value })} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] font-medium text-muted-foreground" htmlFor="hil-settling">Settling time</label>
                      <span className="cad-form-field h-7 w-full">
                        <input id="hil-settling" className="cad-form-input" inputMode="decimal" value={selected.settlingMs}
                          onChange={(event) => patchCase(selected.key, { settlingMs: event.target.value })} />
                        <span className="cad-form-unit">ms</span>
                      </span>
                    </div>
                  </div>

                  {caseProblems.length > 0 && (
                    <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2">
                      {caseProblems.map((problem, index) => (
                        <li key={index} className="text-[11px] text-destructive">{problem.message}</li>
                      ))}
                    </ul>
                  )}

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="rounded-md border border-border/60 p-2.5">
                      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Stimulus — what the rig drives</h3>
                      <PayloadEditor
                        draft={selected.inputs}
                        direction="inputs"
                        caseId={selected.id || 'case'}
                        driveNets={twin.rig?.driveNets ?? []}
                        measureNets={twin.rig?.measureNets ?? []}
                        onChange={(next) => patchCase(selected.key, { inputs: next })}
                      />
                    </div>
                    <div className="rounded-md border border-border/60 p-2.5">
                      <h3 className="mb-2 text-xs font-medium text-muted-foreground">Assertion — what must come back</h3>
                      <PayloadEditor
                        draft={selected.expected}
                        direction="expected"
                        caseId={selected.id || 'case'}
                        driveNets={twin.rig?.driveNets ?? []}
                        measureNets={twin.rig?.measureNets ?? []}
                        onChange={(next) => patchCase(selected.key, { expected: next })}
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
                    <Button size="sm" variant="outline" title="Reset both directions of this case to empty"
                      onClick={() => patchCase(selected.key, { inputs: emptyPayload(), expected: emptyPayload() })}>
                      Clear channels
                    </Button>
                    <Button size="sm" onClick={() => { void runCases([selected], selected.key); }} disabled={busy !== null}
                      title="Run only this case against the selected rig">
                      <Zap className="mr-1.5 h-3.5 w-3.5" /> Run this case
                    </Button>
                    {busy === selected.key && <span className="text-xs text-muted-foreground" aria-live="polite">Solving…</span>}
                  </div>
                </CardContent>
              </Card>
            )}

            <Card className="app-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <CheckCircle2 className="h-4 w-4 text-primary" /> Verdict detail
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {!selectedResult && (
                  <p className="text-xs text-muted-foreground">
                    {selected
                      ? `Run "${selected.id}" to see what each channel measured against what it asserted.`
                      : 'Select a case to see its verdict.'}
                  </p>
                )}
                {selectedResult && (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={selectedResult.passed ? 'default' : 'destructive'}>
                        {selectedResult.passed ? 'pass' : 'fail'}
                      </Badge>
                      <span className="cad-chip">{selectedResult.duration} ms</span>
                      <span className="cad-chip">{new Date(selectedResult.timestamp).toLocaleTimeString()}</span>
                      <span className="text-[11px] text-muted-foreground">{runInfo?.rig ?? 'Bench hardware'}</span>
                    </div>
                    {selectedResult.error && (
                      <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 text-xs text-destructive">
                        {selectedResult.error}
                      </p>
                    )}
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] text-left text-xs">
                        <thead>
                          <tr className="border-b border-border text-[11px] text-muted-foreground">
                            <th className="py-1.5 pr-2 font-medium">Bus</th>
                            <th className="py-1.5 pr-2 font-medium">Channel</th>
                            <th className="py-1.5 pr-2 font-medium">Asserted</th>
                            <th className="py-1.5 pr-2 font-medium">Measured</th>
                            <th className="py-1.5 pr-2 font-medium">Δ</th>
                            <th className="py-1.5 pr-2 font-medium">Band</th>
                            <th className="py-1.5 font-medium">Verdict</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(selectedResult.verdicts ?? []).map((verdict, index) => (
                            <tr key={index} className="border-b border-border/50">
                              <td className="py-1.5 pr-2 text-muted-foreground">{verdict.bus}</td>
                              <td className="py-1.5 pr-2 font-mono">{verdict.channel}</td>
                              <td className="py-1.5 pr-2 tabular-nums">{verdict.expected}</td>
                              <td className="py-1.5 pr-2 font-medium tabular-nums">{verdict.measured}</td>
                              <td className={`py-1.5 pr-2 tabular-nums ${verdict.delta !== undefined && !verdict.ok ? 'text-destructive' : 'text-muted-foreground'}`}>
                                {verdict.delta === undefined ? '—' : `${verdict.delta > 0 ? '+' : ''}${Math.round(verdict.delta * 1e4) / 1e4} V`}
                              </td>
                              <td className="py-1.5 pr-2 tabular-nums text-muted-foreground">
                                {verdict.tolerance === undefined ? '—' : `±${verdict.tolerance} V`}
                              </td>
                              <td className="py-1.5">
                                <span className={verdict.ok ? 'text-success' : 'text-destructive'}>
                                  {verdict.ok ? 'pass' : verdict.reason ?? 'fail'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {comparison.rows.length > 0 && (
                  <div className="border-t border-border pt-3">
                    <h3 className="mb-1 text-xs font-medium">Asserted against measured</h3>
                    <p className="mb-2 text-[11px] text-muted-foreground">
                      One point per case with an analog verdict. The dashed trace is what the suite asserts; the solid trace is
                      what the rig returned. A gap between them is the design or the assertion being wrong — the table above says which channel.
                    </p>
                    <TraceChart
                      data={comparison.rows}
                      series={series}
                      xKey="index"
                      xLabel="Case"
                      xFormatter={(value) => comparison.labels[Math.round(value)] ?? ''}
                      yFormatter={(value) => `${Math.round(value * 100) / 100} V`}
                      readoutFormatter={(value) => `${value.toPrecision(4)} V`}
                      curve="linear"
                      height={190}
                      ariaLabel="Asserted voltage against measured voltage per test case"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <ConfirmDialog spec={spec} onResolve={resolve} />
    </div>
  );
}