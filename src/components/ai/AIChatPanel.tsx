import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Send, Trash2, Lightbulb, Cpu, Wrench, X, Mic, MicOff, Copy, Check, AlertTriangle } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
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
  { label: 'Check safety', prompt: 'Run a safety and compliance check on this design', icon: <Bot className="w-3 h-3" /> },
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
    content: 'Hello. I\'m the design assistant. I can analyse circuits, suggest components, optimise designs, run compliance checks and answer engineering questions. Where would you like to start?',
    timestamp: Date.now(),
    metadata: { type: 'general' },
  }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const isVoice = useVoiceStore((state) => state.listening)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  const handleSend = () => {
    const q = input.trim()
    if (!q || isLoading) return
    setInput('')
    processQuery(q)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
      <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-surface/50 px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-primary/15 text-primary"
            style={{ boxShadow: '0 0 10px -2px hsl(var(--primary) / 0.3)' }}>
            <Bot className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          <div>
            <h2 className="text-xs font-semibold leading-tight">AI Design Assistant</h2>
            <p className="text-[10px] text-muted-foreground capitalize leading-tight">{workspaceMode} mode</p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="bar-icon" onClick={clearChat} title="Clear conversation" aria-label="Clear conversation">
            <Trash2 />
          </Button>
          <Button variant="ghost" size="bar-icon" onClick={onClose} aria-label="Close AI assistant">
            <X />
          </Button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex shrink-0 flex-wrap gap-1 border-b border-border/60 bg-surface/30 p-2">
        {QUICK_ACTIONS.map(qa => (
          <button
            key={qa.label}
            className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-background/50 px-2 py-1 text-[10px] font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-accent/70 hover:text-primary disabled:pointer-events-none disabled:opacity-50"
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
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {/* Avatar */}
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
              msg.role === 'user'
                ? 'bg-primary/90 text-primary-foreground'
                : 'border border-primary/30 bg-primary/10 text-primary'
            }`} style={msg.role === 'assistant' ? { boxShadow: '0 0 8px -2px hsl(var(--primary) / 0.25)' } : {}}>
              {msg.role === 'user' ? 'U' : <Bot className="h-3 w-3" aria-hidden="true" />}
            </div>

            {/* Bubble */}
            <div className={`group relative flex max-w-[85%] flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <div className={`rounded-xl px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'rounded-tr-sm bg-primary text-primary-foreground'
                  : 'rounded-tl-sm border border-border/60 bg-muted/70 text-foreground'
              }`}>
                {msg.content}
              </div>
              <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <span className="text-[10px] text-muted-foreground">
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
                        ? 'Copy failed — clipboard access denied.'
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
              <Bot className="h-3 w-3" aria-hidden="true" />
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

      {/* Context indicator */}
      <div className="shrink-0 border-t border-border/60 bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
        {components.length > 0
          ? `${components.length} parts · ${wires.length} nets · ${workspaceMode}`
          : `No parts placed · ${workspaceMode} mode`}
      </div>

      {/* Input bar */}
      <div className="shrink-0 flex items-center gap-2 border-t border-border/60 bg-surface/30 p-2.5">
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
        <div className="relative min-w-0 flex-1">
          <Input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={isVoice ? 'Listening…' : 'Ask about your design…'}
            disabled={isLoading || isVoice}
            className="h-8 w-full rounded-full border-border/70 bg-background/60 text-xs focus:border-primary/60"
          />
        </div>
        <Button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          size="bar-icon"
          className="shrink-0 rounded-full"
          aria-label="Send message"
          title="Ask about the open design: analysis, part suggestions, optimisation and reliability.">
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}

// ── Formatting helpers ──────────────────────────────────────────────────────────

function formatCircuitAnalysis(analysis: { analysis: string; issues: Array<{ severity: string; message: string }>; recommendations: string[] }): string {
  const lines: string[] = ['**Circuit Analysis Report**\n']

  if (analysis.issues.length === 0) {
    lines.push('No issues found. Review the model and assumptions before relying on the result.')
  } else {
    const errors = analysis.issues.filter(i => i.severity === 'error')
    const warnings = analysis.issues.filter(i => i.severity === 'warning')
    const infos = analysis.issues.filter(i => i.severity === 'info')
    if (errors.length) {
      lines.push(`Errors (${errors.length}):`)
      errors.forEach(e => lines.push(`  • ${e.message}`))
    }
    if (warnings.length) {
      lines.push(`Warnings (${warnings.length}):`)
      warnings.forEach(w => lines.push(`  • ${w.message}`))
    }
    if (infos.length) {
      lines.push(`Information (${infos.length}):`)
      infos.forEach(i => lines.push(`  • ${i.message}`))
    }
  }

  if (analysis.recommendations.length) {
    lines.push('\n**Recommendations:**')
    analysis.recommendations.forEach(r => lines.push(`  → ${r}`))
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
      lines.push(`  • ${imp.parameter}: ${sign}${imp.improvement.toFixed(1)}%`)
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
  if (preds.length === 0) return 'No maintenance predictions available — add components first.'
  const lines = ['**Predictive Maintenance Analysis:**\n']
  const sorted = [...preds].sort((a, b) => b.failureProbability - a.failureProbability)
  sorted.slice(0, 5).forEach(p => {
    const risk = p.failureProbability > 0.1 ? 'HIGH RISK' : p.failureProbability > 0.05 ? 'ELEVATED RISK' : 'LOW RISK'
    lines.push(`**${risk}: ${p.componentId}**`)
    lines.push(`   Failure probability: ${(p.failureProbability * 100).toFixed(1)}% (confidence ${Math.round(p.confidence * 100)}%)`)
    lines.push(`   Est. time to failure: ${Math.round(p.timeToFailure).toLocaleString()} h`)
    lines.push(`   Mode: ${p.failureMode}`)
    lines.push(`   Basis: ${p.basis}`)
    if (p.recommendations.length) lines.push(`   → ${p.recommendations[0]}`)
  })
  if (preds.length > 5) lines.push(`\n…and ${preds.length - 5} more components`)
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
    lines.push(`   Confidence: ${Math.round(s.confidence * 100)}% — ${s.reasoning}`)
  })
  return lines.join('\n')
}

export default AIChatPanel
