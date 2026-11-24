import HoverHelp from '../ui/HoverHelp'
import { useEffect, useMemo, useRef, useState } from 'react';
import { Mic, MicOff, Send, Trash2, Volume2, VolumeX, Square, X } from 'lucide-react';
import { Button } from '../ui/button';
import { voiceController } from '../../lib/voice/controller';
import { useVoiceStore, type VoiceSpeechState } from '../../stores/useVoiceStore';

interface VoiceCommandBarProps {
  onClose: () => void;
}

const SUGGESTIONS = ['place a resistor', 'add a capacitor', 'what is on the sheet', 'open the pcb'] as const;

const STATUS_LABEL: Record<string, string> = {
  idle: 'Ready — press the microphone or type a command.',
  starting: 'Starting the microphone…',
  listening: 'Listening — speak a command.',
  recognising: 'Heard you — working on it…',
  error: 'The microphone is not available.',
};

const SPEECH_LABEL: Record<VoiceSpeechState, string> = {
  spoken: 'spoken aloud',
  'text-only': 'replies shown as text',
  unavailable: 'this browser cannot speak replies',
  interrupted: 'speech interrupted',
};

export default function VoiceCommandBar({ onClose }: VoiceCommandBarProps) {
  const listening = useVoiceStore((state) => state.listening);
  const speaking = useVoiceStore((state) => state.speaking);
  const status = useVoiceStore((state) => state.status);
  const error = useVoiceStore((state) => state.error);
  const interim = useVoiceStore((state) => state.interim);
  const turns = useVoiceStore((state) => state.turns);
  const spokenReplies = useVoiceStore((state) => state.spokenReplies);
  const setSpokenReplies = useVoiceStore((state) => state.setSpokenReplies);
  const clearTurns = useVoiceStore((state) => state.clearTurns);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => SUGGESTIONS, []);

  useEffect(() => {
    const node = logRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [turns, interim]);

  const send = async (command: string) => {
    const trimmed = command.trim();
    if (!trimmed || busy) return;
    setText('');
    setBusy(true);
    try {
      await voiceController.send(trimmed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="border-b border-border bg-card px-3 py-2"
      data-testid="voice-panel"
      aria-label="Voice conversation"
    >
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={listening ? 'default' : 'outline'}
          onClick={() => voiceController.toggleListening()}
          aria-pressed={listening}
          aria-label={listening ? 'Stop the microphone' : 'Start the microphone'}
          data-testid="voice-mic"
          className="flex items-center gap-1"
        >
          {listening ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
          {listening ? 'Listening' : 'Listen'}
        </Button>

        {speaking && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => voiceController.cancelSpeech()}
            aria-label="Stop speaking"
            className="flex items-center gap-1"
          >
            <Square className="h-3 w-3" /> Stop speaking
          </Button>
        )}

        <button
          type="button"
          onClick={() => setSpokenReplies(!spokenReplies)}
          aria-pressed={spokenReplies}
          aria-label={spokenReplies ? 'Turn spoken replies off' : 'Turn spoken replies on'}
          data-testid="voice-speech-toggle"
          className="flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        >
          {spokenReplies ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
          {spokenReplies ? 'Spoken replies on' : 'Spoken replies off'}
        </button>

        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" role="status" data-testid="voice-status">
          {status === 'idle' && spokenReplies === false ? 'Ready — replies stay on screen.' : STATUS_LABEL[status]}
        </span>

        <HoverHelp title="Empty the transcript of this session's turns." description="Empty the transcript of this session's turns.">
<Button variant="ghost" size="icon" onClick={clearTurns} aria-label="Clear transcript" className="h-7 w-7">
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
</HoverHelp>
        <HoverHelp title="Close the voice bar. Listening stops with it." description="Close the voice bar. Listening stops with it.">
<Button variant="ghost" size="icon" onClick={onClose} aria-label="Close voice conversation" className="h-7 w-7">
          <X className="h-4 w-4" />
        </Button>
</HoverHelp>
      </div>

      {/* Transcript */}
      <div
        ref={logRef}
        role="log"
        aria-live="polite"
        aria-label="Conversation"
        data-testid="voice-log"
        className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1 text-sm"
      >
        {turns.length === 0 && !interim && (
          <p className="text-xs text-muted-foreground">
            Say things like “place a resistor”, “connect R1 to D1”, “open the pcb” or “stop listening”.
            Scribe answers aloud and in text.
          </p>
        )}
        {turns.map((turn) => (
          <div
            key={turn.id}
            className={`flex gap-2 ${turn.role === 'designer' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <div
              className={`max-w-[85%] rounded-lg px-3 py-1.5 leading-relaxed ${
                turn.role === 'designer' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
              }`}
            >
              <p className="whitespace-pre-wrap">{turn.text}</p>
              {turn.role === 'assistant' && turn.speech && (
                <p className="mt-0.5 text-[11px] opacity-70">
                  {SPEECH_LABEL[turn.speech]}
                  {turn.applied === true ? ' · applied' : turn.intent ? ` · ${turn.intent.replace(/_/g, ' ')}` : ''}
                </p>
              )}
            </div>
          </div>
        ))}
        {interim && (
          <p className="italic text-muted-foreground" data-testid="voice-interim">
            “{interim}”
          </p>
        )}
      </div>

      {/* Error */}
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive" data-testid="voice-error">
          {error}
        </p>
      )}

      {/* Typed fallback */}
      <div className="mt-2 flex gap-2">
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          placeholder={listening ? 'Listening — or type here…' : 'Type a command…'}
          aria-label="Typed command"
          data-testid="voice-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void send(text);
          }}
        />
        <Button size="sm" onClick={() => void send(text)} disabled={busy || !text.trim()} aria-label="Send command" data-testid="voice-send">
          {busy ? 'Working…' : <Send className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {/* Suggestions */}
      <div className="mt-2 flex flex-wrap gap-1">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className="rounded bg-muted px-2 py-1 text-xs hover:bg-accent"
            onClick={() => void send(suggestion)}
            disabled={busy}
          >
            {suggestion}
          </button>
        ))}
      </div>

      <p className="mt-2 text-[11px] text-muted-foreground">
        Speech recognition and synthesis belong to the browser's speech service; Folio stores only this
        transcript. Commands act on the open project and can be undone with the undo command.
      </p>
    </div>
  );
}
