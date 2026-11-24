import HoverHelp from '../ui/HoverHelp'
import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Send, Trash2, Lightbulb, Cpu, Wrench, X, Mic, MicOff, Copy, Check, AlertTriangle, Paperclip, FileText } from 'lucide-react'
import ScribeIcon from '../workspace/ScribeIcon'
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

/** One file the user attached to the prompt. Contents are pasted inline into the
 * message sent to the assistant, exactly the same text a designer would paste —
 * no hidden channel, nothing outlives the conversation. */
interface Attachment {
  id: string
  name: string
  size: number
  text: string
}

/** Ceiling for a single attachment and for the whole bundle, so a pathological
 * file can't push the model context into the weeds. */
const MAX_ATTACHMENTS = 5
const MAX_FILE_BYTES = 256 * 1024

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Analyze circuit', prompt: 'Analyze the current circuit for issues and improvements', icon: <Cpu className="w-3 h-3" /> },
  { label: 'Suggest components', prompt: 'Suggest missing components for a complete design', icon: <Lightbulb className="w-3 h-3" /> },
  { label: 'Optimize power', prompt: 'Optimize the design for lower power consumption', icon: <Wrench className="w-3 h-3" /> },
  { label: 'Review assumptions', prompt: 'List the assumptions, missing evidence, and validation steps for this design', icon: <ScribeIcon className="w-3 h-3" /> },
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
    content: 'Scribe at the desk. I read the sheet before I touch it, and what I can\'t measure I won\'t invent. Ask me to run the check, pull the parts, or chase the net — I answer with evidence, or I tell you plainly I can\'t. The rule checks, the solver and the datasheets remain the arbiters; I advise, Folio verifies.',
    timestamp: Date.now(),
    metadata: { type: 'general' },
  }])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const isVoice = useVoiceStore((state) => state.listening)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [copyFailedId, setCopyFailedId] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const components = useProjectStore((state) => state.components)
  const wires = useProjectStore((state) => state.wires)
  const workspaceMode = useAppStore((state) => state.workspaceMode)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  /* The prompt grows with its content — one line for a one-line note, up to a
   * few lines for a real brief — then scrolls. Fixed rows were the source of
   * the user's complaint about the empty border. */
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 44), 132)}px`
  }, [input])

  const readAttachment = (file: File): Promise<Attachment> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({
        id: generateId('att'),
        name: file.name,
        size: file.size,
        text: typeof reader.result === 'string' ? reader.result : '',
      })
      reader.onerror = () => reject(new Error(`Could not read ${file.name}`))
      reader.readAsText(file)
    })

  const attachFiles = useCallback(async (list: FileList | null) => {
    if (!list || list.length === 0) return
    setAttachError(null)
    const files = Array.from(list).slice(0, MAX_ATTACHMENTS)
    const next: Attachment[] = []
    for (const file of files) {
      if (file.size > MAX_FILE_BYTES) {
        setAttachError(`${file.name} is ${(file.size / 1024).toFixed(0)} KB — attachments are capped at ${MAX_FILE_BYTES / 1024} KB.`)
        continue
      }
      try {
        next.push(await readAttachment(file))
      } catch (error) {
        setAttachError(error instanceof Error ? error.message : `Could not read ${file.name}`)
      }
    }
    if (next.length > 0) setAttachments((current) => [...current, ...next].slice(0, MAX_ATTACHMENTS))
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id))
  }, [])

  /** The message handed to the assistant: the user's text plus every attached
   * file inlined verbatim, exactly what a designer would paste by hand. */
  const composedPrompt = useCallback((text: string, attached: readonly Attachment[]): string => {
    if (attached.length === 0) return text
    const files = attached.map((attachment) =>
      `\n\n--- attached file: ${attachment.name} (${attachment.size} bytes) ---\n${attachment.text}`,
    ).join('')
    return `${text}${files}`
  }, [])

  const addMessage = useCallback((msg: Omit<AIMessage, 'id' | 'timestamp'>) => {
    setMessages(prev => [...prev, {
      ...msg,
      id: generateId('msg'),
      timestamp: Date.now(),
    }])
  }, [])

  const processQuery = useCallback(async (query: string, attached: readonly Attachment[] = []) => {
    if (!query.trim() && attached.length === 0) return
    setIsLoading(true)

    // What the designer sees in their own bubble: the text they typed plus a
    // plain marker for each attached file (with its name and size, not a
    // hidden blob). The model gets the same text with contents inlined.
    const marker = attached.length === 0
      ? ''
      : `\n\n[Attached: ${attached.map(a => `${a.name} (${(a.size / 1024).toFixed(1)} KB)`).join(', ')}]`
    addMessage({ role: 'user', content: `${query}${marker}` })

    try {
      const domainComponents = components.map(toDomainComponent)
      const domainWires = wires.map(toDomainWire)
      const ctx = {
        components: domainComponents,
        wires: domainWires,
        workspaceMode,
      }
      const submitted = composedPrompt(query, attached)

      // Route to appropriate AI service method based on intent
      const lowerQuery = submitted.toLowerCase()
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
        const recs = await aiService.recommendComponents(submitted)
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
        const suggestions = await aiService.getSmartSuggestions({ ...ctx, currentAction: submitted })
        responseContent = formatSmartSuggestions(suggestions)
        metadata = { type: 'general' }

      } else {
        // General AI response via NLP + context-aware heuristics
        const nlpResult = nlpService.processCommand(submitted)
        responseContent = await aiService.generateContextualResponse(submitted, nlpResult, ctx)
        metadata = { type: 'general' }
      }

      addMessage({ role: 'assistant', content: responseContent, metadata })
    } catch (err) {
      addMessage({
        role: 'assistant',
        content: `Scribe hit a wall reading that: ${err instanceof Error ? err.message : 'Unknown error'}. Say it narrower, or ask for something I can measure.`,
        metadata: { type: 'general' },
      })
    } finally {
      setIsLoading(false)
    }
  }, [components, wires, workspaceMode, addMessage, composedPrompt])

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
    const attached = attachments
    if ((!q && attached.length === 0) || isLoading) return
    setInput('')
    setAttachments([])
    setAttachError(null)
    processQuery(q, attached)
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
      content: 'Cleared. The sheet is yours to question — ask Scribe anything about it.',
      timestamp: Date.now(),
      metadata: { type: 'general' },
    }])
    setAttachments([])
    setAttachError(null)
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
              <h2 className="text-sm font-semibold leading-tight tracking-tight">Scribe</h2>
            </div>
            <p className="mt-1 truncate text-[11px] leading-tight text-muted-foreground">
              every claim traced to the sheet
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <HoverHelp title="Clear conversation" description="Clear conversation">
<Button variant="ghost" size="bar-icon" onClick={clearChat} aria-label="Clear conversation">
            <Trash2 />
          </Button>
</HoverHelp>
          <HoverHelp title="Close Scribe" description="Close Scribe; your sheet stays as it is">
<Button variant="ghost" size="bar-icon" onClick={onClose} aria-label="Close Scribe">
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
              {msg.role === 'user' ? 'U' : <ScribeIcon className="h-3 w-3" aria-hidden="true" />}
            </div>

            {/* Bubble */}
            <div className={`group relative flex max-w-[85%] flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
              <span className="mb-1 px-1 text-[10px] font-medium text-muted-foreground">
                {msg.role === 'user' ? 'You' : 'Scribe'}
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
                  <HoverHelp
                    title={
                      copyFailedId === msg.id
                        ? 'Copy failed — clipboard denied'
                        : copiedId === msg.id
                          ? 'Copied to clipboard'
                          : 'Copy reply'
                    }
                    description={
                      copyFailedId === msg.id
                        ? 'Clipboard access was denied by the browser.'
                        : 'Copy this reply to the clipboard.'
                    }
                  >
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
                  </HoverHelp>
                )}
              </div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-2">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-primary/30 bg-primary/10 text-primary"
              style={{ boxShadow: '0 0 8px -2px hsl(var(--primary) / 0.25)' }}>
              <ScribeIcon className="h-3 w-3" aria-hidden="true" />
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

      {/* What Scribe can see — the open sheet, nothing hidden, nothing invented. */}
      <div className="shrink-0 border-t border-border/60 bg-muted/20 px-4 py-2">
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          <span className="font-semibold text-foreground/75">In front of Scribe:</span>{' '}
          {components.length} part{components.length === 1 ? '' : 's'},{' '}
          {wires.length} wire{wires.length === 1 ? '' : 's'} from the open sheet.{' '}
          It advises; the rule checks and the solver decide.
        </p>
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-border/60 bg-surface/50 p-3">
        {attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1.5" role="list" aria-label="Attached files">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                role="listitem"
                className="inline-flex max-w-44 items-center gap-1.5 rounded-md border border-border/70 bg-background/80 py-1 pl-1.5 pr-1 text-[11px] text-foreground"
              >
                <FileText size={12} className="shrink-0 text-primary" aria-hidden="true" />
                <span className="truncate font-mono">{attachment.name}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{(attachment.size / 1024).toFixed(0)} KB</span>
                <HoverHelp title={`Detach ${attachment.name}`} description="Remove this file from the prompt.">
                  <button
                    type="button"
                    className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    onClick={() => removeAttachment(attachment.id)}
                    aria-label={`Detach ${attachment.name}`}
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </HoverHelp>
              </span>
            ))}
          </div>
        )}
        {attachError && (
          <div role="alert" className="mb-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            {attachError}
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.csv,.json,.net,.cir,.spice,.ibs,.log,.yaml,.yml,.rpt,text/*"
          className="hidden"
          aria-hidden="true"
          tabIndex={-1}
          onChange={(event) => { void attachFiles(event.target.files); event.target.value = '' }}
        />
        <div className="flex items-end gap-2">
          <HoverHelp title={isVoice ? 'Stop voice conversation' : 'Start voice conversation'} description={isVoice ? 'Stop listening and close the voice bar.' : 'Talk to the assistant instead of typing.'}>
            <Button
              variant={isVoice ? 'default' : 'ghost'}
              size="bar-icon"
              onClick={handleVoice}
              aria-label={isVoice ? 'Stop voice conversation' : 'Start voice conversation'}
              className="shrink-0"
            >
              {isVoice ? <MicOff /> : <Mic />}
            </Button>
          </HoverHelp>
          <HoverHelp title="Attach a text file" description="Attach a datasheet, IBIS model, netlist or report as text into the prompt. Text files only; contents are pasted into your message.">
            <Button
              variant="ghost"
              size="bar-icon"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Attach a file"
              disabled={isLoading || isVoice}
              className="shrink-0"
            >
              <Paperclip />
            </Button>
          </HoverHelp>
          <div className="relative min-w-0 flex-1 rounded-xl border border-input bg-background/70">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isVoice ? 'Listening…' : 'Ask Scribe — or describe the change you want…'}
              aria-label="Message Scribe"
              disabled={isLoading || isVoice}
              rows={1}
              style={{ minHeight: 44, maxHeight: 132 }}
              className="max-h-[132px] min-h-11 w-full resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/80 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>
          <HoverHelp title="Ask about the open design: analysis, part suggestions, optimisation, attachments and reliability." description="Ask about the open design: analysis, part suggestions, optimisation, attachments and reliability.">
<Button onClick={handleSend}
            disabled={(!input.trim() && attachments.length === 0) || isLoading}
            size="bar-icon"
            className="shrink-0 rounded-full"
            aria-label="Send message">
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
</HoverHelp>
        </div>
        <p className="mt-2 pl-1 text-[10px] text-muted-foreground">
          Enter to send <span className="mx-1 text-border">·</span> Shift+Enter for a new line
        </p>
      </div>
    </div>
  )
}

// ── Formatting helpers ──────────────────────────────────────────────────────────

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
