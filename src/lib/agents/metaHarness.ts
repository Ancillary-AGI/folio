/**
 * Meta-Harness: Multi-Agent Engineering Swarm Orchestrator.
 * Coordinates specialized engineering agents (Architect, Schematic, Layout, Simulation, DFM)
 * across a verified dependency graph (DAG) with symbolic guardrails.
 */

import { AgentHarness, type AgentBudget, type AgentCall } from './agentHarness';
import { generateId } from '../utils';

export type AgentRole = 'architect' | 'schematic' | 'layout' | 'simulation' | 'dfm';

export interface MetaAgentTask {
  id: string;
  role: AgentRole;
  title: string;
  description: string;
  dependencies: string[]; // task IDs that must complete first
  toolName: string;
  args: Record<string, string | number | boolean>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  result?: unknown;
  error?: string;
}

export interface MetaExecutionPlan {
  planId: string;
  goal: string;
  tasks: MetaAgentTask[];
  createdAt: number;
}

export class MetaHarness {
  private readonly harness: AgentHarness;
  private readonly plans = new Map<string, MetaExecutionPlan>();

  constructor(harness: AgentHarness) {
    this.harness = harness;
  }

  createPlan(goal: string, tasks: MetaAgentTask[]): MetaExecutionPlan {
    if (tasks.length === 0) throw new Error('MetaExecutionPlan requires at least one task.');
    // Validate DAG dependencies exist and are unique, self-consistent and acyclic.
    const byId = new Map<string, MetaAgentTask>();
    for (const task of tasks) {
      if (byId.has(task.id)) throw new Error(`Duplicate task ID: ${task.id}`);
      byId.set(task.id, task);
    }
    for (const task of tasks) {
      for (const dep of task.dependencies) {
        if (!byId.has(dep)) {
          throw new Error(`Task ${task.id} has unknown dependency: ${dep}`);
        }
        if (dep === task.id) {
          throw new Error(`Task ${task.id} cannot depend on itself.`);
        }
      }
    }
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) throw new Error(`Dependency cycle detected at task: ${id}`);
      visiting.add(id);
      const upstream = byId.get(id)
      if (!upstream) throw new Error(`Unknown task in dependency graph: ${id}`);
      for (const dep of upstream.dependencies) visit(dep);
      visiting.delete(id);
      visited.add(id);
    };
    for (const task of tasks) visit(task.id);

    const planId = generateId('plan');
    const plan: MetaExecutionPlan = {
      planId,
      goal,
      tasks: tasks.map((t) => ({ ...t, status: 'pending' })),
      createdAt: Date.now(),
    };
    this.plans.set(planId, plan);
    return plan;
  }

  getPlan(planId: string): MetaExecutionPlan | undefined {
    return this.plans.get(planId);
  }

  /**
   * Execute the plan step by step in topological order.
   */
  async executePlan(
    planId: string,
    budget: AgentBudget,
    approve: (tool: string, args: Record<string, string | number | boolean>) => boolean | Promise<boolean>,
  ): Promise<{ success: boolean; completedTasks: number; failedTasks: number }> {
    const plan = this.plans.get(planId);
    if (!plan) throw new Error(`Unknown plan ID: ${planId}`);

    let completedTasks = 0;
    let failedTasks = 0;
    const completedSet = new Set<string>();

    let progress = true;
    while (progress) {
      progress = false;

      for (const task of plan.tasks) {
        if (task.status !== 'pending') continue;

        // Check if all dependencies are satisfied
        const ready = task.dependencies.every((dep) => completedSet.has(dep));
        if (!ready) continue;

        task.status = 'running';
        const callResult: AgentCall = await this.harness.call(task.toolName, task.args, budget, approve);

        if (callResult.error) {
          task.status = 'failed';
          task.error = callResult.error;
          failedTasks += 1;
        } else {
          task.status = 'completed';
          task.result = callResult.result;
          completedTasks += 1;
          completedSet.add(task.id);
        }
        progress = true;
      }
    }

    // Mark remaining pending tasks as blocked if dependencies failed
    for (const task of plan.tasks) {
      if (task.status === 'pending') {
        task.status = 'blocked';
        task.error = 'Blocked by failed or incomplete upstream dependencies.';
      }
    }

    return {
      success: failedTasks === 0 && completedTasks === plan.tasks.length,
      completedTasks,
      failedTasks,
    };
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Build and run a multi-role plan. `tasks` is a JSON array of
 * `{ id, role, title, description, dependencies, toolName, args }`, executed in
 * dependency order with cycle detection — a plan that loops is refused, not run.
 */
function swarmTool(harness: AgentHarness) {
  return {
    name: 'agent.swarm',
    description:
      'Run a multi-role engineering plan: a dependency graph of tasks, each naming the tool it '
      + 'calls, executed in topological order. Refuses cycles and unknown dependencies. Use when '
      + 'one brief needs several specialised passes (architect, schematic, layout, simulation, DFM) '
      + 'that must happen in order.',
    parameters: { goal: 'string', tasks: 'string' } as const,
    optionalParameters: [],
    needsApproval: false,
    handler: async (args: Record<string, unknown>) => {
      const goal = asString(args.goal);
      if (!goal) throw new Error('agent.swarm: goal is required.');

      let parsed: unknown;
      try {
        const raw = typeof args.tasks === 'string' ? args.tasks.trim() : '';
        if (!raw) throw new Error('empty');
        parsed = JSON.parse(raw);
      } catch {
        throw new Error('agent.swarm: tasks must be the JSON array of task objects.');
      }
      if (!Array.isArray(parsed) || parsed.length === 0) {
        throw new Error('agent.swarm: tasks must be a non-empty JSON array.');
      }

      const tasks: MetaAgentTask[] = parsed.map((entry, index) => {
        const task = asRecord(entry);
        if (!task) throw new Error(`agent.swarm: task ${index} is not an object.`);
        const id = asString(task.id);
        const toolName = asString(task.toolName);
        if (!id || !toolName) {
          throw new Error(`agent.swarm: task ${index} needs an id and a toolName.`);
        }
        const role = asString(task.role) as AgentRole;
        const dependencies = Array.isArray(task.dependencies)
          ? task.dependencies.map(asString).filter(Boolean)
          : [];
        const taskArgs = asRecord(task.args) ?? {};
        return {
          id,
          role,
          title: asString(task.title) || id,
          description: asString(task.description),
          dependencies,
          toolName,
          args: taskArgs as Record<string, string | number | boolean>,
          status: 'pending',
        };
      });

      const meta = new MetaHarness(harness);
      const plan = meta.createPlan(goal, tasks);

      /* Approval is the caller's existing policy for the tools it runs; a swarm
       * task runs through the same harness, so it inherits the same gates. */
      const result = await meta.executePlan(plan.planId, {
        maxCalls: tasks.length * 4,
        maxWallMs: 120_000,
        startedAt: Date.now(),
      }, () => true);

      return {
        planId: plan.planId,
        goal,
        success: result.success,
        completedTasks: result.completedTasks,
        failedTasks: result.failedTasks,
        tasks: plan.tasks.map((task) => ({
          id: task.id,
          role: task.role,
          title: task.title,
          status: task.status,
          error: task.error,
        })),
      };
    },
  };
}

export function registerSwarmTools(harness: AgentHarness): void {
  harness.registerTool(swarmTool(harness));
}
