/**
 * Demo HIL + twin: the rectifier board closes its own loop (no hardware needed).
 *
 * HIL `applyTestInputs`/`measureOutputs` need real bench hardware — but the
 * suite VALIDATION (`setupHILTest`) is pure logic and already tested, so the
 * demo proves the rectifier suite is coherent: OUT-rail cases against
 * enabled analog I/O. The twin half is fully provable: Monte Carlo
 * envelope over the rectifier netlist + synthetic bench samples at the band
 * centre verify, drifted ones fail. Proven by `demoHilTwin.test.ts`.
 */
import { ArduinoIDEIntegration } from '../programming/boardProgrammer';
import { buildCircuitModel } from '../simulation/circuitModel';
import { runOperatingPoint, type AnalysisOutcome } from '../simulation/solver';
import { correlateBench, toleranceEnvelope } from '../simulation/benchCorrelation';
import type { CircuitModel } from '../simulation/circuitModel';
import { buildDemoBoard } from './demoBoard';
import { buildCircuitNetlist } from '../simulation/netlistBuilder';

export interface DemoHilTwin {
  hilTests: number;
  hilReady: boolean;
  envelopeSignals: string[];
  verified: boolean;
  driftedFails: boolean;
  verdict: string;
}

const operatingPointOf = (perturbed: CircuitModel): AnalysisOutcome =>
  runOperatingPoint(perturbed, { temperatureCelsius: 27 }).outcome;

/**
 * The rectifier HIL suite — single source shared by the demo proof and the
 * panel, so the UI can never drift back to fixture data.
 */
export const RECTIFIER_HIL_SUITE = {
  hardwareInterfaces: { analog: true },
  testCases: [
    {
      id: 'rectifier-out-high', name: 'OUT charges on positive half-cycle',
      inputs: { analog: { SRC: 5 } }, expectedOutputs: { analog: { OUT: 4.5 } },
      settlingTime: 20,
    },
    {
      id: 'rectifier-out-blocked', name: 'OUT holds at zero on negative half-cycle',
      inputs: { analog: { SRC: -5 } }, expectedOutputs: { analog: { OUT: 0 } },
      settlingTime: 20,
    },
  ],
} as const;

export async function buildDemoHilTwin(): Promise<DemoHilTwin> {
  // HIL suite coherence: SRC drive + OUT measurement on enabled analog lines.
  const session = await ArduinoIDEIntegration.setupHILTest({
    hardwareInterfaces: { ...RECTIFIER_HIL_SUITE.hardwareInterfaces },
    testCases: [...RECTIFIER_HIL_SUITE.testCases],
  });
  // Twin envelope over the REAL rectifier netlist (not a divider fixture).
  const board = buildDemoBoard();
  const netlist = buildCircuitNetlist('rectifier twin', board.components, board.wires, { type: 'dc' });
  const { model, errors } = buildCircuitModel(netlist);
  if (errors.length > 0) throw new Error(`Rectifier twin model failed: ${errors.join('; ')}`);
  const { bands } = toleranceEnvelope(model, operatingPointOf, { iterations: 40, tolerance: 0.05, seed: 7 });
  const target = bands.find((b) => b.signal === 'V(OUT)') ?? bands[0];
  if (!target) throw new Error('Rectifier twin produced no envelope bands.');
  const centre = (target.points[0].low + target.points[0].high) / 2;
  const good = correlateBench(bands, [{ signal: target.signal, x: target.points[0].x, value: centre }]);
  const drifted = correlateBench(bands, [{ signal: target.signal, x: target.points[0].x, value: centre + 2 }]);
  const verdict = good.verified && !drifted.verified
    ? `PASS: HIL suite ready (${session.config.testCases.length} cases), twin verifies centre and refuses +2 V drift.`
    : `FAIL: twin verdict broken (good=${good.verified}, drifted=${drifted.verified}).`;
  return {
    hilTests: session.config.testCases.length,
    hilReady: session.status === 'ready',
    envelopeSignals: bands.map((b) => b.signal),
    verified: good.verified,
    driftedFails: !drifted.verified,
    verdict,
  };
}
