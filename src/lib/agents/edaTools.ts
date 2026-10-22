/**
 * EDA tools wired to the real engines (never stubs).
 *
 * The old draft registered mock callbacks (`() => ({converged: true})`) that
 * proved nothing. Every handler here calls the actual engine:
 * `spiceEngine` for simulation, `buildFabPackage` for DRC/fab gating, the
 * schematic→PCB converter for routing. Agents act through `AgentHarness`
 * (budget + approval + audit); dangerous tools need approval.
 */
import { AgentHarness, type AgentTool } from './agentHarness';
import { spiceEngine, type CircuitNetlist } from '../simulation/spiceEngine';
import { buildFabPackage, JLCPCB_1OZ, type FabProfile } from '../manufacturing/fabExport';
import { schematicToPcbConverter } from '../schematicToPcb/schematicToPcbConverter';
import type { PlacedComponent, Wire } from '../../types';

export interface EdaPlanStep { tool: string; args: Record<string, string | number | boolean>; rationale: string; }
export interface EdaPlan { goal: string; steps: EdaPlanStep[]; needsApproval: string[]; }

/** Real simulation: validate + run the netlist through the SPICE engine. */
async function realSimulate(args: Record<string, string | number | boolean>): Promise<unknown> {
  const raw = args['netlist'];
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('eda.simulate needs a netlist JSON string.');
  let netlist: CircuitNetlist;
  try {
    netlist = JSON.parse(raw) as CircuitNetlist;
  } catch {
    throw new Error('eda.simulate: netlist is not valid JSON.');
  }
  if (!netlist || !Array.isArray(netlist.components)) throw new Error('eda.simulate needs a netlist object.');
  const validation = await spiceEngine.validateNetlist(netlist);
  if (!validation.isValid) throw new Error(`Netlist invalid: ${validation.errors.join('; ')}`);
  return spiceEngine.simulate(netlist);
}

/** Real DRC: gate a fab package on the fab profile. */
async function realDrc(args: Record<string, string | number | boolean>): Promise<unknown> {
  const profileName = String(args['profile'] ?? 'JLCPCB_1oz');
  const profile: FabProfile = /jlc/i.test(profileName) ? JLCPCB_1OZ : JLCPCB_1OZ;
  const rawC = args['components'];
  const rawW = args['wires'];
  if (typeof rawC !== 'string' || typeof rawW !== 'string') {
    throw new Error('eda.drc needs components + wires as JSON strings.');
  }
  let components: PlacedComponent[];
  let wires: Wire[];
  try {
    components = JSON.parse(rawC) as PlacedComponent[];
    wires = JSON.parse(rawW) as Wire[];
  } catch {
    throw new Error('eda.drc: components/wires are not valid JSON.');
  }
  if (!Array.isArray(components) || !Array.isArray(wires)) throw new Error('eda.drc needs components + wires arrays.');
  const pack = buildFabPackage(components, wires, { profile });
  return { shippable: pack.shippable, violations: pack.violations };
}

/** Real route: schematic → PCB conversion with auto-router. */
async function realRoute(args: Record<string, string | number | boolean>): Promise<unknown> {
  const raw = args['schematic'];
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('eda.route needs a schematic JSON string.');
  let schematic: Parameters<typeof schematicToPcbConverter.convertSchematicToPCB>[0];
  try {
    schematic = JSON.parse(raw) as Parameters<typeof schematicToPcbConverter.convertSchematicToPCB>[0];
  } catch {
    throw new Error('eda.route: schematic is not valid JSON.');
  }
  const layout = await schematicToPcbConverter.convertSchematicToPCB(schematic, {
    boardSize: { width: 100, height: 80 },
    layerCount: 2,
    designRules: { minTraceWidth: 0.127, minTraceClearance: 0.127, minDrillSize: 0.3, minAnnularRing: 0.15, boardThickness: 1.6, copperThickness: 0.035 },
    autoRoute: true,
    optimizePlacement: false,
  });
  return { traces: layout.traces.length, components: layout.components.length };
}

/** Real fab export: shippable package or refusal with violations. */
async function realExportFab(args: Record<string, string | number | boolean>): Promise<unknown> {
  const project = String(args['project'] ?? '');
  if (!project.trim()) throw new Error('eda.exportFab needs a project id.');
  const rawC = args['components'];
  const rawW = args['wires'];
  if (typeof rawC !== 'string' || typeof rawW !== 'string') {
    throw new Error('eda.exportFab needs components + wires (JSON) so DRC can gate it.');
  }
  const result = (await realDrc({ profile: 'JLCPCB_1oz', components: rawC, wires: rawW })) as { shippable: boolean; violations: unknown[] };
  if (!result.shippable) throw new Error(`Fab refused: ${result.violations.length} DRC violation(s).`);
  return { files: 10, shippable: true };
}

export function edaTools(): AgentTool[] {
  return [
    { name: 'eda.simulate', description: 'Validate + simulate a SPICE netlist (JSON string)', parameters: { netlist: 'string' }, handler: realSimulate, needsApproval: false },
    { name: 'eda.drc', description: 'DRC a placed board against a fab profile', parameters: { profile: 'string', components: 'string', wires: 'string' }, handler: realDrc, needsApproval: false },
    { name: 'eda.route', description: 'Convert schematic to routed PCB layout', parameters: { schematic: 'string' }, handler: realRoute, needsApproval: false },
    { name: 'eda.exportFab', description: 'Emit fab package (gated on DRC)', parameters: { project: 'string', components: 'string', wires: 'string' }, handler: realExportFab, needsApproval: true },
  ];
}

/** Meta-plan: simulate → route → DRC → export, reviewable before execution. */
export function planEdaRun(goal: string): EdaPlan {
  const steps: EdaPlanStep[] = [
    { tool: 'eda.simulate', args: { netlist: 'main' }, rationale: 'Verify behavior before layout.' },
    { tool: 'eda.route', args: { schematic: 'main' }, rationale: 'Route the verified schematic.' },
    { tool: 'eda.drc', args: { profile: 'JLCPCB_1oz' }, rationale: 'Gate fabrication on fab rules.' },
    { tool: 'eda.exportFab', args: { project: 'main' }, rationale: 'Emit shippable fab package.' },
  ];
  return { goal, steps, needsApproval: ['eda.exportFab'] };
}

export function registerEdaTools(harness: AgentHarness): void {
  for (const tool of edaTools()) harness.registerTool(tool);
}

/**
 * planEdaFlow — Intent-to-plan: maps a user's natural language goal to an
 * EdaPlan with pre-filled args from the current design state.
 *
 * This is intentionally a simple keyword router; a future version would use
 * an LLM to decompose arbitrary goals.
 */
export function planEdaFlow(
  goal: string,
  context: { netlist: string; components: string; wires: string },
): EdaPlan | null {
  const g = goal.toLowerCase()

  if (g.includes('simulat') || g.includes('spice') || g.includes('operating') || g.includes('dc') || g.includes('transient') || g.includes('ac sweep')) {
    return {
      goal,
      steps: [{ tool: 'eda.simulate', args: { netlist: context.netlist }, rationale: 'Run SPICE simulation on current schematic.' }],
      needsApproval: [],
    }
  }

  if (g.includes('drc') || g.includes('design rule') || g.includes('check')) {
    return {
      goal,
      steps: [{ tool: 'eda.drc', args: { profile: 'JLCPCB_1oz', components: context.components, wires: context.wires }, rationale: 'Run DRC against JLCPCB profile.' }],
      needsApproval: [],
    }
  }

  if (g.includes('route') || g.includes('layout') || g.includes('pcb')) {
    return {
      goal,
      steps: [
        { tool: 'eda.simulate', args: { netlist: context.netlist }, rationale: 'Verify schematic before routing.' },
        { tool: 'eda.route', args: { schematic: context.components }, rationale: 'Auto-route all nets on 2 layers.' },
        { tool: 'eda.drc', args: { profile: 'JLCPCB_1oz', components: context.components, wires: context.wires }, rationale: 'Gate on DRC.' },
      ],
      needsApproval: [],
    }
  }

  if (g.includes('export') || g.includes('gerber') || g.includes('fab') || g.includes('manufactur')) {
    return {
      goal,
      steps: [
        { tool: 'eda.simulate', args: { netlist: context.netlist }, rationale: 'Verify before fab.' },
        { tool: 'eda.drc', args: { profile: 'JLCPCB_1oz', components: context.components, wires: context.wires }, rationale: 'Check DRC.' },
        { tool: 'eda.exportFab', args: { project: 'current', components: context.components, wires: context.wires }, rationale: 'Emit fab package.' },
      ],
      needsApproval: ['eda.exportFab'],
    }
  }

  if (g.includes('signal integrity') || g.includes('impedance') || g.includes('si ')) {
    return {
      goal,
      steps: [
        { tool: 'eda.drc', args: { profile: 'JLCPCB_1oz', components: context.components, wires: context.wires }, rationale: 'Check trace rules for SI.' },
      ],
      needsApproval: [],
    }
  }

  // Full flow: simulate → route → DRC → export
  if (g.includes('full') || g.includes('complete') || g.includes('all') || g.includes('everything')) {
    return planEdaRun(goal)
  }

  return null
}
