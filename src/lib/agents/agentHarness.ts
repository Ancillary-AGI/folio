/**
 * Agent harness — tool-call loop with budget, approval gates, and audit.
 * The CAD is AI-native: agents act through declared tools (simulate, route,
 * export, flash), never raw code. Every call is budgeted, gated, and logged.
 */

export interface AgentTool {
  name: string;
  description: string;
  parameters: Record<string, 'string' | 'number' | 'boolean'>;
  handler: (args: Record<string, string | number | boolean>) => Promise<unknown> | unknown;
  /** True when the call needs human approval before running. */
  needsApproval: boolean;
}

export interface AgentCall {
  seq: number;
  tool: string;
  args: Record<string, string | number | boolean>;
  approved: boolean;
  result?: unknown;
  error?: string;
  startedAt: number;
  endedAt: number;
}

export interface AgentBudget {
  maxCalls: number;
  maxWallMs: number;
  startedAt: number;
}

export class AgentHarness {
  private readonly tools = new Map<string, AgentTool>();
  private readonly calls: AgentCall[] = [];
  private seq = 0;

  registerTool(tool: AgentTool): void {
    if (this.tools.has(tool.name)) throw new Error(`Agent tool ${tool.name} already registered.`);
    this.tools.set(tool.name, tool);
  }

  listTools(): string[] {
    return [...this.tools.keys()];
  }

  auditTrail(): readonly AgentCall[] {
    return this.calls;
  }

  async call(
    toolName: string,
    args: Record<string, string | number | boolean>,
    budget: AgentBudget,
    approve: (tool: string, args: Record<string, string | number | boolean>) => boolean | Promise<boolean>,
  ): Promise<AgentCall> {
    const tool = this.tools.get(toolName);
    if (!tool) throw new Error(`Unknown agent tool: ${toolName}.`);
    if (this.calls.length >= budget.maxCalls) throw new Error(`Agent budget exhausted: ${budget.maxCalls} calls.`);
    if (Date.now() - budget.startedAt > budget.maxWallMs) throw new Error('Agent budget exhausted: wall time.');
    for (const [key, type] of Object.entries(tool.parameters)) {
      if (!(key in args)) throw new Error(`Agent tool ${toolName} missing parameter ${key}.`);
      if (typeof args[key] !== type) throw new Error(`Agent tool ${toolName} parameter ${key} must be ${type}.`);
    }
    const startedAt = Date.now();
    const approved = tool.needsApproval ? await approve(toolName, args) : true;
    const call: AgentCall = { seq: this.seq += 1, tool: toolName, args, approved, startedAt, endedAt: startedAt };
    if (!approved) {
      call.error = 'denied by approval gate';
      call.endedAt = Date.now();
      this.calls.push(call);
      return call;
    }
    try {
      call.result = await tool.handler(args);
    } catch (error) {
      call.error = error instanceof Error ? error.message : 'tool failed';
    }
    call.endedAt = Date.now();
    this.calls.push(call);
    return call;
  }
}
