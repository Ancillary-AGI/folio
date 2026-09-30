import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Bot, Send, Trash2, Lightbulb, Cpu, Wrench, X, Loader2, Mic, MicOff, Copy, Check } from 'lucide-react'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
import { Badge } from '../ui/badge'
import { aiService } from '../../lib/ai/aiService'
import { nlpService } from '../../lib/nlp/nlpService'
import { useProjectStore } from '../../stores/useProjectStore'
import type { CanvasComponent, CanvasWire } from '../../stores/useProjectStore'
import { useAppStore } from '../../stores/useAppStore'
import type { AIMessage } from '../../types'
import type { Component as DomainComponent, DomainWire } from '../../types/domain'
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
    content: 'Hello! I\'m your AI design assistant. I can help you analyze circuits, suggest components, optimize designs, run compliance checks, and answer engineering questions. What would you like to work on?',
    timestamp: Date.now(),
    metadata: { type: 'general' },
  }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isVoice, setIsVoice] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
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
        responseContent = formatMaintenancePredictions(Array.isArray(predictions) ? predictions : [predictions])
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

  const handleVoice = async () => {
    if (isVoice) {
      nlpService.stopVoiceListening()
      setIsVoice(false)
    } else {
      try {
        await nlpService.startVoiceListening()
        setIsVoice(true)
        // Auto-stop after 10 seconds
        setTimeout(() => setIsVoice(false), 10000)
      } catch {
        addMessage({ role: 'assistant', content: 'Voice recognition is not available in your browser. Please type your query instead.', metadata: { type: 'general' } })
      }
    }
  }

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content).catch(() => {})
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 1500)
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
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 text-primary" />
          <span className="font-semibold text-sm">AI Design Assistant</span>
          <Badge variant="secondary" className="text-xs">{workspaceMode}</Badge>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={clearChat} title="Clear chat">
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-1 p-2 flex-wrap border-b border-border">
        {QUICK_ACTIONS.map(qa => (
          <button
            key={qa.label}
            className="flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-accent hover:bg-accent/80 transition-colors"
            onClick={() => processQuery(qa.prompt)}
            disabled={isLoading}
          >
            {qa.icon}
            {qa.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
        {messages.map(msg => (
          <div key={msg.id} className={`flex gap-2 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
            {/* Avatar */}
            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs ${
              msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-secondary-foreground'
            }`}>
              {msg.role === 'user' ? 'U' : <Bot className="w-3.5 h-3.5" />}
            </div>

            {/* Bubble */}
            <div className={`group relative max-w-[85%] ${msg.role === 'user' ? 'items-end' : 'items-start'} flex flex-col`}>
              <div className={`rounded-lg px-3 py-2 text-sm whitespace-pre-wrap leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-foreground'
              }`}>
                {msg.content}
              </div>
              <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-xs text-muted-foreground">
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                {msg.role === 'assistant' && (
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => handleCopy(msg.id, msg.content)}
                  >
                    {copiedId === msg.id ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2">
            <div className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
              <Bot className="w-3.5 h-3.5" />
            </div>
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Context indicator */}
      <div className="px-3 py-1 text-xs text-muted-foreground border-t border-border bg-muted/30">
        Context: {components.length} components, {wires.length} wires — {workspaceMode} mode
      </div>

      {/* Input */}
      <div className="p-3 border-t border-border flex gap-2">
        <Button
          variant={isVoice ? 'default' : 'ghost'}
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={handleVoice}
          title={isVoice ? 'Stop voice' : 'Start voice input'}
        >
          {isVoice ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
        </Button>
        <Input
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isVoice ? 'Listening…' : 'Ask about your design…'}
          disabled={isLoading || isVoice}
          className="flex-1 text-sm"
        />
        <Button
          onClick={handleSend}
          disabled={!input.trim() || isLoading}
          size="icon"
          className="h-9 w-9 flex-shrink-0"
        >
          <Send className="w-4 h-4" />
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

function formatMaintenancePredictions(preds: Array<{ componentId: string; failureProbability: number; timeToFailure: number; failureMode: string; recommendations: string[] }>): string {
  if (preds.length === 0) return 'No maintenance predictions available — add components first.'
  const lines = ['**Predictive Maintenance Analysis:**\n']
  const sorted = [...preds].sort((a, b) => b.failureProbability - a.failureProbability)
  sorted.slice(0, 5).forEach(p => {
    const risk = p.failureProbability > 0.1 ? 'HIGH RISK' : p.failureProbability > 0.05 ? 'ELEVATED RISK' : 'LOW RISK'
    lines.push(`**${risk}: ${p.componentId}**`)
    lines.push(`   Failure probability: ${(p.failureProbability * 100).toFixed(1)}%`)
    lines.push(`   Est. time to failure: ${p.timeToFailure.toLocaleString()} h`)
    lines.push(`   Mode: ${p.failureMode}`)
    if (p.recommendations.length) lines.push(`   → ${p.recommendations[0]}`)
  })
  if (preds.length > 5) lines.push(`\n…and ${preds.length - 5} more components`)
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
