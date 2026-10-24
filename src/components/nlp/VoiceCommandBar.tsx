import { useMemo, useState } from 'react';
import { Mic, MicOff, X } from 'lucide-react';
import { nlpService } from '../../lib/nlp/nlpService';
import { Button } from '../ui/button';

interface VoiceCommandBarProps {
  /** Owned by App so the header mic and this bar can never disagree. */
  listening: boolean;
  onToggleListening: () => void;
  onClose: () => void;
  error?: string;
  onIntent?: (intent: string, command: string) => void;
}

export default function VoiceCommandBar({
  listening,
  onToggleListening,
  onClose,
  error,
  onIntent,
}: VoiceCommandBarProps) {
  const [text, setText] = useState('');
  const [result, setResult] = useState('');
  const [busy, setBusy] = useState(false);
  const suggestions = useMemo(
    () => ['place resistor', 'run thermal sim', 'convert schematic to pcb', 'show siem alerts'],
    [],
  );

  /**
   * `processNLP` is the public path: it scores intents AND runs the matched
   * handler against the project store. The previous cast to a non-existent
   * `processCommand` never dispatched anything.
   */
  const run = async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed) return;
    setText(trimmed);
    setBusy(true);
    try {
      const processed = await nlpService.processNLP(trimmed);
      const dispatched = processed.dispatchResult === undefined ? '' : ' · applied';
      setResult(
        processed.intent === 'unknown'
          ? 'No matching command'
          : `${processed.intent} (${Math.round(processed.confidence * 100)}%)${dispatched}`,
      );
      onIntent?.(processed.intent, trimmed);
    } catch (e) {
      setResult(e instanceof Error ? e.message : 'Command failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
      <Button
        size="sm"
        variant={listening ? 'default' : 'outline'}
        onClick={onToggleListening}
        className="flex items-center gap-1"
        aria-pressed={listening}
      >
        {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        {listening ? 'Stop mic' : 'Voice'}
      </Button>
      <input
        className="min-w-40 flex-1 rounded-md border border-input bg-background px-2 py-1 text-sm"
        placeholder="Ask the co-pilot…"
        aria-label="Command"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void run(text);
        }}
      />
      <Button size="sm" onClick={() => void run(text)} disabled={busy || !text.trim()}>
        {busy ? 'Running…' : 'Go'}
      </Button>
      {(result || error) && (
        <span role="status" className={`text-xs ${error ? 'text-destructive' : 'text-muted-foreground'}`}>
          {error || result}
        </span>
      )}
      <div className="hidden gap-1 lg:flex">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="rounded bg-muted px-2 py-1 text-xs"
            onClick={() => void run(suggestion)}
          >
            {suggestion}
          </button>
        ))}
      </div>
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close voice bar" className="h-7 w-7">
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
