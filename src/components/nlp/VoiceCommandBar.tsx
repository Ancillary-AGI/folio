import { useMemo, useState } from 'react';
import { nlpService } from '../../lib/nlp/nlpService';
import { Button } from '../ui/button';

interface VoiceCommandBarProps {
  onIntent?: (intent: string, command: string) => void;
}

export default function VoiceCommandBar({ onIntent }: VoiceCommandBarProps) {
  const [text, setText] = useState('');
  const [listening, setListening] = useState(false);
  const [result, setResult] = useState('');
  const suggestions = useMemo(() => ['place resistor', 'run thermal sim', 'convert schematic to pcb', 'show siem alerts'], []);

  const run = async (command: string) => {
    setText(command);
    try {
      const processed = await (nlpService as unknown as { processCommand?: (c: string) => Promise<{ intent?: string; confidence?: number }> }).processCommand?.(command);
      const intent = processed?.intent ?? 'general';
      setResult(`${intent} (${Math.round((processed?.confidence ?? 0.7) * 100)}%)`);
      onIntent?.(intent, command);
    } catch {
      setResult('nlp-fallback');
      onIntent?.('general', command);
    }
  };

  const toggleVoice = async () => {
    try {
      if (!listening) {
        await nlpService.startVoiceListening();
        setListening(true);
        setResult('Listening…');
      } else {
        nlpService.stopVoiceListening?.();
        setListening(false);
      }
    } catch (error) {
      setResult(error instanceof Error ? error.message : 'Voice unavailable');
      setListening(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-card">
      <Button size="sm" variant={listening ? 'default' : 'outline'} onClick={toggleVoice}>
        {listening ? 'Stop mic' : 'Voice'}
      </Button>
      <input
        className="flex-1 text-sm border rounded-md px-2 py-1 bg-background"
        placeholder="Ask the co-pilot…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') run(text);
        }}
      />
      <Button size="sm" onClick={() => run(text)}>Go</Button>
      {result && <span className="text-xs text-muted-foreground whitespace-nowrap">{result}</span>}
      <div className="hidden lg:flex gap-1">
        {suggestions.map((s) => (
          <button key={s} className="text-xs px-2 py-1 rounded bg-muted" onClick={() => run(s)}>{s}</button>
        ))}
      </div>
    </div>
  );
}
