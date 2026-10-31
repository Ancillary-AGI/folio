/**
 * A continuous speech-recognition session.
 *
 * Browsers end recognition on their own after a pause, after a network blip and
 * after an error. A conversation needs the microphone to stay open, so this
 * session restarts recognition while the designer wants it listening — but it
 * refuses to spin: a session that keeps dying immediately is reported and
 * stopped instead of restarting forever. Permission and device errors are
 * fatal and say what to do next.
 */

export interface RecognitionResultLike {
  transcript: string
}

export interface RecognitionResultEventLike {
  resultIndex?: number
  results: ArrayLike<
    ArrayLike<RecognitionResultLike> & { isFinal?: boolean }
  >
}

export interface RecognitionLike {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult: ((event: RecognitionResultEventLike) => void) | null
  start(): void
  stop(): void
}

export type VoiceSessionStatus = 'idle' | 'starting' | 'listening' | 'error'

export interface VoiceSessionCallbacks {
  onStatus: (status: VoiceSessionStatus, detail?: string) => void
  onTranscript: (text: string, final: boolean) => void
  onError: (message: string, fatal: boolean) => void
}

export interface VoiceSessionOptions {
  createRecognition: () => RecognitionLike | null
  callbacks: VoiceSessionCallbacks
  /** Delay before restarting after the browser ends a session. */
  restartDelayMs?: number
  /** Ends closer together than this count as a failing loop. */
  quickEndMs?: number
  maxQuickRestarts?: number
  lang?: string
  now?: () => number
  timers?: {
    setTimeout: (callback: () => void, ms: number) => unknown
    clearTimeout: (handle: unknown) => void
  }
}

export interface VoiceSession {
  start(): boolean
  stop(): void
  isActive(): boolean
}

const FATAL_ERRORS: Readonly<Record<string, string>> = {
  'not-allowed': 'Microphone access was denied. Allow the microphone in the browser, or type your command.',
  'service-not-allowed': 'Speech recognition is blocked by this browser or an extension. Type your command instead.',
  'audio-capture': 'No microphone was found. Connect one, or type your command.',
  'language-not-supported': 'This browser cannot recognise the requested speech language. Type your command instead.',
  'bad-grammar': 'The browser rejected the speech grammar. Type your command instead.',
}

const TRANSIENT_ERRORS: Readonly<Record<string, string>> = {
  network: 'Speech recognition lost its connection; reconnecting.',
  'server-error': 'The browser speech service had a problem; reconnecting.',
  overloaded: 'The browser speech service is busy; reconnecting.',
}

export function createVoiceSession(options: VoiceSessionOptions): VoiceSession {
  const {
    createRecognition,
    callbacks,
    restartDelayMs = 300,
    quickEndMs = 400,
    maxQuickRestarts = 4,
    lang = 'en-US',
    now = () => Date.now(),
    timers = {
      setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
    },
  } = options

  let recognition: RecognitionLike | null = null
  let active = false
  let fatal = false
  let timer: unknown = null
  let startedAt = 0
  let quickRestarts = 0

  const clearTimer = () => {
    if (timer !== null) {
      timers.clearTimeout(timer)
      timer = null
    }
  }

  const waitForRestart = () => {
    clearTimer()
    callbacks.onStatus('starting')
    timer = timers.setTimeout(() => {
      timer = null
      if (!active) return
      try {
        recognition?.start()
      } catch (error) {
        active = false
        callbacks.onError(
          `Speech recognition could not restart (${error instanceof Error ? error.message : 'unknown error'}). Type your command instead.`,
          true,
        )
        callbacks.onStatus('error')
      }
    }, restartDelayMs)
  }

  const attach = (target: RecognitionLike) => {
    target.continuous = true
    target.interimResults = true
    target.lang = lang
    target.maxAlternatives = 1

    target.onstart = () => {
      if (!active) return
      startedAt = now()
      callbacks.onStatus('listening')
    }

    target.onresult = (event) => {
      const from = Math.max(0, event.resultIndex ?? 0)
      for (let index = from; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result?.[0]?.transcript?.trim() ?? ''
        if (!text) continue
        if (result.isFinal) {
          // A understood phrase breaks the "keeps dying" streak.
          quickRestarts = 0
          callbacks.onTranscript(text, true)
        } else {
          callbacks.onTranscript(text, false)
        }
      }
    }

    target.onerror = (event) => {
      const code = event.error
      const fatalMessage = FATAL_ERRORS[code]
      if (fatalMessage) {
        active = false
        fatal = true
        clearTimer()
        callbacks.onError(fatalMessage, true)
        callbacks.onStatus('error')
        try {
          target.stop()
        } catch {
          // Already stopped; the fatal error is already reported.
        }
        return
      }
      const transient = TRANSIENT_ERRORS[code]
      // 'no-speech' and 'aborted' are ordinary silences; the session restarts
      // from onend and must not be reported as failures.
      if (transient) callbacks.onError(transient, false)
    }

    target.onend = () => {
      if (!active || fatal) return
      const lifetime = now() - startedAt
      if (startedAt > 0 && lifetime < quickEndMs) quickRestarts += 1
      else quickRestarts = 0
      if (quickRestarts > maxQuickRestarts) {
        active = false
        callbacks.onError(
          'Speech recognition keeps stopping immediately. Check microphone permissions or type your command instead.',
          true,
        )
        callbacks.onStatus('error')
        return
      }
      waitForRestart()
    }
  }

  return {
    start: () => {
      if (active) return true
      fatal = false
      quickRestarts = 0
      callbacks.onStatus('starting')
      let target: RecognitionLike | null = null
      try {
        target = createRecognition()
      } catch (error) {
        callbacks.onError(
          `Speech recognition could not start (${error instanceof Error ? error.message : 'unknown error'}). Type your command instead.`,
          true,
        )
        callbacks.onStatus('error')
        return false
      }
      if (!target) {
        callbacks.onError(
          'This browser does not expose speech recognition. Type your command, or use a browser that supports the Web Speech API.',
          true,
        )
        callbacks.onStatus('error')
        return false
      }
      recognition = target
      active = true
      attach(target)
      try {
        target.start()
      } catch (error) {
        active = false
        callbacks.onError(
          `Speech recognition could not start (${error instanceof Error ? error.message : 'unknown error'}). Type your command instead.`,
          true,
        )
        callbacks.onStatus('error')
        return false
      }
      return true
    },
    stop: () => {
      active = false
      clearTimer()
      const target = recognition
      recognition = null
      if (target) {
        try {
          target.stop()
        } catch {
          // Stopping an already-ended recogniser is harmless.
        }
      }
      callbacks.onStatus('idle')
    },
    isActive: () => active,
  }
}
