import { describe, expect, it } from 'vitest';
import { AgentHarness } from './agentHarness';

const budget = () => ({ maxCalls: 10, maxWallMs: 60_000, startedAt: Date.now() });
const allow = () => true;
const deny = () => false;

describe('agent harness', () => {
  it('runs a registered tool and audits the call', async () => {
    const harness = new AgentHarness();
    harness.registerTool({
      name: 'simulate', description: 'run sim', parameters: { netlist: 'string' },
      handler: () => ({ converged: true }), needsApproval: false,
    });
    const call = await harness.call('simulate', { netlist: 'R1 1 0 1k' }, budget(), allow);
    expect(call.approved).toBe(true);
    expect(call.result).toEqual({ converged: true });
    expect(harness.auditTrail()).toHaveLength(1);
    expect(harness.auditTrail()[0].seq).toBe(1);
  });
  it('gates dangerous tools on approval and refuses unknown tools', async () => {
    const harness = new AgentHarness();
    harness.registerTool({
      name: 'flash', description: 'write hw', parameters: {},
      handler: () => 'wrote', needsApproval: true,
    });
    const denied = await harness.call('flash', {}, budget(), deny);
    expect(denied.approved).toBe(false);
    expect(denied.result).toBeUndefined();
    await expect(harness.call('nope', {}, budget(), allow)).rejects.toThrow(/Unknown agent tool/);
  });
  it('enforces budgets and validates arguments', async () => {
    const harness = new AgentHarness();
    harness.registerTool({
      name: 't', description: 't', parameters: { x: 'number' },
      handler: () => 1, needsApproval: false,
    });
    await expect(harness.call('t', {}, budget(), allow)).rejects.toThrow(/missing parameter/);
    await expect(harness.call('t', { x: 's' }, budget(), allow)).rejects.toThrow(/must be number/);
    await expect(harness.call('t', { x: 1 }, { maxCalls: 0, maxWallMs: 1000, startedAt: Date.now() }, allow)).rejects.toThrow(/exhausted/);
    await expect(harness.call('t', { x: 1 }, { maxCalls: 10, maxWallMs: -1, startedAt: Date.now() }, allow)).rejects.toThrow(/wall time/);
  });
  it('records tool errors instead of throwing', async () => {
    const harness = new AgentHarness();
    harness.registerTool({
      name: 'boom', description: 'fails', parameters: {},
      handler: () => { throw new Error('kaput'); }, needsApproval: false,
    });
    const call = await harness.call('boom', {}, budget(), allow);
    expect(call.error).toBe('kaput');
  });
});
