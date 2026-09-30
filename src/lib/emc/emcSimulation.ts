export interface EMCTrace {
  id: string;
  lengthMm: number;
  currentA: number;
  frequencyHz: number;
  loopAreaMm2: number;
}

export interface EMCResult {
  radiatedDBuV: number;
  conductedDBuV: number;
  limitDBuV: number;
  marginDb: number;
  compliant: boolean;
  hotspots: Array<{ traceId: string; contribution: number }>;
  recommendations: string[];
}

export class EMCSimulationEngine {
  simulate(traces: EMCTrace[], standard: 'CISPR32' | 'FCC15' | 'IEC61000' = 'CISPR32'): EMCResult {
    const limit = standard === 'FCC15' ? 40 : standard === 'IEC61000' ? 50 : 46;
    const hotspots = traces.map((trace) => {
      const loop = Math.max(trace.loopAreaMm2, 1);
      const contribution =
        20 * Math.log10(Math.max(trace.currentA, 1e-6) * (trace.frequencyHz / 1e6) * Math.sqrt(loop) * (trace.lengthMm / 100));
      return { traceId: trace.id, contribution };
    });

    const radiated = hotspots.reduce((sum, h) => sum + Math.max(h.contribution, 0), 0) / Math.max(traces.length, 1);
    const conducted = radiated * 0.72;
    const margin = limit - radiated;
    const recommendations: string[] = [];
    if (margin < 6) recommendations.push('Add common-mode choke on cable interfaces');
    if (traces.some((t) => t.loopAreaMm2 > 250)) recommendations.push('Reduce return-path loop area with ground pour');
    if (traces.some((t) => t.frequencyHz > 1e8)) recommendations.push('Stitch GND vias along high-speed traces');

    return {
      radiatedDBuV: Number(radiated.toFixed(2)),
      conductedDBuV: Number(conducted.toFixed(2)),
      limitDBuV: limit,
      marginDb: Number(margin.toFixed(2)),
      compliant: margin >= 0,
      hotspots: hotspots.sort((a, b) => b.contribution - a.contribution),
      recommendations,
    };
  }
}

export const emcSimulationEngine = new EMCSimulationEngine();
