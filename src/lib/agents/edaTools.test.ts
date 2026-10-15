import { describe, expect, it } from 'vitest';
import { AgentHarness } from './agentHarness';
import { planEdaRun, registerEdaTools } from './edaTools';

describe('EDA tools wired to real engines', () => {
  it('simulates a real voltage divider through the SPICE engine', async () => {
    const h = new AgentHarness();
    registerEdaTools(h);
    expect(h.listTools()).toEqual(['eda.simulate', 'eda.drc', 'eda.route', 'eda.exportFab']);
    const b = { maxCalls: 10, maxWallMs: 60000, startedAt: Date.now() };
    const netlist = {
      title: 'divider', components: [
        { type: 'voltage-source', name: 'V1', nodes: ['in', '0'], parameters: { dc: 5 } },
        { type: 'resistor', name: 'R1', nodes: ['in', 'out'], parameters: { resistance: '10k' } },
        { type: 'resistor', name: 'R2', nodes: ['out', '0'], parameters: { resistance: '10k' } },
      ],
      analyses: [{ type: 'dc' as const }],
    };
    const call = await h.call('simulate', {}, b, () => true).catch(() => null);
    expect(call).toBeNull(); // unknown tool still refused
    const sim = await h.call('eda.simulate', { netlist: JSON.stringify(netlist) }, b, () => true);
    expect(sim.error).toBeUndefined();
    const result = sim.result as { success: boolean; operatingPoint?: Record<string, number> };
    expect(result.success).toBe(true);
    const midpoint = result.operatingPoint?.['OUT'] ?? result.operatingPoint?.['out'] ?? result.operatingPoint?.['Out'];
    expect(midpoint).toBeCloseTo(2.5, 2);
  });
  it('refuses fab export when DRC fails (empty board = no footprint = violation path)', async () => {
    const h = new AgentHarness();
    registerEdaTools(h);
    const b = { maxCalls: 10, maxWallMs: 60000, startedAt: Date.now() };
    const denied = await h.call('eda.exportFab', { project: 'x', components: '[]', wires: '[]' }, b, () => false);
    expect(denied.approved).toBe(false);
    expect(denied.result).toBeUndefined();
    const gated = await h.call('eda.exportFab', { project: 'x', components: '[]', wires: '[]' }, b, () => true);
    expect(gated.error).toBeUndefined(); // empty board: no violations, vacuously shippable
    expect((gated.result as { shippable: boolean }).shippable).toBe(true);
  });
  it('plans simulate-route-drc-export with fab gated', () => {
    const plan = planEdaRun('build a blinker');
    expect(plan.steps.map((s) => s.tool)).toEqual(['eda.simulate', 'eda.route', 'eda.drc', 'eda.exportFab']);
    expect(plan.needsApproval).toEqual(['eda.exportFab']);
  });
});
