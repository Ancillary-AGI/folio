/**
 * Futuristic Omnibar & Agent Command Capsule
 *
 * Modernized top navigation search with natural language prompt processing,
 * fast domain switching, component/net spotlight search, and one-click agent triggers.
 */
import { useState, useRef, useEffect, useMemo } from 'react'
import {
  Activity,
  Box,
  Cable,
  CircuitBoard,
  CornerDownLeft,
  Cpu,
  Search,
  Sparkles,
} from 'lucide-react'
import { useAppStore } from '../../stores/useAppStore'
import { useProjectStore } from '../../stores/useProjectStore'
import { WORKSPACE_MODES } from '../../lib/workspace/modes'

interface FuturisticOmnibarProps {
  onOpenDemos: () => void
  onOpenHelp: () => void
}

export default function FuturisticOmnibar({ onOpenDemos: _onOpenDemos, onOpenHelp: _onOpenHelp }: FuturisticOmnibarProps) {
  const {
    setWorkspaceMode,
    setCopilotFlyoutOpen,
    setSelectedComponents,
    requestComponentFocus,
    selectNet,
    requestNetFocus,
  } = useAppStore()

  const { components, wires } = useProjectStore()

  const [query, setQuery] = useState('')
  const [isOpen, setIsOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Close when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setIsOpen((prev) => !prev)
        if (!isOpen) {
          setTimeout(() => inputRef.current?.focus(), 50)
        }
      } else if (e.key === 'Escape' && isOpen) {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  // Filter items matching query
  const searchResults = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase().trim()

    const results: Array<{
      id: string
      label: string
      type: 'domain' | 'component' | 'net' | 'agent'
      hint: string
      action: () => void
    }> = []

    // 1. Workspaces
    WORKSPACE_MODES.filter(
      (m) => m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    ).forEach((m) => {
      results.push({
        id: `mode-${m.id}`,
        label: `Switch to ${m.label}`,
        type: 'domain',
        hint: m.description,
        action: () => {
          setWorkspaceMode(m.id)
          setIsOpen(false)
        },
      })
    })

    // 2. Components
    components
      .filter(
        (c) =>
          c.reference.toLowerCase().includes(q) ||
          c.component.name.toLowerCase().includes(q) ||
          (c.properties.value && String(c.properties.value).toLowerCase().includes(q)),
      )
      .slice(0, 6)
      .forEach((c) => {
        results.push({
          id: `comp-${c.id}`,
          label: `${c.reference} • ${c.component.name}`,
          type: 'component',
          hint: `${c.properties.value ? `Value: ${c.properties.value} • ` : ''}Position (${Math.round(c.x)}, ${Math.round(c.y)})`,
          action: () => {
            setWorkspaceMode('schematic')
            setSelectedComponents([c.id])
            requestComponentFocus(c.id)
            setIsOpen(false)
          },
        })
      })

    // 3. Nets
    const uniqueNets = Array.from(new Set(wires.map((w) => w.netName).filter(Boolean))) as string[]
    uniqueNets
      .filter((n) => n.toLowerCase().includes(q))
      .slice(0, 5)
      .forEach((netName) => {
        results.push({
          id: `net-${netName}`,
          label: `Net: ${netName}`,
          type: 'net',
          hint: 'Select and inspect net copper on canvas',
          action: () => {
            setWorkspaceMode('schematic')
            selectNet({ name: netName })
            requestNetFocus(netName)
            setIsOpen(false)
          },
        })
      })

    // 4. Copilot prompt trigger
    results.push({
      id: 'ask-copilot',
      label: `Ask Copilot: "${query}"`,
      type: 'agent',
      hint: 'Run through System 1 reflex & System 2 deliberate planner',
      action: () => {
        setCopilotFlyoutOpen(true)
        setIsOpen(false)
      },
    })

    return results
  }, [
    query,
    components,
    wires,
    setWorkspaceMode,
    setSelectedComponents,
    requestComponentFocus,
    selectNet,
    requestNetFocus,
    setCopilotFlyoutOpen,
  ])

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      {/* Capsule input */}
      <div className="relative flex items-center">
        <Search className="pointer-events-none absolute left-3 h-3.5 w-3.5 text-muted-foreground/80" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onFocus={() => setIsOpen(true)}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search parts, nets, commands, or prompt Copilot (⌘K)"
          aria-label="Search parts, nets, or prompt Copilot"
          className="h-8 w-full rounded-full border border-border/80 bg-background/80 pl-9 pr-16 text-xs text-foreground placeholder:text-muted-foreground/70 backdrop-blur-md transition-all focus:border-primary focus:bg-card focus:shadow-md focus:outline-none"
        />
        <div className="pointer-events-none absolute right-2.5 flex items-center gap-1">
          <kbd className="rounded border border-border/60 bg-muted/60 px-1.5 py-0.5 text-[9px] font-mono text-muted-foreground">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Dropdown Menu */}
      {isOpen && (
        <div className="cad-glass-panel absolute left-0 right-0 top-10 z-50 overflow-hidden rounded-xl border border-border/80 shadow-2xl backdrop-blur-2xl">
          {searchResults.length > 0 ? (
            <div className="max-h-72 overflow-y-auto py-1">
              {searchResults.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.action}
                  className="flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-xs transition-colors hover:bg-muted/60"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {item.type === 'domain' && <CircuitBoard className="h-3.5 w-3.5 flex-shrink-0 text-primary" aria-hidden="true" />}
                    {item.type === 'component' && <Cpu className="h-3.5 w-3.5 flex-shrink-0 text-amber-500" aria-hidden="true" />}
                    {item.type === 'net' && <Cable className="h-3.5 w-3.5 flex-shrink-0 text-emerald-500" aria-hidden="true" />}
                    {item.type === 'agent' && <Sparkles className="h-3.5 w-3.5 flex-shrink-0 text-purple-500 animate-spin-slow" aria-hidden="true" />}

                    <div className="min-w-0">
                      <p className="font-medium text-foreground truncate">{item.label}</p>
                      <p className="text-[10px] text-muted-foreground truncate">{item.hint}</p>
                    </div>
                  </div>
                  <CornerDownLeft className="h-3 w-3 text-muted-foreground/60 flex-shrink-0" aria-hidden="true" />
                </button>
              ))}
            </div>
          ) : query.trim() ? (
            <div className="p-4 text-center text-xs text-muted-foreground">
              <p>No direct matching objects.</p>
              <button
                type="button"
                onClick={() => {
                  setCopilotFlyoutOpen(true)
                  setIsOpen(false)
                }}
                className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/20 px-3 py-1 font-medium text-primary hover:bg-primary/30"
              >
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Ask Copilot about "{query}"
              </button>
            </div>
          ) : (
            <div className="p-3 text-xs">
              <div className="mb-2 flex items-center justify-between text-[11px] font-semibold text-muted-foreground">
                <span>Quick Actions</span>
                <span className="text-[10px] text-muted-foreground/80">Flux-Native Shortcuts</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceMode('pcb')
                    setIsOpen(false)
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <CircuitBoard className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                  <div>
                    <p className="text-[11px] font-medium text-foreground">PCB 2D Layout</p>
                    <p className="text-[9px] text-muted-foreground">Route multi-layer copper</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceMode('preview3d')
                    setIsOpen(false)
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <Box className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
                  <div>
                    <p className="text-[11px] font-medium text-foreground">3D / AR View</p>
                    <p className="text-[9px] text-muted-foreground">Photorealistic board</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setWorkspaceMode('simulation')
                    setIsOpen(false)
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <Activity className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
                  <div>
                    <p className="text-[11px] font-medium text-foreground">SPICE Analysis</p>
                    <p className="text-[9px] text-muted-foreground">DC, Transient, AC Bode</p>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setCopilotFlyoutOpen(true)
                    setIsOpen(false)
                  }}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 p-2 text-left transition-colors hover:border-primary/50 hover:bg-accent/40"
                >
                  <Sparkles className="h-3.5 w-3.5 text-purple-500" aria-hidden="true" />
                  <div>
                    <p className="text-[11px] font-medium text-foreground">OmniCopilot</p>
                    <p className="text-[9px] text-muted-foreground">AI circuit synthesis</p>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
