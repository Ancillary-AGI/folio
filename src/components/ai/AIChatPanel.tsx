import HoverHelp from '../ui/HoverHelp'
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Sparkles, Send, Trash2, Lightbulb, Cpu, Wrench, X, Mic, MicOff, Copy, Check, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import { aiService } from '../../lib/ai/aiService'
import { nlpService } from '../../lib/nlp/nlpService'
import { voiceController } from '../../lib/voice/controller'
import { useVoiceStore } from '../../stores/useVoiceStore'
import { useProjectStore } from '../../stores/useProjectStore'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { useAppStore } from '../../stores/useAppStore'
import type { AIMessage } from '../../types'
import type { Component as DomainComponent, DomainWire } from '../../types'
import { generateId } from '../../lib/utils'

interface AIChatPanelProps {
  onClose: () => void
}

type QuickAction = { label: string; prompt: string; icon: React.ReactNode }

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Analyze circuit', prompt: 'Analyze the current circuit for issues and improvements', icon: <Cpu className="w-3 h-3" /> },
  { label: 'Suggest components', prompt: 'Suggest missing components for a complete design', icon: <Lightbulb className="w-3 h-3" /> },
  { label: 'Optimize power', prompt: 'Optimize the design for lower power consumption', icon: <Wrench className="w-3 h-3" /> },
  { label: 'Review assumptions', prompt: 'List the assumptions, missing evidence, and validation steps for this design', icon: <Sparkles className="w-3 h-3" /> },
]

const toDomainComponent = (placed: CanvasComponent): DomainComponent => ({
  id: placed.componentId,
  name: placed.component.name,
  category: placed.component.category,
  description: placed.component.description,
  symbol: placed.component.symbol_data,
  pins: placed.component.pins,
  properties: placed.properties,
  datasheet: placed.component.datasheet_url,
  manufacturer: placed.component.manufacturer,
  partNumber: placed.component.part_number,
  tags: placed.component.tags,
})

const toDomainWire = (wire: CanvasWire): DomainWire => ({
  id: wire.id,
  points: wire.points,
  netName: wire.netName,
  connectedPins: wire.connectedPins,
  style: wire.style,
})

const AIChatPanel: React.FC<AIChatPanelProps> = ({ onClose }) => {
  const [messages, setMessages] = useState<AIMessage[]>([{
    id: 'welcome',
    role: 'assistant',
    content: 'Hello. I\'m Folio\'s design assistant. I can analyze the schematic, suggest components, explore trade-offs and answer engineering questions. My responses are advisory; verify designs with the workbench\'s rule checks, simulations, datasheets and manufacturing reviews.',
    timestamp: Date.now(),
    metadata: { type: 'general' },
  }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const isVoice = useVoiceStore((state) => state.listening)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const { components, wires } = useProjectStore()
  const { workspaceMode } = useAppStore()

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const addMessage = useCallback((msg: Omit<AIMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, {
      ...msg,
      id: generateId('msg'),
      timestamp: Date.now(),
    }])
  }, [])

  const processQuery = useCallback(async (query: string) => {
    if (!query.trim()) return
    setIsLoading(true)

    addMessage({ role: 'user', content: query })

    try {
      const domainComponents = components.map(toDomainComponent)
      const domainWires = wires.map(toDomainWire)
      const ctx = {
        components: domainComponents,
        wires: domainWires,
        workspaceMode,
      }

      // Route to appropriate AI service method based on intent
      const lowerQuery = query.toLowerCase()
      let responseContent = ''
      let metadata: AIMessage['metadata'] = { type: 'general' }

      if (lowerQuery.includes('analyz') || lowerQuery.includes('check') || lowerQuery.includes('issue') || lowerQuery.includes('debug')) {
        const analysis = await aiService.analyzeCircuit(
          domainComponents,
          domainWires,
          [],
        )
        responseContent = formatCircuitAnalysis(analysis)
        metadata = { type: 'circuit_analysis' }

      } else if (lowerQuery.includes('suggest') || lowerQuery.includes('recommend') || lowerQuery.includes('add') || lowerQuery.includes('need')) {
        const recs = await aiService.recommendComponents(query)
        responseContent = formatRecommendations(recs)
        metadata = { type: 'component_suggestion', components: recs.map(r => r.component) }

      } else if (lowerQuery.includes('optim') || lowerQuery.includes('improv') || lowerQuery.includes('power') || lowerQuery.includes('efficien')) {
        const result = await aiService.optimizeDesign({
          components: domainComponents,
          constraints: {},
          objectives: lowerQuery.includes('power') ? ['power'] : lowerQuery.includes('cost') ? ['cost'] : ['power', 'cost', 'performance'],
        })
        responseContent = formatOptimizationResult(result)
        metadata = { type: 'optimization' }

      } else if (lowerQuery.includes('maintenan') || lowerQuery.includes('fail') || lowerQuery.includes('reliab') || lowerQuery.includes('mtbf')) {
        const predictions = await aiService.predictMaintenance(domainComponents)
        responseContent = formatMaintenancePredictions(predictions)
        metadata = { type: 'general' }

      } else if (lowerQuery.includes('smart') || lowerQuery.includes('hint') || lowerQuery.includes('tip')) {
        const suggestions = await aiService.getSmartSuggestions({ ...ctx, currentAction: query })
        responseContent = formatSmartSuggestions(suggestions)
        metadata = { type: 'general' }

      } else {
        // General AI response via NLP + context-aware heuristics
        const nlpResult = nlpService.processCommand(query)
        responseContent = await aiService.generateContextualResponse(query, nlpResult, ctx)
        metadata = { type: 'general' }
      }

      addMessage({ role: 'assistant', content: responseContent, metadata })
    } catch (err) {
      addMessage({
        role: 'assistant',
        content: `I encountered an error processing your request: ${err instanceof Error ? err.message : 'Unknown error'}. Please try again or rephrase your question.`,
        metadata: { type: 'general' },
      })
    } finally {
      setIsLoading(false)
    }
  }, [components, wires, workspaceMode, addMessage])

  /* The launcher composer hands over the user's brief exactly once, on mount,
   * so the project it just created opens with the conversation already
   * started instead of a dead composer. */
  const pendingAssistantPrompt = useAppStore((state) => state.pendingAssistantPrompt)
  useEffect(() => {
    if (!pendingAssistantPrompt) return
    const brief = pendingAssistantPrompt
    useAppStore.getState().setPendingAssistantPrompt(null)
    void processQuery(brief)
    // Mount-only: a re-render must not re-send the brief.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSend = () => {
    const q = input.trim()
    if (!q || isLoading) return
    setInput('')
    processQuery(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleVoice = () => {
    // One conversation surface, one microphone: the mic here opens and closes
    // the shared voice conversation that also speaks its replies.
    voiceController.toggleListening()
  }

  /*
   * The check mark is a claim that the text is on the clipboard, so it appears
   * only after the write resolves. Clipboard access is denied outright in some
   * browsers and non-secure contexts; saying "copied" there would be a lie.
   *
   * Both flags are held down by one timer, because a second copy replaces the
   * first message's reset rather than queueing a stale one, and the unmount
   * clears it: a timer that outlives the panel calls setState on a dead tree.
   */
  const copyResetRef = useRef<number | null>(null)
  useEffect(() => () => {
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
  }, [])

  const scheduleCopyReset = useCallback((
    setter: React.Dispatch<React.SetStateAction<string | null>>,
    id: string,
    afterMs: number,
  ) => {
    if (copyResetRef.current !== null) window.clearTimeout(copyResetRef.current)
    copyResetRef.current = window.setTimeout(() => {
      copyResetRef.current = null
      setter((current) => (current === id ? null : current))
    }, afterMs)
  }, [])

  const handleCopy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setCopiedId(id)
      scheduleCopyReset(setCopiedId, id, 1500)
    } catch {
      setCopyFailedId(id)
      scheduleCopyReset(setCopyFailedId, id, 2500)
    }
  }

  const clearChat = () => {
    setMessages([{
      id: 'welcome-reset',
      role: 'assistant',
      content: 'Chat cleared. How can I help you with your engineering design?',
      timestamp: Date.now(),
      metadata: { type: 'general' },
    }])
  }

  return (
    <div className="flex h-full flex-col bg-card">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border/60 bg-surface/70 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-primary/25 bg-primary/10"
            style={{ boxShadow: '0 0 18px -8px hsl(var(--primary) / 0.65)' }}>
            <span className="agent-orb" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold leading-tight tracking-tight">Design assistant</h2>
              <span className="rounded border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-primary">
                Agent
              </span>
            </div>
            <p className="mt-1 truncate text-[11px] capitalize leading-tight text-muted-foreground">
              {workspaceMode} workspace Â· schematic context attached
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <HoverHelp title="Clear conversation" description="Clear conversation">
<Button variant="ghost" size="bar-icon" onClick={clearChat} aria-label="Clear conversation">
            <Trash2 />
          </Button>
</HoverHelp>
          <HoverHelp title="Close the assistant panel" description="Close the assistant panel">
<Button variant="ghost" size="bar-icon" onClick={onClose} aria-label="Close AI assistant">
            <X />
          </Button>
</HoverHelp>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex shrink-0 flex-wrap gap-1.5 border-b border-border/60 bg-surface/30 px-3 py-2.5">
        {QUICK_ACTIONS.map(qa => (
          <button
            key={qa.label}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-full border border-border/70 bg-background/50 px-2.5 py-1 text-[11px] font-medium text-foreground transition-[border-color,background-color,color] hover:border-primary/50 hover:bg-accent/70 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
            onClick={() => processQuery(qa.prompt)}
            disabled={isLoading}
          >
            {qa.icon}
            {qa.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3 scrollbar-thin">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2.5 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {/* Avatar */}
            <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
              msg.role === 'user'
                ? 'bg-primary/90 text-primary-foreground'
                : 'border border-primary/30 bg-primary/10 text-primary'
            }`} style={msg.role === 'assistant' ? { boxShadow: '0 0 8px -2px hsl(var(--primary) / 0.25)' } : {}}>
              {msg.role === 'user' ? 'U' : <Sparkles className="h-3 w-3" aria-hidden="true" />}
            </div>

            {/* Bubble */}
            <div className={`group relative flex max-w-[85%] flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="mb-1 px-1 text-[10px] font-medium text-muted-foreground">
                {msg.role === 'user' ? 'You' : 'Folio Â· Agent'}
              </span>
              <div className={`rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'rounded-tr-md bg-primary text-primary-foreground'
                  : 'rounded-tl-md border border-border/60 bg-muted/70 text-foreground'
              }`}>
                {msg.content}
              </div>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-[10px] tabular-nums text-muted-foreground/80">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.role === 'assistant' && (
                  <button
                    className={`text-[10px] transition-colors hover:text-foreground ${
                      copyFailedId === msg.id ? 'text-destructive' : 'text-muted-foreground'
                    }`}
                    onClick={() => handleCopy(msg.id, msg.content)}
                    aria-label={
                      copyFailedId === msg.id
                        ? 'Copy failed â€” clipboard access denied.'
                        : copiedId === msg.id
                          ? 'Copied to clipboard'
                          : 'Copy reply to clipboard'
                    }
                  >
                    {copyFailedId === msg.id ? (
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                    ) : copiedId === msg.id ? (
                      <Check className="h-3 w-3 text-success" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3 w-3" aria-hidden="true" />
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary"
              style={{ boxShadow: '0 0 8px -2px hsl(var(--primary) / 0.25)' }}>
              <Sparkles className="h-3 w-3" aria-hidden="true" />
            </div>
            <div className="rounded-xl rounded-tl-sm border border-border/60 bg-muted/70 px-3 py-2">
              <div className="flex items-center gap-1">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: '0ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: '150ms' }} />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/60" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Context and verification note keep the assistant's scope visible. */}
      <div className="shrink-0 border-t border-border/60 bg-muted/20 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-muted-foreground">
          <span className="font-semibold uppercase tracking-[0.1em] text-foreground/75">Current context</span>
          <span className="text-border" aria-hidden="true">Â·</span>
          <span className="capitalize">{workspaceMode}</span>
          <span className="text-border" aria-hidden="true">Â·</span>
          <span>{components.length} parts</span>
          <span className="text-border" aria-hidden="true">Â·</span>
          <span>{wires.length} wires</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
          Suggestions are advisory. Verify simulation results, datasheets, design rules and manufacturing limits before release.
        </p>
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-border/60 bg-surface/50 p-3">
        <div className="flex items-end gap-2">
          <Button
            variant={isVoice ? 'default' : 'ghost'}
            size="bar-icon"
            onClick={handleVoice}
            title={isVoice ? 'Stop voice conversation' : 'Start voice conversation'}
            aria-label={isVoice ? 'Stop voice conversation' : 'Start voice conversation'}
            className="shrink-0"
          >
            {isVoice ? <MicOff /> : <Mic />}
          </Button>
          <div className="relative min-w-0 flex-1 rounded-xl border border-input bg-background/70 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isVoice ? 'Listeningâ€¦' : 'Ask about your design or describe a changeâ€¦'}
              aria-label="Message the design assistant"
              disabled={isLoading || isVoice}
              rows={2}
              className="max-h-28 min-h-12 w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          <HoverHelp title="Ask about the open design: analysis, part suggestions, optimisation and reliability." description="Ask about the open design: analysis, part suggestions, optimisation and reliability.">
<Button onClick={handleSend}
            disabled={!input.trim() || isLoading}
            size="bar-icon"
            className="shrink-0 rounded-full"
            aria-label="Send message">
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
</HoverHelp>
        </div>
        <p className="mt-2 pl-1 text-[10px] text-muted-foreground">
          Enter to send <span className="mx-1 text-border">Â·</span> Shift+Enter for a new line
        </p>
      </div>
    </div>
  )
}

// â”€â”€ Formatting helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function formatCircuitAnalysis(analysis: { analysis: string; issues: Array<{ severity: string; message: string }>; recommendations: string[] }): string {
  const lines: string[] = ['Circuit Analysis Report\n']

  if (analysis.issues.length === 0) {
    lines.push('No issues found. Review the model and assumptions before relying on the result.')
  } else {
    const errors = analysis.issues.filter(i => i.severity === 'error')
    const warnings = analysis.issues.filter(i => i.severity === 'warning')
    const infos = analysis.issues.filter(i => i.severity === 'info')
    if (errors.length) {
      lines.push(`Errors (${errors.length}):`)
      errors.forEach(e => lines.push(`  â€¢ ${e.message}`))
    }
    if (warnings.length) {
      lines.push(`Warnings (${warnings.length}):`)
      warnings.forEach(w => lines.push(`  â€¢ ${w.message}`))
    }
    if (infos.length) {
      lines.push(`Information (${infos.length}):`)
      infos.forEach(i => lines.push(`  â€¢ ${i.message}`))
    }
  }

  if (analysis.recommendations.length) {
    lines.push('\n**Recommendations:**')
    analysis.recommendations.forEach(r => lines.push(`  â†’ ${r}`))
  }

  return lines.join('\n')
}

function formatRecommendations(recs: Array<{ component: string; reason: string; confidence: number; cost?: number }>): string {
  if (recs.length === 0) return 'No specific component recommendations for this query.'
  const lines = ['**Component Recommendations:**\n']
  recs.forEach((r, i) => {
    lines.push(`${i + 1}. **${r.component}** (${Math.round(r.confidence * 100)}% match)`)
    lines.push(`   ${r.reason}`)
    if (r.cost) lines.push(`   Est. cost: $${r.cost.toFixed(2)}`)
  })
  return lines.join('\n')
}

function formatOptimizationResult(result: { improvements: Array<{ parameter: string; improvement: number }>; confidence: number; reasoning: string }): string {
  const lines = [`**Optimization Result** (confidence: ${Math.round(result.confidence * 100)}%)\n`]
  lines.push(result.reasoning)
  if (result.improvements.length) {
    lines.push('\n**Improvements achieved:**')
    result.improvements.forEach(imp => {
      const sign = imp.improvement > 0 ? '+' : ''
      lines.push(`  â€¢ ${imp.parameter}: ${sign}${imp.improvement.toFixed(1)}%`)
    })
  }
  return lines.join('\n')
}

/** The fields of a prediction this view prints. */
type MaintenancePredictionView = {
  componentId: string
  failureProbability: number
  timeToFailure: number
  failureMode: string
  confidence: number
  basis: string
  inputsMissing: string[]
  recommendations: string[]
}

function formatMaintenancePredictions(preds: MaintenancePredictionView[]): string {
  if (preds.length === 0) return 'No maintenance predictions available â€” add components first.'
  const lines = ['**Predictive Maintenance Analysis:**\n']
  const sorted = [...preds].sort((a, b) => b.failureProbability - a.failureProbability)
  sorted.slice(0, 5).forEach(p => {
    const risk = p.failureProbability > 0.1 ? 'HIGH RISK' : p.failureProbability > 0.05 ? 'ELEVATED RISK' : 'LOW RISK'
    lines.push(`**${risk}: ${p.componentId}**`)
    lines.push(`   Failure probability: ${(p.failureProbability * 100).toFixed(1)}% (confidence ${Math.round(p.confidence * 100)}%)`)
    lines.push(`   Est. time to failure: ${Math.round(p.timeToFailure).toLocaleString()} h`)
    lines.push(`   Mode: ${p.failureMode}`)
    lines.push(`   Basis: ${p.basis}`)
    if (p.recommendations.length) lines.push(`   â†’ ${p.recommendations[0]}`)
  })
  if (preds.length > 5) lines.push(`\nâ€¦and ${preds.length - 5} more components`)
  const gapCount = preds.filter(p => p.inputsMissing.length > 0).length
  lines.push(
    `\nConfidence counts the stress inputs the design actually declares; undeclared ones are listed as gaps rather than guessed.` +
      (gapCount > 0 ? ` ${gapCount} of ${preds.length} part${gapCount === 1 ? ' has' : ' have'} unevaluated inputs.` : ''),
  )
  return lines.join('\n')
}

function formatSmartSuggestions(suggs: Array<{ suggestion: string; reasoning: string; confidence: number; type: string }>): string {
  if (suggs.length === 0) return 'No smart suggestions at this time. Your design looks good!'
  const lines = ['**Smart Design Suggestions:**\n']
  suggs.slice(0, 6).forEach((s, i) => {
    lines.push(`${i + 1}. **[${s.type}]** ${s.suggestion}`)
    lines.push(`   Confidence: ${Math.round(s.confidence * 100)}% â€” ${s.reasoning}`)
  })
  return lines.join('\n')
}

export default AIChatPanel

