import { describe, expect, it } from 'vitest';
import { AgentHarness } from './agentHarness';
import { MetaHarness, registerSwarmTools, type MetaAgentTask } from './metaHarness';

const budget = () => ({ maxCalls: 50, maxWallMs: 5000, startedAt: Date.now() })
const allow = () => true

describe('Meta-Harness Multi-Agent Orchestrator', () => {
  it('executes a multi-agent engineering workflow in topological dependency order', async () => {
    const harness = new AgentHarness();

    // Register simulated EDA tools
    harness.registerTool({
      name: 'eda.architect',
      description: 'Systems design',
      parameters: { spec: 'string' },
      needsApproval: false,
      handler: () => ({ architecture: 'Blinker', mcu: 'ATmega328P' }),
    });

    harness.registerTool({
      name: 'eda.schematic',
      description: 'Schematic capture',
      parameters: { arch: 'string' },
      needsApproval: false,
      handler: () => ({ netlist: { components: 5, wires: 6 } }),
    });

    harness.registerTool({
      name: 'eda.dfm',
      description: 'DFM check and fab export',
      parameters: { netlist: 'string' },
      needsApproval: false,
      handler: () => ({ fabApproved: true }),
    });

    const meta = new MetaHarness(harness);

    const tasks: MetaAgentTask[] = [
      {
        id: 'task-1-arch',
        role: 'architect',
        title: 'Architectural Specs',
        description: 'Define system architecture',
        dependencies: [],
        toolName: 'eda.architect',
        args: { spec: 'LED Blinker' },
        status: 'pending',
      },
      {
        id: 'task-2-sch',
        role: 'schematic',
        title: 'Schematic Capture',
        description: 'Generate schematic netlist',
        dependencies: ['task-1-arch'],
        toolName: 'eda.schematic',
        args: { arch: 'Blinker' },
        status: 'pending',
      },
      {
        id: 'task-3-dfm',
        role: 'dfm',
        title: 'DFM Verification',
        description: 'Check fab rules',
        dependencies: ['task-2-sch'],
        toolName: 'eda.dfm',
        args: { netlist: 'netlist-ref' },
        status: 'pending',
      },
    ];

    const plan = meta.createPlan('Design and Verify Blinker Board', tasks);
    expect(plan.tasks.length).toBe(3);

    const budget = { maxCalls: 10, maxWallMs: 5000, startedAt: Date.now() };
    const execResult = await meta.executePlan(plan.planId, budget, () => true);

    expect(execResult.success).toBe(true);
    expect(execResult.completedTasks).toBe(3);
    expect(execResult.failedTasks).toBe(0);

    const updatedPlan = meta.getPlan(plan.planId)!;
    expect(updatedPlan.tasks.every((t) => t.status === 'completed')).toBe(true);
  });

  it('detects missing dependencies during plan creation', () => {
    const harness = new AgentHarness();
    const meta = new MetaHarness(harness);

    const badTasks: MetaAgentTask[] = [
      {
        id: 'task-1',
        role: 'schematic',
        title: 'Schematic',
        description: 'Needs unknown dep',
        dependencies: ['non-existent-task'],
        toolName: 'dummy',
        args: {},
        status: 'pending',
      },
    ];

    expect(() => meta.createPlan('Bad Plan', badTasks)).toThrow(/unknown dependency/);
  });

  it('rejects dependency cycles and duplicate task ids', () => {
    const meta = new MetaHarness(new AgentHarness());
    const task = (id: string, dependencies: string[]): MetaAgentTask => ({
      id,
      role: 'schematic',
      title: id,
      description: id,
      dependencies,
      toolName: 'dummy',
      args: {},
      status: 'pending',
    });

    expect(() =>
      meta.createPlan('Cycle', [task('a', ['b']), task('b', ['a'])]),
    ).toThrow(/cycle/);
    expect(() => meta.createPlan('Duplicate', [task('a', []), task('a', [])])).toThrow(
      /Duplicate task ID/,
    );
  });
});

describe('agent.swarm tool', () => {
  const harnessWith = (calls: string[]): AgentHarness => {
    const harness = new AgentHarness();
    harness.registerTool({
      name: 'eda.observe',
      description: 'observe',
      parameters: {},
      needsApproval: false,
      handler: () => {
        calls.push('observe');
        return { ok: true };
      },
    });
    harness.registerTool({
      name: 'cad.setProperty',
      description: 'set',
      parameters: {},
      needsApproval: false,
      handler: () => {
        calls.push('set');
        return { ok: true };
      },
    });
    harness.registerTool({
      name: 'eda.broken',
      description: 'always fails',
      parameters: {},
      needsApproval: false,
      handler: () => {
        throw new Error('tool exploded');
      },
    });
    return harness;
  };

  it('is registered on the harness', () => {
    const harness = harnessWith([]);
    registerSwarmTools(harness);
    expect(harness.listTools()).toContain('agent.swarm');
  });

  it('runs the plan in dependency order', async () => {
    const calls: string[] = [];
    const harness = harnessWith(calls);
    registerSwarmTools(harness);

    const result = (await harness.call('agent.swarm', {
      goal: 'Inspect then set',
      tasks: JSON.stringify([
        { id: 'a', role: 'schematic', title: 'A', dependencies: [], toolName: 'eda.observe', args: {} },
        { id: 'b', role: 'layout', title: 'B', dependencies: ['a'], toolName: 'cad.setProperty', args: {} },
      ]),
    }, budget(), allow)) as { result: { success: boolean; tasks: Array<{ id: string; status: string }> } };

    expect(result.result.success).toBe(true);
    // The dependency must run first, whatever order the array lists them in.
    expect(calls).toEqual(['observe', 'set']);
    expect(result.result.tasks.map((task) => task.status)).toEqual(['completed', 'completed']);
  });

  it('refuses a cyclic plan instead of running it', async () => {
    const calls: string[] = [];
    const harness = harnessWith(calls);
    registerSwarmTools(harness);

    /* The harness turns a handler throw into an error result, so the refusal is
     * read from the call rather than from a rejected promise. */
    const call = await harness.call('agent.swarm', {
      goal: 'Loop',
      tasks: JSON.stringify([
        { id: 'a', role: 'schematic', dependencies: ['b'], toolName: 'eda.observe', args: {} },
        { id: 'b', role: 'schematic', dependencies: ['a'], toolName: 'eda.observe', args: {} },
      ]),
    }, budget(), allow);

    expect(call.error).toMatch(/cycle/i);
    // Nothing ran.
    expect(calls).toEqual([]);
  });

  it('blocks downstream tasks when one fails', async () => {
    const harness = harnessWith([]);
    registerSwarmTools(harness);

    const result = (await harness.call('agent.swarm', {
      goal: 'Break',
      tasks: JSON.stringify([
        { id: 'a', role: 'dfm', title: 'A', dependencies: [], toolName: 'eda.broken', args: {} },
        { id: 'b', role: 'dfm', title: 'B', dependencies: ['a'], toolName: 'eda.observe', args: {} },
      ]),
    }, budget(), allow)) as { result: { success: boolean; completedTasks: number; failedTasks: number; tasks: Array<{ id: string; status: string; error?: string }> } };

    expect(result.result.success).toBe(false);
    expect(result.result.completedTasks).toBe(0);
    expect(result.result.tasks.find((task) => task.id === 'a')?.status).toBe('failed');
    expect(result.result.tasks.find((task) => task.id === 'b')?.status).toBe('blocked');
  });

  it('refuses malformed input rather than guessing', async () => {
    const harness = harnessWith([]);
    registerSwarmTools(harness);

    // Handler-level refusals come back as an error result.
    const badJson = await harness.call('agent.swarm', { goal: 'x', tasks: 'not json' }, budget(), allow);
    expect(badJson.error).toMatch(/JSON array/);

    const empty = await harness.call('agent.swarm', { goal: 'x', tasks: '[]' }, budget(), allow);
    expect(empty.error).toMatch(/non-empty/);

    // A missing required parameter is harness-level, so it rejects.
    await expect(harness.call('agent.swarm', { tasks: '[]' }, budget(), allow))
      .rejects.toThrow(/missing parameter goal/);
  })
});
