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
      for (const dep of byId.get(id)!.dependencies) visit(dep);
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
