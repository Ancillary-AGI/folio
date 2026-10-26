/**
 * Domain switch for the autopilot surface.
 *
 * Both panels stay mounted so a gallery demo can bootstrap the mechanical tab
 * while it is hidden, and so switching domains never discards a measured run.
 */
import { useState } from 'react'
import { Box, CircuitBoard } from 'lucide-react'
import AutopilotWorkbench from './AutopilotWorkbench'
import MechanicalSizingPanel from './MechanicalSizingPanel'
import type { AgentSession } from '../../../lib/agents/agentSession'

type AutopilotMode = 'circuit' | 'mechanical'

interface AutopilotWorkspaceProps {
  onSessionSaved?: (session: AgentSession) => void
}

const MODES: ReadonlyArray<{ id: AutopilotMode; label: string; icon: typeof Box }> = [
  { id: 'circuit', label: 'Circuit autopilot', icon: CircuitBoard },
  { id: 'mechanical', label: 'Mechanical sizing', icon: Box },
]

export default function AutopilotWorkspace({ onSessionSaved }: AutopilotWorkspaceProps) {
  const [mode, setMode] = useState<AutopilotMode>('circuit')

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Autopilot domain"
        className="flex items-center gap-1 border-b border-border bg-card/60 px-2 py-1.5"
      >
        {MODES.map((entry) => {
          const Icon = entry.icon
          const active = mode === entry.id
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`autopilot-domain-${entry.id}`}
              onClick={() => setMode(entry.id)}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                active
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
              }`}
            >
              <Icon size={12} />
              {entry.label}
            </button>
          )
        })}
        <span className="ml-auto pr-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          Closed loop · local
        </span>
      </div>

      <div
        role="tabpanel"
        id="autopilot-domain-circuit"
        aria-label="Circuit autopilot"
        className={mode === 'circuit' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
      >
        <AutopilotWorkbench
          onSessionSaved={onSessionSaved}
          onActivate={() => setMode('circuit')}
        />
      </div>
      <div
        role="tabpanel"
        id="autopilot-domain-mechanical"
        aria-label="Mechanical sizing"
        className={mode === 'mechanical' ? 'flex min-h-0 flex-1 flex-col' : 'hidden'}
      >
        <MechanicalSizingPanel
          onSessionSaved={onSessionSaved}
          onActivate={() => setMode('mechanical')}
        />
      </div>
    </div>
  )
}
