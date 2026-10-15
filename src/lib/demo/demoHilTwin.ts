/**
 * Demo HIL + twin: the blinker board closes its own loop (no hardware needed).
 *
 * HIL `applyTestInputs`/`measureOutputs` need real bench hardware — but the
 * suite VALIDATION (`setupHILTest`) is pure logic and already tested, so the
 * demo proves the blinker suite is coherent: LED + GPIO cases against
 * enabled digital I/O. The twin half is fully provable: Monte Carlo
 * envelope over the blinker netlist + synthetic bench samples at the band
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

export async function buildDemoHilTwin(): Promise<DemoHilTwin> {
  // HIL suite coherence: LED drive + GPIO cases on enabled digital lines.
  const session = await ArduinoIDEIntegration.setupHILTest({
    hardwareInterfaces: { digital: true },
    testCases: [
      {
        id: 'blinker-led-on', name: 'LED on at GPIO high',
        inputs: { digital: { GPIO: true } }, expectedOutputs: { digital: { LED_K: false } },
        settlingTime: 20,
      },
      {
        id: 'blinker-led-off', name: 'LED off at GPIO low',
        inputs: { digital: { GPIO: false } }, expectedOutputs: { digital: { LED_K: true } },
        settlingTime: 20,
      },
    ],
  });
  // Twin envelope over the REAL blinker netlist (not a divider fixture).
  const board = buildDemoBoard();
  const netlist = buildCircuitNetlist('blinker twin', board.components, board.wires, { type: 'dc' });
  const { model, errors } = buildCircuitModel(netlist);
  if (errors.length > 0) throw new Error(`Blinker twin model failed: ${errors.join('; ')}`);
  const { bands } = toleranceEnvelope(model, operatingPointOf, { iterations: 40, tolerance: 0.05, seed: 7 });
  const target = bands.find((b) => b.signal === 'V(LED_K)') ?? bands[0];
  if (!target) throw new Error('Blinker twin produced no envelope bands.');
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
