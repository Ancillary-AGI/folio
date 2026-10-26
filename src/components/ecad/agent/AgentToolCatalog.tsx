/**
 * Tool catalog — the agent's actual capability surface, rendered from the
 * registered tool definitions rather than a hand-maintained doc that drifts.
 * An engineer can see exactly what an agent may call, which parameters are
 * required, and which calls need human approval.
 */
import { useMemo } from 'react'
import { ShieldCheck, Wrench } from 'lucide-react'
import { createCadToolset } from '../../../lib/agents/cadTools'
import { createMemoryCadRuntime } from '../../../lib/agents/cadRuntime'
import { edaTools } from '../../../lib/agents/edaTools'
import { mechanicalTools } from '../../../lib/agents/mechanicalTools'
import type { AgentTool } from '../../../lib/agents/agentHarness'

interface ToolRow {
  tool: AgentTool
  group: 'CAD' | 'MECH' | 'EDA'
}

const GROUP_NOTES: Record<ToolRow['group'], string> = {
  CAD: 'Operate the live schematic: observe, edit, wire, simulate, assess, verify, export.',
  MECH: 'Operate the live mechanical assembly: observe, add or reshape parts, set supports and loads, analyse beams, and size a part under declared limits.',
  EDA: 'Board-level flow: SPICE, DRC, schematic-to-PCB routing, fabrication export.',
}

export default function AgentToolCatalog() {
  const tools = useMemo<ToolRow[]>(() => {
    const cad = createCadToolset(createMemoryCadRuntime()).tools.map((tool) => ({ tool, group: 'CAD' as const }))
    const mech = mechanicalTools().map((tool) => ({ tool, group: 'MECH' as const }))
    const eda = edaTools().map((tool) => ({ tool, group: 'EDA' as const }))
    return [...cad, ...mech, ...eda]
  }, [])

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      <p className="text-xs text-muted-foreground">
        {tools.length} registered tools. Every call is budgeted and recorded in the audit trail;
        calls marked with a shield need human approval first.
      </p>
      {(['CAD', 'MECH', 'EDA'] as const).map((group) => (
        <section key={group} className="rounded-lg border border-border bg-card p-3" aria-labelledby={`tools-${group}`}>
          <h3 id={`tools-${group}`} className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Wrench size={13} /> {group}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{GROUP_NOTES[group]}</p>
          <ul className="mt-2 space-y-1.5">
            {tools.filter((row) => row.group === group).map(({ tool }) => {
              const required = Object.keys(tool.parameters).filter(
                (key) => !tool.optionalParameters?.includes(key),
              )
              const optional = Object.keys(tool.parameters).filter(
                (key) => tool.optionalParameters?.includes(key),
              )
              return (
                <li key={tool.name} className="rounded-md border border-border bg-background px-2 py-1.5">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <code className="font-mono text-xs text-primary">{tool.name}</code>
                    {tool.needsApproval && (
                      <span className="inline-flex items-center gap-0.5 rounded bg-warning/15 px-1 text-xs text-warning">
                        <ShieldCheck size={10} /> approval
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    {required.length > 0 ? required.join(', ') : 'no required parameters'}
                    {optional.length > 0 ? ` · optional: ${optional.join(', ')}` : ''}
                  </p>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
