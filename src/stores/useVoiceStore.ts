/**
 * Voice conversation surface state.
 *
 * One store so the header microphone, the conversation panel and the design
 * assistant cannot disagree about whether the microphone is open. Preferences
 * are stored per browser and a malformed store is discarded, not trusted.
 */
import { create } from 'zustand'

export type VoiceStatus = 'idle' | 'starting' | 'listening' | 'recognising' | 'error'

export type VoiceSpeechState = 'spoken' | 'text-only' | 'unavailable' | 'interrupted'

export interface VoiceTurn {
  id: string
  role: 'designer' | 'assistant'
  text: string
  intent?: string
  confidence?: number
  applied?: boolean
  speech?: VoiceSpeechState
  timestamp: number
}

export interface VoiceSettings {
  spokenReplies: boolean
}

export const VOICE_SETTINGS_KEY = 'folio.voice.v1'

const DEFAULT_SETTINGS: VoiceSettings = { spokenReplies: true }

type StorageLike = Pick<Storage, 'getItem'> | null

export function loadVoiceSettings(
  storage: StorageLike = typeof localStorage === 'undefined' ? null : localStorage,
): VoiceSettings {
  try {
    const raw = storage?.getItem(VOICE_SETTINGS_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_SETTINGS }
    const record = parsed as Record<string, unknown>
    if (record.version !== 1) return { ...DEFAULT_SETTINGS }
    return {
      spokenReplies:
        typeof record.spokenReplies === 'boolean' ? record.spokenReplies : DEFAULT_SETTINGS.spokenReplies,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveVoiceSettings(settings: VoiceSettings): void {
  try {
    localStorage.setItem(
      VOICE_SETTINGS_KEY,
      JSON.stringify({ version: 1, spokenReplies: settings.spokenReplies }),
    )
  } catch {
    // A blocked storage keeps the session preference only; it is not an error.
  }
}

interface VoiceState extends VoiceSettings {
  open: boolean
  listening: boolean
  /** True between `speak` and its outcome, so the UI can offer "stop". */
  speaking: boolean
  status: VoiceStatus
  error: string
  interim: string
  turns: VoiceTurn[]
  openPanel: () => void
  closePanel: () => void
  setListening: (listening: boolean) => void
  setSpeaking: (speaking: boolean) => void
  setStatus: (status: VoiceStatus) => void
  setError: (error: string) => void
  setInterim: (interim: string) => void
  setSpokenReplies: (spoken: boolean) => void
  addTurn: (turn: Omit<VoiceTurn, 'id' | 'timestamp'>) => string
  setTurnSpeech: (id: string, speech: VoiceSpeechState) => void
  clearTurns: () => void
}

let turnSeq = 0

const initial = loadVoiceSettings()

export const useVoiceStore = create<VoiceState>()((set) => ({
  ...initial,
  open: false,
  listening: false,
  speaking: false,
  status: 'idle',
  error: '',
  interim: '',
  turns: [],
  openPanel: () => set({ open: true }),
  closePanel: () => set({ open: false }),
  setListening: (listening) => set({ listening }),
  setSpeaking: (speaking) => set({ speaking }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setInterim: (interim) => set({ interim }),
  setSpokenReplies: (spokenReplies) => {
    set({ spokenReplies })
    saveVoiceSettings({ spokenReplies })
  },
  addTurn: (turn) => {
    const id = `voice-turn-${++turnSeq}`
    set((state) => ({
      // A bounded transcript: a long conversation cannot grow without limit.
      turns: [...state.turns, { ...turn, id, timestamp: Date.now() }].slice(-120),
    }))
    return id
  },
  setTurnSpeech: (id, speech) =>
    set((state) => ({
      turns: state.turns.map((turn) => (turn.id === id ? { ...turn, speech } : turn)),
    })),
  clearTurns: () => set({ turns: [] }),
}))
