import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createVoiceSession,
  type RecognitionLike,
  type RecognitionResultEventLike,
  type VoiceSessionCallbacks,
} from './voiceSession'

class FakeRecognition implements RecognitionLike {
  continuous = false
  interimResults = false
  lang = ''
  maxAlternatives = 0
  onstart: (() => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onresult: ((event: RecognitionResultEventLike) => void) | null = null
  starts = 0
  stopped = false
  failNextStart = false

  start(): void {
    if (this.failNextStart) {
      this.failNextStart = false
      throw new Error('InvalidStateError')
    }
    this.starts += 1
    this.stopped = false
  }
  stop(): void {
    this.stopped = true
  }
}

interface Harness {
  recognition: FakeRecognition | null
  session: ReturnType<typeof createVoiceSession>
  statuses: Array<{ status: string; detail?: string }>
  transcripts: Array<{ text: string; final: boolean }>
  errors: Array<{ message: string; fatal: boolean }>
}

const makeHarness = (options: { factoryThrows?: boolean } = {}): Harness => {
  const harness: Harness = {
    recognition: null,
    session: null as unknown as ReturnType<typeof createVoiceSession>,
    statuses: [],
    transcripts: [],
    errors: [],
  }
  const callbacks: VoiceSessionCallbacks = {
    onStatus: (status, detail) => harness.statuses.push({ status, detail }),
    onTranscript: (text, final) => harness.transcripts.push({ text, final }),
    onError: (message, fatal) => harness.errors.push({ message, fatal }),
  }
  harness.recognition = new FakeRecognition()
  harness.session = createVoiceSession({
    createRecognition: () => {
      if (options.factoryThrows) throw new Error('boom')
      return harness.recognition
    },
    callbacks,
    restartDelayMs: 25,
    quickEndMs: 100,
    maxQuickRestarts: 3,
    timers: {
      setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
      clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
    },
  })
  return harness
}

const finalEvent = (text: string, resultIndex = 0): RecognitionResultEventLike => ({
  resultIndex,
  results: [
    {
      0: { transcript: text },
      length: 1,
      isFinal: true,
    },
  ] as unknown as ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }>,
})

describe('createVoiceSession', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('configures continuous interim recognition and reports listening on start', () => {
    const { session, recognition, statuses } = makeHarness()
    expect(session.start()).toBe(true)
    expect(recognition?.continuous).toBe(true)
    expect(recognition?.interimResults).toBe(true)
    expect(recognition?.lang).toBe('en-US')
    recognition?.onstart?.()
    expect(session.isActive()).toBe(true)
    expect(statuses.map((entry) => entry.status)).toEqual(['starting', 'listening'])
  })

  it('forwards interim and final transcripts', () => {
    const { session, recognition, transcripts } = makeHarness()
    session.start()
    recognition?.onresult?.({
      resultIndex: 0,
      results: [
        { 0: { transcript: 'place a ' }, length: 1, isFinal: false },
      ] as unknown as RecognitionResultEventLike['results'],
    })
    recognition?.onresult?.(finalEvent('place a resistor'))
    expect(transcripts).toEqual([
      { text: 'place a', final: false },
      { text: 'place a resistor', final: true },
    ])
  })

  it('restarts after the browser ends the session while active', () => {
    const { session, recognition } = makeHarness()
    session.start()
    recognition?.onstart?.()
    recognition?.onend?.()
    expect(recognition?.starts).toBe(1)
    vi.advanceTimersByTime(30)
    expect(recognition?.starts).toBe(2)
    recognition?.onstart?.()
    expect(session.isActive()).toBe(true)
  })

  it('stop() ends the session without restarting', () => {
    const { session, recognition } = makeHarness()
    session.start()
    recognition?.onstart?.()
    session.stop()
    expect(session.isActive()).toBe(false)
    expect(recognition?.stopped).toBe(true)
    vi.advanceTimersByTime(100)
    expect(recognition?.starts).toBe(1)
  })

  it('reports a fatal permission error and never restarts', () => {
    const { session, recognition, errors } = makeHarness()
    session.start()
    recognition?.onerror?.({ error: 'not-allowed' })
    expect(errors.some((entry) => entry.fatal && /denied/.test(entry.message))).toBe(true)
    expect(session.isActive()).toBe(false)
    vi.advanceTimersByTime(100)
    expect(recognition?.starts).toBe(1)
  })

  it('treats no-speech as an ordinary silence', () => {
    const { session, recognition, errors } = makeHarness()
    session.start()
    recognition?.onstart?.()
    recognition?.onerror?.({ error: 'no-speech' })
    expect(errors).toHaveLength(0)
    recognition?.onend?.()
    vi.advanceTimersByTime(30)
    expect(recognition?.starts).toBe(2)
  })

  it('gives up when the session keeps dying immediately', () => {
    const { session, recognition, errors } = makeHarness()
    session.start()
    for (let round = 0; round < 4; round += 1) {
      recognition?.onstart?.()
      recognition?.onend?.()
      vi.advanceTimersByTime(30)
    }
    expect(errors.some((entry) => entry.fatal && /keeps stopping/.test(entry.message))).toBe(true)
    expect(session.isActive()).toBe(false)
  })

  it('reports an unsupported browser without a recognition constructor', () => {
    const statuses: Array<{ status: string }> = []
    const errors: Array<{ message: string; fatal: boolean }> = []
    const session = createVoiceSession({
      createRecognition: () => null,
      callbacks: {
        onStatus: (status) => statuses.push({ status }),
        onTranscript: () => {},
        onError: (message, fatal) => errors.push({ message, fatal }),
      },
      timers: {
        setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
        clearTimeout: (handle) => globalThis.clearTimeout(handle as number),
      },
    })
    expect(session.start()).toBe(false)
    expect(errors.some((entry) => entry.fatal && /does not expose speech recognition/.test(entry.message))).toBe(true)
    expect(statuses.at(-1)).toEqual({ status: 'error' })
  })

  it('reports a constructor or start() failure honestly', () => {
    const { session, errors } = makeHarness({ factoryThrows: true })
    expect(session.start()).toBe(false)
    expect(errors.some((entry) => entry.fatal && /could not start/.test(entry.message))).toBe(true)

    const { session: throwingSession, recognition } = makeHarness()
    if (recognition) recognition.failNextStart = true
    expect(throwingSession.start()).toBe(false)
    expect(throwingSession.isActive()).toBe(false)
  })
})
