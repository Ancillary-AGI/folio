import { describe, expect, it } from 'vitest';
import { AgentHarness } from './agentHarness';
import { MetaHarness, type MetaAgentTask } from './metaHarness';

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
});
