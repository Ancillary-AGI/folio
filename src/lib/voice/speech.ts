/**
 * Spoken replies.
 *
 * The browser speech synthesiser is used when it exists. Every call resolves
 * with what actually happened: an unsupported, cancelled or timed-out
 * utterance is reported as such, never as spoken. A synthesis queue that never
 * reports completion is timed out so a conversation cannot hang on it.
 */

export interface SpeechVoiceLike {
  name: string
  lang: string
  localService?: boolean
  default?: boolean
}

export interface SpeechUtteranceLike {
  text: string
  lang: string
  voice: SpeechVoiceLike | null
  rate: number
  pitch: number
  onend: (() => void) | null
  onerror: ((event: { error?: string }) => void) | null
}

export interface SpeechSynthesisLike {
  speaking: boolean
  getVoices(): SpeechVoiceLike[]
  speak(utterance: SpeechUtteranceLike): void
  cancel(): void
  onvoiceschanged?: (() => void) | null
}

export type SpeechOutcome =
  | { spoken: true }
  | {
      spoken: false
      reason: 'unsupported' | 'empty' | 'cancelled' | 'timeout' | 'error'
      detail?: string
    }

export interface SpeechOutput {
  /** False when the browser exposes no synthesiser; `speak` then reports it. */
  supported: boolean
  speak(text: string): Promise<SpeechOutcome>
  cancel(): void
  isSpeaking(): boolean
}

export interface SpeechOutputOptions {
  /** Inject a synthesiser (tests); `undefined` reads the browser's. */
  synth?: SpeechSynthesisLike | null
  createUtterance?: ((text: string) => SpeechUtteranceLike) | null
  rate?: number
  lang?: string
  /** Per-utterance ceiling; default scales with the text length. */
  timeoutMs?: (text: string, rate: number) => number
  timers?: {
    setTimeout: (callback: () => void, ms: number) => unknown
    clearTimeout: (handle: unknown) => void
  }
}

const isSpoken = (outcome: SpeechOutcome | undefined) => outcome?.spoken === true

/** Exposed so tests and the UI can describe what a call really did. */
export function describeSpeechOutcome(outcome: SpeechOutcome): string {
  if (isSpoken(outcome)) return 'Spoken aloud.'
  switch (outcome.reason) {
    case 'unsupported':
      return 'This browser has no speech synthesiser; the reply was shown as text.'
    case 'empty':
      return 'There was nothing to say.'
    case 'cancelled':
      return 'The reply was interrupted before it finished.'
    case 'timeout':
      return 'The speech synthesiser never reported finishing, so the reply was cut off.'
    default:
      return `Speech synthesis failed${outcome.detail ? ` (${outcome.detail})` : ''}.`
  }
}

function browserSynth(): SpeechSynthesisLike | null {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { speechSynthesis?: SpeechSynthesisLike }).speechSynthesis
  return candidate ?? null
}

function browserUtteranceFactory(): ((text: string) => SpeechUtteranceLike) | null {
  if (typeof window === 'undefined') return null
  const Ctor = (window as Window & { SpeechSynthesisUtterance?: new (text: string) => SpeechUtteranceLike })
    .SpeechSynthesisUtterance
  return Ctor ? (text) => new Ctor(text) : null
}

/**
 * Prefer an English voice that lives on the device: cloud voices cost a
 * round-trip per sentence and stop working offline. A missing voice list is not
 * an error — the browser then speaks with its default.
 */
export function pickVoice(voices: readonly SpeechVoiceLike[]): SpeechVoiceLike | null {
  if (voices.length === 0) return null
  const english = voices.filter((voice) => voice.lang?.toLowerCase().startsWith('en'))
  const pool = english.length > 0 ? english : voices
  return (
    pool.find((voice) => voice.default && voice.localService) ??
    pool.find((voice) => voice.localService) ??
    pool.find((voice) => voice.default) ??
    pool[0]
  )
}

export function createSpeechOutput(options: SpeechOutputOptions = {}): SpeechOutput {
  const synth = options.synth === undefined ? browserSynth() : options.synth
  const createUtterance =
    options.createUtterance === undefined ? browserUtteranceFactory() : options.createUtterance
  const timers =
    options.timers ??
    {
      setTimeout: (callback: () => void, ms: number) => globalThis.setTimeout(callback, ms),
      clearTimeout: (handle: unknown) => globalThis.clearTimeout(handle as number),
    }

  let generation = 0
  let pending: ((outcome: SpeechOutcome) => void) | null = null
  let timer: unknown = null

  const settle = (outcome: SpeechOutcome) => {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
    const resolve = pending
    pending = null
    resolve?.(outcome)
  }

  const cancel = () => {
    generation += 1
    if (synth) {
      try {
        synth.cancel()
      } catch {
        // Cancelling a stopped synthesiser is allowed to fail; nothing to do.
      }
    }
    settle({ spoken: false, reason: 'cancelled' })
  }

  return {
    supported: Boolean(synth && createUtterance),
    cancel,
    isSpeaking: () => pending !== null || Boolean(synth?.speaking),
    speak: (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return Promise.resolve({ spoken: false, reason: 'empty' })
      if (!synth || !createUtterance) return Promise.resolve({ spoken: false, reason: 'unsupported' })

      // One reply at a time: a new sentence supersedes whatever is playing.
      cancel()
      const run = generation

      return new Promise<SpeechOutcome>((resolve) => {
        pending = resolve
        let utterance: SpeechUtteranceLike
        try {
          utterance = createUtterance(trimmed)
        } catch (error) {
          settle({ spoken: false, reason: 'error', detail: error instanceof Error ? error.message : undefined })
          return
        }

        const voice = pickVoice(synth.getVoices())
        utterance.lang = options.lang ?? voice?.lang ?? 'en-US'
        utterance.voice = voice
        utterance.rate = options.rate ?? 1
        utterance.pitch = 1
        utterance.onend = () => {
          if (run === generation) settle({ spoken: true })
        }
        utterance.onerror = (event) => {
          if (run !== generation) return
          const detail = event?.error ?? 'unknown'
          const interrupted = detail === 'interrupted' || detail === 'canceled' || detail === 'cancelled'
          settle({ spoken: false, reason: interrupted ? 'cancelled' : 'error', detail })
        }

        const limitMs = options.timeoutMs
          ? options.timeoutMs(trimmed, utterance.rate)
          : 4000 + (trimmed.length * 110) / Math.max(utterance.rate, 0.25)
        timer = timers.setTimeout(() => {
          if (run !== generation) return
          try {
            synth.cancel()
          } catch {
            // A stuck synthesiser still gets its pending call resolved below.
          }
          settle({ spoken: false, reason: 'timeout' })
        }, limitMs)

        try {
          synth.speak(utterance)
        } catch (error) {
          settle({ spoken: false, reason: 'error', detail: error instanceof Error ? error.message : undefined })
        }
      })
    },
  }
}
