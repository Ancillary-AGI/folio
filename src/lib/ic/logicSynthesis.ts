/**
 * Silicon Logic Synthesis and Technology Mapping.
 * Translates behavioral/structural logic gates into standard cell instances,
 * runs static timing analysis (STA) to find the critical path, and computes
 * total silicon core area and power budgets.
 */

import {
  SKY130_CELLS,
  type StandardCellKind,
  type StandardCellSpec,
  calculateCellDelayPs,
} from './standardCellLibrary';

export interface GatePrimitive {
  id: string;
  kind: StandardCellKind;
  inputs: Record<string, string>; // pinName -> netName
  outputs: Record<string, string>; // pinName -> netName
}

export interface StandardCellInstance {
  instanceName: string;
  cell: StandardCellSpec;
  connections: Record<string, string>; // pinName -> netName
}

export interface NetConnection {
  netName: string;
  driver?: { instanceName: string; pinName: string };
  loads: Array<{ instanceName: string; pinName: string }>;
  totalLoadCapacitanceFf: number;
}

export interface SynthesisMetrics {
  gateCount: number;
  totalCellAreaUm2: number;
  totalLeakagePowerUw: number;
  estimatedDynamicPowerMwAt100Mhz: number;
  criticalPathDelayPs: number;
  maxOperatingFreqMhz: number;
  criticalPath: string[];
}

export interface SynthesizedModule {
  name: string;
  instances: StandardCellInstance[];
  nets: Map<string, NetConnection>;
  primaryInputs: string[];
  primaryOutputs: string[];
  metrics: SynthesisMetrics;
}

/**
 * Synthesize a list of gate primitives into standard cell instances and compute STA.
 */
export function synthesizeGates(
  moduleName: string,
  gates: GatePrimitive[],
  primaryInputs: string[],
  primaryOutputs: string[],
  clockFreqMhz: number = 100,
): SynthesizedModule {
  if (gates.length === 0) throw new Error('Cannot synthesize an empty gate list.');

  const instances: StandardCellInstance[] = [];
  const nets = new Map<string, NetConnection>();

  const getOrCreateNet = (name: string): NetConnection => {
    let net = nets.get(name);
    if (!net) {
      net = { netName: name, loads: [], totalLoadCapacitanceFf: 0 };
      nets.set(name, net);
    }
    return net;
  };

  // Primary inputs act as drivers
  for (const inPin of primaryInputs) {
    getOrCreateNet(inPin);
  }

  // 1. Map gates to standard cells and track net connectivity
  for (const gate of gates) {
    const cell = SKY130_CELLS[gate.kind];
    if (!cell) throw new Error(`Unknown gate kind: ${gate.kind}`);

    const connections: Record<string, string> = { ...gate.inputs, ...gate.outputs };
    instances.push({ instanceName: gate.id, cell, connections });

    // Output pin drives net
    for (const [pinName, netName] of Object.entries(gate.outputs)) {
      const net = getOrCreateNet(netName);
      net.driver = { instanceName: gate.id, pinName };
    }

    // Input pins load net
    for (const [pinName, netName] of Object.entries(gate.inputs)) {
      const net = getOrCreateNet(netName);
      net.loads.push({ instanceName: gate.id, pinName });
      const pinSpec = cell.pins.find((p) => p.name === pinName);
      if (pinSpec) {
        net.totalLoadCapacitanceFf += pinSpec.capacitanceFf;
      }
    }
  }

  // Primary outputs load net with standard 15 fF external pad capacitance
  for (const outPin of primaryOutputs) {
    const net = getOrCreateNet(outPin);
    net.totalLoadCapacitanceFf += 15.0; // 15 fF standard output pad load
  }

  // 2. Compute physical metrics
  let totalArea = 0;
  let totalLeakagePw = 0;
  let totalDynPowerFwPerMhz = 0;

  for (const inst of instances) {
    totalArea += inst.cell.widthUm * inst.cell.heightUm;
    totalLeakagePw += inst.cell.leakagePowerPw;
    totalDynPowerFwPerMhz += inst.cell.dynamicPowerFwPerMhz;
  }

  // Dynamic power: P = C * V^2 * f = sum(dyn_fw_mhz) * f_mhz * 1e-15 W
  const dynPowerW = totalDynPowerFwPerMhz * clockFreqMhz * 1e-15;
  const dynPowerMw = dynPowerW * 1e3;
  const leakageUw = totalLeakagePw * 1e-6;

  // 3. Static Timing Analysis (STA): Topological forward traversal
  const arrivalTimesPs = new Map<string, number>(); // netName -> arrival time
  for (const inPin of primaryInputs) {
    arrivalTimesPs.set(inPin, 0); // Primary inputs arrive at t=0
  }

  // Iterate to propagate delays until convergence (DAG)
  let updated = true;
  let iterations = 0;
  const maxIterations = gates.length * 2;

  while (updated && iterations < maxIterations) {
    updated = false;
    iterations += 1;

    for (const inst of instances) {
      // Find latest arrival time of inputs
      let maxInputTime = 0;
      let allInputsReady = true;

      for (const pin of inst.cell.pins) {
        if (pin.direction === 'input') {
          const netName = inst.connections[pin.name];
          if (!netName || !arrivalTimesPs.has(netName)) {
            allInputsReady = false;
            break;
          }
          const t = arrivalTimesPs.get(netName)!;
          if (t > maxInputTime) maxInputTime = t;
        }
      }

      if (!allInputsReady) continue;

      // Calculate output net delay
      for (const pin of inst.cell.pins) {
        if (pin.direction === 'output') {
          const netName = inst.connections[pin.name];
          if (!netName) continue;
          const net = nets.get(netName);
          const loadCap = net ? net.totalLoadCapacitanceFf : 0;
          const stageDelay = calculateCellDelayPs(inst.cell, loadCap);
          const outputArrivalTime = maxInputTime + stageDelay;

          const currentT = arrivalTimesPs.get(netName) ?? -1;
          if (outputArrivalTime > currentT) {
            arrivalTimesPs.set(netName, outputArrivalTime);
            updated = true;
          }
        }
      }
    }
  }

  // Find critical path among primary outputs and internal DFF data inputs
  let maxPathDelayPs = 0;
  let worstNet = '';

  for (const outNet of primaryOutputs) {
    const t = arrivalTimesPs.get(outNet) ?? 0;
    if (t > maxPathDelayPs) {
      maxPathDelayPs = t;
      worstNet = outNet;
    }
  }

  // Also check D inputs of flip flops
  for (const inst of instances) {
    if (inst.cell.kind === 'DFF') {
      const dNet = inst.connections['D'];
      if (dNet) {
        const t = arrivalTimesPs.get(dNet) ?? 0;
        if (t > maxPathDelayPs) {
          maxPathDelayPs = t;
          worstNet = dNet;
        }
      }
    }
  }

  // Maximum clock frequency F_max = 1 / (T_crit + T_setup)
  const setupTimePs = 50; // 50 ps setup margin
  const clockPeriodPs = maxPathDelayPs + setupTimePs;
  const maxFreqMhz = clockPeriodPs > 0 ? (1e12 / clockPeriodPs) / 1e6 : 1000;

  return {
    name: moduleName,
    instances,
    nets,
    primaryInputs,
    primaryOutputs,
    metrics: {
      gateCount: instances.length,
      totalCellAreaUm2: Number(totalArea.toFixed(2)),
      totalLeakagePowerUw: Number(leakageUw.toFixed(4)),
      estimatedDynamicPowerMwAt100Mhz: Number(dynPowerMw.toFixed(4)),
      criticalPathDelayPs: Math.round(maxPathDelayPs),
      maxOperatingFreqMhz: Math.round(maxFreqMhz),
      criticalPath: [worstNet],
    },
  };
}
